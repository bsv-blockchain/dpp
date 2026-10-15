import { describe, expect, it } from 'vitest'
import type { ChainTracker } from '@bsv/sdk'
import { pacedChainTracker } from '../src/headerSource.js'

/** A clock and a sleep that move together, so pacing is asserted without waiting. */
function clock(): { now: () => number; sleep: (ms: number) => Promise<void>; slept: number[] } {
  let t = 1_000_000
  const slept: number[] = []
  return { now: () => t, sleep: async (ms) => { slept.push(ms); t += ms }, slept }
}

function inner(behaviour: { fail?: number; answer?: boolean } = {}): ChainTracker & { asked: Array<[string, number]> } {
  let failures = behaviour.fail ?? 0
  const asked: Array<[string, number]> = []
  return {
    asked,
    async isValidRootForHeight(root, height) {
      asked.push([root, height])
      if (failures > 0) { failures--; throw new Error('Failed to verify merkleroot for height 1 because of an error: {"status":429}') }
      return behaviour.answer ?? true
    },
    async currentHeight() { return 800_000 },
  }
}

describe('the paced header source', () => {
  it('asks the inner source once per question and remembers the answer', async () => {
    const c = clock()
    const source = inner()
    const paced = pacedChainTracker(source, { minIntervalMs: 350, now: c.now, sleep: c.sleep })
    expect(await paced.isValidRootForHeight('ab', 1)).toBe(true)
    expect(await paced.isValidRootForHeight('ab', 1)).toBe(true)
    expect(await paced.isValidRootForHeight('cd', 1)).toBe(true)
    expect(source.asked).toEqual([['ab', 1], ['cd', 1]])
    expect(paced.remembered).toBe(2)
  })

  it('spaces questions by the interval, however fast they are asked', async () => {
    const c = clock()
    const source = inner()
    const paced = pacedChainTracker(source, { minIntervalMs: 350, now: c.now, sleep: c.sleep })
    await Promise.all([paced.isValidRootForHeight('a', 1), paced.isValidRootForHeight('b', 2), paced.currentHeight()])
    expect(source.asked).toHaveLength(2)
    expect(c.slept).toEqual([350, 350])
  })

  it('retries a rate-limited answer after a growing pause, and gives up after the retries', async () => {
    const c = clock()
    const twice = inner({ fail: 2 })
    const paced = pacedChainTracker(twice, { minIntervalMs: 0, retries: 3, backoffMs: 100, now: c.now, sleep: c.sleep })
    expect(await paced.isValidRootForHeight('ab', 1)).toBe(true)
    expect(twice.asked).toHaveLength(3)
    expect(c.slept).toEqual([100, 200])

    const always = inner({ fail: 10 })
    const strict = pacedChainTracker(always, { minIntervalMs: 0, retries: 2, backoffMs: 100, now: c.now, sleep: c.sleep })
    await expect(strict.isValidRootForHeight('ab', 1)).rejects.toThrow(/429/)
    expect(always.asked).toHaveLength(3)
  })

  it('reports any other failure at once, and remembers a false answer as it does a true one', async () => {
    const c = clock()
    const broken: ChainTracker = { isValidRootForHeight: async () => { throw new Error('connection refused') }, currentHeight: async () => 1 }
    const paced = pacedChainTracker(broken, { minIntervalMs: 0, now: c.now, sleep: c.sleep })
    await expect(paced.isValidRootForHeight('ab', 1)).rejects.toThrow('connection refused')
    expect(c.slept).toEqual([])
    const no = inner({ answer: false })
    const remembered = pacedChainTracker(no, { minIntervalMs: 0, now: c.now, sleep: c.sleep })
    expect(await remembered.isValidRootForHeight('ab', 1)).toBe(false)
    expect(await remembered.isValidRootForHeight('ab', 1)).toBe(false)
    expect(no.asked).toHaveLength(1)
  })
})
