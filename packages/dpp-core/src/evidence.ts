import { Hash, LockingScript, Transaction, Utils, type ChainTracker } from '@bsv/sdk'
import { inspectAttestationAnchor, type AnchorMetadata } from './anchor.js'
import {
  LIFECYCLE_MEDIA_TYPE,
  LIFECYCLE_REPRESENTATION,
  lifecycleClaimDigest,
  verifyLifecycleClaim,
  type SignedLifecycleClaim,
} from './attestation.js'
import { didKeyFromIdentityKey } from './did.js'
import { inspectChain, type ChainInspection, type StateInspection } from './verifyChain.js'
import { verifyPolicyChain, type PublisherPolicy } from './publisherPolicy.js'

/**
 * The one verification contract (`spec/verification.md`): sixteen named checks,
 * four answers each, an independently expected subject and an observation of
 * the latest state that is never a proof. `verifyChain` stays the verifier of
 * supplied history; this is the report every surface produces from it and
 * from the attestation, anchor and credential rails beside it.
 *
 * The core is dependency-light, so the pieces that need a proof suite, a
 * status list or an authority registry arrive through the policy as
 * functions. A caller that supplies none gets `unknown` on those checks, with
 * a reason that says why, which is the contract's whole point: nothing is
 * passed because it was not looked at.
 */

export const REPORT_VERSION = '1' as const

export const EVIDENCE_CHECK_NAMES = [
  'recordEncoding',
  'actorSignatures',
  'publisherSignatures',
  'linkage',
  'inclusion',
  'nativeAttestationSignature',
  'anchorSignature',
  'anchorKeyDerivation',
  'anchorDigestAndMetadataBinding',
  'externalCredentialProof',
  'subjectBinding',
  'issuerAuthority',
  'schema',
  'credentialTime',
  'credentialStatus',
  'evidenceAvailability',
] as const
export type EvidenceCheckName = (typeof EVIDENCE_CHECK_NAMES)[number]
export type CheckStatus = 'pass' | 'fail' | 'unknown' | 'not-applicable'

export interface Outpoint {
  txid: string
  outputIndex: number
}

export interface CheckScope {
  artefact?: string
  digest?: string
  outpoint?: Outpoint
  stateIndex?: number
}

export interface EvidenceCheck {
  name: EvidenceCheckName
  status: CheckStatus
  reasonCode?: string
  evidenceRefs: string[]
  scope?: CheckScope
  detail?: unknown
}

export interface ExpectedSubject {
  passportId: string
  source: 'request-context' | 'established-binding' | 'none'
  productIdentifier?: string
  expectedIssuer?: string
  expectedGenesisOutpoint?: Outpoint
  expectedStateOutpoint?: Outpoint
}

export type ObservationKind = 'overlay-lookup' | 'spend-status' | 'header-source' | 'registry' | 'other'
export type ObservationResult = 'unspent' | 'spent' | 'not-found' | 'unavailable' | 'conflicting'

export interface ObservationSource {
  id: string
  kind: ObservationKind
  observedAt: string
  result: ObservationResult
  height?: number
  blockHash?: string
  spendingTxid?: string
  detail?: string
}

export interface Observations {
  latestState: 'observed' | 'superseded' | 'conflicting' | 'unknown'
  sources: ObservationSource[]
  queryScope: string
  observedAt: string
  candidateOutpoints: Outpoint[]
}

export interface EvidenceReport {
  reportVersion: typeof REPORT_VERSION
  checkedAt: string
  expectedSubject: ExpectedSubject
  suppliedTip: Outpoint | null
  policyId: string
  checks: EvidenceCheck[]
  observations: Observations
  limits: string[]
}

/** An anchor output as evidence: the script, where it sits, and the bytes it commits to when the caller has them. */
export interface AnchorEvidence {
  lockingScript: LockingScript | string
  txid?: string
  outputIndex?: number
  /** The complete secured representation, as bytes or as the exact UTF-8 string. */
  securedBytes?: number[] | string
}

/** A credential in a non-native representation, as the exact bytes that were issued. */
export interface ExternalCredentialEvidence {
  representation: string
  mediaType?: string
  bytes: number[] | string
}

export interface PassportEvidence {
  /** The token history, genesis first, as `chainFromBeef` orders it. */
  tokenHistory?: Transaction[]
  /**
   * Other histories supplied under the same passport identifier: a second
   * genesis is two candidates, not one winner (`spec/verification.md` §3).
   */
  alternativeHistories?: Transaction[][]
  nativeClaims?: unknown[]
  anchors?: AnchorEvidence[]
  externalCredentials?: ExternalCredentialEvidence[]
}

/** A check's answer from a pluggable verifier, before the report names and orders it. */
export interface PartialCheck {
  status: CheckStatus
  reasonCode?: string
  evidenceRefs?: string[]
  detail?: unknown
}

/** What a representation-specific verifier reports for one credential. */
export interface ExternalCredentialVerification {
  /** The credential's own identifier, when its representation defines one. */
  id?: string
  issuer?: string
  /** Every subject identifier the credential names; the anchor's `subject` must be one of them. */
  subjects?: string[]
  /** The type the anchor's `attestationType` must carry for this credential. */
  attestationType?: string
  proof: PartialCheck
  schema: PartialCheck
  time: PartialCheck
  status: PartialCheck
  authority: PartialCheck
  /** Whether every artefact the credential referenced (status list, DID document, predecessor) was available. */
  availability?: PartialCheck
}

export type ExternalCredentialVerifier = (input: {
  representation: string
  mediaType?: string
  bytes: number[]
  digest: string
  checkedAt: string
}) => Promise<ExternalCredentialVerification>

export interface AuthorityQuestion {
  role: 'genesis-issuer' | 'lifecycle-claimant' | 'anchoring-service'
  /** The identity as the evidence names it: a compressed key for native roles, a DID for claims. */
  identity: string
  at?: string
  ref: string
}

export type AuthorityPolicy =
  | { required: false; reason: string }
  | {
      required: true
      /** Identity keys (hex) or did:key strings permitted to write a genesis state. */
      genesisIssuers?: string[]
      /** Issuer DIDs permitted to sign native lifecycle claims. */
      claimIssuers?: string[]
      /** Anchoring service identity keys whose anchors this policy accepts. */
      anchoringServices?: string[]
      /** Verifies a role the lists above do not settle, on evidence the policy names. */
      verify?: (question: AuthorityQuestion) => Promise<PartialCheck>
    }

export interface LatestStateObserver {
  id: string
  kind: ObservationKind
  observe: (input: { passportId: string; tip: Outpoint | null }) => Promise<{
    result: ObservationResult
    height?: number
    blockHash?: string
    spendingTxid?: string
    detail?: string
    candidateOutpoints?: Outpoint[]
  }>
}

export interface EvidencePolicy {
  policyId?: string
  /** Publisher identity keys any one of which may have countersigned a state. None, and no `publisherPolicy`, means the check is not selected. */
  publisherKeys?: string[]
  /**
   * A publisher key policy chain with the operator identity keys it is
   * verified against (`spec/services.md` §1). The chain is verified first; if
   * it does not hold, `publisherSignatures` is unknown with
   * `publisher-policy-invalid` and no key from it is trusted. When it holds,
   * each state is checked against the keys active at its own timestamp, and a
   * countersignature by a policy key outside its window fails with
   * `publisher-not-authorised`.
   */
  publisherPolicy?: { chain: PublisherPolicy[]; operatorIdentityKeys: Record<string, string> }
  ownerConsent?: boolean | { authorities: string[] }
  chainTracker?: ChainTracker | 'scripts only'
  authority?: AuthorityPolicy
  credentialVerifier?: ExternalCredentialVerifier
  /** Validates a native claim's payload against its declared profile and version; absent means `schema` is unknown for native claims. */
  profileValidator?: (claim: SignedLifecycleClaim) => Promise<PartialCheck>
  observers?: LatestStateObserver[]
  /** The observation time, injected for reproducibility. Defaults to now. */
  checkedAt?: string
}

const outpointRef = (o: Outpoint): string => `${o.txid}:${o.outputIndex}`
const digestRef = (hex: string): string => `sha256:${hex}`
const sameOutpoint = (a: Outpoint, b: Outpoint): boolean => a.txid === b.txid && a.outputIndex === b.outputIndex

function toBytes(value: number[] | string): number[] {
  return typeof value === 'string' ? Utils.toArray(value, 'utf8') : value
}

function check(name: EvidenceCheckName, status: CheckStatus, reasonCode?: string, evidenceRefs: string[] = [], extra: Partial<EvidenceCheck> = {}): EvidenceCheck {
  return { name, status, ...(reasonCode == null ? {} : { reasonCode }), evidenceRefs, ...extra }
}

/** Combine several partial answers into one: a failure outranks an unknown, an unknown outranks a pass. */
function combine(name: EvidenceCheckName, parts: PartialCheck[], empty: EvidenceCheck): EvidenceCheck {
  if (parts.length === 0) return empty
  const refs = [...new Set(parts.flatMap((p) => p.evidenceRefs ?? []))]
  const details = parts.map((p) => p.detail).filter((d) => d !== undefined)
  const pick = (status: CheckStatus): PartialCheck | undefined => parts.find((p) => p.status === status)
  const worst = pick('fail') ?? pick('unknown') ?? (parts.every((p) => p.status === 'not-applicable') ? pick('not-applicable') : undefined)
  if (worst != null) {
    return check(name, worst.status, worst.reasonCode ?? 'x-unspecified', refs, details.length > 0 ? { detail: details } : {})
  }
  return check(name, 'pass', undefined, refs, details.length > 0 ? { detail: details } : {})
}

interface TokenFindings {
  inspection?: ChainInspection
  tip: Outpoint | null
  genesis?: StateInspection
  checks: EvidenceCheck[]
}

function tokenChecks(txs: Transaction[] | undefined, inspection: ChainInspection | undefined, policy: EvidencePolicy): TokenFindings {
  const names: EvidenceCheckName[] = ['recordEncoding', 'actorSignatures', 'publisherSignatures', 'linkage', 'inclusion']
  const publisherSelected = (policy.publisherKeys ?? []).length > 0 || policy.publisherPolicy != null
  if (txs == null || txs.length === 0 || inspection == null) {
    return {
      tip: null,
      checks: names.map((n) =>
        n === 'publisherSignatures' && !publisherSelected
          ? check(n, 'not-applicable', 'publisher-not-selected')
          : check(n, 'unknown', 'no-evidence')
      ),
    }
  }
  const states = inspection.states
  const refs = states.map((s) => outpointRef({ txid: s.txid, outputIndex: s.outputIndex }))
  const perState = states.map((s) => ({
    index: s.index,
    txid: s.txid,
    op: s.op,
    userSignatureValid: s.userSignatureValid,
    serverSignatureValid: s.serverSignatureValid,
    linkageValid: s.linkageValid,
    ownerConsentValid: s.ownerConsentValid,
    spv: s.spv,
    ...(s.spvReason == null ? {} : { spvReason: s.spvReason }),
  }))
  const failure = inspection.failure
  // The inspection evaluates every check on a state before stopping at it, so
  // the states nobody looked at are the ones after the failing index; a
  // transaction that yielded no state was looked at and could not be checked.
  const inspectedCount = failure?.kind === 'encoding' ? failure.index + 1 : states.length
  const uninspected = inspectedCount < txs.length
  /** A check that held on every inspected state: pass when every supplied state was inspected, otherwise unknown. */
  const heldOrNotInspected = (name: EvidenceCheckName): EvidenceCheck =>
    failure?.kind === 'encoding'
      ? check(name, 'unknown', 'decode-failed', refs, { detail: perState, scope: { stateIndex: failure.index } })
      : uninspected
        ? check(name, 'unknown', 'not-inspected', refs, { detail: perState, scope: failure == null ? {} : { stateIndex: failure.index } })
        : check(name, 'pass', undefined, refs, { detail: perState })

  const encoding =
    failure?.kind === 'encoding'
      ? check('recordEncoding', 'fail', 'decode-failed', [...refs, failure.txid], { scope: { stateIndex: failure.index }, detail: failure.message })
      : heldOrNotInspected('recordEncoding')

  const actor =
    failure?.kind === 'userSignature'
      ? check('actorSignatures', 'fail', 'signature-invalid', refs, { scope: { stateIndex: failure.index }, detail: perState })
      : heldOrNotInspected('actorSignatures')

  const publisher = !publisherSelected
    ? check('publisherSignatures', 'not-applicable', 'publisher-not-selected', [])
    : failure?.kind === 'serverSignature'
      ? check('publisherSignatures', 'fail', states[failure.index]?.publisherOutsideWindow ? 'publisher-not-authorised' : 'signature-invalid', refs, { scope: { stateIndex: failure.index }, detail: perState })
      : heldOrNotInspected('publisherSignatures')

  const linkage =
    failure?.kind === 'linkage'
      ? check('linkage', 'fail', 'link-broken', refs, { scope: { stateIndex: failure.index }, detail: failure.message })
      : failure?.kind === 'consent'
        ? check('linkage', 'fail', 'consent-not-proven', refs, { scope: { stateIndex: failure.index }, detail: failure.message })
        : heldOrNotInspected('linkage')

  let inclusion: EvidenceCheck
  if (failure?.kind === 'inclusion') {
    inclusion = check('inclusion', 'fail', 'proof-refuted', refs, { scope: { stateIndex: failure.index }, detail: failure.message })
  } else if (failure?.kind === 'encoding') {
    inclusion = check('inclusion', 'unknown', 'decode-failed', refs, { scope: { stateIndex: failure.index }, detail: perState })
  } else if (uninspected) {
    inclusion = check('inclusion', 'unknown', 'not-inspected', refs, { detail: perState })
  } else if (states.some((s) => s.spvReason === 'header-source-unavailable')) {
    inclusion = check('inclusion', 'unknown', 'header-source-unavailable', refs, { detail: inspection.spvUnavailable ?? perState })
  } else if (states.some((s) => s.spvReason === 'no-proof')) {
    inclusion = check('inclusion', 'unknown', 'proof-absent', refs, { detail: perState })
  } else if (states.some((s) => s.spvReason === 'header-check-disabled')) {
    inclusion = check('inclusion', 'unknown', 'not-selected', refs, { detail: perState })
  } else {
    inclusion = check('inclusion', 'pass', undefined, refs, { detail: perState })
  }

  const last = states.at(-1)
  return {
    inspection,
    tip: last == null ? null : { txid: last.txid, outputIndex: last.outputIndex },
    genesis: states[0],
    checks: [encoding, actor, publisher, linkage, inclusion],
  }
}

interface NativeFindings {
  claims: Array<{ claim: SignedLifecycleClaim; digest: string; issuerKey?: string; ref: string }>
  invalid: Array<{ index: number; reason: string }>
}

function inspectNativeClaims(claims: unknown[] | undefined): NativeFindings {
  const findings: NativeFindings = { claims: [], invalid: [] }
  for (const [index, value] of (claims ?? []).entries()) {
    // Subject binding is its own check; the signature check must not fail a
    // claim for naming another product, so no expectation is passed here.
    const result = verifyLifecycleClaim(value)
    if (result.signature !== 'verified') {
      findings.invalid.push({ index, reason: result.reason ?? 'native claim signature does not verify' })
      continue
    }
    const claim = value as SignedLifecycleClaim
    const digest = lifecycleClaimDigest(claim)
    findings.claims.push({ claim, digest, issuerKey: result.issuerKey, ref: digestRef(digest) })
  }
  return findings
}

interface AnchorFinding {
  index: number
  ref: string
  metadata?: AnchorMetadata
  keyDerivationValid: boolean | null
  signatureValid: boolean | null
  failure?: string
  securedBytes?: number[]
}

function inspectAnchors(anchors: AnchorEvidence[] | undefined): AnchorFinding[] {
  return (anchors ?? []).map((anchor, index) => {
    // A script that is not even hex is evidence that fails, not an exception:
    // the finding carries the reason and the report stays a report.
    let script: LockingScript | undefined
    let parseFailure: string | undefined
    try {
      script = typeof anchor.lockingScript === 'string' ? LockingScript.fromHex(anchor.lockingScript) : anchor.lockingScript
    } catch {
      parseFailure = 'lockingScript is not hex'
    }
    const inspection = script == null
      ? { metadata: undefined, keyDerivationValid: null, signatureValid: null, failure: parseFailure }
      : inspectAttestationAnchor(script)
    const ref = anchor.txid != null && anchor.outputIndex != null ? outpointRef({ txid: anchor.txid, outputIndex: anchor.outputIndex }) : `anchor:${index}`
    return {
      index,
      ref,
      metadata: inspection.metadata,
      keyDerivationValid: inspection.keyDerivationValid,
      signatureValid: inspection.signatureValid,
      failure: inspection.failure,
      ...(anchor.securedBytes == null ? {} : { securedBytes: toBytes(anchor.securedBytes) }),
    }
  })
}

function observe(policy: EvidencePolicy, passportId: string, tip: Outpoint | null, alternativeTips: Outpoint[], checkedAt: string): Promise<Observations> {
  const observers = policy.observers ?? []
  return Promise.all(
    observers.map(async (observer): Promise<ObservationSource & { candidateOutpoints: Outpoint[] }> => {
      try {
        const answer = await observer.observe({ passportId, tip })
        return {
          id: observer.id,
          kind: observer.kind,
          observedAt: checkedAt,
          result: answer.result,
          ...(answer.height == null ? {} : { height: answer.height }),
          ...(answer.blockHash == null ? {} : { blockHash: answer.blockHash }),
          ...(answer.spendingTxid == null ? {} : { spendingTxid: answer.spendingTxid }),
          ...(answer.detail == null ? {} : { detail: answer.detail }),
          candidateOutpoints: answer.candidateOutpoints ?? [],
        }
      } catch (cause) {
        return {
          id: observer.id,
          kind: observer.kind,
          observedAt: checkedAt,
          result: 'unavailable',
          detail: cause instanceof Error ? cause.message : String(cause),
          candidateOutpoints: [],
        }
      }
    })
  ).then((answers) => {
    const candidates: Outpoint[] = []
    const add = (o: Outpoint): void => {
      if (!candidates.some((c) => sameOutpoint(c, o))) candidates.push(o)
    }
    if (tip != null) add(tip)
    alternativeTips.forEach(add)
    answers.forEach((a) => a.candidateOutpoints.forEach(add))
    const answered = answers.filter((a) => a.result !== 'unavailable')
    let latestState: Observations['latestState']
    if (alternativeTips.length > 0 || answers.some((a) => a.result === 'conflicting')) latestState = 'conflicting'
    else if (answered.length === 0) latestState = 'unknown'
    else if (answered.some((a) => a.result === 'spent')) {
      latestState = answered.every((a) => a.result === 'spent') ? 'superseded' : 'conflicting'
    } else if (answered.every((a) => a.result === 'unspent')) latestState = 'observed'
    else latestState = 'conflicting'
    return {
      latestState,
      sources: answers.map(({ candidateOutpoints: _c, ...source }) => source),
      queryScope: observers.length === 0 ? 'no source asked' : `${observers.map((o) => `${o.kind} ${o.id}`).join(', ')} asked for ${passportId}`,
      observedAt: checkedAt,
      candidateOutpoints: candidates,
    }
  })
}

/**
 * Evaluate the evidence for one passport and report it as `spec/verification.md`
 * requires. Never throws for evidence that fails: every failure is a check with
 * a reason. It throws only for a caller error, such as a malformed policy key.
 */
export async function verifyPassportEvidence(
  evidence: PassportEvidence,
  expected: ExpectedSubject,
  policy: EvidencePolicy = {}
): Promise<EvidenceReport> {
  const checkedAt = policy.checkedAt ?? new Date().toISOString()
  const policyId = policy.policyId ?? 'none'
  const limits: string[] = [
    'Supplied-history validity does not establish current ownership, an authorised genesis or the absence of later states.',
    'An anchor establishes its anchoring service\'s commitment to bytes, not the truth of the claim those bytes carry.',
  ]

  // The publisher policy is verified before any key in it is trusted. A chain
  // that does not hold selects the check (the caller asked for it) and leaves
  // it unknown: no key is trusted, and none is called a stranger either.
  const policyChain = policy.publisherPolicy == null ? undefined : verifyPolicyChain(policy.publisherPolicy.chain, policy.publisherPolicy.operatorIdentityKeys)
  const verifiedPolicyChain = policyChain?.ok === true ? policy.publisherPolicy!.chain : undefined
  const policyFailure = policyChain != null && !policyChain.ok ? policyChain.failure : undefined

  // The token rail, and the alternative histories that make a genesis ambiguous.
  const txs = evidence.tokenHistory
  const inspection = txs != null && txs.length > 0 ? await inspectChain(txs, { chainTracker: policy.chainTracker, publisherKeys: policy.publisherKeys, publisherPolicy: verifiedPolicyChain, ownerConsent: policy.ownerConsent }) : undefined
  const token = tokenChecks(txs, inspection, policy)
  if (policyFailure != null) {
    const at = token.checks.findIndex((c) => c.name === 'publisherSignatures')
    if (at >= 0) token.checks[at] = check('publisherSignatures', 'unknown', 'publisher-policy-invalid', [], { detail: `publisher policy version ${policyFailure.version}: ${policyFailure.reason}, ${policyFailure.detail}` })
  }
  const alternatives: Array<{ inspection: ChainInspection; tip: Outpoint | null }> = []
  for (const history of evidence.alternativeHistories ?? []) {
    if (history.length === 0) continue
    const alt = await inspectChain(history, { chainTracker: policy.chainTracker, publisherKeys: policy.publisherKeys, publisherPolicy: verifiedPolicyChain, ownerConsent: policy.ownerConsent })
    const last = alt.states.at(-1)
    alternatives.push({ inspection: alt, tip: last == null ? null : { txid: last.txid, outputIndex: last.outputIndex } })
  }
  const validAlternatives = alternatives.filter((a) => a.inspection.complete && a.inspection.states[0]?.state.passportId === expected.passportId)

  // The attestation and anchor rails.
  const native = inspectNativeClaims(evidence.nativeClaims)
  const anchors = inspectAnchors(evidence.anchors)
  const nativeRefs = native.claims.map((c) => c.ref)
  const nativeAttestationSignature =
    (evidence.nativeClaims ?? []).length === 0
      ? check('nativeAttestationSignature', 'unknown', 'no-evidence')
      : native.invalid.length > 0
        ? check('nativeAttestationSignature', 'fail', 'signature-invalid', nativeRefs, { detail: native.invalid })
        : check('nativeAttestationSignature', 'pass', undefined, nativeRefs)

  const anchorRefs = anchors.map((a) => a.ref)
  const anchorSignature =
    anchors.length === 0
      ? check('anchorSignature', 'unknown', 'no-evidence')
      : anchors.some((a) => a.metadata == null)
        ? check('anchorSignature', 'fail', 'decode-failed', anchorRefs, { detail: anchors.filter((a) => a.metadata == null).map((a) => ({ ref: a.ref, failure: a.failure })) })
        : anchors.some((a) => a.signatureValid !== true)
          ? check('anchorSignature', 'fail', 'signature-invalid', anchorRefs, { detail: anchors.filter((a) => a.signatureValid !== true).map((a) => a.ref) })
          : check('anchorSignature', 'pass', undefined, anchorRefs)
  const anchorKeyDerivation =
    anchors.length === 0
      ? check('anchorKeyDerivation', 'unknown', 'no-evidence')
      : anchors.some((a) => a.metadata == null)
        ? check('anchorKeyDerivation', 'unknown', 'decode-failed', anchorRefs)
        : anchors.some((a) => a.keyDerivationValid !== true)
          ? check('anchorKeyDerivation', 'fail', 'key-derivation-mismatch', anchorRefs, { detail: anchors.filter((a) => a.keyDerivationValid !== true).map((a) => a.ref) })
          : check('anchorKeyDerivation', 'pass', undefined, anchorRefs)

  // Secured representations: the bytes an anchor commits to, from the anchor
  // itself, from a supplied credential, or from a supplied native claim.
  const externals = (evidence.externalCredentials ?? []).map((c, index) => {
    const bytes = toBytes(c.bytes)
    return { index, representation: c.representation, mediaType: c.mediaType, bytes, digest: Utils.toHex(Hash.sha256(bytes)) }
  })
  const bytesByDigest = new Map<string, { bytes: number[]; representation?: string }>()
  for (const ext of externals) bytesByDigest.set(ext.digest, { bytes: ext.bytes, representation: ext.representation })
  for (const anchor of anchors) {
    if (anchor.securedBytes != null) bytesByDigest.set(Utils.toHex(Hash.sha256(anchor.securedBytes)), { bytes: anchor.securedBytes })
  }

  // Credential verification runs once per distinct byte string, and its answers
  // serve both the anchor binding and the credential checks.
  const verifications = new Map<string, ExternalCredentialVerification>()
  const credentialInputs = new Map<string, { representation: string; mediaType?: string; bytes: number[] }>()
  for (const ext of externals) credentialInputs.set(ext.digest, { representation: ext.representation, mediaType: ext.mediaType, bytes: ext.bytes })
  // An anchor that declares an external representation and arrives without
  // its bytes is a missing input: the proof check is unknown for it, never
  // not-applicable (spec/verification.md section 4).
  const proofExtras: PartialCheck[] = []
  for (const anchor of anchors) {
    if (anchor.metadata == null) continue
    if (anchor.metadata.representation === LIFECYCLE_REPRESENTATION) continue
    if (anchor.securedBytes == null) {
      proofExtras.push({ status: 'unknown', reasonCode: 'secured-bytes-absent', evidenceRefs: [anchor.ref, digestRef(anchor.metadata.digest)], detail: `anchor ${anchor.ref} declares ${anchor.metadata.representation} and its bytes were not supplied` })
      continue
    }
    const digest = Utils.toHex(Hash.sha256(anchor.securedBytes))
    if (!credentialInputs.has(digest)) credentialInputs.set(digest, { representation: anchor.metadata.representation, mediaType: anchor.metadata.mediaType, bytes: anchor.securedBytes })
  }
  if (policy.credentialVerifier != null) {
    for (const [digest, input] of credentialInputs) {
      try {
        verifications.set(digest, await policy.credentialVerifier({ ...input, digest, checkedAt }))
      } catch (cause) {
        const failed: PartialCheck = { status: 'unknown', reasonCode: 'verifier-not-supplied', detail: cause instanceof Error ? cause.message : String(cause) }
        verifications.set(digest, { proof: failed, schema: failed, time: failed, status: failed, authority: failed })
      }
    }
  }

  const bindingParts: PartialCheck[] = []
  const unavailableRefs: string[] = []
  for (const anchor of anchors) {
    const meta = anchor.metadata
    if (meta == null) continue
    const ref = anchor.ref
    const scopeRefs = [ref, digestRef(meta.digest)]
    if (meta.representation === LIFECYCLE_REPRESENTATION) {
      const claim = native.claims.find((c) => c.digest === meta.digest)
      const bytes = anchor.securedBytes
      if (claim == null && bytes == null) {
        unavailableRefs.push(digestRef(meta.digest))
        bindingParts.push({ status: 'unknown', reasonCode: 'secured-bytes-absent', evidenceRefs: scopeRefs })
        continue
      }
      if (claim == null && bytes != null) {
        // Bytes supplied for a native anchor must themselves be a signed claim.
        let parsed: unknown
        try { parsed = JSON.parse(Utils.toUTF8(bytes)) } catch { parsed = undefined }
        const result = parsed === undefined ? undefined : verifyLifecycleClaim(parsed)
        if (result?.signature !== 'verified') {
          bindingParts.push({ status: 'fail', reasonCode: 'digest-mismatch', evidenceRefs: scopeRefs, detail: 'supplied bytes are not a verified native claim with this digest' })
          continue
        }
        const digest = lifecycleClaimDigest(parsed as SignedLifecycleClaim)
        if (digest !== meta.digest) {
          bindingParts.push({ status: 'fail', reasonCode: 'digest-mismatch', evidenceRefs: [...scopeRefs, digestRef(digest)] })
          continue
        }
        native.claims.push({ claim: parsed as SignedLifecycleClaim, digest, issuerKey: result.issuerKey, ref: digestRef(digest) })
      }
      const bound = native.claims.find((c) => c.digest === meta.digest)!
      const mismatches: string[] = []
      if (meta.issuer !== bound.claim.issuer) mismatches.push('issuer')
      if (meta.subject !== bound.claim.passportId) mismatches.push('subject')
      if (meta.attestationType !== bound.claim.eventType) mismatches.push('attestationType')
      if (meta.mediaType !== LIFECYCLE_MEDIA_TYPE) mismatches.push('mediaType')
      bindingParts.push(
        mismatches.length === 0
          ? { status: 'pass', evidenceRefs: scopeRefs }
          : { status: 'fail', reasonCode: 'metadata-mismatch', evidenceRefs: scopeRefs, detail: mismatches }
      )
      continue
    }
    const supplied = bytesByDigest.get(meta.digest)
    const bytes = anchor.securedBytes ?? supplied?.bytes
    if (bytes == null || bytes.length === 0) {
      unavailableRefs.push(digestRef(meta.digest))
      bindingParts.push({ status: 'unknown', reasonCode: 'secured-bytes-absent', evidenceRefs: scopeRefs })
      continue
    }
    const digest = Utils.toHex(Hash.sha256(bytes))
    if (digest !== meta.digest) {
      bindingParts.push({ status: 'fail', reasonCode: 'digest-mismatch', evidenceRefs: [...scopeRefs, digestRef(digest)] })
      continue
    }
    const verified = verifications.get(digest)
    if (verified == null) {
      bindingParts.push({ status: 'unknown', reasonCode: policy.credentialVerifier == null ? 'representation-unsupported' : 'verifier-not-supplied', evidenceRefs: scopeRefs, detail: meta.representation })
      continue
    }
    if (verified.proof.status !== 'pass') {
      bindingParts.push({ status: 'unknown', reasonCode: 'referenced-artefact-mismatch', evidenceRefs: scopeRefs, detail: 'the committed credential did not verify, so its metadata cannot be compared' })
      continue
    }
    const mismatches: string[] = []
    if (verified.issuer != null && meta.issuer !== verified.issuer) mismatches.push('issuer')
    if (verified.subjects != null && !verified.subjects.includes(meta.subject)) mismatches.push('subject')
    if (verified.attestationType != null && meta.attestationType !== verified.attestationType) mismatches.push('attestationType')
    if (verified.id != null && meta.attestationId !== verified.id) mismatches.push('attestationId')
    bindingParts.push(
      mismatches.length === 0
        ? { status: 'pass', evidenceRefs: scopeRefs }
        : { status: 'fail', reasonCode: 'metadata-mismatch', evidenceRefs: scopeRefs, detail: mismatches }
    )
  }
  const anchorDigestAndMetadataBinding =
    anchors.length === 0
      ? check('anchorDigestAndMetadataBinding', 'unknown', 'no-evidence')
      : combine('anchorDigestAndMetadataBinding', bindingParts, check('anchorDigestAndMetadataBinding', 'unknown', 'decode-failed', anchorRefs))

  // Credential checks: external credentials through the supplied verifier.
  const credentialParts = (key: keyof Pick<ExternalCredentialVerification, 'proof' | 'schema' | 'time' | 'status' | 'authority'>): PartialCheck[] =>
    [...credentialInputs.keys()].map((digest) => {
      const v = verifications.get(digest)
      if (v == null) return { status: 'unknown', reasonCode: 'verifier-not-supplied', evidenceRefs: [digestRef(digest)] }
      return { ...v[key], evidenceRefs: [digestRef(digest), ...(v[key].evidenceRefs ?? [])] }
    })
  const externalCredentialProof =
    credentialInputs.size === 0 && proofExtras.length === 0
      ? check('externalCredentialProof', 'not-applicable', 'no-external-credential')
      : combine('externalCredentialProof', [...credentialParts('proof'), ...proofExtras], check('externalCredentialProof', 'unknown', 'verifier-not-supplied'))

  // Subject binding, from an expectation the evidence did not supply.
  const subjectRefs: string[] = []
  let subjectBinding: EvidenceCheck
  if (expected.source === 'none') {
    subjectBinding = check('subjectBinding', 'unknown', 'subject-not-independent')
    limits.push('The subject was taken from the evidence itself, so no check can establish that the evidence concerns the passport the reader asked about.')
  } else {
    const problems: Array<{ reasonCode: string; detail: string }> = []
    for (const s of token.inspection?.states ?? []) {
      subjectRefs.push(outpointRef({ txid: s.txid, outputIndex: s.outputIndex }))
      if (s.state.passportId !== expected.passportId) problems.push({ reasonCode: 'subject-mismatch', detail: `state ${s.index} names ${s.state.passportId}` })
    }
    if (token.genesis != null) {
      const genesisOutpoint = { txid: token.genesis.txid, outputIndex: token.genesis.outputIndex }
      if (expected.expectedGenesisOutpoint != null && !sameOutpoint(expected.expectedGenesisOutpoint, genesisOutpoint)) {
        problems.push({ reasonCode: 'genesis-mismatch', detail: `genesis is ${outpointRef(genesisOutpoint)}, expected ${outpointRef(expected.expectedGenesisOutpoint)}` })
      }
      if (expected.expectedIssuer != null) {
        const actorKey = token.genesis.state.actorIdentityKey
        const names = [actorKey, didKeyFromIdentityKey(actorKey)]
        if (!names.includes(expected.expectedIssuer)) problems.push({ reasonCode: 'issuer-mismatch', detail: `genesis actor is ${names[1]}` })
      }
    }
    if (expected.expectedStateOutpoint != null && token.tip != null && !sameOutpoint(expected.expectedStateOutpoint, token.tip)) {
      problems.push({ reasonCode: 'state-mismatch', detail: `supplied tip is ${outpointRef(token.tip)}, expected ${outpointRef(expected.expectedStateOutpoint)}` })
    }
    for (const c of native.claims) {
      subjectRefs.push(c.ref)
      if (c.claim.passportId !== expected.passportId) problems.push({ reasonCode: 'subject-mismatch', detail: `native claim ${c.ref} names ${c.claim.passportId}` })
      if (expected.expectedIssuer != null && c.claim.issuer !== expected.expectedIssuer && c.claim.issuerKeyDid !== expected.expectedIssuer) {
        problems.push({ reasonCode: 'issuer-mismatch', detail: `native claim ${c.ref} is issued by ${c.claim.issuer}` })
      }
    }
    for (const a of anchors) {
      if (a.metadata == null) continue
      subjectRefs.push(a.ref)
      const accepted = [expected.passportId, ...(expected.productIdentifier == null ? [] : [expected.productIdentifier])]
      if (!accepted.includes(a.metadata.subject)) problems.push({ reasonCode: 'subject-mismatch', detail: `anchor ${a.ref} names ${a.metadata.subject}` })
    }
    for (const [digest, v] of verifications) {
      subjectRefs.push(digestRef(digest))
      const accepted = [expected.passportId, ...(expected.productIdentifier == null ? [] : [expected.productIdentifier])]
      if (v.subjects != null && !v.subjects.some((s) => accepted.includes(s))) problems.push({ reasonCode: 'subject-mismatch', detail: `credential ${digestRef(digest)} names ${v.subjects.join(', ')}` })
    }
    if (validAlternatives.length > 0 && expected.expectedGenesisOutpoint == null) {
      problems.push({ reasonCode: 'genesis-ambiguous', detail: `${validAlternatives.length + 1} valid genesis records carry this passport identifier` })
    }
    if (subjectRefs.length === 0) subjectBinding = check('subjectBinding', 'unknown', 'no-evidence')
    else if (problems.length === 0) subjectBinding = check('subjectBinding', 'pass', undefined, subjectRefs)
    else {
      const ambiguous = problems.every((p) => p.reasonCode === 'genesis-ambiguous')
      subjectBinding = check('subjectBinding', ambiguous ? 'unknown' : 'fail', problems[0].reasonCode, subjectRefs, { detail: problems })
    }
  }

  // Authority, role by role, on the policy's lists or verifier.
  let issuerAuthority: EvidenceCheck
  const authorityRefs = [...subjectRefs]
  if (policy.authority == null) {
    issuerAuthority = check('issuerAuthority', 'unknown', 'policy-missing')
  } else if (!policy.authority.required) {
    issuerAuthority = check('issuerAuthority', 'not-applicable', 'authority-not-required', [], { detail: policy.authority.reason })
  } else {
    const auth = policy.authority
    const questions: AuthorityQuestion[] = []
    if (token.genesis != null) {
      questions.push({ role: 'genesis-issuer', identity: token.genesis.state.actorIdentityKey, at: token.genesis.state.timestamp, ref: outpointRef({ txid: token.genesis.txid, outputIndex: token.genesis.outputIndex }) })
    }
    for (const c of native.claims) questions.push({ role: 'lifecycle-claimant', identity: c.claim.issuer, at: c.claim.timestamp, ref: c.ref })
    for (const a of anchors) if (a.metadata != null) questions.push({ role: 'anchoring-service', identity: a.metadata.anchoredBy, ref: a.ref })
    const parts: PartialCheck[] = []
    for (const q of questions) {
      const list = q.role === 'genesis-issuer' ? auth.genesisIssuers : q.role === 'lifecycle-claimant' ? auth.claimIssuers : auth.anchoringServices
      if (list != null) {
        const names = q.role === 'genesis-issuer' ? [q.identity, didKeyFromIdentityKey(q.identity)] : [q.identity]
        parts.push(names.some((n) => list.includes(n)) ? { status: 'pass', evidenceRefs: [q.ref, policyId] } : { status: 'fail', reasonCode: 'authority-unconfirmed', evidenceRefs: [q.ref], detail: `${q.role} ${q.identity} is not permitted by ${policyId}` })
      } else if (auth.verify != null) {
        try {
          parts.push({ ...(await auth.verify(q)), evidenceRefs: [q.ref] })
        } catch (cause) {
          parts.push({ status: 'unknown', reasonCode: 'authority-unavailable', evidenceRefs: [q.ref], detail: cause instanceof Error ? cause.message : String(cause) })
        }
      } else {
        parts.push({ status: 'unknown', reasonCode: 'authority-unconfirmed', evidenceRefs: [q.ref], detail: `${policyId} names no authority for ${q.role}` })
      }
    }
    parts.push(...credentialParts('authority'))
    issuerAuthority = combine('issuerAuthority', parts, check('issuerAuthority', 'unknown', 'no-evidence', authorityRefs))
  }

  // Schema, time and status, across native claims and external credentials.
  const schemaParts: PartialCheck[] = []
  for (const c of native.claims) {
    if (policy.profileValidator == null) schemaParts.push({ status: 'unknown', reasonCode: 'schema-unavailable', evidenceRefs: [c.ref], detail: `${c.claim.profile}@${c.claim.profile_version}` })
    else {
      try { schemaParts.push({ ...(await policy.profileValidator(c.claim)), evidenceRefs: [c.ref] }) } catch (cause) { schemaParts.push({ status: 'unknown', reasonCode: 'schema-unavailable', evidenceRefs: [c.ref], detail: cause instanceof Error ? cause.message : String(cause) }) }
    }
  }
  schemaParts.push(...credentialParts('schema'))
  const schema = combine('schema', schemaParts, check('schema', 'unknown', 'no-evidence'))

  const timeParts: PartialCheck[] = native.claims.map((c) => ({ status: 'pass', evidenceRefs: [c.ref], detail: c.claim.timestamp }))
  timeParts.push(...credentialParts('time'))
  const credentialTime = combine('credentialTime', timeParts, check('credentialTime', 'unknown', 'no-evidence'))

  const statusParts: PartialCheck[] = native.claims.map((c) => ({ status: 'not-applicable', reasonCode: 'format-defines-no-status', evidenceRefs: [c.ref] }))
  statusParts.push(...credentialParts('status'))
  const credentialStatus = combine('credentialStatus', statusParts, check('credentialStatus', 'unknown', 'no-evidence'))

  // Availability of everything the evidence pointed at.
  const availabilityParts: PartialCheck[] = unavailableRefs.map((ref) => ({ status: 'unknown', reasonCode: 'referenced-artefact-unavailable', evidenceRefs: [ref] }))
  for (const [digest, v] of verifications) if (v.availability != null) availabilityParts.push({ ...v.availability, evidenceRefs: [digestRef(digest), ...(v.availability.evidenceRefs ?? [])] })
  const referenced = [...(token.inspection?.states.map((s) => outpointRef({ txid: s.txid, outputIndex: s.outputIndex })) ?? []), ...anchorRefs, ...nativeRefs]
  const evidenceAvailability =
    referenced.length === 0 && availabilityParts.length === 0
      ? check('evidenceAvailability', 'unknown', 'no-evidence')
      : combine('evidenceAvailability', availabilityParts.length === 0 ? [{ status: 'pass', evidenceRefs: referenced }] : availabilityParts, check('evidenceAvailability', 'pass', undefined, referenced))

  const observations = await observe(policy, expected.passportId, token.tip, validAlternatives.map((a) => a.tip).filter((t): t is Outpoint => t != null), checkedAt)
  if (observations.latestState !== 'unknown') {
    limits.push('The latest-state observation is as fresh and as complete as the sources asked; it is not a proof that no later spend exists.')
  }

  const checks: EvidenceCheck[] = [
    ...token.checks,
    nativeAttestationSignature,
    anchorSignature,
    anchorKeyDerivation,
    anchorDigestAndMetadataBinding,
    externalCredentialProof,
    subjectBinding,
    issuerAuthority,
    schema,
    credentialTime,
    credentialStatus,
    evidenceAvailability,
  ]
  for (const c of checks) {
    if (c.status === 'unknown') limits.push(`${c.name} was not established: ${c.reasonCode ?? 'no reason recorded'}.`)
  }

  return {
    reportVersion: REPORT_VERSION,
    checkedAt,
    expectedSubject: expected,
    suppliedTip: token.tip,
    policyId,
    checks,
    observations,
    limits,
  }
}

/** The short label a surface may show beside a check; the technical name stays in the report. */
export const EVIDENCE_CHECK_LABELS: Record<EvidenceCheckName, string> = {
  recordEncoding: 'Every entry is a well-formed record',
  actorSignatures: 'Every entry was signed by whoever wrote it',
  publisherSignatures: 'Every entry was countersigned by the named publisher',
  linkage: 'No step is missing from the middle',
  inclusion: 'Every entry is in a block',
  nativeAttestationSignature: 'Every lifecycle claim was signed by its issuer',
  anchorSignature: 'Every anchor was signed by its anchoring service',
  anchorKeyDerivation: 'Every anchor is locked to the key its service derives',
  anchorDigestAndMetadataBinding: 'Every anchor commits to the exact bytes and names what they say',
  externalCredentialProof: 'Every credential verifies under its own proof suite',
  subjectBinding: 'Everything concerns the passport that was asked about',
  issuerAuthority: 'Every issuer held the authority the policy requires',
  schema: 'Every payload matches its declared profile',
  credentialTime: 'Every credential is within its validity period',
  credentialStatus: 'No credential is revoked or suspended',
  evidenceAvailability: 'Everything the evidence points at was available',
}
