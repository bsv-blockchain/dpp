/**
 * Finding peers from SHIP adverts (`spec/services.md` section 1): with
 * `SYNC_DISCOVERY=ship`, an index asks the SLAP trackers which hosts
 * advertise each topic it synchronises, and pulls from them beside the peers
 * `SYNC_PEERS` names, which stay a floor. Nothing here starts a round; the
 * planner answers `startPeerSynchronisation` (sync.ts) with the peers of each
 * topic before every round.
 *
 * What a discovered host can cost is bounded here, before the SDK sees it:
 *
 * - An advert counts only when its token verifies: signed by the identity
 *   key it names and locked to that key's discovery child (the SDK's
 *   `OverlayAdminTokenTemplate.decodeAndVerify`), for the topic asked about,
 *   at a plain https address. Even then a discovered address is a lead, never
 *   trust: nothing proves the address belongs to the key's holder.
 * - A host whose capability document admits no publisher key this index
 *   admits holds nothing this index could admit for the passport topic, so it
 *   is not asked for it; likewise for anchors when both restrict their
 *   anchoring services to lists with nothing in common. Asking would cost a
 *   header check for every graph and end in refusals.
 * - At most `SYNC_MAX_DISCOVERED` hosts a round, taken in turn when more
 *   advertise. A host that cannot be read sits out a round, then twice as
 *   many each time it fails again, up to a day of rounds.
 * - The trackers are asked when the node starts and then every ten minutes,
 *   not every round.
 *
 * What it does not do is admit anything. Discovery finds indexes, not
 * publishers: a record from a discovered index is admitted only under this
 * index's own publisher policy and anchoring settings, exactly as from a
 * named peer. Nor does it advertise this index; that needs a funded wallet.
 */
import {
  DEFAULT_SLAP_TRACKERS,
  DEFAULT_TESTNET_SLAP_TRACKERS,
  LookupResolver,
  OverlayAdminTokenTemplate,
  Transaction,
  type LookupAnswer,
} from '@bsv/sdk'
import { parseSyncPeers, roundsFor, stripTrailingSlashes, type SyncRound } from './sync.js'

export interface DiscoverySettings {
  /** SYNC_DISCOVERY=ship. */
  enabled: boolean
  /** SLAP_TRACKERS, or the SDK's default trackers for the network. */
  trackers: string[]
  /** SYNC_MAX_DISCOVERED: the most discovered hosts a round pulls from. */
  maxPeers: number
}

export const DEFAULT_MAX_DISCOVERED = 16
/** How often the trackers are asked again. */
export const DISCOVERY_REFRESH_MS = 10 * 60 * 1000
/** The longest a host that keeps failing sits out. */
export const DISCOVERY_MAX_BACKOFF_MS = 24 * 60 * 60 * 1000
/** Adverts read per topic per look; a tracker answering more is not read further. */
const MAX_ADVERTS_PER_TOPIC = 1000
/** A capability document larger than this is not read. */
const MAX_CAPABILITIES_BYTES = 1024 * 1024
const READ_TIMEOUT_MS = 10_000

export function discoverySettingsFromEnvironment(network: 'main' | 'test', env: NodeJS.ProcessEnv = process.env): DiscoverySettings {
  const mode = (env.SYNC_DISCOVERY ?? '').trim()
  if (mode !== '' && mode !== 'ship') throw new Error('SYNC_DISCOVERY must be ship, or unset for no discovery')
  const declaredTrackers = parseSyncPeers(env.SLAP_TRACKERS, 'SLAP_TRACKERS')
  const rawMax = (env.SYNC_MAX_DISCOVERED ?? '').trim()
  let maxPeers = DEFAULT_MAX_DISCOVERED
  if (rawMax !== '') {
    if (!/^\d+$/.test(rawMax) || Number(rawMax) < 1) throw new Error('SYNC_MAX_DISCOVERED must be a positive integer')
    maxPeers = Number(rawMax)
  }
  if (mode === '' && (declaredTrackers.length > 0 || rawMax !== '')) {
    console.warn('SLAP_TRACKERS or SYNC_MAX_DISCOVERED is set but SYNC_DISCOVERY is not: nothing is discovered')
  }
  const trackers = declaredTrackers.length > 0 ? declaredTrackers : [...(network === 'main' ? DEFAULT_SLAP_TRACKERS : DEFAULT_TESTNET_SLAP_TRACKERS)]
  return { enabled: mode === 'ship', trackers, maxPeers }
}

/** The SHIP adverts for one topic, as the SDK's resolver finds them through the trackers. */
export function shipAdvertLookup(trackers: string[], network: 'main' | 'test'): (topic: string) => Promise<LookupAnswer> {
  const resolver = new LookupResolver({ slapTrackers: trackers, networkPreset: network === 'main' ? 'mainnet' : 'testnet' })
  return async (topic) => await resolver.query({ service: 'ls_ship', query: { topics: [topic] } }, READ_TIMEOUT_MS)
}

/** The hosts an answer authentically advertises for one topic: verified tokens for that topic at plain https addresses, each once. */
export async function advertisedHosts(answer: LookupAnswer, topic: string): Promise<{ hosts: string[]; ignored: number }> {
  const hosts: string[] = []
  let ignored = 0
  if (answer.type !== 'output-list') return { hosts, ignored }
  for (const output of answer.outputs.slice(0, MAX_ADVERTS_PER_TOPIC)) {
    try {
      const script = Transaction.fromBEEF(output.beef).outputs[output.outputIndex]?.lockingScript
      if (script == null) throw new Error('the answer names no such output')
      const advert = await OverlayAdminTokenTemplate.decodeAndVerify(script, 'SHIP')
      // GASP runs over plain HTTPS; the other advertisable schemes name transports this index does not speak.
      if (advert.topicOrService !== topic || !advert.domain.startsWith('https://')) {
        ignored++
        continue
      }
      const host = stripTrailingSlashes(advert.domain)
      if (!hosts.includes(host)) hosts.push(host)
    } catch {
      ignored++
    }
  }
  return { hosts, ignored: ignored + Math.max(0, answer.outputs.length - MAX_ADVERTS_PER_TOPIC) }
}

/** What a capability document says an index admits, read the same way for this index and a peer. */
export interface AdmissionSettings {
  publisherKeys: string[]
  anchoringServices: string[]
  /** An empty anchoring list with the anchoring-service-restriction entry under unsupported: any well-formed anchor. */
  anchorsUnrestricted: boolean
}

export function admissionOf(document: unknown): AdmissionSettings | undefined {
  if (document == null || typeof document !== 'object') return undefined
  const policy = (document as { publisherPolicy?: unknown }).publisherPolicy
  if (policy == null || typeof policy !== 'object') return undefined
  const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])
  const publisherKeys = strings((policy as { publisherKeys?: unknown }).publisherKeys)
  const anchoringServices = strings((policy as { anchoringServices?: unknown }).anchoringServices)
  const unsupported = (document as { unsupported?: unknown }).unsupported
  const unrestrictedEntry = Array.isArray(unsupported) && unsupported.some((entry) => (entry as { id?: unknown } | null)?.id === 'anchoring-service-restriction')
  return { publisherKeys, anchoringServices, anchorsUnrestricted: anchoringServices.length === 0 && unrestrictedEntry }
}

/**
 * Whether a peer could hold anything this index would admit on a topic. Only
 * a certain mismatch excludes it: both name publisher keys and none is shared,
 * or both restrict anchoring services and none is shared. A document that
 * cannot be read the same way says nothing, and the peer is asked.
 */
export function sharesAdmission(own: AdmissionSettings, peer: AdmissionSettings | undefined, topic: string, topics: { passport: string; attestation: string }): boolean {
  if (peer == null) return true
  const meet = (a: string[], b: string[]): boolean => a.some((key) => b.includes(key))
  if (topic === topics.passport) {
    return own.publisherKeys.length === 0 || peer.publisherKeys.length === 0 || meet(own.publisherKeys, peer.publisherKeys)
  }
  if (topic === topics.attestation) {
    if (own.anchorsUnrestricted || peer.anchorsUnrestricted) return true
    return own.anchoringServices.length === 0 || peer.anchoringServices.length === 0 || meet(own.anchoringServices, peer.anchoringServices)
  }
  return true
}

/** A JSON document read with a size bound, so a host cannot make this index hold an unbounded body. */
async function readBoundedJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`answered HTTP ${response.status} for its capability document`)
  const reader = response.body?.getReader()
  if (reader == null) return await response.json()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_CAPABILITIES_BYTES) {
      await reader.cancel()
      throw new Error(`served a capability document over ${MAX_CAPABILITIES_BYTES} bytes`)
    }
    chunks.push(value)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** `max` of the candidates, taken in turn round by round when there are more, so every host is asked in time. */
export function takeInTurn<T>(candidates: T[], max: number, round: number): T[] {
  if (candidates.length <= max) return [...candidates]
  const start = ((round - 1) * max) % candidates.length
  return Array.from({ length: max }, (_, offset) => candidates[(start + offset) % candidates.length])
}

export interface PeerDiscoveryOptions {
  /** The topics this index synchronises. */
  topics: string[]
  /** SYNC_PEERS: asked every round, whatever discovery finds. */
  staticPeers: string[]
  /** This index's own address (PUBLIC_URL), never pulled from. */
  self?: string
  maxPeers: number
  /** SYNC_INTERVAL_MS, which turns the back-off bound into rounds. */
  intervalMs: number
  /** The SHIP adverts for a topic; `shipAdvertLookup` in a deployment. */
  findAdverts: (topic: string) => Promise<LookupAnswer>
  /** This index's own capability document, whose admission settings are compared with each peer's. */
  ownCapabilities: () => unknown
  passportTopic: string
  attestationTopic: string
  fetchImpl?: typeof fetch
  now?: () => number
  log?: (line: string) => void
  warn?: (line: string) => void
}

export interface PeerDiscovery {
  /** The peers of each topic for a round: the static ones, then the discovered hosts this round asks. */
  plan: (round: number) => Promise<Record<string, string[]>>
  /** After a round: a discovered host that could not be read sits out, one that answered is forgiven. */
  afterRound: (round: SyncRound) => void
  /** Every peer the last plan named, the static ones first. */
  peers: () => string[]
  /** The hosts that advertised each topic at the last look, this index and the static peers left out. */
  advertised: () => Record<string, string[]>
}

export function startPeerDiscovery(options: PeerDiscoveryOptions): PeerDiscovery {
  const now = options.now ?? Date.now
  const fetchImpl = options.fetchImpl ?? fetch
  const log = options.log ?? ((line) => console.log(line))
  const warn = options.warn ?? ((line) => console.warn(line))
  const self = options.self == null || options.self.trim() === '' ? undefined : stripTrailingSlashes(options.self.trim())
  const topics = { passport: options.passportTopic, attestation: options.attestationTopic }
  const maxBackoffRounds = roundsFor(DISCOVERY_MAX_BACKOFF_MS, options.intervalMs, 1440)

  let lastLook: number | undefined
  let advertised = new Map<string, string[]>()
  let current = [...options.staticPeers]
  /** Hosts sitting out: how many times running they failed and the first round they are asked again. */
  const backoff = new Map<string, { failures: number; until: number }>()
  /** Each host's admission settings, read at most every refresh, and the topics already reported as excluded. */
  const admissions = new Map<string, { at: number; value: AdmissionSettings | undefined }>()
  const excludedNoted = new Set<string>()

  const failed = (host: string, round: number, why: string): void => {
    const entry = backoff.get(host) ?? { failures: 0, until: 0 }
    entry.failures += 1
    const wait = Math.min(2 ** (entry.failures - 1), maxBackoffRounds)
    entry.until = round + wait + 1
    backoff.set(host, entry)
    warn(`peer discovery: ${host} ${why}; it sits out ${wait} round${wait === 1 ? '' : 's'}`)
  }

  const look = async (): Promise<void> => {
    const next = new Map<string, string[]>()
    for (const topic of options.topics) {
      try {
        const { hosts, ignored } = await advertisedHosts(await options.findAdverts(topic), topic)
        next.set(topic, hosts.filter((host) => host !== self && !options.staticPeers.includes(host)).sort())
        if (ignored > 0) warn(`peer discovery: ${ignored} advert${ignored === 1 ? '' : 's'} for ${topic} did not verify or named no https address, and ${ignored === 1 ? 'was' : 'were'} ignored`)
      } catch (cause) {
        next.set(topic, advertised.get(topic) ?? [])
        warn(`peer discovery: the trackers could not be asked about ${topic}, so the last answer stands: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }
    const describe = (map: Map<string, string[]>): string => options.topics.map((topic) => `${topic}: ${(map.get(topic) ?? []).join(', ') || 'none'}`).join('; ')
    if (lastLook == null || describe(next) !== describe(advertised)) log(`peer discovery: hosts advertising ${describe(next)}`)
    advertised = next
    lastLook = now()
  }

  const admissionOfHost = async (host: string, round: number): Promise<AdmissionSettings | undefined | 'unreadable'> => {
    const cached = admissions.get(host)
    if (cached != null && now() - cached.at < DISCOVERY_REFRESH_MS) return cached.value
    try {
      const value = admissionOf(await readBoundedJson(`${host}/capabilities`, fetchImpl))
      admissions.set(host, { at: now(), value })
      return value
    } catch (cause) {
      failed(host, round, `could not be read (${cause instanceof Error ? cause.message : String(cause)})`)
      return 'unreadable'
    }
  }

  const plan = async (round: number): Promise<Record<string, string[]>> => {
    if (lastLook == null || now() - lastLook >= DISCOVERY_REFRESH_MS) await look()
    const candidates = [...new Set(options.topics.flatMap((topic) => advertised.get(topic) ?? []))]
      .sort()
      .filter((host) => {
        const entry = backoff.get(host)
        return entry == null || round >= entry.until
      })
    const chosen = takeInTurn(candidates, options.maxPeers, round)
    const own = admissionOf(options.ownCapabilities())
    const byTopic: Record<string, string[]> = {}
    for (const topic of options.topics) byTopic[topic] = [...options.staticPeers]
    for (const host of chosen) {
      const theirs = await admissionOfHost(host, round)
      if (theirs === 'unreadable') continue
      for (const topic of options.topics) {
        if (!(advertised.get(topic) ?? []).includes(host)) continue
        const noteKey = `${host}|${topic}`
        if (own != null && !sharesAdmission(own, theirs, topic, topics)) {
          if (!excludedNoted.has(noteKey)) {
            excludedNoted.add(noteKey)
            log(`peer discovery: ${host} admits nothing this index admits for ${topic}, so it is not asked for ${topic}`)
          }
          continue
        }
        excludedNoted.delete(noteKey)
        byTopic[topic].push(host)
      }
    }
    current = [...new Set(options.topics.flatMap((topic) => byTopic[topic]))]
    return byTopic
  }

  const afterRound = (round: SyncRound): void => {
    const unreachable = new Set(round.unreachable ?? [])
    for (const host of current) {
      if (options.staticPeers.includes(host)) continue
      if (unreachable.has(host)) failed(host, round.round, 'could not be read this round')
      else backoff.delete(host)
    }
  }

  return {
    plan,
    afterRound,
    peers: () => [...current],
    advertised: () => Object.fromEntries(options.topics.map((topic) => [topic, [...(advertised.get(topic) ?? [])]])),
  }
}
