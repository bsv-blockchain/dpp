/**
 * The DPP overlay node: an HTTP host for two rails, wrapping the
 * `@bsv/overlay` Engine.
 *
 *   the passport   `tm_dpp` admits states, `ls_dpp` resolves them
 *   the anchors    `tm_attestation` admits generic anchors, `ls_attestation`
 *                  looks them up; `tm_uora_dpp` and `ls_uora_dpp` carry the
 *                  historical UORA anchors
 *
 * The wire contract is the ecosystem's standard one (BRC-22 submit, BRC-24
 * lookup), pinned as OpenAPI in `contracts/overlay.yaml`:
 *
 *   POST /submit   application/octet-stream body = BEEF bytes
 *                  X-Topics: ["tm_dpp"]            -> STEAK as JSON, plus an
 *                  X-Admission answer header (topic=admitted|duplicate|none)
 *                  Authorization: Bearer <token>   when SUBMIT_TOKEN is set
 *   POST /lookup   {"service":"ls_dpp","query":{"passportId"|"uid": "..."}}
 *                  {"service":"ls_uora_dpp","query":{"issuer":"did:key:z..."}}
 *                                                  -> {type:"output-list",
 *                                                      outputs:[{beef,outputIndex}]}
 *   POST /arc-ingest {"txid","merklePath","blockHeight"}
 *                                                  -> the proof, checked and
 *                  applied to the held state (spec/services.md section 2);
 *                  X-Callback-Token or bearer when ARC_CALLBACK_TOKEN is set
 *   GET  /health                                   -> {status:"ok",...}
 *
 * And the extensions this reference deployment serves beside them, each in
 * the shape a contract in `contracts/` fixes:
 *
 *   GET  /capabilities                             -> the capability document
 *                  (contracts/capabilities.schema.json), built from constants
 *                  and configuration, never typed by hand
 *   GET  /history?passportId=|uid=&limit=&cursor=  -> one page of a stable
 *                  snapshot (contracts/paginated-history.schema.json), the
 *                  export beside the bounded lookup
 *   GET  /evidence-package?passportId=             -> dpp-evidence-package@1
 *                  as {manifest, files} (contracts/evidence-package.schema.json),
 *                  signed with EXPORT_SIGNING_KEY; 503 when it is unset
 *   POST /retract  {"txid","outputIndex","reason"} -> removes a state the
 *                  network refused, behind the /submit bearer; 409 when the
 *                  state is proven, spent or known to the chain tracker
 *   POST /requestSyncResponse, POST /requestForeignGASPNode
 *                                                  -> the upstream GASP
 *                  routes a peer synchronises from, exactly as the overlay
 *                  protocol defines them
 *
 * Everything is environment; an unset variable switches its feature off or
 * falls back, and only a missing identity key (or a policy file that does not
 * verify) fails the boot. See the Configuration table in this package's
 * README.
 *
 * This file is both the entry point and a library: it boots only when node
 * runs it directly, so tests can drive `createRequestHandler` and
 * `startOverlayService` without a container.
 *
 * Deliberately absent: a Broadcaster and an Advertiser. The app's wallet has
 * already broadcast the transaction by the time it announces it here, so a
 * second broadcast would only add a failure mode; and SHIP/SLAP advertising
 * would need this service to hold a funded wallet of its own. Neither is
 * needed for the demo, and both can be added later without changing the wire.
 * Peer synchronisation is present but static: SYNC_PEERS names the operators
 * this node pulls from through the SDK's GASP (sync.ts), and a state a peer
 * offers passes the same topic managers as one a writer announces.
 * Because this host does not broadcast, no broadcaster's callback reaches it
 * on its own: merkle proofs arrive through POST /arc-ingest, pushed by the
 * writer once its wallet has them or by a broadcaster whose callback URL a
 * writer pointed here (spec/writing.md section 7). Re-announcing a mined state
 * would not do it: the engine skips a txid it already holds.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { MongoClient } from 'mongodb'
import {
  MerklePath,
  PrivateKey,
  Transaction,
  Utils,
  WhatsOnChain,
  type ChainTracker,
  type STEAK,
} from '@bsv/sdk'
import { Engine, type LookupService } from '@bsv/overlay'
import { DppTopicManager, DPP_TOPIC } from './tmDpp.js'
import { DppLookupService, DPP_SERVICE } from './lsDpp.js'
import { InMemoryDppStorage, MongoDppStorage, type DppRecordStore } from './storage.js'
import { InMemoryOverlayStorage, MongoOverlayStorage, type RetractableStorage } from './engineStorage.js'
import { UoraAnchorTopicManager } from './tmUoraDpp.js'
import { UoraAnchorLookupService, UORA_SERVICE, UORA_TOPIC } from './lsUoraDpp.js'
import { AttestationTopicManager, ATTESTATION_TOPIC } from './tmAttestation.js'
import { AttestationLookupService, ATTESTATION_SERVICE } from './lsAttestation.js'
import { InMemoryAttestationStorage, MongoAttestationStorage, validateAttestationQuery, type AttestationStore } from './attestationStorage.js'
import {
  InMemoryUoraAnchorStorage,
  MongoUoraAnchorStorage,
  type UoraAnchorStore,
} from './anchorStorage.js'
import { MAX_BODY_BYTES, MAX_PAGE_SIZE } from './limits.js'
import { buildCapabilities, implementationIdentity } from './capabilities.js'
import { HistoryError, HistoryPaginator } from './history.js'
import { buildEvidencePackage } from './evidenceExport.js'
import { RetractionRefused, retractOutput } from './retraction.js'
import { policyKeysFor, publisherPolicyFromEnvironment, type PublisherPolicyConfig } from './policyConfig.js'
import { startPeerSynchronisation, syncConfigurationFor, syncSettingsFromEnvironment, type SyncSettings } from './sync.js'

export const TOPIC = DPP_TOPIC
export const SERVICE = DPP_SERVICE
export { UORA_SERVICE, UORA_TOPIC }
export { ATTESTATION_SERVICE, ATTESTATION_TOPIC }
/** How long a stop waits for in-flight requests before it gives up. */
const SHUTDOWN_GRACE_MS = 10_000

/** The slice of the Engine the HTTP layer uses, so a test can stand one in. */
export type OverlayEngine = Pick<
  Engine,
  | 'submit'
  | 'lookup'
  | 'listTopicManagers'
  | 'listLookupServiceProviders'
  | 'handleNewMerkleProof'
  | 'getDocumentationForTopicManager'
  | 'getDocumentationForLookupServiceProvider'
  | 'provideForeignSyncResponse'
  | 'provideForeignGASPNode'
>

/**
 * The stores, services and policy the extension routes work on, which the
 * Engine does not expose through its own surface. `/history` and
 * `/evidence-package` read the record store and the engine storage;
 * `/retract` removes from both and tells the lookup services; `/capabilities`
 * reports the policy. Without them, the read routes answer 503 by name and the
 * capability document describes a node with no configured policy.
 */
export interface NodeComponents {
  records: DppRecordStore
  engineStorage: RetractableStorage
  lookupServices: Record<string, LookupService>
  publisherPolicy?: PublisherPolicyConfig
  serviceIdentityKey?: string
  anchorServiceKeys?: string[]
  ownerConsent?: boolean | { authorities: string[] }
  /** SYNC_PEERS and SYNC_INTERVAL_MS, reported by the capability document; the Engine holds the same peers as its syncConfiguration. */
  sync?: Pick<SyncSettings, 'peers' | 'intervalMs'>
}

export interface OverlayHttpOptions {
  /**
   * Shared secret required as `Authorization: Bearer` on POST /submit and
   * POST /retract, the two routes that change what the index holds.
   * `/lookup` and `/health` stay open: browser verification is a stated goal,
   * and a read costs no header quota. Unset leaves both open too, which is only
   * acceptable on a container nobody else can reach.
   */
  submitToken?: string
  /**
   * Shared secret required on POST /arc-ingest, as `Authorization: Bearer` or
   * as `X-Callback-Token`, the two ways an ARC-compatible broadcaster sends the
   * token it was given at submission. Unset leaves the route open; every proof
   * is still verified against the header source before it is stored, so an
   * open route costs header quota rather than truth.
   */
  proofToken?: string
  /**
   * The header source a pushed proof is validated against before it is
   * applied, normally the same one the engine verifies submissions with.
   * 'scripts only' or unset applies a proof on its local check alone, which
   * is the local-development setting the engine's own option already is.
   */
  chainTracker?: ChainTracker | 'scripts only'
  /** Reported by /health. */
  network?: string
  /** Reported by /health. Defaults to the moment the handler was made. */
  startedAt?: string
  /**
   * The address to bind. Unset binds the wildcard, which is what a container
   * wants and what `main()` leaves it as.
   *
   * **A test must set this, and the reason is not tidiness.** A wildcard bind
   * on an ephemeral port succeeds even when another process already holds that
   * exact port bound to `127.0.0.1` alone: there is no `EADDRINUSE`, and
   * `address().port` reports the port as though it were ours. A request to
   * `127.0.0.1` then goes to the more specific binding, so the caller is
   * answered by the other process and the service it started never sees the
   * request. Found on 2026-08-06 behind an intermittent failure in
   * `test/http.test.ts`: a Logitech daemon holding three ports at the bottom of
   * the ephemeral range answered `501` with an empty body, which surfaces
   * either as a wrong status or as `Unexpected end of JSON input`, roughly once
   * in a hundred server starts. Binding the loopback explicitly makes the
   * socket a caller reaches the socket that was bound.
   */
  host?: string
  /** What the extension routes work on; see `NodeComponents`. */
  components?: NodeComponents
  /**
   * EXPORT_SIGNING_KEY: the private key, hex, that signs evidence-package
   * manifests. Unset, GET /evidence-package answers 503 export-unavailable and
   * the capability document lists the export as unsupported. Malformed, the
   * handler refuses to be built, which is the boot.
   */
  exportSigningKey?: string
  /**
   * Whether the network knows a transaction, for POST /retract: asked of the
   * header source's operator before an output is removed. Unset when there is
   * no header source (CHAIN_TRACKER=scripts-only); the retraction then runs on
   * the local merkle-path check alone and its answer says so.
   */
  knownOnChain?: (txid: string) => Promise<boolean>
  /** The clock: snapshot expiry, export time and the policy's "active now" read it. Injectable for tests. */
  now?: () => Date
}

/** An error that answers with something other than the default 400. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

/** A refusal the wire names, so a client branches on `error` and reads `description` as prose. */
class NamedError extends HttpError {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly hint?: string
  ) {
    super(status, message)
  }
}

function json(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    ...headers,
  })
  response.end(payload)
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'request body too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function topicsFrom(request: IncomingMessage): string[] {
  const header = request.headers['x-topics']
  const raw = Array.isArray(header) ? header[0] : header
  if (raw == null || raw === '') return [TOPIC]
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new HttpError(400, 'X-Topics must be a JSON array of strings')
  }
  if (!Array.isArray(parsed) || parsed.some((t) => typeof t !== 'string')) {
    throw new HttpError(400, 'X-Topics must be a JSON array of strings')
  }
  return parsed as string[]
}

/**
 * BRC-22 allows off-chain values to ride along with the BEEF, length-prefixed.
 * The app never sends them; supporting the header keeps a standard client
 * (the SDK's SHIPBroadcaster) from being silently mis-parsed.
 */
function splitBody(
  request: IncomingMessage,
  body: Buffer
): {
  beef: number[]
  offChainValues?: number[]
} {
  const flag = request.headers['x-includes-off-chain-values']
  if (flag !== 'true') return { beef: [...body] }
  const reader = new Utils.Reader([...body])
  const length = reader.readVarIntNum()
  return { beef: reader.read(length), offChainValues: reader.read() }
}

/**
 * Constant-time bearer comparison. The token is a shared secret rather than a
 * per-caller credential, so the only thing worth denying an attacker is a
 * byte-at-a-time oracle.
 */
function bearerAccepted(request: IncomingMessage, expected: string): boolean {
  const header = request.headers.authorization
  const raw = Array.isArray(header) ? header[0] : header
  if (raw == null) return false
  const match = /^bearer\s+(.+)$/i.exec(raw.trim())
  if (match == null) return false
  return secretsEqual(match[1], expected)
}

function secretsEqual(given: string, expected: string): boolean {
  const a = Buffer.from(given, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * The callback token as an ARC-compatible broadcaster presents it: the token
 * given at submission comes back as `Authorization: Bearer`, and the overlay
 * host upstream also reads `X-Callback-Token`, so both are accepted.
 */
function callbackTokenAccepted(request: IncomingMessage, expected: string): boolean {
  if (bearerAccepted(request, expected)) return true
  const header = request.headers['x-callback-token']
  const raw = Array.isArray(header) ? header[0] : header
  if (raw == null) return false
  return secretsEqual(raw.trim(), expected)
}

/**
 * The body of a proof callback, as the stack's broadcast contract defines it
 * (`ArcMerkleCallback`): the txid, the BRC-74 BUMP in hex, and the block
 * height, which the BUMP also carries. A proof that does not contain the
 * txid, or a body that disagrees with itself about the height, is refused
 * rather than trusted on either value. No merkle path means a status-only
 * callback, which the caller acknowledges rather than refuses.
 */
function parseProofCallback(body: Buffer): { txid: string; merklePath?: MerklePath } {
  let parsed: unknown
  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch {
    throw new HttpError(400, 'body must be JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, 'body must be a JSON object with txid and merklePath')
  }
  const { txid, merklePath, blockHeight } = parsed as Record<string, unknown>
  if (typeof txid !== 'string' || !/^[0-9a-f]{64}$/.test(txid)) {
    throw new HttpError(400, 'txid must be 64 lower-case hex characters')
  }
  if (merklePath == null || merklePath === '') return { txid }
  if (typeof merklePath !== 'string') throw new HttpError(400, 'merklePath must be a BUMP in hex')
  let proof: MerklePath
  try {
    proof = MerklePath.fromHex(merklePath)
  } catch {
    throw new HttpError(400, 'merklePath is not a BUMP')
  }
  try {
    proof.computeRoot(txid)
  } catch {
    throw new HttpError(400, 'merklePath does not contain txid')
  }
  if (blockHeight != null && blockHeight !== proof.blockHeight) {
    throw new HttpError(400, 'blockHeight does not match the merkle path')
  }
  return { txid, merklePath: proof }
}

/** A JSON object body, or a 400 naming what it should have carried. */
function parseJsonObject(body: Buffer, expected: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch {
    throw new HttpError(400, 'body must be JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, `body must be a JSON object with ${expected}`)
  }
  return parsed as Record<string, unknown>
}

/**
 * The body of a retraction: the outpoint and the writer's reason, which is
 * logged and echoed and never interpreted. Bounded so a log line stays a log
 * line.
 */
function parseRetraction(body: Buffer): { txid: string; outputIndex: number; reason: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch {
    throw new HttpError(400, 'body must be JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, 'body must be a JSON object with txid, outputIndex and reason')
  }
  const { txid, outputIndex, reason } = parsed as Record<string, unknown>
  if (typeof txid !== 'string' || !/^[0-9a-f]{64}$/.test(txid)) {
    throw new HttpError(400, 'txid must be 64 lower-case hex characters')
  }
  if (typeof outputIndex !== 'number' || !Number.isSafeInteger(outputIndex) || outputIndex < 0) {
    throw new HttpError(400, 'outputIndex must be a non-negative integer')
  }
  if (typeof reason !== 'string' || reason.trim() === '' || reason.length > 1000) {
    throw new HttpError(400, 'reason must be a non-empty string of at most 1000 characters')
  }
  return { txid, outputIndex, reason: reason.trim() }
}

/**
 * The lookup query, checked before it reaches any engine. The Mongo stores
 * build filters from these fields, so a value that is not a plain string is a
 * query operator waiting to run: `{"uid":{"$ne":""}}` would otherwise match
 * every document. `limit` alone may be a number; `ls_uora_dpp` documents it as
 * the answer's page size and the stores bound it themselves.
 */
function checkedQuery(query: unknown, service?: string): Record<string, unknown> {
  if (service === ATTESTATION_SERVICE) {
    try { return { ...validateAttestationQuery(query) } }
    catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'invalid attestation query') }
  }
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    throw new HttpError(400, 'query must be an object of string fields')
  }
  for (const [key, value] of Object.entries(query)) {
    if (key === 'limit') {
      if (typeof value === 'number' && Number.isFinite(value)) continue
      throw new HttpError(400, 'query.limit must be a finite number')
    }
    if (typeof value !== 'string') {
      throw new HttpError(400, `query.${key} must be a string`)
    }
  }
  return query as Record<string, unknown>
}

type AdmissionOutcome = 'admitted' | 'duplicate' | 'none'

/**
 * What one topic's STEAK entry actually says. The discriminator is pinned
 * `@bsv/overlay` 2.0.3 behaviour: a duplicate skips the mutation phase, so its
 * entry never gains `coinsRemoved`, while a refused non-duplicate passes
 * through it and gets `coinsRemoved` set (to `[]` when nothing was removed).
 * A topic whose validation threw inside the engine also reads as `duplicate`
 * here; the engine logs its own error line for that path.
 */
function admissionOutcome(instructions: STEAK[string]): AdmissionOutcome {
  const removed = instructions.coinsRemoved
  if (instructions.outputsToAdmit.length > 0 || (removed?.length ?? 0) > 0) return 'admitted'
  if (removed === undefined) return 'duplicate'
  return 'none'
}

/** Only wanted when a warning fires, so junk bytes on a happy path cost nothing. */
function txidOf(beef: number[]): string {
  try {
    return Transaction.fromBEEF(beef).id('hex')
  } catch {
    return 'an unparseable BEEF'
  }
}

/**
 * A "duplicate" the engine holds nothing for was refused earlier: the Engine
 * records every transaction it validates as applied to the topic, admitted or
 * not, and skips a txid it has applied, so a state refused once for a reason
 * that has since gone (its predecessor announced after it, a policy version
 * not yet loaded, a stranger announcing a successor before the writer could
 * announce its predecessor) would read as a duplicate for ever and the writer
 * would record success. When this host's storage shows no admitted output of
 * the txid for a topic that read as a duplicate, it clears the applied record
 * and submits the transaction again for those topics, so the answer is what
 * the topic managers say today: admitted, or none. Returns the topics
 * re-evaluated; `steak` is updated in place for them. Without the storage (a
 * stand-in engine) nothing changes.
 */
async function reconsiderRefusedEarlier(
  engine: OverlayEngine,
  options: HandlerOptions,
  beef: number[],
  offChainValues: number[] | undefined,
  steak: STEAK,
  outcomes: ReadonlyArray<readonly [string, AdmissionOutcome]>
): Promise<string[]> {
  const storage = options.components?.engineStorage
  if (storage == null || storage.deleteAppliedTransaction == null) return []
  const duplicates = outcomes.filter(([, outcome]) => outcome === 'duplicate').map(([topic]) => topic)
  if (duplicates.length === 0) return []
  let txid: string
  try {
    txid = Transaction.fromBEEF(beef).id('hex')
  } catch {
    return []
  }
  const held = await storage.findOutputsForTransaction(txid)
  const refusedEarlier = duplicates.filter((topic) => !held.some((output) => output.topic === topic))
  if (refusedEarlier.length === 0) return []
  for (const topic of refusedEarlier) await storage.deleteAppliedTransaction({ txid, topic })
  const again = await engine.submit({ beef, topics: refusedEarlier, offChainValues })
  for (const topic of refusedEarlier) if (again[topic] != null) steak[topic] = again[topic]
  return refusedEarlier
}

/**
 * The whole HTTP surface, as a plain node request listener. Separated from the
 * server so a test can exercise the wire contract against a stand-in engine.
 */
export function createRequestHandler(
  engine: OverlayEngine,
  options: OverlayHttpOptions = {}
): (request: IncomingMessage, response: ServerResponse) => void {
  const network = options.network ?? 'main'
  const startedAt = options.startedAt ?? new Date().toISOString()
  const submitToken =
    options.submitToken != null && options.submitToken !== '' ? options.submitToken : undefined
  const proofToken =
    options.proofToken != null && options.proofToken !== '' ? options.proofToken : undefined
  const chainTracker = options.chainTracker
  const now = options.now ?? (() => new Date())
  const components = options.components
  // The paginator holds this process's cursor secret, so it lives as long as
  // the handler: one per node, drawn at boot.
  const paginator = components == null ? undefined : new HistoryPaginator(components.records, { now })
  const exportSigner =
    options.exportSigningKey != null && options.exportSigningKey !== ''
      ? PrivateKey.fromHex(options.exportSigningKey)
      : undefined
  const identity = implementationIdentity()

  const resolved: HandlerOptions = {
    submitToken,
    proofToken,
    chainTracker,
    network,
    startedAt,
    now,
    components,
    paginator,
    exportSigner,
    knownOnChain: options.knownOnChain,
    software: `${identity.name}@${identity.version}`,
  }
  return (request, response) => {
    void handle(engine, request, response, resolved)
  }
}

interface HandlerOptions {
  submitToken?: string
  proofToken?: string
  chainTracker?: ChainTracker | 'scripts only'
  network: string
  startedAt: string
  now: () => Date
  components?: NodeComponents
  paginator?: HistoryPaginator
  exportSigner?: PrivateKey
  knownOnChain?: (txid: string) => Promise<boolean>
  software: string
}

async function handle(
  engine: OverlayEngine,
  request: IncomingMessage,
  response: ServerResponse,
  options: HandlerOptions
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const route = `${request.method ?? 'GET'} ${url.pathname}`

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers':
        'Authorization, Content-Type, X-Topics, X-Includes-Off-Chain-Values, X-Callback-Token',
    })
    response.end()
    return
  }

  try {
    if (route === 'GET /health') {
      json(response, 200, {
        status: 'ok',
        // `topic` and `service` name the passport rail and stay singular:
        // deployed health checks read them, and a second rail is not a reason
        // to break a probe. The full set is beside them.
        topic: TOPIC,
        service: SERVICE,
        topics: [TOPIC, ATTESTATION_TOPIC, UORA_TOPIC],
        services: [SERVICE, ATTESTATION_SERVICE, UORA_SERVICE],
        legacyTopics: [UORA_TOPIC],
        legacyServices: [UORA_SERVICE],
        network: options.network,
        startedAt: options.startedAt,
      })
      return
    }

    if (route === 'GET /capabilities') {
      const components = options.components
      json(response, 200, buildCapabilities({
        publisherPolicy: components?.publisherPolicy,
        serviceIdentityKey: components?.serviceIdentityKey,
        anchorServiceKeys: components?.anchorServiceKeys,
        ownerConsent: components?.ownerConsent,
        exportAvailable: options.exportSigner != null,
        networkOracleConfigured: options.knownOnChain != null,
        at: options.now(),
        syncPeers: components?.sync?.peers,
        syncIntervalMs: components?.sync?.intervalMs,
      }))
      return
    }

    if (route === 'GET /listTopicManagers') {
      json(response, 200, await engine.listTopicManagers())
      return
    }

    if (route === 'GET /listLookupServiceProviders') {
      json(response, 200, await engine.listLookupServiceProviders())
      return
    }

    if (route === 'GET /getDocumentationForTopicManager' || route === 'GET /getDocumentationForLookupServiceProvider') {
      const params = new URL(request.url ?? '/', 'http://localhost').searchParams
      const topic = route === 'GET /getDocumentationForTopicManager'
      const parameter = topic ? 'manager' : 'lookupService'
      const name = params.get(parameter)
      const available = topic ? await engine.listTopicManagers() : await engine.listLookupServiceProviders()
      if (!name || params.getAll(parameter).length !== 1 || !Object.hasOwn(available, name)) {
        json(response, 400, { status: 'error', description: `unknown or missing ${parameter}` })
        return
      }
      const documentation = topic ? await engine.getDocumentationForTopicManager(name) : await engine.getDocumentationForLookupServiceProvider(name)
      response.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
      response.end(documentation)
      return
    }

    if (route === 'POST /submit') {
      // Checked before the body is buffered: an unauthorised caller should not
      // get to spend memory here, let alone the header quota that
      // Engine.submit's SPV check spends downstream.
      if (options.submitToken != null && !bearerAccepted(request, options.submitToken)) {
        request.resume()
        json(response, 401, { status: 'error', description: 'POST /submit requires a bearer token' })
        return
      }
      const body = await readBody(request)
      if (body.length === 0) {
        json(response, 400, { status: 'error', description: 'empty body' })
        return
      }
      const topics = topicsFrom(request)
      const { beef, offChainValues } = splitBody(request, body)
      const steak = await engine.submit({ beef, topics, offChainValues })
      let outcomes = topics
        .filter((topic) => steak[topic] != null)
        .map((topic) => [topic, admissionOutcome(steak[topic])] as const)
      const refusedEarlier = await reconsiderRefusedEarlier(engine, options, beef, offChainValues, steak, outcomes)
      if (refusedEarlier.length > 0) {
        outcomes = topics
          .filter((topic) => steak[topic] != null)
          .map((topic) => [topic, admissionOutcome(steak[topic])] as const)
      }
      const refused = outcomes.filter(([, outcome]) => outcome === 'none').map(([topic]) => topic)
      if (refused.length > 0) {
        const again = refused.filter((topic) => refusedEarlier.includes(topic))
        console.warn(
          `POST /submit admitted nothing on ${refused.join(', ')} for ${txidOf(beef)}: ` +
            'not a duplicate, so the submission was refused (wrong identity key, a ' +
            'predecessor this instance never admitted, or, when OWNER_CONSENT is set, a ' +
            'TRANSFER whose actor did not prove they are the previous owner). Re-announce after repair, ' +
            'oldest state first: an index that never admitted a predecessor ' +
            'refuses every later state.' +
            (again.length === 0 ? '' : ` This transaction was announced and refused before on ${again.join(', ')} and was re-evaluated now, not skipped.`)
        )
      }
      // The STEAK body stays exactly what the engine returned, because that is
      // the protocol's shape; the header is where the outcome is allowed to be
      // plainer than the body.
      json(response, 200, steak, {
        'X-Admission': outcomes.map(([topic, outcome]) => `${topic}=${outcome}`).join(', '),
        'Access-Control-Expose-Headers': 'X-Admission',
      })
      return
    }

    if (route === 'POST /arc-ingest') {
      // A merkle proof for a state this index holds, in the shape an
      // ARC-compatible broadcaster's callback carries, so a writer offering a
      // proof and a broadcaster whose callback URL points here send the same
      // body (spec/writing.md section 7). The token is checked before the body
      // is read, as on /submit.
      if (options.proofToken != null && !callbackTokenAccepted(request, options.proofToken)) {
        request.resume()
        json(response, 401, {
          status: 'error',
          description: 'POST /arc-ingest requires the callback token',
        })
        return
      }
      const callback = parseProofCallback(await readBody(request))
      if (callback.merklePath === undefined) {
        // A status-only callback (seen, rejected) carries no proof and is not
        // an error: answering 200 keeps a broadcaster from retrying it forever.
        json(response, 200, { status: 'ignored', txid: callback.txid, reason: 'no merkle path' })
        return
      }
      const { txid, merklePath } = callback
      // spec/services.md section 2: a pushed proof is admission of a kind, so
      // it is validated against the header source before anything is stored.
      // No answer from the source is neither agreement nor refutation; the
      // proof is not applied and the caller is told to try again.
      const tracker = options.chainTracker
      if (tracker != null && tracker !== 'scripts only') {
        let proven: boolean
        try {
          proven = await merklePath.verify(txid, tracker)
        } catch (cause) {
          console.warn(`POST /arc-ingest could not evaluate the proof for ${txid}:`, cause)
          throw new HttpError(503, 'header source unavailable; the proof was not applied, try again')
        }
        if (!proven) throw new HttpError(400, 'merklePath does not validate against block headers')
      }
      try {
        await engine.handleNewMerkleProof(txid, merklePath, merklePath.blockHeight)
      } catch (cause) {
        if (cause instanceof Error && /Could not find matching transaction outputs/.test(cause.message)) {
          throw new HttpError(404, 'this index holds no output of that transaction')
        }
        throw cause
      }
      console.log(`POST /arc-ingest applied the proof for ${txid} at height ${merklePath.blockHeight}`)
      json(response, 200, { status: 'applied', txid, blockHeight: merklePath.blockHeight })
      return
    }

    if (route === 'POST /requestSyncResponse') {
      // The first half of a peer's synchronisation (GASP, as the upstream
      // overlay protocol defines it): which outputs this index holds for the
      // topic named in X-BSV-Topic since the peer's checkpoint. Read-only, and
      // open like /lookup: what it lists is findable either way.
      const header = request.headers['x-bsv-topic']
      const topic = Array.isArray(header) ? header[0] : header
      if (topic == null || topic === '') throw new HttpError(400, 'X-BSV-Topic header is required')
      if (!Object.hasOwn(await engine.listTopicManagers(), topic)) throw new HttpError(400, `unknown topic ${topic}`)
      const body = parseJsonObject(await readBody(request), 'version and since')
      const { version, since, limit } = body
      if (typeof version !== 'number' || !Number.isFinite(version)) throw new HttpError(400, 'version must be a number')
      if (typeof since !== 'number' || !Number.isSafeInteger(since) || since < 0) throw new HttpError(400, 'since must be a non-negative integer')
      if (limit !== undefined && (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1)) {
        throw new HttpError(400, 'limit must be a positive integer')
      }
      // The engine's storage applies no cap of its own, so an absent or a
      // large limit would hand an anonymous peer every unspent output of the
      // topic in one answer. The page is bounded as every other answer is;
      // a peer holding more continues from its checkpoint next round.
      const page = Math.min(typeof limit === 'number' ? limit : MAX_PAGE_SIZE, MAX_PAGE_SIZE)
      json(response, 200, await engine.provideForeignSyncResponse({ version, since, limit: page }, topic))
      return
    }

    if (route === 'POST /requestForeignGASPNode') {
      // The second half: one transaction of a graph the peer is assembling,
      // with its merkle path when this index holds one. The graph identifier
      // is the outpoint at the tip of the graph, txid.outputIndex.
      const body = parseJsonObject(await readBody(request), 'graphID, txid and outputIndex')
      const { graphID, txid, outputIndex } = body
      if (typeof graphID !== 'string' || !/^[0-9a-f]{64}\.\d+$/.test(graphID)) throw new HttpError(400, 'graphID must be txid.outputIndex')
      if (typeof txid !== 'string' || !/^[0-9a-f]{64}$/.test(txid)) throw new HttpError(400, 'txid must be 64 lower-case hex characters')
      if (typeof outputIndex !== 'number' || !Number.isSafeInteger(outputIndex) || outputIndex < 0) {
        throw new HttpError(400, 'outputIndex must be a non-negative integer')
      }
      try {
        json(response, 200, await engine.provideForeignGASPNode(graphID, txid, outputIndex))
      } catch (cause) {
        if (cause instanceof Error && /No matching output found|Unable to find output/.test(cause.message)) {
          throw new HttpError(404, 'this index holds no such output in that graph')
        }
        throw cause
      }
      return
    }

    if (route === 'POST /lookup') {
      const body = await readBody(request)
      let question: { service?: unknown; query?: unknown }
      try {
        question = JSON.parse(body.toString('utf8')) as { service?: unknown; query?: unknown }
      } catch {
        throw new HttpError(400, 'body must be JSON')
      }
      if (typeof question.service !== 'string') {
        json(response, 400, { status: 'error', description: 'service is required' })
        return
      }
      const answer = await engine.lookup({
        service: question.service,
        query: checkedQuery(question.query, question.service),
      })
      json(response, 200, answer)
      return
    }

    if (route === 'GET /history') {
      // The export beside the bounded lookup (spec/portable-evidence.md
      // section 1): pages of one snapshot, in the record store's own order.
      if (options.paginator == null) {
        throw new NamedError(503, 'history-unavailable', 'this node was started without its record store; GET /history is not served')
      }
      const params = url.searchParams
      const page = await options.paginator.page({
        selector: { passportId: params.get('passportId') ?? undefined, uid: params.get('uid') ?? undefined },
        limit: params.get('limit'),
        cursor: params.get('cursor'),
      })
      json(response, 200, page)
      return
    }

    if (route === 'GET /evidence-package') {
      // spec/portable-evidence.md section 2. The signer is the switch: without
      // one there is no manifest anyone could hold this node to, so the route
      // says so rather than serving an unsigned bundle.
      if (options.exportSigner == null) {
        throw new NamedError(503, 'export-unavailable', 'EXPORT_SIGNING_KEY is unset, so this node signs no evidence package; GET /history and POST /lookup remain')
      }
      if (options.components == null || options.paginator == null) {
        throw new NamedError(503, 'export-unavailable', 'this node was started without its stores; GET /evidence-package is not served')
      }
      const passportId = url.searchParams.get('passportId')
      if (passportId == null || passportId === '') {
        throw new NamedError(400, 'query-invalid', 'passportId is required')
      }
      const envelope = await buildEvidencePackage({
        passportId,
        paginator: options.paginator,
        engineStorage: options.components.engineStorage,
        signingKey: options.exportSigner,
        publisherPolicy: options.components.publisherPolicy,
        serviceIdentityKey: options.components.serviceIdentityKey,
        ownerConsent: options.components.ownerConsent,
        chainTracker: options.chainTracker,
        now: options.now(),
        software: options.software,
      })
      if (envelope == null) {
        throw new NamedError(404, 'passport-unknown', `this index holds no state of ${passportId}`)
      }
      json(response, 200, envelope)
      return
    }

    if (route === 'POST /retract') {
      // A writer announced before sending, as the writing rules allow, and the
      // network refused the transaction; the index holds a phantom tip. The
      // same bearer as /submit: whoever may add a state may withdraw one.
      if (options.submitToken != null && !bearerAccepted(request, options.submitToken)) {
        request.resume()
        json(response, 401, { status: 'error', description: 'POST /retract requires the /submit bearer token' })
        return
      }
      if (options.components == null) {
        request.resume()
        throw new NamedError(503, 'retraction-unavailable', 'this node was started without its stores; POST /retract is not served')
      }
      const { txid, outputIndex, reason } = parseRetraction(await readBody(request))
      const retraction = await retractOutput({
        storage: options.components.engineStorage,
        lookupServices: options.components.lookupServices,
        records: options.components.records,
        topic: TOPIC,
        txid,
        outputIndex,
        reason,
        knownOnChain: options.knownOnChain,
      })
      console.warn(
        `POST /retract removed ${TOPIC} output ${txid}:${outputIndex} (${reason})` +
          (retraction.restoredTip == null ? '' : `; ${retraction.restoredTip.txid}:${retraction.restoredTip.outputIndex} is the tip again`) +
          (retraction.networkChecked ? '' : '; the network was not asked, no header source is configured')
      )
      json(response, 200, {
        status: 'retracted',
        ...retraction,
        ...(retraction.networkChecked
          ? {}
          : { note: 'the network was not asked whether it knows this transaction: no header source is configured (CHAIN_TRACKER=scripts-only), so only the local merkle-path check ran' }),
      })
      return
    }

    json(response, 404, { status: 'error', description: `no route for ${route}` })
  } catch (cause) {
    const description = cause instanceof Error ? cause.message : 'unknown error'
    if (cause instanceof NamedError || cause instanceof HistoryError || cause instanceof RetractionRefused) {
      // Named refusals are the client's to branch on and are not failures of
      // this node, so they are logged as a line rather than a stack.
      console.warn(`${route} refused (${cause.code}): ${description}`)
      json(response, cause.status, {
        status: 'error',
        error: cause.code,
        description,
        ...('hint' in cause && cause.hint != null ? { hint: cause.hint } : {}),
      })
      return
    }
    const status = cause instanceof HttpError ? cause.status : 400
    console.error(`${route} failed:`, cause)
    json(response, status, { status: 'error', description })
  }
}

export interface RunningService {
  server: Server
  /** The port actually bound, which matters when the caller asked for 0. */
  port: number
  close: () => Promise<void>
}

/** Bind the HTTP surface. Resolves once the socket is listening. */
export async function startOverlayService(
  engine: OverlayEngine,
  options: OverlayHttpOptions & { port?: number } = {}
): Promise<RunningService> {
  const server = createServer(createRequestHandler(engine, options))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    // `listen(port, host)` when a host is given, `listen(port)` otherwise: the
    // wildcard stays the default so a container is unchanged.
    const listening = (): void => {
      server.removeListener('error', reject)
      resolve()
    }
    if (options.host != null && options.host !== '') {
      server.listen(options.port ?? 8080, options.host, listening)
      return
    }
    server.listen(options.port ?? 8080, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  const address = server.address()
  const port = typeof address === 'object' && address != null ? address.port : (options.port ?? 0)
  return {
    server,
    port,
    close: async () => {
      await new Promise<void>((resolve) => {
        // Idle keep-alive sockets would otherwise hold the close open until a
        // platform's kill timer beat it.
        server.closeIdleConnections()
        server.close(() => resolve())
        setTimeout(resolve, SHUTDOWN_GRACE_MS).unref()
      })
    },
  }
}

/**
 * The key `server_signature` is checked against (`spec/record-model.md` §5). Only the
 * public half is needed, so the deployment should set SERVICE_IDENTITY_KEY
 * and this service never holds the treasury secret. SERVER_PRIVATE_KEY is
 * accepted as a fallback because it is what every other component is
 * configured with, but it grants this container more than it needs.
 */
export function serviceIdentityKey(): string {
  const declared = optionalServiceIdentityKey()
  if (declared != null) return declared
  throw new Error('Set SERVICE_IDENTITY_KEY (or SERVER_PRIVATE_KEY) so admission can be checked')
}

/** The same key when the environment names one, or undefined: under a publisher policy the key is optional. */
function optionalServiceIdentityKey(): string | undefined {
  const declared = process.env.SERVICE_IDENTITY_KEY
  if (declared != null && declared !== '') return declared
  const priv = process.env.SERVER_PRIVATE_KEY
  if (priv != null && priv !== '') {
    console.warn(
      'SERVICE_IDENTITY_KEY is unset; deriving it from SERVER_PRIVATE_KEY. ' +
        'Set the public key instead so this service holds no secret.'
    )
    return PrivateKey.fromHex(priv).toPublicKey().toString()
  }
  return undefined
}

/**
 * Identity keys of the anchoring services whose UORA anchors this instance
 * admits, comma-separated in ANCHOR_SERVICE_KEYS.
 *
 * A list rather than one key, because the shared overlay instances this topic
 * is meant for may serve more than one anchoring deployment, and because the
 * resolver already established that this programme has anchored under two
 * treasuries without being able to tell which.
 *
 * Public keys only. Unlike `serviceIdentityKey` there is no private-key
 * fallback: the anchoring treasury is a different custody boundary from this
 * container, and inviting an operator to paste its secret here to save a step
 * is exactly the convenience that should not exist.
 */
export function anchorServiceKeys(): string[] {
  const declared = process.env.ANCHOR_SERVICE_KEYS
  if (declared == null || declared.trim() === '') return []
  return declared
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key !== '')
}

/**
 * The owner-signed transfer (`spec/custody.md` §4) is a profile's choice, and
 * a deployment selects it with OWNER_CONSENT=required. TRANSFER_AUTHORITIES
 * then names, comma-separated, the identity keys that may move ownership
 * without proving consent (recovery); public keys only, as for
 * ANCHOR_SERVICE_KEYS, and validated when the topic manager is built. Any
 * other value of OWNER_CONSENT fails the boot rather than being read as a
 * guess, and authorities set without the policy are a misconfiguration worth a
 * warning, because they would silently do nothing.
 */
export function ownerConsentPolicy(): boolean | { authorities: string[] } {
  const declared = (process.env.OWNER_CONSENT ?? '').trim()
  const authorities = (process.env.TRANSFER_AUTHORITIES ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key !== '')
  if (declared === '') {
    if (authorities.length > 0) {
      console.warn(
        'TRANSFER_AUTHORITIES is set but OWNER_CONSENT is not: the authorities are ignored, ' +
          'because there is no consent rule for them to be exempt from'
      )
    }
    return false
  }
  if (declared !== 'required') {
    throw new Error(`OWNER_CONSENT must be "required" or unset, got "${declared}"`)
  }
  return authorities.length === 0 ? true : { authorities }
}

/**
 * EXPORT_SIGNING_KEY: the private key that signs evidence-package manifests
 * (`spec/portable-evidence.md` section 2). Optional, because a node that
 * exports nothing needs no key; malformed, it fails the boot, because a key
 * that cannot sign is a promise the capability document would break.
 */
export function exportSigningKey(): string | undefined {
  const declared = (process.env.EXPORT_SIGNING_KEY ?? '').trim()
  if (declared === '') {
    console.warn('EXPORT_SIGNING_KEY is unset: GET /evidence-package answers 503 export-unavailable')
    return undefined
  }
  try {
    PrivateKey.fromHex(declared)
  } catch {
    throw new Error('EXPORT_SIGNING_KEY is not a private key in hex')
  }
  return declared
}

/**
 * 'scripts only' skips header verification, which is a local-development
 * convenience and never a hosted setting: it would admit a transaction whose
 * ancestry is not proved.
 */
function chainTracker(network: 'main' | 'test'): ChainTracker | 'scripts only' {
  if (process.env.CHAIN_TRACKER === 'scripts-only') {
    console.warn('CHAIN_TRACKER=scripts-only: submissions are NOT verified against block headers')
    return 'scripts only'
  }
  const apiKey = process.env.WOC_API_KEY
  return new WhatsOnChain(network, apiKey != null && apiKey !== '' ? { apiKey } : undefined)
}

/**
 * Whether the network knows a transaction, asked of the same explorer the
 * default header source reads, for POST /retract: a transaction it answers is
 * one the network took, and an index does not retract what a block holds. A
 * 404 is the one negative; any other failure is neither and is reported as
 * the source being unavailable.
 */
export function whatsOnChainKnows(network: 'main' | 'test', apiKey?: string): (txid: string) => Promise<boolean> {
  const base = `https://api.whatsonchain.com/v1/bsv/${network}/tx/hash/`
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (apiKey != null && apiKey.trim() !== '') headers.Authorization = apiKey
  return async (txid: string): Promise<boolean> => {
    const response = await fetch(base + txid, { headers })
    if (response.status === 404) return false
    if (response.ok) return true
    throw new Error(`the explorer answered ${response.status} for ${txid}`)
  }
}

/** The engine as the environment describes it, plus what the routes work on and whatever it has to close. */
async function engineFromEnvironment(
  network: 'main' | 'test',
  tracker: ChainTracker | 'scripts only'
): Promise<{
  engine: Engine
  components: NodeComponents
  close: () => Promise<void>
}> {
  // The policy first: with a chain, the single identity key is optional and,
  // where the chain covers tm_dpp, not consulted at all.
  const publisherPolicy = publisherPolicyFromEnvironment()
  const identityKey = publisherPolicy == null ? serviceIdentityKey() : optionalServiceIdentityKey()
  if (publisherPolicy != null) {
    console.log(
      `${TOPIC} admits under publisher policy versions ${publisherPolicy.versions.join(', ')} from ${publisherPolicy.source} ` +
        `(${publisherPolicy.chain[publisherPolicy.chain.length - 1].scope.operatorProfile}); ` +
        (identityKey == null ? 'no SERVICE_IDENTITY_KEY is set' : 'SERVICE_IDENTITY_KEY applies only where the policy does not cover a topic')
    )
  }
  const mongoUrl = process.env.MONGO_URL

  let records: DppRecordStore
  let anchors: UoraAnchorStore
  let attestations: AttestationStore
  let engineStorage: InMemoryOverlayStorage | MongoOverlayStorage
  let close = async (): Promise<void> => {}

  if (mongoUrl != null && mongoUrl !== '') {
    const client = new MongoClient(mongoUrl)
    await client.connect()
    const db = client.db(process.env.MONGO_DB)
    const mongoRecords = new MongoDppStorage(db)
    // Indexes and the sequence numbering of rows older than the field, before
    // a request can ask for a page (storage.ts).
    await mongoRecords.ensureReady()
    records = mongoRecords
    anchors = new MongoUoraAnchorStorage(db)
    attestations = new MongoAttestationStorage(db)
    const storage = new MongoOverlayStorage(db)
    await storage.ensureIndexes()
    engineStorage = storage
    close = async () => {
      await client.close()
    }
    console.log('overlay state persists to MongoDB')
  } else {
    records = new InMemoryDppStorage()
    anchors = new InMemoryUoraAnchorStorage()
    attestations = new InMemoryAttestationStorage()
    engineStorage = new InMemoryOverlayStorage()
    console.warn(
      'MONGO_URL is unset: overlay state is in memory and is lost on restart. ' +
        'Fine locally, never hosted.'
    )
  }

  const acceptedAnchorServices = anchorServiceKeys()
  // A policy restricts the anchor rail only where its scope covers the topic;
  // elsewhere the static list is in charge, and an empty static list admits
  // anchors from anyone. The capability document says the same under
  // unsupported (anchoring-service-restriction), so the warning and the
  // document never disagree about what an empty list means.
  const anchorsRestrictedByPolicy =
    publisherPolicy != null && policyKeysFor(publisherPolicy.chain, new Date(), 'anchor-publisher', ATTESTATION_TOPIC) != null
  if (acceptedAnchorServices.length === 0 && !anchorsRestrictedByPolicy) {
    console.warn(
      `ANCHOR_SERVICE_KEYS is unset${publisherPolicy == null ? '' : ' and the publisher policy does not cover the anchor topic'}: ` +
        `${ATTESTATION_TOPIC} admits any well-formed anchor, whoever wrote it. Name the anchoring services on any deployment a stranger can reach.`
    )
  }

  const ownerConsent = ownerConsentPolicy()
  if (ownerConsent === false) {
    console.log(`${TOPIC} admits any signed TRANSFER that spends the tip (OWNER_CONSENT is unset)`)
  } else {
    console.log(
      `${TOPIC} requires the owner-signed transfer on every TRANSFER` +
        (typeof ownerConsent === 'object'
          ? `, except by the transfer authorities ${ownerConsent.authorities.join(', ')}`
          : ', with no transfer authorities')
    )
  }

  const sync = syncSettingsFromEnvironment()
  if (sync.peers.length > 0) {
    console.log(
      `synchronising ${TOPIC} and ${ATTESTATION_TOPIC}${sync.legacy ? ` and ${UORA_TOPIC}` : ''} from ${sync.peers.join(', ')}` +
        (sync.intervalMs > 0 ? ` every ${sync.intervalMs} ms` : ' once, at startup')
    )
  }

  const lookupServices: Record<string, LookupService> = {
    [SERVICE]: new DppLookupService(records),
    [ATTESTATION_SERVICE]: new AttestationLookupService(attestations),
    [UORA_SERVICE]: new UoraAnchorLookupService(anchors),
  }
  const engine = new Engine(
    {
      // The engine's storage is handed to tm_dpp so a state whose BEEF omits
      // its admitted predecessor (a proven state announced alone, or one a
      // peer offers) is judged against the predecessor this index holds.
      [TOPIC]: new DppTopicManager(identityKey ?? '', { ownerConsent, publisherPolicy: publisherPolicy?.chain, admittedOutputs: engineStorage }),
      [ATTESTATION_TOPIC]: new AttestationTopicManager(acceptedAnchorServices, { publisherPolicy: publisherPolicy?.chain }),
      [UORA_TOPIC]: new UoraAnchorTopicManager(acceptedAnchorServices),
    },
    lookupServices,
    engineStorage,
    tracker,
    process.env.PUBLIC_URL,
    undefined, // shipTrackers: no peer discovery
    undefined, // slapTrackers
    undefined, // broadcaster: the app's wallet already broadcast
    undefined, // advertiser: SHIP/SLAP would need a funded wallet here
    // Static peers per topic when SYNC_PEERS names them, false otherwise: no
    // GASP with anyone the operator did not name.
    syncConfigurationFor(sync, { passport: TOPIC, attestation: ATTESTATION_TOPIC, legacy: UORA_TOPIC })
  )

  const components: NodeComponents = {
    records,
    engineStorage,
    lookupServices,
    publisherPolicy,
    serviceIdentityKey: identityKey,
    anchorServiceKeys: acceptedAnchorServices,
    ownerConsent,
    sync: { peers: sync.peers, intervalMs: sync.intervalMs },
  }
  return { engine, components, close }
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 8080)
  const network = (process.env.NETWORK ?? 'main') as 'main' | 'test'
  const submitToken = process.env.SUBMIT_TOKEN
  if (submitToken == null || submitToken === '') {
    console.warn(
      'SUBMIT_TOKEN is unset: POST /submit and POST /retract accept requests from anyone. ' +
        'Set it on any deployment a stranger can reach.'
    )
  }

  const proofToken = process.env.ARC_CALLBACK_TOKEN
  if (proofToken == null || proofToken === '') {
    console.warn(
      'ARC_CALLBACK_TOKEN is unset: POST /arc-ingest accepts proofs from anyone. Each is still ' +
        'verified against block headers before it is stored, so an open route costs header quota, ' +
        'not truth; set it on any deployment a stranger can reach.'
    )
  }

  const tracker = chainTracker(network)
  const knownOnChain = tracker === 'scripts only'
    ? undefined
    : whatsOnChainKnows(network, process.env.WOC_API_KEY)
  if (knownOnChain == null) {
    console.warn('CHAIN_TRACKER=scripts-only: POST /retract cannot ask the network about a transaction; its answers say so')
  }
  const signingKey = exportSigningKey()
  const { engine, components, close } = await engineFromEnvironment(network, tracker)
  const service = await startOverlayService(engine, {
    port,
    submitToken,
    proofToken,
    chainTracker: tracker,
    network,
    components,
    exportSigningKey: signingKey,
    knownOnChain,
  })

  console.log(`dpp overlay listening on http://localhost:${service.port}`)
  console.log(`topics ${TOPIC}, ${ATTESTATION_TOPIC}; services ${SERVICE}, ${ATTESTATION_SERVICE}; legacy ${UORA_TOPIC}, ${UORA_SERVICE}`)
  console.log(`network ${network}`)

  // The first round after the socket is listening, so a peer that is also a
  // peer of ours can answer us; later rounds on the interval. Nothing awaits
  // a round: a peer that is down is a log line, not a stalled node.
  const synchronisation = components.sync != null && components.sync.peers.length > 0
    ? startPeerSynchronisation(engine, { intervalMs: components.sync.intervalMs, peers: components.sync.peers })
    : undefined
  if (synchronisation != null) void synchronisation.runOnce()

  let stopping = false
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (stopping) return
      stopping = true
      console.log(`${signal} received, draining`)
      synchronisation?.stop()
      void service
        .close()
        .then(close)
        .finally(() => process.exit(0))
    })
  }
}

/** Booted only when node runs this file; imported, it is a library. */
function runningAsEntryPoint(): boolean {
  const entry = process.argv[1]
  if (entry == null) return false
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href
  } catch {
    return false
  }
}

if (runningAsEntryPoint()) await main()
