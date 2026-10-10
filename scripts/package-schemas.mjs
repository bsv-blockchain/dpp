#!/usr/bin/env node
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageName = process.argv[2] ?? 'dpp-protocol'
if (!['dpp-protocol', 'dpp-core'].includes(packageName)) throw new Error(`Unknown schema package: ${packageName}`)
const target = join(root, 'packages', packageName, 'schemas')
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
for (const name of readdirSync(join(root, 'contracts')).filter((name) => name.endsWith('.schema.json'))) {
  copyFileSync(join(root, 'contracts', name), join(target, name))
}
console.log(`Copied the standard JSON schemas into ${packageName} without changing their bytes.`)
