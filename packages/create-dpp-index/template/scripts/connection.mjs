import { writeFileSync, renameSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import { baseUrl, loadEnvironment, requireConfiguration } from './config.mjs'

let json = process.argv.includes('--json')
try {
  const { values } = parseArgs({ options: { json: { type: 'boolean' }, url: { type: 'string' } } })
  json = values.json === true
  const env = loadEnvironment()
  requireConfiguration(env)
  const url = baseUrl(values.url ?? env.PUBLIC_URL, 'application index URL', true)
  const content = `# Private server-side settings. Copy these into the app's .env.\n# NETWORK must also match the application wallet.\nNETWORK=${env.NETWORK}\nINDEX_URL=${url}\nINDEX_SUBMIT_TOKEN=${env.SUBMIT_TOKEN}\nINDEX_CALLBACK_TOKEN=${env.ARC_CALLBACK_TOKEN}\n`
  const temporary = `.app.env.${randomUUID()}`
  try {
    writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' })
    renameSync(temporary, '.app.env')
  } finally { rmSync(temporary, { force: true }) }
  const message = 'Wrote .app.env with server-side connection settings. Keep it private; no credentials were printed.'
  console.log(json ? JSON.stringify({ ok: true, file: '.app.env', message }) : message)
} catch (error) {
  const message = error instanceof Error ? error.message : 'Connection file could not be written'
  if (json) console.log(JSON.stringify({ ok: false, message }))
  else console.error(message)
  process.exitCode = 1
}
