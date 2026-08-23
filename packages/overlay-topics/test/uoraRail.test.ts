import { afterEach, describe, expect, it } from 'vitest'
import {
  LockingScript,
  MerklePath,
  PrivateKey,
  ProtoWallet,
  Transaction,
  UnlockingScript,
  Utils,
} from '@bsv/sdk'
import { Engine } from '@bsv/overlay'
import { UoraAnchorTopicManager } from '../src/tmUoraDpp.js'
import { UoraAnchorLookupService, UORA_SERVICE, UORA_TOPIC } from '../src/lsUoraDpp.js'
import { InMemoryUoraAnchorStorage } from '../src/anchorStorage.js'
import { InMemoryOverlayStorage } from '../src/engineStorage.js'
import { DppTopicManager } from '../src/tmDpp.js'
import { DppLookupService } from '../src/lsDpp.js'
import { InMemoryDppStorage } from '../src/storage.js'
import { didKeyFromIdentityKey, uoraAnchorFields } from '../src/uoraAnchor.js'
import { startOverlayService, type RunningService } from '../src/index.js'

/** Bound and reached, and they must be the same one: see `serve` in http.test.ts. */
const HOST = '127.0.0.1'
import { writeUoraAnchor } from './writeAnchor.js'
import { ANCHOR_V3_FIXTURE as F } from './anchor-v3-fixture.js'

/**
 * The UORA rail, end to end, over a socket.
 *
 * An anchor transaction is built the way the resolver builds one, submitted
 * through the real `@bsv/overlay` Engine over real HTTP, and then found again
 * by asking a question that names only the issuing party's DID. That question
 * is the point of the whole format: it is unanswerable over the v1 anchors,
 * because a v1 anchor names nobody.
 *
 * The last test in this file is the one to read if you read one. Both rails run
 * on the same node against the same engine, and a passport lookup and an anchor
 * lookup return their own outputs and not each other's.
 *
 * SPV is deliberately not what this proves. The chain tracker is 'scripts only'
 * and the funding carries a synthetic merkle path, the same arrangement
 * `engine.test.ts` uses and for the same reason.
 */

const anchorServicePriv = PrivateKey.fromHex('77'.repeat(32))
const ANCHOR_SERVICE = anchorServicePriv.toPublicKey().toString()
const anchorProtoWallet = new ProtoWallet(anchorServicePriv)

const MAKER = didKeyFromIdentityKey(PrivateKey.fromHex('88'.repeat(32)).toPublicKey().toString())
const RECYCLER = didKeyFromIdentityKey(PrivateKey.fromHex('89'.repeat(32)).toPublicKey().toString())

const CELL = 'https://id.gs1.org/01/09506000134352/21/RAIL-CELL-1'
const ANYONE_SCRIPT = new LockingScript([{ op: 0x51 }])

/** A mined funding source. 'scripts only' never checks the path itself. */
function fundingTx(): Transaction {
  const tx = new Transaction()
  tx.addOutput({ satoshis: 10_000, lockingScript: ANYONE_SCRIPT })
  tx.merklePath = MerklePath.fromCoinbaseTxidAndHeight(tx.id('hex'), 800_000)
  return tx
}

interface Claim {
  attestationId: string
  issuer: string
  subject: string
  uoraType: string
  digest: string
  anchoredBy: string
}

function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    attestationId: `${CELL}/state-1`,
    issuer: MAKER,
    subject: CELL,
    uoraType: 'Origin',
    digest: 'a'.repeat(64),
    anchoredBy: ANCHOR_SERVICE,
    ...overrides,
  }
}

/**
 * One anchoring transaction, built the way the anchoring service's `anchor()` builds it:
 * a 1-satoshi PushDrop output under counterparty `anyone` with `forSelf`,
 * carrying the signature over the length-prefixed preimage as its eighth
 * field, plus change. Batched when more than one claim is given, which the
 * topic allows on purpose.
 */
async function anchorTx(...claims: Claim[]): Promise<Transaction> {
  const scripts = await Promise.all(
    claims.map(
      async (one) =>
        await writeUoraAnchor(anchorProtoWallet, uoraAnchorFields(one), one.attestationId)
    )
  )
  return txCarrying(...scripts)
}

/** The same transaction shape, over outputs somebody else prepared. */
function txCarrying(...scripts: LockingScript[]): Transaction {
  const tx = new Transaction()
  tx.addInput({
    sourceTransaction: fundingTx(),
    sourceOutputIndex: 0,
    unlockingScript: new UnlockingScript([]),
  })
  for (const lockingScript of scripts) tx.addOutput({ satoshis: 1, lockingScript })
  tx.addOutput({ satoshis: 9_000, lockingScript: ANYONE_SCRIPT })
  return tx
}

function newEngine(accepted: string[] = [ANCHOR_SERVICE]): Engine {
  return new Engine(
    {
      tm_dpp: new DppTopicManager(PrivateKey.fromHex('22'.repeat(32)).toPublicKey().toString()),
      [UORA_TOPIC]: new UoraAnchorTopicManager(accepted),
    },
    {
      ls_dpp: new DppLookupService(new InMemoryDppStorage()),
      [UORA_SERVICE]: new UoraAnchorLookupService(new InMemoryUoraAnchorStorage()),
    },
    new InMemoryOverlayStorage(),
    'scripts only',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { tm_dpp: false, [UORA_TOPIC]: false }
  )
}

describe('through the real Engine', () => {
  it('admits an anchor and finds it again by the issuer DID alone', async () => {
    const engine = newEngine()
    const tx = await anchorTx(claim())
    const beef = tx.toBEEF()

    const steak = await engine.submit({ beef, topics: [UORA_TOPIC] })
    expect(steak[UORA_TOPIC].outputsToAdmit).toEqual([0])

    // The whole question, asked with nothing but a party's DID.
    const answer = await engine.lookup({ service: UORA_SERVICE, query: { issuer: MAKER } })
    expect(answer.type).toBe('output-list')
    const outputs = (answer as { outputs: Array<{ beef: number[]; outputIndex: number }> }).outputs
    expect(outputs).toHaveLength(1)
    expect(outputs[0].outputIndex).toBe(0)
    // Byte for byte what was submitted, so the caller checks the chain rather
    // than believing this index.
    expect(Utils.toBase64(outputs[0].beef)).toBe(Utils.toBase64(beef))
  })

  it('separates two parties who anchored about the same product', async () => {
    const engine = newEngine()
    await engine.submit({ beef: (await anchorTx(claim())).toBEEF(), topics: [UORA_TOPIC] })
    await engine.submit({
      beef: (
        await anchorTx(
          claim({
            attestationId: `${CELL}/state-2`,
            issuer: RECYCLER,
            uoraType: 'Disposition',
            digest: 'b'.repeat(64),
          })
        )
      ).toBEEF(),
      topics: [UORA_TOPIC],
    })

    const bySubject = await engine.lookup({ service: UORA_SERVICE, query: { subject: CELL } })
    expect((bySubject as { outputs: unknown[] }).outputs).toHaveLength(2)

    const byMaker = await engine.lookup({ service: UORA_SERVICE, query: { issuer: MAKER } })
    expect((byMaker as { outputs: unknown[] }).outputs).toHaveLength(1)
  })

  it('admits a batch of anchors in one transaction and indexes each', async () => {
    const engine = newEngine()
    const tx = await anchorTx(
      claim({ attestationId: `${CELL}/a`, digest: '1'.repeat(64) }),
      claim({ attestationId: `${CELL}/b`, digest: '2'.repeat(64) }),
      claim({ attestationId: `${CELL}/c`, digest: '3'.repeat(64) })
    )
    const steak = await engine.submit({ beef: tx.toBEEF(), topics: [UORA_TOPIC] })
    expect(steak[UORA_TOPIC].outputsToAdmit).toEqual([0, 1, 2])

    const answer = await engine.lookup({ service: UORA_SERVICE, query: { issuer: MAKER } })
    expect((answer as { outputs: Array<{ outputIndex: number }> }).outputs.map((o) => o.outputIndex))
      .toEqual([0, 1, 2])
  })

  it('admits the resolver\'s pinned anchor and none of its re-cut variants', async () => {
    /*
     * The rail's version of the v2 finding, and the closest this suite gets to
     * what a stranger could actually do. Each forgery is the pinned mainnet-
     * shaped output with the boundary between the subject and the type moved
     * and the signature bytes copied across, so nothing about the transaction
     * looks wrong: the treasury is the one this instance carries, the digest is
     * untouched, the signature is one the treasury really produced. Only the
     * cut is different, and under v2 that was enough to file a real digest
     * under a subject nobody had signed.
     */
    const engine = newEngine()
    const tx = txCarrying(
      LockingScript.fromHex(F.boundaryShifted[0]),
      LockingScript.fromHex(F.lockingScript),
      LockingScript.fromHex(F.boundaryShifted[1])
    )
    const steak = await engine.submit({ beef: tx.toBEEF(), topics: [UORA_TOPIC] })
    expect(steak[UORA_TOPIC].outputsToAdmit).toEqual([1])

    // And the index carries the subject that was signed, once.
    const answer = await engine.lookup({ service: UORA_SERVICE, query: { subject: F.subject } })
    expect((answer as { outputs: Array<{ outputIndex: number }> }).outputs).toHaveLength(1)
    expect((answer as { outputs: Array<{ outputIndex: number }> }).outputs[0].outputIndex).toBe(1)
  })

  it('admits nothing from an anchoring service the instance does not carry', async () => {
    const stranger = PrivateKey.fromHex('66'.repeat(32)).toPublicKey().toString()
    const engine = newEngine([stranger])
    const steak = await engine.submit({
      beef: (await anchorTx(claim())).toBEEF(),
      topics: [UORA_TOPIC],
    })
    expect(steak[UORA_TOPIC].outputsToAdmit).toEqual([])
    const answer = await engine.lookup({ service: UORA_SERVICE, query: { issuer: MAKER } })
    expect((answer as { outputs: unknown[] }).outputs).toHaveLength(0)
  })
})

describe('over HTTP, the way the resolver announces', () => {
  let running: RunningService | undefined

  afterEach(async () => {
    await running?.close()
    running = undefined
  })

  it('takes a BRC-22 submission and answers a BRC-24 lookup', async () => {
    running = await startOverlayService(newEngine(), { port: 0, host: HOST, submitToken: 'shh' })
    const base = `http://${HOST}:${running.port}`
    const tx = await anchorTx(claim())

    // Exactly what the anchoring service's announcer sends.
    const submitted = await fetch(`${base}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Topics': JSON.stringify([UORA_TOPIC]),
        Authorization: 'Bearer shh',
      },
      body: new Uint8Array(tx.toBEEF()),
    })
    expect(submitted.status).toBe(200)
    expect(((await submitted.json()) as Record<string, { outputsToAdmit: number[] }>)[UORA_TOPIC]
      .outputsToAdmit).toEqual([0])

    const looked = await fetch(`${base}/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: UORA_SERVICE, query: { issuer: MAKER } }),
    })
    expect(looked.status).toBe(200)
    const answer = (await looked.json()) as { type: string; outputs: unknown[] }
    expect(answer.type).toBe('output-list')
    expect(answer.outputs).toHaveLength(1)
  })

  it('refuses an announcement with no credential, as it does on the other rail', async () => {
    running = await startOverlayService(newEngine(), { port: 0, host: HOST, submitToken: 'shh' })
    const response = await fetch(`http://127.0.0.1:${running.port}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Topics': JSON.stringify([UORA_TOPIC]),
      },
      body: new Uint8Array((await anchorTx(claim())).toBEEF()),
    })
    expect(response.status).toBe(401)
  })

  it('names both rails on /health, and keeps the singular fields a probe reads', async () => {
    running = await startOverlayService(newEngine(), { port: 0, host: HOST })
    const health = (await (await fetch(`http://127.0.0.1:${running.port}/health`)).json()) as {
      topic: string
      service: string
      topics: string[]
      services: string[]
    }
    expect(health.topic).toBe('tm_dpp')
    expect(health.service).toBe('ls_dpp')
    expect(health.topics).toEqual(['tm_dpp', UORA_TOPIC])
    expect(health.services).toEqual(['ls_dpp', UORA_SERVICE])
  })

  it('answers a question addressed to a service that does not exist', async () => {
    running = await startOverlayService(newEngine(), { port: 0, host: HOST })
    const response = await fetch(`http://127.0.0.1:${running.port}/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'ls_not_a_service', query: { issuer: MAKER } }),
    })
    expect(response.status).toBe(400)
  })
})

describe('two rails on one node', () => {
  it('keeps a passport lookup and an anchor lookup apart', async () => {
    // The arrangement a deployment actually runs. An anchor transaction is
    // submitted to both topics at once, as a careless client might: the anchor
    // topic takes it, the passport topic finds nothing it recognises, and the
    // passport index stays empty rather than acquiring a record it cannot
    // explain.
    const engine = newEngine()
    const tx = await anchorTx(claim())
    const steak = await engine.submit({ beef: tx.toBEEF(), topics: [UORA_TOPIC, 'tm_dpp'] })
    expect(steak[UORA_TOPIC].outputsToAdmit).toEqual([0])
    expect(steak['tm_dpp'].outputsToAdmit).toEqual([])

    const passports = await engine.lookup({ service: 'ls_dpp', query: { passportId: CELL } })
    expect((passports as { outputs: unknown[] }).outputs).toHaveLength(0)

    const anchors = await engine.lookup({ service: UORA_SERVICE, query: { subject: CELL } })
    expect((anchors as { outputs: unknown[] }).outputs).toHaveLength(1)
  })
})
