#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { sha256, verifyCandidates, verifyRecordAgainstSet } from './lib/candidates.mjs'
import { assertApproval, NPM_REGISTRY, publicationActions, publicationOrder, registryVersion } from './lib/publication.mjs'

const { values } = parseArgs({ options: {
  execute: { type: 'boolean', default: false },
  'verify-registry': { type: 'boolean', default: false },
  approval: { type: 'string' },
  provenance: { type: 'string', default: 'true' },
} })
if (!['true', 'false'].includes(values.provenance)) throw new Error('provenance must be true or false')
if (values.execute && values['verify-registry']) throw new Error('choose execution or registry verification')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
const record = JSON.parse(readFileSync(join(root, 'release/candidates.json'), 'utf8'))
if (!/^release\/dpp-release-[a-z0-9-]+\.json$/.test(record.releaseSetPath)) throw new Error('invalid release set path')
const setBytes = readFileSync(join(root, record.releaseSetPath))
const set = JSON.parse(setBytes)
const candidateDir = join(root, 'release/candidates')
const failures = [...verifyRecordAgainstSet(record, set, setBytes), ...verifyCandidates(record, candidateDir)].filter((f) => !f.ok)
if (failures.length) throw new Error(failures.map((f) => f.sentence).join('\n'))
const manifests = Object.fromEntries(set.packages.map((p) => [p.name, JSON.parse(readFileSync(join(root, p.directory, 'package.json'), 'utf8'))]))
for (const candidate of record.candidates) {
  const manifest = manifests[candidate.name]
  const packed = JSON.parse(run('tar', ['xOzf', join(candidateDir, candidate.filename), 'package/package.json']))
  if (JSON.stringify(packed) !== JSON.stringify(manifest)) throw new Error(`${candidate.name}: packed manifest differs from the checkout`)
  if (manifest.private || manifest.publishConfig?.access !== 'public' || manifest.publishConfig?.tag !== 'next' || manifest.publishConfig?.registry !== NPM_REGISTRY) throw new Error(`${candidate.name}: publication settings must be public npm, tag next`)
}
const candidates = publicationOrder(record.candidates, manifests)
const plan = {
  releaseSet: record.releaseSet,
  releaseSetSha256: record.releaseSetSha256,
  sourceRevision: record.sourceRevision,
  sourceState: record.sourceState,
  selection: set.selection,
  selectionSha256: sha256(readFileSync(join(root, set.selection))),
  changelogSha256: sha256(readFileSync(join(root, 'CHANGELOG.md'))),
  registry: NPM_REGISTRY,
  access: 'public',
  tag: 'next',
  provenance: values.provenance === 'true',
  candidates: candidates.map(({ name, version, filename, sha256, integrity, size }) => ({ name, version, filename, sha256, integrity, size })),
}
const planBytes = Buffer.from(JSON.stringify(plan, null, 2) + '\n')
const planDigest = sha256(planBytes)
writeFileSync(join(root, 'release/publication-plan.json'), planBytes)
console.log(planBytes.toString())
console.log(`Publication plan SHA-256: ${planDigest}`)
if (values.execute) {
  assertApproval(plan, values.approval, run('git', ['rev-parse', 'HEAD']), run('git', ['status', '--porcelain']) !== '')
  if (plan.provenance && (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY_VISIBILITY !== 'public')) throw new Error('provenance requires a public source repository and the GitHub Actions release workflow')
  run('node', ['conformance/qualify.mjs', set.selection])
}
const actions = await publicationActions(candidates)
for (const { candidate, action } of actions) console.log(`${candidate.name}@${candidate.version}: ${action}`)
if (values['verify-registry']) {
  if (actions.some((a) => a.action !== 'already-published')) throw new Error('the release is not fully available from npm')
  console.log('Every npm tarball matches the candidate bytes.')
} else if (values.execute) {
  for (const { candidate, action } of actions) {
    if (action === 'already-published') continue
    // Never treat a failed publish as success. A rerun verifies anything that landed.
    run('npm', ['publish', join(candidateDir, candidate.filename), '--ignore-scripts', '--access=public', '--tag=next', `--registry=${NPM_REGISTRY}`, `--provenance=${plan.provenance}`])
    if (await registryVersion(candidate) === null) throw new Error(`${candidate.name}: npm has not returned the published version; stop and verify before retrying`)
  }
  console.log('All packages are available with the approved bytes. Run the registry consumer check before announcing the release.')
} else {
  console.log('Read-only preparation. No package or dist-tag was written. Approval is of this plan digest; publication requires a committed source revision.')
}
