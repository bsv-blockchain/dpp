/**
 * `dpp-index tokens issue|revoke|list`: the operator's side of the
 * per-publisher tokens (`publisherTokens.ts`). The commands open the store the
 * environment selects, do one thing and exit; the index itself is not started.
 * `issue` prints the plain token alone on stdout, once, so a script can
 * capture it; everything else goes to stderr or is a table.
 */
import { MongoClient } from 'mongodb'
import { issueToken, tokenStoreFromEnvironment, TOKEN_USES, type PublisherTokenStore, type TokenUse } from './publisherTokens.js'

export interface TokensCommandValues {
  publisher?: string
  use?: string
  label?: string
  sha256?: string
}

/** The store the environment names, with the connection to close afterwards. */
export async function openTokenStore(env: Record<string, string | undefined>): Promise<{ store: PublisherTokenStore; source: string; close: () => Promise<void> }> {
  const file = (env.PUBLISHER_TOKENS_FILE ?? '').trim()
  if (file !== '') return { store: tokenStoreFromEnvironment(env, undefined), source: `PUBLISHER_TOKENS_FILE ${file}`, close: async () => {} }
  const mongoUrl = (env.MONGO_URL ?? '').trim()
  if (mongoUrl === '') throw new Error('set PUBLISHER_TOKENS_FILE, or MONGO_URL and MONGO_DB, so the tokens have a store')
  const client = new MongoClient(mongoUrl)
  await client.connect()
  return { store: tokenStoreFromEnvironment(env, client.db(env.MONGO_DB)), source: `MongoDB ${env.MONGO_DB ?? ''}`.trim(), close: async () => { await client.close() } }
}

export async function runTokensCommand(args: string[], values: TokensCommandValues, env: Record<string, string | undefined>, out: (line: string) => void = console.log): Promise<void> {
  const command = args[0]
  if (command !== 'issue' && command !== 'revoke' && command !== 'list') {
    throw new Error('tokens takes one of: issue, revoke, list; see --help')
  }
  const { store, source, close } = await openTokenStore(env)
  try {
    if (command === 'issue') {
      if (values.publisher == null || values.publisher === '') throw new Error('tokens issue needs --publisher <compressed key>')
      if (!TOKEN_USES.includes(values.use as TokenUse)) throw new Error(`tokens issue needs --use ${TOKEN_USES.join('|')}`)
      const { token, record } = await issueToken(store, values.publisher, values.use as TokenUse, values.label ?? `${values.use} token`)
      console.error(`issued a ${record.use} token for ${record.publisherKey} (${record.label}) into ${source}; sha256 ${record.sha256.slice(0, 12)}…. The token is printed once and is not stored.`)
      out(token)
    } else if (command === 'revoke') {
      if (values.sha256 == null || !/^[0-9a-f]{64}$/.test(values.sha256)) throw new Error('tokens revoke needs --sha256 <64 hexadecimal characters>, as tokens list shows it')
      const revoked = await store.revoke(values.sha256, new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'))
      if (!revoked) throw new Error(`no live token with digest ${values.sha256.slice(0, 12)}… in ${source}`)
      out(`revoked ${values.sha256.slice(0, 12)}…`)
    } else {
      const records = await store.list()
      if (records.length === 0) out(`${source} holds no tokens`)
      for (const r of records) out(`${r.sha256}\t${r.use}\t${r.publisherKey}\t${r.label}\tissued ${r.issuedAt}${r.revokedAt == null ? '' : `\trevoked ${r.revokedAt}`}`)
    }
  } finally {
    await close()
  }
}
