/**
 * The publisher key policy as this node is configured with it
 * (`spec/services.md` section 1, `contracts/publisher-policy.schema.json`).
 *
 * `PUBLISHER_POLICY_FILE` names a JSON file holding the chain of
 * `dpp-publisher-policy@1` versions, oldest first, and `OPERATOR_IDENTITY_KEYS`
 * names each operator's identity key, because the chain's genesis is signed
 * by an operator and the policy itself is never the source of the key that
 * authorises it. The chain is verified once, at boot, with the core's
 * `verifyPolicyChain`; a chain that does not verify stops the boot and names
 * the version and the reason, since admitting under an unverified list would
 * be admitting under whatever a file said.
 *
 * Without a policy file nothing here is consulted: the single
 * `SERVICE_IDENTITY_KEY` is an implicit single-operator policy with no
 * rotation history, and the capability document says so.
 */
import { readFileSync } from 'node:fs'
import {
  policyInForceAt,
  publisherKeysAt,
  verifyPolicyChain,
  type PublisherPolicy,
  type PublisherRole,
} from '@bsv/dpp-core'

export interface PublisherPolicyConfig {
  /** The verified chain, oldest first. */
  chain: PublisherPolicy[]
  /** Operator identifier to compressed identity key, from the environment. */
  operators: Record<string, string>
  /** The versions `verifyPolicyChain` accepted, in chain order. */
  versions: number[]
  /** Where the chain came from, for logs. */
  source: string
}

const COMPRESSED_KEY = /^0[23][0-9a-f]{64}$/

/** `operator=compressedKey` pairs, comma-separated. Malformed input stops the boot rather than naming no operator. */
export function parseOperatorIdentityKeys(value: string | undefined): Record<string, string> {
  const operators: Record<string, string> = {}
  const pairs = (value ?? '')
    .split(',')
    .map((pair) => pair.trim())
    .filter((pair) => pair !== '')
  for (const pair of pairs) {
    const separator = pair.indexOf('=')
    if (separator <= 0) {
      throw new Error(`OPERATOR_IDENTITY_KEYS entry "${pair}" is not of the form operator=compressedKey`)
    }
    const operator = pair.slice(0, separator).trim()
    const key = pair.slice(separator + 1).trim()
    if (!COMPRESSED_KEY.test(key)) {
      throw new Error(`OPERATOR_IDENTITY_KEYS: the key given for ${operator} is not a compressed public key`)
    }
    if (operators[operator] != null) throw new Error(`OPERATOR_IDENTITY_KEYS names ${operator} twice`)
    // One key under two names would let it sign a federation rotation and
    // countersign it as "another operator": the whole point of the
    // countersignature is that it comes from a different key.
    const holder = Object.entries(operators).find(([, existing]) => existing === key)?.[0]
    if (holder != null) throw new Error(`OPERATOR_IDENTITY_KEYS gives ${operator} the same key as ${holder}`)
    operators[operator] = key
  }
  return operators
}

/** Read and verify a chain file. Every failure is an Error whose message names the file, the version and the reason. */
export function loadPublisherPolicy(file: string, operators: Record<string, string>): PublisherPolicyConfig {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (cause) {
    throw new Error(`PUBLISHER_POLICY_FILE ${file} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`PUBLISHER_POLICY_FILE ${file} is not JSON`)
  }
  if (!Array.isArray(parsed) || parsed.some((p) => typeof p !== 'object' || p === null || Array.isArray(p))) {
    throw new Error(`PUBLISHER_POLICY_FILE ${file} must hold a JSON array of dpp-publisher-policy@1 documents, oldest first`)
  }
  const chain = parsed as PublisherPolicy[]
  const result = verifyPolicyChain(chain, operators)
  if (!result.ok || result.failure != null) {
    const failure = result.failure ?? { version: 0, reason: 'format', detail: 'the chain did not verify' }
    throw new Error(
      `PUBLISHER_POLICY_FILE ${file}: policy version ${failure.version} refused, ${failure.reason}: ${failure.detail}`
    )
  }
  return { chain, operators, versions: result.versions, source: file }
}

/** The policy the environment configures, or undefined when it configures none. */
export function publisherPolicyFromEnvironment(): PublisherPolicyConfig | undefined {
  const file = (process.env.PUBLISHER_POLICY_FILE ?? '').trim()
  const operators = process.env.OPERATOR_IDENTITY_KEYS
  if (file === '') {
    if (operators != null && operators.trim() !== '') {
      console.warn(
        'OPERATOR_IDENTITY_KEYS is set but PUBLISHER_POLICY_FILE is not: the operator keys are ignored, ' +
          'because there is no policy chain for them to authorise'
      )
    }
    return undefined
  }
  return loadPublisherPolicy(file, parseOperatorIdentityKeys(operators))
}

/**
 * The publisher keys a topic accepts at an instant under the chain.
 *
 * `undefined` means the version in force does not cover the topic: a policy
 * may name `scope.topics`, and a topic outside them keeps its static
 * configuration (the identity key, or ANCHOR_SERVICE_KEYS). An empty array
 * means the policy covers the topic and no key is active, which admits
 * nothing, and is also the answer for an instant before the first version was
 * issued: a key admits nothing dated before its activation.
 */
export function policyKeysFor(
  chain: PublisherPolicy[],
  at: string | Date,
  role: PublisherRole,
  topic: string
): string[] | undefined {
  const inForce = policyInForceAt(chain, at)
  if (inForce == null) return []
  if (inForce.scope.topics != null && !inForce.scope.topics.includes(topic)) return undefined
  return publisherKeysAt(chain, at, role)
}

/** The newest version of the chain, the one that names the operator profile and the current keys. */
export function newestPolicy(config: PublisherPolicyConfig): PublisherPolicy {
  return config.chain[config.chain.length - 1]
}
