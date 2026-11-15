// Everything the API, the worker, the CLI and the tests share, assembled
// once from the configuration: the store, the platform wallet, the managed
// parties, the index client, the writer, the reader's settings, custody and
// claims. In development with no INDEX_URL an index runs in this process.
import { MongoClient, type Db } from 'mongodb'
import type { ChainTracker } from '@bsv/sdk'
import { openBoundProfiles, type BoundProfiles } from './bound-profiles.js'
import { Claims } from './claims.js'
import type { Config } from './config.js'
import { Custody } from './custody.js'
import { startDevIndex, type DevIndex } from './dev-index.js'
import { IndexClient } from './index-client.js'
import { managedParties, type Parties, type Party } from './parties.js'
import { headerSource, readAuthorised, readPassport, type AuthorisedReading, type PassportReading } from './reader.js'
import { MemoryStore, MongoStore, type PassportRecord, type Store } from './store.js'
import { openTestWallet, openToolboxWallet, type PlatformWallet } from './wallet.js'
import { Writer } from './writer.js'

export interface Platform {
  config: Config
  store: Store
  db?: Db
  /** The index in this process, when the app has not joined one. */
  devIndex?: DevIndex
  wallet: PlatformWallet
  parties: Parties
  index: IndexClient
  writer: Writer
  custody: Custody
  claims: Claims
  chainTracker: ChainTracker | 'scripts only'
  /** The profiles held by a binding, the validation engine and anything refused at start-up. */
  profiles: BoundProfiles
  read(passportId: string): Promise<PassportReading>
  /** The holder's view of a passport under a bound profile: the owner-tier check, then the two parts rejoined and checked whole. */
  readAuthorised(record: PassportRecord, holder: Party): Promise<AuthorisedReading>
  close(): Promise<void>
}

export interface PlatformOptions {
  config: Config
  /** 'test' wires a memory store, a test wallet and an in-process index with nothing live. */
  mode: 'live' | 'test'
  log?: (line: string) => void
  /** How a validation library is loaded; a test passes one that fails, to stand in for libraries that are not installed. */
  loadEngineLibrary?: (name: string) => Promise<unknown>
}

/** How long a call waits for MongoDB to be reachable before it fails. It bounds start-up without a database, and every call made while the database is away. */
export const MONGO_SERVER_SELECTION_TIMEOUT_MS = 2_000

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
      client = new MongoClient(config.mongoUrl, { serverSelectionTimeoutMS: MONGO_SERVER_SELECTION_TIMEOUT_MS })
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

  // DPP_TEST_WALLET=1 is the scaffold check's switch: the test wallet on the
  // configured root key, so go-live registers the key .env holds without a
  // funded wallet. A user never sets it; live mode says so when it is set.
  const testWalletRequested = config.testWallet && config.wallet.rootKeyHex != null
  const wallet =
    mode === 'test' || config.wallet.rootKeyHex == null
      ? openTestWallet(undefined, config.network)
      : testWalletRequested
        ? openTestWallet(config.wallet.rootKeyHex, config.network)
        : await openToolboxWallet({ network: config.network, rootKeyHex: config.wallet.rootKeyHex, filePath: config.wallet.filePath, wocApiKey: config.wallet.wocApiKey, arcUrl: config.wallet.arcUrl })
  if (mode === 'live' && wallet.kind === 'test') {
    log(testWalletRequested ? 'DPP_TEST_WALLET=1: the test wallet stands in on the configured root key, with made-up funds; nothing can be written to the chain.' : 'WALLET_ROOT_KEY is not set: a test wallet with fixed keys stands in, and nothing can be written to the chain.')
  }

  let devIndex: DevIndex | undefined
  let index: IndexClient
  if (config.index.joined) {
    index = new IndexClient({ url: config.index.url!, submitToken: config.index.submitToken, callbackToken: config.index.callbackToken })
  } else {
    // An address with no tokens is an index this app has not joined yet: it
    // would answer 401 to every write. The in-process index stands in until
    // go-live registers the key and stores the tokens.
    devIndex = await startDevIndex({ publisherKey: wallet.identityKey, network: config.network })
    index = new IndexClient({ url: devIndex.url, submitToken: devIndex.submitToken, callbackToken: devIndex.callbackToken })
    if (mode === 'live') {
      log(
        config.index.url == null
          ? `INDEX_URL is not set: an index runs in this process at ${devIndex.url} with in-memory storage; it forgets everything on restart and claims no inclusion.`
          : `This app has not joined ${config.index.url} yet (no tokens): an index runs in this process at ${devIndex.url} with in-memory storage until npm run go-live registers the publisher key.`
      )
    }
  }

  // Built once: the engine the configuration chose, the bound profiles from the package's folder or from a bundle, and any folder the configuration trusts.
  const profiles = await openBoundProfiles({
    customProfileDirs: config.customProfiles.dirs,
    trustedBindingDigests: config.customProfiles.trustedBindingDigests,
    ...(config.profileBundleDir == null ? {} : { profileBundleDir: config.profileBundleDir }),
    validator: config.validator,
    ...(options.loadEngineLibrary == null ? {} : { loadEngineLibrary: options.loadEngineLibrary }),
    log,
  })

  const parties = managedParties({ brandRootSecret: config.brandRootSecret, managedIdentitySecret: config.managedIdentitySecret })
  const writer = new Writer({
    store,
    wallet,
    index,
    identifiers: { host: config.passportHost, prefix: config.gs1Prefix },
    bound: profiles,
    livePublishing: config.livePublishing,
    spendCapSatoshis: config.spendCapSatoshis,
    log,
  })
  const custody = new Custody({ store, wallet, parties, writer })
  const claims = new Claims({ store, registry: config.registry.url == null ? undefined : { url: config.registry.url, token: config.registry.token } })
  // Inclusion can only be checked against a header source; the in-process index and the test wallet mine nothing.
  const chainTracker: ChainTracker | 'scripts only' = wallet.kind === 'toolbox' && config.index.joined ? headerSource(config.network, config.wallet.wocApiKey) : 'scripts only'

  return {
    config,
    store,
    db,
    ...(devIndex == null ? {} : { devIndex }),
    wallet,
    parties,
    index,
    writer,
    custody,
    claims,
    chainTracker,
    profiles,
    async readAuthorised(record, holder) {
      return await readAuthorised({ record, holder, index, profiles })
    },
    async read(passportId) {
      // A passport this platform wrote: its brand is the genesis issuer the policy names, and its acceptance records are supplied. Another platform's passport is read with what the index holds, and authority stays unknown.
      const own = await store.getPassport(passportId)
      const genesisIssuers = own == null ? [] : [parties.brand(own.brandId).identityKey]
      return await readPassport(passportId, { index, chainTracker, acceptanceCustodians: [wallet.identityKey], genesisIssuers, profiles }, { acceptanceRecords: own?.acceptanceRecords ?? [] })
    },
    async close() {
      await wallet.close()
      await devIndex?.close()
      await client?.close()
    },
  }
}
