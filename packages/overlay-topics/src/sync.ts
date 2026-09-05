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
import type { Engine } from '@bsv/overlay'

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
    const normalised = candidate.replace(/\/+$/, '')
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

export interface SyncRound {
  round: number
  startedAt: string
  durationMs: number
  ok: boolean
  error?: string
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
 * Rounds on an interval, each logged, none overlapping, none able to fail the
 * node: `startGASPSync` already isolates one peer's failure from the next,
 * and whatever escapes it is caught here and named. Requests are never
 * blocked, because a round is ordinary asynchronous work on the same event
 * loop and nothing awaits it but the round itself.
 */
export function startPeerSynchronisation(
  engine: Pick<Engine, 'startGASPSync'>,
  options: { intervalMs: number; peers: string[]; log?: (line: string) => void; warn?: (line: string) => void }
): PeerSynchronisation {
  const log = options.log ?? ((line) => console.log(line))
  const warn = options.warn ?? ((line) => console.warn(line))
  const rounds: SyncRound[] = []
  let count = 0
  let inFlight: Promise<SyncRound> | undefined

  const run = async (): Promise<SyncRound> => {
    const round = ++count
    const started = Date.now()
    log(`peer synchronisation round ${round} started with ${options.peers.length} peer${options.peers.length === 1 ? '' : 's'}: ${options.peers.join(', ')}`)
    let result: SyncRound
    try {
      await engine.startGASPSync()
      result = { round, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, ok: true }
      log(`peer synchronisation round ${round} finished in ${result.durationMs} ms`)
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause)
      result = { round, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, ok: false, error }
      warn(`peer synchronisation round ${round} failed after ${result.durationMs} ms: ${error}`)
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
