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
 * Two routes build from the same pieces. `GET /evidence-package` is the
 * bounded package: the newest states within the cap, the rest declared
 * absent, complete for its snapshot only when the cap was not reached. `GET
 * /evidence-export` is the complete export: parts over one snapshot, oldest
 * first, each a package of its own over a contiguous sequence range bounded
 * by states and by bytes, resumed by a cursor, tiling the snapshot so a
 * reader joins them with `joinEvidenceExport` and knows whether it holds
 * everything the snapshot held (`contracts/evidence-export.schema.json`).
 *
 * The archive form is this build's own, as the standard leaves it: a JSON
 * envelope `{ manifest, files: { "<path>": "<base64>" } }`, so a browser or a
 * script reads it without an archive library and the file map is exactly the
 * one `inspectEvidencePackage` takes.
 */
import { Beef, PublicKey, Signature, Transaction, Utils, type ChainTracker, type PrivateKey } from '@bsv/sdk'
import type { Storage } from '@bsv/overlay'
import {
  CanonicalJsonError,
  EVIDENCE_PACKAGE_FORMAT,
  EVIDENCE_PACKAGE_VERSION,
  PUBLISHER_POLICY_FORMAT,
  REPORT_VERSION,
  canonicalJson,
  chainFromBeef,
  inspectEvidencePackage,
  inventoryEntry,
  sha256Hex,
  signEvidenceManifest,
  verifyPassportEvidence,
  type EvidencePackageManifest,
  type InventoryEntry,
  type LatestStateObserver,
  type PackageInspection,
  type SourceObservation,
  type UnsignedEvidenceManifest,
} from '@bsv/dpp-core'
import { DPP_TOPIC } from './tmDpp.js'
import { DPP_SERVICE } from './lsDpp.js'
import { IMPLICIT_POLICY_VERSION, SINGLE_OPERATOR_PROFILE } from './capabilities.js'
import type { HistoryPaginator, Snapshot } from './history.js'
import { MAX_EXPORT_PART_BYTES, MAX_EXPORT_STATES } from './limits.js'
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
  /** The version 2 options the node admits under (CONTROL_AUTHORITIES, ACCEPTANCE_COMMITMENT). */
  controlAuthorities?: string[]
  managedAcceptance?: boolean
  chainTracker?: ChainTracker | 'scripts only'
  /** The export instant, injected so a test can pin it. */
  now: Date
  /** What the manifest names as the exporter's software. */
  software: string
}

/** The version of the complete export's wrapper, `contracts/evidence-export.schema.json`. */
export const EVIDENCE_EXPORT_VERSION = '1'

/**
 * The coverage record of a part: every fact a reader uses to establish that
 * the parts of an export tile a snapshot, signed by the exporter beside the
 * package and bound to the exact signed manifest by its digest. A wrapper
 * field outside this record (the cursor, the package bytes) establishes
 * nothing about coverage; a reader that trusted an unsigned `final` or range
 * could be handed a genuine first part dressed as a whole export.
 */
export interface ExportCoverage {
  exportVersion: typeof EVIDENCE_EXPORT_VERSION
  passportId: string
  snapshot: { source: string; id: string; sequence: number }
  part: { index: number; sequenceRange: { from: number; to: number }; states: number }
  final: boolean
  /** SHA-256 of the canonical JSON of the part's signed package manifest, signature value included. */
  manifestSha256: string
  signature: { suite: 'bsv-ecdsa-der'; signer: string }
}

/** One part of the complete export, as the wire carries it: the signed coverage record, the cursor and the package. */
export interface EvidenceExportPart extends Omit<ExportCoverage, 'signature'> {
  nextCursor: string | null
  signature: { suite: 'bsv-ecdsa-der'; signer: string; value: string }
  package: EvidencePackageEnvelope
}

/** The digest the coverage record binds the package by: the manifest exactly as signed, canonical JSON, signature value included. */
export function exportManifestDigest(manifest: EvidencePackageManifest): string {
  return sha256Hex(Utils.toArray(canonicalJson(manifest), 'utf8'))
}

/** The coverage record a part carries: the wrapper without its cursor, its package and the signature value. */
export function exportCoverageOf(part: Omit<EvidenceExportPart, 'nextCursor' | 'package'> | EvidenceExportPart): ExportCoverage {
  return {
    exportVersion: part.exportVersion,
    passportId: part.passportId,
    snapshot: { source: part.snapshot.source, id: part.snapshot.id, sequence: part.snapshot.sequence },
    part: { index: part.part.index, sequenceRange: { from: part.part.sequenceRange.from, to: part.part.sequenceRange.to }, states: part.part.states },
    final: part.final,
    manifestSha256: part.manifestSha256,
    signature: { suite: part.signature.suite, signer: part.signature.signer },
  }
}

/** The bytes the exporter signs for a part: the coverage record in canonical JSON, UTF-8, exactly as the manifest's own preimage rule; ECDSA then runs over their SHA-256. */
export function exportCoveragePreimage(part: Omit<EvidenceExportPart, 'nextCursor' | 'package'> | EvidenceExportPart): number[] {
  return Utils.toArray(canonicalJson(exportCoverageOf(part)), 'utf8')
}

/** The scope sentence a part's manifest carries, rendered from the coverage record so the signed manifest and the signed coverage say one thing. */
export function exportScopeText(passportId: string, snapshotId: string, index: number, from: number, to: number, final: boolean): string {
  return index === 1 && final ? `passportId=${passportId}` : `passportId=${passportId}; sequences ${from}..${to} of snapshot ${snapshotId}; part ${index} of the complete export`
}

export interface ExportPartInspection {
  /** The coverage signature verifies under the record's signer, or null when the record has no canonical form. */
  coverageAuthentic: boolean | null
  /** The package manifest hashes to the digest the coverage record names, and its own signed declarations agree with the record. */
  manifestBound: boolean
  /** The package on its three questions, as `inspectEvidencePackage` answers them. */
  package: PackageInspection
  failures: string[]
}

/**
 * Inspect one part: the coverage signature, the binding of the package to
 * the record, the agreement of the signed manifest with the record, and the
 * package itself. Only a part whose coverage is authentic and bound may say
 * anything about what an export covers.
 */
export function inspectEvidenceExportPart(part: EvidenceExportPart, options: { expectedPassportId?: string; expectedSigner?: string } = {}): ExportPartInspection {
  const failures: string[] = []
  const label = `part ${part.part?.index}`
  const manifest = part.package?.manifest
  const packageInspection = inspectEvidencePackage(manifest, envelopeFiles(part.package), { expectedPassportId: options.expectedPassportId ?? part.passportId, ...(options.expectedSigner == null ? {} : { expectedSigner: options.expectedSigner }) })
  for (const failure of packageInspection.failures) failures.push(`${label}: ${failure.detail}`)
  if (packageInspection.signatureValid !== true) failures.push(`${label}: the package signature does not verify`)

  let coverageAuthentic: boolean | null = false
  const signer = part.signature?.signer
  if (part.signature?.suite !== 'bsv-ecdsa-der' || typeof signer !== 'string' || !/^0[23][0-9a-f]{64}$/.test(signer) || typeof part.signature.value !== 'string') {
    failures.push(`${label}: the coverage record needs the bsv-ecdsa-der suite, a compressed signer key and a value`)
  } else {
    try {
      coverageAuthentic = PublicKey.fromString(signer).verify(exportCoveragePreimage(part), Signature.fromDER(Utils.toArray(part.signature.value, 'hex')))
    } catch (error) {
      coverageAuthentic = error instanceof CanonicalJsonError ? null : false
      if (coverageAuthentic === null) failures.push(`${label}: the coverage record has no canonical form: ${error instanceof Error ? error.message : 'unknown'}`)
    }
    if (coverageAuthentic === false) failures.push(`${label}: the coverage signature does not verify under ${signer}; its range, index and finality establish nothing`)
    if (manifest?.signature?.signer != null && signer !== manifest.signature.signer) failures.push(`${label}: the coverage record is signed by ${signer} but the package by ${manifest.signature.signer}`)
    if (options.expectedSigner != null && signer !== options.expectedSigner) failures.push(`${label}: the coverage record is signed by ${signer}, not the expected ${options.expectedSigner}`)
  }

  let manifestBound = false
  if (manifest != null) {
    let digest: string | undefined
    try {
      digest = exportManifestDigest(manifest)
    } catch {
      failures.push(`${label}: the package manifest has no canonical form`)
    }
    if (digest != null && digest !== part.manifestSha256) failures.push(`${label}: the package manifest hashes to ${digest.slice(0, 12)}…, not the ${String(part.manifestSha256).slice(0, 12)}… the coverage record names; the package is not the one the record covers`)
    const declared = manifest.completeness?.snapshots?.[0]
    const { from, to } = part.part.sequenceRange
    const scope = exportScopeText(part.passportId, part.snapshot.id, part.part.index, from, to, part.final)
    if (declared == null || declared.snapshotId !== part.snapshot.id) failures.push(`${label}: the package names snapshot ${declared?.snapshotId ?? 'none'}, not ${part.snapshot.id}`)
    else if (declared.scope !== scope) failures.push(`${label}: the package declares scope "${declared.scope ?? ''}" but the coverage record says "${scope}"`)
    else if (declared.completeForSnapshot !== (part.part.index === 1 && part.final)) failures.push(`${label}: the package declares completeForSnapshot ${String(declared.completeForSnapshot)}, which the coverage record contradicts`)
    if (manifest.passportId !== part.passportId) failures.push(`${label}: the package is about ${manifest.passportId}, not ${part.passportId}`)
    manifestBound = digest === part.manifestSha256 && declared != null && declared.snapshotId === part.snapshot.id && declared.scope === scope && declared.completeForSnapshot === (part.part.index === 1 && part.final) && manifest.passportId === part.passportId
  } else {
    failures.push(`${label}: no package`)
  }
  return { coverageAuthentic, manifestBound, package: packageInspection, failures }
}

export interface EvidencePartRequest extends Omit<EvidenceExportRequest, 'chainTracker' | 'ownerConsent' | 'controlAuthorities' | 'managedAcceptance'> {
  /** The nextCursor of the previous part; absent or empty for the first. */
  cursor?: string | null
  /** The bounds of one part; the limits module's numbers unless a test narrows them. */
  maxStates?: number
  maxBytes?: number
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

/** What the engine's storage holds for one state, read once per state. */
interface HeldState {
  row: DppRecord
  raw?: number[]
  beef?: number[]
  parsed?: Beef
  /** Whether the BEEF carries a merkle path for the state itself. */
  proven: boolean
}

async function readHeld(row: DppRecord, engineStorage: Storage): Promise<HeldState> {
  const output = await engineStorage.findOutput(row.txid, row.outputIndex, DPP_TOPIC, undefined, true)
  if (output?.beef == null) return { row, proven: false }
  try {
    const parsed = Beef.fromBinary(output.beef)
    const held = parsed.findTxid(row.txid)
    const raw = held?.rawTx ?? held?.tx?.toBinary()
    if (raw == null) return { row, proven: false }
    return { row, raw, beef: output.beef, parsed, proven: held?.bumpIndex != null || held?.tx?.merklePath != null }
  } catch {
    return { row, proven: false }
  }
}

/** The files of a set of held states, their inventory, what is absent, and the merged BEEF of what was held. */
class PackageFiles {
  readonly files = new Map<string, number[]>()
  readonly inventory: InventoryEntry[] = []
  readonly absent: string[] = []
  readonly merged = new Beef()
  /** Raw transaction and BEEF bytes added so far, the number a part's byte bound reads. */
  bytes = 0

  add(path: string, category: InventoryEntry['category'], mediaType: string, bytes: number[], extra: Pick<InventoryEntry, 'represents' | 'representation'> = {}): void {
    this.files.set(path, bytes)
    this.inventory.push(inventoryEntry(path, category, mediaType, bytes, extra))
  }

  /** Transaction and proof of one state, straight from the engine's storage, or its absence by outpoint. */
  addState(held: HeldState): void {
    const ref = outpointRef(held.row.txid, held.row.outputIndex)
    if (held.raw == null || held.beef == null || held.parsed == null) {
      this.absent.push(`transaction:${ref}`, `proof:${ref}`)
      return
    }
    this.merged.mergeBeef(held.parsed)
    this.add(`transactions/${held.row.txid}.tx`, 'transactions', OCTET_STREAM, held.raw, { represents: ref, representation: 'raw-transaction' })
    this.add(`proofs/${held.row.txid}.beef`, 'proofs', OCTET_STREAM, held.beef, { represents: ref, representation: 'beef' })
    this.bytes += held.raw.length + held.beef.length
    // An unmined state has no merkle path anywhere yet; the reader's inclusion
    // check will say proof-absent, and the manifest says so first.
    if (!held.proven) this.absent.push(`merkle-path:${held.row.txid}`)
  }

  /** The publisher policy chain, as the authority record a reader checks the countersignatures against; canonical JSON so the bytes are the same from every process that holds this chain. */
  addPolicy(policy: PublisherPolicyConfig | undefined): void {
    if (policy == null) return
    this.add('authority/publisher-policy.json', 'authority', JSON_MEDIA_TYPE, Utils.toArray(canonicalJson(policy.chain), 'utf8'), {
      represents: `${PUBLISHER_POLICY_FORMAT} versions ${policy.versions.join(', ')}`,
      representation: PUBLISHER_POLICY_FORMAT,
    })
  }

  /** The spend observations: what this node's own index says about each state at export time. */
  addObservations(rows: DppRecord[], snapshot: Snapshot, exportedAt: string, part?: number): void {
    const observations = {
      source: DPP_SERVICE,
      snapshotId: snapshot.id,
      observedAt: exportedAt,
      ...(part == null ? {} : { part }),
      states: rows.map((row) => ({ txid: row.txid, outputIndex: row.outputIndex, spent: row.spent, spendingTxid: row.spendingTxid, sequence: row.sequence })),
    }
    // One file per part, named by the part, so the parts of one export never
    // repeat a path with different bytes when a reader joins them.
    this.add(part == null ? 'status/spend-observations.json' : `status/spend-observations-part-${part}.json`, 'status', JSON_MEDIA_TYPE, Utils.toArray(JSON.stringify(observations), 'utf8'), {
      represents: `${DPP_SERVICE} snapshot ${snapshot.id}${part == null ? '' : ` part ${part}`}`,
    })
  }

  envelope(): Record<string, string> {
    const encoded: Record<string, string> = {}
    for (const [path, bytes] of this.files) encoded[path] = Utils.toBase64(bytes)
    return encoded
  }
}

const policyIdOf = (policy: PublisherPolicyConfig | undefined): string => (policy == null ? IMPLICIT_POLICY_VERSION : `${PUBLISHER_POLICY_FORMAT}:${newestPolicy(policy).policyVersion}`)
const operatorProfileOf = (policy: PublisherPolicyConfig | undefined): string => (policy == null ? SINGLE_OPERATOR_PROFILE : newestPolicy(policy).scope.operatorProfile)

/** A genesis is the state with no predecessor; the first held row is not one merely by being first. */
const isGenesis = (row: DppRecord | undefined): row is DppRecord => row != null && row.previousTxid === ''

function signedBy(signingKey: PrivateKey): { exporterId: string; sign: (preimage: number[]) => Promise<number[]> } {
  return { exporterId: signingKey.toPublicKey().toString(), sign: async (preimage) => signingKey.sign(preimage).toDER() as number[] }
}

/**
 * Build the bounded package, or return undefined when this node holds
 * nothing for the passport, which the route answers as 404 rather than as an
 * empty package claiming completeness over nothing.
 */
export async function buildEvidencePackage(request: EvidenceExportRequest): Promise<EvidencePackageEnvelope | undefined> {
  const { passportId, now } = request
  const exportedAt = now.toISOString()
  const snapshot = await request.paginator.takeSnapshot()
  const everyRow = await request.paginator.readAll({ passportId }, snapshot)
  if (everyRow.length === 0) return undefined
  // The newest states within the cap, as the bounded lookup keeps the newest;
  // the older ones are declared absent by outpoint below, and the snapshot is
  // then not complete, which the manifest says rather than implies. The
  // complete export reaches them in further parts.
  const rows = everyRow.slice(-MAX_EXPORT_STATES)
  const omitted = everyRow.slice(0, everyRow.length - rows.length)

  const files = new PackageFiles()
  files.absent.push(...omitted.flatMap((row) => [`transaction:${outpointRef(row.txid, row.outputIndex)}`, `proof:${outpointRef(row.txid, row.outputIndex)}`]))
  const byTxid = new Map<string, DppRecord>()
  for (const row of rows) {
    byTxid.set(row.txid, row)
    files.addState(await readHeld(row, request.engineStorage))
  }

  // The history in chain order when the held states form one chain, which is
  // the order the report inspects; otherwise in the store's order, and the
  // report names the link that does not hold.
  let ordered: Transaction[]
  try {
    ordered = chainFromBeef(files.merged, passportId)
  } catch {
    ordered = rows
      .map((row) => files.merged.findAtomicTransaction(row.txid))
      .filter((tx): tx is Transaction => tx != null)
  }
  const first = ordered[0] == null ? undefined : byTxid.get(ordered[0].id('hex'))
  const last = ordered.length === 0 ? undefined : byTxid.get(ordered[ordered.length - 1].id('hex'))
  const tipRecord = last ?? rows[rows.length - 1]

  const policy = request.publisherPolicy
  files.addPolicy(policy)
  const policyId = policyIdOf(policy)
  const spendResult: SourceObservation['result'] = tipRecord.spent ? 'spent' : 'unspent'
  files.addObservations(rows, snapshot, exportedAt)
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
    ...(request.controlAuthorities == null ? {} : { controlAuthorities: request.controlAuthorities }),
    ...(request.managedAcceptance == null ? {} : { managedAcceptance: { required: request.managedAcceptance } }),
    chainTracker: request.chainTracker,
    checkedAt: exportedAt,
    observers: [observer],
  }
  const report = await verifyPassportEvidence({ tokenHistory: ordered }, { passportId, source: 'request-context' }, evidencePolicy)
  files.add('reports/verification-report.json', 'reports', JSON_MEDIA_TYPE, Utils.toArray(JSON.stringify(report), 'utf8'), {
    represents: `verification-report@${REPORT_VERSION} for ${passportId}`,
  })

  const { exporterId, sign } = signedBy(request.signingKey)
  const unsigned: UnsignedEvidenceManifest = {
    format: EVIDENCE_PACKAGE_FORMAT,
    version: EVIDENCE_PACKAGE_VERSION,
    passportId,
    // The genesis only when the first ordered state has no predecessor: a
    // package cut at the cap starts in the middle of a lineage and names none.
    ...(isGenesis(first) ? { genesis: { txid: first.txid, outputIndex: first.outputIndex } } : {}),
    ...(last == null ? {} : { selectedTip: { txid: last.txid, outputIndex: last.outputIndex } }),
    exportedAt,
    exporter: { id: exporterId, role: 'overlay', software: request.software },
    profiles: [operatorProfileOf(policy)],
    policyId,
    // Public scope, and therefore never a recovery backup: the restricted
    // tiers are not held here, so they are withheld by name, not implied.
    disclosure: { scope: 'public', recoveryBackup: false },
    completeness: {
      snapshots: [{ source: DPP_SERVICE, snapshotId: snapshot.id, completeForSnapshot: omitted.length === 0, scope: `passportId=${passportId}` }],
      withheld: [...WITHHELD_TIERS],
      absent: files.absent,
    },
    sources: [
      { id: DPP_SERVICE, kind: 'overlay-lookup', observedAt: exportedAt, result: spendResult },
      { id: DPP_SERVICE, kind: 'spend-status', observedAt: exportedAt, result: spendResult },
    ],
    inventory: files.inventory,
    signature: { suite: 'bsv-ecdsa-der', signer: exporterId },
  }
  const manifest = await signEvidenceManifest(unsigned, { sign })
  return { manifest, files: files.envelope() }
}

/**
 * Build one part of the complete export: the first when no cursor is given,
 * which pins the snapshot, or the part the cursor names over the snapshot it
 * carries. Returns undefined when this node holds nothing for the passport
 * in the snapshot. A cursor of the wrong kind, for another passport, from
 * another process or older than the TTL throws the paginator's named
 * refusal, which the route answers as it answers a history cursor.
 */
export async function buildEvidenceExportPart(request: EvidencePartRequest): Promise<EvidenceExportPart | undefined> {
  const { passportId, now } = request
  const exportedAt = now.toISOString()
  const maxStates = Math.max(1, Math.min(request.maxStates ?? MAX_EXPORT_STATES, MAX_EXPORT_STATES))
  const maxBytes = Math.max(1, Math.min(request.maxBytes ?? MAX_EXPORT_PART_BYTES, MAX_EXPORT_PART_BYTES))
  const query = { passportId }

  let snapshot: Snapshot
  let after: number
  let index: number
  if (request.cursor == null || request.cursor === '') {
    snapshot = await request.paginator.takeSnapshot()
    after = 0
    index = 1
    if ((await request.paginator.readFrom(query, snapshot, 0, 1)).length === 0) return undefined
  } else {
    ;({ snapshot, after, part: index } = request.paginator.openExportCursor(request.cursor, query))
  }

  // One row beyond the state bound tells whether the snapshot continues;
  // the byte bound may close the part earlier, and then it continues too.
  const candidates = await request.paginator.readFrom(query, snapshot, after, maxStates + 1)
  const files = new PackageFiles()
  const taken: DppRecord[] = []
  let more = candidates.length > maxStates
  for (const row of candidates.slice(0, maxStates)) {
    const held = await readHeld(row, request.engineStorage)
    const weight = (held.raw?.length ?? 0) + (held.beef?.length ?? 0)
    if (taken.length > 0 && files.bytes + weight > maxBytes) { more = true; break }
    files.addState(held)
    taken.push(row)
  }
  const last = taken[taken.length - 1]
  const to = more && last != null ? last.sequence : snapshot.sequence
  const from = Math.min(after + 1, to)
  const policy = request.publisherPolicy
  files.addPolicy(policy)
  files.addObservations(taken, snapshot, exportedAt, index)

  const final = !more
  const single = index === 1 && final
  const tip = more ? undefined : [...taken].reverse().find((row) => !row.spent)
  const observed = last ?? undefined
  const spendResult: SourceObservation['result'] = observed == null ? 'not-found' : observed.spent ? 'spent' : 'unspent'
  const { exporterId, sign } = signedBy(request.signingKey)
  const unsigned: UnsignedEvidenceManifest = {
    format: EVIDENCE_PACKAGE_FORMAT,
    version: EVIDENCE_PACKAGE_VERSION,
    passportId,
    ...(index === 1 && isGenesis(taken[0]) ? { genesis: { txid: taken[0].txid, outputIndex: taken[0].outputIndex } } : {}),
    ...(tip == null ? {} : { selectedTip: { txid: tip.txid, outputIndex: tip.outputIndex } }),
    exportedAt,
    exporter: { id: exporterId, role: 'overlay', software: request.software },
    profiles: [operatorProfileOf(policy)],
    policyId: policyIdOf(policy),
    disclosure: { scope: 'public', recoveryBackup: false },
    completeness: {
      // A part is complete for its own range and never for the snapshot,
      // unless it is the only part; the wrapper and the reader's join say
      // whether the parts together cover the snapshot.
      snapshots: [{
        source: DPP_SERVICE,
        snapshotId: snapshot.id,
        completeForSnapshot: single,
        scope: exportScopeText(passportId, snapshot.id, index, from, to, final),
      }],
      withheld: [...WITHHELD_TIERS],
      absent: files.absent,
    },
    sources: [{ id: DPP_SERVICE, kind: 'spend-status', observedAt: exportedAt, result: spendResult }],
    inventory: files.inventory,
    signature: { suite: 'bsv-ecdsa-der', signer: exporterId },
  }
  const manifest = await signEvidenceManifest(unsigned, { sign })
  // The coverage record, signed by the same key and bound to the manifest
  // exactly as signed: the cursor stays outside it, being a resumption token
  // of this process and no statement about coverage.
  const coverage: Omit<EvidenceExportPart, 'nextCursor' | 'package'> = {
    exportVersion: EVIDENCE_EXPORT_VERSION,
    passportId,
    snapshot: { source: DPP_SERVICE, id: snapshot.id, sequence: snapshot.sequence },
    part: { index, sequenceRange: { from, to }, states: taken.length },
    final,
    manifestSha256: exportManifestDigest(manifest),
    signature: { suite: 'bsv-ecdsa-der', signer: exporterId, value: '' },
  }
  coverage.signature.value = Utils.toHex(await sign(exportCoveragePreimage(coverage)))
  return {
    ...coverage,
    nextCursor: more && last != null ? request.paginator.mintExportCursor(snapshot, query, last.sequence, index + 1) : null,
    package: { manifest, files: files.envelope() },
  }
}

/** The envelope's file map as `inspectEvidencePackage` takes it. */
export function envelopeFiles(envelope: EvidencePackageEnvelope): Map<string, number[]> {
  return new Map(Object.entries(envelope.files).map(([path, base64]) => [path, Utils.toArray(base64, 'base64')]))
}

export interface JoinedEvidenceExport {
  passportId?: string
  snapshotId?: string
  /** True only when every part of the snapshot is present, in order, tiling its range, each package inspecting clean, and the final part is last. */
  complete: boolean
  problems: string[]
  manifests: EvidencePackageManifest[]
  /** Every inventoried file across the parts, by path; a path repeated across parts is admitted only with identical bytes. */
  files: Map<string, number[]>
  /** The absences every part declared, by reference. */
  absent: string[]
}

/**
 * Join the parts of one complete export as a reader does. First each part on
 * its own: the coverage signature under the exporter's key, the binding of
 * the package to the record by digest, the agreement of the signed manifest
 * with the record, and the package on its three questions. Only a part that
 * passes all of that says anything about coverage; then, across the parts
 * that do: the same passport, the same snapshot, the same exporter, indexes
 * 1 to n with no repeat, ranges that tile the snapshot from 1 to its
 * sequence with no gap and no overlap, and the signed final flag on the last
 * part alone, ending at the snapshot's sequence. Anything else is a problem
 * by sentence and `complete` is false. The join establishes what the
 * exporter asserted it held at that snapshot and that every part of that
 * assertion arrived; a reader still verifies every transaction, proof and
 * signature inside, and no signature proves the exporter held everything
 * that exists elsewhere.
 */
export function joinEvidenceExport(parts: EvidenceExportPart[], options: { expectedPassportId?: string; expectedSigner?: string } = {}): JoinedEvidenceExport {
  const problems: string[] = []
  const files = new Map<string, number[]>()
  const manifests: EvidencePackageManifest[] = []
  const absent: string[] = []
  if (parts.length === 0) return { complete: false, problems: ['no parts were supplied'], manifests, files, absent }

  // The signer every part must carry: the expected one, else the first part's coverage signer.
  const signer = options.expectedSigner ?? parts.find((p) => typeof p.signature?.signer === 'string')?.signature.signer
  const trusted: EvidenceExportPart[] = []
  for (const part of parts) {
    const inspection = inspectEvidenceExportPart(part, { ...(options.expectedPassportId == null ? {} : { expectedPassportId: options.expectedPassportId }), ...(signer == null ? {} : { expectedSigner: signer }) })
    problems.push(...inspection.failures)
    if (inspection.coverageAuthentic === true && inspection.manifestBound && inspection.package.structureValid && inspection.package.inventoryVerified && inspection.package.signatureValid === true) trusted.push(part)
    else problems.push(`part ${part.part?.index}: its coverage is not established, so its range, index and finality are not counted`)
  }
  if (trusted.length === 0) return { complete: false, problems, manifests, files, absent }

  const ordered = [...trusted].sort((a, b) => a.part.index - b.part.index)
  const head = ordered[0]
  const passportId = head.passportId
  const snapshotId = head.snapshot.id
  if (options.expectedPassportId != null && passportId !== options.expectedPassportId) problems.push(`the export is about ${passportId}, not ${options.expectedPassportId}`)

  let expectFrom = 1
  for (const [position, part] of ordered.entries()) {
    const label = `part ${part.part.index}`
    if (part.exportVersion !== EVIDENCE_EXPORT_VERSION) problems.push(`${label} is export version ${String(part.exportVersion)}, not ${EVIDENCE_EXPORT_VERSION}`)
    if (part.passportId !== passportId) problems.push(`${label} is about ${part.passportId}, not ${passportId}`)
    if (part.snapshot.id !== snapshotId || part.snapshot.sequence !== head.snapshot.sequence || part.snapshot.source !== head.snapshot.source) problems.push(`${label} is from snapshot ${part.snapshot.id}, not ${snapshotId}`)
    if (part.part.index !== position + 1) problems.push(position > 0 && ordered[position - 1].part.index === part.part.index ? `${label} is repeated` : `${label} arrived where part ${position + 1} was expected`)
    const { from, to } = part.part.sequenceRange
    if (from < expectFrom) problems.push(`${label} covers ${from}..${to}, overlapping the sequences already joined up to ${expectFrom - 1}`)
    else if (from > expectFrom) problems.push(`${label} covers ${from}..${to}; sequences ${expectFrom}..${from - 1} are missing`)
    if (to < from) problems.push(`${label} covers ${from}..${to}, which is not a range`)
    expectFrom = Math.max(expectFrom, to + 1)
    const isLast = position === ordered.length - 1
    // Finality is the signed flag; the unsigned cursor merely has to agree with it.
    if (part.final !== (part.nextCursor == null)) problems.push(`${label} says final ${String(part.final)} but nextCursor is ${part.nextCursor == null ? 'null' : 'set'}`)
    if (part.final && !isLast) problems.push(`${label} is final but parts follow it`)
    if (isLast && !part.final) problems.push(`${label} is the last part received and is not final`)
    if (isLast && part.final && to !== part.snapshot.sequence) problems.push(`${label} is final and ends at ${to}, not at the snapshot's sequence ${part.snapshot.sequence}`)

    const manifest = part.package.manifest
    manifests.push(manifest)
    absent.push(...(Array.isArray(manifest.completeness?.absent) ? manifest.completeness.absent : []))
    for (const [path, bytes] of envelopeFiles(part.package)) {
      const seen = files.get(path)
      if (seen == null) { files.set(path, bytes); continue }
      if (sha256Hex(seen) !== sha256Hex(bytes)) problems.push(`${label}: ${path} repeats an earlier part's path with different bytes`)
    }
  }
  return { passportId, snapshotId, complete: problems.length === 0, problems, manifests, files, absent }
}
