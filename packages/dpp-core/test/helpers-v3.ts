import { LockingScript, OP, ProtoWallet, PublicKey, Transaction, UnlockingScript, type ScriptChunk } from '@bsv/sdk'
import {
  buildLockingScript,
  carrierPrefixChunks,
  completeState,
  ownerBlobHash,
  type CarrierPrefix,
  type DppState,
  type DppStateDataV3,
  type Outpoint,
} from '../src/index.js'
import { controlLinkageOf, controllerKeyOf, custodianPriv, custodianWallet, idKey, issuerPriv, issuerWallet } from './helpers-v2.js'

/**
 * The version 3 cast is the version 2 cast on the same published test keys:
 * `11` issuer, `22` custodian and publisher (also the lock on every state, a
 * build's choice the record model does not see), `33` recipient, `44`
 * stranger. Nothing derived from them will ever hold a satoshi. The passport
 * identifier is under GS1 prefix 952 at the deployment's own host.
 */
export const PASSPORT_ID_V3 = 'https://dpp.bsvb.net/01/09521000000018/21/V3-0001'
export const PAYLOAD_V3_1 = JSON.stringify({ name: 'Cell pack 40', chemistry: 'LFP', dataCarrier: 'V3-UID-0001' })
export const PAYLOAD_V3_2 = JSON.stringify({ name: 'Cell pack 40', chemistry: 'LFP', dataCarrier: 'V3-UID-0001', recycledContent: 12 })
export const BLOB_V3_1 = [10, 20, 30, 40]
export const BLOB_V3_2 = [50, 60, 70]

export const controllerKeyV3 = (priv: Parameters<typeof controllerKeyOf>[0]): string => controllerKeyOf(priv, PASSPORT_ID_V3)
export const controlLinkageV3 = (priv: Parameters<typeof controlLinkageOf>[0]): string => controlLinkageOf(priv, PASSPORT_ID_V3)

/** A valid ISSUE genesis for the version 3 fixture passport; override per test. */
export function makeDataV3(overrides: Partial<DppStateDataV3> = {}): DppStateDataV3 {
  return {
    version: '3',
    passportId: PASSPORT_ID_V3,
    op: 'ISSUE',
    timestamp: '2026-10-09T09:00:00Z',
    ownerIdentityKey: controllerKeyV3(issuerPriv),
    actorIdentityKey: idKey(issuerPriv),
    actorKeyId: 'issuer batch 1',
    eventData: '',
    payloadPublic: PAYLOAD_V3_1,
    payloadOwnerHash: ownerBlobHash(BLOB_V3_1),
    previousTxid: '',
    previousOutputIndex: null,
    lineageGenesis: null,
    controlLinkage: '',
    authorisationCommitment: '',
    ...overrides,
  }
}

/** A version 3 state signed by the actor's wallet and countersigned by the custodian. */
export async function signedStateV3(d: DppStateDataV3, actor: ProtoWallet = issuerWallet, publisher: ProtoWallet = custodianWallet): Promise<DppState> {
  return await completeState(d, actor, publisher)
}

/**
 * Wrap a carried state into a transaction: the prefix is derived from the
 * state unless `carrier` names one (a fixture does, to pin a refusal), the
 * previous tip is spent when given, and an OP_RETURN may sit first so the
 * carrier output lands at index 1.
 */
export function stateTxV3(
  state: DppState,
  lockKey: PublicKey | string,
  prev?: { tx: Transaction; outputIndex: number },
  options: { opReturnFirst?: boolean; carrier?: CarrierPrefix; editPrefix?: (chunks: ScriptChunk[]) => ScriptChunk[] } = {}
): Transaction {
  const tx = new Transaction()
  if (prev != null) {
    tx.addInput({ sourceTransaction: prev.tx, sourceOutputIndex: prev.outputIndex, unlockingScript: new UnlockingScript([]) })
  }
  if (options.opReturnFirst === true) {
    tx.addOutput({ satoshis: 0, lockingScript: new LockingScript([{ op: 0 }, { op: OP.OP_RETURN }]) })
  }
  let script = buildLockingScript(state, lockKey, options.carrier)
  if (options.editPrefix != null) script = new LockingScript(options.editPrefix(script.chunks.map((c) => ({ ...c }))))
  tx.addOutput({ satoshis: 1, lockingScript: script })
  return tx
}

export const outpointOfV3 = (tx: Transaction, outputIndex: number): Outpoint => ({ txid: tx.id('hex'), outputIndex })

/** The prefix chunks a value output of the given lineage carries, for a fixture that edits a prefix by hand. */
export const valuePrefixOf = (genesisTxid: string): ScriptChunk[] => carrierPrefixChunks({ role: 'value', tokenId: genesisTxid })

export { custodianPriv, issuerPriv }
