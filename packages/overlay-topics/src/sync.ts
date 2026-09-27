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

/** Comma-separated base URLs. Anything that is not an http or https URL stops the boot; a peer is not a thing to guess. */
/** A peer URL without its trailing slashes, scanned rather than matched so a long run of slashes costs linear time. */
function stripTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end--
  return value.slice(0, end)
}

export function parseSyncPeers(value: string | undefined): string[] {
  const peers: string[] = []
  for (const raw of (value ?? '').split(',')) {
    const candidate = raw.trim()
    if (candidate === '') continue
    let url: URL
    try {
      url = new URL(candidate)
    } catch {
      throw new Error(`SYNC_PEERS entry "${candidate}" is not a URL`)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`SYNC_PEERS entry "${candidate}" must be an http or https URL`)
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
  if (peers.length === 0 && (rawInterval !== '' || legacy)) {
    console.warn('SYNC_INTERVAL_MS or SYNC_LEGACY is set but SYNC_PEERS is not: nothing synchronises')
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
}

export const DEFAULT_RECONCILIATION_ATTEMPTS = 5
export const RECONCILIATION_PAGE = 500

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
 * behind and named once, because a refusal by this node's own admission looks
 * the same from here as a failure, and a refused state is not to be asked for
 * for ever.
 */
export function startPeerSynchronisation(
  engine: Pick<Engine, 'startGASPSync'>,
  options: {
    intervalMs: number
    peers: string[]
    log?: (line: string) => void
    warn?: (line: string) => void
    reconcile?: ReconciliationSettings
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
  /** Rounds an offered outpoint has been missing, by peer, topic and outpoint. */
  const attempts = new Map<string, number>()

  const checkpoints = async (): Promise<Map<string, number>> => {
    const before = new Map<string, number>()
    if (reconcile == null) return before
    for (const peer of options.peers) {
      for (const topic of reconcile.topics) {
        before.set(`${peer}|${topic}`, await reconcile.storage.getLastInteraction(peer, topic))
      }
    }
    return before
  }

  const reconcileRound = async (round: number, before: Map<string, number>): Promise<ReconciliationOutcome[]> => {
    const outcomes: ReconciliationOutcome[] = []
    if (reconcile == null) return outcomes
    for (const peer of options.peers) {
      for (const topic of reconcile.topics) {
        const since = before.get(`${peer}|${topic}`) ?? 0
        let offered: Array<{ txid: string; outputIndex: number; score: number }>
        try {
          offered = await offeredSince(peer, topic, since, limit, fetchImpl)
        } catch (cause) {
          warn(`peer synchronisation round ${round}: could not read what ${peer} offered for ${topic}: ${cause instanceof Error ? cause.message : String(cause)}`)
          continue
        }
        const missing: Array<{ outpoint: string; score: number }> = []
        const abandoned: string[] = []
        for (const output of offered) {
          const outpoint = `${output.txid}.${output.outputIndex}`
          const key = `${peer}|${topic}|${outpoint}`
          const held = await reconcile.storage.findOutput(output.txid, output.outputIndex, topic)
          if (held != null) {
            attempts.delete(key)
            continue
          }
          const tried = (attempts.get(key) ?? 0) + 1
          if (tried >= maxAttempts) {
            attempts.delete(key)
            abandoned.push(outpoint)
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
          warn(`peer synchronisation round ${round}: left behind after ${maxAttempts} rounds, offered by ${peer} for ${topic} and never admitted: ${abandoned.join(', ')}`)
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
    log(`peer synchronisation round ${round} started with ${options.peers.length} peer${options.peers.length === 1 ? '' : 's'}: ${options.peers.join(', ')}`)
    let result: SyncRound
    let before = new Map<string, number>()
    try {
      before = await checkpoints()
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
    if (reconcile != null) {
      try {
        result.reconciliation = await reconcileRound(round, before)
      } catch (cause) {
        warn(`peer synchronisation round ${round}: reconciliation failed: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }
    rounds.push(result)
    if (rounds.length > 100) rounds.shift()
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
