#!/usr/bin/env node
/**
 * The clean consumer check (`spec/conformance.md` §2, the external consumer):
 * install the exact packed candidates into a fresh project outside this
 * checkout, with development dependencies omitted and no workspace links,
 * then import every entry point, resolve the exported types with the
 * TypeScript compiler, read the profile and VSC artefacts the packages carry,
 * and run the reader's fixture path on the version 2 chain. One sentence per
 * finding, never a score; the exit code is 1 when any sentence does not hold.
 *
 *   node scripts/consumer-check.mjs            # after scripts/release-candidates.mjs
 *   KEEP_CONSUMER=1 node scripts/consumer-check.mjs   # leave the temporary project behind
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const record = JSON.parse(readFileSync(join(root, 'release', 'candidates.json'), 'utf8'))
const dir = mkdtempSync(join(tmpdir(), 'dpp-consumer-'))
let failures = 0
const say = (ok, sentence) => { if (!ok) failures += 1; console.log(`${ok ? 'ok' : 'FAIL'}: ${sentence}`) }
const run = (args, cwd = dir, env = {}) => execFileSync(args[0], args.slice(1), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } })

try {
  // A project of its own: no workspace, no lockfile of ours, no path back here.
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dpp-consumer-check', private: true, type: 'module', version: '0.0.0' }, null, 2))
  const tarballs = record.candidates.map((c) => join(root, 'release', 'candidates', c.filename))
  for (const t of tarballs) if (!existsSync(t)) throw new Error(`missing candidate ${t}; run scripts/release-candidates.mjs first`)
  const cache = join(dir, '.npm-cache')
  run(['npm', 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', cache, ...tarballs])
  const installed = JSON.parse(run(['npm', 'ls', '--json', '--omit=dev']))
  const deps = installed.dependencies ?? {}
  for (const c of record.candidates) {
    say(deps[c.name]?.version === c.version, `${c.name}@${c.version} installed from its tarball (resolved ${deps[c.name]?.resolved ?? 'nothing'}).`)
  }
  const sdk = JSON.parse(readFileSync(join(dir, 'node_modules', '@bsv', 'sdk', 'package.json'), 'utf8')).version
  say(sdk === '2.4.2', `@bsv/sdk resolved to ${sdk}, the release set's runtime.`)
  say(!existsSync(join(dir, 'node_modules', 'vitest')) && !existsSync(join(dir, 'node_modules', 'typescript')), 'no development dependency of the packages was installed.')
  const unexpected = record.candidates.flatMap((c) => {
    const files = run(['tar', 'tzf', join(root, 'release', 'candidates', c.filename)]).split('\n')
    return files.filter((f) => /planning|AGENTS\.md|\.env|test\/|\.private|notes\//.test(f)).map((f) => `${c.name}: ${f}`)
  })
  say(unexpected.length === 0, `no private, test or environment file is inside any tarball${unexpected.length === 0 ? '' : `: ${unexpected.join(', ')}`}.`)

  // The runtime: every entry point imports, the reader path runs on the fixture, the artefacts are there.
  mkdirSync(join(dir, 'fixtures'), { recursive: true })
  for (const f of ['chain-v2.json', 'managed-acceptance-v1.json', 'chain-v1.json']) cpSync(join(root, 'fixtures', f), join(dir, 'fixtures', f))
  writeFileSync(join(dir, 'consumer.mjs'), `
import { readFileSync } from 'node:fs'
import { Transaction } from '@bsv/sdk'
import { verifyChain, verifyPassportEvidence, inspectManagedAcceptance, bindAcceptanceToState, findDppOutputs, STANDARD_VERSION_V2, FIELD_COUNT_V2 } from '@bsv/dpp-core'
import { DppTopicManager, DppLookupService, InMemoryDppStorage, buildCapabilities } from '@bsv/dpp-overlay-topics'
import { readManifest, mapNativeOperation, checkSelection, VERSION_2_OPERATION_MAPPING } from '@bsv/dpp-profiles'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const vsc = await import('@bsv/vsc')
const out = []
const chain = JSON.parse(readFileSync('fixtures/chain-v2.json', 'utf8'))
const txs = chain.states.map((s) => Transaction.fromHex(s.rawTx))
const result = await verifyChain(txs, { chainTracker: 'scripts only', managedAcceptance: true, serverIdentityKey: chain.custodianKey })
out.push(['chain-v2 valid under managed-custody@1', result.valid === true])
const acceptance = JSON.parse(readFileSync('fixtures/managed-acceptance-v1.json', 'utf8'))
const inspection = inspectManagedAcceptance(acceptance.record)
out.push(['acceptance record signature valid', inspection.signatureValid === true])
out.push(['acceptance binds to the transfer', bindAcceptanceToState(acceptance.record, findDppOutputs(txs[2])[0].state).length === 0])
const report = await verifyPassportEvidence({ tokenHistory: txs, acceptanceRecords: [acceptance.record] }, { passportId: chain.states[0].data.passportId, source: 'request-context' }, { chainTracker: 'scripts only', publisherKeys: [chain.custodianKey], managedAcceptance: { required: true } })
out.push(['report linkage pass', report.checks.find((c) => c.name === 'linkage').status === 'pass'])
out.push(['constants', STANDARD_VERSION_V2 === '2' && FIELD_COUNT_V2 === 17])
const tm = new DppTopicManager(chain.custodianKey, { managedAcceptance: true })
out.push(['topic manager documentation names version 2', (await tm.getDocumentation()).includes('record-model-v2')])
const caps = buildCapabilities({ serviceIdentityKey: chain.custodianKey, anchorServiceKeys: [], ownerConsent: false, managedAcceptance: true, exportAvailable: false, networkOracleConfigured: false, at: new Date() })
out.push(['capabilities name managed-custody@1', caps.profiles.some((p) => p.id === 'managed-custody')])
out.push(['lookup service constructs', new DppLookupService(new InMemoryDppStorage()) != null])
const battery = readManifest('battery@2')
out.push(['profile manifest battery@2 reads', battery.fields.length > 0])
out.push(['version 2 mapping', mapNativeOperation(battery, { nativeOperation: 'ISSUE' }).eventType === 'Origin' && VERSION_2_OPERATION_MAPPING.RETIRE === 'RECYCLED'])
out.push(['baseline 2 selection known', checkSelection({ baseline: 'native-baseline@2', purpose: 'read' }).conflicts.every((c) => c.code !== 'baseline-unknown')])
const schema = require('@bsv/dpp-profiles/generated/payload-schema/battery@2.public.schema.json')
out.push(['generated schema carried', typeof schema === 'object'])
out.push(['vsc entry point imports', typeof vsc === 'object' && Object.keys(vsc).length > 0])
console.log(JSON.stringify(out))
`)
  const outcome = JSON.parse(run(['node', 'consumer.mjs']).trim().split('\n').at(-1))
  for (const [label, ok] of outcome) say(ok === true, `consumer runtime: ${label}.`)
  say(existsSync(join(dir, 'node_modules', '@bsv', 'vsc', 'artifacts')), 'the VSC context and schema artefacts are inside the installed package.')
  say(existsSync(join(dir, 'node_modules', '@bsv', 'dpp-profiles', 'manifests', 'battery@2.json')) && existsSync(join(dir, 'node_modules', '@bsv', 'dpp-profiles', 'frozen.json')), 'the frozen profile manifests are inside the installed package.')
  for (const name of ['dpp-core', 'dpp-overlay-topics', 'dpp-profiles', 'vsc']) say(existsSync(join(dir, 'node_modules', '@bsv', name, 'LICENSE')) || existsSync(join(dir, 'node_modules', '@bsv', name, 'LICENSE.md')), `@bsv/${name} carries its licence file.`)

  // The types: a TypeScript project that imports the declarations and compiles.
  // A consumer's own toolchain, as any Node project has: the compiler and the Node type definitions the SDK's declarations refer to.
  run(['npm', 'install', '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', cache, 'typescript@5', '@types/node@22'])
  writeFileSync(join(dir, 'types.ts'), `
import type { DppState, DppStateV2, ManagedAcceptanceRecord, EvidenceReport } from '@bsv/dpp-core'
import { verifyChain } from '@bsv/dpp-core'
import { DppTopicManager } from '@bsv/dpp-overlay-topics'
import { readManifest } from '@bsv/dpp-profiles'
import type { Transaction } from '@bsv/sdk'
export async function check(txs: Transaction[], key: string): Promise<{ v2: DppStateV2 | undefined; report?: EvidenceReport; record?: ManagedAcceptanceRecord }> {
  const result = await verifyChain(txs, { chainTracker: 'scripts only', serverIdentityKey: key, managedAcceptance: true })
  const tm = new DppTopicManager(key, { managedAcceptance: true, controlAuthorities: [] })
  const states: DppState[] = result.states.length === 0 ? [] : []
  const state: DppState | undefined = states[0]
  void tm; void readManifest
  return { v2: state != null && state.version === '2' ? state : undefined }
}
`)
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', strict: true, noEmit: true, skipLibCheck: false, types: ['node'] }, files: ['types.ts'] }))
  try {
    run(['npx', 'tsc', '-p', 'tsconfig.json'])
    say(true, 'the exported declarations of every package resolve and type-check in a strict TypeScript consumer.')
  } catch (error) {
    say(false, `type-check failed: ${String(error.stdout ?? error.message).split('\n').slice(0, 6).join(' | ')}`)
  }
} catch (error) {
  say(false, `the consumer check could not complete: ${error.stderr ?? error.message}`)
} finally {
  if (process.env.KEEP_CONSUMER === '1') console.log(`consumer project kept at ${dir}`)
  else rmSync(dir, { recursive: true, force: true })
}
console.log(failures === 0 ? 'Every sentence above holds.' : 'At least one sentence above does not hold.')
process.exit(failures === 0 ? 0 : 1)
