/**
 * `dpp-index connection`: the connection an application server needs to
 * write to this index, in one step. It issues a submit and a callback token
 * (`publisherTokens.ts`) for the application's publisher key into the store
 * the environment selects, the same store `dpp-index tokens` uses, then
 * revokes the live tokens this label issued that key before, so a rerun
 * rotates the pair. It prints the four settings the application starter
 * reads, `NETWORK`, `INDEX_URL`, `INDEX_SUBMIT_TOKEN` and
 * `INDEX_CALLBACK_TOKEN`, as an env file on stdout; the operator redirects
 * it into a private file. The tokens appear there once and are never stored;
 * every other line goes to stderr.
 */
import { issueToken, type TokenUse } from './publisherTokens.js'
import { openTokenStore } from './tokensCommand.js'

export interface ConnectionCommandValues {
  publisher?: string
  url?: string
  label?: string
}

/** The address an application reaches the index at: http or https, no credentials, query or fragment, no trailing slash. */
export function connectionUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${value} is not an absolute URL; give the address the application reaches this index at, https://host or http://host:port`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${value} is not an http or https address`)
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') throw new Error(`${value} carries credentials, a query or a fragment; give the plain address`)
  return url.href.replace(/\/+$/, '')
}

export async function runConnectionCommand(
  values: ConnectionCommandValues,
  env: Record<string, string | undefined>,
  out: (line: string) => void = console.log,
  now: () => Date = () => new Date()
): Promise<void> {
  const publisher = (values.publisher ?? env.SERVICE_IDENTITY_KEY ?? '').trim().toLowerCase()
  if (publisher === '') throw new Error('connection needs --publisher <compressed key>, the application publisher key, or SERVICE_IDENTITY_KEY in the environment')
  const address = (values.url ?? env.PUBLIC_URL ?? '').trim()
  if (address === '') throw new Error('connection needs --url <address the application reaches this index at>, or PUBLIC_URL in the environment')
  const url = connectionUrl(address)
  const network = (env.NETWORK ?? '').trim() || 'main'
  if (network !== 'main' && network !== 'test') throw new Error('NETWORK must be main or test')
  const label = values.label ?? 'app'
  const { store, source, close } = await openTokenStore(env)
  try {
    const earlier = (await store.list()).filter((r) => r.publisherKey === publisher && r.revokedAt == null)
    const issued: Record<TokenUse, string> = { submit: '', callback: '' }
    for (const use of ['submit', 'callback'] as const) {
      issued[use] = (await issueToken(store, publisher, use, `${label}:${use}`, now)).token
    }
    // Revoked only once both new tokens are stored, so a failed issue leaves the application's working pair in place.
    const at = now().toISOString().replace(/\.\d{3}Z$/, 'Z')
    let revoked = 0
    for (const record of earlier) {
      if (record.label === `${label}:${record.use}` && (await store.revoke(record.sha256, at))) revoked += 1
    }
    console.error(
      `issued a submit and a callback token for ${publisher} (label ${label}) into ${source}` +
        (revoked === 0 ? '' : `, and revoked the ${revoked} this label issued it before`) +
        '. The tokens are printed once and are not stored; keep the file they go into private.'
    )
    out('# The index connection for an application server. Private: keep it out of version control and client code.')
    out(`NETWORK=${network}`)
    out(`INDEX_URL=${url}`)
    out(`INDEX_SUBMIT_TOKEN=${issued.submit}`)
    out(`INDEX_CALLBACK_TOKEN=${issued.callback}`)
  } finally {
    await close()
  }
}
