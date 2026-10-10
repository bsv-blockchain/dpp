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
  index: { url?: string; submitToken?: string; callbackToken?: string }
  passportHost: string
  gs1Prefix: string
  registry: { url?: string; token?: string }
  livePublishing: boolean
  spendCapSatoshis: number
}

const text = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const value = env[name]?.trim()
  return value == null || value === '' ? undefined : value
}

/** Read the configuration from an environment. Missing secrets get development defaults that the README says to replace. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const network = (text(env, 'NETWORK') ?? 'main') as Network
  if (network !== 'main' && network !== 'test') throw new Error(`NETWORK must be main or test, not ${network}`)
  const livePublishing = text(env, 'LIVE_PUBLISHING') === 'true'
  const rootKeyHex = text(env, 'WALLET_ROOT_KEY')
  if (rootKeyHex != null && !/^[0-9a-fA-F]{64}$/.test(rootKeyHex)) throw new Error('WALLET_ROOT_KEY must be 64 hexadecimal characters')
  if (livePublishing && rootKeyHex == null) throw new Error('LIVE_PUBLISHING=true needs WALLET_ROOT_KEY')
  return {
    network,
    port: Number(text(env, 'PORT') ?? 3000),
    publicUrl: (text(env, 'PUBLIC_URL') ?? 'http://localhost:3000').replace(/\/+$/, ''),
    mongoUrl: text(env, 'MONGO_URL') ?? 'mongodb://127.0.0.1:27017',
    mongoDb: text(env, 'MONGO_DB') ?? 'dpp_app',
    authSecret: text(env, 'AUTH_SECRET') ?? 'development-only-secret-replace-me-before-deploying',
    wallet: {
      rootKeyHex,
      filePath: text(env, 'WALLET_FILE') ?? 'local/wallet.sqlite',
      wocApiKey: text(env, 'WOC_API_KEY'),
      arcUrl: text(env, 'ARC_URL'),
    },
    brandRootSecret: text(env, 'BRAND_ROOT_SECRET') ?? 'development-only-brand-secret-replace-me',
    managedIdentitySecret: text(env, 'MANAGED_IDENTITY_SECRET') ?? 'development-only-managed-identity-secret-replace-me',
    index: {
      url: text(env, 'INDEX_URL')?.replace(/\/+$/, ''),
      submitToken: text(env, 'INDEX_SUBMIT_TOKEN'),
      callbackToken: text(env, 'INDEX_CALLBACK_TOKEN'),
    },
    passportHost: text(env, 'PASSPORT_HOST') ?? 'localhost:3000',
    gs1Prefix: text(env, 'GS1_PREFIX') ?? '952',
    registry: { url: text(env, 'REGISTRY_URL')?.replace(/\/+$/, ''), token: text(env, 'REGISTRY_TOKEN') },
    livePublishing,
    spendCapSatoshis: Number(text(env, 'SPEND_CAP_SATOSHIS') ?? 20_000),
  }
}
