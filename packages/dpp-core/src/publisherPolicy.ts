/**
 * The publisher key policy (`spec/services.md` §1, `contracts/publisher-policy.schema.json`).
 *
 * The keys that countersign admitted states and anchors are a bounded,
 * versioned set. Each version is a complete statement; a later version names
 * the digest of the one it supersedes and carries an authorisation the
 * superseded version's rules accept. A reader asks which keys were active at
 * a state's time, so a retired key still authenticates what it signed while
 * active and a new key authenticates nothing before its activation.
 *
 * `verifyPolicyChain` checks a chain once; `publisherKeysAt` then answers the
 * time question from the verified chain. Neither trusts a list because a node
 * served it: the chain's own signatures and digests are what is checked.
 *
 * A policy nests objects and arrays, so it uses the canonical JSON of
 * canonicalJson.ts rather than the flat restricted form of native claims.
 */
import { Hash, PublicKey, Signature, Utils } from '@bsv/sdk'
import { canonicalJson, CanonicalJsonError } from './canonicalJson.js'

export const PUBLISHER_POLICY_FORMAT = 'dpp-publisher-policy@1'
export type PublisherRole = 'state-publisher' | 'anchor-publisher'
export type PolicyOperatorProfile = 'single-operator@1' | 'federated-operators@1'

export interface PublisherEntry {
  /** Compressed public key, hex. */
  key: string
  role: PublisherRole
  operator?: string
  activeFrom: string
  retiredAt?: string
  custody?: string
}

export interface PolicyAuthorisation {
  kind: 'genesis' | 'rotation' | 'handover'
  signer: string
  suite: 'bsv-ecdsa-der'
  value: string
  countersigner?: string
  countersignature?: string
}

export interface PublisherPolicy {
  policyFormat: typeof PUBLISHER_POLICY_FORMAT
  policyVersion: number
  scope: { operatorProfile: PolicyOperatorProfile; operators: string[]; topics?: string[] }
  issuedAt: string
  supersedes?: { policyVersion: number; sha256: string }
  publishers: PublisherEntry[]
  authorisation: PolicyAuthorisation
  notes?: string
}

export type PolicyFailureReason =
  | 'format'
  | 'version-order'
  | 'time-order'
  | 'entry-invalid'
  | 'supersedes-missing'
  | 'supersedes-mismatch'
  | 'genesis-signer-not-operator'
  | 'signer-not-active'
  | 'signature-invalid'
  | 'countersignature-missing'
  | 'countersignature-invalid'
  | 'countersigner-not-eligible'
  | 'scope-mismatch'

export interface PolicyFailure { version: number; reason: PolicyFailureReason; detail: string }
export interface PolicyChainResult { ok: boolean; versions: number[]; failure?: PolicyFailure }

const KEY = /^0[23][0-9a-f]{64}$/
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
const instant = (value: string): number => Date.parse(value)
/** A well-formed instant that also exists: the grammar alone lets 2026-13-45T25:61:61Z through as NaN, and every NaN comparison is false. */
const realInstant = (value: string): boolean => TIME.test(value) && Number.isFinite(Date.parse(value))

/** The bytes an authorisation signs: the policy without its signature values, in canonical JSON, UTF-8. */
export function policySigningPreimage(policy: PublisherPolicy): number[] {
  const { value: _value, countersignature: _counter, ...authorisation } = policy.authorisation
  return Utils.toArray(canonicalJson({ ...policy, authorisation }), 'utf8')
}

/** The digest a later version names in `supersedes.sha256`: the complete policy, signatures included, in canonical JSON. */
export function policyDigest(policy: PublisherPolicy): string {
  return Utils.toHex(Hash.sha256(Utils.toArray(canonicalJson(policy), 'utf8')))
}

function verifySignature(signer: string, preimage: number[], der: string): boolean {
  try {
    return PublicKey.fromString(signer).verify(preimage, Signature.fromDER(Utils.toArray(der, 'hex')))
  } catch {
    return false
  }
}

function entryActiveAt(entry: PublisherEntry, at: number): boolean {
  return instant(entry.activeFrom) <= at && (entry.retiredAt == null || at < instant(entry.retiredAt))
}

/** Which operator a key speaks for under a policy: the operator whose identity key it is, else the operator its publisher entry names. */
function operatorOf(policy: PublisherPolicy, key: string, identityKeys: Record<string, string>): string | undefined {
  const byIdentity = policy.scope.operators.find((op) => identityKeys[op] === key)
  if (byIdentity != null) return byIdentity
  const entry = policy.publishers.find((p) => p.key === key)
  return entry?.operator ?? (policy.scope.operators.length === 1 ? policy.scope.operators[0] : undefined)
}

function shapeFailure(policy: PublisherPolicy, previous: PublisherPolicy | undefined): PolicyFailure | undefined {
  const version = policy.policyVersion
  if (policy.policyFormat !== PUBLISHER_POLICY_FORMAT) return { version, reason: 'format', detail: `policyFormat is ${String(policy.policyFormat)}` }
  if (!Number.isInteger(version) || version < 1) return { version, reason: 'format', detail: 'policyVersion must be a positive integer' }
  if (!realInstant(policy.issuedAt)) return { version, reason: 'format', detail: 'issuedAt must be a real instant in UTC' }
  if (!Array.isArray(policy.scope?.operators) || policy.scope.operators.length === 0 || policy.scope.operators.length > 64 || new Set(policy.scope.operators).size !== policy.scope.operators.length) return { version, reason: 'format', detail: 'scope.operators must name one to sixty-four distinct operators' }
  if (policy.authorisation?.suite !== 'bsv-ecdsa-der' || !KEY.test(policy.authorisation.signer ?? '')) return { version, reason: 'format', detail: 'authorisation needs the bsv-ecdsa-der suite and a compressed signer key' }
  if (!Array.isArray(policy.publishers) || policy.publishers.length === 0 || policy.publishers.length > 256) return { version, reason: 'entry-invalid', detail: 'publishers must hold one to 256 entries' }
  for (const entry of policy.publishers) {
    if (!KEY.test(entry.key)) return { version, reason: 'entry-invalid', detail: `publisher key ${String(entry.key)} is not a compressed key` }
    if (entry.role !== 'state-publisher' && entry.role !== 'anchor-publisher') return { version, reason: 'entry-invalid', detail: `publisher ${entry.key} has role ${String(entry.role)}` }
    if (!realInstant(entry.activeFrom) || (entry.retiredAt != null && !realInstant(entry.retiredAt))) return { version, reason: 'entry-invalid', detail: `publisher ${entry.key} has a malformed or unreal time` }
    if (entry.retiredAt != null && instant(entry.retiredAt) <= instant(entry.activeFrom)) return { version, reason: 'entry-invalid', detail: `publisher ${entry.key} retires before it activates` }
    if (entry.operator != null && !policy.scope.operators.includes(entry.operator)) return { version, reason: 'entry-invalid', detail: `publisher ${entry.key} names an operator outside the scope` }
    if (policy.scope.operators.length > 1 && entry.operator == null) return { version, reason: 'entry-invalid', detail: `publisher ${entry.key} must name its operator in a federated scope` }
  }
  if (previous == null) {
    if (policy.authorisation.kind !== 'genesis') return { version, reason: 'version-order', detail: 'the first version of a scope must be a genesis authorisation' }
    if (policy.supersedes != null) return { version, reason: 'supersedes-mismatch', detail: 'a genesis version supersedes nothing' }
  } else {
    if (policy.authorisation.kind === 'genesis') return { version, reason: 'version-order', detail: 'only the first version of a scope is a genesis' }
    if (version <= previous.policyVersion) return { version, reason: 'version-order', detail: `version ${version} does not follow ${previous.policyVersion}` }
    if (instant(policy.issuedAt) <= instant(previous.issuedAt)) return { version, reason: 'time-order', detail: 'a later version must be issued after the one it supersedes' }
    if (policy.supersedes == null) return { version, reason: 'supersedes-missing', detail: 'a later version must name the version it supersedes and its digest' }
    if (policy.supersedes.policyVersion !== previous.policyVersion || policy.supersedes.sha256 !== policyDigest(previous)) return { version, reason: 'supersedes-mismatch', detail: 'supersedes does not name the previous version and its digest' }
  }
  return undefined
}

/**
 * Verify a chain of policy versions for one scope, oldest first. The result
 * names the first version that fails and why; nothing after it is trusted.
 *
 * `operatorIdentityKeys` maps each operator identifier to its compressed
 * identity key, from the reader's own configuration or a resolved DID
 * document, never from the policy itself.
 */
export function verifyPolicyChain(chain: PublisherPolicy[], operatorIdentityKeys: Record<string, string>): PolicyChainResult {
  const versions: number[] = []
  if (chain.length === 0) return { ok: false, versions, failure: { version: 0, reason: 'format', detail: 'an empty chain authorises no key' } }
  let previous: PublisherPolicy | undefined
  for (const policy of chain) {
    const failure = shapeFailure(policy, previous)
    if (failure != null) return { ok: false, versions, failure }
    const version = policy.policyVersion
    let preimage: number[]
    try {
      preimage = policySigningPreimage(policy)
    } catch (error) {
      return { ok: false, versions, failure: { version, reason: 'format', detail: error instanceof CanonicalJsonError ? error.message : 'the policy has no canonical form' } }
    }
    const { signer, value, kind, countersigner, countersignature } = policy.authorisation
    if (!verifySignature(signer, preimage, value)) return { ok: false, versions, failure: { version, reason: 'signature-invalid', detail: `the authorisation does not verify under ${signer}` } }

    if (previous == null) {
      if (!policy.scope.operators.some((op) => operatorIdentityKeys[op] === signer)) {
        return { ok: false, versions, failure: { version, reason: 'genesis-signer-not-operator', detail: 'a genesis is signed by the identity key of an operator in its scope' } }
      }
    } else {
      const issued = instant(policy.issuedAt)
      const activeUnderPrevious = previous.publishers.some((p) => p.key === signer && entryActiveAt(p, issued)) || previous.scope.operators.some((op) => operatorIdentityKeys[op] === signer)
      if (!activeUnderPrevious) return { ok: false, versions, failure: { version, reason: 'signer-not-active', detail: 'the signer was not active under the superseded version at issue time' } }
      const same = previous.scope.operators.length === policy.scope.operators.length && previous.scope.operators.every((op) => policy.scope.operators.includes(op))
      if (kind === 'rotation' && !same) return { ok: false, versions, failure: { version, reason: 'scope-mismatch', detail: 'a rotation keeps the operator set; a changed set is a handover' } }
      if (kind === 'handover' && same) return { ok: false, versions, failure: { version, reason: 'scope-mismatch', detail: 'a handover changes the operator set; an unchanged set is a rotation' } }
      const signerOperator = operatorOf(previous, signer, operatorIdentityKeys)
      const needsCounter = kind === 'handover' || previous.scope.operators.length > 1
      if (needsCounter) {
        if (countersigner == null || countersignature == null) return { ok: false, versions, failure: { version, reason: 'countersignature-missing', detail: kind === 'handover' ? 'a handover is countersigned by an incoming operator' : 'no operator of a federation authorises a key alone' } }
        const incoming = policy.scope.operators.filter((op) => !previous!.scope.operators.includes(op))
        const eligible = kind === 'handover'
          ? incoming.some((op) => operatorIdentityKeys[op] === countersigner)
          : previous.scope.operators.some((op) => op !== signerOperator && operatorIdentityKeys[op] === countersigner)
        if (!eligible) return { ok: false, versions, failure: { version, reason: 'countersigner-not-eligible', detail: kind === 'handover' ? 'the countersigner is not the identity key of an incoming operator' : 'the countersigner is not another operator of the federation' } }
        if (!verifySignature(countersigner, preimage, countersignature)) return { ok: false, versions, failure: { version, reason: 'countersignature-invalid', detail: `the countersignature does not verify under ${countersigner}` } }
      }
    }
    versions.push(version)
    previous = policy
  }
  return { ok: true, versions }
}

/** The policy version in force at an instant: the newest issued at or before it. */
export function policyInForceAt(chain: PublisherPolicy[], at: string | Date): PublisherPolicy | undefined {
  const t = typeof at === 'string' ? instant(at) : at.getTime()
  let inForce: PublisherPolicy | undefined
  for (const policy of chain) if (instant(policy.issuedAt) <= t && (inForce == null || policy.policyVersion > inForce.policyVersion)) inForce = policy
  return inForce
}

/**
 * The publisher keys a state or anchor of the given instant may be
 * countersigned by, from a chain `verifyPolicyChain` has accepted. A key
 * not yet active, or already retired, at that instant is not among them.
 */
export function publisherKeysAt(chain: PublisherPolicy[], at: string | Date, role?: PublisherRole): string[] {
  const policy = policyInForceAt(chain, at)
  if (policy == null) return []
  const t = typeof at === 'string' ? instant(at) : at.getTime()
  return [...new Set(policy.publishers.filter((p) => (role == null || p.role === role) && entryActiveAt(p, t)).map((p) => p.key))]
}
