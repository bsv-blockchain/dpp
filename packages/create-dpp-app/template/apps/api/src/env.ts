// Read the project's .env before anything reads the environment, so the npm
// scripts (dev, start, wallet, operations) see the same settings Docker passes
// with --env-file. Settings already in the environment win. Tests pass their
// own settings to loadConfig and never read the file.
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const file = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env')
if (existsSync(file)) {
  const before = { ...process.env }
  process.loadEnvFile(file)
  for (const [key, value] of Object.entries(before)) if (value !== undefined) process.env[key] = value
}
