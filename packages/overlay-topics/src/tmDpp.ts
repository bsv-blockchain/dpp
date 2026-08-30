import { Beef, Transaction } from '@bsv/sdk'
import type { AdmittanceInstructions, TopicManager } from '@bsv/overlay'
import {
  checkGenesisState,
  checkOwnerConsent,
  checkTransition,
  findDppOutputs,
  normaliseTransferAuthorities,
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
 *
 * One rule is a profile's choice rather than the record model's, and this
 * manager enforces it only when told to: the owner-signed transfer of
 * `spec/custody.md` §4, under which a TRANSFER is admitted only when its actor
 * proves it is the previous owner, by equality or by owner_linkage, or is a
 * named transfer authority. It is admission policy of the same kind as the
 * service signature, and the topic documentation says whether this instance
 * enforces it, so a writer learns the rule from the index and not from a
 * refusal (`spec/services.md` §6).
 */
export interface DppAdmissionOptions {
  /**
   * The owner-signed transfer (`spec/custody.md` §4). `true` runs the predicate
   * on every TRANSFER; an object also names the transfer authorities, identity
   * keys whose TRANSFER is admitted without proof (recovery). Off by default:
   * the record model's baseline admits any signed TRANSFER that spends the tip.
   * A malformed authority throws at construction, so a misconfigured
   * deployment fails to boot rather than silently never matching.
   */
  ownerConsent?: boolean | { authorities: string[] }
}

export class DppTopicManager implements TopicManager {
  private readonly consentSelected: boolean
  private readonly authorities: string[]

  constructor(
    private readonly serverIdentityKey: string,
    options: DppAdmissionOptions = {}
  ) {
    this.consentSelected = options.ownerConsent != null && options.ownerConsent !== false
    this.authorities =
      typeof options.ownerConsent === 'object'
        ? normaliseTransferAuthorities(options.ownerConsent.authorities)
        : []
  }

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
      if (this.consentSelected) {
        const reason = checkOwnerConsent(prev.state, state, this.authorities)
        if (reason != null) {
          // The other refusals are silent because the wire says everything a
          // writer needs. This one is a policy the writer may not know this
          // instance runs, so the operator's log names it.
          console.warn(`tm_dpp refused ${tx.id('hex')}: ${reason}`)
          return NONE
        }
      }
      return { outputsToAdmit: [outputIndex], coinsToRetain: [inputIndex] }
    }

    // No previously admitted coin matches previous_txid: not the admitted tip.
    return NONE
  }

  async getDocumentation(): Promise<string> {
    const lines = [
      '# tm_dpp',
      '',
      'Admission for DPP Token Standard v1 passports (spec/record-model.md).',
      'One DPP output per transaction; signatures over the canonical byte',
      'preimage; non-genesis states must spend the admitted tip; spent states',
      'are retained as lifecycle history. Admission additionally requires a',
      'valid service signature (deployment policy, spec/record-model.md §8).',
      '',
      '## The owner-signed transfer',
      '',
    ]
    if (this.consentSelected) {
      lines.push(
        'This index is deployed for a profile that selects the owner-signed transfer (spec/custody.md section 4). A TRANSFER is admitted only when its actor is the previous owner, proven by equality (actor_identity_key equals the previous owner_identity_key) or by linkage (event_data carries owner_linkage, 64 lower-case hex characters, with the previous owner_identity_key equal to actor_identity_key plus owner_linkage times G), or when the actor is a transfer authority named below. The predicate is evaluated in that order: equality, authorities, linkage.',
        '',
        this.authorities.length === 0
          ? 'Transfer authorities: none. Every TRANSFER must prove consent.'
          : `Transfer authorities: ${this.authorities.join(', ')}. A TRANSFER by one of these keys is admitted without proof of consent; the profile expects it to be attested on the anchor rail.`
      )
    } else {
      lines.push(
        'Not enforced by this index, which admits any signed TRANSFER that spends the tip: the record model baseline. The owner-signed transfer (spec/custody.md section 4) is a profile choice, switched on when the topic manager is configured for it.'
      )
    }
    return lines.join('\n')
  }

  async getMetaData(): Promise<{
    name: string
    shortDescription: string
    version?: string
  }> {
    return {
      name: 'tm_dpp',
      shortDescription: 'Digital Product Passport token admission (DPP Standard v1)',
      version: '1.1.0',
    }
  }
}
