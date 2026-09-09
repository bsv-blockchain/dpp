#!/usr/bin/env node
/**
 * The clean consumer check (`spec/conformance.md` §2, the external consumer).
 *
 * First the bytes: every tarball under release/candidates/ is held to
 * release/candidates.json (SHA-256, npm integrity, size, nothing missing,
 * nothing unexpected) and the record is held to the release set it names
 * (same identifier, every package once at the set's version, the set file's
 * digest unchanged), and any failure stops the check before an install.
 *
 * Then the install: the exact tarballs into a fresh project outside this
 * checkout, development dependencies omitted, no workspace links and no path
 * back here. Then every runtime entry point the record declares is imported
 * (subpaths included, data entry points read), the reader path is run on the
 * version 2 chain and the acceptance record, the artefacts the packages carry
 * are read from inside the installed packages, the licence file is present in
 * each, no private, test or environment file is inside any tarball, and the
 * declarations of all four packages and the VSC subpaths are type-checked by
 * a strict TypeScript project. One sentence per assertion, naming what it
 * covered; never a score; exit 1 when any sentence does not hold.
 *
 *   node scripts/consumer-check.mjs                    # after scripts/release-candidates.mjs
 *   KEEP_CONSUMER=1 node scripts/consumer-check.mjs    # leave the temporary project behind
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyCandidates, verifyRecordAgainstSet } from './lib/candidates.mjs'
import { publicationActions, NPM_REGISTRY } from './lib/publication.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const record = JSON.parse(readFileSync(join(root, 'release', 'candidates.json'), 'utf8'))
const fromRegistry = process.argv.includes('--registry')
let failures = 0
const say = (ok, sentence) => { if (!ok) failures += 1; console.log(`${ok ? 'ok' : 'FAIL'}: ${sentence}`) }
const run = (args, cwd, env = {}) => execFileSync(args[0], args.slice(1), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } })

// 1. The bytes, before anything is installed.
const candidateDir = join(root, 'release', 'candidates')
const setPath = record.releaseSetPath ?? `release/${record.releaseSet}.json`
const setBytes = existsSync(join(root, setPath)) ? readFileSync(join(root, setPath)) : null
const set = setBytes == null ? null : JSON.parse(setBytes.toString('utf8'))
if (set == null) say(false, `the record names ${setPath}, which does not exist.`)
else for (const f of verifyRecordAgainstSet(record, set, setBytes)) say(f.ok, `record against set: ${f.sentence}`)
for (const f of verifyCandidates(record, candidateDir)) say(f.ok, `bytes: ${f.sentence}`)
if (failures > 0) {
  console.log('The candidates are not the recorded bytes; nothing was installed.')
  process.exit(1)
}
if (fromRegistry) {
  const actions = await publicationActions(record.candidates)
  if (actions.some((a) => a.action !== 'already-published')) throw new Error('the complete candidate set is not published on npm')
}

const dir = mkdtempSync(join(tmpdir(), 'dpp-consumer-'))
try {
  // A project of its own: no workspace, no lockfile of ours, no path back here.
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dpp-consumer-check', private: true, type: 'module', version: '0.0.0' }, null, 2))
  const tarballs = record.candidates.map((c) => fromRegistry ? `${c.name}@${c.version}` : join(candidateDir, c.filename))
  const cache = join(dir, '.npm-cache')
  run(['npm', 'install', '--save-exact', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--registry', NPM_REGISTRY, '--cache', cache, ...tarballs], dir)
  const installed = JSON.parse(run(['npm', 'ls', '--json', '--omit=dev'], dir))
  const deps = installed.dependencies ?? {}
  for (const c of record.candidates) {
    say(deps[c.name]?.version === c.version, `${c.name}@${c.version} installed from ${fromRegistry ? 'public npm' : 'its tarball'} (resolved ${deps[c.name]?.resolved ?? 'nothing'}).`)
    const locked = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8')).packages[`node_modules/${c.name}`]
    say(locked.integrity === c.integrity && (!fromRegistry || locked.resolved.startsWith(NPM_REGISTRY)), `${c.name}: the consumer lockfile pins the approved integrity${fromRegistry ? ' from public npm' : ''}.`)
  }
  const sdk = JSON.parse(readFileSync(join(dir, 'node_modules', '@bsv', 'sdk', 'package.json'), 'utf8')).version
  const expectedSdk = set.runtime.dependencies.find((d) => d.name === '@bsv/sdk')?.version
  say(sdk === expectedSdk, `@bsv/sdk resolved to ${sdk}, the release set's runtime (${expectedSdk}).`)
  say(!existsSync(join(dir, 'node_modules', 'vitest')) && !existsSync(join(dir, 'node_modules', 'typescript')), 'no development dependency of the packages was installed.')
  const unexpected = record.candidates.flatMap((c) => {
    const files = run(['tar', 'tzf', join(candidateDir, c.filename)], dir).split('\n')
    return files.filter((f) => /planning|AGENTS\.md|\.env|test\/|\.private|notes\//.test(f)).map((f) => `${c.name}: ${f}`)
  })
  say(unexpected.length === 0, `no private, test or environment file is inside any tarball${unexpected.length === 0 ? '' : `: ${unexpected.join(', ')}`}.`)
  cpSync(join(root, 'examples/lifecycle-v2.mjs'), join(dir, 'lifecycle-v2.mjs'))
  run(['node', 'lifecycle-v2.mjs'], dir)
  say(true, 'the packed core builds and verifies ISSUE, UPDATE, managed TRANSFER, RETIRE and a separate lifecycle claim and anchor; unauthorised, uncommitted, expired and post-retirement actions are refused offline.')

  // 2. Every declared entry point, from the record, not from a hand-written list.
  const modules = []
  const data = []
  for (const c of record.candidates) {
    for (const s of c.support ?? c.entryPoints.map((e) => ({ entryPoint: e, kind: e.includes('*') || e.endsWith('.json') ? 'data' : 'module' }))) {
      const specifier = s.entryPoint === '.' ? c.name : `${c.name}/${s.entryPoint.replace(/^\.\//, '')}`
      if (s.kind === 'module') modules.push(specifier)
      else data.push({ name: c.name, entryPoint: s.entryPoint, specifier })
    }
  }
  // One sample file per data entry point pattern, read through the package's exports map.
  const dataSamples = {
    '@bsv/dpp-core/schemas/*': 'verification-report.schema.json',
    '@bsv/dpp-profiles/manifests/*': 'battery@2.json',
    '@bsv/dpp-profiles/schemas/*': 'profile-manifest.schema.json',
    '@bsv/dpp-profiles/generated/*': 'payload-schema/battery@2.public.schema.json',
    '@bsv/dpp-profiles/frozen.json': '',
    '@bsv/vsc/artifacts/*': 'profile-0.1.0.json',
  }
  const dataSpecifiers = data.map((d) => (d.specifier.endsWith('/*') ? d.specifier.slice(0, -1) + (dataSamples[d.specifier] ?? '') : d.specifier))
  for (const name of readdirSync(join(root, 'contracts')).filter((name) => name.endsWith('.schema.json'))) {
    const original = readFileSync(join(root, 'contracts', name))
    const packed = readFileSync(join(dir, 'node_modules/@bsv/dpp-core/schemas', name))
    say(original.equals(packed), `@bsv/dpp-core/schemas/${name} matches the normative contract bytes.`)
  }
  for (const d of data) say(dataSamples[d.specifier] != null, `data entry point ${d.specifier} has a sample this check reads (${dataSamples[d.specifier] === '' ? 'the file itself' : dataSamples[d.specifier] ?? 'none named; add one'}).`)

  mkdirSync(join(dir, 'fixtures'), { recursive: true })
  for (const f of ['chain-v2.json', 'managed-acceptance-v1.json', 'chain-v1.json']) cpSync(join(root, 'fixtures', f), join(dir, 'fixtures', f))
  writeFileSync(join(dir, 'consumer.mjs'), `
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { Transaction } from '@bsv/sdk'
const require = createRequire(import.meta.url)
const out = []
// Every module entry point the record declares imports and exports something.
for (const specifier of ${JSON.stringify(modules)}) {
  try { const m = await import(specifier); out.push(['module entry point ' + specifier + ' imports and exports ' + Object.keys(m).length + ' names', Object.keys(m).length > 0]) }
  catch (e) { out.push(['module entry point ' + specifier + ' imports: ' + String(e.message).split('\\n')[0], false]) }
}
// Every data entry point the record declares is readable through the exports map.
for (const specifier of ${JSON.stringify(dataSpecifiers)}) {
  try { const v = require(specifier); out.push(['data entry point ' + specifier + ' reads', v != null]) }
  catch (e) { out.push(['data entry point ' + specifier + ' reads: ' + String(e.message).split('\\n')[0], false]) }
}
const { verifyChain, verifyPassportEvidence, inspectManagedAcceptance, bindAcceptanceToState, findDppOutputs, STANDARD_VERSION_V2, FIELD_COUNT_V2 } = await import('@bsv/dpp-core')
const { DppTopicManager, DppLookupService, InMemoryDppStorage, buildCapabilities, joinEvidenceExport } = await import('@bsv/dpp-overlay-topics')
const { readManifest, mapNativeOperation, checkSelection, VERSION_2_OPERATION_MAPPING, parseGs1DigitalLinkUri, decompressGs1DigitalLink, readInteroperabilityProfile, readManifestAny, evaluateApplicability, projectPassport } = await import('@bsv/dpp-profiles')
const vsc = await import('@bsv/vsc')
const exchange = await import('@bsv/vsc/exchange')
const epcisSource = await import('@bsv/vsc/epcis-source')
const chain = JSON.parse(readFileSync('fixtures/chain-v2.json', 'utf8'))
const txs = chain.states.map((s) => Transaction.fromHex(s.rawTx))
const result = await verifyChain(txs, { chainTracker: 'scripts only', managedAcceptance: true, serverIdentityKey: chain.custodianKey })
out.push(['reader path: chain-v2 valid under managed-custody@1', result.valid === true])
const acceptance = JSON.parse(readFileSync('fixtures/managed-acceptance-v1.json', 'utf8'))
out.push(['reader path: acceptance record signature valid', inspectManagedAcceptance(acceptance.record).signatureValid === true])
out.push(['reader path: acceptance binds to the transfer', bindAcceptanceToState(acceptance.record, findDppOutputs(txs[2])[0].state).length === 0])
const report = await verifyPassportEvidence({ tokenHistory: txs, acceptanceRecords: [acceptance.record] }, { passportId: chain.states[0].data.passportId, source: 'request-context' }, { chainTracker: 'scripts only', publisherKeys: [chain.custodianKey], managedAcceptance: { required: true } })
out.push(['reader path: report linkage pass and inclusion unknown without a header source', report.checks.find((c) => c.name === 'linkage').status === 'pass' && report.checks.find((c) => c.name === 'inclusion').status !== 'pass'])
out.push(['core constants: version 2 is 17 fields', STANDARD_VERSION_V2 === '2' && FIELD_COUNT_V2 === 17])
const tm = new DppTopicManager(chain.custodianKey, { managedAcceptance: true })
out.push(['overlay: topic manager documentation names version 2', (await tm.getDocumentation()).includes('record-model-v2')])
const caps = buildCapabilities({ serviceIdentityKey: chain.custodianKey, anchorServiceKeys: [], ownerConsent: false, managedAcceptance: true, exportAvailable: false, networkOracleConfigured: false, at: new Date() })
out.push(['overlay: capabilities name managed-custody@1', caps.profiles.some((p) => p.id === 'managed-custody')])
out.push(['overlay: lookup service constructs over in-memory storage', new DppLookupService(new InMemoryDppStorage()) != null])
out.push(['overlay: the complete export join is exported', typeof joinEvidenceExport === 'function'])
const battery = readManifest('battery@2')
out.push(['profiles: manifest battery@2 reads with fields', battery.fields.length > 0])
out.push(['profiles: version 2 mapping ISSUE to Origin and RETIRE to RECYCLED', mapNativeOperation(battery, { nativeOperation: 'ISSUE' }).eventType === 'Origin' && VERSION_2_OPERATION_MAPPING.RETIRE === 'RECYCLED'])
out.push(['profiles: native-baseline@2 selection known', checkSelection({ baseline: 'native-baseline@2', purpose: 'read' }).conflicts.every((c) => c.code !== 'baseline-unknown')])
out.push(['profiles: gs1 grammar reads a serialised identifier', parseGs1DigitalLinkUri('https://id.example.org/01/09520123456788/21/SER1').kind === 'uncompressed'])
out.push(['profiles: gs1 decompression decodes the compression standard worked example', decompressGs1DigitalLink('https://example.com/eh30164596f40c0e5cbe991a83').ok === true])
out.push(['profiles: interoperability manifests carried', ['gs1-digital-link@1', 'epcis-json@1', 'epcis-vsc@1'].every((id) => typeof readInteroperabilityProfile(id).role === 'string')])
out.push(['profiles: battery@3 reads as a manifest version 2 draft', readManifestAny('battery@3').manifestVersion === '2' && readManifestAny('battery@3').status === 'draft'])
out.push(['profiles: applicability evaluator answers unresolved for an unresolved rule', evaluateApplicability({ rule: 'unresolved', reason: 'no criterion' }, {}).outcome === 'unresolved'])
out.push(['profiles: projectPassport exported', typeof projectPassport === 'function'])
out.push(['vsc: root exports the SEAL verifier and document loader', typeof vsc.verifySeal === 'function' && typeof vsc.createDocumentLoader === 'function'])
out.push(['vsc/exchange: verifies the external representation', typeof exchange.verifyExternalCredential === 'function' && exchange.EXTERNAL_REPRESENTATIONS.includes('vc-di-ecdsa-rdfc-2019@1')])
const parsed = epcisSource.parseEpcisSource(new TextEncoder().encode(JSON.stringify({ '@context': ['https://ref.gs1.org/standards/epcis/2.0.1/epcis-context.jsonld'], type: 'EPCISDocument', schemaVersion: '2.0', creationDate: '2026-09-06T00:00:00Z', epcisBody: { eventList: [] } })), { mediaType: 'application/json' })
out.push(['vsc/epcis-source: parses an empty document', parsed.ok === true])
out.push(['vsc: the pinned EPCIS schema is inside the installed package', existsSync(join('node_modules', '@bsv', 'vsc', 'artifacts', 'epcis', 'epcis-json-schema-2.0.1.json'))])
console.log(JSON.stringify(out))
`)
  const outcome = JSON.parse(run(['node', 'consumer.mjs'], dir).trim().split('\n').at(-1))
  for (const [label, ok] of outcome) say(ok === true, `consumer runtime: ${label}.`)

  // 3. The artefacts each package carries, by the set's declaration.
  for (const c of record.candidates) {
    const pkgDir = join(dir, 'node_modules', ...c.name.split('/'))
    for (const s of (c.support ?? []).filter((x) => x.kind === 'data')) {
      for (const carried of s.carries ?? []) {
        // A carried pattern names a directory and a basename pattern; at least one
        // file inside the installed package must match it.
        const pattern = carried.replace(/<id>@<version>/g, '*')
        const slash = pattern.lastIndexOf('/')
        const dirPart = slash === -1 ? '' : pattern.slice(0, slash)
        const basePart = slash === -1 ? pattern : pattern.slice(slash + 1)
        const dirPath = join(pkgDir, dirPart)
        const matcher = new RegExp('^' + basePart.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$')
        const matches = existsSync(dirPath) ? readdirSync(dirPath).filter((f) => matcher.test(f)) : []
        say(matches.length > 0, `${c.name} carries ${carried} (${matches.length} file${matches.length === 1 ? '' : 's'} match inside the installed package).`)
      }
    }
    say(existsSync(join(pkgDir, 'LICENSE')) || existsSync(join(pkgDir, 'LICENSE.md')), `${c.name} carries its licence file.`)
  }

  // 4. The types: a strict TypeScript project importing every package and every VSC subpath, using a declaration from each.
  run(['npm', 'install', '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', cache, 'typescript@5', '@types/node@22'], dir)
  writeFileSync(join(dir, 'types.ts'), `
import type { DppState, DppStateV2, ManagedAcceptanceRecord, EvidenceReport, EvidencePackageManifest } from '@bsv/dpp-core'
import { verifyChain } from '@bsv/dpp-core'
import { DppTopicManager, type DppRecordStore, type EvidenceExportPart } from '@bsv/dpp-overlay-topics'
import { readManifest, type ProfileManifest, type InteroperabilityProfileId } from '@bsv/dpp-profiles'
import { verifySeal, type Seal } from '@bsv/vsc'
import { verifyExternalCredential, type ExternalVerification, type ExternalVerificationPolicy } from '@bsv/vsc/exchange'
import { parseEpcisSource, type EpcisParseResult, type EpcisLimits } from '@bsv/vsc/epcis-source'
import type { Transaction } from '@bsv/sdk'
export async function check(txs: Transaction[], key: string): Promise<{ v2: DppStateV2 | undefined; report?: EvidenceReport; record?: ManagedAcceptanceRecord; manifest?: EvidencePackageManifest }> {
  const result = await verifyChain(txs, { chainTracker: 'scripts only', serverIdentityKey: key, managedAcceptance: true })
  const tm = new DppTopicManager(key, { managedAcceptance: true, controlAuthorities: [] })
  const states: DppState[] = result.states.length === 0 ? [] : []
  const state: DppState | undefined = states[0]
  const manifest: ProfileManifest = readManifest('battery@2')
  const id: InteroperabilityProfileId = 'gs1-digital-link@1'
  void tm; void manifest; void id
  return { v2: state != null && state.version === '2' ? state : undefined }
}
export function stores(store: DppRecordStore, part: EvidenceExportPart): [DppRecordStore, EvidenceExportPart] { return [store, part] }
export async function credentials(seal: Seal, bytes: Uint8Array, policy: ExternalVerificationPolicy, limits: Partial<EpcisLimits>): Promise<[ExternalVerification, EpcisParseResult]> {
  void verifySeal
  const external = await verifyExternalCredential({ bytes, representation: 'vc-di-ecdsa-rdfc-2019@1', policy })
  const parsed = parseEpcisSource(bytes, { mediaType: 'application/json', limits })
  void seal
  return [external, parsed]
}
`)
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', strict: true, noEmit: true, skipLibCheck: false, types: ['node'] }, files: ['types.ts'] }))
  try {
    run(['npx', 'tsc', '-p', 'tsconfig.json'], dir)
    say(true, 'the declarations of @bsv/dpp-core, @bsv/dpp-overlay-topics, @bsv/dpp-profiles, @bsv/vsc, @bsv/vsc/exchange and @bsv/vsc/epcis-source resolve and type-check in a strict TypeScript consumer with skipLibCheck off.')
  } catch (error) {
    say(false, `type-check failed: ${String(error.stdout ?? error.message).split('\n').slice(0, 8).join(' | ')}`)
  }
} catch (error) {
  say(false, `the consumer check could not complete: ${error.stderr ?? error.message}`)
} finally {
  if (process.env.KEEP_CONSUMER === '1') console.log(`consumer project kept at ${dir}`)
  else rmSync(dir, { recursive: true, force: true })
}
console.log(failures === 0 ? 'Every sentence above holds.' : 'At least one sentence above does not hold.')
process.exit(failures === 0 ? 0 : 1)
