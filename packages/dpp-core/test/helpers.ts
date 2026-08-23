import {
  LockingScript,
  MerklePath,
  OP,
  PrivateKey,
  ProtoWallet,
  PublicKey,
  Transaction,
  UnlockingScript,
  type ChainTracker,
} from '@bsv/sdk'
import {
  buildLockingScript,
  completeState,
  ownerBlobHash,
  type DppState,
  type DppStateData,
} from '../src/index.js'

export const makerPriv = PrivateKey.fromHex('11'.repeat(32))
export const serverPriv = PrivateKey.fromHex('22'.repeat(32))
export const owner1Priv = PrivateKey.fromHex('33'.repeat(32))
export const owner2Priv = PrivateKey.fromHex('44'.repeat(32))

export const makerWallet = new ProtoWallet(makerPriv)
export const serverWallet = new ProtoWallet(serverPriv)
export const owner2Wallet = new ProtoWallet(owner2Priv)

export const idKey = (priv: PrivateKey): string => priv.toPublicKey().toString()

export const PASSPORT_ID = 'https://id.gs1.org/01/09506000134352/21/JERSEY-001'
export const PAYLOAD_V1 = JSON.stringify({
  name: 'Club Jersey 2026',
  fibres: { polyester: 82, cotton: 18 },
  dataCarrier: 'EXT-UID-0001',
})
export const PAYLOAD_V2 = JSON.stringify({
  name: 'Club Jersey 2026',
  fibres: { polyester: 82, cotton: 18 },
  dataCarrier: 'EXT-UID-0001',
  recycledContent: 40,
})

export const BLOB_V1 = [1, 2, 3, 4, 5]
export const BLOB_V2 = [9, 8, 7, 6]

/** A valid ACTIVATE-genesis state-data object; override per test. */
export function makeData(overrides: Partial<DppStateData> = {}): DppStateData {
  return {
    passportId: PASSPORT_ID,
    op: 'ACTIVATE',
    timestamp: '2026-06-11T12:00:00Z',
    ownerIdentityKey: idKey(owner1Priv),
    actorIdentityKey: idKey(makerPriv),
    actorKeyId: 'maker batch 1',
    eventData: '',
    payloadPublic: PAYLOAD_V1,
    payloadOwnerHash: ownerBlobHash(BLOB_V1),
    previousTxid: '',
    ...overrides,
  }
}

export async function signedState(
  d: DppStateData,
  actor: ProtoWallet = makerWallet,
  server: ProtoWallet = serverWallet
): Promise<DppState> {
  return await completeState(d, actor, server)
}

/** Wrap a state into a transaction, optionally spending the previous tip. */
export function stateTx(
  state: DppState,
  lockKey: PublicKey,
  prev?: { tx: Transaction; outputIndex: number },
  opReturnFirst = false
): Transaction {
  const tx = new Transaction()
  if (prev != null) {
    tx.addInput({
      sourceTransaction: prev.tx,
      sourceOutputIndex: prev.outputIndex,
      unlockingScript: new UnlockingScript([]),
    })
  }
  if (opReturnFirst) {
    tx.addOutput({
      satoshis: 0,
      lockingScript: new LockingScript([{ op: 0 }, { op: OP.OP_RETURN }]),
    })
  }
  tx.addOutput({ satoshis: 1, lockingScript: buildLockingScript(state, lockKey) })
  return tx
}

export interface ChainFixture {
  txs: Transaction[]
  states: DppState[]
  outputIndexes: number[]
}

/**
 * The demo lifecycle: ACTIVATE → SOLD → TRANSFER (to owner2) → REPAIRED.
 * The SOLD transaction carries the DPP output at index 1 to exercise
 * outpoint tracking.
 */
export async function buildChainFixture(): Promise<ChainFixture> {
  const lockKey = makerPriv.toPublicKey()
  const txs: Transaction[] = []
  const states: DppState[] = []
  const outputIndexes: number[] = []

  const s0 = await signedState(makeData())
  const tx0 = stateTx(s0, lockKey)
  txs.push(tx0); states.push(s0); outputIndexes.push(0)

  const s1 = await signedState(
    makeData({
      op: 'SOLD',
      timestamp: '2026-06-12T09:30:00Z',
      actorKeyId: 'maker pos 7',
      eventData: JSON.stringify({ channel: 'club store' }),
      previousTxid: tx0.id('hex'),
    })
  )
  const tx1 = stateTx(s1, lockKey, { tx: tx0, outputIndex: 0 }, true)
  txs.push(tx1); states.push(s1); outputIndexes.push(1)

  const s2 = await signedState(
    makeData({
      op: 'TRANSFER',
      timestamp: '2027-01-05T18:00:00Z',
      ownerIdentityKey: idKey(owner2Priv),
      actorIdentityKey: idKey(owner1Priv),
      actorKeyId: 'owner transfer 1',
      eventData: '',
      payloadOwnerHash: ownerBlobHash(BLOB_V2),
      previousTxid: tx1.id('hex'),
    }),
    new ProtoWallet(owner1Priv)
  )
  const tx2 = stateTx(s2, lockKey, { tx: tx1, outputIndex: 1 })
  txs.push(tx2); states.push(s2); outputIndexes.push(0)

  const s3 = await signedState(
    makeData({
      op: 'REPAIRED',
      timestamp: '2027-03-20T10:00:00Z',
      ownerIdentityKey: idKey(owner2Priv),
      actorIdentityKey: idKey(owner2Priv),
      actorKeyId: 'owner repair 1',
      eventData: JSON.stringify({ note: 'zipper replaced' }),
      payloadOwnerHash: ownerBlobHash(BLOB_V2),
      previousTxid: tx2.id('hex'),
    }),
    owner2Wallet
  )
  const tx3 = stateTx(s3, lockKey, { tx: tx2, outputIndex: 0 })
  txs.push(tx3); states.push(s3); outputIndexes.push(0)

  return { txs, states, outputIndexes }
}

/** ChainTracker accepting exactly the given height → merkle root map. */
export function mockTracker(roots: Record<number, string>): ChainTracker {
  return {
    isValidRootForHeight: async (root, height) => roots[height] === root,
    currentHeight: async () => 999999,
  }
}

/**
 * Attach a two-leaf merkle proof (tx at offset 1, so the coinbase maturity
 * rule never applies) and record its root as valid for the given height.
 */
export function attachProof(
  tx: Transaction,
  height: number,
  roots: Record<number, string>
): void {
  const txid = tx.id('hex')
  const sibling = 'ab'.repeat(32)
  const path = new MerklePath(height, [
    [
      { offset: 0, hash: sibling },
      { offset: 1, hash: txid, txid: true },
    ],
  ])
  roots[height] = path.computeRoot(txid)
  tx.merklePath = path
}
