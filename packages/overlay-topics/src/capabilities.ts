/**
 * The capability document (`spec/conformance.md` section 4,
 * `contracts/capabilities.schema.json`): what this node declares it supports,
 * built from the constants the wire is built from and from the configuration
 * the node actually runs with, never typed by hand where a constant exists.
 * A claim of support, checkable against the ledger; never proof of authority
 * or of conformance. `conformance/examples/capabilities-reference-node.json`
 * is what this produces for the reference configuration.
 */
import { readFileSync } from 'node:fs'
import {
  ATTESTATION_ANCHOR_PREFIX,
  LIFECYCLE_MEDIA_TYPE,
  LIFECYCLE_REPRESENTATION,
  MANAGED_CUSTODY_PROFILE,
  STANDARD_VERSION,
  STANDARD_VERSION_V2,
  policyInForceAt,
} from '@bsv/dpp-core'
import { DPP_TOPIC } from './tmDpp.js'
import { DPP_SERVICE, MAX_LOOKUP_RESULTS } from './lsDpp.js'
import { ATTESTATION_TOPIC } from './tmAttestation.js'
import { ATTESTATION_SERVICE } from './lsAttestation.js'
import { DEFAULT_ATTESTATION_RESULTS, MAX_ATTESTATION_RESULTS } from './attestationStorage.js'
import { UORA_SERVICE, UORA_TOPIC } from './lsUoraDpp.js'
import { UORA_ANCHOR_PREFIX, UORA_ANCHOR_PREFIX_V1, UORA_ANCHOR_PREFIX_V2 } from './uoraAnchor.js'
import { DEFAULT_PAGE_SIZE, MAX_BODY_BYTES, MAX_EXPORT_PART_BYTES, MAX_EXPORT_STATES, MAX_PAGE_SIZE, SNAPSHOT_TTL_MS } from './limits.js'
import { newestPolicy, policyKeysFor, type PublisherPolicyConfig } from './policyConfig.js'
import { DEFAULT_SYNC_INTERVAL_MS } from './sync.js'

/**
 * `info.version` of `contracts/overlay.yaml`, the wire this node speaks. A
 * test holds the two equal, so the document cannot claim a contract version
 * the file does not carry.
 */
export const OVERLAY_HTTP_CONTRACT_VERSION = '0.7.0-draft'

/** The recommended baseline this node claims (`conformance/baseline-native-1.json`). */
export const BASELINE_ID = 'native-baseline@2'

/**
 * The policy version reported when no policy chain is configured: the keys
 * come from the environment, not from a signed policy, and this string, the
 * one the published example carries, says so.
 */
export const IMPLICIT_POLICY_VERSION = 'reference-node-environment'

/** The operator profile a node without peers, or without a federation policy, runs under. */
export const SINGLE_OPERATOR_PROFILE = 'single-operator@1'

/**
 * The operator profile claimed only when both halves are configured: a
 * publisher policy whose scope names two or more operators, and peers to
 * synchronise from. Either alone is single-operator@1 with a longer
 * configuration; the profile's manifest says two processes under one
 * administration prove the mechanism and never independence, and the
 * document claims support, not independence.
 */
export const FEDERATED_OPERATORS_PROFILE = 'federated-operators@1'

/**
 * The VSC seal representation this node indexes commitments to. Its rules live
 * in the `@bsv/vsc` workspace, which this package does not depend on, so the
 * two identifiers are repeated here; a test holds them equal to
 * `conformance/baseline-native-1.json`.
 */
export const VSC_SEAL_REPRESENTATION = 'vsc-seal-json-v1'
export const VSC_SEAL_MEDIA_TYPE = 'application/vc+ld+json'

export type CapabilityRole = 'passport-reader' | 'attestation-verifier' | 'passport-writer' | 'attestation-issuer' | 'registry' | 'overlay'

export interface CapabilityDocument {
  capabilitiesVersion: '1'
  implementation: { name: string; version: string; sourceRevision?: string; baselineId?: string }
  roles: CapabilityRole[]
  protocols: Array<{ id: string; version: string }>
  profiles: Array<{
    id: string
    version: string
    kind: 'industry' | 'exchange' | 'operator' | 'custody'
    artefactDigests?: Record<string, string>
    options?: Record<string, unknown>
  }>
  representations: Array<{ id: string; mediaType: string; verification: 'content' | 'commitment-only' }>
  proofSuites: string[]
  anchorFormats: Array<{ prefix: string; status: 'current' | 'historical' | 'refused' }>
  topics: string[]
  services: string[]
  publisherPolicy: {
    policyVersion: string
    publisherKeys: string[]
    anchoringServices: string[]
    ownerConsent: 'not-selected' | 'required'
    transferAuthorities: string[]
  }
  synchronisation: { profile: string; discovery: 'none' | 'ship-slap' | 'static-peers'; gasp: boolean; peers: string[] }
  limits: Record<string, number | string>
  unsupported: Array<{ id: string; reason: string }>
}

export interface CapabilityInput {
  /** The verified chain, when PUBLISHER_POLICY_FILE is set. */
  publisherPolicy?: PublisherPolicyConfig
  /** SERVICE_IDENTITY_KEY: the whole policy when no chain is configured. */
  serviceIdentityKey?: string
  /** ANCHOR_SERVICE_KEYS: the anchoring services admitted when no chain is configured. */
  anchorServiceKeys?: string[]
  ownerConsent?: boolean | { authorities: string[] }
  /** CONTROL_AUTHORITIES: identity keys whose version 2 UPDATE, TRANSFER or RETIRE is admitted without a control proof. */
  controlAuthorities?: string[]
  /** ACCEPTANCE_COMMITMENT=required: the managed-custody profile is selected, so a version 2 TRANSFER must carry its acceptance commitment. */
  managedAcceptance?: boolean
  /** Whether EXPORT_SIGNING_KEY is set. */
  exportAvailable: boolean
  /** Whether EXPORT_TOKEN is set, so GET /evidence-export needs a bearer. */
  completeExportBearer?: boolean
  /** Whether POST /retract can ask the network about a transaction (false under CHAIN_TRACKER=scripts-only). */
  networkOracleConfigured: boolean
  /** The instant the active keys are read at. */
  at: Date
  /** A source revision to publish, when the deployment knows one. */
  sourceRevision?: string
  /** SYNC_PEERS: the static peers this node synchronises from; none means synchronisation is off. */
  syncPeers?: string[]
  /** SYNC_INTERVAL_MS, reported beside the peers; 0 means one round at startup only. */
  syncIntervalMs?: number
}

/** This package's name and version, from its own manifest. */
export function implementationIdentity(): { name: string; version: string } {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { name: string; version: string }
  return { name: manifest.name, version: manifest.version }
}

/** `bsv-attestation-anchor-v1` is the protocol `bsv-attestation-anchor` at version `1`: the prefix is the constant, the split is here. */
export function protocolFromPrefix(prefix: string): { id: string; version: string } {
  const match = /^(.+)-v(\d+)$/.exec(prefix)
  if (match == null) throw new Error(`${prefix} does not end in a version`)
  return { id: match[1], version: match[2] }
}

function profileEntry(profile: string): { id: string; version: string } {
  const at = profile.indexOf('@')
  if (at <= 0) throw new Error(`${profile} is not id@version`)
  return { id: profile.slice(0, at), version: profile.slice(at + 1) }
}

export function buildCapabilities(input: CapabilityInput): CapabilityDocument {
  const policy = input.publisherPolicy
  const chain = policy?.chain
  const peers = [...(input.syncPeers ?? [])]
  const synchronising = peers.length > 0
  const federated = synchronising && policy != null && newestPolicy(policy).scope.operators.length >= 2
  const operatorProfile = federated ? FEDERATED_OPERATORS_PROFILE : SINGLE_OPERATOR_PROFILE
  const inForce = chain == null ? undefined : policyInForceAt(chain, input.at)
  // The same question admission asks, at this instant: the policy's keys where
  // it covers the topic, the environment's where it does not or where there is
  // no policy at all.
  const publisherKeys =
    (chain == null ? undefined : policyKeysFor(chain, input.at, 'state-publisher', DPP_TOPIC)) ??
    (input.serviceIdentityKey == null || input.serviceIdentityKey === '' ? [] : [input.serviceIdentityKey])
  const anchorPolicyKeys = chain == null ? undefined : policyKeysFor(chain, input.at, 'anchor-publisher', ATTESTATION_TOPIC)
  const anchoringServices = anchorPolicyKeys ?? input.anchorServiceKeys ?? []
  // An empty list means two different things: under a policy that covers the
  // anchor topic, no anchoring service is admitted; with no policy over the
  // topic and no static list, every well-formed anchor is. The second is
  // named under unsupported so the list is never read as the first.
  const anchorsUnrestricted = anchorPolicyKeys == null && anchoringServices.length === 0
  const consentSelected = input.ownerConsent != null && input.ownerConsent !== false
  const transferAuthorities = typeof input.ownerConsent === 'object' ? [...input.ownerConsent.authorities] : []
  const controlAuthorities = input.controlAuthorities ?? transferAuthorities
  const managedAcceptance = input.managedAcceptance === true

  const unsupported: CapabilityDocument['unsupported'] = [
    { id: 'ship-slap-discovery', reason: 'This node advertises nothing; a public deployment declares its discovery profile separately.' },
    ...(synchronising
      ? []
      : [{ id: 'gasp-synchronisation', reason: 'Peer synchronisation is off in this host; federated-operators@1 is a separate operator profile, and naming it does not start a synchronisation.' }]),
    { id: 'credential-content-verification', reason: 'An overlay indexes commitments and authenticates anchoring-service metadata; credential proof, status and authority are verified by a registry or reader.' },
  ]
  if (anchorsUnrestricted) {
    unsupported.push({
      id: 'anchoring-service-restriction',
      reason: 'No publisher policy covers tm_attestation and ANCHOR_SERVICE_KEYS is unset, so every well-formed anchor is admitted whoever wrote it; publisherPolicy.anchoringServices is empty because nothing restricts, not because nothing is admitted.',
    })
  }
  if (policy == null) {
    unsupported.push({
      id: 'publisher-key-rotation',
      reason: 'No PUBLISHER_POLICY_FILE is configured: the single SERVICE_IDENTITY_KEY is an implicit single-operator policy with no rotation history, and every state is checked against it whatever its timestamp.',
    })
  }
  if (!input.exportAvailable) {
    unsupported.push({
      id: 'evidence-package-export',
      reason: 'EXPORT_SIGNING_KEY is unset, so GET /evidence-package and GET /evidence-export answer 503 export-unavailable; the bounded lookup and GET /history remain.',
    })
  }
  if (!input.networkOracleConfigured) {
    unsupported.push({
      id: 'retraction-network-check',
      reason: 'No header source is configured (CHAIN_TRACKER=scripts-only), so POST /retract cannot ask the network whether it knows a transaction and relies on the local merkle-path check alone, which its answer states.',
    })
  }

  const implementation = implementationIdentity()
  return {
    capabilitiesVersion: '1',
    implementation: {
      name: implementation.name,
      version: implementation.version,
      ...(input.sourceRevision == null ? {} : { sourceRevision: input.sourceRevision }),
      baselineId: BASELINE_ID,
    },
    roles: ['overlay'],
    protocols: [
      { id: 'dpp-record', version: STANDARD_VERSION },
      { id: 'dpp-record', version: STANDARD_VERSION_V2 },
      protocolFromPrefix(ATTESTATION_ANCHOR_PREFIX),
      { id: 'overlay-http', version: OVERLAY_HTTP_CONTRACT_VERSION },
    ],
    profiles: [
      {
        ...profileEntry(operatorProfile),
        kind: 'operator',
        options: {
          discovery: synchronising ? 'static-peers' : 'none',
          gasp: synchronising,
          ...(policy == null ? {} : { operators: [...newestPolicy(policy).scope.operators] }),
          ...(synchronising ? { peers, syncIntervalMs: input.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS } : {}),
        },
      },
      // The custody profile this index admits version 2 states under: the
      // managed-custody profile when its acceptance commitment is required,
      // else the record model baseline, named so a writer learns which rule
      // applies from the document and not from a refusal.
      {
        ...profileEntry(managedAcceptance ? MANAGED_CUSTODY_PROFILE : 'record-model-baseline@2'),
        kind: 'custody',
        options: {
          acceptanceCommitment: managedAcceptance ? 'required' : 'not-selected',
          controlAuthorities,
        },
      },
    ],
    representations: [
      { id: LIFECYCLE_REPRESENTATION, mediaType: LIFECYCLE_MEDIA_TYPE, verification: 'commitment-only' },
      { id: VSC_SEAL_REPRESENTATION, mediaType: VSC_SEAL_MEDIA_TYPE, verification: 'commitment-only' },
    ],
    proofSuites: [],
    anchorFormats: [
      { prefix: ATTESTATION_ANCHOR_PREFIX, status: 'current' },
      { prefix: UORA_ANCHOR_PREFIX, status: 'historical' },
      { prefix: UORA_ANCHOR_PREFIX_V1, status: 'historical' },
      { prefix: UORA_ANCHOR_PREFIX_V2, status: 'refused' },
    ],
    topics: [DPP_TOPIC, ATTESTATION_TOPIC, UORA_TOPIC],
    services: [DPP_SERVICE, ATTESTATION_SERVICE, UORA_SERVICE],
    publisherPolicy: {
      policyVersion: policy == null ? IMPLICIT_POLICY_VERSION : String((inForce ?? newestPolicy(policy)).policyVersion),
      publisherKeys,
      anchoringServices,
      ownerConsent: consentSelected ? 'required' : 'not-selected',
      transferAuthorities,
    },
    synchronisation: { profile: operatorProfile, discovery: synchronising ? 'static-peers' : 'none', gasp: synchronising, peers },
    limits: {
      maxLookupResults: MAX_LOOKUP_RESULTS,
      defaultAnchorPageSize: DEFAULT_ATTESTATION_RESULTS,
      maxAnchorPageSize: MAX_ATTESTATION_RESULTS,
      maxBodyBytes: MAX_BODY_BYTES,
      defaultHistoryPageSize: DEFAULT_PAGE_SIZE,
      maxHistoryPageSize: MAX_PAGE_SIZE,
      historySnapshotTtlSeconds: SNAPSHOT_TTL_MS / 1000,
      evidencePackageExport: input.exportAvailable ? 'available' : 'unavailable',
      maxEvidencePackageStates: MAX_EXPORT_STATES,
      // The complete export: open like GET /history, or behind the bearer
      // EXPORT_TOKEN names; each part bounded by both numbers below.
      evidenceExport: input.exportAvailable ? (input.completeExportBearer === true ? 'bearer' : 'open') : 'unavailable',
      maxEvidenceExportPartStates: MAX_EXPORT_STATES,
      maxEvidenceExportPartBytes: MAX_EXPORT_PART_BYTES,
      maxSyncPageSize: MAX_PAGE_SIZE,
      ...(synchronising ? { syncIntervalMs: input.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS } : {}),
    },
    unsupported,
  }
}
