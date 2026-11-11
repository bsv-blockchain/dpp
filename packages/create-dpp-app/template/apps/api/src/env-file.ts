// The project's .env, which go-live, connect-index and wallet write to:
// the named keys are rewritten in place and a missing key is appended, every
// other line and comment stays, and the file is written through a temporary
// file and a rename, readable by its owner only, because it holds the wallet
// root key and the index tokens.
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseEnv } from 'node:util'

/** The file's settings, or nothing when it does not exist. */
export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const parsed: Record<string, string> = {}
  for (const [key, value] of Object.entries(parseEnv(readFileSync(path, 'utf8')))) if (value != null) parsed[key] = value
  return parsed
}

export async function updateEnvFile(path: string, values: Record<string, string>): Promise<void> {
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n') : []
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  // Every occurrence is rewritten: the file's readers take the last one, and a
  // key pasted twice would otherwise keep an old value where the API reads it.
  const seen = new Set<string>()
  const rewritten = lines.map((line) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)
    if (match == null || !(match[1] in values)) return line
    seen.add(match[1])
    return `${match[1]}=${values[match[1]]}`
  })
  for (const [key, value] of Object.entries(values)) if (!seen.has(key)) rewritten.push(`${key}=${value}`)
  const temporary = join(dirname(path), `.${randomUUID()}.env.tmp`)
  try {
    writeFileSync(temporary, rewritten.join('\n') + '\n', { mode: 0o600 })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

export const ROOT_KEY_GENERATED = 'Generated WALLET_ROOT_KEY into .env. Back the file up: this key is the wallet.'

/**
 * A fresh project has no WALLET_ROOT_KEY, and without one a test wallet with
 * fixed, publicly known keys stands in. go-live and wallet both generate the
 * key into the file first, so the publisher key an index is given is the one
 * that later goes live. Answers whether it generated one; `env` gains it.
 */
export async function generateRootKey(path: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  if ((env.WALLET_ROOT_KEY ?? '').trim() !== '') return false
  const rootKey = randomBytes(32).toString('hex')
  await updateEnvFile(path, { WALLET_ROOT_KEY: rootKey })
  env.WALLET_ROOT_KEY = rootKey
  return true
}
