import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseArgs, parseEnv } from 'node:util'
import { baseUrl, loadEnvironment, requireConfiguration } from './config.mjs'

// The index reads per-publisher tokens from PUBLISHER_TOKENS_FILE in the
// dpp-publisher-tokens@1 form the runtime documents: each record is the
// token's SHA-256, the key it belongs to, its use, a label and its times. This
// script writes that file for the application's own publisher key and hands
// the plain tokens to the app through .app.env; the tokens are never printed.
const FORMAT = 'dpp-publisher-tokens@1'
const digest = token => createHash('sha256').update(token, 'utf8').digest('hex')
const instant = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

function readTokens(path) {
  if (!existsSync(path)) return []
  const document = JSON.parse(readFileSync(path, 'utf8'))
  if (document?.format !== FORMAT || !Array.isArray(document.tokens)) throw new Error(`${path} is not a ${FORMAT} file`)
  return document.tokens
}

function writeTokens(path, tokens) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${randomUUID()}.tokens.tmp`)
  try {
    // World-readable: digests only, and the container reads it as its own user.
    writeFileSync(temporary, `${JSON.stringify({ format: FORMAT, tokens }, null, 2)}\n`, { mode: 0o644, flag: 'wx' })
    renameSync(temporary, path)
  } finally { rmSync(temporary, { force: true }) }
}

function previousSettings() {
  try { return parseEnv(readFileSync('.app.env', 'utf8')) } catch { return {} }
}

/** The app's submit and callback tokens: kept while .app.env holds live ones, otherwise issued afresh with the earlier records revoked. */
function appTokens(env) {
  const path = env.PUBLISHER_TOKENS_FILE
  const publisherKey = env.SERVICE_IDENTITY_KEY.toLowerCase()
  const tokens = readTokens(path)
  const previous = previousSettings()
  const settings = {}
  let changed = false
  for (const [use, setting] of [['submit', 'INDEX_SUBMIT_TOKEN'], ['callback', 'INDEX_CALLBACK_TOKEN']]) {
    const label = `app:${use}`
    const held = previous[setting]
    const live = held && tokens.some(entry => entry.sha256 === digest(held) && entry.use === use && entry.publisherKey === publisherKey && !entry.revokedAt)
    if (live) { settings[setting] = held; continue }
    const at = instant()
    for (const entry of tokens) if (entry.label === label && !entry.revokedAt) entry.revokedAt = at
    const token = randomBytes(32).toString('hex')
    tokens.push({ sha256: digest(token), publisherKey, use, label, issuedAt: at })
    settings[setting] = token
    changed = true
  }
  if (changed) writeTokens(path, tokens)
  return { settings, changed }
}

let json = process.argv.includes('--json')
try {
  const { values } = parseArgs({ options: { json: { type: 'boolean' }, url: { type: 'string' } } })
  json = values.json === true
  const env = loadEnvironment()
  requireConfiguration(env)
  const url = baseUrl(values.url ?? env.PUBLIC_URL, 'application index URL', true)
  const perPublisher = (env.PUBLISHER_TOKENS_FILE ?? '').trim() !== ''
  const { settings, changed } = perPublisher
    ? appTokens(env)
    : { settings: { INDEX_SUBMIT_TOKEN: env.SUBMIT_TOKEN, INDEX_CALLBACK_TOKEN: env.ARC_CALLBACK_TOKEN }, changed: false }
  const content = `# Private server-side settings. Copy these into the app's .env.\n# NETWORK must also match the application wallet.\nNETWORK=${env.NETWORK}\nINDEX_URL=${url}\nINDEX_SUBMIT_TOKEN=${settings.INDEX_SUBMIT_TOKEN}\nINDEX_CALLBACK_TOKEN=${settings.INDEX_CALLBACK_TOKEN}\n`
  const temporary = `.app.env.${randomUUID()}`
  try {
    writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' })
    renameSync(temporary, '.app.env')
  } finally { rmSync(temporary, { force: true }) }
  const message = 'Wrote .app.env with server-side connection settings. Keep it private; no credentials were printed.' +
    (perPublisher
      ? (changed ? ` The app's tokens are recorded hashed in ${env.PUBLISHER_TOKENS_FILE}; a running index reads the change without a restart.` : ' The app keeps the tokens it already held.')
      : '')
  console.log(json ? JSON.stringify({ ok: true, file: '.app.env', message }) : message)
} catch (error) {
  const message = error instanceof Error ? error.message : 'Connection file could not be written'
  if (json) console.log(JSON.stringify({ ok: false, message }))
  else console.error(message)
  process.exitCode = 1
}
