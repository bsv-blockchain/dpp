// The project's .env, which go-live, connect-index and add-index write to:
// the named keys are rewritten in place and a missing key is appended, every
// other line and comment stays, and the file is written through a temporary
// file and a rename, readable by its owner only, because it holds the wallet
// root key and the index tokens.
import { randomUUID } from 'node:crypto'
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
