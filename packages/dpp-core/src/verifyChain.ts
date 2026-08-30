import { Beef, PublicKey, Transaction, type ChainTracker } from '@bsv/sdk'
import { tryParseDppOutput } from './codec.js'
import { verifyServerSignature, verifyUserSignature } from './signatures.js'
import { checkOwnerConsent, normaliseTransferAuthorities } from './owner.js'
import { checkGenesisState, checkTransition } from './transition.js'
import type { ChainVerifyResult, DppState, StateCheck } from './types.js'

export interface VerifyChainOptions {
  /**
   * Tracker for SPV (`spec/record-model.md` §8 check 3). Omit or pass 'scripts only' to skip root
   * checks - every state then reports SPV 'pending'. The demo app always
   * passes a real tracker; 'scripts only' exists for offline use and tests.
   */
  chainTracker?: ChainTracker | 'scripts only'
  /**
   * When set, server_signature is verified against this service identity key
   * (admission policy, §8). Token validity itself never depends on it; the
   * overlay's topic manager passes its configured key, viewers may omit it.
   */
  serverIdentityKey?: string
  /**
   * The optional owner-signed transfer (`spec/custody.md` §4), selected by a
   * profile. `true` runs the predicate on every TRANSFER; an object also names
   * the transfer authorities, identity keys whose TRANSFER passes without it
   * (recovery). A malformed authority throws before any state is read: a
   * misconfigured authority must be loud, never silently unmatched.
   */
  ownerConsent?: boolean | { authorities: string[] }
}

export interface DppOutputRef {
  state: DppState
  outputIndex: number
  lockingPublicKey: PublicKey
}

/**
 * Locate THE DPP output of a transaction (§6 invariant 1: exactly one).
 * Returns all matches; callers enforce the invariant.
 */
export function findDppOutputs(tx: Transaction): DppOutputRef[] {
  const refs: DppOutputRef[] = []
  tx.outputs.forEach((output, outputIndex) => {
    const parsed = tryParseDppOutput(output.lockingScript)
    if (parsed != null) {
      refs.push({ state: parsed.state, outputIndex, lockingPublicKey: parsed.lockingPublicKey })
    }
  })
  return refs
}

/**
 * Verify a full passport chain, ordered genesis → tip (§6 + §8).
 *
 * What "Authentic ✓" means (§8): (1) the genesis maker signature is valid;
 * (2) every link satisfies invariants 1–5, checked here both structurally
 * (the next state spends the previous DPP output) and on the readable field
 * (previous_txid equality); (3) SPV - each mined transaction's merkle path
 * validates against block headers via the chain tracker. An unmined state
 * passes with SPV 'pending'. Any failure ⇒ valid: false ("Could not verify").
 *
 * Script execution of spends is enforced by the network and is not
 * re-evaluated here; the in-app checks are exactly the three above.
 */
export async function verifyChain(
  txs: Transaction[],
  options: VerifyChainOptions = {}
): Promise<ChainVerifyResult> {
  const states: StateCheck[] = []
  let anyPending = false
  let unavailable: string | undefined
  // 'verified' is a claim that every mined state proved against block headers,
  // and a failed chain never makes it, whatever its proofs said. It used to:
  // first because the summary read only `anyPending`, then because it guarded
  // a flag that only an SPV failure set, so a chain failing on a signature or
  // on linkage - every proof good - still came back
  // `{ valid: false, spv: 'verified' }`, and a consumer showing the two
  // separately printed "inclusion proved" beside "did not check out". The
  // failure path now says 'pending' outright; the per-state truth, including
  // 'failed' where a proof was refuted, stays in `states`.
  const fail = (error: string): ChainVerifyResult => ({
    valid: false,
    spv: 'pending',
    states,
    error,
    ...(unavailable == null ? {} : { spvUnavailable: unavailable }),
  })

  if (txs.length === 0) return fail('empty chain')

  const consentSelected = options.ownerConsent != null && options.ownerConsent !== false
  const authorities =
    typeof options.ownerConsent === 'object'
      ? normaliseTransferAuthorities(options.ownerConsent.authorities)
      : []

  let prev: { state: DppState; txid: string; outputIndex: number } | null = null
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i]
    const txid = tx.id('hex')

    const refs = findDppOutputs(tx)
    if (refs.length !== 1) {
      return fail(`state ${i} (${txid}): exactly one DPP output required, found ${refs.length}`)
    }
    const { state, outputIndex } = refs[0]

    const userSignatureValid = verifyUserSignature(state)
    const serverSignatureValid =
      options.serverIdentityKey == null
        ? null
        : verifyServerSignature(state, options.serverIdentityKey)

    let linkError: string | null
    if (prev == null) {
      linkError = checkGenesisState(state)
    } else {
      linkError = checkTransition(prev.state, state, prev.txid)
      if (linkError == null) {
        const spendsPrev = tx.inputs.some(
          (input) =>
            (input.sourceTransaction?.id('hex') ?? input.sourceTXID) === prev!.txid &&
            input.sourceOutputIndex === prev!.outputIndex
        )
        if (!spendsPrev) linkError = 'state does not spend the previous tip output'
      }
    }

    // The eighth, optional invariant runs only where it is defined: on a
    // TRANSFER whose link holds, under a profile that selects it. Anywhere
    // else it reports null, so a consumer prints "not applicable" and never a
    // pass the predicate did not earn.
    let consentError: string | null = null
    let ownerConsentValid: boolean | null = null
    if (consentSelected && prev != null && state.op === 'TRANSFER' && linkError == null) {
      consentError = checkOwnerConsent(prev.state, state, authorities)
      ownerConsentValid = consentError == null
    }

    let spv: StateCheck['spv']
    let spvFailReason = 'merkle path does not validate against block headers'
    const tracker = options.chainTracker
    if (tx.merklePath == null || tracker == null || tracker === 'scripts only') {
      spv = 'pending'
      anyPending = true
    } else {
      // Three outcomes, not two. `verify` returns false only when the tracker
      // answered and the root it holds for that height is a different root:
      // that is evidence the proof is wrong, and the chain must fail. It
      // throws when the tracker could not answer at all (service down, rate
      // limited, socket error), which is evidence of nothing.
      //
      // Both used to land on 'failed', so one header service having a bad
      // afternoon made every passport in the demonstration read "Could not
      // verify" - the strongest accusation the product can make about a
      // product, published because we could not reach a website. Unchecked is
      // 'pending', and the reason travels with the result so an operator can
      // see the outage instead of inferring it from complaints.
      //
      // A proof can also refute itself before any source is asked: one that
      // does not contain this transaction's txid fails on local inspection,
      // deterministically, and no outage explains it. That throw used to
      // share the tracker's catch and land on 'pending', so a chain carrying
      // a proof for some OTHER transaction stayed valid-with-pending forever.
      // computeRoot is pre-flighted on its own so the two throws separate.
      let proven: boolean | null = null
      let coversTxid = true
      try {
        tx.merklePath.computeRoot(txid)
      } catch {
        coversTxid = false
      }
      if (!coversTxid) {
        spv = 'failed'
        spvFailReason = 'merkle path does not contain this transaction'
      } else {
        try {
          proven = await tx.merklePath.verify(txid, tracker)
        } catch (cause) {
          proven = null
          unavailable ??= cause instanceof Error ? cause.message : String(cause)
        }
        if (proven == null) {
          spv = 'pending'
          anyPending = true
        } else {
          spv = proven ? 'verified' : 'failed'
        }
      }
    }

    states.push({
      txid,
      op: state.op,
      userSignatureValid,
      serverSignatureValid,
      linkageValid: linkError == null,
      ownerConsentValid,
      spv,
    })

    if (!userSignatureValid) return fail(`state ${i} (${txid}): user_signature invalid`)
    if (serverSignatureValid === false) {
      return fail(`state ${i} (${txid}): server_signature invalid for configured service key`)
    }
    if (linkError != null) return fail(`state ${i} (${txid}): ${linkError}`)
    if (consentError != null) return fail(`state ${i} (${txid}): ${consentError}`)
    if (spv === 'failed') {
      return fail(`state ${i} (${txid}): ${spvFailReason}`)
    }

    prev = { state, txid, outputIndex }
  }

  return {
    valid: true,
    spv: anyPending ? 'pending' : 'verified',
    states,
    ...(unavailable == null ? {} : { spvUnavailable: unavailable }),
  }
}

/**
 * Reconstruct the ordered passport chain (genesis → tip) from a BEEF, e.g.
 * as returned by the ls_dpp lookup. Transactions come out hydrated: merkle
 * paths attached, input source transactions linked - ready for verifyChain.
 */
export function chainFromBeef(beef: Beef, passportId?: string): Transaction[] {
  const entries: Array<{ txid: string; state: DppState }> = []
  for (const beefTx of beef.txs) {
    const tx = beefTx.tx
    if (tx == null) continue
    const refs = findDppOutputs(tx)
    const ref = refs.find(
      (r) => passportId == null || r.state.passportId === passportId
    )
    if (ref != null) entries.push({ txid: beefTx.txid, state: ref.state })
  }
  if (entries.length === 0) {
    throw new Error('BEEF contains no DPP states' + (passportId ? ` for ${passportId}` : ''))
  }
  const genesis = entries.filter((e) => e.state.previousTxid === '')
  if (genesis.length !== 1) {
    throw new Error(`expected exactly one genesis state, found ${genesis.length}`)
  }
  const byPrev = new Map(
    entries
      .filter((e) => e.state.previousTxid !== '')
      .map((e) => [e.state.previousTxid, e])
  )
  const ordered: Transaction[] = []
  let current: { txid: string; state: DppState } | undefined = genesis[0]
  while (current != null) {
    const hydrated = beef.findAtomicTransaction(current.txid)
    if (hydrated == null) {
      throw new Error(`BEEF is missing transaction ${current.txid}`)
    }
    ordered.push(hydrated)
    current = byPrev.get(current.txid)
  }
  if (ordered.length !== entries.length) {
    throw new Error('BEEF contains DPP states that do not link into one chain')
  }
  return ordered
}
