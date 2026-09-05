import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LockingScript,
  MerklePath,
  PrivateKey,
  ProtoWallet,
  Transaction,
  UnlockingScript,
  Utils,
  type ChainTracker,
  type LookupAnswer,
  type LookupQuestion,
  type STEAK,
  type TaggedBEEF,
} from '@bsv/sdk'
import { Engine } from '@bsv/overlay'
import { buildLockingScript, completeState, ownerBlobHash, type DppStateData } from '@bsv/dpp-core'
import { DppTopicManager } from '../src/tmDpp.js'
import { DppLookupService } from '../src/lsDpp.js'
import { InMemoryDppStorage } from '../src/storage.js'
import { InMemoryOverlayStorage } from '../src/engineStorage.js'
import {
  startOverlayService,
  type OverlayEngine,
  type OverlayHttpOptions,
  type RunningService,
} from '../src/index.js'

/**
 * The HTTP surface, over a real socket.
 *
 * Two halves. The first drives a stand-in engine, so what is asserted is the
 * wire contract itself: the topics header, the off-chain-values framing, the
 * bearer on /submit and nowhere else, and which failure answers which status.
 * The second drives the real `@bsv/overlay` Engine end to end, so a genuine
 * DPP state goes in over HTTP and comes back out of a lookup byte for byte.
 *
 * The contract under test is `contracts/overlay.yaml`, the wire every
 * consuming client speaks, not a new one.
 */

// ---------------------------------------------------------------- stand-in

interface Recorded {
  submits: TaggedBEEF[]
  lookups: LookupQuestion[]
}

function stubEngine(
  overrides: Partial<OverlayEngine> = {}
): { engine: OverlayEngine; seen: Recorded } {
  const seen: Recorded = { submits: [], lookups: [] }
  const engine: OverlayEngine = {
    submit: async (taggedBEEF: TaggedBEEF): Promise<STEAK> => {
      seen.submits.push(taggedBEEF)
      return { tm_dpp: { outputsToAdmit: [0], coinsToRetain: [], coinsRemoved: [] } }
    },
    lookup: async (question: LookupQuestion): Promise<LookupAnswer> => {
      seen.lookups.push(question)
      return { type: 'output-list', outputs: [] }
    },
    listTopicManagers: async () => ({ tm_dpp: { name: 'tm_dpp', shortDescription: 'DPP' } }),
    listLookupServiceProviders: async () => ({
      ls_dpp: { name: 'ls_dpp', shortDescription: 'DPP lookup' },
    }),
    getDocumentationForTopicManager: async name => `Rules for ${name}`,
    getDocumentationForLookupServiceProvider: async name => `Queries for ${name}`,
    handleNewMerkleProof: async () => {},
    ...overrides,
  } as OverlayEngine
  return { engine, seen }
}

/** The one address these tests bind and reach; see `serve`. */
const HOST = '127.0.0.1'

let running: RunningService | undefined

afterEach(async () => {
  await running?.close()
  running = undefined
})

/**
 * Bind on an ephemeral port and hand back the base URL the app would use.
 *
 * **`host` is not decoration.** Without it the service binds the wildcard while
 * this URL names the loopback, and those are two different sockets: a wildcard
 * bind succeeds on a port another process already holds bound to `127.0.0.1`
 * alone, so the fetches below get answered by that process instead. It failed
 * about one run in a hundred that way before 2026-08-06, as a wrong status or
 * as `Unexpected end of JSON input`, depending on which line met it first.
 */
async function serve(
  engine: OverlayEngine,
  options: Omit<OverlayHttpOptions, 'host'> = {}
): Promise<string> {
  running = await startOverlayService(engine, { ...options, port: 0, host: HOST })
  return `http://${HOST}:${running.port}`
}

const OCTET = { 'Content-Type': 'application/octet-stream' }

/** `Response.json()` answers `unknown`; every assertion here wants a record. */
async function bodyOf(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>
}

// ------------------------------------------------------------------ fixture

const makerPriv = PrivateKey.fromHex('11'.repeat(32))
const serverPriv = PrivateKey.fromHex('22'.repeat(32))
const ownerPriv = PrivateKey.fromHex('33'.repeat(32))
const SERVER_ID = serverPriv.toPublicKey().toString()
const PASSPORT_ID = 'https://id.gs1.org/01/09506000134352/21/HTTP-1'
const UID = 'HTTP-UID-1'
const ANYONE = new LockingScript([{ op: 0x51 }])

/**
 * A genesis DPP transaction, spending a synthetic mined funding output. The
 * engine below runs 'scripts only', as engine.test.ts does and for the same
 * reason: this suite proves the transport, and SPV was proved against a real
 * mainnet record instead.
 *
 * `server` defaults to the key `realEngine` checks; pass another to build a
 * state the admission policy refuses.
 */
async function genesisBeef(server: PrivateKey = serverPriv): Promise<number[]> {
  const data: DppStateData = {
    passportId: PASSPORT_ID,
    op: 'ACTIVATE',
    timestamp: '2026-07-26T09:00:00Z',
    ownerIdentityKey: ownerPriv.toPublicKey().toString(),
    actorIdentityKey: makerPriv.toPublicKey().toString(),
    actorKeyId: 'maker',
    eventData: '',
    payloadPublic: JSON.stringify({ name: 'Hearth 10', dataCarrier: UID }),
    payloadOwnerHash: ownerBlobHash([1, 2, 3]),
    previousTxid: '',
  }
  const state = await completeState(data, new ProtoWallet(makerPriv), new ProtoWallet(server))

  const funding = new Transaction()
  funding.addOutput({ satoshis: 10_000, lockingScript: ANYONE })
  funding.merklePath = MerklePath.fromCoinbaseTxidAndHeight(funding.id('hex'), 800_000)

  const tx = new Transaction()
  tx.addInput({
    sourceTransaction: funding,
    sourceOutputIndex: 0,
    unlockingScript: new UnlockingScript([]),
  })
  tx.addOutput({ satoshis: 1, lockingScript: buildLockingScript(state, makerPriv.toPublicKey()) })
  tx.addOutput({ satoshis: 9_000, lockingScript: ANYONE })
  return tx.toBEEF()
}

function realEngine(): Engine {
  return new Engine(
    { tm_dpp: new DppTopicManager(SERVER_ID) },
    { ls_dpp: new DppLookupService(new InMemoryDppStorage()) },
    new InMemoryOverlayStorage(),
    'scripts only',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { tm_dpp: false }
  )
}

// -------------------------------------------------------------------- tests

describe('the wire contract', () => {
  it('answers /health with the topic, the service and the network', async () => {
    const base = await serve(stubEngine().engine, { network: 'test' })
    const response = await fetch(`${base}/health`)
    expect(response.status).toBe(200)
    expect(await bodyOf(response)).toMatchObject({
      status: 'ok',
      topic: 'tm_dpp',
      service: 'ls_dpp',
      network: 'test',
    })
  })

  it('lists the topic managers and the lookup services', async () => {
    const base = await serve(stubEngine().engine)
    expect(await (await fetch(`${base}/listTopicManagers`)).json()).toHaveProperty('tm_dpp')
    expect(await (await fetch(`${base}/listLookupServiceProviders`)).json()).toHaveProperty('ls_dpp')
  })

  it('takes an octet-stream body and the x-topics header, exactly as the app sends them', async () => {
    const { engine, seen } = stubEngine()
    const base = await serve(engine)

    const response = await fetch(`${base}/submit`, {
      method: 'POST',
      headers: { ...OCTET, 'x-topics': JSON.stringify(['tm_dpp']) },
      body: new Uint8Array([1, 2, 3, 4]),
    })

    expect(response.status).toBe(200)
    expect(await bodyOf(response)).toEqual({
      tm_dpp: { outputsToAdmit: [0], coinsToRetain: [], coinsRemoved: [] },
    })
    expect(seen.submits).toHaveLength(1)
    expect(seen.submits[0].topics).toEqual(['tm_dpp'])
    expect(seen.submits[0].beef).toEqual([1, 2, 3, 4])
    expect(seen.submits[0].offChainValues).toBeUndefined()
  })

  it('defaults to tm_dpp when no topics header is sent', async () => {
    const { engine, seen } = stubEngine()
    const base = await serve(engine)
    await fetch(`${base}/submit`, { method: 'POST', headers: OCTET, body: new Uint8Array([9]) })
    expect(seen.submits[0].topics).toEqual(['tm_dpp'])
  })

  it('splits off-chain values out of the body when the header claims them', async () => {
    const { engine, seen } = stubEngine()
    const base = await serve(engine)

    const writer = new Utils.Writer()
    writer.writeVarIntNum(3)
    writer.write([7, 8, 9])
    writer.write([100, 101])

    await fetch(`${base}/submit`, {
      method: 'POST',
      headers: { ...OCTET, 'x-includes-off-chain-values': 'true' },
      body: new Uint8Array(writer.toArray()),
    })

    expect(seen.submits[0].beef).toEqual([7, 8, 9])
    expect(seen.submits[0].offChainValues).toEqual([100, 101])
  })

  it('rejects an empty body and a malformed topics header', async () => {
    const base = await serve(stubEngine().engine)

    const empty = await fetch(`${base}/submit`, { method: 'POST', headers: OCTET })
    expect(empty.status).toBe(400)
    expect(await bodyOf(empty)).toMatchObject({ status: 'error', description: 'empty body' })

    const malformed = await fetch(`${base}/submit`, {
      method: 'POST',
      headers: { ...OCTET, 'x-topics': 'tm_dpp' },
      body: new Uint8Array([1]),
    })
    expect(malformed.status).toBe(400)
    expect((await bodyOf(malformed)).description).toContain('X-Topics')
  })

  it('turns an engine failure into a 400 with its message, which the app swallows', async () => {
    const { engine } = stubEngine({
      submit: async () => {
        throw new Error('Unable to verify SPV information.')
      },
    })
    const base = await serve(engine)
    const response = await fetch(`${base}/submit`, {
      method: 'POST',
      headers: OCTET,
      body: new Uint8Array([1, 2]),
    })
    expect(response.status).toBe(400)
    expect(await bodyOf(response)).toEqual({
      status: 'error',
      description: 'Unable to verify SPV information.',
    })
  })

  it('forwards a lookup question and returns the answer unchanged', async () => {
    let seenQuestion: LookupQuestion | undefined
    const { engine } = stubEngine({
      lookup: async (question: LookupQuestion): Promise<LookupAnswer> => {
        seenQuestion = question
        return { type: 'output-list', outputs: [{ beef: [1, 2, 3], outputIndex: 0 }] }
      },
    })
    const base = await serve(engine)

    const response = await fetch(`${base}/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'ls_dpp', query: { uid: UID } }),
    })

    expect(response.status).toBe(200)
    expect(await bodyOf(response)).toEqual({
      type: 'output-list',
      outputs: [{ beef: [1, 2, 3], outputIndex: 0 }],
    })
    expect(seenQuestion).toEqual({ service: 'ls_dpp', query: { uid: UID } })
  })

  it('rejects a lookup with no service and a body that is not JSON', async () => {
    const base = await serve(stubEngine().engine)

    const noService = await fetch(`${base}/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { uid: UID } }),
    })
    expect(noService.status).toBe(400)
    expect((await bodyOf(noService)).description).toBe('service is required')

    const notJson = await fetch(`${base}/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json at all',
    })
    expect(notJson.status).toBe(400)
    expect((await bodyOf(notJson)).description).toBe('body must be JSON')
  })

  it('refuses an operator-shaped query before the engine sees it, and still answers a string one', async () => {
    const { engine, seen } = stubEngine()
    const base = await serve(engine)
    const ask = async (body: unknown): Promise<Response> =>
      await fetch(`${base}/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

    // The first probe was once run over a real socket against a deployed
    // store, where it would have matched every document.
    const operatorShaped = [
      { service: 'ls_dpp', query: { uid: { $ne: '' } } },
      { service: 'ls_dpp', query: { passportId: ['a'] } },
      { service: 'ls_uora_dpp', query: { issuer: { $gt: '' } } },
    ]
    for (const body of operatorShaped) {
      const refused = await ask(body)
      expect(refused.status).toBe(400)
      expect((await bodyOf(refused)).description).toContain('must be a string')
    }

    const notObjects = [
      { service: 'ls_dpp', query: 'HTTP-UID-1' },
      { service: 'ls_dpp', query: ['HTTP-UID-1'] },
      { service: 'ls_dpp' },
    ]
    for (const body of notObjects) {
      const refused = await ask(body)
      expect(refused.status).toBe(400)
      expect((await bodyOf(refused)).description).toBe('query must be an object of string fields')
    }
    expect(seen.lookups).toHaveLength(0)

    const answered = await ask({ service: 'ls_dpp', query: { uid: UID } })
    expect(answered.status).toBe(200)
    expect(seen.lookups).toHaveLength(1)
  })

  it('lets a numeric limit through, since the anchor rail documents one', async () => {
    const { engine, seen } = stubEngine()
    const base = await serve(engine)
    const response = await fetch(`${base}/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'ls_uora_dpp', query: { issuer: 'did:key:z6Mk', limit: 5 } }),
    })
    expect(response.status).toBe(200)
    expect(seen.lookups[0].query).toEqual({ issuer: 'did:key:z6Mk', limit: 5 })

    const refused = await fetch(`${base}/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'ls_uora_dpp', query: { issuer: 'did:key:z6Mk', limit: {} } }),
    })
    expect(refused.status).toBe(400)
    expect((await bodyOf(refused)).description).toContain('limit')
  })

  it('answers 404 for anything else, and CORS preflight for the browser', async () => {
    const base = await serve(stubEngine().engine)

    const missing = await fetch(`${base}/nope`)
    expect(missing.status).toBe(404)
    expect((await bodyOf(missing)).description).toContain('GET /nope')

    const preflight = await fetch(`${base}/lookup`, { method: 'OPTIONS' })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization')
  })
})

describe('the bearer on /submit', () => {
  it('refuses a submission with no token, a wrong token or a wrong scheme', async () => {
    const { engine, seen } = stubEngine()
    const base = await serve(engine, { submitToken: 'sekret' })

    const attempts = [
      undefined,
      { Authorization: 'Bearer wrong' },
      { Authorization: 'Bearer sekret-plus' },
      { Authorization: 'Basic sekret' },
      { Authorization: 'sekret' },
    ]
    for (const authorization of attempts) {
      const response = await fetch(`${base}/submit`, {
        method: 'POST',
        headers: { ...OCTET, ...authorization },
        body: new Uint8Array([1, 2, 3]),
      })
      expect(response.status).toBe(401)
      expect((await bodyOf(response)).description).toContain('bearer token')
    }
    expect(seen.submits).toHaveLength(0)
  })

  it('accepts the right token, case-insensitively on the scheme', async () => {
    const { engine, seen } = stubEngine()
    const base = await serve(engine, { submitToken: 'sekret' })

    for (const header of ['Bearer sekret', 'bearer sekret']) {
      const response = await fetch(`${base}/submit`, {
        method: 'POST',
        headers: { ...OCTET, Authorization: header },
        body: new Uint8Array([1, 2, 3]),
      })
      expect(response.status).toBe(200)
    }
    expect(seen.submits).toHaveLength(2)
  })

  it('leaves /lookup and /health open, because a read costs no quota', async () => {
    const base = await serve(stubEngine().engine, { submitToken: 'sekret' })

    expect((await fetch(`${base}/health`)).status).toBe(200)
    const lookup = await fetch(`${base}/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'ls_dpp', query: { uid: UID } }),
    })
    expect(lookup.status).toBe(200)
  })

  it('leaves /submit open when no token is configured, as a local container', async () => {
    const { engine, seen } = stubEngine()
    const base = await serve(engine)
    const response = await fetch(`${base}/submit`, {
      method: 'POST',
      headers: OCTET,
      body: new Uint8Array([1, 2, 3]),
    })
    expect(response.status).toBe(200)
    expect(seen.submits).toHaveLength(1)
  })
})

describe('a real record, over HTTP', () => {
  it('admits a genesis on submit and answers the lookup with the same bytes', async () => {
    const base = await serve(realEngine())
    const beef = await genesisBeef()

    const submitted = await fetch(`${base}/submit`, {
      method: 'POST',
      headers: { ...OCTET, 'x-topics': JSON.stringify(['tm_dpp']) },
      body: new Uint8Array(beef),
    })
    expect(submitted.status).toBe(200)
    expect(await bodyOf(submitted)).toEqual({
      tm_dpp: { outputsToAdmit: [0], coinsToRetain: [], coinsRemoved: [] },
    })

    for (const query of [{ uid: UID }, { passportId: PASSPORT_ID }]) {
      const response = await fetch(`${base}/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: 'ls_dpp', query }),
      })
      expect(response.status).toBe(200)
      const answer = (await response.json()) as {
        type: string
        outputs: Array<{ beef: number[]; outputIndex: number }>
      }
      expect(answer.type).toBe('output-list')
      expect(answer.outputs).toHaveLength(1)
      expect(answer.outputs[0].outputIndex).toBe(0)
      // Byte for byte: what the app verifies is what it announced.
      expect(Utils.toBase64(answer.outputs[0].beef)).toBe(Utils.toBase64(beef))
    }
  })

  it('treats a second announcement as a no-op and an unknown uid as an empty list', async () => {
    const base = await serve(realEngine())
    const beef = await genesisBeef()
    const send = async (): Promise<Response> =>
      await fetch(`${base}/submit`, {
        method: 'POST',
        headers: OCTET,
        body: new Uint8Array(beef),
      })

    await send()
    const again = await send()
    expect(again.status).toBe(200)
    expect((await bodyOf(again)).tm_dpp.outputsToAdmit).toEqual([])

    const miss = await fetch(`${base}/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'ls_dpp', query: { uid: 'nothing-here' } }),
    })
    expect(miss.status).toBe(200)
    expect((await bodyOf(miss)).outputs).toEqual([])
  })

  it('warns when a non-duplicate submission admits nothing, and the header says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const base = await serve(realEngine())
      // Signed by a key the engine was not configured with: verifies as a
      // transaction, refused by admission, the first of the silent-refusal shapes.
      const beef = await genesisBeef(PrivateKey.fromHex('44'.repeat(32)))
      const response = await fetch(`${base}/submit`, {
        method: 'POST',
        headers: OCTET,
        body: new Uint8Array(beef),
      })

      expect(response.status).toBe(200)
      expect((await bodyOf(response)).tm_dpp.outputsToAdmit).toEqual([])
      expect(response.headers.get('x-admission')).toBe('tm_dpp=none')

      const warned = warn.mock.calls.filter((call) => String(call[0]).includes('admitted nothing'))
      expect(warned).toHaveLength(1)
      expect(String(warned[0][0])).toContain(Transaction.fromBEEF(beef).id('hex'))
      expect(String(warned[0][0])).toContain('tm_dpp')
    } finally {
      warn.mockRestore()
    }
  })

  it('stays quiet on a duplicate, which is the deliberate no-op', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const base = await serve(realEngine())
      const beef = await genesisBeef()
      const send = async (): Promise<Response> =>
        await fetch(`${base}/submit`, { method: 'POST', headers: OCTET, body: new Uint8Array(beef) })

      const first = await send()
      expect(first.headers.get('x-admission')).toBe('tm_dpp=admitted')

      const again = await send()
      expect(again.status).toBe(200)
      expect((await bodyOf(again)).tm_dpp.outputsToAdmit).toEqual([])
      expect(again.headers.get('x-admission')).toBe('tm_dpp=duplicate')

      const warned = warn.mock.calls.filter((call) => String(call[0]).includes('admitted nothing'))
      expect(warned).toHaveLength(0)
    } finally {
      warn.mockRestore()
    }
  })

  it('refuses an unregistered topic and a query with neither key', async () => {
    const base = await serve(realEngine())

    const wrongTopic = await fetch(`${base}/submit`, {
      method: 'POST',
      headers: { ...OCTET, 'x-topics': JSON.stringify(['tm_other']) },
      body: new Uint8Array(await genesisBeef()),
    })
    expect(wrongTopic.status).toBe(400)
    expect((await bodyOf(wrongTopic)).description).toContain('tm_other')

    const emptyQuery = await fetch(`${base}/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'ls_dpp', query: {} }),
    })
    expect(emptyQuery.status).toBe(400)
    expect((await bodyOf(emptyQuery)).description).toContain('passportId')
  })
})

// ------------------------------------------------------------------- proofs

/**
 * A synthetic proof for one transaction: the single-leaf path of a block whose
 * only transaction it is, the same shape the funding output above carries.
 * The engine here is 'scripts only', so only the route's own check ever sees
 * a header source, and a stub tracker passed to `serve` is that source.
 */
function proofFor(txid: string, height: number): MerklePath {
  return MerklePath.fromCoinbaseTxidAndHeight(txid, height)
}

const JSON_BODY = { 'Content-Type': 'application/json' }

async function submitGenesis(base: string): Promise<string> {
  const beef = await genesisBeef()
  const submitted = await fetch(`${base}/submit`, {
    method: 'POST',
    headers: { ...OCTET, 'x-topics': JSON.stringify(['tm_dpp']) },
    body: new Uint8Array(beef),
  })
  expect(submitted.status).toBe(200)
  return Transaction.fromBEEF(beef).id('hex')
}

async function pushProof(
  base: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return await fetch(`${base}/arc-ingest`, {
    method: 'POST',
    headers: { ...JSON_BODY, ...headers },
    body: JSON.stringify(body),
  })
}

/** The one served state, as the verifier would receive it. */
async function servedState(base: string): Promise<Transaction> {
  const response = await fetch(`${base}/lookup`, {
    method: 'POST',
    headers: JSON_BODY,
    body: JSON.stringify({ service: 'ls_dpp', query: { passportId: PASSPORT_ID } }),
  })
  const answer = await bodyOf(response)
  expect(answer.outputs).toHaveLength(1)
  return Transaction.fromBEEF(answer.outputs[0].beef as number[])
}

/**
 * A header source that answers as told. `currentHeight` sits far above the
 * proofs' height because the SDK's `MerklePath.verify` reads a leaf at index 0
 * as a coinbase and wants it 100 blocks deep before it asks the source at all,
 * and the synthetic single-leaf proofs above are exactly that shape.
 */
const tracker = (answer: () => Promise<boolean>): ChainTracker => ({
  isValidRootForHeight: answer,
  currentHeight: async () => 900_000,
})

describe('a proof, over HTTP', () => {
  it('attaches a pushed proof to a held state, and the lookup then serves it', async () => {
    const base = await serve(realEngine())
    const txid = await submitGenesis(base)
    expect((await servedState(base)).merklePath).toBeUndefined()

    const proof = proofFor(txid, 800_001)
    const pushed = await pushProof(base, { txid, merklePath: proof.toHex(), blockHeight: 800_001 })
    expect(pushed.status).toBe(200)
    expect(await bodyOf(pushed)).toEqual({ status: 'applied', txid, blockHeight: 800_001 })

    // spec/services.md section 2: a mined state is served with its merkle path.
    const served = await servedState(base)
    expect(served.id('hex')).toBe(txid)
    expect(served.merklePath?.blockHeight).toBe(800_001)
    expect(served.merklePath?.computeRoot(txid)).toBe(proof.computeRoot(txid))

    // The same proof again is applied again, not refused: a callback retried
    // by a broadcaster must not turn into an error.
    expect((await pushProof(base, { txid, merklePath: proof.toHex() })).status).toBe(200)
  })

  it('acknowledges and ignores a status-only callback, so a broadcaster does not retry it', async () => {
    const base = await serve(realEngine())
    const txid = await submitGenesis(base)
    for (const body of [{ txid, txStatus: 'SEEN_ON_NETWORK' }, { txid, merklePath: null }]) {
      const response = await pushProof(base, body)
      expect(response.status).toBe(200)
      expect(await bodyOf(response)).toEqual({ status: 'ignored', txid, reason: 'no merkle path' })
    }
    expect((await servedState(base)).merklePath).toBeUndefined()
  })

  it('refuses a body that is not a proof of this transaction, before any engine or header source is asked', async () => {
    const base = await serve(realEngine(), { chainTracker: tracker(async () => { throw new Error('never asked') }) })
    const txid = await submitGenesis(base)
    const other = 'ab'.repeat(32)
    const cases: Array<[unknown, string]> = [
      [{ txid, merklePath: 'not hex' }, 'merklePath is not a BUMP'],
      [{ txid, merklePath: 42 }, 'merklePath must be a BUMP in hex'],
      [{ txid, merklePath: proofFor(other, 800_001).toHex() }, 'merklePath does not contain txid'],
      [
        { txid, merklePath: proofFor(txid, 800_001).toHex(), blockHeight: 800_002 },
        'blockHeight does not match the merkle path',
      ],
      [{ txid: 'nope', merklePath: proofFor(txid, 800_001).toHex() }, 'txid must be 64 lower-case hex characters'],
      [[1, 2], 'body must be a JSON object with txid and merklePath'],
    ]
    for (const [body, description] of cases) {
      const response = await pushProof(base, body)
      expect(response.status).toBe(400)
      expect((await bodyOf(response)).description).toBe(description)
    }
    const notJson = await fetch(`${base}/arc-ingest`, { method: 'POST', headers: JSON_BODY, body: '{' })
    expect(notJson.status).toBe(400)
    expect((await bodyOf(notJson)).description).toBe('body must be JSON')
    expect((await servedState(base)).merklePath).toBeUndefined()
  })

  it('answers 404 for a transaction it does not hold', async () => {
    const base = await serve(realEngine())
    const stranger = 'ab'.repeat(32)
    const response = await pushProof(base, { txid: stranger, merklePath: proofFor(stranger, 800_001).toHex() })
    expect(response.status).toBe(404)
    expect((await bodyOf(response)).description).toBe('this index holds no output of that transaction')
  })

  it('refuses a proof its header source refutes, and stores nothing', async () => {
    const base = await serve(realEngine(), { chainTracker: tracker(async () => false) })
    const txid = await submitGenesis(base)
    const response = await pushProof(base, { txid, merklePath: proofFor(txid, 800_001).toHex() })
    expect(response.status).toBe(400)
    expect((await bodyOf(response)).description).toBe('merklePath does not validate against block headers')
    expect((await servedState(base)).merklePath).toBeUndefined()
  })

  it('defers, rather than applies or refuses, when the header source cannot be reached', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const base = await serve(realEngine(), {
        chainTracker: tracker(async () => {
          throw new Error('connection refused')
        }),
      })
      const txid = await submitGenesis(base)
      const response = await pushProof(base, { txid, merklePath: proofFor(txid, 800_001).toHex() })
      expect(response.status).toBe(503)
      expect((await bodyOf(response)).description).toBe(
        'header source unavailable; the proof was not applied, try again'
      )
      expect((await servedState(base)).merklePath).toBeUndefined()
    } finally {
      warn.mockRestore()
    }
  })

  it('applies a proof its header source agrees with', async () => {
    const base = await serve(realEngine(), { chainTracker: tracker(async () => true) })
    const txid = await submitGenesis(base)
    expect((await pushProof(base, { txid, merklePath: proofFor(txid, 800_001).toHex() })).status).toBe(200)
    expect((await servedState(base)).merklePath?.blockHeight).toBe(800_001)
  })

  it('requires the callback token when one is configured, as a bearer or as X-Callback-Token', async () => {
    const base = await serve(realEngine(), { proofToken: 'proof-secret' })
    const txid = await submitGenesis(base)
    const body = { txid, merklePath: proofFor(txid, 800_001).toHex() }
    for (const headers of [{}, { Authorization: 'Bearer wrong' }, { 'X-Callback-Token': 'wrong' }]) {
      const refused = await pushProof(base, body, headers)
      expect(refused.status).toBe(401)
      expect((await bodyOf(refused)).description).toBe('POST /arc-ingest requires the callback token')
    }
    expect((await pushProof(base, body, { 'X-Callback-Token': 'proof-secret' })).status).toBe(200)
    expect((await pushProof(base, body, { Authorization: 'Bearer proof-secret' })).status).toBe(200)
    // The submit token is a different secret and does not open this route.
    const other = await serve(realEngine(), { submitToken: 'submit-secret', proofToken: 'proof-secret' })
    expect((await pushProof(other, body, { Authorization: 'Bearer submit-secret' })).status).toBe(401)
  })
})


describe('published overlay documentation contract', () => {
  it('serves Markdown for advertised names and rejects absent, unknown or duplicate selectors', async () => {
    const { engine } = stubEngine()
    const base = await serve(engine)
    for (const [route, body] of [
      ['/getDocumentationForTopicManager?manager=tm_dpp', 'Rules for tm_dpp'],
      ['/getDocumentationForLookupServiceProvider?lookupService=ls_dpp', 'Queries for ls_dpp'],
    ]) {
      const response = await fetch(base + route)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/markdown')
      expect(await response.text()).toBe(body)
    }
    for (const suffix of ['', '?manager=unknown', '?manager=tm_dpp&manager=tm_dpp', '?manager=__proto__']) {
      expect((await fetch(base + '/getDocumentationForTopicManager' + suffix)).status).toBe(400)
    }
  })
})
