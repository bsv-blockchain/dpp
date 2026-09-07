#!/usr/bin/env node
/**
 * Render docs/packages/support-table.md from the support declarations of the
 * current release set, so the table an adopter reads and the declaration the
 * checker holds to the built code are one source.
 *
 *   node scripts/render-support-table.mjs           # writes the page
 *   node scripts/render-support-table.mjs --check   # exits 1 when the page differs from what it would write
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const currentSet = () => {
  const sets = readdirSync(join(root, 'release'))
    .filter((name) => /^dpp-release-.*\.json$/.test(name))
    .map((name) => ({ name, set: JSON.parse(readFileSync(join(root, 'release', name), 'utf8')) }))
    .filter(({ set }) => set.status !== 'superseded')
    .sort((a, b) => a.name.localeCompare(b.name))
  if (sets.length === 0) throw new Error('no release set under release/ is current')
  return sets.at(-1)
}
const { name, set } = currentSet()
const R = 'https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258'
const licences = JSON.parse(readFileSync(join(root, 'conformance', 'licences.json'), 'utf8'))
const deps = (pkg) => (licences.components.find((c) => c.name === pkg)?.dependencies ?? []).map((d) => `\`${d.name}\` ${d.range}`).join(', ') || 'none'
const browser = { unsupported: 'Unsupported', untested: 'Untested', supported: 'Plain data' }
const runtime = { node: `Node ${set.runtime.node}`, any: 'Any' }

const lines = []
lines.push('# Supported entry points')
lines.push('')
lines.push(`Generated from the [release declaration](${R}/release/${name}) for \`${set.releaseSet}\` (${set.status}).`)
lines.push('')
lines.push('| Package | Entry point | Kind | Runtime | Browser | Types | Side effects | Node built-ins | Carries |')
lines.push('|---|---|---|---|---|---|---|---|---|')
for (const pkg of set.packages) {
  for (const s of pkg.support ?? []) {
    const carries = s.kind === 'data' ? (s.carries ?? []).map((c) => `\`${c}\``).join(', ') : (pkg.carries ?? []).map((c) => `\`${c.includes('.') ? c : `${c}/`}\``).join(', ')
    lines.push(`| \`${pkg.name}\` ${pkg.version} | \`${s.entryPoint}\` | ${s.kind} | ${runtime[s.runtime]} | ${browser[s.browser]} | ${s.types ? 'Yes' : 'No'} | ${s.kind === 'module' ? (s.sideEffects ? 'Yes' : 'None') : 'None'} | ${s.kind === 'module' ? ((pkg.nodeBuiltins ?? []).map((b) => `\`${b}\``).join(', ') || 'none') : 'none'} | ${carries} |`)
  }
}
lines.push('')
lines.push('## Runtime dependencies per package')
lines.push('')
lines.push(`Source: [dependency ledger](${R}/conformance/licences.json).`)
lines.push('')
for (const pkg of set.packages) lines.push(`- \`${pkg.name}\` ${pkg.version}: ${deps(pkg.name)}`)
lines.push('')
lines.push('See [release sets](../reference/release-sets.md) for the compatibility declaration and [package installation](README.md) for candidate checks.')
lines.push('')
const out = lines.join('\n') + '\n'
const target = join(root, 'docs', 'packages', 'support-table.md')
if (process.argv.includes('--check')) {
  let current = ''
  try { current = readFileSync(target, 'utf8') } catch {}
  if (current !== out) { console.error('docs/packages/support-table.md is not what the release set renders; run node scripts/render-support-table.mjs'); process.exit(1) }
  console.log('docs/packages/support-table.md matches the release set.')
} else {
  writeFileSync(target, out)
  console.log(`wrote docs/packages/support-table.md from release/${name}`)
}
