import { Beef, Transaction } from '@bsv/sdk'
import type { AdmittanceInstructions, TopicManager } from '@bsv/overlay'
import {
  checkGenesisState,
  checkTransition,
  findDppOutputs,
  tryParseDppOutput,
  verifyServerSignature,
  verifyUserSignature,
} from '@bsv/dpp-core'

const NONE: AdmittanceInstructions = { outputsToAdmit: [], coinsToRetain: [] }

/**
 * tm_dpp - DPP Token Standard v1 admission (`spec/record-model.md` §6 and §8).
 *
 * Admits a transaction's single DPP output when:
 * - exactly one well-formed DPP output exists (invariant 1; field rules are
 *   enforced by the dpp-core codec at parse time),
 * - user_signature verifies against actor_identity_key + actor_keyID,
 * - server_signature verifies against the configured service key
 *   (admission policy, not token validity - §5),
 * - genesis states satisfy the genesis rules. Non-genesis states spend the
 *   previously admitted tip (invariant 4, via previousCoins) and satisfy the
 *   per-link transition rules (invariants 5–7).
 *
 * Spent tips are retained (coinsToRetain) so the lifecycle history stays
 * resolvable (§1: the spend history is the passport's lifecycle).
 */
export class DppTopicManager implements TopicManager {
  constructor(private readonly serverIdentityKey: string) {}

  async identifyAdmissibleOutputs(
    beef: number[],
    previousCoins: number[]
  ): Promise<AdmittanceInstructions> {
    let tx: Transaction
    try {
      tx = Transaction.fromBEEF(beef)
    } catch {
      return NONE
    }

    const refs = findDppOutputs(tx)
    if (refs.length !== 1) return NONE
    const { state, outputIndex } = refs[0]

    if (!verifyUserSignature(state)) return NONE
    if (!verifyServerSignature(state, this.serverIdentityKey)) return NONE

    if (state.previousTxid === '') {
      if (checkGenesisState(state) != null) return NONE
      return { outputsToAdmit: [outputIndex], coinsToRetain: [] }
    }

    /*
     * The predecessor's bytes, found in the submitted BEEF by txid rather than
     * read off `input.sourceTransaction`, and the distinction is a defect the
     * 2026-08-12 backfill rehearsal caught: every mined event on every
     * multi-state passport was refused, and the refusal consumed the admitted
     * genesis coin, so one backfill pass left those passports with an empty
     * index entry.
     *
     * The SDK's writer and reader agree on a rule this check used to be on the
     * wrong side of. A transaction carrying its own merkle proof needs no
     * ancestry for SPV, so `Beef.mergeTransaction` stops walking parents at a
     * proof (`Beef.js:333`) and the reader symmetrically leaves
     * `input.sourceTransaction` unset on a proven subject, even when the
     * parent's bytes sit in the same BEEF. SPV is the wrong standard here:
     * this check wants the predecessor's locking script to hold the transition
     * rules against, which is a stricter need than proof of inclusion. So the
     * BEEF is searched directly, hydration is taken when the SDK happens to
     * provide it (a fresh unproven state, which is the live announce path),
     * and the submitter's side of the contract is to include the predecessor's
     * bytes, which `scripts/announce.ts` does by submitting each state atomic
     * over the whole stored chain.
     */
    let parsedBeef: Beef | undefined
    try {
      parsedBeef = Beef.fromBinary(beef)
    } catch {
      parsedBeef = undefined
    }
    for (const inputIndex of previousCoins) {
      const input = tx.inputs[inputIndex]
      if (input == null) continue
      const prevTxid = input.sourceTransaction?.id('hex') ?? input.sourceTXID
      if (prevTxid !== state.previousTxid) continue
      const prevTx = input.sourceTransaction ?? parsedBeef?.findTxid(prevTxid)?.tx
      const prevOutput = prevTx?.outputs[input.sourceOutputIndex]
      if (prevOutput == null) continue
      const prev = tryParseDppOutput(prevOutput.lockingScript)
      if (prev == null) continue
      if (checkTransition(prev.state, state, prevTxid) != null) return NONE
      return { outputsToAdmit: [outputIndex], coinsToRetain: [inputIndex] }
    }

    // No previously admitted coin matches previous_txid: not the admitted tip.
    return NONE
  }

  async getDocumentation(): Promise<string> {
    return [
      '# tm_dpp',
      '',
      'Admission for DPP Token Standard v1 passports (spec/record-model.md).',
      'One DPP output per transaction; signatures over the canonical byte',
      'preimage; non-genesis states must spend the admitted tip; spent states',
      'are retained as lifecycle history. Admission additionally requires a',
      'valid service signature (deployment policy, spec/record-model.md §8).',
    ].join('\n')
  }

  async getMetaData(): Promise<{
    name: string
    shortDescription: string
    version?: string
  }> {
    return {
      name: 'tm_dpp',
      shortDescription: 'Digital Product Passport token admission (DPP Standard v1)',
      version: '1.0.0',
    }
  }
}
