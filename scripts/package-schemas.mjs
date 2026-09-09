#!/usr/bin/env node
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'packages/dpp-core/schemas')
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
for (const name of readdirSync(join(root, 'contracts')).filter((name) => name.endsWith('.schema.json'))) {
  copyFileSync(join(root, 'contracts', name), join(target, name))
}
console.log('Copied the standard JSON schemas into dpp-core without changing their bytes.')
