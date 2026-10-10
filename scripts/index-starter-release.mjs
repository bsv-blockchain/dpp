#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { integrityOf, sha256, verifyCandidates } from './lib/candidates.mjs'
import { assertApproval, NPM_REGISTRY, oidcPublishEnv, waitForRegistryVersion } from './lib/publication.mjs'
import { checkIndexStarterRegistry, indexStarterPlan, starterRuntimePackages } from './lib/index-starter-publication.mjs'

const { values } = parseArgs({ options: {
  execute: { type: 'boolean', default: false },
  'check-registry': { type: 'boolean', default: false },
  'verify-registry': { type: 'boolean', default: false },
  approval: { type: 'string' },
  provenance: { type: 'string', default: 'true' },
  authentication: { type: 'string', default: 'oidc' },
} })
if (!['true', 'false'].includes(values.provenance)) throw new Error('provenance must be true or false')
if (!['oidc', 'interactive'].includes(values.authentication)) throw new Error('authentication must be oidc or interactive')
if (values.authentication === 'interactive' && values.provenance !== 'false') throw new Error('an interactive first publication requires a separately approved plan with provenance=false')
if (values.execute && values['verify-registry']) throw new Error('choose execution or registry verification')
if (values.execute && !/^[a-f0-9]{64}$/.test(values.approval ?? '')) throw new Error('the exact publication plan approval is required')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const run = (args, cwd = root, env = process.env) => execFileSync(args[0], args.slice(1), { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
const read = path => JSON.parse(readFileSync(join(root, path), 'utf8'))
const directory = 'packages/create-dpp-index'
const manifest = read(`${directory}/package.json`)
const template = read(`${directory}/template/package.json`)
if (!/^dpp-release-[a-z0-9-]+$/.test(manifest.dpp?.releaseSet ?? '')) throw new Error('invalid runtime release set')
const setBytes = readFileSync(join(root, `release/${manifest.dpp.releaseSet}.json`))
const set = JSON.parse(setBytes)
const packages = [{ name: manifest.name, version: manifest.version, directory }, ...starterRuntimePackages(manifest, template, set)]
const out = join(root, 'release/index-starter')
const archives = join(out, 'candidates')

// Build before packing so changes to source cannot leave an older dist/ in the plan.
run(['npm', 'run', 'build'])
const sourceRevision = run(['git', 'rev-parse', 'HEAD'])
const sourceState = run(['git', 'status', '--porcelain']) ? 'working-tree' : 'committed'
rmSync(archives, { recursive: true, force: true })
mkdirSync(archives, { recursive: true })
const candidates = packages.map(pkg => {
  if (!/^packages\/[a-z0-9-]+$/.test(pkg.directory)) throw new Error('invalid package directory')
  const local = read(`${pkg.directory}/package.json`)
  if (local.name !== pkg.name || local.version !== pkg.version) throw new Error(`${pkg.name}: checkout differs from the selected version`)
  const [report] = JSON.parse(run(['npm', 'pack', '--json', '--ignore-scripts', '--pack-destination', archives], join(root, pkg.directory)))
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/.test(report.filename)) throw new Error('invalid packed filename')
  const path = join(archives, report.filename)
  const bytes = readFileSync(path)
  assert.deepEqual(JSON.parse(run(['tar', 'xOzf', path, 'package/package.json'])), local, 'packed manifest must match the checkout')
  if (pkg.name === manifest.name) {
    const files = report.files.map(file => file.path)
    for (const required of ['src/index.mjs', 'template/package.json', 'template/scripts/start.mjs', 'template/compose.yml', 'template/README.md', 'README.md', 'LICENSE']) {
      assert.ok(files.includes(required), `starter archive is missing ${required}`)
    }
    assert.ok(files.every(file => /^(src\/|template\/|package\.json$|README\.md$|LICENSE$)/.test(file)), 'starter archive contains an unexpected file')
    assert.ok(files.every(file => !/(?:^|\/)(?:planning|node_modules|\.env|\.app.env|AGENTS\.md)(?:\/|$)/.test(file)), 'starter archive contains private or generated material')
  }
  assert.equal(report.integrity, integrityOf(bytes), 'npm integrity must match the archive')
  assert.equal(report.size, bytes.length, 'npm archive size must match')
  return { name: pkg.name, version: pkg.version, filename: report.filename, sha256: sha256(bytes), integrity: report.integrity, size: bytes.length }
})
const failures = verifyCandidates({ candidates }, archives).filter(finding => !finding.ok)
if (failures.length) throw new Error(failures.map(finding => finding.sentence).join('\n'))
const plan = indexStarterPlan({ manifest, template, set, setBytes, candidates, sourceRevision, sourceState, provenance: values.provenance === 'true', authentication: values.authentication })
const planBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`)
writeFileSync(join(out, 'publication-plan.json'), planBytes)
console.log(planBytes.toString())
console.log(`Index starter publication plan SHA-256: ${sha256(planBytes)}`)

if (values.execute) {
  assertApproval(plan, values.approval, run(['git', 'rev-parse', 'HEAD']), run(['git', 'status', '--porcelain']) !== '')
  if (plan.authentication === 'oidc' && (process.env.GITHUB_ACTIONS !== 'true' || !process.env.ACTIONS_ID_TOKEN_REQUEST_URL || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)) throw new Error('OIDC publication requires the GitHub Actions release workflow')
  if (plan.authentication === 'interactive' && (process.env.GITHUB_ACTIONS === 'true' || !process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('interactive publication requires a maintainer terminal outside CI')
  if (plan.provenance && (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY_VISIBILITY !== 'public')) throw new Error('provenance requires a public source repository and the GitHub Actions release workflow')
}
if (values.execute || values['check-registry'] || values['verify-registry']) {
  const actions = await checkIndexStarterRegistry(plan)
  for (const { candidate, action } of actions) console.log(`${candidate.name}@${candidate.version}: ${action}`)
  if (values['verify-registry']) {
    if (actions.some(action => action.action !== 'already-published')) throw new Error('the index starter is not available from npm')
    console.log('The starter and its runtime dependencies match the public registry archives.')
  } else if (values.execute) {
    for (const { candidate, action } of actions) {
      if (action === 'already-published') continue
      const args = ['publish', join(archives, candidate.filename), '--ignore-scripts', '--access=public', `--tag=${plan.tag}`, `--registry=${NPM_REGISTRY}`, `--provenance=${plan.provenance}`]
      if (plan.authentication === 'interactive') execFileSync('npm', args, { cwd: root, env: process.env, stdio: 'inherit' })
      else run(['npm', ...args], root, oidcPublishEnv(process.env))
      await waitForRegistryVersion(candidate, { onProgress: console.log })
    }
    console.log('The approved starter is available. Run the registry scaffold check before announcing it.')
  } else console.log('Runtime prerequisites are published. No package or dist-tag was written.')
} else {
  console.log('Local preparation only. No registry access or publication. Check npm prerequisites with --check-registry before approving this plan.')
}
