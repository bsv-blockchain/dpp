import { describe, expect, it } from 'vitest'
import { DEFAULT_SLAP_TRACKERS, DEFAULT_TESTNET_SLAP_TRACKERS, LockingScript, OverlayAdminTokenTemplate, PrivateKey, ProtoWallet, Transaction, Utils, type LookupAnswer } from '@bsv/sdk'
import {
  admissionOf,
  advertisedHosts,
  DEFAULT_MAX_DISCOVERED,
  DISCOVERY_REFRESH_MS,
  discoverySettingsFromEnvironment,
  sharesAdmission,
  startPeerDiscovery,
  takeInTurn,
} from '../src/discovery.js'
import type { SyncRound } from '../src/sync.js'

/**
 * Discovery (discovery.ts): adverts built here with the SDK's own token
 * template and a ProtoWallet, exactly as an index's advertiser would build
 * them, then answered by a stand-in tracker; capability documents served by
 * a stand-in fetch. Nothing reaches the network.
 */
const TOPICS = { passport: 'tm_dpp', attestation: 'tm_attestation' }
const OWN_KEY = PrivateKey.fromRandom().toPublicKey().toString()
const OTHER_KEY = PrivateKey.fromRandom().toPublicKey().toString()

async function advert(domain: string, topic: string, protocol: 'SHIP' | 'SLAP' = 'SHIP', key = PrivateKey.fromRandom()): Promise<{ beef: number[]; outputIndex: number }> {
  const script = await new OverlayAdminTokenTemplate(new ProtoWallet(key)).lock(protocol, domain, topic)
  return { beef: new Transaction(1, [], [{ lockingScript: script, satoshis: 1 }], 0).toBEEF(), outputIndex: 0 }
}

/** The same advert with its domain field replaced after signing, as a forger would. */
async function forged(domain: string, forgedDomain: string, topic: string): Promise<{ beef: number[]; outputIndex: number }> {
  const script = await new OverlayAdminTokenTemplate(new ProtoWallet(PrivateKey.fromRandom())).lock('SHIP', domain, topic)
  const original = Utils.toArray(domain, 'utf8')
  const chunks = script.chunks.map((chunk) =>
    chunk.data != null && chunk.data.length === original.length && chunk.data.every((byte, i) => byte === original[i])
      ? { ...chunk, data: Utils.toArray(forgedDomain, 'utf8') }
      : chunk
  )
  const tampered = new LockingScript(chunks)
  return { beef: new Transaction(1, [], [{ lockingScript: tampered, satoshis: 1 }], 0).toBEEF(), outputIndex: 0 }
}

const answer = (outputs: Array<{ beef: number[]; outputIndex: number }>): LookupAnswer => ({ type: 'output-list', outputs })

function capabilities(publisherKeys: string[], anchoringServices: string[] = [], anchorsUnrestricted = true): unknown {
  return {
    publisherPolicy: { publisherKeys, anchoringServices },
    unsupported: anchorsUnrestricted && anchoringServices.length === 0 ? [{ id: 'anchoring-service-restriction', reason: 'any' }] : [],
  }
}

/** A fetch answering `${host}/capabilities` from a table, and 503 for anything else. */
function serving(documents: Record<string, unknown>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const host = String(input).replace(/\/capabilities$/, '')
    if (!(host in documents)) return new Response('unavailable', { status: 503 })
    return new Response(JSON.stringify(documents[host]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
}

const roundOf = (round: number, unreachable: string[] = []): SyncRound => ({ round, startedAt: '', durationMs: 0, ok: true, unreachable })

describe('discovery settings', () => {
  it('is off unless SYNC_DISCOVERY=ship, and then uses the SDK\'s trackers for the network', () => {
    expect(discoverySettingsFromEnvironment('main', {})).toEqual({ enabled: false, trackers: DEFAULT_SLAP_TRACKERS, maxPeers: DEFAULT_MAX_DISCOVERED })
    expect(discoverySettingsFromEnvironment('main', { SYNC_DISCOVERY: 'ship' }).enabled).toBe(true)
    expect(discoverySettingsFromEnvironment('test', { SYNC_DISCOVERY: 'ship' }).trackers).toEqual(DEFAULT_TESTNET_SLAP_TRACKERS)
    expect(discoverySettingsFromEnvironment('main', { SYNC_DISCOVERY: 'ship', SLAP_TRACKERS: 'https://tracker.example/, https://tracker.example', SYNC_MAX_DISCOVERED: '4' }))
      .toEqual({ enabled: true, trackers: ['https://tracker.example'], maxPeers: 4 })
  })

  it('stops the boot on a value it cannot read rather than guessing', () => {
    expect(() => discoverySettingsFromEnvironment('main', { SYNC_DISCOVERY: 'yes' })).toThrow('SYNC_DISCOVERY must be ship')
    expect(() => discoverySettingsFromEnvironment('main', { SYNC_DISCOVERY: 'ship', SYNC_MAX_DISCOVERED: '0' })).toThrow('SYNC_MAX_DISCOVERED')
    expect(() => discoverySettingsFromEnvironment('main', { SYNC_DISCOVERY: 'ship', SLAP_TRACKERS: 'ftp://tracker.example' })).toThrow('SLAP_TRACKERS entry')
  })
})

describe('reading SHIP adverts', () => {
  it('takes a verified advert for the topic at a plain https address, once', async () => {
    const found = await advertisedHosts(answer([await advert('https://a.example', 'tm_dpp'), await advert('https://a.example', 'tm_dpp')]), 'tm_dpp')
    expect(found).toEqual({ hosts: ['https://a.example'], ignored: 0 })
  })

  it('ignores a forged advert, another topic, a SLAP advert, another transport and bytes that are not a transaction', async () => {
    const outputs = [
      await forged('https://a.example', 'https://evil.example', 'tm_dpp'),
      await advert('https://b.example', 'tm_other'),
      await advert('https://c.example', 'ls_dpp', 'SLAP'),
      await advert('https+bsvauth://d.example', 'tm_dpp'),
      { beef: [1, 2, 3], outputIndex: 0 },
    ]
    expect(await advertisedHosts(answer(outputs), 'tm_dpp')).toEqual({ hosts: [], ignored: 5 })
  })

  it('reads nothing from an answer that is not an output list', async () => {
    expect(await advertisedHosts({ type: 'freeform', result: {} } as LookupAnswer, 'tm_dpp')).toEqual({ hosts: [], ignored: 0 })
  })
})

describe('whether a peer could hold anything this index admits', () => {
  const own = admissionOf(capabilities([OWN_KEY]))!

  it('excludes a peer from the passport topic only when both name publisher keys and share none', () => {
    expect(sharesAdmission(own, admissionOf(capabilities([OTHER_KEY])), 'tm_dpp', TOPICS)).toBe(false)
    expect(sharesAdmission(own, admissionOf(capabilities([OTHER_KEY, OWN_KEY])), 'tm_dpp', TOPICS)).toBe(true)
    expect(sharesAdmission(own, admissionOf(capabilities([])), 'tm_dpp', TOPICS)).toBe(true)
    expect(sharesAdmission(own, undefined, 'tm_dpp', TOPICS)).toBe(true)
  })

  it('excludes a peer from anchors only when both restrict anchoring services to lists with nothing in common', () => {
    const restricted = admissionOf(capabilities([OWN_KEY], [OWN_KEY]))!
    expect(sharesAdmission(restricted, admissionOf(capabilities([OWN_KEY], [OTHER_KEY])), 'tm_attestation', TOPICS)).toBe(false)
    expect(sharesAdmission(restricted, admissionOf(capabilities([OWN_KEY])), 'tm_attestation', TOPICS)).toBe(true)
    expect(sharesAdmission(own, admissionOf(capabilities([OWN_KEY], [OTHER_KEY])), 'tm_attestation', TOPICS)).toBe(true)
    expect(sharesAdmission(restricted, admissionOf(capabilities([OTHER_KEY], [OTHER_KEY])), 'tm_uora_dpp', TOPICS)).toBe(true)
  })
})

describe('the peers of each round', () => {
  it('takes more candidates than the cap in turn, so every one is asked in time', () => {
    const candidates = ['a', 'b', 'c']
    expect([1, 2, 3].map((round) => takeInTurn(candidates, 2, round))).toEqual([['a', 'b'], ['c', 'a'], ['b', 'c']])
    expect(takeInTurn(candidates, 5, 7)).toEqual(candidates)
  })

  it('names the static peers first, then the hosts that advertise each topic and could hold what this index admits, never itself', async () => {
    const adverts: Record<string, Array<{ beef: number[]; outputIndex: number }>> = {
      tm_dpp: [await advert('https://a.example', 'tm_dpp'), await advert('https://b.example', 'tm_dpp'), await advert('https://self.example', 'tm_dpp')],
      tm_attestation: [await advert('https://a.example', 'tm_attestation'), await advert('https://b.example', 'tm_attestation')],
    }
    const logs: string[] = []
    const discovery = startPeerDiscovery({
      topics: ['tm_dpp', 'tm_attestation'],
      staticPeers: ['https://static.example'],
      self: 'https://self.example/',
      maxPeers: 8,
      intervalMs: 60_000,
      findAdverts: async (topic) => answer(adverts[topic] ?? []),
      ownCapabilities: () => capabilities([OWN_KEY]),
      passportTopic: 'tm_dpp',
      attestationTopic: 'tm_attestation',
      fetchImpl: serving({ 'https://a.example': capabilities([OWN_KEY]), 'https://b.example': capabilities([OTHER_KEY]) }),
      log: (line) => logs.push(line),
      warn: () => {},
    })
    expect(await discovery.plan(1)).toEqual({
      tm_dpp: ['https://static.example', 'https://a.example'],
      tm_attestation: ['https://static.example', 'https://a.example', 'https://b.example'],
    })
    expect(discovery.peers()).toEqual(['https://static.example', 'https://a.example', 'https://b.example'])
    expect(discovery.advertised()).toEqual({ tm_dpp: ['https://a.example', 'https://b.example'], tm_attestation: ['https://a.example', 'https://b.example'] })
    await discovery.plan(2)
    expect(logs.filter((line) => line.includes('https://b.example admits nothing this index admits for tm_dpp'))).toHaveLength(1)
  })

  it('lets a host that could not be read sit out, longer each time it fails again, and forgives one that answers', async () => {
    const adverts = [await advert('https://a.example', 'tm_dpp')]
    const warnings: string[] = []
    const discovery = startPeerDiscovery({
      topics: ['tm_dpp'],
      staticPeers: [],
      maxPeers: 8,
      intervalMs: 60_000,
      findAdverts: async () => answer(adverts),
      ownCapabilities: () => capabilities([OWN_KEY]),
      passportTopic: 'tm_dpp',
      attestationTopic: 'tm_attestation',
      fetchImpl: serving({ 'https://a.example': capabilities([OWN_KEY]) }),
      log: () => {},
      warn: (line) => warnings.push(line),
    })
    const asked = async (round: number): Promise<boolean> => (await discovery.plan(round)).tm_dpp.some((peer) => peer === 'https://a.example')
    expect(await asked(1)).toBe(true)
    discovery.afterRound(roundOf(1, ['https://a.example']))
    expect(await asked(2)).toBe(false)
    expect(await asked(3)).toBe(true)
    discovery.afterRound(roundOf(3, ['https://a.example']))
    expect([await asked(4), await asked(5), await asked(6)]).toEqual([false, false, true])
    discovery.afterRound(roundOf(6))
    discovery.afterRound(roundOf(7, ['https://a.example']))
    expect([await asked(8), await asked(9)]).toEqual([false, true])
    expect(warnings.filter((w) => w.includes('sits out'))).toEqual([
      'peer discovery: https://a.example could not be read this round; it sits out 1 round',
      'peer discovery: https://a.example could not be read this round; it sits out 2 rounds',
      'peer discovery: https://a.example could not be read this round; it sits out 1 round',
    ])
  })

  it('does not ask a host whose capability document cannot be read, and backs it off', async () => {
    const discovery = startPeerDiscovery({
      topics: ['tm_dpp'],
      staticPeers: [],
      maxPeers: 8,
      intervalMs: 60_000,
      findAdverts: async () => answer([await advert('https://down.example', 'tm_dpp')]),
      ownCapabilities: () => capabilities([OWN_KEY]),
      passportTopic: 'tm_dpp',
      attestationTopic: 'tm_attestation',
      fetchImpl: serving({}),
      log: () => {},
      warn: () => {},
    })
    expect((await discovery.plan(1)).tm_dpp).toEqual([])
    expect((await discovery.plan(2)).tm_dpp).toEqual([])
  })

  it('asks the trackers at the first round and then only every ten minutes', async () => {
    let clock = 0
    let looks = 0
    const discovery = startPeerDiscovery({
      topics: ['tm_dpp'],
      staticPeers: [],
      maxPeers: 1,
      intervalMs: 60_000,
      findAdverts: async () => {
        looks++
        return answer([await advert('https://a.example', 'tm_dpp'), await advert('https://b.example', 'tm_dpp')])
      },
      ownCapabilities: () => capabilities([OWN_KEY]),
      passportTopic: 'tm_dpp',
      attestationTopic: 'tm_attestation',
      fetchImpl: serving({ 'https://a.example': capabilities([OWN_KEY]), 'https://b.example': capabilities([OWN_KEY]) }),
      now: () => clock,
      log: () => {},
      warn: () => {},
    })
    // One host a round: the two take turns.
    expect((await discovery.plan(1)).tm_dpp).toEqual(['https://a.example'])
    clock += 60_000
    expect((await discovery.plan(2)).tm_dpp).toEqual(['https://b.example'])
    expect(looks).toBe(1)
    clock += DISCOVERY_REFRESH_MS
    await discovery.plan(3)
    expect(looks).toBe(2)
  })
})
