#!/usr/bin/env node
/**
 * An opt-in interoperability run: pull EPCIS events from one endpoint that
 * you name, through the standard events query, and report what happened
 * (spec/epcis-interoperability.md section 3). It is not part of `npm test`
 * and nothing runs it for you.
 *
 *   EPCIS_INTEROP_ENDPOINT=https://events.example.org/epcis node scripts/epcis-pull-interop.mjs
 *
 * The query goes to `<endpoint>/events`. Without EPCIS_INTEROP_ENDPOINT the
 * script refuses to run: it has no default endpoint and never guesses one.
 *
 * Environment variables:
 *
 *   EPCIS_INTEROP_ENDPOINT            required. The base address of the query interface.
 *   EPCIS_INTEROP_BEARER_TOKEN        a bearer token for the endpoint, or
 *   EPCIS_INTEROP_BASIC_USER          a user name, with
 *   EPCIS_INTEROP_BASIC_PASSWORD      its password, or
 *   EPCIS_INTEROP_HEADER_NAME         the name of a credential header, with
 *   EPCIS_INTEROP_HEADER_VALUE        its value.
 *   EPCIS_INTEROP_PERMITTED_ORIGINS   further origins a redirect or a next page may lead to, comma-separated.
 *                                     The endpoint's own origin is always permitted. No credential is sent to any other.
 *   EPCIS_INTEROP_LOCAL_TEST=1        permit plain http and private addresses, for a server on your own machine.
 *   EPCIS_INTEROP_MATCH_EPC           identifiers for MATCH_anyEPC, comma-separated.
 *   EPCIS_INTEROP_EVENT_TYPES         event types for eventType, comma-separated.
 *   EPCIS_INTEROP_EVENT_TIME_FROM     GE_eventTime, an ISO 8601 date-time with a zone.
 *   EPCIS_INTEROP_EVENT_TIME_UNTIL    LT_eventTime.
 *   EPCIS_INTEROP_RECORD_TIME_FROM    GE_recordTime.
 *   EPCIS_INTEROP_EVENT_IDS           event identifiers for EQ_eventID, comma-separated.
 *   EPCIS_INTEROP_PER_PAGE            perPage. The page event limit, 100, by default.
 *   EPCIS_INTEROP_MAX_PAGES           the run's page limit, when not the default 10.
 *   EPCIS_INTEROP_RUNS                how many bounded runs to make while the source has further pages. 1 by default.
 *   EPCIS_INTEROP_EPCIS_VERSION       the value sent in GS1-EPCIS-Version, when not the default, the pinned EPCIS version.
 *   EPCIS_INTEROP_CBV_VERSION         the value sent in GS1-CBV-Version, when not the default, the pinned CBV version.
 *   EPCIS_INTEROP_REPEAT_LISTS=1      send each value of a list as its own parameter, for an endpoint that does not read
 *                                     the pipe-delimited form the interface description declares. Reported as a leniency.
 *   EPCIS_INTEROP_STORE               a folder to keep what is retained. Memory by default, gone when the run ends.
 *   EPCIS_INTEROP_REPORT              where the JSON report is written. ./epcis-interop-report.json by default.
 *   EPCIS_INTEROP_OFFLINE=1           use the provisioned GS1 files and fetch nothing from GS1.
 *
 * What the endpoint must hold first: events that the query matches. This
 * script captures nothing, so whoever runs the endpoint seeds it through its
 * own capture interface before the run. More events than one page holds
 * exercise the next link; a known event identifier exercises EQ_eventID.
 *
 * The credential is read from the environment, sent to the endpoint's origin
 * only, and written nowhere: not to the report, the output or the store.
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { provisionGs1Artefacts } from '@bsv/dpp-credentials'
import { CBV_WIRE_VERSION, EPCIS_WIRE_VERSION, createMemoryEpcisStorage, openFileEpcisStorage, pullEpcisEvents, recoverEpcisExchange } from '@bsv/dpp-credentials/epcis-exchange'

const env = process.env
const say = (sentence) => console.log(sentence)
const list = (name) => (env[name] == null || env[name].trim() === '' ? undefined : env[name].split(',').map((value) => value.trim()).filter((value) => value !== ''))
const number = (name) => (env[name] == null || env[name].trim() === '' ? undefined : Number(env[name]))
const stop = (message, code = 2) => { console.error(message); process.exit(code) }

if (env.EPCIS_INTEROP_ENDPOINT == null || env.EPCIS_INTEROP_ENDPOINT.trim() === '') {
  stop('EPCIS_INTEROP_ENDPOINT is not set. This script pulls from the one endpoint you name and has no default. Example: EPCIS_INTEROP_ENDPOINT=https://events.example.org/epcis node scripts/epcis-pull-interop.mjs')
}
let endpoint
try { endpoint = new URL(env.EPCIS_INTEROP_ENDPOINT.trim()) } catch { stop('EPCIS_INTEROP_ENDPOINT does not parse as an address.') }
if (endpoint.username !== '' || endpoint.password !== '') stop('EPCIS_INTEROP_ENDPOINT carries user information. Give the credential through EPCIS_INTEROP_BEARER_TOKEN, EPCIS_INTEROP_BASIC_USER and EPCIS_INTEROP_BASIC_PASSWORD, or EPCIS_INTEROP_HEADER_NAME and EPCIS_INTEROP_HEADER_VALUE.')

// At most one credential, read here and nowhere else.
const credentials = [
  env.EPCIS_INTEROP_BEARER_TOKEN ? { scheme: 'bearer', token: env.EPCIS_INTEROP_BEARER_TOKEN } : undefined,
  env.EPCIS_INTEROP_BASIC_USER || env.EPCIS_INTEROP_BASIC_PASSWORD ? { scheme: 'basic', username: env.EPCIS_INTEROP_BASIC_USER ?? '', password: env.EPCIS_INTEROP_BASIC_PASSWORD ?? '' } : undefined,
  env.EPCIS_INTEROP_HEADER_NAME || env.EPCIS_INTEROP_HEADER_VALUE ? { scheme: 'header', name: env.EPCIS_INTEROP_HEADER_NAME ?? '', value: env.EPCIS_INTEROP_HEADER_VALUE ?? '' } : undefined,
].filter((credential) => credential != null)
if (credentials.length > 1) stop('More than one credential is set. Set a bearer token, or a basic user and password, or a header name and value.')
const credential = credentials[0]

const artefacts = await provisionGs1Artefacts({ offline: env.EPCIS_INTEROP_OFFLINE === '1' })
for (const file of artefacts.files.filter((f) => f.outcome === 'fetched')) say(`Obtained ${file.fileName} from GS1 and checked it against its pinned digest.`)
if (!artefacts.ok) {
  for (const file of artefacts.files.filter((f) => f.outcome === 'failed')) say(`The pinned GS1 file ${file.fileName} is not available in ${artefacts.dir}: ${file.reason}: ${file.detail}.`)
  stop('Nothing is validated without the pinned schema, so nothing was requested. Run dpp-gs1-artefacts fetch with network access, or place the files GS1 publishes in that folder.', 1)
}

const query = {}
if (list('EPCIS_INTEROP_MATCH_EPC') != null) query.matchAnyEPC = list('EPCIS_INTEROP_MATCH_EPC')
if (list('EPCIS_INTEROP_EVENT_TYPES') != null) query.eventTypes = list('EPCIS_INTEROP_EVENT_TYPES')
if (env.EPCIS_INTEROP_EVENT_TIME_FROM || env.EPCIS_INTEROP_EVENT_TIME_UNTIL) query.eventTime = { ...(env.EPCIS_INTEROP_EVENT_TIME_FROM ? { from: env.EPCIS_INTEROP_EVENT_TIME_FROM } : {}), ...(env.EPCIS_INTEROP_EVENT_TIME_UNTIL ? { until: env.EPCIS_INTEROP_EVENT_TIME_UNTIL } : {}) }
if (env.EPCIS_INTEROP_RECORD_TIME_FROM) query.recordTime = { from: env.EPCIS_INTEROP_RECORD_TIME_FROM }
if (list('EPCIS_INTEROP_EVENT_IDS') != null) query.eventIds = list('EPCIS_INTEROP_EVENT_IDS')
if (number('EPCIS_INTEROP_PER_PAGE') != null) query.perPage = number('EPCIS_INTEROP_PER_PAGE')

const source = {
  sourceId: 'interop-endpoint',
  baseUrl: endpoint.toString(),
  permittedOrigins: [...new Set([endpoint.origin, ...(list('EPCIS_INTEROP_PERMITTED_ORIGINS') ?? [])])],
  policy: { policyId: 'interop-run@1', limits: number('EPCIS_INTEROP_MAX_PAGES') == null ? {} : { maxPullPages: number('EPCIS_INTEROP_MAX_PAGES') } },
  ...(credential == null ? {} : { credentials: () => credential }),
  localTest: env.EPCIS_INTEROP_LOCAL_TEST === '1',
  wireVersions: { epcis: env.EPCIS_INTEROP_EPCIS_VERSION || EPCIS_WIRE_VERSION, cbv: env.EPCIS_INTEROP_CBV_VERSION || CBV_WIRE_VERSION },
  repeatListParameters: env.EPCIS_INTEROP_REPEAT_LISTS === '1',
}

// The module sends a credential to the endpoint's origin only. This transport holds it to that a second time, and notes what each answer reported.
const credentialHeaders = credential == null ? [] : credential.scheme === 'header' ? [credential.name.toLowerCase()] : ['authorization']
const answers = []
const transport = async (url, init) => {
  const carries = Object.keys(init.headers).some((name) => credentialHeaders.includes(name.toLowerCase()))
  if (carries && new URL(url).origin !== endpoint.origin) throw new Error('a credential was about to leave the endpoint\'s origin; the request was not made')
  const response = await fetch(url, init)
  answers.push({ origin: new URL(url).origin, path: new URL(url).pathname, status: response.status, mediaType: response.headers.get('content-type'), epcisVersion: response.headers.get('gs1-epcis-version'), cbvVersion: response.headers.get('gs1-cbv-version'), nextLink: response.headers.get('link') != null, nextExpires: response.headers.get('gs1-next-page-token-expires') != null, credentialSent: carries })
  return response
}

const storage = env.EPCIS_INTEROP_STORE ? await openFileEpcisStorage(env.EPCIS_INTEROP_STORE) : createMemoryEpcisStorage()
const report = { reportVersion: '1', generatedAt: new Date().toISOString(), endpoint: { baseUrl: `${endpoint.origin}${endpoint.pathname.replace(/\/+$/, '')}`, permittedOrigins: source.permittedOrigins, localTest: source.localTest, credentialConfigured: credential != null }, versionsSent: source.wireVersions, listParameters: source.repeatListParameters ? 'repeated' : 'pipe-delimited', query: {}, runs: [], pages: [], answers, serverVersions: [], leniencies: [], totals: { runs: 0, pagesRetrieved: 0, eventsRetrieved: 0, bytes: 0 }, completenessLimits: [] }
let last
try {
  await recoverEpcisExchange(storage)
  say(`Pulling from ${report.endpoint.baseUrl}/events${credential == null ? ' without a credential' : ` with a ${credential.scheme} credential, sent to ${endpoint.origin} only`}${source.localTest ? ', with the local-test option on' : ''}.`)
  const runs = Math.max(1, Math.trunc(number('EPCIS_INTEROP_RUNS') ?? 1))
  for (let run = 1; run <= runs; run += 1) {
    last = await pullEpcisEvents({ storage, source, queryId: 'interop-query', query, fetch: transport })
    if (last.outcome === 'refused') { say(`Refused before anything was requested: ${last.reason}: ${last.detail}`); report.refused = { reason: last.reason, detail: last.detail }; break }
    if (run === 1 && last.pull != null) {
      report.query = last.pull.pass.parameters
      say(`Query subset exercised: ${Object.entries(report.query).map(([name, value]) => `${name}=${value}`).join(', ')}; versions sent: GS1-EPCIS-Version ${source.wireVersions.epcis}, GS1-CBV-Version ${source.wireVersions.cbv}; lists sent ${source.repeatListParameters ? 'as repeated parameters' : 'pipe-delimited'}.`)
    }
    for (const page of last.pages) {
      say(`Page ${page.page} of attempt ${page.attempt}: ${page.events.total} event${page.events.total === 1 ? '' : 's'} in ${page.byteLength} bytes, ${page.documentValidity}; ${page.events.new} new, ${page.events.duplicate} already held, ${page.events.newObservation} observed again, ${page.events.conflict} in conflict; the server reported EPCIS ${page.server.epcis ?? 'in no header'} and CBV ${page.server.cbv ?? 'in no header'}${page.leniencies.length === 0 ? '' : `; accepted leniently: ${page.leniencies.join(', ')}`}.`)
      report.pages.push({ sequence: page.sequence, pass: page.pass, attempt: page.attempt, page: page.page, events: page.events, byteLength: page.byteLength, sha256: page.sha256, mediaType: page.mediaType, documentValidity: page.documentValidity, last: page.last, server: page.server, leniencies: page.leniencies })
    }
    report.runs.push({ run: last.run.run, outcome: last.outcome, reason: last.reason, completion: last.completion, detail: last.detail, ...(last.status == null ? {} : { status: last.status }), ...(last.importRefusal == null ? {} : { importRefusal: last.importRefusal }), pagesFetched: last.run.pagesFetched, pagesAcknowledged: last.run.pagesAcknowledged, bytesRead: last.run.bytesRead, replays: last.run.replays, ...(last.replay == null ? {} : { replay: last.replay.reason }), events: last.events, limits: last.limits, limitOverrides: last.limitOverrides })
    report.completenessLimits = last.completenessLimits
    say(`Run ${last.run.run}: ${last.outcome} (${last.reason}), ${last.completion}. In detail: ${last.detail}.`)
    if (last.completion !== 'stopped-at-limit') break
  }
  report.serverVersions = [...new Map(report.pages.map((page) => [JSON.stringify(page.server), page.server])).values()]
  report.leniencies = [...new Set(report.pages.flatMap((page) => page.leniencies))].sort()
  report.totals = { runs: report.runs.length, pagesRetrieved: report.pages.length, eventsRetrieved: report.pages.reduce((sum, page) => sum + page.events.total, 0), bytes: report.pages.reduce((sum, page) => sum + page.byteLength, 0) }
  const headerVersions = [...new Set(answers.map((answer) => `EPCIS ${answer.epcisVersion ?? 'not sent'}, CBV ${answer.cbvVersion ?? 'not sent'}`))]
  say(`Version headers the server reported: ${headerVersions.length === 0 ? 'none, because nothing answered' : headerVersions.join('; ')}.`)
  say(`Retrieved ${report.totals.pagesRetrieved} pages holding ${report.totals.eventsRetrieved} events in ${report.totals.bytes} bytes over ${report.totals.runs} run${report.totals.runs === 1 ? '' : 's'}.`)
  for (const limit of report.completenessLimits) say(`Not complete history: ${limit}.`)
} finally {
  await storage.close?.()
}

// The report is checked for the credential before it is written, whatever came before.
const text = `${JSON.stringify(report, null, 2)}\n`
const secrets = credential == null ? [] : [credential.token, credential.password, credential.value, credential.scheme === 'basic' ? Buffer.from(`${credential.username}:${credential.password}`).toString('base64') : undefined].filter((secret) => typeof secret === 'string' && secret !== '')
if (secrets.some((secret) => text.includes(secret))) stop('The report would have carried the credential, so it was not written. This is a defect: please report it.', 1)
const reportPath = resolve(env.EPCIS_INTEROP_REPORT || 'epcis-interop-report.json')
writeFileSync(reportPath, text)
say(`Wrote the report to ${reportPath}.`)
say('Nothing was signed, issued, anchored or written to a token. The run shows what this client and this endpoint exchanged, and is no statement that either conforms to a standard.')
process.exitCode = last != null && last.outcome === 'ok' ? 0 : 1
