import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { Beef, MerklePath, PrivateKey, ProtoWallet, Transaction, UnlockingScript, Utils } from '@bsv/sdk'
import { buildAttestationAnchor, chainFromBeef, verifyChain, type PublisherPolicy } from '@bsv/dpp-core'
import { loadPublisherPolicy, type PublisherPolicyConfig } from '../src/policyConfig.js'
import { startPeerSynchronisation } from '../src/sync.js'
import { startOverlayService, type RunningService } from '../src/index.js'
import { ANYONE, bodyOf, eventTx, fundingTx, genesisTx, JSON_BODY, newNode, OCTET, PASSPORT_ID, type TestNode, type TestStores } from './helpers.js'
import { A1, FEDERATION_OPERATORS, federatedChain, K1, K2, pub, STRANGER } from './policy-fixture.js'

/**
 * The federation exercise of spec/services.md section 1 under the operator
 * profile federated-operators@1: two operators, A and B, each with its own
 * engine, storage and submit token, sharing one publisher policy file that
 * names both operators, B synchronising from A through the SDK's GASP over
 * the two routes this host serves.
 *
 * What this proves, and what it does not. Two in-memory nodes on two
 * ephemeral ports in one process, under one administration, prove the
 * mechanism: that the routes, the synchronisation, the admission during
 * synchronisation and the policy rotation behave as described. They prove
 * nothing about independence. The operator manifest
 * (packages/dpp-profiles/manifests/operator/federated-operators@1.json) says
 * so in as many words: two processes under one administration prove only the
 * mechanism, and the profile cannot be claimed by a deployment until two
 * organisations with separate credentials, databases and infrastructure have
 * run these exercises and observed the same results.
 */

const HOST = '127.0.0.1'
const NOW = new Date('2026-09-05T12:00:00Z')
const IN_WINDOW = '2026-03-01T00:00:00Z'
const AFTER_ROTATION = '2026-07-01T00:00:00Z'
const TOKENS = { A: 'operator-a-secret', B: 'operator-b-secret' }
const K1_WALLET = new ProtoWallet(K1)
const K2_WALLET = new ProtoWallet(K2)

interface Operator {
  name: 'A' | 'B'
  node: TestNode
  base: string
  token: string
  stop: () => Promise<void>
}

let running: Array<{ close: () => Promise<void> }> = []
afterEach(async () => {
  await Promise.all(running.splice(0).map((r) => r.close()))
  vi.restoreAllMocks()
})

const dir = mkdtempSync(join(tmpdir(), 'dpp-federation-'))
const POLICY_FILE = join(dir, 'publisher-policy.json')
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** The one policy file both operators read, as PUBLISHER_POLICY_FILE would name it. */
function writePolicy(chain: PublisherPolicy[]): PublisherPolicyConfig {
  writeFileSync(POLICY_FILE, JSON.stringify(chain, null, 2))
  return loadPublisherPolicy(POLICY_FILE, FEDERATION_OPERATORS)
}

async function startOperator(
  name: 'A' | 'B',
  policy: PublisherPolicyConfig,
  options: { peers?: string[]; stores?: TestStores } = {}
): Promise<Operator> {
  const node = newNode('', {}, { publisherPolicy: policy, syncPeers: options.peers, stores: options.stores, now: () => NOW, quiet: true })
  const service: RunningService = await startOverlayService(node.engine, {
    port: 0,
    host: HOST,
    components: node.components,
    submitToken: TOKENS[name],
    now: () => NOW,
  })
  running.push(service)
  return {
    name,
    node,
    base: `http://${HOST}:${service.port}`,
    token: TOKENS[name],
    stop: async () => {
      running = running.filter((r) => r !== service)
      await service.close()
    },
  }
}

async function announce(operator: Operator, tx: Transaction, topic = 'tm_dpp'): Promise<string> {
  const response = await fetch(`${operator.base}/submit`, {
    method: 'POST',
    headers: { ...OCTET, 'x-topics': JSON.stringify([topic]), Authorization: `Bearer ${operator.token}` },
    body: new Uint8Array(tx.toBEEF()),
  })
  expect(response.status).toBe(200)
  return response.headers.get('x-admission') ?? ''
}

async function lookup(operator: Operator, service: string, query: object): Promise<Array<{ beef: number[]; outputIndex: number }>> {
  const response = await fetch(`${operator.base}/lookup`, { method: 'POST', headers: JSON_BODY, body: JSON.stringify({ service, query }) })
  expect(response.status).toBe(200)
  return (await bodyOf(response)).outputs as Array<{ beef: number[]; outputIndex: number }>
}

/** Outputs by txid with their bytes, so two indexes are compared byte for byte and not by count. */
const normalise = (outputs: Array<{ beef: number[]; outputIndex: number }>) =>
  outputs
    .map((o) => ({ txid: Transaction.fromBEEF(o.beef).id('hex'), outputIndex: o.outputIndex, beef: Utils.toBase64(o.beef) }))
    .sort((x, y) => x.txid.localeCompare(y.txid))

const historyOf = async (operator: Operator, passportId = PASSPORT_ID): Promise<Record<string, any>> =>
  await bodyOf(await fetch(`${operator.base}/history?passportId=${encodeURIComponent(passportId)}`))

const historyItems = (page: Record<string, any>): Array<[string, boolean, string]> =>
  page.items.map((i: { txid: string; spent: boolean; spendingTxid: string }) => [i.txid, i.spent, i.spendingTxid])

/** One synchronisation round of `operator`, the way main() runs it on the interval. */
async function syncOnce(operator: Operator): Promise<void> {
  const peers = operator.node.components.sync?.peers ?? []
  const synchronisation = startPeerSynchronisation(operator.node.engine, { intervalMs: 0, peers, log: () => {}, warn: () => {} })
  const round = await synchronisation.runOnce()
  synchronisation.stop()
  expect(round.ok).toBe(true)
}

function prove(tx: Transaction, height: number): Transaction {
  tx.merklePath = MerklePath.fromCoinbaseTxidAndHeight(tx.id('hex'), height)
  return tx
}

async function pushProof(operator: Operator, tx: Transaction, height: number): Promise<void> {
  const proof = MerklePath.fromCoinbaseTxidAndHeight(tx.id('hex'), height)
  const response = await fetch(`${operator.base}/arc-ingest`, { method: 'POST', headers: JSON_BODY, body: JSON.stringify({ txid: tx.id('hex'), merklePath: proof.toHex() }) })
  expect(response.status).toBe(200)
}

async function anchorTx(service: PrivateKey, subject: string, attestationId: string): Promise<Transaction> {
  const script = await buildAttestationAnchor(
    {
      digest: '11'.repeat(32),
      attestationId,
      issuer: 'did:key:z6MkExampleIssuer',
      subject,
      attestationType: 'Origin',
      representation: 'dpp-lifecycle-json-v1',
      mediaType: 'application/json',
      anchoredBy: pub(service),
    },
    new ProtoWallet(service)
  )
  const funding = fundingTx()
  const tx = new Transaction()
  tx.addInput({ sourceTransaction: funding, sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
  tx.addOutput({ satoshis: 1, lockingScript: script })
  tx.addOutput({ satoshis: 9_000, lockingScript: ANYONE })
  return tx
}

/** Operator A holding a three-state lifecycle under K1 and one anchor under A1. */
async function operatorAWithHistory(policy: PublisherPolicyConfig): Promise<{ A: Operator; states: Transaction[]; anchor: Transaction }> {
  const A = await startOperator('A', policy)
  const { tx: g } = await genesisTx({ timestamp: IN_WINDOW }, K1_WALLET)
  const { tx: e1 } = await eventTx(g, { timestamp: IN_WINDOW }, K1_WALLET)
  const { tx: e2 } = await eventTx(e1, { timestamp: IN_WINDOW, op: 'REPAIRED', eventData: '{"workshop":"north"}' }, K1_WALLET)
  for (const tx of [g, e1, e2]) expect(await announce(A, tx)).toBe('tm_dpp=admitted')
  const anchor = await anchorTx(A1, PASSPORT_ID, 'urn:uuid:aaaaaaaa-1111-4111-8111-111111111111')
  expect(await announce(A, anchor, 'tm_attestation')).toBe('tm_attestation=admitted')
  return { A, states: [g, e1, e2], anchor }
}

describe('two operators under one publisher policy (federated-operators@1, the local exercise)', () => {
  it('B synchronises both rails from A and answers byte-identical lookups; a second round changes nothing', async () => {
    const policy = writePolicy([federatedChain().genesis])
    const { A } = await operatorAWithHistory(policy)
    const B = await startOperator('B', policy, { peers: [A.base] })
    expect(await lookup(B, 'ls_dpp', { passportId: PASSPORT_ID })).toEqual([])

    await syncOnce(B)
    const statesA = normalise(await lookup(A, 'ls_dpp', { passportId: PASSPORT_ID }))
    expect(statesA).toHaveLength(3)
    expect(normalise(await lookup(B, 'ls_dpp', { passportId: PASSPORT_ID }))).toEqual(statesA)
    const anchorsA = normalise(await lookup(A, 'ls_attestation', { subject: PASSPORT_ID }))
    expect(anchorsA).toHaveLength(1)
    expect(normalise(await lookup(B, 'ls_attestation', { subject: PASSPORT_ID }))).toEqual(anchorsA)
    const before = await historyOf(B)
    expect(historyItems(before)).toEqual(historyItems(await historyOf(A)))
    expect(before.items.map((i: { sequence: number }) => i.sequence)).toEqual([1, 2, 3])

    // A second round offers B what it already holds: nothing admitted, no
    // duplicate record, the same pages.
    await syncOnce(B)
    const after = await historyOf(B)
    expect(after.items).toEqual(before.items)
    expect(await B.node.records.highestSequence()).toBe(3)
    for (const state of statesA) expect(await B.node.storage.findOutputsForTransaction(state.txid)).toHaveLength(1)
    expect(normalise(await lookup(B, 'ls_dpp', { passportId: PASSPORT_ID }))).toEqual(statesA)

    // Each operator's capability document says what it is: A, with no
    // peers, is single-operator@1 however many operators the policy names;
    // B, with the two-operator policy and a peer, claims the federated
    // profile with static discovery, and its claim is a claim of mechanism.
    const capabilitiesA = await bodyOf(await fetch(`${A.base}/capabilities`))
    expect(capabilitiesA.synchronisation).toEqual({ profile: 'single-operator@1', discovery: 'none', gasp: false, peers: [] })
    const capabilitiesB = await bodyOf(await fetch(`${B.base}/capabilities`))
    expect(capabilitiesB.synchronisation).toEqual({ profile: 'federated-operators@1', discovery: 'static-peers', gasp: true, peers: [A.base] })
    expect(capabilitiesB.profiles[0]).toMatchObject({ id: 'federated-operators', version: '1', kind: 'operator', options: { discovery: 'static-peers', gasp: true, peers: [A.base], syncIntervalMs: 0 } })
    expect(capabilitiesB.limits.syncIntervalMs).toBe(0)
    expect(capabilitiesB.unsupported.map((u: { id: string }) => u.id)).not.toContain('gasp-synchronisation')
    expect(capabilitiesB.publisherPolicy).toMatchObject({ policyVersion: '1', publisherKeys: [pub(K1)], anchoringServices: [pub(A1)] })
  })

  it('a late-starting B catches up, and states admitted during a partition arrive once they are proven', async () => {
    const policy = writePolicy([federatedChain().genesis])
    const { A, states } = await operatorAWithHistory(policy)
    const [, , e2] = states
    // B starts after A has admitted its three states: the whole lineage is
    // fetched through the tip's inputs.
    const B = await startOperator('B', policy, { peers: [A.base] })
    await syncOnce(B)
    expect(normalise(await lookup(B, 'ls_dpp', { passportId: PASSPORT_ID }))).toEqual(normalise(await lookup(A, 'ls_dpp', { passportId: PASSPORT_ID })))

    // A partition: A admits an unproven e3 while B is not synchronising. The
    // SDK cannot finalise an unproven state on top of a lineage the peer
    // already holds (its graph builder needs the parent in the temporary
    // graph and its input stripping keeps a known parent out), so B stays
    // where it was, and says nothing false about it.
    const { tx: e3 } = await eventTx(e2, { timestamp: IN_WINDOW, op: 'SOLD', eventData: '{"channel":"web"}' }, K1_WALLET)
    expect(await announce(A, e3)).toBe('tm_dpp=admitted')
    await syncOnce(B)
    expect(await lookup(B, 'ls_dpp', { passportId: PASSPORT_ID })).toHaveLength(3)

    // Once A holds e3's proof (the writer or the gateway pushed it), the next
    // round carries e3 with its proof and B admits it against the
    // predecessor it holds.
    await pushProof(A, e3, 800_301)
    await syncOnce(B)
    const statesB = normalise(await lookup(B, 'ls_dpp', { passportId: PASSPORT_ID }))
    expect(statesB).toHaveLength(4)
    expect(statesB).toEqual(normalise(await lookup(A, 'ls_dpp', { passportId: PASSPORT_ID })))
    const e3OnB = statesB.find((s) => s.txid === e3.id('hex'))!
    expect(Transaction.fromBEEF(Utils.toArray(e3OnB.beef, 'base64')).merklePath?.blockHeight).toBe(800_301)

    // A state announced to A already proven synchronises the same way.
    const { tx: e4 } = await eventTx(e3, { timestamp: IN_WINDOW, op: 'RESOLD' }, K1_WALLET)
    prove(e4, 800_302)
    expect(await announce(A, e4)).toBe('tm_dpp=admitted')
    await syncOnce(B)
    expect(historyItems(await historyOf(B))).toEqual(historyItems(await historyOf(A)))
    expect(historyItems(await historyOf(B))).toEqual([
      [states[0].id('hex'), true, states[1].id('hex')],
      [states[1].id('hex'), true, e2.id('hex')],
      [e2.id('hex'), true, e3.id('hex')],
      [e3.id('hex'), true, e4.id('hex')],
      [e4.id('hex'), false, ''],
    ])
  })

  it('a proof ingested on A after synchronisation does not reach B through GASP; B takes it through its own /arc-ingest', async () => {
    const policy = writePolicy([federatedChain().genesis])
    const { A, states } = await operatorAWithHistory(policy)
    const B = await startOperator('B', policy, { peers: [A.base] })
    await syncOnce(B)
    const tip = states[2]
    const tipOn = async (operator: Operator): Promise<Transaction> => {
      const outputs = await lookup(operator, 'ls_dpp', { passportId: PASSPORT_ID })
      return Transaction.fromBEEF(outputs.find((o) => Transaction.fromBEEF(o.beef).id('hex') === tip.id('hex'))!.beef)
    }
    expect((await tipOn(B)).merklePath).toBeUndefined()

    await pushProof(A, tip, 800_201)
    expect((await tipOn(A)).merklePath?.blockHeight).toBe(800_201)
    // GASP offers outpoints, and B already holds this one: the SDK never
    // re-fetches a held output, so the proof stays on A. Proofs reach each
    // operator through its own /arc-ingest, which is what the operator
    // manifest means by proof updates being ingested separately from
    // replaying held outputs.
    await syncOnce(B)
    expect((await tipOn(B)).merklePath).toBeUndefined()
    await pushProof(B, tip, 800_201)
    expect((await tipOn(B)).merklePath?.blockHeight).toBe(800_201)
  })

  it('A stops and B keeps serving the complete history, verified from the bytes', async () => {
    const policy = writePolicy([federatedChain().genesis])
    const { A, states } = await operatorAWithHistory(policy)
    const B = await startOperator('B', policy, { peers: [A.base] })
    await syncOnce(B)
    await A.stop()
    await expect(fetch(`${A.base}/health`)).rejects.toThrow()

    const outputs = await lookup(B, 'ls_dpp', { passportId: PASSPORT_ID })
    expect(outputs).toHaveLength(3)
    const merged = new Beef()
    for (const output of outputs) merged.mergeBeef(output.beef)
    const chain = chainFromBeef(merged, PASSPORT_ID)
    expect(chain.map((tx) => tx.id('hex'))).toEqual(states.map((tx) => tx.id('hex')))
    const result = await verifyChain(chain, { chainTracker: 'scripts only', serverIdentityKey: pub(K1) })
    expect(result.valid).toBe(true)
    expect(result.states.every((s) => s.userSignatureValid && s.serverSignatureValid === true && s.linkageValid)).toBe(true)
    expect(await lookup(B, 'ls_attestation', { subject: PASSPORT_ID })).toHaveLength(1)
    const history = await historyOf(B)
    expect(history.completeForSnapshot).toBe(true)
    expect(history.items).toHaveLength(3)
  })

  it('a peer offering a state countersigned by a key outside the policy is refused by B, and the refusal is logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const policy = writePolicy([federatedChain().genesis])
    const forgedPassport = 'https://id.gs1.org/01/09506000134352/21/FORGED-1'
    const { tx: forged } = await genesisTx({ passportId: forgedPassport, timestamp: IN_WINDOW }, new ProtoWallet(STRANGER))
    const funding = forged.inputs[0].sourceTransaction!
    const served: string[] = []
    // A peer that speaks the protocol and offers what no honest operator
    // would admit: the state and its funding, on request.
    const stub = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
      request.on('end', () => {
        const reply = (status: number, payload: unknown): void => {
          response.writeHead(status, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify(payload))
        }
        served.push(request.url ?? '')
        if (request.url === '/requestSyncResponse') {
          reply(200, { UTXOList: [{ txid: forged.id('hex'), outputIndex: 0, score: 1 }], since: 0 })
          return
        }
        if (request.url === '/requestForeignGASPNode') {
          const { graphID, txid } = JSON.parse(body) as { graphID: string; txid: string }
          if (txid === forged.id('hex')) {
            reply(200, { graphID, rawTx: forged.toHex(), outputIndex: 0 })
            return
          }
          if (txid === funding.id('hex')) {
            reply(200, { graphID, rawTx: funding.toHex(), outputIndex: 0, proof: funding.merklePath!.toHex() })
            return
          }
        }
        reply(404, { status: 'error', description: 'no such thing' })
      })
    })
    await new Promise<void>((resolve) => stub.listen(0, HOST, resolve))
    running.push({ close: () => new Promise<void>((resolve) => stub.close(() => resolve())) })
    const stubBase = `http://${HOST}:${(stub.address() as AddressInfo).port}`

    const B = await startOperator('B', policy, { peers: [stubBase] })
    await syncOnce(B)
    expect(served).toContain('/requestSyncResponse')
    expect(served.filter((u) => u === '/requestForeignGASPNode').length).toBeGreaterThanOrEqual(1)
    expect(await lookup(B, 'ls_dpp', { passportId: forgedPassport })).toEqual([])
    expect(await B.node.storage.findOutput(forged.id('hex'), 0, 'tm_dpp')).toBeNull()
    expect(warn.mock.calls.some((call) => String(call[0]).includes(`tm_dpp refused ${forged.id('hex')}: server_signature is not from a state-publisher key active at ${IN_WINDOW}`))).toBe(true)
  })

  it('a rotated policy is picked up by both operators on restart, and the retired key admits nothing timestamped after its retirement', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { genesis, rotation } = federatedChain()
    let policy = writePolicy([genesis])
    const A = await startOperator('A', policy)
    const B = await startOperator('B', policy, { peers: [A.base] })
    const { tx: g } = await genesisTx({ timestamp: IN_WINDOW }, K1_WALLET)
    expect(await announce(A, g)).toBe('tm_dpp=admitted')
    await syncOnce(B)
    expect(await lookup(B, 'ls_dpp', { passportId: PASSPORT_ID })).toHaveLength(1)

    // The new version lands in the shared file; both operators restart over
    // their own stores and read it.
    policy = writePolicy([genesis, rotation])
    expect(policy.versions).toEqual([1, 2])
    await A.stop()
    await B.stop()
    const A2 = await startOperator('A', policy, { stores: A.node })
    const B2 = await startOperator('B', policy, { peers: [A2.base], stores: B.node })
    expect(await lookup(B2, 'ls_dpp', { passportId: PASSPORT_ID })).toHaveLength(1)
    for (const operator of [A2, B2]) {
      const capabilities = await bodyOf(await fetch(`${operator.base}/capabilities`))
      expect(capabilities.publisherPolicy).toMatchObject({ policyVersion: '2', publisherKeys: [pub(K2)] })
    }

    // Under the retired key, timestamped after retirement: refused on both,
    // and the genesis stays the tip on both.
    const { tx: stale } = await eventTx(g, { timestamp: AFTER_ROTATION }, K1_WALLET)
    expect(await announce(A2, stale)).toBe('tm_dpp=none')
    expect(await announce(B2, stale)).toBe('tm_dpp=none')
    expect(warn.mock.calls.filter((call) => String(call[0]).includes(`tm_dpp refused ${stale.id('hex')}`))).toHaveLength(2)
    for (const operator of [A2, B2]) {
      expect(historyItems(await historyOf(operator))).toEqual([[g.id('hex'), false, '']])
    }

    // Under the new key, mined, announced to A and synchronised to B.
    const { tx: fresh } = await eventTx(g, { timestamp: AFTER_ROTATION, eventData: '{"channel":"web"}' }, K2_WALLET)
    prove(fresh, 800_401)
    expect(await announce(A2, fresh)).toBe('tm_dpp=admitted')
    await syncOnce(B2)
    const expected: Array<[string, boolean, string]> = [[g.id('hex'), true, fresh.id('hex')], [fresh.id('hex'), false, '']]
    expect(historyItems(await historyOf(A2))).toEqual(expected)
    expect(historyItems(await historyOf(B2))).toEqual(expected)
    expect(normalise(await lookup(B2, 'ls_dpp', { passportId: PASSPORT_ID }))).toEqual(normalise(await lookup(A2, 'ls_dpp', { passportId: PASSPORT_ID })))
  })
})
