// EPCIS exchange as the pages see it: the shapes the API answers with under
// /api/epcis, and the words the pages put on them.
//
// The words matter more than usual here. An event on these pages is data a
// source supplied. A document that is "valid" passed a check of its format.
// It is not signed, and nothing verifies who observed an event or that it
// happened. Every label below is written so that a reader cannot take one
// for the other.
//
// Nothing in this file touches the page or the network, so the API's tests
// exercise it (apps/api/test/epcis-web.test.ts).

// ------------------------------------------------------------------ shapes

export interface EpcisFinding {
  code: string
  path: string
  message: string
  severity: 'error' | 'warning' | 'info'
}

export type EpcisProvenance = { kind: 'file'; filename?: string } | { kind: 'query'; origin: string; query: Record<string, string>; page: number }

export interface EpcisImportEvent {
  pointer: string
  eventId?: string
  identity: string
  identityKind: 'event-id' | 'local'
  eventType: string
  eventTime?: string
  recordTime?: string
  /** The members of the event the EPCIS schema does not name. They are kept as received. */
  preservedExtensions: string[]
  validation: { schema: 'pass' | 'fail'; findings: EpcisFinding[] }
  arrival?: 'new' | 'duplicate' | 'new-observation' | 'conflict'
  conflict?: { conflictId: string; state: 'open' | 'resolved'; resolution?: string }
  errorDeclaration?: { reason?: string; resolution: 'resolved' | 'unresolved' }
}

export interface EpcisImportRecord {
  importId: string
  requestId: string
  sourceId: string
  receivedAt: string
  mediaType: string
  byteLength: number
  sha256: string
  sourceLocation: EpcisProvenance
  state: 'received' | 'evaluated' | 'blocked'
  /** Whether the document passed the format check. It says nothing about who made it. */
  documentValidity: 'valid' | 'invalid'
  findings: EpcisFinding[]
  preservedExtensions: string[]
  events: EpcisImportEvent[]
}

export interface EpcisImportSummary {
  importId: string
  sourceId: string
  requestId: string
  receivedAt: string
  mediaType: string
  byteLength: number
  sha256: string
  provenance: EpcisProvenance
  state: EpcisImportRecord['state']
  documentValidity: 'valid' | 'invalid'
  events: number
  findings: number
  conflicts: number
}

export interface EpcisImportAnswer {
  outcome: 'retained'
  /** The request identifier had been used before for the same bytes. */
  replayed: boolean
  resumed: boolean
  record: EpcisImportRecord
}

export interface EpcisSource {
  sourceId: string
  baseUrl: string
  permittedOrigins: string[]
  /** Plain http and private addresses are permitted for this source. For a source on the operator's own machine only. */
  localTest: boolean
  repeatListParameters: boolean
  credentialConfigured: boolean
  credentialScheme?: 'bearer' | 'basic' | 'header'
  problem?: string
}

export interface EpcisStatus {
  storage: 'mongodb' | 'file' | 'memory' | 'supplied'
  artefacts: { dir: string; state: 'present' | 'fetched' | 'unavailable'; files: Array<{ fileName: string; outcome: string; reason?: string }>; remedy?: string }
  recovery: { actions: Array<{ action: string }>; remaining: number }
  sources: EpcisSource[]
  policy: string
}

export interface EpcisEventCounts {
  total: number
  new: number
  duplicate: number
  newObservation: number
  conflict: number
}

export interface EpcisPullPage {
  sequence: number
  page: number
  importId: string
  sha256: string
  byteLength: number
  documentValidity: 'valid' | 'invalid'
  events: EpcisEventCounts
  last: boolean
  leniencies: string[]
}

export interface EpcisPullState {
  pullId: string
  sourceId: string
  queryId: string
  status: 'running' | 'exhausted' | 'stopped-at-limit' | 'failed'
  pagesAcknowledged: number
  runs: number
  totals: { bytes: number; events: EpcisEventCounts }
  completenessLimits: string[]
  updatedAt: string
}

/** One run of a pull, as the module reports it. Every word in it is the module's. */
export interface EpcisPullResult {
  outcome: string
  reason: string
  completion: 'exhausted' | 'stopped-at-limit' | 'failed'
  /** True only when the source named no further page. Never a statement that the source's history is complete. */
  exhausted: boolean
  detail: string
  status?: number
  importRefusal?: string
  sourceId: string
  queryId: string
  pull?: EpcisPullState
  run: { run: number; resumed: boolean; pagesFetched: number; pagesAcknowledged: number; bytesRead: number }
  pages: EpcisPullPage[]
  events: EpcisEventCounts
  localTest: boolean
  leniencies: string[]
  completenessLimits: string[]
}

export interface EpcisPullQuery {
  matchAnyEPC?: string[]
  eventTypes?: string[]
  eventTime?: { from?: string; until?: string }
  recordTime?: { from?: string }
  eventIds?: string[]
  perPage?: number
}

export interface EpcisEventEntry {
  association: { identifier: string; granularity: 'instance' | 'class'; role: string; eventType: string; eventTime?: string; pointer: string; sourceId: string; importId: string; errorDeclared: boolean; quantity?: number; uom?: string }
  source: { importId: string; sourceId: string; receivedAt: string; documentValidity: 'valid' | 'invalid'; state: string; provenance: EpcisProvenance; sha256: string }
  event?: EpcisImportEvent
  /** The event as the retained document holds it, extension members included. */
  body?: unknown
}

export interface EpcisEventsAnswer {
  identifier: string
  granularity: 'instance' | 'class'
  nature: 'supplied-data'
  notice: string
  events: EpcisEventEntry[]
  next?: string
}

// ------------------------------------------------------------------ words

export type EpcisTone = 'pass' | 'fail' | 'warn' | 'neutral' | 'muted'

export interface Described {
  tone: EpcisTone
  title: string
  lines: string[]
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** What every list of events says above it. */
export const SUPPLIED_DATA_NOTICE =
  'These events are data a source supplied: a file someone uploaded, or pages pulled from a configured source. Nobody signed them here. Not the holder of this passport, not its brand and not the source. "Valid format" means the document passed a check of its shape. It does not mean the event happened, or that anyone verified who reported it.'

/** The label of a document's validity. It names the check that was made, so "valid" is never read as "verified". */
export function validityLabel(documentValidity: 'valid' | 'invalid'): { tone: EpcisTone; label: string } {
  return documentValidity === 'valid' ? { tone: 'neutral', label: 'Valid format, unsigned' } : { tone: 'warn', label: 'Invalid format, unsigned' }
}

export function provenanceLabel(provenance: EpcisProvenance): string {
  if (provenance.kind === 'file') return provenance.filename == null ? 'Uploaded file' : `Uploaded file ${provenance.filename}`
  return `Page ${provenance.page} of a query to ${provenance.origin}`
}

export function countsLine(counts: EpcisEventCounts): string {
  if (counts.total === 0) return 'No events.'
  return `${plural(counts.total, 'event')}: ${counts.new} new, ${counts.duplicate} already held, ${counts.newObservation} observed again, ${counts.conflict} in conflict.`
}

/** How the events of one import arrived. */
export const eventCounts = (record: EpcisImportRecord): EpcisEventCounts => ({
  total: record.events.length,
  new: record.events.filter((event) => event.arrival === 'new').length,
  duplicate: record.events.filter((event) => event.arrival === 'duplicate').length,
  newObservation: record.events.filter((event) => event.arrival === 'new-observation').length,
  conflict: record.events.filter((event) => event.arrival === 'conflict').length,
})

export const findingsOf = (record: EpcisImportRecord): EpcisFinding[] => [...record.findings, ...record.events.flatMap((event) => event.validation.findings)]

/** An upload the API kept: what is held, whether it passed the format check, and what that does and does not mean. */
export function describeRetained(answer: EpcisImportAnswer): Described {
  const { record } = answer
  const findings = findingsOf(record)
  const open = record.events.filter((event) => event.conflict?.state === 'open').length
  const lines = [`The exact bytes are kept: ${record.byteLength} bytes, SHA-256 ${record.sha256}.`]
  if (answer.replayed) lines.push('This request identifier was already used for the same bytes, so this is the import made then. No second copy was kept.')
  lines.push(
    record.documentValidity === 'valid'
      ? 'The document passed the format check. That is a check of its shape. It is not signed, and nothing here verifies who made it or that its events happened.'
      : `The document was kept and did not pass the format check. ${plural(findings.length, 'finding')} say why. Its events are not listed against products.`
  )
  lines.push(countsLine(eventCounts(record)))
  if (open > 0) lines.push(`${plural(open, 'event')} arrived with another body than the one already held under the same identifier. Both are kept until someone records a decision.`)
  lines.push('Nothing was signed, issued or written to a passport.')
  return { tone: record.documentValidity === 'valid' && open === 0 ? 'pass' : 'warn', title: answer.replayed ? 'Already retained' : 'Retained', lines }
}

/** An upload the API refused. `code`, `message` and `details` are the API's error, which carries the module's reason. */
export function describeRefusal(error: { code: string; message: string; details?: Record<string, unknown> }): Described {
  const remedy = typeof error.details?.remedy === 'string' ? error.details.remedy : undefined
  if (error.code === 'request-conflict') return { tone: 'fail', title: 'Refused: this request identifier is already used for other bytes', lines: [error.message, 'Nothing of this upload was kept. Choose the file again to send it as a new request.'] }
  return { tone: 'fail', title: `Refused: ${error.code}`, lines: [error.message, ...(remedy == null ? [] : [remedy]), 'Nothing was kept.'] }
}

/**
 * One run of a pull, in the module's own words: its outcome, reason and
 * completion are shown as they are. The only thing added is the plain
 * statement of whether the history is partial, which is never left to be
 * inferred from a colour.
 */
export function describePull(result: EpcisPullResult): Described & { partial: boolean } {
  const partial = !result.exhausted
  const lines = [result.detail]
  lines.push(
    partial
      ? 'History is partial: this run ended before the source named a last page. What is held is what the pages retained so far carry.'
      : 'The source named no further page for this query. That is the end of this query, and not a statement that the source holds nothing else.'
  )
  lines.push(`${plural(result.pages.length, 'page')} retained in this run. ${countsLine(result.events)}`)
  if (result.run.resumed) lines.push(`This was run ${result.run.run}. It continued from where the run before it stopped.`)
  if (result.localTest) lines.push('The local-test option is on for this source: plain http and private addresses were permitted.')
  if (result.leniencies.length > 0) lines.push(`Accepted leniently: ${result.leniencies.join(', ')}.`)
  for (const limit of result.completenessLimits) lines.push(`Not complete history: ${limit}.`)
  lines.push('Nothing was signed, issued or written to a passport.')
  const tone: EpcisTone = result.outcome === 'ok' ? 'pass' : result.outcome === 'partial-history' ? 'warn' : result.pages.length > 0 ? 'warn' : 'fail'
  return { tone, title: `${result.outcome}: ${result.reason} (${result.completion})`, lines, partial }
}

/** A pull the API refused before anything was requested. */
export function describePullRefusal(error: { code: string; message: string; details?: Record<string, unknown> }): Described {
  const remedy = typeof error.details?.remedy === 'string' ? error.details.remedy : undefined
  return { tone: 'fail', title: `Refused: ${error.code}`, lines: [error.message, ...(remedy == null ? [] : [remedy]), 'Nothing was requested from the source, and nothing was kept.'] }
}

export function describeSource(source: EpcisSource): string[] {
  const lines = [`Queries go to ${source.baseUrl}/events.`, `Requests may go to: ${source.permittedOrigins.join(', ')}.`]
  lines.push(source.credentialConfigured ? `A credential is set on the server${source.credentialScheme == null ? '' : ` (${source.credentialScheme})`}. It is never sent to this page.` : 'No credential is set.')
  if (source.localTest) lines.push('Local test is on: plain http and private addresses are permitted. Use it only for a source on your own machine.')
  if (source.repeatListParameters) lines.push('Lists are sent as repeated parameters, which is recorded as a leniency.')
  if (source.problem != null) lines.push(`This source cannot be pulled from as it is configured: ${source.problem}.`)
  return lines
}

/** The extension members of an event, with their values as the retained document holds them. None is dropped: a name without a value is still listed. */
export function extensionMembers(entry: Pick<EpcisEventEntry, 'event' | 'body'>): Array<{ name: string; value: unknown; held: boolean }> {
  const names = entry.event?.preservedExtensions ?? []
  const body = isRecord(entry.body) ? entry.body : undefined
  return names.map((name) => (body != null && Object.hasOwn(body, name) ? { name, value: body[name], held: true } : { name, value: undefined, held: false }))
}

/**
 * The spellings of a passport's identifier that are searched for events. An
 * event is found only under the exact identifier it writes, so the passport
 * page says which spellings it looked for: the passport's own, and the same
 * path at GS1's own resolver. An event that writes the product another way,
 * as an EPC URN for one, is found by searching for that spelling.
 */
export function passportSpellings(passportId: string): string[] {
  const out = [passportId]
  try {
    const url = new URL(passportId)
    const canonical = `https://id.gs1.org${url.pathname}`
    if (/^\/01\/\d+/.test(url.pathname) && canonical !== passportId) out.push(canonical)
  } catch {
    // Not an address: only the identifier itself is searched.
  }
  return out
}

/** The media type an upload is sent under. The API refuses anything that is not one of the two EPCIS media types, in the module's words. */
export function mediaTypeOf(file: { name: string; type: string }): string {
  const declared = file.type.split(';')[0]?.trim().toLowerCase() ?? ''
  if (declared === 'application/ld+json' || declared === 'application/json') return declared
  if (/\.jsonld$/i.test(file.name)) return 'application/ld+json'
  if (/\.json$/i.test(file.name)) return 'application/json'
  return declared === '' ? 'application/octet-stream' : declared
}

const entries = (text: string): string[] =>
  text
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')

/** The query a pull form describes. A field left empty is left out, so the query asks for no more than was entered. */
export function queryFromForm(form: { identifiers: string; eventTypes: string; eventIds: string; from: string; until: string; perPage: string }): EpcisPullQuery {
  const query: EpcisPullQuery = {}
  if (entries(form.identifiers).length > 0) query.matchAnyEPC = entries(form.identifiers)
  if (entries(form.eventTypes).length > 0) query.eventTypes = entries(form.eventTypes)
  if (entries(form.eventIds).length > 0) query.eventIds = entries(form.eventIds)
  const from = form.from.trim()
  const until = form.until.trim()
  if (from !== '' || until !== '') query.eventTime = { ...(from === '' ? {} : { from }), ...(until === '' ? {} : { until }) }
  const perPage = Number(form.perPage.trim())
  if (form.perPage.trim() !== '' && Number.isInteger(perPage) && perPage > 0) query.perPage = perPage
  return query
}

/** Imports, the latest first. */
export const latestFirst = (imports: EpcisImportSummary[]): EpcisImportSummary[] => [...imports].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0))

export const originalPath = (importId: string): string => `/api/epcis/imports/${encodeURIComponent(importId)}/original`
