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
const R = 'https://github.com/bsv-blockchain/dpp/blob/main'
const licences = JSON.parse(readFileSync(join(root, 'conformance', 'licences.json'), 'utf8'))
const deps = (pkg) => (licences.components.find((c) => c.name === pkg)?.dependencies ?? []).map((d) => `\`${d.name}\` ${d.range}`).join(', ') || 'none'
const browser = { unsupported: 'Unsupported', untested: 'Untested, not promised', supported: 'Plain data' }
const runtime = { node: `Node ${set.runtime.node}`, any: 'Any' }

const lines = []
lines.push('# Support table by entry point')
lines.push('')
lines.push(`**Generated** from [\`release/${name}\`](${R}/release/${name}) by \`node scripts/render-support-table.mjs\`; edit the release set, not this page. **Release:** \`${set.releaseSet}\` (${set.status}). **Runtime baseline:** Node ${set.runtime.node}, ${set.runtime.dependencies.map((d) => `\`${d.name}\` ${d.version}`).join(', ')}.`)
lines.push('')
lines.push('Every entry point the four packages export, with what it needs and what it carries. A module entry point ships TypeScript declarations and is exercised by the clean consumer check from its packed tarball; a data entry point is plain files any runtime or language reads. "Unsupported" in a browser means the code imports Node built-ins or server-only dependencies; "untested, not promised" means nothing known prevents it and no browser route is tested. The checker holds the declared Node built-ins to a scan of each package\'s built code.')
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
lines.push('Read from `conformance/licences.json`, which the checker holds to what is installed.')
lines.push('')
for (const pkg of set.packages) lines.push(`- \`${pkg.name}\` ${pkg.version}: ${deps(pkg.name)}`)
lines.push('')
lines.push('## Notes per entry point')
lines.push('')
for (const pkg of set.packages) {
  for (const s of pkg.support ?? []) if (s.notes) lines.push(`- \`${pkg.name}\` \`${s.entryPoint}\`: ${s.notes}`)
}
lines.push('')
lines.push('## Version compatibility')
lines.push('')
lines.push(`The four packages are tested together as one set on the runtime baseline above. \`@bsv/dpp-overlay-topics\` depends on \`@bsv/dpp-core\` by a caret range on its minor version; every other cross-package relation is by the set. ${set.packages.filter((p) => p.serverOnly).map((p) => `\`${p.name}\``).join(' and ')} ${set.packages.filter((p) => p.serverOnly).length === 1 ? 'is' : 'are'} server-only by declaration in the set. A consumer pins the versions the set names; a caret range across a pre-1.0 minor is not a compatibility promise, the set is.`)
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
