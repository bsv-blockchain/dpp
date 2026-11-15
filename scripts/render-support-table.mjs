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
const licences = JSON.parse(readFileSync(join(root, 'conformance', 'licences.json'), 'utf8'))
const deps = (pkg) => (licences.components.find((c) => c.name === pkg)?.dependencies ?? []).map((d) => `\`${d.name}\` ${d.range}`).join(', ') || 'none'
const browser = { unsupported: 'Unsupported', untested: 'Untested', supported: 'Plain data' }
const runtime = { node: `Node ${set.runtime.node}`, any: 'Any' }

const lines = []
lines.push('# Supported entry points')
lines.push('')
lines.push(`Generated from \`release/${name}\` in the documentation build for \`${set.releaseSet}\` (${set.status}). The [release guide](../reference/release-sets.md) explains how a consumer selects and verifies the matching artefacts.`)
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
// Not in the release set: a property of how one package reads its data, which a table row cannot say.
lines.push('`@bsv/dpp-profiles` reads its manifests and schemas from its own directory at run time, by a path computed from the profile identifier. A bundler or file tracer cannot see those reads, so a bundled deployment must include the data files, as [deploy it with a bundler](dpp-profiles.md#deploy-it-with-a-bundler) shows.')
lines.push('')
lines.push('## Runtime dependencies per package')
lines.push('')
lines.push('Source: `conformance/licences.json` in the same source checkout. See the [licence guide](../contribute/licence.md).')
lines.push('')
for (const pkg of set.packages) lines.push(`- \`${pkg.name}\` ${pkg.version}: ${deps(pkg.name)}`)
lines.push('')
if (set.images != null) {
  // The images that belong to the set, from its own declaration: what an operator pulls, beside what a developer installs.
  lines.push('## Images')
  lines.push('')
  lines.push(`The index and the validator service are also delivered as images, run by the [operator preset](../operate/README.md). Registry: \`${set.images.registry}\`. An image is pinned by its digest and by nothing else; \`unpublished\` means the image has not been published and has no digest yet.`)
  lines.push('')
  lines.push('| Image | Runs | Dockerfile | Node | Platforms | Digest |')
  lines.push('|---|---|---|---|---|---|')
  for (const image of set.images.own) {
    const pkg = set.packages.find((p) => p.name === image.package)
    lines.push(`| \`${image.name}\` | \`${image.package}\` ${pkg?.version ?? ''} | \`${image.dockerfile}\` | ${image.runtime.node} | ${image.platforms.join(', ')} | \`${image.digest}\` |`)
  }
  lines.push('')
  lines.push('The preset also runs images this repository does not build or contain, each under its publisher\'s own licence:')
  lines.push('')
  lines.push('| Image | Version | Licence | Digest | Resolved |')
  lines.push('|---|---|---|---|---|')
  for (const entry of set.images.thirdParty) lines.push(`| \`${entry.repository}\` | ${entry.tag} | ${entry.licence} | \`${entry.digest}\` | ${entry.resolvedAt} |`)
  lines.push('')
}
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
