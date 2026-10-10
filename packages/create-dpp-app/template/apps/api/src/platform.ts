// Everything the API, the worker, the CLI and the tests share, assembled
// once from the configuration: the store, the platform wallet, the managed
// parties, the index client, the writer, the reader's settings, custody and
// claims. In development with no INDEX_URL an index runs in this process.
import { MongoClient, type Db } from 'mongodb'
import type { ChainTracker } from '@bsv/sdk'
import { Claims } from './claims.js'
import type { Config } from './config.js'
import { Custody } from './custody.js'
import { startDevIndex, type DevIndex } from './dev-index.js'
import { IndexClient } from './index-client.js'
import { managedParties, type Parties } from './parties.js'
import { headerSource, readPassport, type PassportReading } from './reader.js'
import { MemoryStore, MongoStore, type Store } from './store.js'
import { openTestWallet, openToolboxWallet, type PlatformWallet } from './wallet.js'
import { Writer } from './writer.js'

export interface Platform {
  config: Config
  store: Store
  db?: Db
  wallet: PlatformWallet
  parties: Parties
  index: IndexClient
  writer: Writer
  custody: Custody
  claims: Claims
  chainTracker: ChainTracker | 'scripts only'
  read(passportId: string): Promise<PassportReading>
  close(): Promise<void>
}

export interface PlatformOptions {
  config: Config
  /** 'test' wires a memory store, a test wallet and an in-process index with nothing live. */
  mode: 'live' | 'test'
  log?: (line: string) => void
}

export async function openPlatform(options: PlatformOptions): Promise<Platform> {
  const { config, mode } = options
  const log = options.log ?? ((line: string) => console.log(line))

  let client: MongoClient | undefined
  let db: Db | undefined
  let store: Store
  if (mode === 'test') {
    store = new MemoryStore()
  } else {
    // MongoDB holds the records, the journal and sign-in. Without one, development
    // runs on memory: everything is forgotten on restart and sign-in is unavailable.
    try {
      client = new MongoClient(config.mongoUrl, { serverSelectionTimeoutMS: 2_000 })
      await client.connect()
      db = client.db(config.mongoDb)
      const mongo = new MongoStore(db)
      await mongo.init()
      store = mongo
    } catch (cause) {
      await client?.close().catch(() => undefined)
      client = undefined
      log(`MongoDB at ${config.mongoUrl} is not reachable (${cause instanceof Error ? cause.message : String(cause)}): records live in memory for this run, and sign-in is off.`)
      store = new MemoryStore()
    }
  }

  const wallet =
    mode === 'test' || config.wallet.rootKeyHex == null
      ? openTestWallet(undefined, config.network)
      : await openToolboxWallet({ network: config.network, rootKeyHex: config.wallet.rootKeyHex, filePath: config.wallet.filePath, wocApiKey: config.wallet.wocApiKey, arcUrl: config.wallet.arcUrl })
  if (mode === 'live' && wallet.kind === 'test') log('WALLET_ROOT_KEY is not set: a test wallet with fixed keys stands in, and nothing can be written to the chain.')

  let devIndex: DevIndex | undefined
  let index: IndexClient
  if (config.index.url != null) {
    index = new IndexClient({ url: config.index.url, submitToken: config.index.submitToken, callbackToken: config.index.callbackToken })
  } else {
    devIndex = await startDevIndex(wallet.identityKey)
    index = new IndexClient({ url: devIndex.url, submitToken: devIndex.submitToken, callbackToken: devIndex.callbackToken })
    if (mode === 'live') log(`INDEX_URL is not set: an index runs in this process at ${devIndex.url} with in-memory storage; it forgets everything on restart and claims no inclusion.`)
  }

  const parties = managedParties({ brandRootSecret: config.brandRootSecret, managedIdentitySecret: config.managedIdentitySecret })
  const writer = new Writer({
    store,
    wallet,
    index,
    identifiers: { host: config.passportHost, prefix: config.gs1Prefix },
    livePublishing: config.livePublishing,
    spendCapSatoshis: config.spendCapSatoshis,
    log,
  })
  const custody = new Custody({ store, wallet, parties, writer })
  const claims = new Claims({ store, registry: config.registry.url == null ? undefined : { url: config.registry.url, token: config.registry.token } })
  // Inclusion can only be checked against a header source; the in-process index and the test wallet mine nothing.
  const chainTracker: ChainTracker | 'scripts only' = wallet.kind === 'toolbox' && config.index.url != null ? headerSource(config.network, config.wallet.wocApiKey) : 'scripts only'

  return {
    config,
    store,
    db,
    wallet,
    parties,
    index,
    writer,
    custody,
    claims,
    chainTracker,
    async read(passportId) {
      // A passport this platform wrote: its brand is the genesis issuer the policy names, and its acceptance records are supplied. Another platform's passport is read with what the index holds, and authority stays unknown.
      const own = await store.getPassport(passportId)
      const genesisIssuers = own == null ? [] : [parties.brand(own.brandId).identityKey]
      return await readPassport(passportId, { index, chainTracker, acceptanceCustodians: [wallet.identityKey], genesisIssuers }, { acceptanceRecords: own?.acceptanceRecords ?? [] })
    },
    async close() {
      await wallet.close()
      await devIndex?.close()
      await client?.close()
    },
  }
}
