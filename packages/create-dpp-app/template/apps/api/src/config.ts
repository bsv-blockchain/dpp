// Configuration is environment only. Secrets are read here once and never
// printed. `npm test` and `npm run dev` work with the defaults; the values
// marked live in .env.example are needed only to write real passports.
import { SUPPORTED_VERSIONS } from '@bsv/dpp-protocol'
import { assertProductionRecordVersions } from './production-records.mjs'
import { loadEpcisSources, type EpcisSourceConfig } from './epcis/sources.js'

export type Network = 'main' | 'test'

/**
 * Where the EPCIS exchange keeps what it retains. `mongodb` is the adapter this application is built and tested on:
 * the application database, or memory when there is none. `file` is the module's file-system adapter over a folder.
 * It passes the same adapter suite and exists so that the storage can be replaced and a restore can be shown to land
 * in another adapter; it is not offered as a second production database.
 */
export type EpcisStorageChoice = { kind: 'mongodb' } | { kind: 'file'; dir: string }

export interface Config {
  network: Network
  port: number
  publicUrl: string
  mongoUrl: string
  mongoDb: string
  authSecret: string
  wallet: { rootKeyHex?: string; filePath: string; wocApiKey?: string; arcUrl?: string }
  brandRootSecret: string
  managedIdentitySecret: string
  /** `joined`: the address and both write tokens are set, so the app announces to this index; without tokens the index is one the app has not registered with yet (go-live). */
  index: { url?: string; submitToken?: string; callbackToken?: string; joined: boolean }
  passportHost: string
  gs1Prefix: string
  registry: { url?: string; token?: string }
  lifecycleAuthorityGrantsFile?: string
  /**
   * The index's evidence export, read when this application is exported: the bearer its complete export wants, when
   * it wants one, and the exporter identity key to hold its packages to. Without the key, the one its capability
   * document names is used and recorded.
   */
  indexExport: { token?: string; exporterKey?: string }
  /** Profiles held by a binding in a folder of your own, and the binding digests this deployment trusts for them. */
  customProfiles: { dirs: string[]; trustedBindingDigests: string[] }
  /**
   * Where bound profiles are resolved from. Unset, the packaged sector editions are read from the folder the profiles
   * package ships. Set, they are read from this folder, which holds a profile bundle as a restore installs it, and
   * the package's own folder is not read.
   */
  profileBundleDir?: string
  /**
   * The validation engine for profiles held by a binding. Without an address the JSON-LD and SHACL libraries run in
   * this process. With one, a validator service at that address is asked, and the token is sent to it and nowhere
   * else. The token is read here once and is never printed.
   */
  validator: { url?: string; token?: string }
  /**
   * EPCIS exchange: the folder the pinned GS1 files are provisioned into and read from, whether start-up may fetch
   * them, and the query sources a pull may be made from. A source's credential is read through a function and is
   * never a plain member of this object.
   */
  epcis: { gs1Dir: string; gs1Offline: boolean; sources: EpcisSourceConfig[]; storage: EpcisStorageChoice }
  livePublishing: boolean
  spendCapSatoshis: number
  /** DPP_TEST_WALLET=1: the scaffold check's switch for the test wallet on the configured root key. */
  testWallet: boolean
}

const text = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const value = env[name]?.trim()
  return value == null || value === '' ? undefined : value
}

/** The hosted indexes and the network each serves: go-live refuses a known host on the other network. */
export const KNOWN_INDEX_HOSTS: Record<string, Network> = {
  'dpp-overlay-testnet.bsvb.net': 'test',
  'dpp-overlay.bsvb.net': 'main',
}

/** A comma-separated setting as its entries, without the empty ones. */
const list = (env: NodeJS.ProcessEnv, name: string): string[] =>
  (text(env, name) ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')

const SECRETS = ['AUTH_SECRET', 'BRAND_ROOT_SECRET', 'MANAGED_IDENTITY_SECRET'] as const
const DEVELOPMENT_DEFAULTS: Record<(typeof SECRETS)[number], string> = {
  AUTH_SECRET: 'development-only-secret-replace-me-before-deploying',
  BRAND_ROOT_SECRET: 'development-only-brand-secret-replace-me',
  MANAGED_IDENTITY_SECRET: 'development-only-managed-identity-secret-replace-me',
}

/** A secret as set, or its development default when unset; a value copied from .env.example stops the start by name, and the value is never echoed. */
function secret(env: NodeJS.ProcessEnv, name: (typeof SECRETS)[number]): string {
  const value = text(env, name)
  if (value == null) return DEVELOPMENT_DEFAULTS[name]
  if (value === 'change-me-to-32-random-bytes-hex' || value.startsWith('development-only-')) {
    throw new Error(`${name} is a placeholder from .env.example: set it to 32 random bytes (openssl rand -hex 32), or scaffold the project again so one is generated`)
  }
  return value
}

/** Read the configuration from an environment. Missing secrets get development defaults that the README says to replace. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const network = (text(env, 'NETWORK') ?? 'main') as Network
  if (network !== 'main' && network !== 'test') throw new Error(`NETWORK must be main or test, not ${network}`)
  const livePublishing = text(env, 'LIVE_PUBLISHING') === 'true'
  if (livePublishing) assertProductionRecordVersions(SUPPORTED_VERSIONS)
  const rootKeyHex = text(env, 'WALLET_ROOT_KEY')
  if (rootKeyHex != null && !/^[0-9a-fA-F]{64}$/.test(rootKeyHex)) throw new Error('WALLET_ROOT_KEY must be 64 hexadecimal characters')
  if (livePublishing && rootKeyHex == null) throw new Error('LIVE_PUBLISHING=true needs WALLET_ROOT_KEY')
  const indexUrl = text(env, 'INDEX_URL')?.replace(/\/+$/, '')
  const submitToken = text(env, 'INDEX_SUBMIT_TOKEN')
  const callbackToken = text(env, 'INDEX_CALLBACK_TOKEN')
  const joined = indexUrl != null && submitToken != null && callbackToken != null
  // A real passport announced only to the in-process index would be on the chain and findable by nobody after a restart.
  if (livePublishing && indexUrl == null) throw new Error('LIVE_PUBLISHING=true needs INDEX_URL: connect an index that persists before writing to the chain (README, Connect an index)')
  if (livePublishing && !joined) throw new Error('LIVE_PUBLISHING=true needs the index tokens: run npm run go-live, which registers this app with the index and stores them')
  // Trust is the digest of exact bytes, so a value that is not a digest is a mistake to fix, never something to guess at.
  const trustedBindingDigests = list(env, 'TRUSTED_BINDING_DIGESTS')
  for (const digest of trustedBindingDigests) {
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error(`TRUSTED_BINDING_DIGESTS holds "${digest}", which is not a binding digest: each entry is the SHA-256 of a binding.json, 64 lower-case hexadecimal characters`)
  }
  const epcisStorage = text(env, 'EPCIS_STORAGE') ?? 'mongodb'
  if (epcisStorage !== 'mongodb' && epcisStorage !== 'file') throw new Error('EPCIS_STORAGE must be mongodb or file')
  // A mistake in the validator's address stops the start and is named. The value is not repeated: an address can carry a secret someone put there.
  const validatorUrl = text(env, 'VALIDATOR_URL')?.replace(/\/+$/, '')
  const validatorToken = text(env, 'VALIDATOR_TOKEN')
  if (validatorUrl != null) {
    let parsed: URL | undefined
    try {
      parsed = new URL(validatorUrl)
    } catch {
      // Reported below.
    }
    if (parsed == null || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) throw new Error('VALIDATOR_URL must be the http or https address of a validator service')
    if (parsed.username !== '' || parsed.password !== '') throw new Error('VALIDATOR_URL carries user information: set the service\'s token in VALIDATOR_TOKEN')
    if (parsed.search !== '' || parsed.hash !== '') throw new Error('VALIDATOR_URL carries a query or a fragment: give the address only')
  }
  if (validatorToken != null && validatorUrl == null) throw new Error('VALIDATOR_TOKEN is set without VALIDATOR_URL: the token belongs to a validator service, so name its address or remove the token')
  if (validatorToken != null && !/^[\x21-\x7e]+$/.test(validatorToken)) throw new Error('VALIDATOR_TOKEN must be visible ASCII with no spaces')
  const indexExporterKey = text(env, 'INDEX_EXPORTER_KEY')
  if (indexExporterKey != null && !/^0[23][0-9a-f]{64}$/.test(indexExporterKey)) throw new Error('INDEX_EXPORTER_KEY must be a compressed public key: 66 lower-case hexadecimal characters starting 02 or 03')
  return {
    network,
    port: Number(text(env, 'PORT') ?? 3000),
    publicUrl: (text(env, 'PUBLIC_URL') ?? 'http://localhost:3000').replace(/\/+$/, ''),
    mongoUrl: text(env, 'MONGO_URL') ?? 'mongodb://127.0.0.1:27017',
    mongoDb: text(env, 'MONGO_DB') ?? 'dpp_app',
    authSecret: secret(env, 'AUTH_SECRET'),
    wallet: {
      rootKeyHex,
      filePath: text(env, 'WALLET_FILE') ?? 'local/wallet.sqlite',
      wocApiKey: text(env, 'WOC_API_KEY'),
      arcUrl: text(env, 'ARC_URL'),
    },
    brandRootSecret: secret(env, 'BRAND_ROOT_SECRET'),
    managedIdentitySecret: secret(env, 'MANAGED_IDENTITY_SECRET'),
    index: { url: indexUrl, submitToken, callbackToken, joined },
    passportHost: text(env, 'PASSPORT_HOST') ?? 'localhost:3000',
    gs1Prefix: text(env, 'GS1_PREFIX') ?? '952',
    registry: { url: text(env, 'REGISTRY_URL')?.replace(/\/+$/, ''), token: text(env, 'REGISTRY_TOKEN') },
    lifecycleAuthorityGrantsFile: text(env, 'LIFECYCLE_AUTHORITY_GRANTS_FILE'),
    indexExport: { token: text(env, 'INDEX_EXPORT_TOKEN'), exporterKey: indexExporterKey },
    customProfiles: { dirs: list(env, 'CUSTOM_PROFILE_DIRS'), trustedBindingDigests },
    profileBundleDir: text(env, 'PROFILE_BUNDLE_DIR'),
    validator: { url: validatorUrl, token: validatorToken },
    epcis: {
      gs1Dir: text(env, 'DPP_GS1_ARTEFACTS_DIR') ?? 'local/gs1',
      gs1Offline: text(env, 'DPP_GS1_ARTEFACTS_OFFLINE') === 'true',
      sources: loadEpcisSources(env),
      storage: epcisStorage === 'file' ? { kind: 'file', dir: text(env, 'EPCIS_STORAGE_DIR') ?? 'local/epcis-store' } : { kind: 'mongodb' },
    },
    livePublishing,
    spendCapSatoshis: Number(text(env, 'SPEND_CAP_SATOSHIS') ?? 20_000),
    testWallet: text(env, 'DPP_TEST_WALLET') === '1',
  }
}
