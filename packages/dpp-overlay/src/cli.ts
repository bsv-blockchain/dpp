#!/usr/bin/env node
import { loadEnvFile } from 'node:process'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const HELP = (version: string): string => `dpp-index ${version}: run the DPP reference index.

Usage: dpp-index [--env-file <path>]
       dpp-index tokens issue --publisher <compressed key> --use submit|callback [--label <text>] [--env-file <path>]
       dpp-index tokens revoke --sha256 <digest> [--env-file <path>]
       dpp-index tokens list [--env-file <path>]
       dpp-index connection [--publisher <compressed key>] [--url <address>] [--label <text>] [--env-file <path>]
       dpp-index registrations list [--env-file <path>]
       dpp-index registrations approve|refuse|revoke --publisher <compressed key> [--env-file <path>]

Configuration uses environment variables. An explicit env file supplies missing
values; the process environment takes precedence. No file is loaded by default.

Set SERVICE_IDENTITY_KEY to the publisher's public key, MONGO_URL and MONGO_DB
for persistent storage. Write access is per publisher: "tokens issue" prints a
token once for one key and one use (submit covers POST /submit and /retract,
callback covers POST /arc-ingest) and stores its SHA-256 in PUBLISHER_TOKENS_FILE
or, without one, in the index's MongoDB database. SUBMIT_TOKEN and
ARC_CALLBACK_TOKEN remain accepted as operator-wide tokens. "connection" issues
an application's submit and callback tokens in one step, revoking the pair the
same label issued before, and prints the application's NETWORK, INDEX_URL,
INDEX_SUBMIT_TOKEN and INDEX_CALLBACK_TOKEN as an env file on stdout; the
publisher defaults to SERVICE_IDENTITY_KEY and the address to PUBLIC_URL.
With REGISTRATION set, POST /register lets a publisher register itself;
"registrations" lists the requests and, under approval, approves or refuses
them, and revokes a registered key, signing each policy version with
OPERATOR_SIGNING_KEY.
NETWORK is main or test. PORT defaults to 8080; HOST defaults to all interfaces.
The source repository's deploy/ directory runs this index with MongoDB on
Docker Compose, configured from one env file.
See the package README for publisher policies, exports and optional peers.`

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      'env-file': { type: 'string' },
      publisher: { type: 'string' },
      use: { type: 'string' },
      label: { type: 'string' },
      sha256: { type: 'string' },
      url: { type: 'string' },
    },
  })
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  if (values.help) {
    console.log(HELP(manifest.version))
  } else if (values.version) {
    console.log(manifest.version)
  } else {
    if (values['env-file']) loadEnvFile(values['env-file'])
    if (positionals[0] === 'tokens') {
      const { runTokensCommand } = await import('./tokensCommand.js')
      await runTokensCommand(positionals.slice(1), values, process.env)
    } else if (positionals[0] === 'connection') {
      if (positionals.length > 1) throw new Error(`unknown command ${positionals.join(' ')}; see --help`)
      const { runConnectionCommand } = await import('./connectionCommand.js')
      await runConnectionCommand(values, process.env)
    } else if (positionals[0] === 'registrations') {
      const { runRegistrationsCommand } = await import('./registrationsCommand.js')
      await runRegistrationsCommand(positionals.slice(1), values, process.env)
    } else if (positionals.length > 0) {
      throw new Error(`unknown command ${positionals.join(' ')}; see --help`)
    } else {
      const { runFromEnvironment } = await import('./index.js')
      await runFromEnvironment()
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'The index could not start')
  process.exitCode = 1
}
