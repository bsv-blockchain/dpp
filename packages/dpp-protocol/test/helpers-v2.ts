import { Hash, LockingScript, OP, PrivateKey, ProtoWallet, PublicKey, Transaction, UnlockingScript, Utils, CachedKeyDeriver } from '@bsv/sdk'
import {
  acceptanceCommitment,
  buildLockingScript,
  canonicalJson,
  completeState,
  ownerBlobHash,
  ownerKeyFromDeriver,
  ownerLinkageFromDeriver,
  signManagedAcceptance,
  type DppState,
  type DppStateDataV2,
  type ManagedAcceptanceClaim,
  type ManagedAcceptanceRecord,
  type Outpoint,
} from '../src/index.js'
import { makerPriv, owner1Priv, owner2Priv, owner3Priv, serverPriv } from './helpers.js'

/**
 * The version 2 cast, on the same published test keys as version 1 so a reader
 * in any language holds five private keys and no more: the issuer's account
 * (`11`), the custodian who publishes and holds the lock (`22`), the recipient's
 * account (`33`), a stranger (`44`) and a named authority (`55`). Nothing derived
 * from them will ever hold a satoshi.
 *
 * Under managed custody every actor is an account whose identity key the
 * custodian derives (`spec/managed-custody.md` §2); the controller key of a
 * passport is that account's per-passport child under the owner protocol, so
 * the account proves control by linkage and the custodian's lock key is the
 * publisher's own. The fixtures lock every state to the custodian's identity
 * key for simplicity, which is a build's choice the record model does not see.
 */
export const issuerPriv = makerPriv
export const custodianPriv = serverPriv
export const recipientPriv = owner1Priv
export const strangerPriv = owner2Priv
export const authorityPriv = owner3Priv

export const issuerWallet = new ProtoWallet(issuerPriv)
export const custodianWallet = new ProtoWallet(custodianPriv)
export const recipientWallet = new ProtoWallet(recipientPriv)
export const strangerWallet = new ProtoWallet(strangerPriv)
export const authorityWallet = new ProtoWallet(authorityPriv)

export const idKey = (priv: PrivateKey): string => priv.toPublicKey().toString()

/** A demonstration identifier under GS1 prefix 952 at the deployment's own host (`docs/identifiers.md`). */
export const PASSPORT_ID_V2 = 'https://dpp.bsvb.net/01/09521000000018/21/V2-0001'
export const PAYLOAD_V2_1 = JSON.stringify({ name: 'Cell pack 40', chemistry: 'LFP', dataCarrier: 'V2-UID-0001' })
export const PAYLOAD_V2_2 = JSON.stringify({ name: 'Cell pack 40', chemistry: 'LFP', dataCarrier: 'V2-UID-0001', recycledContent: 12 })
export const BLOB_V2_1 = [10, 20, 30, 40]
export const BLOB_V2_2 = [50, 60, 70]

/** The controller key of an account for this passport, and the scalar that proves the account derived it. */
export function controllerKeyOf(priv: PrivateKey, passportId: string = PASSPORT_ID_V2): string {
  return ownerKeyFromDeriver(passportId, new CachedKeyDeriver(priv))
}
export function controlLinkageOf(priv: PrivateKey, passportId: string = PASSPORT_ID_V2): string {
  return ownerLinkageFromDeriver(passportId, new CachedKeyDeriver(priv))
}

/** A valid ISSUE genesis for the version 2 fixture passport; override per test. */
export function makeDataV2(overrides: Partial<DppStateDataV2> = {}): DppStateDataV2 {
  return {
    version: '2',
    passportId: PASSPORT_ID_V2,
    op: 'ISSUE',
    timestamp: '2026-09-06T09:00:00Z',
    ownerIdentityKey: controllerKeyOf(issuerPriv),
    actorIdentityKey: idKey(issuerPriv),
    actorKeyId: 'issuer batch 1',
    eventData: '',
    payloadPublic: PAYLOAD_V2_1,
    payloadOwnerHash: ownerBlobHash(BLOB_V2_1),
    previousTxid: '',
    previousOutputIndex: null,
    lineageGenesis: null,
    controlLinkage: '',
    authorisationCommitment: '',
    ...overrides,
  }
}

/** A version 2 state signed by the actor's wallet and countersigned by the custodian. */
export async function signedStateV2(d: DppStateDataV2, actor: ProtoWallet = issuerWallet, publisher: ProtoWallet = custodianWallet): Promise<DppState> {
  return await completeState(d, actor, publisher)
}

/** Wrap a state into a transaction, optionally spending the previous tip, optionally behind an OP_RETURN so the DPP output sits at index 1. */
export function stateTxV2(
  state: DppState,
  lockKey: PublicKey | string,
  prev?: { tx: Transaction; outputIndex: number },
  opReturnFirst = false
): Transaction {
  const tx = new Transaction()
  if (prev != null) {
    tx.addInput({ sourceTransaction: prev.tx, sourceOutputIndex: prev.outputIndex, unlockingScript: new UnlockingScript([]) })
  }
  if (opReturnFirst) {
    tx.addOutput({ satoshis: 0, lockingScript: new LockingScript([{ op: 0 }, { op: OP.OP_RETURN }]) })
  }
  tx.addOutput({ satoshis: 1, lockingScript: buildLockingScript(state, lockKey) })
  return tx
}

export const outpointOf = (tx: Transaction, outputIndex: number): Outpoint => ({ txid: tx.id('hex'), outputIndex })

/** SHA-256 hex of the canonical JSON of the terms an application presented; the acceptance record carries this. */
export function termsDigestOf(terms: unknown): string {
  return Utils.toHex(Hash.sha256(Utils.toArray(canonicalJson(terms), 'utf8')))
}

export const CLAIM_CODE = 'demo-claim-code-0001'
export const claimCodeRef = (): string => Utils.toHex(Hash.sha256(Utils.toArray(CLAIM_CODE, 'utf8')))

/** The custodian signing with its identity key, the same key that publishes. */
export const custodianSigner = { sign: (preimage: number[]) => custodianPriv.sign(preimage).toDER() as number[] }

/** The one acceptance record the fixture chain's TRANSFER commits to. */
export async function fixtureAcceptanceClaim(genesis: Outpoint, predecessor: Outpoint): Promise<ManagedAcceptanceClaim> {
  return {
    acceptanceFormat: 'dpp-managed-acceptance@1',
    requestId: 'offer-0001',
    passportId: PASSPORT_ID_V2,
    lineageGenesis: genesis,
    expectedPredecessor: predecessor,
    termsDigest: termsDigestOf({ word: 'Passed on' }),
    offer: {
      holderIdentityKey: idKey(issuerPriv),
      createdAt: '2026-09-08T09:00:00Z',
      expiresAt: '2026-09-15T09:00:00Z',
      mechanism: 'claim-code',
      recipientRef: claimCodeRef(),
    },
    acceptance: {
      recipientIdentityKey: idKey(recipientPriv),
      destinationKey: controllerKeyOf(recipientPriv),
      acceptedAt: '2026-09-08T10:00:00Z',
      evidenceKind: 'custodian-attested',
    },
    custodian: idKey(custodianPriv),
  }
}

export interface ChainV2Fixture {
  txs: Transaction[]
  states: DppState[]
  outputIndexes: number[]
  acceptance: ManagedAcceptanceRecord
}

/**
 * The version 2 lifecycle the fixture pins: ISSUE by the issuer, UPDATE by
 * the issuer proving control by linkage, TRANSFER to the recipient under the
 * managed-custody profile with the acceptance commitment and the DPP output
 * behind an OP_RETURN at index 1, UPDATE by the recipient acting under the
 * controller key itself (the equality form), and RETIRE by the recipient's
 * account proving control by linkage. Locked to the custodian throughout.
 */
export async function buildChainV2Fixture(): Promise<ChainV2Fixture> {
  const lockKey = custodianPriv.toPublicKey()
  const txs: Transaction[] = []
  const states: DppState[] = []
  const outputIndexes: number[] = []

  const s0 = await signedStateV2(makeDataV2())
  const tx0 = stateTxV2(s0, lockKey)
  txs.push(tx0); states.push(s0); outputIndexes.push(0)
  const genesis = outpointOf(tx0, 0)

  const s1 = await signedStateV2(
    makeDataV2({
      op: 'UPDATE',
      timestamp: '2026-09-07T09:00:00Z',
      actorKeyId: 'issuer batch 1',
      payloadPublic: PAYLOAD_V2_2,
      previousTxid: tx0.id('hex'),
      previousOutputIndex: 0,
      lineageGenesis: genesis,
      controlLinkage: controlLinkageOf(issuerPriv),
    })
  )
  const tx1 = stateTxV2(s1, lockKey, { tx: tx0, outputIndex: 0 })
  txs.push(tx1); states.push(s1); outputIndexes.push(0)

  const acceptance = await signManagedAcceptance(await fixtureAcceptanceClaim(genesis, outpointOf(tx1, 0)), custodianSigner)
  const s2 = await signedStateV2(
    makeDataV2({
      op: 'TRANSFER',
      timestamp: '2026-09-08T10:30:00Z',
      ownerIdentityKey: controllerKeyOf(recipientPriv),
      actorKeyId: 'issuer batch 1',
      eventData: JSON.stringify({ word: 'Passed on' }),
      payloadPublic: PAYLOAD_V2_2,
      payloadOwnerHash: ownerBlobHash(BLOB_V2_2),
      previousTxid: tx1.id('hex'),
      previousOutputIndex: 0,
      lineageGenesis: genesis,
      controlLinkage: controlLinkageOf(issuerPriv),
      authorisationCommitment: acceptanceCommitment(acceptance),
    })
  )
  const tx2 = stateTxV2(s2, lockKey, { tx: tx1, outputIndex: 0 }, true)
  txs.push(tx2); states.push(s2); outputIndexes.push(1)

  // The recipient acting under the controller key itself: equality, no linkage.
  const recipientControllerPriv = new CachedKeyDeriver(recipientPriv).derivePrivateKey([1, 'dpp owner v1'], PASSPORT_ID_V2, 'self')
  const s3 = await signedStateV2(
    makeDataV2({
      op: 'UPDATE',
      timestamp: '2026-10-01T08:00:00Z',
      ownerIdentityKey: controllerKeyOf(recipientPriv),
      actorIdentityKey: recipientControllerPriv.toPublicKey().toString(),
      actorKeyId: 'controller',
      eventData: JSON.stringify({ eventType: 'Transformation', note: 'cell balanced' }),
      payloadPublic: PAYLOAD_V2_2,
      payloadOwnerHash: ownerBlobHash(BLOB_V2_2),
      previousTxid: tx2.id('hex'),
      previousOutputIndex: 1,
      lineageGenesis: genesis,
      controlLinkage: '',
    }),
    new ProtoWallet(recipientControllerPriv)
  )
  const tx3 = stateTxV2(s3, lockKey, { tx: tx2, outputIndex: 1 })
  txs.push(tx3); states.push(s3); outputIndexes.push(0)

  const s4 = await signedStateV2(
    makeDataV2({
      op: 'RETIRE',
      timestamp: '2027-03-01T12:00:00Z',
      ownerIdentityKey: controllerKeyOf(recipientPriv),
      actorIdentityKey: idKey(recipientPriv),
      actorKeyId: 'recipient account',
      eventData: JSON.stringify({ reason: 'recycled', evidence: 'urn:sha256:' + 'ab'.repeat(32) }),
      payloadPublic: PAYLOAD_V2_2,
      payloadOwnerHash: ownerBlobHash(BLOB_V2_2),
      previousTxid: tx3.id('hex'),
      previousOutputIndex: 0,
      lineageGenesis: genesis,
      controlLinkage: controlLinkageOf(recipientPriv),
    }),
    recipientWallet
  )
  const tx4 = stateTxV2(s4, lockKey, { tx: tx3, outputIndex: 0 })
  txs.push(tx4); states.push(s4); outputIndexes.push(0)

  return { txs, states, outputIndexes, acceptance }
}
