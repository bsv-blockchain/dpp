// Configuration is environment only. Secrets are read here once and never
// printed. `npm test` and `npm run dev` work with the defaults; the values
// marked live in .env.example are needed only to write real passports.

export type Network = 'main' | 'test'

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
    livePublishing,
    spendCapSatoshis: Number(text(env, 'SPEND_CAP_SATOSHIS') ?? 20_000),
    testWallet: text(env, 'DPP_TEST_WALLET') === '1',
  }
}
