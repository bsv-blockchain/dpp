import {
  Beef,
  Hash,
  LockingScript,
  MerklePath,
  PrivateKey,
  ProtoWallet,
  Transaction,
  TransactionSignature,
  UnlockingScript,
  type PublicKey,
} from '@bsv/sdk'
import { Engine, type LookupService } from '@bsv/overlay'
import { readFileSync } from 'node:fs'
import { buildLockingScript, completeState, ownerBlobHash, type DppState, type DppStateData } from '@bsv/dpp-core'
import { DppTopicManager, type DppAdmissionOptions } from '../src/tmDpp.js'
import { DppLookupService } from '../src/lsDpp.js'
import { AttestationTopicManager } from '../src/tmAttestation.js'
import { AttestationLookupService } from '../src/lsAttestation.js'
import { InMemoryAttestationStorage } from '../src/attestationStorage.js'
import { InMemoryDppStorage } from '../src/storage.js'
import { InMemoryOverlayStorage } from '../src/engineStorage.js'
import { syncConfigurationFor } from '../src/sync.js'
import type { PublisherPolicyConfig } from '../src/policyConfig.js'
import type { NodeComponents } from '../src/index.js'

/**
 * Shared by the tests of the extension routes: the same synthetic keys and
 * transaction shapes engine.test.ts and http.test.ts build inline, so a
 * retraction, an export and a policy test read the same way as the admission
 * tests do, plus the chain fixture admitted the way a backfill announces it.
 * Test keys, published on purpose; nothing derived from them will ever hold a
 * satoshi.
 */

export const makerPriv = PrivateKey.fromHex('11'.repeat(32))
export const serverPriv = PrivateKey.fromHex('22'.repeat(32))
export const ownerPriv = PrivateKey.fromHex('33'.repeat(32))
export const makerWallet = new ProtoWallet(makerPriv)
export const serverWallet = new ProtoWallet(serverPriv)
export const SERVER_ID = serverPriv.toPublicKey().toString()
export const lockKey: PublicKey = makerPriv.toPublicKey()

export const PASSPORT_ID = 'https://id.gs1.org/01/09506000134352/21/EXT-1'
export const UID = 'EXT-UID-1'
export const ANYONE = new LockingScript([{ op: 0x51 }])
const SIGHASH = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID

export function makeData(overrides: Partial<DppStateData> = {}): DppStateData {
  return {
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
    ...overrides,
  }
}

/** A mined funding source. 'scripts only' never checks the path itself. */
export function fundingTx(): Transaction {
  const tx = new Transaction()
  tx.addOutput({ satoshis: 10_000, lockingScript: ANYONE })
  tx.merklePath = MerklePath.fromCoinbaseTxidAndHeight(tx.id('hex'), 800_000)
  return tx
}

/** The DPP output is `<pubkey> OP_CHECKSIG <fields> OP_2DROP...`: a plain signature push unlocks it, the way P2PK does. */
export function unlockDppOutput(spending: Transaction, inputIndex: number, key: PrivateKey = makerPriv): UnlockingScript {
  const input = spending.inputs[inputIndex]
  const source = input.sourceTransaction!
  const sourceOutput = source.outputs[input.sourceOutputIndex]
  const preimage = TransactionSignature.format({
    sourceTXID: source.id('hex'),
    sourceOutputIndex: input.sourceOutputIndex,
    sourceSatoshis: sourceOutput.satoshis!,
    transactionVersion: spending.version,
    otherInputs: spending.inputs.filter((_, i) => i !== inputIndex),
    outputs: spending.outputs,
    inputIndex,
    subscript: sourceOutput.lockingScript,
    inputSequence: input.sequence ?? 0xffffffff,
    lockTime: spending.lockTime,
    scope: SIGHASH,
  })
  const raw = key.sign(Hash.sha256(preimage))
  const signature = new TransactionSignature(raw.r, raw.s, SIGHASH)
  const der = [...signature.toChecksigFormat()]
  return new UnlockingScript([{ op: der.length, data: der }])
}

/** A genesis transaction, spending a synthetic mined funding output. `server` defaults to the key the engines here check. */
export async function genesisTx(
  overrides: Partial<DppStateData> = {},
  server: ProtoWallet = serverWallet
): Promise<{ tx: Transaction; state: DppState }> {
  const state = await completeState(makeData(overrides), makerWallet, server)
  const funding = fundingTx()
  const tx = new Transaction()
  tx.addInput({ sourceTransaction: funding, sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
  tx.addOutput({ satoshis: 1, lockingScript: buildLockingScript(state, lockKey) })
  tx.addOutput({ satoshis: 9_000, lockingScript: ANYONE })
  return { tx, state }
}

/** A later state spending the previous transaction's DPP output at index 0, properly unlocked. */
export async function eventTx(
  previous: Transaction,
  overrides: Partial<DppStateData> = {},
  server: ProtoWallet = serverWallet
): Promise<{ tx: Transaction; state: DppState }> {
  const state = await completeState(
    makeData({
      op: 'SOLD',
      timestamp: '2026-07-26T10:00:00Z',
      eventData: '{"channel":"store"}',
      previousTxid: previous.id('hex'),
      ...overrides,
    }),
    makerWallet,
    server
  )
  const funding = fundingTx()
  const tx = new Transaction()
  tx.addInput({ sourceTransaction: previous, sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
  tx.addInput({ sourceTransaction: funding, sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
  tx.addOutput({ satoshis: 1, lockingScript: buildLockingScript(state, lockKey) })
  tx.addOutput({ satoshis: 9_000, lockingScript: ANYONE })
  tx.inputs[0].unlockingScript = unlockDppOutput(tx, 0)
  return { tx, state }
}

export interface TestStores {
  storage: InMemoryOverlayStorage
  records: InMemoryDppStorage
  attestations: InMemoryAttestationStorage
}

export interface TestNode extends TestStores {
  engine: Engine
  lookupServices: Record<string, LookupService>
  components: NodeComponents
}

export interface NodeOptions {
  /** The verified chain, wired into both topic managers and reported by the capability document. */
  publisherPolicy?: PublisherPolicyConfig
  /** ANCHOR_SERVICE_KEYS for the anchor rail; empty admits any well-formed anchor. */
  anchorServices?: string[]
  /** SYNC_PEERS: the Engine synchronises tm_dpp and tm_attestation from these. */
  syncPeers?: string[]
  syncIntervalMs?: number
  /** PUBLIC_URL, which the Engine removes from its own peer list. */
  hostingURL?: string
  /** The clock the anchor topic reads admission time from. */
  now?: () => Date
  /** Reuse a stopped node's stores: what a restart is, in process. */
  stores?: TestStores
  /** Silence the Engine's own log lines (the GASP sync narration); refusals logged by the topic managers still reach console. */
  quiet?: boolean
}

const silence = (): void => {}

/**
 * A real Engine over in-memory stores, 'scripts only', both rails, with the
 * pieces the extension routes need beside it. `admittedOutputs` is wired as
 * the node does it, so a state whose BEEF omits its predecessor is judged
 * against the predecessor this node holds.
 */
export function newNode(identityKey: string = SERVER_ID, admission: DppAdmissionOptions = {}, options: NodeOptions = {}): TestNode {
  const storage = options.stores?.storage ?? new InMemoryOverlayStorage()
  const records = options.stores?.records ?? new InMemoryDppStorage()
  const attestations = options.stores?.attestations ?? new InMemoryAttestationStorage()
  const chain = options.publisherPolicy?.chain ?? admission.publisherPolicy
  const lookupServices: Record<string, LookupService> = {
    ls_dpp: new DppLookupService(records),
    ls_attestation: new AttestationLookupService(attestations),
  }
  const peers = options.syncPeers ?? []
  const logger = options.quiet
    ? ({ ...console, log: silence, info: silence, warn: silence, error: silence } as typeof console)
    : console
  const engine = new Engine(
    {
      tm_dpp: new DppTopicManager(identityKey, { ...admission, publisherPolicy: chain, admittedOutputs: storage }),
      tm_attestation: new AttestationTopicManager(options.anchorServices ?? [], { publisherPolicy: chain, now: options.now }),
    },
    lookupServices,
    storage,
    'scripts only',
    options.hostingURL,
    undefined,
    undefined,
    undefined,
    undefined,
    syncConfigurationFor({ peers, legacy: false }, { passport: 'tm_dpp', attestation: 'tm_attestation', legacy: 'tm_uora_dpp' }),
    false,
    '[OVERLAY_ENGINE] ',
    false,
    undefined,
    logger
  )
  return {
    engine,
    storage,
    records,
    attestations,
    lookupServices,
    components: {
      records,
      engineStorage: storage,
      lookupServices,
      publisherPolicy: options.publisherPolicy,
      serviceIdentityKey: identityKey === '' ? undefined : identityKey,
      anchorServiceKeys: options.anchorServices ?? [],
      ...(peers.length === 0 ? {} : { sync: { peers, intervalMs: options.syncIntervalMs ?? 0 } }),
    },
  }
}

export interface FixtureChain {
  passportId: string
  uid: string
  serverKey: string
  /** The six pinned transactions, each given a synthetic proof at a distinct height. */
  txs: Transaction[]
  /** Each state atomic over its whole stored chain, the shape a backfill announces. */
  beefs: number[][]
  outputIndexes: number[]
}

/**
 * `fixtures/chain-v1.json`, prepared the way `scripts/announce.ts` announces a
 * stored chain: every state given its own (synthetic) merkle path, then each
 * submitted as the atomic subject of a BEEF holding every predecessor, so the
 * topic manager finds the parent's bytes and the engine's 'scripts only' SPV
 * check is satisfied by the proof. The fixture's own transactions are unfunded
 * and, for four of six states, unsigned at the input, so nothing else would
 * admit them through a real Engine, which is exactly the backfill situation
 * the proven shape exists for.
 */
export function fixtureChain(): FixtureChain {
  const fixture = JSON.parse(readFileSync(new URL('../../../fixtures/chain-v1.json', import.meta.url), 'utf8')) as {
    serverKey: string
    states: Array<{ rawTx: string; txid: string; outputIndex: number; data: { passportId: string; payloadPublic: string } }>
  }
  const txs = fixture.states.map((s, i) => {
    const tx = Transaction.fromHex(s.rawTx)
    tx.merklePath = MerklePath.fromCoinbaseTxidAndHeight(tx.id('hex'), 800_100 + i)
    return tx
  })
  const beefs = txs.map((tx, i) => {
    const beef = new Beef()
    for (const earlier of txs.slice(0, i + 1)) beef.mergeTransaction(earlier)
    return beef.toBinaryAtomic(tx.id('hex'))
  })
  const payload = JSON.parse(fixture.states[0].data.payloadPublic) as { dataCarrier: string }
  return {
    passportId: fixture.states[0].data.passportId,
    uid: payload.dataCarrier,
    serverKey: fixture.serverKey,
    txs,
    beefs,
    outputIndexes: fixture.states.map((s) => s.outputIndex),
  }
}

export const JSON_BODY = { 'Content-Type': 'application/json' }
export const OCTET = { 'Content-Type': 'application/octet-stream' }

/** `Response.json()` answers `unknown`; every assertion here wants a record. */
export async function bodyOf(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>
}

export async function submitBeef(base: string, beef: number[], headers: Record<string, string> = {}): Promise<Response> {
  return await fetch(`${base}/submit`, {
    method: 'POST',
    headers: { ...OCTET, 'x-topics': JSON.stringify(['tm_dpp']), ...headers },
    body: new Uint8Array(beef),
  })
}

export async function lookupPassport(base: string, query: object): Promise<Array<{ beef: number[]; outputIndex: number }>> {
  const response = await fetch(`${base}/lookup`, {
    method: 'POST',
    headers: JSON_BODY,
    body: JSON.stringify({ service: 'ls_dpp', query }),
  })
  const answer = await bodyOf(response)
  return answer.outputs as Array<{ beef: number[]; outputIndex: number }>
}
