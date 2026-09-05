import { Beef, PublicKey, Transaction, type ChainTracker } from '@bsv/sdk'
import { tryParseDppOutput } from './codec.js'
import { verifyServerSignature, verifyUserSignature } from './signatures.js'
import { publisherKeysAt, type PublisherPolicy } from './publisherPolicy.js'
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

/** The options `inspectChain` takes beyond `verifyChain`'s: several publisher keys, any of which may have countersigned. */
export interface InspectChainOptions extends VerifyChainOptions {
  /**
   * Publisher identity keys, any one of which satisfies the server-signature
   * check (`spec/verification.md` §4, `publisherSignatures`). `serverIdentityKey`
   * is the one-key spelling of the same option; both may be given.
   */
  publisherKeys?: string[]
  /**
   * A publisher key policy chain (`spec/services.md` §1), already verified by
   * the caller with `verifyPolicyChain`. A state is then checked against the
   * state-publisher keys active at its own timestamp, so a retired key still
   * authenticates what it signed while active and a new key authenticates
   * nothing timestamped before its activation. Combined with `publisherKeys`
   * when both are given.
   */
  publisherPolicy?: PublisherPolicy[]
}

/** Why one state stopped the inspection, in the vocabulary the report uses. */
export type ChainFailureKind = 'encoding' | 'userSignature' | 'serverSignature' | 'linkage' | 'consent' | 'inclusion'

/** One inspected state: the verifier's findings plus what a report needs to name it. */
export interface StateInspection extends StateCheck {
  index: number
  outputIndex: number
  state: DppState
  linkError: string | null
  consentError: string | null
  /** True when the countersignature verifies under a key the policy names, but one not active at this state's timestamp. */
  publisherOutsideWindow?: boolean
  /** Why `spv` is 'pending' or 'failed'; absent when 'verified'. */
  spvReason?: 'no-proof' | 'header-check-disabled' | 'header-source-unavailable' | 'proof-does-not-contain-txid' | 'proof-refuted'
}

/**
 * Every finding the token rail's verifier makes, state by state, stopping after
 * the first state that fails (§8's rule: a chain fails as a whole at the first
 * failing state, with the reason identified). `verifyChain` reduces this to
 * the `ChainVerifyResult` it has always returned; `verifyPassportEvidence`
 * reports it check by check instead of collapsing it to one Boolean.
 */
export interface ChainInspection {
  states: StateInspection[]
  /**
   * The first failure, when there was one. An `encoding` failure names a
   * transaction that yielded no state, so `states` carries nothing for it.
   */
  failure?: { index: number; txid: string; kind: ChainFailureKind; message: string }
  /** True when the inspection reached the last supplied transaction without a failure. */
  complete: boolean
  anyPending: boolean
  spvUnavailable?: string
}

export async function inspectChain(txs: Transaction[], options: InspectChainOptions = {}): Promise<ChainInspection> {
  const states: StateInspection[] = []
  let anyPending = false
  let unavailable: string | undefined
  const stop = (index: number, txid: string, kind: ChainFailureKind, message: string): ChainInspection => ({
    states,
    failure: { index, txid, kind, message: `state ${index} (${txid}): ${message}` },
    complete: false,
    anyPending,
    ...(unavailable == null ? {} : { spvUnavailable: unavailable }),
  })

  const staticPublisherKeys = [
    ...(options.serverIdentityKey == null ? [] : [options.serverIdentityKey]),
    ...(options.publisherKeys ?? []),
  ]
  const policy = options.publisherPolicy != null && options.publisherPolicy.length > 0 ? options.publisherPolicy : undefined
  // Every state-publisher key any version of the policy ever named: a
  // countersignature that verifies under one of these but not under a key
  // active at the state's time is a window failure, reported as such rather
  // than as a stranger's signature.
  const everPolicyKeys = policy == null ? [] : [...new Set(policy.flatMap((p) => p.publishers.filter((e) => e.role === 'state-publisher').map((e) => e.key)))]
  const publisherSelected = staticPublisherKeys.length > 0 || policy != null
  const publisherKeysFor = (state: DppState): string[] =>
    policy == null ? staticPublisherKeys : [...staticPublisherKeys, ...publisherKeysAt(policy, state.timestamp, 'state-publisher')]
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
      return stop(i, txid, 'encoding', `exactly one DPP output required, found ${refs.length}`)
    }
    const { state, outputIndex } = refs[0]

    const userSignatureValid = verifyUserSignature(state)
    const serverSignatureValid = !publisherSelected
      ? null
      : publisherKeysFor(state).some((key) => verifyServerSignature(state, key))
    const publisherOutsideWindow =
      serverSignatureValid === false && everPolicyKeys.some((key) => verifyServerSignature(state, key))

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
    let spvReason: StateInspection['spvReason']
    let spvFailReason = 'merkle path does not validate against block headers'
    const tracker = options.chainTracker
    if (tx.merklePath == null) {
      spv = 'pending'
      spvReason = 'no-proof'
      anyPending = true
    } else if (tracker == null || tracker === 'scripts only') {
      spv = 'pending'
      spvReason = 'header-check-disabled'
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
        spvReason = 'proof-does-not-contain-txid'
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
          spvReason = 'header-source-unavailable'
          anyPending = true
        } else if (proven) {
          spv = 'verified'
        } else {
          spv = 'failed'
          spvReason = 'proof-refuted'
        }
      }
    }

    states.push({
      index: i,
      outputIndex,
      state,
      txid,
      op: state.op,
      userSignatureValid,
      serverSignatureValid,
      ...(publisherOutsideWindow ? { publisherOutsideWindow: true } : {}),
      linkageValid: linkError == null,
      ownerConsentValid,
      spv,
      linkError,
      consentError,
      ...(spvReason == null ? {} : { spvReason }),
    })

    if (!userSignatureValid) return stop(i, txid, 'userSignature', 'user_signature invalid')
    if (serverSignatureValid === false) {
      return stop(
        i,
        txid,
        'serverSignature',
        publisherOutsideWindow
          ? `server_signature verifies under a publisher key that was not active at ${state.timestamp}`
          : 'server_signature invalid for configured service key'
      )
    }
    if (linkError != null) return stop(i, txid, 'linkage', linkError)
    if (consentError != null) return stop(i, txid, 'consent', consentError)
    if (spv === 'failed') return stop(i, txid, 'inclusion', spvFailReason)

    prev = { state, txid, outputIndex }
  }

  return {
    states,
    complete: true,
    anyPending,
    ...(unavailable == null ? {} : { spvUnavailable: unavailable }),
  }
}

/** The `StateCheck` a `ChainVerifyResult` carries, without the inspection's extra findings. */
function toStateCheck(s: StateInspection): StateCheck {
  return {
    txid: s.txid,
    op: s.op,
    userSignatureValid: s.userSignatureValid,
    serverSignatureValid: s.serverSignatureValid,
    linkageValid: s.linkageValid,
    ownerConsentValid: s.ownerConsentValid,
    spv: s.spv,
  }
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
 *
 * This is supplied-history verification and nothing more: it says whether the
 * states handed to it form a valid chain, not that the last one is the current
 * tip, that its genesis was authorised, or that the attestation rail was
 * checked. `verifyPassportEvidence` (evidence.ts) is the report that keeps
 * those findings apart; this function keeps its one Boolean for the callers
 * that mean exactly what it says.
 */
export async function verifyChain(
  txs: Transaction[],
  options: VerifyChainOptions = {}
): Promise<ChainVerifyResult> {
  // 'verified' is a claim that every mined state proved against block headers,
  // and a failed chain never makes it, whatever its proofs said. It used to:
  // first because the summary read only `anyPending`, then because it guarded
  // a flag that only an SPV failure set, so a chain failing on a signature or
  // on linkage - every proof good - still came back
  // `{ valid: false, spv: 'verified' }`, and a consumer showing the two
  // separately printed "inclusion proved" beside "did not check out". The
  // failure path now says 'pending' outright; the per-state truth, including
  // 'failed' where a proof was refuted, stays in `states`.
  if (txs.length === 0) return { valid: false, spv: 'pending', states: [], error: 'empty chain' }

  const inspection = await inspectChain(txs, options)
  const states = inspection.states.map(toStateCheck)
  const unavailable = inspection.spvUnavailable == null ? {} : { spvUnavailable: inspection.spvUnavailable }
  if (inspection.failure != null) {
    return { valid: false, spv: 'pending', states, error: inspection.failure.message, ...unavailable }
  }
  return {
    valid: true,
    spv: inspection.anyPending ? 'pending' : 'verified',
    states,
    ...unavailable,
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
