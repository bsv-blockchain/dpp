// EPCIS exchange for this application: file import, a configured pull and
// exact export. Every one of them is a call into
// `@bsv/dpp-credentials/epcis-exchange`. Nothing here parses, validates,
// classifies or pages: this file chooses the storage, provisions the GS1
// files, runs recovery, and hands the module what it asks for.
//
// What an import is not: it changes no custody, signs nothing, writes nothing
// on chain and never reaches the wallet. An event that is retained is data
// someone supplied. A document that passes validation says nothing about who
// wrote it or whether its events happened. This file and the two beside it
// import no wallet, writer or index code, and a test holds them to that.
import { lookup } from 'node:dns/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Db } from 'mongodb'
import { provisionGs1Artefacts, verifyGs1Artefacts, type Gs1ProvisionReport } from '@bsv/dpp-credentials'
import {
  createMemoryEpcisStorage,
  deriveEpcisEventProjection,
  exportEpcisSource,
  findEpcisAssociations,
  getEpcisConflict,
  getEpcisImport,
  getEpcisPull,
  importEpcisSource,
  openFileEpcisStorage,
  listEpcisImports,
  listEpcisPullPages,
  pullEpcisEvents,
  recoverEpcisExchange,
  resolveEpcisConflict,
  type EpcisAssociationGranularity,
  type EpcisAssociationRecord,
  type EpcisConflict,
  type EpcisExchangeStorage,
  type EpcisImportEvent,
  type EpcisImportOutcome,
  type EpcisImportPolicy,
  type EpcisImportRecord,
  type EpcisOriginalExport,
  type EpcisPullOutcome,
  type EpcisPullPageRecord,
  type EpcisPullQueryInput,
  type EpcisPullRecord,
  type EpcisRecoveryReport,
  type EpcisResolutionDisposition,
  type EpcisResolutionOutcome,
  type FileEpcisStorage,
} from '@bsv/dpp-credentials/epcis-exchange'
import { openMongoEpcisStorage, type MongoEpcisStorage } from './mongo-storage.js'
import { describeEpcisSource, type EpcisSourceConfig, type EpcisSourceDescription } from './sources.js'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

/** The operator policy every import and pull of this application is read under: the module's default limits, under a name of this application's own. */
export const EPCIS_POLICY: EpcisImportPolicy = { policyId: 'starter-default@1' }
/** The source scope a file is imported under when the request names none. */
export const EPCIS_UPLOAD_SOURCE = 'upload'
/** How many imports the conflict listing reads before it says it stopped. */
const CONFLICT_SCAN_LIMIT = 2000

/** Which adapter holds the exchange's records: the configuration's `EPCIS_STORAGE`. */
export type EpcisStorageSetting = { kind: 'mongodb' } | { kind: 'file'; dir: string }

export interface OpenedExchangeStorage {
  storage: EpcisExchangeStorage
  kind: 'mongodb' | 'file' | 'memory'
  close(): Promise<void>
}

/**
 * Open the store the configuration chose. `mongodb` is the application
 * database, or memory when there is none. `file` is the module's file-system
 * adapter over a folder of this deployment. Both are handed to the module as
 * the same six methods, and the module does not know which it was given.
 * The exchange opens its store through this, and so do the export and the
 * restore of this application, which run when the API does not.
 */
export async function openExchangeStorage(options: { setting?: EpcisStorageSetting; db?: Db; log: (line: string) => void }): Promise<OpenedExchangeStorage> {
  const { log } = options
  if (options.setting?.kind === 'file') {
    const folder = isAbsolute(options.setting.dir) ? options.setting.dir : resolve(PROJECT_ROOT, options.setting.dir)
    const file: FileEpcisStorage = await openFileEpcisStorage(folder)
    log(`EPCIS store: the file-system adapter over ${folder}.`)
    if (file.reopened.journalsApplied > 0) log('EPCIS store: a batch that was committed before the last stop was applied.')
    return { storage: file, kind: 'file', close: () => file.close() }
  }
  if (options.db != null) {
    const mongo: MongoEpcisStorage = await openMongoEpcisStorage(options.db)
    if (mongo.reopened.batchesApplied > 0) log('EPCIS store: a batch that was committed before the last stop was applied.')
    return { storage: mongo, kind: 'mongodb', close: () => mongo.close() }
  }
  log('EPCIS store: no MongoDB, so imports are held in memory and are gone when this process ends.')
  return { storage: createMemoryEpcisStorage(), kind: 'memory', close: async () => undefined }
}

export interface EpcisExchangeOptions {
  config: { gs1Dir: string; gs1Offline: boolean; sources: EpcisSourceConfig[]; storage?: EpcisStorageSetting }
  /** The application database. Without one, and without a folder chosen as the store, imports are held in memory and are gone when the process ends. */
  db?: Db
  /** A store to use in place of the one this would open. A test hands in one that stops where a crash would. */
  storage?: EpcisExchangeStorage
  /** One line per thing start-up did, and one per step of a pull. No line carries a credential. */
  log: (line: string) => void
  /** The transport, for the GS1 files at start-up and for every page of a pull. The platform's by default. */
  fetch?: typeof globalThis.fetch
  now?: () => string
}

/** What start-up found when it provisioned the pinned GS1 files. */
export interface EpcisArtefactState {
  dir: string
  /** `present`: every file was already in the folder. `fetched`: at least one was obtained from GS1 and checked. `unavailable`: at least one is missing or wrong, and every import and pull is refused until it is provided. */
  state: 'present' | 'fetched' | 'unavailable'
  files: Array<{ fileName: string; outcome: 'present' | 'fetched' | 'failed'; reason?: string }>
  /** How to provide the files, when they are unavailable. */
  remedy?: string
}

/** One relationship between an identifier and a retained event, with where the event came from and whether its document was valid. */
export interface EpcisEventEntry {
  association: EpcisAssociationRecord
  /** The import that holds the event: its source, its validity and how it arrived. */
  source: { importId: string; sourceId: string; receivedAt: string; documentValidity: 'valid' | 'invalid'; state: EpcisImportRecord['state']; provenance: EpcisImportRecord['sourceLocation']; sha256: string }
  /** What the import record says about this event. */
  event?: EpcisImportEvent
  /** The event as the retained document holds it, extension members included. Generated from the retained bytes by the module's projection. */
  body?: unknown
}

export interface EpcisExchange {
  readonly storage: EpcisExchangeStorage
  readonly storageKind: 'mongodb' | 'file' | 'memory' | 'supplied'
  /** The folder the pinned GS1 files are read from. */
  readonly artefactsDir: string
  /** What start-up found. `status()` looks at the folder again. */
  readonly artefacts: EpcisArtefactState
  readonly recovery: EpcisRecoveryReport
  readonly sources: EpcisSourceConfig[]
  status(): { storage: EpcisExchange['storageKind']; artefacts: EpcisArtefactState; recovery: EpcisRecoveryReport; sources: EpcisSourceDescription[]; policy: string }
  importDocument(input: { sourceId: string; requestId: string; bytes: Uint8Array; mediaType: string; filename?: string }): Promise<EpcisImportOutcome>
  listImports(options: { after?: string; limit?: number }): Promise<EpcisImportRecord[]>
  getImport(importId: string): Promise<EpcisImportRecord | undefined>
  exportOriginal(importId: string): Promise<EpcisOriginalExport | undefined>
  /** One bounded run against a configured source. Undefined when no source has that identifier. */
  pull(input: { sourceId: string; queryId: string; query: EpcisPullQueryInput; window?: 'watermark' | 'query-bounds' }): Promise<EpcisPullOutcome | undefined>
  getPull(sourceId: string, queryId: string): Promise<{ pull: EpcisPullRecord; pages: EpcisPullPageRecord[] } | undefined>
  eventsFor(query: { identifier: string; granularity: EpcisAssociationGranularity; sourceId?: string; after?: string; limit?: number }): Promise<{ events: EpcisEventEntry[]; next?: string }>
  listConflicts(): Promise<{ conflicts: EpcisConflict[]; importsRead: number; truncated: boolean }>
  getConflict(conflictId: string): Promise<EpcisConflict | undefined>
  resolveConflict(input: { conflictId: string; decision: string; disposition: EpcisResolutionDisposition; selectedBodyDigest?: string; decidedAt?: string; decidedBy?: string }): Promise<EpcisResolutionOutcome>
  close(): Promise<void>
}

const remedyFor = (dir: string): string =>
  `Start the API again with network access to https://ref.gs1.org, or run "npx dpp-gs1-artefacts fetch --dir ${dir}", or place the files GS1 publishes in ${dir} under the names "npx dpp-gs1-artefacts verify --dir ${dir}" prints.`

function artefactState(report: Pick<Gs1ProvisionReport, 'dir' | 'files' | 'ok'>): EpcisArtefactState {
  const files = report.files.map((file) => ({ fileName: file.fileName, outcome: file.outcome, ...(file.reason == null ? {} : { reason: file.reason }) }))
  if (!report.ok) return { dir: report.dir, state: 'unavailable', files, remedy: remedyFor(report.dir) }
  return { dir: report.dir, state: files.some((file) => file.outcome === 'fetched') ? 'fetched' : 'present', files }
}

/**
 * Start the exchange: provision the GS1 files, open the store, run recovery.
 * It resolves before the API accepts a request, so no import meets a store
 * that still holds unfinished work.
 */
export async function startEpcisExchange(options: EpcisExchangeOptions): Promise<EpcisExchange> {
  const { log } = options
  const clock = options.now ?? (() => new Date().toISOString())
  const transport = options.fetch ?? globalThis.fetch
  const dir = isAbsolute(options.config.gs1Dir) ? options.config.gs1Dir : resolve(PROJECT_ROOT, options.config.gs1Dir)

  // The GS1 files are obtained here, once and by name. Nothing fetches them later, and an import never does.
  const artefacts = artefactState(await provisionGs1Artefacts({ dir, offline: options.config.gs1Offline, fetch: transport }))
  if (artefacts.state === 'present') log(`GS1 files for EPCIS validation: present in ${dir}.`)
  else if (artefacts.state === 'fetched') log(`GS1 files for EPCIS validation: fetched from GS1 into ${dir} and checked against their pinned digests.`)
  else {
    const failed = artefacts.files.filter((file) => file.outcome === 'failed').map((file) => `${file.fileName} (${file.reason ?? 'unavailable'})`)
    log(`GS1 files for EPCIS validation: unavailable in ${dir}: ${failed.join(', ')}. The API runs, and every EPCIS import and pull is refused until they are provided. ${artefacts.remedy}`)
  }

  let storage: EpcisExchangeStorage
  let storageKind: EpcisExchange['storageKind']
  let opened: OpenedExchangeStorage | undefined
  if (options.storage != null) {
    storage = options.storage
    storageKind = 'supplied'
  } else {
    opened = await openExchangeStorage({ ...(options.config.storage == null ? {} : { setting: options.config.storage }), ...(options.db == null ? {} : { db: options.db }), log })
    storage = opened.storage
    storageKind = opened.kind
  }

  // Recovery finishes or discards what a stopped process left. It runs alone, before any request.
  const recovery = await recoverEpcisExchange(storage, { now: clock })
  if (recovery.actions.length === 0) log('EPCIS recovery: nothing was left unfinished.')
  else {
    const counts = new Map<string, number>()
    for (const action of recovery.actions) counts.set(action.action, (counts.get(action.action) ?? 0) + 1)
    log(`EPCIS recovery: ${[...counts].map(([action, count]) => `${action} x${count}`).join(', ')}; ${recovery.remaining} left unfinished.`)
  }

  const sources = options.config.sources
  /** A name is checked against the addresses it resolves to, so one that leads to a private address is refused outside the local-test option. */
  const resolveHost = async (hostname: string): Promise<string[]> => (await lookup(hostname, { all: true })).map((entry) => entry.address)

  return {
    storage,
    storageKind,
    artefactsDir: dir,
    artefacts,
    recovery,
    sources,

    status() {
      // The folder is read again, without the network, so files an operator placed since the start are seen.
      const now = verifyGs1Artefacts({ dir })
      const current: EpcisArtefactState = now.ok
        ? { dir, state: artefacts.state === 'unavailable' ? 'present' : artefacts.state, files: now.files.map((file) => ({ fileName: file.fileName, outcome: 'present' as const })) }
        : { dir, state: 'unavailable', files: now.files.map((file) => (file.status === 'ok' ? { fileName: file.fileName, outcome: 'present' as const } : { fileName: file.fileName, outcome: 'failed' as const, reason: file.status })), remedy: remedyFor(dir) }
      return { storage: storageKind, artefacts: current, recovery, sources: sources.map(describeEpcisSource), policy: EPCIS_POLICY.policyId }
    },

    importDocument: (input) =>
      importEpcisSource({
        storage,
        sourceId: input.sourceId,
        requestId: input.requestId,
        bytes: input.bytes,
        mediaType: input.mediaType,
        receivedAt: clock(),
        provenance: { kind: 'file', ...(input.filename == null ? {} : { filename: input.filename }) },
        policy: EPCIS_POLICY,
        artefactsDir: dir,
        now: clock,
      }),

    listImports: (page) => listEpcisImports(storage, page),
    getImport: (importId) => getEpcisImport(storage, importId),
    exportOriginal: (importId) => exportEpcisSource(storage, importId),

    async pull(input) {
      const source = sources.find((candidate) => candidate.sourceId === input.sourceId)
      if (source == null) return undefined
      return await pullEpcisEvents({
        storage,
        source: {
          sourceId: source.sourceId,
          baseUrl: source.baseUrl,
          permittedOrigins: source.permittedOrigins,
          policy: EPCIS_POLICY,
          localTest: source.localTest,
          repeatListParameters: source.repeatListParameters,
          ...(source.credentials == null ? {} : { credentials: source.credentials }),
        },
        queryId: input.queryId,
        query: input.query,
        ...(input.window == null ? {} : { window: input.window }),
        fetch: (url, init) => transport(url, init),
        artefactsDir: dir,
        now: clock,
        resolveHost,
        // The module's entries name addresses, counts and outcomes. It searches each for the credential before it hands one over.
        log: (entry) => log(`EPCIS pull ${source.sourceId}/${input.queryId}: ${JSON.stringify(entry)}`),
      })
    },

    async getPull(sourceId, queryId) {
      const pull = await getEpcisPull(storage, sourceId, queryId)
      return pull == null ? undefined : { pull, pages: await listEpcisPullPages(storage, pull.pullId, { limit: 1000 }) }
    },

    async eventsFor(query) {
      const page = await findEpcisAssociations(storage, query)
      const imports = new Map<string, EpcisImportRecord | undefined>()
      const bodies = new Map<string, Map<string, unknown>>()
      const events: EpcisEventEntry[] = []
      for (const association of page.associations) {
        if (!imports.has(association.importId)) {
          imports.set(association.importId, await getEpcisImport(storage, association.importId))
          // The event as it was received is read from the retained bytes by the module's projection, which says it is derived.
          const projection = await deriveEpcisEventProjection(storage, association.importId)
          const parsed = projection == null ? undefined : (JSON.parse(new TextDecoder().decode(projection.bytes)) as { events: Array<{ pointer: string; event: unknown }> })
          bodies.set(association.importId, new Map((parsed?.events ?? []).map((entry) => [entry.pointer, entry.event])))
        }
        const record = imports.get(association.importId)
        if (record == null) continue
        const event = record.events.find((candidate) => candidate.pointer === association.pointer)
        const body = bodies.get(association.importId)?.get(association.pointer)
        events.push({
          association,
          source: { importId: record.importId, sourceId: record.sourceId, receivedAt: record.receivedAt, documentValidity: record.documentValidity, state: record.state, provenance: record.sourceLocation, sha256: record.sha256 },
          ...(event == null ? {} : { event }),
          ...(body === undefined ? {} : { body }),
        })
      }
      return { events, ...(page.next == null ? {} : { next: page.next }) }
    },

    async listConflicts() {
      // The module names a conflict on each event that is part of one. Reading the import records finds them all.
      const ids = new Set<string>()
      let after: string | undefined
      let importsRead = 0
      let truncated = false
      for (;;) {
        const page = await listEpcisImports(storage, { ...(after == null ? {} : { after }), limit: 100 })
        for (const record of page) for (const event of record.events) if (event.conflict != null) ids.add(event.conflict.conflictId)
        importsRead += page.length
        if (page.length < 100) break
        if (importsRead >= CONFLICT_SCAN_LIMIT) {
          truncated = true
          break
        }
        after = page[page.length - 1]!.importId
      }
      const conflicts: EpcisConflict[] = []
      for (const conflictId of ids) {
        const conflict = await getEpcisConflict(storage, conflictId)
        if (conflict != null) conflicts.push(conflict)
      }
      return { conflicts, importsRead, truncated }
    },

    getConflict: (conflictId) => getEpcisConflict(storage, conflictId),

    resolveConflict: (input) =>
      resolveEpcisConflict(storage, {
        conflictId: input.conflictId,
        decision: input.decision,
        disposition: input.disposition,
        ...(input.selectedBodyDigest == null ? {} : { selectedBodyDigest: input.selectedBodyDigest }),
        decidedAt: input.decidedAt ?? clock(),
        ...(input.decidedBy == null ? {} : { decidedBy: input.decidedBy }),
        now: clock,
      }),

    async close() {
      await opened?.close()
    },
  }
}
