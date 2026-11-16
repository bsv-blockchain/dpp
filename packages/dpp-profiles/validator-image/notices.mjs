#!/usr/bin/env node
/**
 * Run once, inside the image build, after the dependencies are installed.
 * It does two things, in this order, and stops the build if the first fails:
 *
 *   1. holds what was installed to licence-inventory.json: the same folders,
 *      each with the name, the version and the licence the inventory records;
 *   2. writes THIRD-PARTY-NOTICES.txt: for every installed package, what its
 *      manifest states and the text of every licence and notice file it
 *      publishes.
 *
 *   node notices.mjs [folder]    the folder that holds node_modules and licence-inventory.json. Default: the working directory
 *
 * The notices are copied from the installed packages and never written from
 * memory, so each is the text its package was published with. A package that
 * publishes no licence file is listed with what its manifest states and a
 * sentence saying so: nothing is invented for it.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? '.')
const inventory = JSON.parse(readFileSync(join(root, 'licence-inventory.json'), 'utf8'))
const installed = JSON.parse(readFileSync(join(root, 'node_modules', '.package-lock.json'), 'utf8')).packages

/** The licence a manifest states, in the form the inventory records. */
const licenceOf = (manifest) => {
  if (typeof manifest.license === 'string') return manifest.license
  if (manifest.license != null && typeof manifest.license.type === 'string') return manifest.license.type
  if (Array.isArray(manifest.licenses)) return manifest.licenses.map((l) => l.type).join(' OR ')
  return undefined
}
const person = (value) => (typeof value === 'string' ? value : value != null && typeof value.name === 'string' ? `${value.name}${value.email ? ` <${value.email}>` : ''}${value.url ? ` (${value.url})` : ''}` : undefined)
const repositoryOf = (manifest) => (typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url)

const problems = []
const recorded = new Map(inventory.packages.map((p) => [p.path, p]))
const paths = Object.keys(installed).sort((a, b) => a.localeCompare(b, 'en'))
for (const path of paths) if (!recorded.has(path)) problems.push(`${path} is installed and is not in the inventory.`)
for (const path of recorded.keys()) if (installed[path] == null) problems.push(`${path} is in the inventory and is not installed.`)

const sections = []
let withoutFile = 0
for (const path of paths) {
  const manifest = JSON.parse(readFileSync(join(root, path, 'package.json'), 'utf8'))
  const entry = recorded.get(path)
  if (entry != null) {
    if (manifest.name !== entry.name || manifest.version !== entry.version) problems.push(`${path} holds ${manifest.name}@${manifest.version}; the inventory records ${entry.name}@${entry.version}.`)
    if (licenceOf(manifest) !== entry.licence) problems.push(`${manifest.name}@${manifest.version} states the licence ${licenceOf(manifest)}; the inventory records ${entry.licence}.`)
  }
  const files = readdirSync(join(root, path), { withFileTypes: true }).filter((f) => f.isFile() && /^(licen[cs]e|copying|notice|unlicen[cs]e)/i.test(f.name)).map((f) => f.name).sort()
  if (files.length === 0) withoutFile += 1
  const people = [person(manifest.author), ...(Array.isArray(manifest.contributors) ? manifest.contributors.map(person) : [])].filter((p) => p != null)
  sections.push([
    '='.repeat(78),
    `${manifest.name}@${manifest.version}`,
    `Licence: ${licenceOf(manifest) ?? 'not stated'}`,
    ...(people.length > 0 ? [`Authors: ${people.join('; ')}`] : []),
    ...(repositoryOf(manifest) != null ? [`Source: ${repositoryOf(manifest)}`] : []),
    `Installed at: ${path}`,
    '',
    ...(files.length === 0
      ? ['This package publishes no licence file. Its manifest states the licence above.', '']
      : files.flatMap((name) => [`--- ${name} ---`, readFileSync(join(root, path, name), 'utf8').replace(/\r\n/g, '\n').trimEnd(), ''])),
  ].join('\n'))
}

if (problems.length > 0) {
  console.error(`What was installed is not what licence-inventory.json records:\n${problems.map((p) => `  ${p}`).join('\n')}`)
  process.exit(1)
}

const header = [
  'Third-party notices for the dpp-validator image',
  '',
  `This image installs ${paths.length} packages under /app/node_modules. Each is listed below with what its manifest states and the text of every licence and notice file it publishes. licence-inventory.json beside this file lists the same packages with their versions and integrity. ${withoutFile} of them publish no licence file, and each of those is listed with what its manifest states.`,
  '',
  'The service\'s own files are under the Apache License 2.0: see LICENSE, NOTICE and PATENTS beside this file. The base image and its operating-system packages carry their own notices, under /usr/share/doc and in the Node.js distribution.',
  '',
].join('\n')
writeFileSync(join(root, 'THIRD-PARTY-NOTICES.txt'), `${header}\n${sections.join('\n')}`)
console.log(`Held ${paths.length} installed packages to the inventory and wrote THIRD-PARTY-NOTICES.txt (${withoutFile} publish no licence file).`)
