/**
 * Peer synchronisation (`spec/services.md` section 1, operator profile
 * `federated-operators@1`): pulling the states and anchors another operator
 * holds, through the overlay SDK's GASP, from a declared list of peers.
 *
 * The SDK does the protocol: `Engine.startGASPSync` walks every topic the
 * `syncConfiguration` names, asks each peer for the outputs it holds since
 * the last checkpoint, fetches each unknown output's graph, checks it against
 * Bitcoin's rules and this node's own topic managers, and admits it through
 * `Engine.submit` as a historical transaction. Admission during
 * synchronisation is therefore the same admission as `/submit`: a state a
 * peer offers is admitted only under the publisher policy and the chain
 * rules, and a peer offering anything else is refused by name in the log.
 *
 * This module adds what the SDK leaves to the host: reading the peers from
 * the environment, building the configuration for the two current topics
 * (the legacy topic only when asked), running rounds on an interval, keeping
 * a failing peer from stopping the node or blocking a request, and logging
 * what each round did. Discovery is static: the peers are the ones named,
 * never ones a lookup found, so the capability document says
 * `static-peers` and nothing here authorises a publisher.
 */
import type { Engine, Storage } from '@bsv/overlay'

/** The Engine's shape for `syncConfiguration`: peers per topic, 'SHIP' for discovered peers, or false. */
export type SyncConfiguration = Record<string, string[] | 'SHIP' | false>

export const DEFAULT_SYNC_INTERVAL_MS = 60_000

export interface SyncSettings {
  /** Peer base URLs, normalised: trimmed, no trailing slash, de-duplicated. */
  peers: string[]
  /** Milliseconds between rounds; 0 runs the round after startup and no other. */
  intervalMs: number
  /** Whether the historical UORA topic synchronises too. */
  legacy: boolean
}

/** A peer URL without its trailing slashes, scanned rather than matched so a long run of slashes costs linear time. */
export function stripTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end--
  return value.slice(0, end)
}

/**
 * Comma-separated base URLs, normalised and each once. Anything that is not
 * an http or https URL stops the boot; a peer is not a thing to guess.
 * `setting` names the variable in errors.
 */
export function parseSyncPeers(value: string | undefined, setting = 'SYNC_PEERS'): string[] {
  const peers: string[] = []
  for (const raw of (value ?? '').split(',')) {
    const candidate = raw.trim()
    if (candidate === '') continue
    let url: URL
    try {
      url = new URL(candidate)
    } catch {
      throw new Error(`${setting} entry "${candidate}" is not a URL`)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`${setting} entry "${candidate}" must be an http or https URL`)
    }
    const normalised = stripTrailingSlashes(candidate)
    if (!peers.includes(normalised)) peers.push(normalised)
  }
  return peers
}

export function syncSettingsFromEnvironment(): SyncSettings {
  const peers = parseSyncPeers(process.env.SYNC_PEERS)
  const rawInterval = (process.env.SYNC_INTERVAL_MS ?? '').trim()
  let intervalMs = DEFAULT_SYNC_INTERVAL_MS
  if (rawInterval !== '') {
    if (!/^\d+$/.test(rawInterval)) throw new Error('SYNC_INTERVAL_MS must be a non-negative integer of milliseconds')
    intervalMs = Number(rawInterval)
  }
  const legacy = (process.env.SYNC_LEGACY ?? '').trim() === '1'
  const discovering = (process.env.SYNC_DISCOVERY ?? '').trim() !== ''
  if (peers.length === 0 && !discovering && (rawInterval !== '' || legacy)) {
    console.warn('SYNC_INTERVAL_MS or SYNC_LEGACY is set but neither SYNC_PEERS nor SYNC_DISCOVERY is: nothing synchronises')
  }
  return { peers, intervalMs, legacy }
}

/**
 * The Engine's configuration for the named topics: the peers for the passport
 * and attestation topics, the legacy topic only when asked, false everywhere
 * without peers, which is exactly the configuration the node has always run.
 */
export function syncConfigurationFor(
  settings: Pick<SyncSettings, 'peers' | 'legacy'>,
  topics: { passport: string; attestation: string; legacy: string }
): SyncConfiguration {
  const peers = settings.peers.length === 0 ? false : [...settings.peers]
  return {
    [topics.passport]: peers,
    [topics.attestation]: peers,
    [topics.legacy]: settings.legacy ? peers : false,
  }
}

/** What the reconciliation after a round needs of the node: the checkpoint per peer and topic, and whether an output is held. */
export type ReconciliationStorage = Pick<Storage, 'findOutput' | 'getLastInteraction' | 'updateLastInteraction'>

export interface ReconciliationSettings {
  storage: ReconciliationStorage
  /** The topics synchronised from the peers, as the Engine's configuration names them. */
  topics: string[]
  /** How many rounds an offered output is asked for again before it is left behind. */
  maxAttempts?: number
  /** The page asked of the peer; the route serves at most 500. */
  limit?: number
  fetchImpl?: typeof fetch
  /** Rounds before an output left behind is asked for again; about an hour of rounds by default. */
  retryAfterRounds?: number
  /** The longest wait the retry doubles up to; about a day of rounds by default. */
  maxRetryAfterRounds?: number
}

export const DEFAULT_RECONCILIATION_ATTEMPTS = 5
export const RECONCILIATION_PAGE = 500
/** How long an output left behind waits before it is asked for again, and the longest the doubling wait grows to. */
export const LEFT_BEHIND_RETRY_MS = 60 * 60 * 1000
export const LEFT_BEHIND_MAX_RETRY_MS = 24 * 60 * 60 * 1000
/** Outputs left behind remembered per peer and topic; past this the earliest are forgotten. */
const MAX_LEFT_BEHIND = 10_000

/** Rounds that span a duration at the given interval, at least one; a node that runs one round only uses the fallback. */
export function roundsFor(durationMs: number, intervalMs: number, fallback: number): number {
  return intervalMs > 0 ? Math.max(1, Math.ceil(durationMs / intervalMs)) : fallback
}

/** What one peer and topic looked like after a round, once the offered outputs were checked against what this node holds. */
export interface ReconciliationOutcome {
  peer: string
  topic: string
  /** Outputs the peer offered since the checkpoint the round started from. */
  offered: number
  /** Of those, the ones this node does not hold after the round. */
  missing: number
  /** The checkpoint the round was held at so the missing outputs are offered again, when it was moved back. */
  heldAt?: number
  /** Outpoints left behind this round, having been offered and not arrived `maxAttempts` times. */
  abandoned: string[]
  /** The peer's page was full, so outputs beyond it were not checked this round. */
  partial: boolean
}

export interface SyncRound {
  round: number
  startedAt: string
  durationMs: number
  ok: boolean
  error?: string
  reconciliation?: ReconciliationOutcome[]
  /** The peers each topic pulled from, when a plan chose them for this round. */
  peers?: Record<string, string[]>
  /** Peers whose offered outputs could not be read this round, on any topic. */
  unreachable?: string[]
}

export interface PeerSynchronisation {
  /** Run one round now, or join the round in flight; never rejects. */
  runOnce: () => Promise<SyncRound>
  /** Stop the interval; a round in flight finishes. */
  stop: () => void
  /** The rounds run so far, newest last, at most the last hundred. */
  readonly rounds: SyncRound[]
}

/**
 * The offered outputs a peer listed since a checkpoint, over the same route
 * the SDK reads them from. The page is bounded as the route bounds it.
 */
async function offeredSince(
  peer: string,
  topic: string,
  since: number,
  limit: number,
  fetchImpl: typeof fetch
): Promise<Array<{ txid: string; outputIndex: number; score: number }>> {
  const response = await fetchImpl(`${peer}/requestSyncResponse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-BSV-Topic': topic },
    body: JSON.stringify({ version: 1, since, limit }),
  })
  if (!response.ok) throw new Error(`${peer} answered HTTP ${response.status} to the sync request for ${topic}`)
  const body = (await response.json()) as { UTXOList?: unknown }
  if (!Array.isArray(body.UTXOList)) throw new Error(`${peer} answered the sync request for ${topic} without a UTXOList`)
  return body.UTXOList.filter(
    (u): u is { txid: string; outputIndex: number; score: number } =>
      typeof u === 'object' && u !== null &&
      typeof (u as { txid?: unknown }).txid === 'string' &&
      typeof (u as { outputIndex?: unknown }).outputIndex === 'number' &&
      typeof (u as { score?: unknown }).score === 'number'
  )
}

/**
 * Rounds on an interval, each logged, none overlapping, none able to fail the
 * node: `startGASPSync` already isolates one peer's failure from the next,
 * and whatever escapes it is caught here and named. Requests are never
 * blocked, because a round is ordinary asynchronous work on the same event
 * loop and nothing awaits it but the round itself.
 *
 * With `reconcile`, every round is checked against what the peer offered.
 * The SDK moves the checkpoint to the newest output a peer listed before it
 * has fetched any of them, and a graph that fails on the way (a header source
 * answering 429, a peer answering 400 for one node) is caught, logged and
 * skipped; the next round then starts past it, and a lineage lost that way
 * never came back, not even after a restart. So after each round the outputs
 * the peer offered since the checkpoint the round started from are read
 * again and checked against this node's storage, and where any is missing the
 * checkpoint is held at the earliest of them, so the next round offers them
 * again. An output offered and missing `maxAttempts` rounds running is left
 * behind and named, because a refusal by this node's own admission looks the
 * same from here as a failure, and a refused state is not to be asked for for
 * ever. Nor is it given up for good: a peer that could not yet serve a graph
 * or its proof may serve it later, so after `retryAfterRounds` (about an
 * hour of rounds) the checkpoint is held at it once more, and each time it is
 * left behind again the wait doubles, up to `maxRetryAfterRounds` (about a
 * day of rounds).
 *
 * With `plan`, the peers come from the planner before each round, per topic,
 * and are written into the engine's configuration, so the SDK pulls from
 * exactly those and the reconciliation checks the same list; this is how
 * discovered peers join the named ones (discovery.ts). Without it every
 * topic uses `peers`, exactly as before.
 */
export function startPeerSynchronisation(
  engine: Pick<Engine, 'startGASPSync'> & { syncConfiguration?: SyncConfiguration },
  options: {
    intervalMs: number
    peers: string[]
    log?: (line: string) => void
    warn?: (line: string) => void
    reconcile?: ReconciliationSettings
    /** The peers each topic pulls from this round, asked before the round starts; written into the engine's configuration. */
    plan?: (round: number) => Promise<Record<string, string[]>>
    /** Called with every finished round, so a planner can back off a peer that could not be read. */
    afterRound?: (round: SyncRound) => void
  }
): PeerSynchronisation {
  const log = options.log ?? ((line) => console.log(line))
  const warn = options.warn ?? ((line) => console.warn(line))
  const rounds: SyncRound[] = []
  let count = 0
  let inFlight: Promise<SyncRound> | undefined
  const reconcile = options.reconcile
  const maxAttempts = reconcile?.maxAttempts ?? DEFAULT_RECONCILIATION_ATTEMPTS
  const limit = Math.min(reconcile?.limit ?? RECONCILIATION_PAGE, RECONCILIATION_PAGE)
  const fetchImpl = reconcile?.fetchImpl ?? fetch
  const firstWait = reconcile?.retryAfterRounds ?? roundsFor(LEFT_BEHIND_RETRY_MS, options.intervalMs, 60)
  const maxWait = Math.max(firstWait, reconcile?.maxRetryAfterRounds ?? roundsFor(LEFT_BEHIND_MAX_RETRY_MS, options.intervalMs, 1440))
  /** Rounds an offered outpoint has been missing, by peer, topic and outpoint. */
  const attempts = new Map<string, number>()
  /** Outputs left behind, by peer and topic: the score to hold the checkpoint at and the round they are asked for again. */
  const leftBehind = new Map<string, Map<string, { score: number; due: number }>>()
  /** The wait the next time an output is left behind, by peer, topic and outpoint; it doubles each time. */
  const waits = new Map<string, number>()
  /** The last plan that answered, kept when the planner fails so the engine and the reconciliation agree. */
  let lastPlan: Record<string, string[]> | undefined

  const peersFor = (plan: Record<string, string[]> | undefined, topic: string): string[] => plan?.[topic] ?? options.peers
  /** Every peer of the round once, in the order the topics first name them. */
  const roundPeers = (plan: Record<string, string[]> | undefined, topics: string[]): string[] => {
    const seen: string[] = []
    for (const topic of topics) for (const peer of peersFor(plan, topic)) if (!seen.includes(peer)) seen.push(peer)
    return seen
  }

  const checkpoints = async (plan: Record<string, string[]> | undefined): Promise<Map<string, number>> => {
    const before = new Map<string, number>()
    if (reconcile == null) return before
    for (const peer of roundPeers(plan, reconcile.topics)) {
      for (const topic of reconcile.topics) {
        if (!peersFor(plan, topic).includes(peer)) continue
        before.set(`${peer}|${topic}`, await reconcile.storage.getLastInteraction(peer, topic))
      }
    }
    return before
  }

  /** Before a round: hold the checkpoint at every output left behind whose wait is over, so this round offers it again. */
  const scheduleRetries = async (round: number, plan: Record<string, string[]> | undefined): Promise<void> => {
    if (reconcile == null) return
    for (const topic of reconcile.topics) {
      for (const peer of peersFor(plan, topic)) {
        const remembered = leftBehind.get(`${peer}|${topic}`)
        if (remembered == null) continue
        const due = [...remembered].filter(([, entry]) => entry.due <= round)
        if (due.length === 0) continue
        for (const [outpoint] of due) remembered.delete(outpoint)
        const floor = Math.min(...due.map(([, entry]) => entry.score))
        const current = await reconcile.storage.getLastInteraction(peer, topic)
        if (floor < current) await reconcile.storage.updateLastInteraction(peer, topic, floor)
        log(`peer synchronisation round ${round}: asking ${peer} again for ${due.length} output${due.length === 1 ? '' : 's'} left behind for ${topic}`)
      }
    }
  }

  const remember = (peer: string, topic: string, outpoint: string, entry: { score: number; due: number }): void => {
    const key = `${peer}|${topic}`
    let remembered = leftBehind.get(key)
    if (remembered == null) {
      remembered = new Map()
      leftBehind.set(key, remembered)
    }
    remembered.delete(outpoint)
    if (remembered.size >= MAX_LEFT_BEHIND) {
      const oldest = remembered.keys().next().value
      if (oldest != null) remembered.delete(oldest)
    }
    remembered.set(outpoint, entry)
  }

  const reconcileRound = async (
    round: number,
    before: Map<string, number>,
    plan: Record<string, string[]> | undefined,
    unreachable: Set<string>
  ): Promise<ReconciliationOutcome[]> => {
    const outcomes: ReconciliationOutcome[] = []
    if (reconcile == null) return outcomes
    for (const peer of roundPeers(plan, reconcile.topics)) {
      for (const topic of reconcile.topics) {
        if (!peersFor(plan, topic).includes(peer)) continue
        const since = before.get(`${peer}|${topic}`) ?? 0
        let offered: Array<{ txid: string; outputIndex: number; score: number }>
        try {
          offered = await offeredSince(peer, topic, since, limit, fetchImpl)
        } catch (cause) {
          unreachable.add(peer)
          warn(`peer synchronisation round ${round}: could not read what ${peer} offered for ${topic}: ${cause instanceof Error ? cause.message : String(cause)}`)
          continue
        }
        const missing: Array<{ outpoint: string; score: number }> = []
        const abandoned: string[] = []
        const abandonedWaits: number[] = []
        for (const output of offered) {
          const outpoint = `${output.txid}.${output.outputIndex}`
          const key = `${peer}|${topic}|${outpoint}`
          const held = await reconcile.storage.findOutput(output.txid, output.outputIndex, topic)
          if (held != null) {
            attempts.delete(key)
            waits.delete(key)
            leftBehind.get(`${peer}|${topic}`)?.delete(outpoint)
            continue
          }
          const tried = (attempts.get(key) ?? 0) + 1
          if (tried >= maxAttempts) {
            attempts.delete(key)
            const wait = waits.get(key) ?? firstWait
            waits.set(key, Math.min(wait * 2, maxWait))
            remember(peer, topic, outpoint, { score: output.score, due: round + wait })
            abandoned.push(outpoint)
            abandonedWaits.push(wait)
            continue
          }
          attempts.set(key, tried)
          missing.push({ outpoint, score: output.score })
        }
        const outcome: ReconciliationOutcome = { peer, topic, offered: offered.length, missing: missing.length, abandoned, partial: offered.length >= limit }
        if (missing.length > 0) {
          const floor = Math.min(...missing.map((m) => m.score))
          const current = await reconcile.storage.getLastInteraction(peer, topic)
          if (floor < current) {
            await reconcile.storage.updateLastInteraction(peer, topic, floor)
            outcome.heldAt = floor
          }
          warn(
            `peer synchronisation round ${round}: ${missing.length} of ${offered.length} output${offered.length === 1 ? '' : 's'} offered by ${peer} for ${topic} did not arrive` +
              (outcome.heldAt == null ? '' : `; checkpoint held at ${floor} so they are offered again`)
          )
        }
        if (abandoned.length > 0) {
          warn(
            `peer synchronisation round ${round}: left behind after ${maxAttempts} rounds, offered by ${peer} for ${topic} and never admitted: ${abandoned.join(', ')}; ` +
              `asked for again in ${Math.min(...abandonedWaits)} rounds`
          )
        }
        if (outcome.partial) log(`peer synchronisation round ${round}: ${peer} offered a full page of ${offered.length} for ${topic}; outputs beyond it are checked in a later round`)
        outcomes.push(outcome)
      }
    }
    return outcomes
  }

  const run = async (): Promise<SyncRound> => {
    const round = ++count
    const started = Date.now()
    let plan: Record<string, string[]> | undefined = lastPlan
    if (options.plan != null) {
      try {
        plan = await options.plan(round)
        lastPlan = plan
        if (engine.syncConfiguration != null) {
          for (const [topic, peers] of Object.entries(plan)) engine.syncConfiguration[topic] = peers.length === 0 ? false : [...peers]
        }
      } catch (cause) {
        warn(`peer synchronisation round ${round}: could not plan the peers, so the round keeps the last ones: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }
    const peers = plan == null ? options.peers : roundPeers(plan, Object.keys(plan))
    log(`peer synchronisation round ${round} started with ${peers.length} peer${peers.length === 1 ? '' : 's'}: ${peers.join(', ')}`)
    let result: SyncRound
    let before = new Map<string, number>()
    try {
      await scheduleRetries(round, plan)
    } catch (cause) {
      warn(`peer synchronisation round ${round}: could not hold the checkpoints for outputs left behind: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
    try {
      before = await checkpoints(plan)
    } catch (cause) {
      warn(`peer synchronisation round ${round}: could not read the checkpoints: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
    try {
      await engine.startGASPSync()
      result = { round, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, ok: true }
      log(`peer synchronisation round ${round} finished in ${result.durationMs} ms`)
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause)
      result = { round, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, ok: false, error }
      warn(`peer synchronisation round ${round} failed after ${result.durationMs} ms: ${error}`)
    }
    const unreachable = new Set<string>()
    if (reconcile != null) {
      try {
        result.reconciliation = await reconcileRound(round, before, plan, unreachable)
      } catch (cause) {
        warn(`peer synchronisation round ${round}: reconciliation failed: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }
    if (plan != null) result.peers = plan
    if (unreachable.size > 0) result.unreachable = [...unreachable]
    rounds.push(result)
    if (rounds.length > 100) rounds.shift()
    try {
      options.afterRound?.(result)
    } catch (cause) {
      warn(`peer synchronisation round ${round}: the planner's follow-up failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
    return result
  }

  const runOnce = (): Promise<SyncRound> => {
    if (inFlight == null) {
      inFlight = run().finally(() => {
        inFlight = undefined
      })
    }
    return inFlight
  }

  let timer: NodeJS.Timeout | undefined
  if (options.intervalMs > 0) {
    timer = setInterval(() => {
      void runOnce()
    }, options.intervalMs)
    timer.unref()
  }

  return {
    runOnce,
    stop: () => {
      if (timer != null) clearInterval(timer)
      timer = undefined
    },
    rounds,
  }
}
