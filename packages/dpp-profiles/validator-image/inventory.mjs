#!/usr/bin/env node
/**
 * Writes licence-inventory.json: every package the dpp-validator image
 * installs, with its version, its licence and its integrity, read from this
 * folder's package-lock.json.
 *
 *   node packages/dpp-profiles/validator-image/inventory.mjs           write the inventory
 *   node packages/dpp-profiles/validator-image/inventory.mjs --check   exit 1 when the inventory on disk is not what would be written
 *
 * The lockfile is the one source, so the inventory can be checked without
 * installing anything, and a test holds the two together. The image build
 * then holds what it installed to this inventory (notices.mjs), so the file
 * describes the image and not an intention.
 *
 * A licence outside the list below stops the script. Adding one is a review
 * of that licence's terms, and the review is what the edit to this file
 * records.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const lockBytes = readFileSync(join(here, 'package-lock.json'))
const lock = JSON.parse(lockBytes.toString('utf8'))

/** The licences reviewed for this image. Every one is permissive: none asks for the source of anything else in the image. */
const REVIEWED = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'BlueOak-1.0.0', '(WTFPL OR MIT)', 'FreeBSD']

/**
 * Packages whose licence the lockfile does not carry, because their manifest
 * states it in a form npm does not copy. Each is read from the package's own
 * manifest and written here by hand, with where it was read.
 */
const STATED_ELSEWHERE = {
  'negotiate@1.0.1': { licence: 'FreeBSD', source: 'the manifest\'s `licenses` list, which names the FreeBSD licence: the two-clause BSD licence with the FreeBSD disclaimer of views' },
}

const packages = []
for (const [path, entry] of Object.entries(lock.packages)) {
  if (path === '') continue
  const name = entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
  const stated = STATED_ELSEWHERE[`${name}@${entry.version}`]
  const licence = entry.license ?? stated?.licence
  if (licence == null) throw new Error(`${name}@${entry.version} states no licence in the lockfile and has no entry in STATED_ELSEWHERE. Read its manifest and record what it states.`)
  if (!REVIEWED.includes(licence)) throw new Error(`${name}@${entry.version} is under ${licence}, which is not among the licences reviewed for this image (${REVIEWED.join(', ')}).`)
  packages.push({ name, version: entry.version, licence, ...(entry.license == null ? { licenceSource: stated.source } : {}), path, integrity: entry.integrity })
}
packages.sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en') || a.path.localeCompare(b.path, 'en'))

const licences = {}
for (const p of packages) licences[p.licence] = (licences[p.licence] ?? 0) + 1
const inventory = {
  inventory: 'The production dependencies of the dpp-validator image',
  description: 'Every package the image installs under /app/node_modules, from packages/dpp-profiles/validator-image/package-lock.json. The image also holds the service\'s own files, under Apache-2.0 with LICENSE, NOTICE and PATENTS beside them, and the base image named in the Dockerfile, which this file does not list. The licence text of each package is in the image at /app/THIRD-PARTY-NOTICES.txt.',
  generatedBy: 'packages/dpp-profiles/validator-image/inventory.mjs',
  lockfileSha256: createHash('sha256').update(lockBytes).digest('hex'),
  direct: lock.packages[''].dependencies,
  packageCount: packages.length,
  distinctPackages: new Set(packages.map((p) => `${p.name}@${p.version}`)).size,
  licences: Object.fromEntries(Object.entries(licences).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))),
  packages,
}
const text = JSON.stringify(inventory, null, 2) + '\n'

const target = join(here, 'licence-inventory.json')
if (process.argv.includes('--check')) {
  let current = ''
  try { current = readFileSync(target, 'utf8') } catch { /* reported below */ }
  if (current !== text) {
    console.error('packages/dpp-profiles/validator-image/licence-inventory.json is not what package-lock.json gives. Run node packages/dpp-profiles/validator-image/inventory.mjs and review the change.')
    process.exit(1)
  }
  console.log(`licence-inventory.json lists the ${packages.length} packages of package-lock.json: ${Object.entries(inventory.licences).map(([licence, count]) => `${count} ${licence}`).join(', ')}.`)
} else {
  writeFileSync(target, text)
  console.log(`Wrote licence-inventory.json: ${packages.length} packages. ${Object.entries(inventory.licences).map(([licence, count]) => `${count} ${licence}`).join(', ')}.`)
}
