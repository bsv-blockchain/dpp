/**
 * The evidence package export (`spec/portable-evidence.md` section 2,
 * `contracts/evidence-package.schema.json`): everything this node holds about
 * one passport, as content-addressed files under a manifest the node signs.
 *
 * What goes in, from this node's own stores and nothing fetched: every
 * retained state's raw transaction under `transactions/`, the BEEF it is held
 * in under `proofs/` (the merkle path and ancestors a verifier needs, once
 * `/arc-ingest` has delivered the proof), the publisher policy chain under
 * `authority/` when one is configured, the spend observations under `status/`
 * and a verification report under `reports/`. The signature says this node
 * assembled these bytes; it says nothing about their truth, which a reader
 * establishes from the bytes and its own header source, and nothing about
 * completeness beyond the snapshot the manifest names.
 *
 * The archive form is this build's own, as the standard leaves it: a JSON
 * envelope `{ manifest, files: { "<path>": "<base64>" } }`, so a browser or a
 * script reads it without an archive library and the file map is exactly the
 * one `inspectEvidencePackage` takes.
 */
import { Beef, Transaction, Utils, type ChainTracker, type PrivateKey } from '@bsv/sdk'
import type { Storage } from '@bsv/overlay'
import {
  EVIDENCE_PACKAGE_FORMAT,
  EVIDENCE_PACKAGE_VERSION,
  PUBLISHER_POLICY_FORMAT,
  REPORT_VERSION,
  canonicalJson,
  chainFromBeef,
  inventoryEntry,
  signEvidenceManifest,
  verifyPassportEvidence,
  type EvidencePackageManifest,
  type InventoryEntry,
  type LatestStateObserver,
  type SourceObservation,
  type UnsignedEvidenceManifest,
} from '@bsv/dpp-core'
import { DPP_TOPIC } from './tmDpp.js'
import { DPP_SERVICE } from './lsDpp.js'
import { IMPLICIT_POLICY_VERSION, SINGLE_OPERATOR_PROFILE } from './capabilities.js'
import type { HistoryPaginator } from './history.js'
import { MAX_EXPORT_STATES } from './limits.js'
import { newestPolicy, type PublisherPolicyConfig } from './policyConfig.js'
import type { DppRecord } from './storage.js'

/** The archive form: the manifest beside every inventoried file, base64 by path. */
export interface EvidencePackageEnvelope {
  manifest: EvidencePackageManifest
  files: Record<string, string>
}

export interface EvidenceExportRequest {
  passportId: string
  paginator: HistoryPaginator
  engineStorage: Storage
  /** EXPORT_SIGNING_KEY; the manifest's signer is its public key. */
  signingKey: PrivateKey
  publisherPolicy?: PublisherPolicyConfig
  serviceIdentityKey?: string
  ownerConsent?: boolean | { authorities: string[] }
  chainTracker?: ChainTracker | 'scripts only'
  /** The export instant, injected so a test can pin it. */
  now: Date
  /** What the manifest names as the exporter's software. */
  software: string
}

const OCTET_STREAM = 'application/octet-stream'
const JSON_MEDIA_TYPE = 'application/json'
const outpointRef = (txid: string, outputIndex: number): string => `${txid}:${outputIndex}`

/** The tiers this node never holds, named as the disclosure scopes name them (`spec/record-model.md` section 7). */
export const WITHHELD_TIERS = [
  'tier:owner (the encrypted blobs payload_owner_hash commits to are never held by this node)',
  'tier:legitimate-interest (never held by this node)',
  'tier:authority (never held by this node)',
]

/**
 * Build the package, or return undefined when this node holds nothing for the
 * passport, which the route answers as 404 rather than as an empty package
 * claiming completeness over nothing.
 */
export async function buildEvidencePackage(request: EvidenceExportRequest): Promise<EvidencePackageEnvelope | undefined> {
  const { passportId, now } = request
  const exportedAt = now.toISOString()
  const snapshot = await request.paginator.takeSnapshot()
  const everyRow = await request.paginator.readAll({ passportId }, snapshot)
  if (everyRow.length === 0) return undefined
  // The newest states within the cap, as the bounded lookup keeps the newest;
  // the older ones are declared absent by outpoint below, and the snapshot is
  // then not complete, which the manifest says rather than implies.
  const rows = everyRow.slice(-MAX_EXPORT_STATES)
  const omitted = everyRow.slice(0, everyRow.length - rows.length)

  const files = new Map<string, number[]>()
  const inventory: InventoryEntry[] = []
  const absent: string[] = omitted.flatMap((row) => [`transaction:${outpointRef(row.txid, row.outputIndex)}`, `proof:${outpointRef(row.txid, row.outputIndex)}`])
  const add = (path: string, category: InventoryEntry['category'], mediaType: string, bytes: number[], extra: Pick<InventoryEntry, 'represents' | 'representation'> = {}): void => {
    files.set(path, bytes)
    inventory.push(inventoryEntry(path, category, mediaType, bytes, extra))
  }

  // Transactions and proofs, straight from the engine's storage: the BEEF each
  // state arrived in, updated in place when a proof reached /arc-ingest.
  const merged = new Beef()
  const byTxid = new Map<string, DppRecord>()
  for (const row of rows) {
    byTxid.set(row.txid, row)
    const ref = outpointRef(row.txid, row.outputIndex)
    const output = await request.engineStorage.findOutput(row.txid, row.outputIndex, DPP_TOPIC, undefined, true)
    let held: ReturnType<Beef['findTxid']>
    if (output?.beef != null) {
      try {
        const beef = Beef.fromBinary(output.beef)
        held = beef.findTxid(row.txid)
        if (held?.tx != null || held?.rawTx != null) merged.mergeBeef(beef)
      } catch {
        held = undefined
      }
    }
    const raw = held?.rawTx ?? held?.tx?.toBinary()
    if (output?.beef == null || raw == null) {
      absent.push(`transaction:${ref}`, `proof:${ref}`)
      continue
    }
    add(`transactions/${row.txid}.tx`, 'transactions', OCTET_STREAM, raw, { represents: ref, representation: 'raw-transaction' })
    add(`proofs/${row.txid}.beef`, 'proofs', OCTET_STREAM, output.beef, { represents: ref, representation: 'beef' })
    // An unmined state has no merkle path anywhere yet; the reader's inclusion
    // check will say proof-absent, and the manifest says so first.
    if (held?.bumpIndex == null && held?.tx?.merklePath == null) absent.push(`merkle-path:${row.txid}`)
  }

  // The history in chain order when the held states form one chain, which is
  // the order the report inspects; otherwise in the store's order, and the
  // report names the link that does not hold.
  let ordered: Transaction[]
  try {
    ordered = chainFromBeef(merged, passportId)
  } catch {
    ordered = rows
      .map((row) => merged.findAtomicTransaction(row.txid))
      .filter((tx): tx is Transaction => tx != null)
  }
  const first = ordered[0] == null ? undefined : byTxid.get(ordered[0].id('hex'))
  const last = ordered.length === 0 ? undefined : byTxid.get(ordered[ordered.length - 1].id('hex'))
  const tipRecord = last ?? rows[rows.length - 1]

  // The publisher policy chain, as the authority record a reader checks the
  // countersignatures against; canonical JSON so the bytes are the same from
  // every process that holds this chain.
  const policy = request.publisherPolicy
  if (policy != null) {
    add('authority/publisher-policy.json', 'authority', JSON_MEDIA_TYPE, Utils.toArray(canonicalJson(policy.chain), 'utf8'), {
      represents: `${PUBLISHER_POLICY_FORMAT} versions ${policy.versions.join(', ')}`,
      representation: PUBLISHER_POLICY_FORMAT,
    })
  }
  const policyId = policy == null ? IMPLICIT_POLICY_VERSION : `${PUBLISHER_POLICY_FORMAT}:${newestPolicy(policy).policyVersion}`
  const operatorProfile = policy == null ? SINGLE_OPERATOR_PROFILE : newestPolicy(policy).scope.operatorProfile

  // The spend observations: what this node's own index says about each state
  // at export time. One file under status/, and the same facts as the
  // manifest's source observations and the report's observer.
  const spendResult: SourceObservation['result'] = tipRecord.spent ? 'spent' : 'unspent'
  const observations = {
    source: DPP_SERVICE,
    snapshotId: snapshot.id,
    observedAt: exportedAt,
    states: rows.map((row) => ({ txid: row.txid, outputIndex: row.outputIndex, spent: row.spent, spendingTxid: row.spendingTxid, sequence: row.sequence })),
  }
  add('status/spend-observations.json', 'status', JSON_MEDIA_TYPE, Utils.toArray(JSON.stringify(observations), 'utf8'), {
    represents: `${DPP_SERVICE} snapshot ${snapshot.id}`,
  })
  const observer: LatestStateObserver = {
    id: DPP_SERVICE,
    kind: 'spend-status',
    observe: async () => ({
      result: spendResult,
      ...(tipRecord.spent ? { spendingTxid: tipRecord.spendingTxid } : {}),
    }),
  }

  // The report, in the one shape every surface produces, evaluated at the
  // export instant against the node's own admission policy and header source.
  const evidencePolicy: Parameters<typeof verifyPassportEvidence>[2] = {
    policyId,
    ...(policy != null
      ? { publisherPolicy: { chain: policy.chain, operatorIdentityKeys: policy.operators } }
      : request.serviceIdentityKey != null && request.serviceIdentityKey !== ''
        ? { publisherKeys: [request.serviceIdentityKey] }
        : {}),
    ownerConsent: request.ownerConsent,
    chainTracker: request.chainTracker,
    checkedAt: exportedAt,
    observers: [observer],
  }
  const report = await verifyPassportEvidence({ tokenHistory: ordered }, { passportId, source: 'request-context' }, evidencePolicy)
  add('reports/verification-report.json', 'reports', JSON_MEDIA_TYPE, Utils.toArray(JSON.stringify(report), 'utf8'), {
    represents: `verification-report@${REPORT_VERSION} for ${passportId}`,
  })

  const sources: SourceObservation[] = [
    { id: DPP_SERVICE, kind: 'overlay-lookup', observedAt: exportedAt, result: spendResult },
    { id: DPP_SERVICE, kind: 'spend-status', observedAt: exportedAt, result: spendResult },
  ]
  const unsigned: UnsignedEvidenceManifest = {
    format: EVIDENCE_PACKAGE_FORMAT,
    version: EVIDENCE_PACKAGE_VERSION,
    passportId,
    ...(first == null ? {} : { genesis: { txid: first.txid, outputIndex: first.outputIndex } }),
    ...(last == null ? {} : { selectedTip: { txid: last.txid, outputIndex: last.outputIndex } }),
    exportedAt,
    exporter: { id: request.signingKey.toPublicKey().toString(), role: 'overlay', software: request.software },
    profiles: [operatorProfile],
    policyId,
    // Public scope, and therefore never a recovery backup: the restricted
    // tiers are not held here, so they are withheld by name, not implied.
    disclosure: { scope: 'public', recoveryBackup: false },
    completeness: {
      snapshots: [{ source: DPP_SERVICE, snapshotId: snapshot.id, completeForSnapshot: omitted.length === 0, scope: `passportId=${passportId}` }],
      withheld: [...WITHHELD_TIERS],
      absent,
    },
    sources,
    inventory,
    signature: { suite: 'bsv-ecdsa-der', signer: request.signingKey.toPublicKey().toString() },
  }
  const manifest = await signEvidenceManifest(unsigned, {
    sign: (preimage) => request.signingKey.sign(preimage).toDER() as number[],
  })
  const encoded: Record<string, string> = {}
  for (const [path, bytes] of files) encoded[path] = Utils.toBase64(bytes)
  return { manifest, files: encoded }
}

/** The envelope's file map as `inspectEvidencePackage` takes it. */
export function envelopeFiles(envelope: EvidencePackageEnvelope): Map<string, number[]> {
  return new Map(Object.entries(envelope.files).map(([path, base64]) => [path, Utils.toArray(base64, 'base64')]))
}
