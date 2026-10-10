// The platform wallet: a BRC-100 wallet the API owns, which countersigns
// every state as publisher, holds the lock on every passport, builds, signs
// and sends the transactions, and obtains their merkle proofs. Live it is
// @bsv/wallet-toolbox on a SQLite file with a root key from the environment;
// in tests it is a ProtoWallet with a fixed key and made-up funding, which
// is what makes the first run need no money.
//
// Funding needs nothing from the person paying: the wallet derives a BRC-29
// receive key for a random prefix and suffix with the "anyone" sender, hands
// out its address, and takes the payment in with internalizeAction.
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import {
  Beef,
  LockingScript,
  MerklePath,
  P2PKH,
  PrivateKey,
  ProtoWallet,
  PublicKey,
  PushDrop,
  Random,
  Transaction,
  UnlockingScript,
  Utils,
  type WalletInterface,
  type WalletProtocol,
} from '@bsv/sdk'
import { OWNER_PROTOCOL_ID, type AcceptanceSigner, type DataSigner } from '@bsv/dpp-core'
import type { Network } from './config.js'

export interface Tip {
  tx: Transaction
  txid: string
  outputIndex: number
  beef: number[]
}

export interface Built {
  tx: Transaction
  txid: string
  beef: number[]
  /** The wallet's reference for an unsent action, needed to abort it; an issue that needed no signature has none. */
  reference?: string
}

/**
 * The wallet side of a write: build a state's transaction unsent, send it
 * and report only the network's answer, abort an unsent one, and read a
 * mined transaction's merkle path. Its shape is the same live and in tests,
 * so everything after the build is one code path.
 */
export interface WriterAdapter {
  build(args: { lockingScript: LockingScript; tip?: Tip; passportId: string }): Promise<Built>
  send(built: Built): Promise<'accepted' | 'refused' | 'unanswered'>
  discard(built: Built): Promise<void>
  merklePathFor(txid: string): Promise<MerklePath | undefined>
}

/** The slice of the platform wallet the packages call: publisher signature and the lock key. */
export type PublisherWallet = DataSigner & {
  getPublicKey: ProtoWallet['getPublicKey']
}

export interface FundingAddress {
  address: string
  derivationPrefix: string
  derivationSuffix: string
  senderIdentityKey: string
}

export interface PlatformWallet {
  kind: 'toolbox' | 'test'
  network: Network
  identityKey: string
  publisher: PublisherWallet
  /** Signs acceptance records with the identity key itself, which no BRC-100 call provides. */
  acceptanceSigner: AcceptanceSigner
  adapter: WriterAdapter
  fundingAddress(): Promise<FundingAddress>
  /** Take in a payment made to a funding address, by its transaction id, once it is on the network. */
  internalize(funding: FundingAddress, txid: string): Promise<{ satoshis: number }>
  balance(): Promise<number>
  close(): Promise<void>
}

const BRC29_PROTOCOL: WalletProtocol = [2, '3241645161d8']
/** The "anyone" key: the sender of a payment that needs no key from the payer. */
export const ANYONE_IDENTITY_KEY = new PrivateKey(1).toPublicKey().toString()

function pathContains(path: MerklePath, txid: string): boolean {
  try {
    path.computeRoot(txid)
    return true
  } catch {
    return false
  }
}

// ------------------------------------------------------------- the toolbox wallet

export interface ToolboxWalletOptions {
  network: Network
  rootKeyHex: string
  filePath: string
  wocApiKey?: string
  arcUrl?: string
}

export async function openToolboxWallet(options: ToolboxWalletOptions): Promise<PlatformWallet> {
  // CommonJS, loaded once here: the toolbox carries its own copy of the SDK,
  // so its objects cross into this module as bytes and hex, never as instances.
  const toolbox = await import('@bsv/wallet-toolbox')
  const { Monitor, Services, Setup, StorageKnex, Wallet, WalletStorageManager } = toolbox
  // The toolbox loads the SDK's CommonJS build; its key deriver must come from that same copy.
  const sdkCjs = createRequire(import.meta.url)('@bsv/sdk') as typeof import('@bsv/sdk')
  const chain = options.network
  const rootKey = PrivateKey.fromHex(options.rootKeyHex)
  const identityKey = rootKey.toPublicKey().toString()

  mkdirSync(dirname(options.filePath), { recursive: true })
  const knex = Setup.createSQLiteKnex(options.filePath)
  const storage = new StorageKnex({
    chain,
    knex,
    commissionSatoshis: 0,
    commissionPubKeyHex: undefined,
    feeModel: { model: 'sat/kb', value: 100 },
  })
  await storage.migrate('platform_wallet', Utils.toHex(Random(33)))
  await storage.makeAvailable()
  const manager = new WalletStorageManager(identityKey, storage)
  await manager.makeAvailable()

  const serviceOptions = Services.createDefaultOptions(chain)
  if (options.wocApiKey != null) serviceOptions.whatsOnChainApiKey = options.wocApiKey
  if (options.arcUrl != null) serviceOptions.arcUrl = options.arcUrl
  const services = new Services(serviceOptions)
  const monitor = new Monitor(Monitor.createDefaultWalletMonitorOptions(chain, manager, services))
  const keyDeriver = new sdkCjs.CachedKeyDeriver(sdkCjs.PrivateKey.fromHex(options.rootKeyHex))
  const wallet = new Wallet({ chain, keyDeriver: keyDeriver as unknown as ConstructorParameters<typeof Wallet>[0]['keyDeriver'], storage: manager, services, monitor })
  await storage.findOrInsertUser(identityKey)
  // The monitor asks a header source for proofs once a block is a minute old and attaches them to the wallet's transactions.
  void monitor.startTasks()

  const brc100 = wallet as unknown as WalletInterface

  const adapter: WriterAdapter = {
    async build({ lockingScript, tip, passportId }) {
      const output = {
        lockingScript: lockingScript.toHex(),
        satoshis: 1,
        outputDescription: 'dpp passport state',
        basket: 'dpp',
        customInstructions: JSON.stringify({ passportId }),
      }
      const actionOptions = { noSend: true, randomizeOutputs: false, acceptDelayedBroadcast: false }
      if (tip == null) {
        // The genesis needs no signature from this application: the wallet returns it signed, with no reference.
        const created = await brc100.createAction({ description: 'dpp issue', outputs: [output], options: actionOptions })
        if (created.tx == null || created.txid == null) {
          if (created.signableTransaction?.reference != null) await brc100.abortAction({ reference: created.signableTransaction.reference }).catch(() => undefined)
          throw new Error('the wallet did not return a signed transaction')
        }
        return { tx: Transaction.fromAtomicBEEF(created.tx), txid: created.txid, beef: Array.from(created.tx) }
      }
      // Every later state spends the tip, whose lock only this wallet can open.
      const created = await brc100.createAction({
        description: 'dpp state',
        inputBEEF: tip.beef,
        inputs: [{ outpoint: `${tip.txid}.${tip.outputIndex}`, unlockingScriptLength: 73, inputDescription: 'dpp passport tip' }],
        outputs: [output],
        options: actionOptions,
      })
      const signable = created.signableTransaction
      if (signable == null) throw new Error('the wallet did not return a transaction to sign')
      try {
        const unsigned = Transaction.fromAtomicBEEF(signable.tx)
        const at = unsigned.inputs.findIndex((input) => (input.sourceTXID ?? input.sourceTransaction?.id('hex')) === tip.txid && input.sourceOutputIndex === tip.outputIndex)
        if (at === -1) throw new Error('the wallet built a transaction that does not spend the tip')
        const unlockingScript = await new PushDrop(brc100).unlock(OWNER_PROTOCOL_ID, passportId, 'self').sign(unsigned, at)
        const signed = await brc100.signAction({ reference: signable.reference, spends: { [at]: { unlockingScript: unlockingScript.toHex() } }, options: { noSend: true } })
        if (signed.tx == null || signed.txid == null) throw new Error('the wallet did not return a signed transaction')
        return { tx: Transaction.fromAtomicBEEF(signed.tx), txid: signed.txid, beef: Array.from(signed.tx), reference: signable.reference }
      } catch (cause) {
        // The action already holds the wallet's inputs: give them back before stopping.
        await brc100.abortAction({ reference: signable.reference }).catch(() => undefined)
        throw cause
      }
    },
    async send(built) {
      // Sections 4 and 5: a send-only action, reporting nothing but the network's answer.
      let result
      try {
        result = await brc100.createAction({ description: 'dpp send', options: { sendWith: [built.txid], acceptDelayedBroadcast: false } })
      } catch (cause) {
        const reviews = ((cause as { reviewActionResults?: Array<{ txid: string; status: string }> })?.reviewActionResults ?? [])
        return reviews.some((r) => r.txid === built.txid && r.status === 'invalidTx') ? 'refused' : 'unanswered'
      }
      const status = result.sendWithResults?.find((r) => r.txid === built.txid)?.status
      if (status === 'unproven') return 'accepted'
      if (status === 'failed') return 'refused'
      return 'unanswered'
    },
    async discard(built) {
      // An unsent action holds the wallet's inputs until it is sent or aborted; an issue without a reference is found by its txid.
      await brc100.abortAction({ reference: built.reference ?? built.txid }).catch(() => undefined)
    },
    async merklePathFor(txid) {
      // The wallet attaches the proof as part of being a wallet, but can list a transaction only while its output is unspent.
      const outputs = await brc100.listOutputs({ basket: 'dpp', include: 'entire transactions', limit: 10000 })
      if (outputs.BEEF != null) {
        const beef = Beef.fromBinary(outputs.BEEF)
        const held = beef.findTxid(txid)
        const path = held?.bumpIndex == null ? held?.tx?.merklePath : beef.bumps[held.bumpIndex]
        if (path != null && pathContains(path, txid)) return path
      }
      // Once spent, ask the services directly.
      try {
        const found = await services.getMerklePath(txid)
        if (found.merklePath != null) {
          const path = MerklePath.fromHex(found.merklePath.toHex())
          if (pathContains(path, txid)) return path
        }
      } catch {
        // No proof yet, or no header source: the worker asks again later.
      }
      return undefined
    },
  }

  return {
    kind: 'toolbox',
    network: chain,
    identityKey,
    publisher: brc100 as unknown as PublisherWallet,
    acceptanceSigner: { sign: (preimage) => rootKey.sign(preimage).toDER() as number[] },
    adapter,
    async fundingAddress() {
      const derivationPrefix = Utils.toBase64(Random(8))
      const derivationSuffix = Utils.toBase64(Random(8))
      const { publicKey } = await brc100.getPublicKey({ protocolID: BRC29_PROTOCOL, keyID: `${derivationPrefix} ${derivationSuffix}`, counterparty: ANYONE_IDENTITY_KEY, forSelf: true })
      return { address: PublicKey.fromString(publicKey).toAddress(chain === 'test' ? 'testnet' : 'mainnet'), derivationPrefix, derivationSuffix, senderIdentityKey: ANYONE_IDENTITY_KEY }
    },
    async internalize(funding, txid) {
      const beef = await services.getBeefForTxid(txid)
      const tx = Transaction.fromHex(Utils.toHex(beef.findTxid(txid)?.tx?.toBinary() ?? []))
      const wanted = new P2PKH().lock(funding.address).toHex()
      const outputs = tx.outputs.map((o, outputIndex) => ({ o, outputIndex })).filter(({ o }) => o.lockingScript.toHex() === wanted)
      if (outputs.length === 0) throw new Error(`${txid} pays nothing to ${funding.address}`)
      await brc100.internalizeAction({
        tx: beef.toBinaryAtomic(txid),
        outputs: outputs.map(({ outputIndex }) => ({
          outputIndex,
          protocol: 'wallet payment',
          paymentRemittance: { derivationPrefix: funding.derivationPrefix, derivationSuffix: funding.derivationSuffix, senderIdentityKey: funding.senderIdentityKey },
        })),
        description: 'Funding the platform wallet',
      })
      return { satoshis: outputs.reduce((sum, { o }) => sum + (o.satoshis ?? 0), 0) }
    },
    async balance() {
      const { outputs } = await brc100.listOutputs({ basket: 'default', limit: 10000 })
      return outputs.filter((o) => o.spendable).reduce((sum, o) => sum + o.satoshis, 0)
    },
    async close() {
      monitor.stopTasks()
      await wallet.destroy()
    },
  }
}

// ---------------------------------------------------------------- the test wallet

const ANYONE_CAN_SPEND = new LockingScript([{ op: 0x51 }])

/** A funding output with a made-up proof, standing in for coins a wallet would hold. Anyone can spend it, which is why it is never used live. */
function syntheticFunding(): Transaction {
  const tx = new Transaction()
  tx.addOutput({ satoshis: 10_000, lockingScript: ANYONE_CAN_SPEND })
  tx.merklePath = MerklePath.fromCoinbaseTxidAndHeight(tx.id('hex'), 800_000)
  return tx
}

/**
 * A wallet for tests and dry runs: fixed keys, synthetic funding, transactions
 * built here the way a wallet would fund them, and made-up proofs that only
 * an index with its header checks off would take. Nothing is sent anywhere.
 */
export function openTestWallet(rootKeyHex = '11'.repeat(32), network: Network = 'main'): PlatformWallet {
  const rootKey = PrivateKey.fromHex(rootKeyHex)
  const wallet = new ProtoWallet(rootKey)
  const identityKey = rootKey.toPublicKey().toString()
  let proofHeight = 800_001
  const proofs = new Map<string, MerklePath>()
  let funded = 10_000

  const adapter: WriterAdapter = {
    async build({ lockingScript, tip, passportId }) {
      const tx = new Transaction()
      if (tip == null) {
        tx.addInput({ sourceTransaction: syntheticFunding(), sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
        tx.addOutput({ satoshis: 1, lockingScript })
        tx.addOutput({ satoshis: 9_000, lockingScript: ANYONE_CAN_SPEND })
      } else {
        // The tip, then its change, the way a wallet funds the next state; the passport output stays first.
        tx.addInput({ sourceTransaction: tip.tx, sourceOutputIndex: tip.outputIndex, unlockingScript: new UnlockingScript([]) })
        tx.addInput({ sourceTransaction: tip.tx, sourceOutputIndex: 1, unlockingScript: new UnlockingScript([]) })
        tx.addOutput({ satoshis: 1, lockingScript })
        tx.addOutput({ satoshis: Math.max(1_000, (tip.tx.outputs[1]?.satoshis ?? 9_000) - 1_000), lockingScript: ANYONE_CAN_SPEND })
        tx.inputs[0].unlockingScript = await new PushDrop(wallet as unknown as WalletInterface).unlock(OWNER_PROTOCOL_ID, passportId, 'self').sign(tx, 0)
      }
      return { tx, txid: tx.id('hex'), beef: tx.toAtomicBEEF(), reference: tip == null ? undefined : 'test-reference' }
    },
    async send(built) {
      funded -= 200
      proofs.set(built.txid, MerklePath.fromCoinbaseTxidAndHeight(built.txid, proofHeight++))
      return 'accepted'
    },
    async discard() {},
    async merklePathFor(txid) {
      return proofs.get(txid)
    },
  }

  return {
    kind: 'test',
    network,
    identityKey,
    publisher: wallet,
    acceptanceSigner: { sign: (preimage) => rootKey.sign(preimage).toDER() as number[] },
    adapter,
    async fundingAddress() {
      return { address: rootKey.toPublicKey().toAddress(network === 'test' ? 'testnet' : 'mainnet'), derivationPrefix: 'test', derivationSuffix: 'test', senderIdentityKey: ANYONE_IDENTITY_KEY }
    },
    async internalize() {
      funded += 10_000
      return { satoshis: 10_000 }
    },
    async balance() {
      return funded
    },
    async close() {},
  }
}
