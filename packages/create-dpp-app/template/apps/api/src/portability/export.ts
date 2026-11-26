// The complete export of this application, as one `dpp-evidence-package@1`.
//
// Everything here is assembled from parts the packages already produce. The
// index's evidence for each passport is the package the index itself signs.
// The profiles are the bundle `exportProfileBundle` makes. The EPCIS exchange
// is the snapshot `exportEpcisRecovery` takes, or the public form
// `exportEpcisPublicEvidence` gives. This file asks for each, adds this
// application's own records, lists every file once in one inventory, and
// signs the manifest. It builds no transaction, announces nothing and changes
// no record: an export reads.
//
// There are two exports and they are different access paths. The authorised
// one is for the operator of this deployment, who is moving it or keeping a
// backup: it carries the journals with their sealed owner tiers, the brands,
// the offers, the claims and the operational records of the exchange. The
// public one carries only what anyone may hold. Neither carries a key, a
// wallet file, a secret or a credential, and before anything is handed over
// every byte is searched for each secret this deployment was configured
// with.
//
// What a signature on the manifest says: that this application, under its
// publisher key, assembled these bytes. It does not say they are true or
// complete beyond what the manifest declares, and it gives no profile any
// authority at the place the package is restored.
import { Transaction, Utils } from '@bsv/sdk'
import {
  ACCEPTANCE_RECORD_REPRESENTATIONS,
  EVIDENCE_PACKAGE_FORMAT,
  EVIDENCE_PACKAGE_PROTOCOL,
  EVIDENCE_PACKAGE_VERSION,
  MANAGED_CUSTODY_EXPORT_PROFILE,
  acceptanceCommitment,
  bindAcceptanceToState,
  evidencePackageSigner,
  findDppOutputs,
  inspectEvidencePackage,
  inspectManagedAcceptance,
  publicCustodyTransfers,
  signEvidenceManifest,
  verifyServerSignature,
  verifyUserSignature,
  type DppStateV2,
  type ManagedAcceptanceRecord,
  type EvidencePackageManifest,
  type InventoryCategory,
  type InventoryEntry,
  type SourceObservation,
} from '@bsv/dpp-protocol'
import {
  EPCIS_LIFECYCLE_MEDIA_TYPE,
  EPCIS_LIFECYCLE_REPRESENTATION,
} from '@bsv/dpp-credentials/epcis-lifecycle'
import { describeProfileBundleOmission, exportProfileBundle, isRetiredProfile } from '@bsv/dpp-profiles'
import { EPCIS_GS1_ARTEFACTS } from '@bsv/dpp-credentials'
import { exportEpcisPublicEvidence, exportEpcisRecovery, type EpcisExchangeStorage, type EpcisSourceCredential, type ExportedEpcisRecovery } from '@bsv/dpp-credentials/epcis-exchange'
import type { Config } from '../config.js'
import { acceptanceMatchesOffer } from '../custody.js'
import { describeEpcisSource, type EpcisSourceConfig } from '../epcis/sources.js'
import type { Platform } from '../platform.js'
import { isProfileId } from '../profiles.js'
import type { PassportReading } from '../reader.js'
import { isEpcisLifecycleRecord, isInterrupted, type OfferRecord, type PassportRecord } from '../store.js'
import {
  APPLICATION_EXPORT_DESCRIPTOR,
  APPLICATION_EXPORT_FORMAT,
  APPLICATION_EXPORT_LIMITS,
  APPLICATION_EXPORT_VERSION,
  APPLICATION_REPRESENTATIONS,
  EPCIS_ROOT,
  PROFILES_ROOT,
  PortabilityRefused,
  asNumberArrays,
  entryOf,
  exportScopeId,
  passportFolder,
  readNestedAcceptance,
  recordBytes,
  sha256Hex,
  utf8,
  type ApplicationExportAccess,
  type ApplicationExportDescriptor,
  type ApplicationExportOmission,
  type ExportedPassport,
  type ExportedReading,
} from './package.js'

const JSON_MEDIA_TYPE = 'application/json'
const SOFTWARE = 'create-dpp-app application'

export interface ExportApplicationInput {
  platform: Platform
  /** The exchange's store and the sources this deployment was configured with. The credentials are read to search for them, and are written nowhere. */
  epcis: { storage: EpcisExchangeStorage; sources: EpcisSourceConfig[] }
  access: ApplicationExportAccess
  /** The successor carriage rules apply only when explicitly selected. */
  custodyProfile?: typeof MANAGED_CUSTODY_EXPORT_PROFILE
  /** The passports to cover. Default: every passport in the journal. */
  passportIds?: readonly string[]
  /**
   * A public export only: the source scopes whose imports may be published.
   * There is no default, because nothing here knows which sources a
   * deployment may publish, so a public export with none named carries
   * nothing of the exchange.
   */
  publicSources?: readonly string[]
  /** An authorised export only: whether the cursors of pulls are carried. Left out by default, so each unfinished pull replays from its bounds. */
  cursors?: 'exclude' | 'include'
  /** `complete` asks the index for its complete export even where its bounded package would do. For a test. */
  indexRoute?: 'auto' | 'complete'
  now?: () => Date
  log?: (line: string) => void
}

export interface ExportedApplication {
  manifest: EvidencePackageManifest
  /** Every file by its path in the package, the manifest left out. */
  files: Map<string, Uint8Array>
  descriptor: ApplicationExportDescriptor
  /** The key the manifest is signed under, and the identity key it derives from. A destination needs the second. */
  exporter: { identityKey: string; signer: string }
}

/** A reading in the terms an export carries and a restore compares: outcomes, never values. */
export function summariseReading(reading: PassportReading, chainTracker: Platform['chainTracker']): ExportedReading {
  return {
    passportId: reading.passportId,
    chainTracker: chainTracker === 'scripts only' ? 'scripts only' : 'header-source',
    lineage: reading.lineage.map((state) => ({ op: state.op, txid: state.txid })),
    checks: reading.checks.map((check) => ({ name: check.name, status: check.status, ...(check.reasonCode == null ? {} : { reasonCode: check.reasonCode }) })),
    payloadChecks: reading.payloadChecks.map((check) => ({
      txid: check.txid,
      stateIndex: check.stateIndex,
      profile: check.profile,
      status: check.publicView.status,
      ...(check.publicView.cause == null ? {} : { cause: check.publicView.cause }),
      steps: check.publicView.steps.map((step) => ({ step: step.step, status: step.status, ...(step.cause == null ? {} : { cause: step.cause }) })),
      findings: check.publicView.findings.map((finding) => ({ step: finding.step, severity: finding.severity, constraint: finding.constraint, ...(finding.path == null ? {} : { path: finding.path }), ...(finding.message == null ? {} : { message: finding.message }) })),
      withheld: check.publicView.withheld,
    })),
  }
}

/** The binding digest a state's public payload declares, when it is a product document under a binding. */
export function declaredBindingDigest(payloadPublic: string): string | undefined {
  try {
    const parsed = JSON.parse(payloadPublic) as { profile_binding_sha256?: unknown }
    return typeof parsed?.profile_binding_sha256 === 'string' && /^[0-9a-f]{64}$/.test(parsed.profile_binding_sha256) ? parsed.profile_binding_sha256 : undefined
  } catch {
    return undefined
  }
}

/** Every secret this deployment was configured with, to search an export for. Each is read here and written nowhere. */
function configuredSecrets(config: Config, credentials: readonly EpcisSourceCredential[]): string[] {
  const secrets = [config.wallet.rootKeyHex, config.brandRootSecret, config.managedIdentitySecret, config.authSecret, config.index.submitToken, config.index.callbackToken, config.registry.token, config.validator.token, config.indexExport.token, config.wallet.wocApiKey]
  for (const credential of credentials) {
    if (credential.scheme === 'bearer') secrets.push(credential.token)
    else if (credential.scheme === 'basic') secrets.push(credential.password, Buffer.from(`${credential.username}:${credential.password}`).toString('base64'))
    else secrets.push(credential.value)
  }
  // A secret shorter than this would be found by chance in a digest or a transaction, and no setting of this application is one.
  return [...new Set(secrets.filter((secret): secret is string => typeof secret === 'string' && secret.length >= 8))]
}

/** The first file that holds a configured secret, in any of the forms a secret is passed around in. */
function secretCarrier(files: ReadonlyMap<string, Uint8Array>, manifestText: string, secrets: readonly string[], rawDigests: readonly string[] = []): string | undefined {
  const forms = secrets.flatMap((secret) => [secret, encodeURIComponent(secret), Buffer.from(secret, 'utf8').toString('base64'), Buffer.from(secret, 'utf8').toString('base64url'), Buffer.from(secret, 'utf8').toString('hex')]).map((form) => Buffer.from(form, 'utf8'))
  forms.push(...rawDigests.map(digest => Buffer.from(digest, 'hex')))
  const holds = (bytes: Uint8Array): boolean => {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return forms.some((form) => buffer.includes(form))
  }
  if (holds(utf8(manifestText))) return 'manifest.json'
  for (const [path, bytes] of files) if (holds(bytes)) return path
  return undefined
}

/** What the index gave for one passport, placed under the passport's folder and checked. */
interface IndexEvidence {
  summary: ExportedPassport['index']
  files: Array<{ path: string; bytes: Uint8Array; category: InventoryCategory; mediaType: string; represents?: string; representation?: string; acceptance?: ManagedAcceptanceRecord }>
  snapshots: EvidencePackageManifest['completeness']['snapshots']
  absent: string[]
  sources: SourceObservation[]
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * The index's own evidence for one passport, through the routes it already
 * serves. The bounded package is asked for first. Where the lineage is longer
 * than its bound, the complete export is asked for, part by part. Whatever
 * arrives is inspected under the index's exporter key before it is carried,
 * and an answer that does not inspect stops the export: evidence that cannot
 * be checked here is not passed on as if it had been.
 */
async function indexEvidenceFor(input: ExportApplicationInput, passportId: string, folder: string, exporterKey: string | undefined, observedAt: string): Promise<IndexEvidence> {
  const { index, config } = input.platform
  const none = (reason: string, result: SourceObservation['result']): IndexEvidence => ({
    summary: { form: 'none', reason },
    files: [],
    snapshots: [],
    absent: [`index-evidence:${passportId} (${reason})`],
    sources: [{ id: 'ls_dpp', kind: 'overlay-lookup', observedAt, result }],
  })
  const refuse = (detail: string, failures: string[]): never => {
    throw new PortabilityRefused('index-evidence-refused', `The index's evidence for ${passportId} does not check: ${detail} Nothing was exported.`, { passportId, failures })
  }
  const place = (base: string, manifest: EvidencePackageManifest, encoded: Record<string, string>, into: IndexEvidence['files']): void => {
    const carriesAcceptances = manifest.inventory.some(entry => ACCEPTANCE_RECORD_REPRESENTATIONS.some(format => entry.representation === format))
    if (input.access === 'public-evidence') {
      if (manifest.disclosure.scope !== 'public' || manifest.disclosure.recoveryBackup || carriesAcceptances) {
        refuse('its disclosure scope or acceptance records cannot be carried by this public export.', [])
      }
    }
    into.push({ path: `${base}/manifest.json`, bytes: utf8(JSON.stringify(manifest)), category: 'reports', mediaType: JSON_MEDIA_TYPE, represents: passportId, representation: APPLICATION_REPRESENTATIONS.indexManifest })
    for (const entry of manifest.inventory) {
      const bytes = Uint8Array.from(Buffer.from(encoded[entry.path] ?? '', 'base64'))
      const acceptance = input.custodyProfile === MANAGED_CUSTODY_EXPORT_PROFILE && input.access === 'authorised-recovery'
        ? readNestedAcceptance(entry, bytes, passportId, input.platform.wallet.identityKey) : undefined
      const representation = acceptance == null ? entry.representation : APPLICATION_REPRESENTATIONS.nestedAuthority
      into.push({ path: `${base}/${entry.path}`, bytes, category: entry.category, mediaType: entry.mediaType, ...(entry.represents == null ? {} : { represents: entry.represents }), ...(representation == null ? {} : { representation }), ...(acceptance == null ? {} : { acceptance }) })
    }
  }
  const signerFor = (manifest: EvidencePackageManifest): string | undefined => {
    if (exporterKey == null) return undefined
    // An index on an earlier release signed with its raw export key and names it as both. It still inspects under that key.
    return manifest.exporter?.id === exporterKey && manifest.signature?.signer === exporterKey ? exporterKey : evidencePackageSigner(exporterKey, passportId)
  }

  const bounded = input.indexRoute === 'complete' ? undefined : await index.evidencePackage(passportId)
  if (bounded != null && 'absent' in bounded) return none(bounded.detail, bounded.absent === 'not-held' ? 'not-found' : 'unavailable')
  if (bounded != null) {
    const manifest = bounded.envelope.manifest as EvidencePackageManifest
    const encoded = isObject(bounded.envelope.files) ? (bounded.envelope.files as Record<string, string>) : {}
    const expectedSigner = signerFor(manifest)
    const inspection = inspectEvidencePackage(manifest, new Map(Object.entries(encoded).map(([path, base64]) => [path, Utils.toArray(base64, 'base64') as number[]])), { expectedPassportId: passportId, ...(expectedSigner == null ? {} : { expectedSigner }) })
    if (!inspection.structureValid || !inspection.inventoryVerified || inspection.signatureValid !== true || inspection.failures.length > 0) refuse('its package fails inspection.', inspection.failures.map((failure) => failure.detail))
    const complete = manifest.completeness.snapshots.every((snapshot) => snapshot.completeForSnapshot)
    if (complete) {
      const files: IndexEvidence['files'] = []
      place(`${folder}/index`, manifest, encoded, files)
      return { summary: { form: 'package', exporter: manifest.exporter.id, snapshotId: manifest.completeness.snapshots[0]?.snapshotId, states: manifest.inventory.filter((entry) => entry.category === 'transactions').length }, files, snapshots: manifest.completeness.snapshots, absent: manifest.completeness.absent, sources: manifest.sources }
    }
    // The lineage is longer than the package's bound. The complete export tiles the whole snapshot; when it cannot be had, the bounded package is carried and says what it lacks.
    const whole = await completeExport()
    if (whole != null) return whole
    const files: IndexEvidence['files'] = []
    place(`${folder}/index`, manifest, encoded, files)
    return { summary: { form: 'bounded-package', exporter: manifest.exporter.id, snapshotId: manifest.completeness.snapshots[0]?.snapshotId, states: manifest.inventory.filter((entry) => entry.category === 'transactions').length, reason: 'the lineage is longer than the bound of the index\'s package, and its complete export could not be had' }, files, snapshots: manifest.completeness.snapshots, absent: manifest.completeness.absent, sources: manifest.sources }
  }
  const whole = await completeExport()
  if (whole != null) return whole
  return none('the index gave no part of its complete export', 'unavailable')

  /** The index's complete export, joined as a reader joins it. Undefined when the index would not give it. */
  async function completeExport(): Promise<IndexEvidence | undefined> {
    const { joinEvidenceExport } = await import('@bsv/dpp-overlay')
    const parts: Array<Record<string, unknown>> = []
    let cursor: string | null = null
    for (;;) {
      const answer = await index.evidenceExportPart(passportId, cursor, config.indexExport.token)
      if ('absent' in answer) {
        input.log?.(`The index's complete export for ${passportId} could not be had: ${answer.detail}.`)
        return undefined
      }
      parts.push(answer.part)
      cursor = typeof answer.part.nextCursor === 'string' ? answer.part.nextCursor : null
      if (cursor == null) break
      if (parts.length > 10_000) refuse('its complete export does not end.', [])
    }
    const first = parts[0] as { package?: { manifest?: EvidencePackageManifest } }
    const expectedSigner = first.package?.manifest == null ? undefined : signerFor(first.package.manifest)
    const joined = joinEvidenceExport(parts as never, { expectedPassportId: passportId, ...(expectedSigner == null ? {} : { expectedSigner }) })
    if (!joined.complete) refuse('the parts of its complete export do not join into one snapshot.', joined.problems)
    const files: IndexEvidence['files'] = []
    const snapshots: IndexEvidence['snapshots'] = []
    const sources: SourceObservation[] = []
    let states = 0
    parts.forEach((part, at) => {
      const { package: carried, nextCursor: _cursor, ...coverage } = part as { package: { manifest: EvidencePackageManifest; files: Record<string, string> }; nextCursor: unknown }
      const base = `${folder}/index/part-${at + 1}`
      // The coverage record is what the index signed about this part. Its cursor is not part of what it signed and is not carried.
      files.push({ path: `${base}/coverage.json`, bytes: utf8(JSON.stringify(coverage)), category: 'reports', mediaType: JSON_MEDIA_TYPE, represents: `${passportId} part ${at + 1}`, representation: APPLICATION_REPRESENTATIONS.indexCoverage })
      place(base, carried.manifest, carried.files, files)
      snapshots.push(...carried.manifest.completeness.snapshots)
      sources.push(...carried.manifest.sources)
      states += carried.manifest.inventory.filter((entry) => entry.category === 'transactions').length
    })
    return { summary: { form: 'export-parts', exporter: joined.manifests[0]?.exporter.id, ...(joined.snapshotId == null ? {} : { snapshotId: joined.snapshotId }), parts: parts.length, states }, files, snapshots, absent: joined.absent, sources }
  }
}

/** The selected journals, read twice and kept only when both readings agree, so what is carried stood together at one moment. */
async function readJournals(input: ExportApplicationInput): Promise<PassportRecord[]> {
  const { store } = input.platform
  const read = async (): Promise<PassportRecord[]> => {
    const all = (await store.listPassports()).filter((record) => record.states.length > 0)
    if (input.passportIds == null) return all.sort((a, b) => (a.passportId < b.passportId ? -1 : 1))
    const wanted = [...new Set(input.passportIds)]
    const missing = wanted.filter((passportId) => !all.some((record) => record.passportId === passportId))
    if (missing.length > 0) throw new PortabilityRefused('passport-unknown', `This application's journal holds no passport ${missing.join(', ')}. Nothing was exported.`, { passportIds: missing })
    return all.filter((record) => wanted.includes(record.passportId)).sort((a, b) => (a.passportId < b.passportId ? -1 : 1))
  }
  const first = await read()
  const second = await read()
  if (sha256Hex(recordBytes(first)) !== sha256Hex(recordBytes(second))) {
    throw new PortabilityRefused('store-unstable', 'A passport changed while it was being read. Another writer is at work: stop the API and its worker, then export again.')
  }
  return first
}

/** The transfers anyone can read in the index files actually included for this passport. */
function publicTransfers(evidence: IndexEvidence, passportId: string): DppStateV2[] {
  const transfers: DppStateV2[] = []
  for (const file of evidence.files) {
    if (file.category !== 'transactions' || file.representation !== 'raw-transaction') continue
    for (const { state } of findDppOutputs(Transaction.fromBinary(Array.from(file.bytes)))) {
      if (state.version === '2' && state.op === 'TRANSFER' && state.passportId === passportId && state.authorisationCommitment) transfers.push(state)
    }
  }
  return transfers
}

/** Only a successful network answer (or the test wallet's dry run) completes a journalled handover. */
function journalTransfers(passport: PassportRecord, publisherKey: string) {
  const completed: DppStateV2[] = []
  const interrupted: DppStateV2[] = []
  for (const [at, entry] of passport.states.entries()) {
    let tx: Transaction
    try {
      tx = Transaction.fromHex(entry.rawTx)
    } catch {
      throw new PortabilityRefused('record-invalid', 'A journal transaction cannot be decoded.', { passportId: passport.passportId, txid: entry.txid })
    }
    const outputs = findDppOutputs(tx)
    const output = outputs[0]
    if (tx.id('hex') !== entry.txid || outputs.length !== 1 || output?.outputIndex !== entry.outputIndex
      || output.state.passportId !== passport.passportId || output.state.op !== entry.op) {
      throw new PortabilityRefused('records-inconsistent', 'A journal entry differs from its transaction.', { passportId: passport.passportId, txid: entry.txid })
    }
    const { state } = output
    if (state.version !== '2' || state.op !== 'TRANSFER' || !state.authorisationCommitment) continue
    const prior = passport.states[at - 1]
    if (prior == null || state.previousTxid !== prior.txid || state.previousOutputIndex !== prior.outputIndex
      || !tx.inputs.some(input => input.sourceTXID === prior.txid && input.sourceOutputIndex === prior.outputIndex)
      || !verifyUserSignature(state) || !verifyServerSignature(state, publisherKey)) {
      throw new PortabilityRefused('records-inconsistent', 'A transfer does not verify for its journal predecessor and publisher.', { passportId: passport.passportId, txid: entry.txid })
    }
    if (entry.network === 'accepted' || entry.network === 'dry-run') completed.push(state)
    else if (isInterrupted(entry)) interrupted.push(state)
    else throw new PortabilityRefused('records-inconsistent', 'The transfer has an unrecognised send outcome.', { passportId: passport.passportId, txid: entry.txid })
  }
  return { completed, interrupted }
}

/** Resolve commitment dispositions and recovery copies from the records this custodian actually holds. */
function custodyEvidence(passport: PassportRecord, offers: OfferRecord[], transfers: DppStateV2[], custodian: string, nested: ManagedAcceptanceRecord[], interrupted?: DppStateV2[]) {
  const authorised = interrupted != null
  const held = new Map<string, ManagedAcceptanceRecord>()
  for (const record of [...passport.acceptanceRecords, ...passport.states.flatMap(entry => entry.acceptance ?? []), ...offers.flatMap(offer => offer.record ?? [])]) {
    held.set(acceptanceCommitment(record), record)
  }
  const referenced = new Map(transfers.map(state => [state.authorisationCommitment, state]))
  for (const record of nested) {
    const commitment = acceptanceCommitment(record)
    const state = referenced.get(commitment)
    if (state == null || bindAcceptanceToState(record, state).length > 0) {
      throw new PortabilityRefused('index-evidence-refused', 'A signed index acceptance does not bind to a completed transfer in the supplied history.', { passportId: passport.passportId, commitment })
    }
    held.set(commitment, record)
  }
  const byRequest = new Map(Array.from(held.values(), record => [record.requestId, record]))
  const authority = new Map<string, ManagedAcceptanceRecord>()
  const absent: string[] = []
  const withheld: string[] = []
  for (const state of transfers) {
    const commitment = state.authorisationCommitment
    const reference = `acceptance:sha256:${commitment}`
    const record = held.get(commitment)
    if (record == null) {
      absent.push(reference)
      continue
    }
    if (inspectManagedAcceptance(record, { custodians: [custodian] }).failures.length || bindAcceptanceToState(record, state).length) {
      throw new PortabilityRefused('records-inconsistent', 'A held acceptance does not verify for the transfer that commits to it.', { passportId: passport.passportId, commitment })
    }
    if (authorised) authority.set(commitment, record)
    else withheld.push(`${reference} not-public`)
  }

  // Reattach the original record to its offer if the journal holds the only copy.
  const offerCopies: OfferRecord[] = []
  if (authorised) {
    const acceptedOffers = new Map<string, ManagedAcceptanceRecord>()
    for (const offer of offers) {
      const accepted = offer.status === 'accepted' || offer.status === 'transferred'
      const record = offer.record ?? (accepted ? byRequest.get(offer.requestId) : undefined)
      if (record != null && (!accepted || !acceptanceMatchesOffer(offer, record, passport, custodian))) {
        throw new PortabilityRefused('records-inconsistent', 'A signed acceptance does not verify for its retained offer.', { requestId: offer.requestId })
      }
      if (offer.status === 'accepted') {
        if (record == null) throw new PortabilityRefused('records-inconsistent', 'An accepted offer has lost its signed record.', { requestId: offer.requestId })
        acceptedOffers.set(acceptanceCommitment(record), record)
      }
      offerCopies.push(record != null && offer.record == null ? { ...offer, record } : offer)
    }
    for (const state of interrupted) {
      const record = acceptedOffers.get(state.authorisationCommitment)
      if (record == null || bindAcceptanceToState(record, state).length > 0) {
        throw new PortabilityRefused('records-inconsistent', 'An interrupted transfer lacks its matching signed offer.', { passportId: passport.passportId })
      }
    }
  }
  const pending = authorised ? [] : offers.flatMap(offer => {
    const record = offer.record ?? byRequest.get(offer.requestId)
    if (offer.status !== 'accepted' || record == null) return []
    const commitment = acceptanceCommitment(record)
    return referenced.has(commitment) ? [] : [commitment]
  })
  return { authority: [...authority.values()], offers: offerCopies, absent, withheld, pending }
}

export async function exportApplication(input: ExportApplicationInput): Promise<ExportedApplication> {
  const { platform, access } = input
  const { config, store, wallet, profiles } = platform
  const authorised = access === 'authorised-recovery'
  if (input.custodyProfile != null && input.custodyProfile !== MANAGED_CUSTODY_EXPORT_PROFILE) {
    throw new PortabilityRefused('not-selected', 'The requested custody export profile is unavailable.')
  }
  const v3 = input.custodyProfile === MANAGED_CUSTODY_EXPORT_PROFILE
  const exportedAt = (input.now?.() ?? new Date()).toISOString()
  const credentials = input.epcis.sources.flatMap((source) => (source.credentials == null ? [] : [source.credentials()]))

  const files = new Map<string, Uint8Array>()
  const inventory: InventoryEntry[] = []
  const add = (path: string, category: InventoryCategory, mediaType: string, bytes: Uint8Array, extra: Pick<InventoryEntry, 'encrypted' | 'represents' | 'representation'> = {}): void => {
    if (files.has(path)) throw new PortabilityRefused('path-duplicate', `Two files of the export would share the name ${path}.`, { path })
    files.set(path, bytes)
    inventory.push(entryOf(path, category, mediaType, bytes, extra))
  }
  const snapshots: EvidencePackageManifest['completeness']['snapshots'] = []
  const withheld: string[] = []
  const absent: string[] = []
  const sources: SourceObservation[] = []
  const omitted: ApplicationExportOmission[] = []

  /* ---- the passports: the index's evidence, this application's records and a reading ---- */

  const journals = await readJournals(input)
  const exportId = exportScopeId(journals.map((record) => record.passportId))
  const exporterKey = journals.length === 0 ? undefined : (config.indexExport.exporterKey ?? (await platform.index.exporterIdentityKey().catch(() => undefined)))
  const passports: ExportedPassport[] = []
  const journalCopies: PassportRecord[] = []
  const pendingCommitments: string[] = []
  const brandIds = new Set<string>()
  let offers = 0
  let claims = 0
  // A claim that binds several passports is carried once, however many of them the export holds.
  const claimsCarried = new Set<string>()
  for (const record of journals) {
    const folder = passportFolder(record.passportId)
    const evidence = await indexEvidenceFor(input, record.passportId, folder, exporterKey, exportedAt)
    for (const file of evidence.files) add(file.path, file.category, file.mediaType, file.bytes, { ...(file.represents == null ? {} : { represents: file.represents }), ...(file.representation == null ? {} : { representation: file.representation }) })
    snapshots.push(...evidence.snapshots)
    // Each nested manifest states what the index holds. The writer may hold a record the index lacks.
    const passportOffers = await store.listOffers({ passportId: record.passportId })
    let journal = record
    let offerCopies = passportOffers
    if (v3) {
      // A handover may have changed the journal between its snapshot and the offer read.
      if (sha256Hex(recordBytes(record)) !== sha256Hex(recordBytes(await store.getPassport(record.passportId) ?? null))) {
        throw new PortabilityRefused('store-unstable', 'The passport changed while its custody offers were being read.', { passportId: record.passportId })
      }
      const history = authorised ? journalTransfers(record, wallet.identityKey) : undefined
      let transfers = history?.completed
      if (transfers == null) {
        try {
          transfers = evidence.files.flatMap(file => publicCustodyTransfers(file, file.bytes)).filter(state => state.passportId === record.passportId)
        } catch {
          throw new PortabilityRefused('index-evidence-refused', 'The index evidence cannot be carried as public custody evidence.', { passportId: record.passportId })
        }
      }
      const custody = custodyEvidence(record, passportOffers, transfers, wallet.identityKey, evidence.files.flatMap(file => file.acceptance ?? []), history?.interrupted)
      journal = { ...record, acceptanceRecords: custody.authority }
      offerCopies = custody.offers
      // The nested signature retains the index's dispositions. The outer signature states the custodian's.
      absent.push(...evidence.absent.filter(reference => !/^acceptance:sha256:[0-9a-f]{64}$/.test(reference)), ...custody.absent)
      withheld.push(...custody.withheld)
      pendingCommitments.push(...custody.pending)
    } else {
      const heldAcceptances = new Set(record.acceptanceRecords.map(acceptance => `acceptance:sha256:${acceptanceCommitment(acceptance)}`))
      for (const offer of passportOffers) {
        if (offer.record != null) heldAcceptances.add(`acceptance:sha256:${acceptanceCommitment(offer.record)}`)
      }
      absent.push(...evidence.absent.filter(reference => !heldAcceptances.has(reference)))
      if (!authorised) {
        for (const state of publicTransfers(evidence, record.passportId)) {
          const reference = `acceptance:sha256:${state.authorisationCommitment}`
          if (heldAcceptances.has(reference)) withheld.push(`${reference} not-public`)
          else absent.push(reference)
        }
      }
    }
    sources.push(...evidence.sources)
    journalCopies.push(journal)

    // How the passport verifies here, now, as any reader would find it. The index only finds the bytes.
    let reading: ExportedReading | undefined
    try {
      reading = summariseReading(await platform.read(record.passportId, v3 ? journal.acceptanceRecords : undefined), platform.chainTracker)
    } catch (cause) {
      absent.push(`reading:${record.passportId} (${cause instanceof Error ? cause.message : String(cause)})`)
    }
    if (reading != null) add(`${folder}/reading.json`, 'reports', JSON_MEDIA_TYPE, recordBytes(reading), { represents: record.passportId, representation: APPLICATION_REPRESENTATIONS.reading })

    const held = await store.listClaims({ passportId: record.passportId })
    if (authorised) {
      // The journal carries each state's bytes and its sealed owner tier. The tier is ciphertext, sealed to its holder's key, and stays so here.
      add(`${folder}/journal.json`, 'reports', JSON_MEDIA_TYPE, recordBytes(journal), { represents: record.passportId, representation: APPLICATION_REPRESENTATIONS.journal })
      for (const acceptance of journal.acceptanceRecords) {
        const commitment = acceptanceCommitment(acceptance)
        const path = `${folder}/authority/${commitment}.json`
        if (!files.has(path)) add(path, 'authority', JSON_MEDIA_TYPE, recordBytes(acceptance), { represents: `sha256:${commitment}`, representation: acceptance.acceptanceFormat })
      }
      for (const claim of held) {
        if (claimsCarried.has(claim.id)) continue
        claimsCarried.add(claim.id)
        add(`application/claims/${sha256Hex(claim.id)}.json`, 'native-claims', JSON_MEDIA_TYPE, recordBytes(claim), { represents: claim.id, representation: APPLICATION_REPRESENTATIONS.claim })
        // An EPCIS lifecycle claim is also carried as its exact signed bytes, which verify without this application.
        if (isEpcisLifecycleRecord(claim)) add(`application/lifecycle-claims/${sha256Hex(claim.id)}.json`, 'native-claims', EPCIS_LIFECYCLE_MEDIA_TYPE, new TextEncoder().encode(claim.bytes), { represents: claim.attestationId, representation: EPCIS_LIFECYCLE_REPRESENTATION })
        claims += 1
      }
      for (const offer of offerCopies) {
        add(`application/offers/${sha256Hex(offer.requestId)}.json`, 'reports', JSON_MEDIA_TYPE, recordBytes(offer), { represents: offer.requestId, representation: APPLICATION_REPRESENTATIONS.offer })
        offers += 1
      }
      brandIds.add(record.brandId)
    }
    const tip = record.states[record.states.length - 1]!
    const bindingDigest = declaredBindingDigest(tip.payloadPublic)
    passports.push({
      passportId: record.passportId,
      folder,
      profile: record.profile,
      ...(bindingDigest == null ? {} : { bindingDigest }),
      status: record.status,
      states: record.states.length,
      genesis: record.states[0]!.txid,
      tip: tip.txid,
      index: evidence.summary,
      acceptanceRecords: authorised ? journal.acceptanceRecords.length : 0,
      claims: authorised ? held.length : 0,
    })
  }
  let brands = 0
  if (authorised) {
    for (const brandId of [...brandIds].sort()) {
      const brand = await store.getBrand(brandId)
      if (brand == null) {
        // Said by name, so that a restore can tell a record this deployment never held from one that was left out.
        absent.push(`brand:${brandId} (this application holds no record of it)`)
        continue
      }
      add(`application/brands/${sha256Hex(brand.id)}.json`, 'reports', JSON_MEDIA_TYPE, recordBytes(brand), { represents: brand.id, representation: APPLICATION_REPRESENTATIONS.brand })
      brands += 1
    }
    snapshots.push({ source: 'application-records', snapshotId: sha256Hex(recordBytes(journalCopies)), completeForSnapshot: true, scope: `${journals.length} passport journal${journals.length === 1 ? '' : 's'} with the brands, offers and claims that belong to them, read twice and found equal` })
  }

  /* ---- the profiles those records declare ---- */

  const declared = [...new Set(journals.map((record) => record.profile))].sort()
  const carried = declared.filter((profile) => profiles.get(profile) != null)
  const named = declared.filter((profile) => profiles.get(profile) == null)
  for (const profile of named) {
    // A profile a manifest of the profiles package defines ships with that package. One this deployment holds no definition of is said to be absent.
    if (isProfileId(profile) || isRetiredProfile(profile)) withheld.push(`profile ${profile} defined-by-the-profiles-package`)
    else absent.push(`profile:${profile} (this deployment holds no definition of it)`)
  }
  let bundleProfiles: string[] = []
  if (carried.length > 0) {
    const bundle = await exportProfileBundle({
      registry: profiles.registry,
      profiles: carried,
      readNotice: (profile, path) => profiles.readNotice(profile, path),
      licenceTexts: await profiles.licenceTexts(),
      // GS1's files are named by address and digest. They are in no file of the package.
      provisioned: EPCIS_GS1_ARTEFACTS,
      root: PROFILES_ROOT,
    })
    if (!bundle.ok) throw new PortabilityRefused('profile-export-refused', `The profiles were not exported (${bundle.code}): ${bundle.detail} Nothing was exported.`, { code: bundle.code, ...(bundle.profile == null ? {} : { profile: bundle.profile }) })
    bundle.inventory.forEach((entry) => add(entry.path, entry.category, entry.mediaType, bundle.files.get(entry.path)!, { represents: entry.represents, representation: entry.representation }))
    withheld.push(...bundle.manifest.withheld)
    bundleProfiles = bundle.manifest.profiles
  }
  for (const artefact of EPCIS_GS1_ARTEFACTS) {
    const line = describeProfileBundleOmission(artefact)
    if (!withheld.includes(line)) withheld.push(line)
  }
  omitted.push({ what: 'gs1-files', reason: 'provisioned-by-destination', detail: `${EPCIS_GS1_ARTEFACTS.length} files GS1 publishes, each named by address and digest in the manifest` })

  /* ---- the EPCIS exchange ---- */

  let epcis: ApplicationExportDescriptor['epcis'] = { scopes: [] }
  let snapshot: ExportedEpcisRecovery | undefined
  if (authorised) {
    const exported = await exportEpcisRecovery({ storage: input.epcis.storage, cursors: input.cursors ?? 'exclude', credentials, root: EPCIS_ROOT, now: () => exportedAt })
    if (exported.ok) snapshot = exported
    else if (exported.code === 'no-source-scope') epcis = { scopes: [], reason: 'the exchange holds no source scope' }
    else throw new PortabilityRefused('epcis-export-refused', `The EPCIS exchange was not exported (${exported.code}): ${exported.detail} Nothing was exported.`, { code: exported.code, ...(exported.breaches == null ? {} : { breaches: exported.breaches }), ...(exported.path == null ? {} : { path: exported.path }) })
  } else if ((input.publicSources ?? []).length > 0) {
    const allowed = new Set(input.publicSources)
    const exported = await exportEpcisPublicEvidence({ storage: input.epcis.storage, allow: (record) => allowed.has(record.sourceId), sourceIds: [...allowed], credentials, root: EPCIS_ROOT, now: () => exportedAt })
    if (exported.ok) snapshot = exported
    else if (exported.code === 'nothing-public') epcis = { scopes: [], reason: 'the source scopes named hold no import a public export may carry' }
    else throw new PortabilityRefused('epcis-export-refused', `The public form of the EPCIS exchange was not exported (${exported.code}): ${exported.detail} Nothing was exported.`, { code: exported.code, ...(exported.sourceId == null ? {} : { sourceId: exported.sourceId }) })
  } else {
    epcis = { scopes: [], reason: 'no source scope was named as one a public export may carry' }
    withheld.push('epcis-exchange every-source-scope not-public')
  }
  if (snapshot != null) {
    snapshot.inventory.forEach((entry) => add(entry.path, entry.category, entry.mediaType, snapshot.files.get(entry.path)!, { represents: entry.represents, representation: entry.representation }))
    snapshots.push(...snapshot.manifest.snapshots)
    withheld.push(...snapshot.manifest.withheld)
    epcis = {
      root: snapshot.root,
      access: snapshot.descriptor.access,
      snapshotId: snapshot.descriptor.snapshot.snapshotId,
      scopes: snapshot.descriptor.scopes.map((scope) => scope.sourceId),
      cursors: snapshot.descriptor.cursors,
      // How each source was reached, for the operator who configures it again. Never its credential, and never in a public export.
      ...(authorised ? { sources: input.epcis.sources.map((source) => { const { problem: _problem, ...described } = describeEpcisSource(source); return described }) } : {}),
    }
  }

  /* ---- what is left out, said once ---- */

  omitted.push(
    { what: 'wallet-keys', reason: 'never-carried', detail: 'the wallet root key, the wallet file, and the secrets brand, recipient and member keys are derived from' },
    { what: 'endpoint-credentials', reason: 'never-carried', detail: 'the index, registry and validator tokens and every EPCIS source credential' },
    { what: 'sign-in', reason: 'never-carried', detail: 'accounts, sessions and memberships of brands' },
    { what: 'spend-ledger', reason: 'excluded', detail: 'the daily spend counter, which belongs to the wallet that is left' },
    { what: 'index-records', reason: 'rebuilt-at-destination', detail: 'the destination\'s index is given each state again and builds its own records' }
  )
  if (!authorised) {
    omitted.push(
      { what: 'passport-journals', reason: 'not-public', detail: 'each state\'s sealed owner tier, its holder and its operational answers' },
      { what: 'brands-offers-claims', reason: 'not-public' },
      { what: 'epcis-operational-records', reason: 'not-public', detail: 'request bindings, observations, conflict decisions, pull state and how each source was reached' }
    )
    withheld.push('application passport-journals not-public', 'application brands-offers-claims not-public')
  }
  for (const entry of omitted) if (entry.reason === 'never-carried') withheld.push(`application ${entry.what} never-carried`)

  const descriptor: ApplicationExportDescriptor = {
    format: APPLICATION_EXPORT_FORMAT,
    version: APPLICATION_EXPORT_VERSION,
    access,
    exportId,
    exportedAt,
    selection: input.passportIds == null ? 'all-passports' : 'listed-passports',
    application: { network: config.network, identifiers: { host: config.passportHost, prefix: config.gs1Prefix }, publisherKey: wallet.identityKey },
    passports,
    profiles: { ...(bundleProfiles.length === 0 ? {} : { root: PROFILES_ROOT }), carried: bundleProfiles, named },
    epcis,
    records: { brands, offers, claims },
    omitted,
    limits: APPLICATION_EXPORT_LIMITS,
  }
  add(APPLICATION_EXPORT_DESCRIPTOR, 'reports', JSON_MEDIA_TYPE, recordBytes(descriptor), { represents: exportId, representation: APPLICATION_REPRESENTATIONS.descriptor })

  /* ---- the manifest, signed under the publisher key ---- */

  const signer = evidencePackageSigner(wallet.identityKey, exportId)
  const manifestProfiles = [...new Set([...bundleProfiles, ...named, ...(v3 ? [MANAGED_CUSTODY_EXPORT_PROFILE] : [])])].filter((profile) => /^[a-z][a-z0-9.-]*@[0-9][0-9a-z.-]*$/.test(profile)).sort()
  const manifest = await signEvidenceManifest(
    {
      format: EVIDENCE_PACKAGE_FORMAT,
      version: EVIDENCE_PACKAGE_VERSION,
      // A package that carries an export names the export here, not one passport (spec/portable-evidence.md section 2).
      passportId: exportId,
      exportedAt,
      exporter: { id: wallet.identityKey, role: 'writer', software: SOFTWARE },
      ...(manifestProfiles.length === 0 ? {} : { profiles: manifestProfiles }),
      disclosure: authorised ? { scope: 'all-tiers', recoveryBackup: true } : { scope: 'public', recoveryBackup: false },
      completeness: { snapshots, withheld: [...new Set(withheld)], absent: [...new Set(absent)] },
      sources,
      inventory,
      signature: { suite: 'bsv-ecdsa-der', signer },
    },
    // The wallet signs the preimage under the evidence package protocol, the export's name and the "anyone" counterparty, so any reader derives the signer from the publisher key alone.
    { sign: async (preimage) => (await wallet.custodian.createSignature({ data: preimage, protocolID: EVIDENCE_PACKAGE_PROTOCOL, keyID: exportId, counterparty: 'anyone' })).signature }
  )

  // Checked as a destination will check it, before anything is handed over.
  const inspection = inspectEvidencePackage(manifest, asNumberArrays(files), { expectedPassportId: exportId, expectedSigner: signer })
  if (!inspection.structureValid || !inspection.inventoryVerified || inspection.signatureValid !== true || inspection.failures.length > 0) {
    throw new PortabilityRefused('export-unsound', `The export does not inspect as the package it should be: ${inspection.failures.map((failure) => failure.detail).join('; ')}. Nothing is handed over.`, { failures: inspection.failures.map((failure) => failure.reason) })
  }
  if (pendingCommitments.length > 0 && secretCarrier(files, JSON.stringify(manifest), pendingCommitments, pendingCommitments) != null) {
    throw new PortabilityRefused('export-unsound', 'The public export exposes a commitment held only with a pending offer.')
  }
  const carrier = secretCarrier(files, JSON.stringify(manifest), configuredSecrets(config, credentials))
  if (carrier != null) throw new PortabilityRefused('secret-in-export', `The file ${carrier} holds a secret this deployment was configured with. Nothing is handed over. Find how it reached a record or a retained source, and rotate it.`, { path: carrier })

  return { manifest, files, descriptor, exporter: { identityKey: wallet.identityKey, signer } }
}
