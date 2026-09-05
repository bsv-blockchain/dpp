import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LockingScript, PrivateKey, ProtoWallet, Transaction, UnlockingScript } from '@bsv/sdk'
import { buildAttestationAnchor, buildLockingScript, completeState } from '@bsv/dpp-core'
import { DppTopicManager } from '../src/tmDpp.js'
import { AttestationTopicManager } from '../src/tmAttestation.js'
import { loadPublisherPolicy, parseOperatorIdentityKeys, publisherPolicyFromEnvironment } from '../src/policyConfig.js'
import { startOverlayService, type RunningService } from '../src/index.js'
import { bodyOf, eventTx, genesisTx, lockKey, makeData, makerWallet, newNode, SERVER_ID, serverPriv } from './helpers.js'
import { A1, K1, K2, OPERATORS, policyChain, pub, STRANGER, T1, tamperedChain } from './policy-fixture.js'

/**
 * The publisher key policy at the topic managers (spec/services.md section 1):
 * a state is held against the state-publisher keys active at its own
 * timestamp, an anchor against the anchor-publisher keys active at admission
 * time, and a chain that does not verify never boots the node.
 */

const chain = policyChain()
const INSIDE_K1 = '2026-03-01T00:00:00Z'
const AFTER_ROTATION = '2026-07-01T00:00:00Z'
const BEFORE_POLICY = '2025-12-01T00:00:00Z'

async function genesisBeefSignedBy(publisher: PrivateKey, timestamp: string): Promise<number[]> {
  const state = await completeState(makeData({ timestamp }), makerWallet, new ProtoWallet(publisher))
  const tx = new Transaction()
  tx.addOutput({ satoshis: 1, lockingScript: buildLockingScript(state, lockKey) })
  return tx.toBEEF(true)
}

describe('tm_dpp under a publisher key policy', () => {
  afterEach(() => vi.restoreAllMocks())

  it('admits a state signed under a key active at its timestamp, and refuses one after that key retired', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tm = new DppTopicManager('', { publisherPolicy: chain })
    expect((await tm.identifyAdmissibleOutputs(await genesisBeefSignedBy(K1, INSIDE_K1), [])).outputsToAdmit).toEqual([0])
    expect((await tm.identifyAdmissibleOutputs(await genesisBeefSignedBy(K1, AFTER_ROTATION), [])).outputsToAdmit).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain(AFTER_ROTATION)
  })

  it('refuses a state timestamped before the new key activated, and one before any policy version', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tm = new DppTopicManager('', { publisherPolicy: chain })
    expect((await tm.identifyAdmissibleOutputs(await genesisBeefSignedBy(K2, INSIDE_K1), [])).outputsToAdmit).toEqual([])
    expect((await tm.identifyAdmissibleOutputs(await genesisBeefSignedBy(K2, AFTER_ROTATION), [])).outputsToAdmit).toEqual([0])
    expect((await tm.identifyAdmissibleOutputs(await genesisBeefSignedBy(K1, BEFORE_POLICY), [])).outputsToAdmit).toEqual([])
    expect((await tm.identifyAdmissibleOutputs(await genesisBeefSignedBy(STRANGER, INSIDE_K1), [])).outputsToAdmit).toEqual([])
  })

  it('does not consult the positional identity key where the policy covers the topic', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tm = new DppTopicManager(SERVER_ID, { publisherPolicy: chain })
    expect((await tm.identifyAdmissibleOutputs(await genesisBeefSignedBy(serverPriv, INSIDE_K1), [])).outputsToAdmit).toEqual([])
    expect((await tm.identifyAdmissibleOutputs(await genesisBeefSignedBy(K1, INSIDE_K1), [])).outputsToAdmit).toEqual([0])
  })

  it('falls back to the identity key where the policy scope excludes tm_dpp', async () => {
    const anchorsOnly = policyChain({ topics: ['tm_attestation'] })
    const tm = new DppTopicManager(SERVER_ID, { publisherPolicy: anchorsOnly })
    expect((await tm.identifyAdmissibleOutputs(await genesisBeefSignedBy(serverPriv, INSIDE_K1), [])).outputsToAdmit).toEqual([0])
    expect((await tm.identifyAdmissibleOutputs(await genesisBeefSignedBy(K1, INSIDE_K1), [])).outputsToAdmit).toEqual([])
  })

  it('admits a lifecycle that spans a rotation through the Engine, and refuses the retired key afterwards', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const node = newNode('', { publisherPolicy: chain })
    const { tx: genesis } = await genesisTx({ timestamp: INSIDE_K1 }, new ProtoWallet(K1))
    expect((await node.engine.submit({ beef: genesis.toBEEF(), topics: ['tm_dpp'] })).tm_dpp.outputsToAdmit).toEqual([0])
    const { tx: rotated } = await eventTx(genesis, { timestamp: AFTER_ROTATION }, new ProtoWallet(K2))
    expect((await node.engine.submit({ beef: rotated.toBEEF(), topics: ['tm_dpp'] })).tm_dpp).toEqual({ outputsToAdmit: [0], coinsToRetain: [0], coinsRemoved: [] })
    const answer = await node.engine.lookup({ service: 'ls_dpp', query: { passportId: makeData().passportId } })
    expect((answer as { outputs: unknown[] }).outputs).toHaveLength(2)
    // The retired key, shown on a state that spends nothing: the Engine treats
    // a refused spend of a tip as that tip's consumption and evicts it, which
    // is its own behaviour and not this policy's.
    const other = 'https://id.gs1.org/01/09506000134352/21/EXT-2'
    const { tx: late } = await genesisTx({ passportId: other, timestamp: AFTER_ROTATION }, new ProtoWallet(K1))
    expect((await node.engine.submit({ beef: late.toBEEF(), topics: ['tm_dpp'] })).tm_dpp.outputsToAdmit).toEqual([])
    const { tx: current } = await genesisTx({ passportId: other, timestamp: AFTER_ROTATION }, new ProtoWallet(K2))
    expect((await node.engine.submit({ beef: current.toBEEF(), topics: ['tm_dpp'] })).tm_dpp.outputsToAdmit).toEqual([0])
  })

  it('names the policy in the topic documentation', async () => {
    expect(await new DppTopicManager('', { publisherPolicy: chain }).getDocumentation()).toContain('version 2')
    expect(await new DppTopicManager(SERVER_ID).getDocumentation()).toContain('implicit single-operator policy')
  })
})

async function anchorBeefBy(service: PrivateKey): Promise<number[]> {
  const script = await buildAttestationAnchor(
    {
      digest: '11'.repeat(32),
      attestationId: 'urn:uuid:22222222-2222-4222-8222-222222222222',
      issuer: 'did:key:z6MkExample',
      subject: 'https://id.gs1.org/01/09506000134352/21/POLICY-1',
      attestationType: 'Origin',
      representation: 'dpp-lifecycle-json-v1',
      mediaType: 'application/json',
      anchoredBy: pub(service),
    },
    new ProtoWallet(service)
  )
  const source = new Transaction()
  source.addOutput({ satoshis: 3, lockingScript: LockingScript.fromASM('OP_TRUE') })
  const tx = new Transaction()
  tx.addInput({ sourceTransaction: source, sourceOutputIndex: 0, unlockingScript: UnlockingScript.fromASM('OP_TRUE') })
  tx.addOutput({ satoshis: 1, lockingScript: script })
  return tx.toBEEF(true)
}

describe('tm_attestation under a publisher key policy', () => {
  it('admits anchors only from anchor-publisher keys active at admission time', async () => {
    const after = new AttestationTopicManager([], { publisherPolicy: chain, now: () => new Date(AFTER_ROTATION) })
    expect((await after.identifyAdmissibleOutputs(await anchorBeefBy(A1))).outputsToAdmit).toEqual([0])
    expect((await after.identifyAdmissibleOutputs(await anchorBeefBy(STRANGER))).outputsToAdmit).toEqual([])
    // A1 activates at the rotation; before it, the policy names no anchoring service at all.
    const before = new AttestationTopicManager([pub(A1)], { publisherPolicy: chain, now: () => new Date(INSIDE_K1) })
    expect((await before.identifyAdmissibleOutputs(await anchorBeefBy(A1))).outputsToAdmit).toEqual([])
    expect(await after.getDocumentation()).toContain('admission time')
  })

  it('keeps the static list where the policy scope excludes the anchor topic', async () => {
    const statesOnly = policyChain({ topics: ['tm_dpp'] })
    const tm = new AttestationTopicManager([pub(STRANGER)], { publisherPolicy: statesOnly, now: () => new Date(AFTER_ROTATION) })
    expect((await tm.identifyAdmissibleOutputs(await anchorBeefBy(STRANGER))).outputsToAdmit).toEqual([0])
    expect((await tm.identifyAdmissibleOutputs(await anchorBeefBy(A1))).outputsToAdmit).toEqual([])
  })
})

describe('the policy from the environment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dpp-policy-'))
  const write = (name: string, content: unknown): string => {
    const file = join(dir, name)
    writeFileSync(file, JSON.stringify(content))
    return file
  }
  afterEach(() => {
    delete process.env.PUBLISHER_POLICY_FILE
    delete process.env.OPERATOR_IDENTITY_KEYS
    vi.restoreAllMocks()
  })
  const operators = `${Object.keys(OPERATORS)[0]}=${Object.values(OPERATORS)[0]}`

  it('loads and verifies a chain, naming its versions', () => {
    const config = loadPublisherPolicy(write('good.json', chain), OPERATORS)
    expect(config.versions).toEqual([1, 2])
    expect(config.chain).toEqual(chain)
    process.env.PUBLISHER_POLICY_FILE = write('good-env.json', chain)
    process.env.OPERATOR_IDENTITY_KEYS = ` ${operators} , `
    expect(publisherPolicyFromEnvironment()?.versions).toEqual([1, 2])
  })

  it('refuses to start on a chain that does not verify, naming the version and the reason', () => {
    process.env.PUBLISHER_POLICY_FILE = write('tampered.json', tamperedChain())
    process.env.OPERATOR_IDENTITY_KEYS = operators
    expect(() => publisherPolicyFromEnvironment()).toThrow(/policy version 2 refused, signature-invalid/)
    process.env.OPERATOR_IDENTITY_KEYS = `${Object.keys(OPERATORS)[0]}=${pub(STRANGER)}`
    process.env.PUBLISHER_POLICY_FILE = write('good2.json', chain)
    expect(() => publisherPolicyFromEnvironment()).toThrow(/policy version 1 refused, genesis-signer-not-operator/)
  })

  it('refuses a file that is not a chain, a missing file and malformed operator keys', () => {
    expect(() => loadPublisherPolicy(write('object.json', chain[0]), OPERATORS)).toThrow(/JSON array/)
    expect(() => loadPublisherPolicy(write('empty.json', []), OPERATORS)).toThrow(/version 0 refused, format/)
    expect(() => loadPublisherPolicy(join(dir, 'missing.json'), OPERATORS)).toThrow(/could not be read/)
    writeFileSync(join(dir, 'bad.json'), '{')
    expect(() => loadPublisherPolicy(join(dir, 'bad.json'), OPERATORS)).toThrow(/not JSON/)
    expect(() => parseOperatorIdentityKeys('did:example:a')).toThrow(/operator=compressedKey/)
    expect(() => parseOperatorIdentityKeys('did:example:a=nothex')).toThrow(/compressed public key/)
    expect(() => parseOperatorIdentityKeys(`${operators},${operators}`)).toThrow(/twice/)
    // One key under two names would sign a federation rotation and countersign it as another operator.
    expect(() => parseOperatorIdentityKeys(`${operators},did:example:b=${Object.values(OPERATORS)[0]}`)).toThrow(/same key as/)
    expect(parseOperatorIdentityKeys(undefined)).toEqual({})
  })

  it('is absent without a file, warning when operator keys are set alone', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(publisherPolicyFromEnvironment()).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
    process.env.OPERATOR_IDENTITY_KEYS = operators
    expect(publisherPolicyFromEnvironment()).toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('the capability document under a policy, over HTTP', () => {
  let running: RunningService | undefined
  afterEach(async () => {
    await running?.close()
    running = undefined
  })

  it('reflects the keys active at the node clock', async () => {
    const node = newNode('', { publisherPolicy: chain })
    node.components.publisherPolicy = { chain, operators: OPERATORS, versions: [1, 2], source: 'test' }
    node.components.serviceIdentityKey = undefined
    running = await startOverlayService(node.engine, { port: 0, host: '127.0.0.1', components: node.components, now: () => new Date(T1) })
    const document = await bodyOf(await fetch(`http://127.0.0.1:${running.port}/capabilities`))
    expect(document.publisherPolicy).toMatchObject({ policyVersion: '2', publisherKeys: [pub(K2)], anchoringServices: [pub(A1)] })
    expect(document.unsupported.map((u: { id: string }) => u.id)).not.toContain('publisher-key-rotation')
  })
})
