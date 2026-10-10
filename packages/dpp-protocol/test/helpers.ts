import {
  CachedKeyDeriver,
  LockingScript,
  MerklePath,
  OP,
  PrivateKey,
  ProtoWallet,
  PublicKey,
  PushDrop,
  Transaction,
  UnlockingScript,
  type ChainTracker,
  type WalletInterface,
} from '@bsv/sdk'
import {
  OWNER_PROTOCOL_ID,
  buildLockingScript,
  completeState,
  ownerBlobHash,
  ownerKeyFor,
  ownerLinkageFromDeriver,
  type DppState,
  type DppStateData,
} from '../src/index.js'

export const makerPriv = PrivateKey.fromHex('11'.repeat(32))
export const serverPriv = PrivateKey.fromHex('22'.repeat(32))
export const owner1Priv = PrivateKey.fromHex('33'.repeat(32))
export const owner2Priv = PrivateKey.fromHex('44'.repeat(32))
/**
 * The third owner, whose passport is the first the fixture locks to an owner key
 * (`spec/custody.md` §3). `55` also appears in signatures.test.ts as a throwaway
 * wrong key; nothing there pins it, and nothing derived from it will ever hold a
 * satoshi.
 */
export const owner3Priv = PrivateKey.fromHex('55'.repeat(32))

export const makerWallet = new ProtoWallet(makerPriv)
export const serverWallet = new ProtoWallet(serverPriv)
export const owner1Wallet = new ProtoWallet(owner1Priv)
export const owner2Wallet = new ProtoWallet(owner2Priv)
export const owner3Wallet = new ProtoWallet(owner3Priv)
export const owner1Deriver = new CachedKeyDeriver(owner1Priv)
export const owner3Deriver = new CachedKeyDeriver(owner3Priv)

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

/**
 * The owner's wallet spends a tip locked to its owner key with one derivation and
 * no key export: the PushDrop unlock under OWNER_PROTOCOL_ID, keyID passport_id,
 * counterparty 'self' (`spec/custody.md` §3). A ProtoWallet is not a full
 * WalletInterface, but `unlock().sign` only calls createSignature, and RFC 6979
 * nonces make the unlocking script reproducible byte for byte. Call it after the
 * outputs are added: the sighash commits to them.
 */
export async function spendAsOwner(
  tx: Transaction,
  inputIndex: number,
  wallet: ProtoWallet,
  passportId: string = PASSPORT_ID
): Promise<void> {
  const unlock = new PushDrop(wallet as unknown as WalletInterface).unlock(
    OWNER_PROTOCOL_ID,
    passportId,
    'self'
  )
  tx.inputs[inputIndex].unlockingScript = await unlock.sign(tx, inputIndex)
}

/**
 * The demo lifecycle plus the two states `spec/custody.md` §3 and §4 pin: a
 * TRANSFER by owner 2 (equality form) to owner 3's derived owner key, locked to
 * that key, then a TRANSFER by owner 3 carrying owner_linkage (linkage form) to
 * owner 1's derived owner key, spent by owner 3's wallet under the possession
 * convention. States 1 to 4 are exactly buildChainFixture's.
 */
export async function buildOwnerConsentFixture(): Promise<ChainFixture> {
  const { txs, states, outputIndexes } = await buildChainFixture()
  const tx3 = txs[3]
  const owner3OwnerKey = await ownerKeyFor(PASSPORT_ID, owner3Wallet)
  const owner1OwnerKey = await ownerKeyFor(PASSPORT_ID, owner1Wallet)

  const s4 = await signedState(
    makeData({
      op: 'TRANSFER',
      timestamp: '2027-06-01T09:00:00Z',
      ownerIdentityKey: owner3OwnerKey,
      actorIdentityKey: idKey(owner2Priv),
      actorKeyId: 'owner transfer 2',
      eventData: '',
      payloadOwnerHash: ownerBlobHash(BLOB_V2),
      previousTxid: tx3.id('hex'),
    }),
    owner2Wallet
  )
  const tx4 = stateTx(s4, PublicKey.fromString(owner3OwnerKey), { tx: tx3, outputIndex: 0 })
  txs.push(tx4); states.push(s4); outputIndexes.push(0)

  const s5 = await signedState(
    makeData({
      op: 'TRANSFER',
      timestamp: '2027-09-15T14:30:00Z',
      ownerIdentityKey: owner1OwnerKey,
      actorIdentityKey: idKey(owner3Priv),
      actorKeyId: 'owner transfer 3',
      eventData: JSON.stringify({ owner_linkage: ownerLinkageFromDeriver(PASSPORT_ID, owner3Deriver) }),
      payloadOwnerHash: ownerBlobHash(BLOB_V2),
      previousTxid: tx4.id('hex'),
    }),
    owner3Wallet
  )
  const tx5 = stateTx(s5, PublicKey.fromString(owner1OwnerKey), { tx: tx4, outputIndex: 0 })
  await spendAsOwner(tx5, 0, owner3Wallet)
  txs.push(tx5); states.push(s5); outputIndexes.push(0)

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
