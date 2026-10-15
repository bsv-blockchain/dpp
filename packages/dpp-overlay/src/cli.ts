#!/usr/bin/env node
import { loadEnvFile } from 'node:process'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

try {
  const { values } = parseArgs({ options: {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
    'env-file': { type: 'string' },
  } })
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  if (values.help) {
    console.log(`dpp-index ${manifest.version}: run the DPP reference index.

Usage: dpp-index [--env-file <path>]

Configuration uses environment variables. An explicit env file supplies missing
values; the process environment takes precedence. No file is loaded by default.

Set SERVICE_IDENTITY_KEY to the publisher's public key, MONGO_URL and MONGO_DB
for persistent storage, SUBMIT_TOKEN and ARC_CALLBACK_TOKEN for write access.
NETWORK is main or test. PORT defaults to 8080; HOST defaults to all interfaces.
For a configured operator project, use @bsv/create-dpp-index.
See the package README for publisher policies, exports and optional peers.`)
  } else if (values.version) {
    console.log(manifest.version)
  } else {
    if (values['env-file']) loadEnvFile(values['env-file'])
    const { runFromEnvironment } = await import('./index.js')
    await runFromEnvironment()
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'The index could not start')
  process.exitCode = 1
}
