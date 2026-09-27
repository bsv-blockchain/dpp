/**
 * The header source, paced and remembered. The default source is
 * WhatsOnChain, which answers an anonymous caller 429 past a few requests a
 * second; a synchronisation round asks it once per state it admits, and an
 * initial round from a peer with a few hundred states asked faster than that
 * and lost lineages to the answers. So questions are asked one at a time, no
 * closer together than `minIntervalMs`, a question already answered is not
 * asked again (a block's merkle root does not change under a header source
 * that is not reorganising, and a reorganisation is the Engine's to notice),
 * and a rate-limit answer is retried after a pause before it is reported.
 * Nothing here changes what an answer means: the inner source decides, this
 * only decides when to ask.
 */
import type { ChainTracker } from '@bsv/sdk'

export interface PacingOptions {
  /** The least time between two questions to the inner source. */
  minIntervalMs: number
  /** Retries of a rate-limited question; default 3. */
  retries?: number
  /** The first pause before a retry, doubled each time; default 1000 ms. */
  backoffMs?: number
  /** Answers remembered; the oldest is forgotten past this; default 10000. */
  memory?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const RATE_LIMITED = /\b429\b|too many requests|rate limit/i

export interface PacedChainTracker extends ChainTracker {
  /** How many answers are remembered, for tests and the log. */
  readonly remembered: number
}

export function pacedChainTracker(inner: ChainTracker, options: PacingOptions): PacedChainTracker {
  const now = options.now ?? (() => Date.now())
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const retries = options.retries ?? 3
  const backoffMs = options.backoffMs ?? 1000
  const memory = options.memory ?? 10_000
  const answers = new Map<string, boolean>()
  let queue: Promise<unknown> = Promise.resolve()
  let last = Number.NEGATIVE_INFINITY

  const paced = <T>(ask: () => Promise<T>): Promise<T> => {
    const next = queue.then(async () => {
      for (let attempt = 0; ; attempt++) {
        const wait = last + options.minIntervalMs - now()
        if (wait > 0) await sleep(wait)
        last = now()
        try {
          return await ask()
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause)
          if (attempt >= retries || !RATE_LIMITED.test(message)) throw cause
          await sleep(backoffMs * 2 ** attempt)
        }
      }
    })
    queue = next.catch(() => undefined)
    return next
  }

  return {
    get remembered() {
      return answers.size
    },
    async isValidRootForHeight(root: string, height: number): Promise<boolean> {
      const key = `${height}:${root}`
      const known = answers.get(key)
      if (known != null) return known
      const answer = await paced(() => inner.isValidRootForHeight(root, height))
      if (answers.size >= memory) {
        const oldest = answers.keys().next().value
        if (oldest != null) answers.delete(oldest)
      }
      answers.set(key, answer)
      return answer
    },
    async currentHeight(): Promise<number> {
      return await paced(() => inner.currentHeight())
    },
  }
}
