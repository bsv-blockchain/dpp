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
 * declarations of all packages and the credentials subpaths are type-checked by
 * a strict TypeScript project. One sentence per assertion, naming what it
 * covered; never a score; exit 1 when any sentence does not hold.
 *
 * Last, the two narrower installations, each in a project of its own: the
 * protocol package alone, which runs the whole lifecycle offline, and the
 * index with the two packages it depends on, whose dpp-index command is
 * started, asked for its health and capabilities and stopped. Neither holds
 * an engine library of the validator service, and neither needs that
 * service to be running anywhere.
 *
 *   node scripts/consumer-check.mjs                    # after scripts/release-candidates.mjs
 *   KEEP_CONSUMER=1 node scripts/consumer-check.mjs    # leave the temporary project behind
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { createServer } from 'node:net'
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
  const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'))
  say(!Object.keys(lock.packages).some((path) => path.endsWith('node_modules/@bsv/dpp-core')), 'the active packages install without the retired dpp-core package, directly or transitively.')
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
  say(true, 'the packed protocol library builds and verifies ISSUE, UPDATE, managed TRANSFER, RETIRE and a separate lifecycle claim and anchor; unauthorised, uncommitted, expired and post-retirement actions are refused offline.')

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
    '@bsv/dpp-protocol/schemas/*': 'verification-report.schema.json',
    '@bsv/dpp-profiles/manifests/*': 'general@2.json',
    '@bsv/dpp-profiles/schemas/*': 'profile-manifest.schema.json',
    '@bsv/dpp-profiles/generated/*': 'payload-schema/general@2.public.schema.json',
    '@bsv/dpp-profiles/frozen.json': '',
    '@bsv/dpp-credentials/artifacts/*': 'profile-0.1.0.json',
  }
  const dataSpecifiers = data.map((d) => (d.specifier.endsWith('/*') ? d.specifier.slice(0, -1) + (dataSamples[d.specifier] ?? '') : d.specifier))
  for (const name of readdirSync(join(root, 'contracts')).filter((name) => name.endsWith('.schema.json'))) {
    const original = readFileSync(join(root, 'contracts', name))
    const packed = readFileSync(join(dir, 'node_modules', '@bsv/dpp-protocol', 'schemas', name))
    say(original.equals(packed), `@bsv/dpp-protocol/schemas/${name} matches the normative contract bytes.`)
  }
  for (const d of data) say(dataSamples[d.specifier] != null, `data entry point ${d.specifier} has a sample this check reads (${dataSamples[d.specifier] === '' ? 'the file itself' : dataSamples[d.specifier] ?? 'none named; add one'}).`)

  mkdirSync(join(dir, 'fixtures'), { recursive: true })
  for (const f of ['chain-v2.json', 'managed-acceptance-v2.json', 'managed-acceptance-v1.json', 'chain-v1.json']) cpSync(join(root, 'fixtures', f), join(dir, 'fixtures', f))
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
const { verifyChain, verifyPassportEvidence, inspectManagedAcceptance, bindAcceptanceToState, findDppOutputs, STANDARD_VERSION_V2, FIELD_COUNT_V2 } = await import('@bsv/dpp-protocol')
const { DppTopicManager, DppLookupService, InMemoryDppStorage, buildCapabilities, joinEvidenceExport } = await import('@bsv/dpp-overlay')
const host = await import('@bsv/dpp-overlay/server')
out.push(['overlay/server: importing starts no process and exposes the host', typeof host.startOverlayService === 'function' && typeof host.runFromEnvironment === 'function'])
const { readManifest, mapNativeOperation, checkSelection, VERSION_2_OPERATION_MAPPING, parseGs1DigitalLinkUri, decompressGs1DigitalLink, readInteroperabilityProfile, readManifestAny, evaluateApplicability, projectPassport, compareProfiles, reviewProfileData, profilePayloadValidator, createProfileRegistry, RETIRED_PROFILE_IDS, RETIRED_PROFILE_REPLACEMENTS, SUPPORTED_PROFILE_IDS } = await import('@bsv/dpp-profiles')
const credentials = await import('@bsv/dpp-credentials')
const exchange = await import('@bsv/dpp-credentials/exchange')
const epcisSource = await import('@bsv/dpp-credentials/epcis-source')
const epcisExchange = await import('@bsv/dpp-credentials/epcis-exchange')
const epcisLifecycle = await import('@bsv/dpp-credentials/epcis-lifecycle')
const chain = JSON.parse(readFileSync('fixtures/chain-v2.json', 'utf8'))
const txs = chain.states.map((s) => Transaction.fromHex(s.rawTx))
const result = await verifyChain(txs, { chainTracker: 'scripts only', managedAcceptance: true, serverIdentityKey: chain.custodianKey })
out.push(['reader path: chain-v2 valid under managed-custody@2', result.valid === true])
const acceptance = JSON.parse(readFileSync('fixtures/managed-acceptance-v2.json', 'utf8'))
out.push(['reader path: acceptance record signature valid under the derived custodian key', inspectManagedAcceptance(acceptance.record).signatureValid === true])
const acceptanceV1 = JSON.parse(readFileSync('fixtures/managed-acceptance-v1.json', 'utf8'))
out.push(['reader path: the superseded version 1 acceptance record still reads under its own rule', inspectManagedAcceptance(acceptanceV1.record).signatureValid === true])
out.push(['reader path: acceptance binds to the transfer', bindAcceptanceToState(acceptance.record, findDppOutputs(txs[2])[0].state).length === 0])
const report = await verifyPassportEvidence({ tokenHistory: txs, acceptanceRecords: [acceptance.record] }, { passportId: chain.states[0].data.passportId, source: 'request-context' }, { chainTracker: 'scripts only', publisherKeys: [chain.custodianKey], managedAcceptance: { required: true } })
out.push(['reader path: report linkage pass and inclusion unknown without a header source', report.checks.find((c) => c.name === 'linkage').status === 'pass' && report.checks.find((c) => c.name === 'inclusion').status !== 'pass'])
out.push(['protocol constants: version 2 is 17 fields', STANDARD_VERSION_V2 === '2' && FIELD_COUNT_V2 === 17])
// The directly signed EPCIS event module is parked and stays in the repository; a name of it at the entry point would be public API again.
const protocol = await import('@bsv/dpp-protocol')
out.push(['protocol: the entry point exports none of the parked directly signed EPCIS event module', !('epcisEventHashId' in protocol) && !('verifyEpcisEventCredential' in protocol) && !('EPCIS_EVENT_REPRESENTATION' in protocol)])
// The EPCIS lifecycle claim ships from the credentials package. The protocol package holds no EPCIS code, so no name of the claim is at its entry point.
out.push(['protocol: the entry point exports no name of the EPCIS lifecycle claim or its canonical JSON', Object.keys(protocol).filter((name) => /epcis|jcs/i.test(name)).length === 0])
out.push(['dpp-credentials/epcis-lifecycle: exports the claim and its RFC 8785 functions, and the root exports none of them', ['buildEpcisLifecycleClaim', 'signEpcisLifecycleClaim', 'parseEpcisLifecycleClaim', 'verifyEpcisLifecycleClaim', 'buildEpcisLifecycleAnchors', 'epcisLifecycleCredentialVerifierFor', 'jcsBytes', 'parseCanonicalJcs'].every((name) => typeof epcisLifecycle[name] === 'function' && !(name in credentials))])
const notAClaim = await epcisLifecycle.verifyEpcisLifecycleClaim('{}')
out.push(['dpp-credentials/epcis-lifecycle: bytes that are not a claim fail the structure and leave the signature unknown', epcisLifecycle.EPCIS_LIFECYCLE_CLAIM_FORMAT === 'dpp-epcis-lifecycle@1' && notAClaim.findings.eventStructure.status === 'fail' && notAClaim.findings.signature.status === 'unknown'])
out.push(['dpp-credentials/epcis-lifecycle: its verifier is the function a verification report takes as credentialVerifier', typeof epcisLifecycle.epcisLifecycleCredentialVerifierFor() === 'function'])
const tm = new DppTopicManager(chain.custodianKey, { managedAcceptance: true })
out.push(['overlay: topic manager documentation names version 2', (await tm.getDocumentation()).includes('record-model-v2')])
const caps = buildCapabilities({ serviceIdentityKey: chain.custodianKey, anchorServiceKeys: [], managedAcceptance: true, exportAvailable: false, networkOracleConfigured: false, at: new Date() })
out.push(['overlay: capabilities name the managed-custody profile', caps.profiles.some((p) => p.id === 'managed-custody')])
out.push(['overlay: lookup service constructs over in-memory storage', new DppLookupService(new InMemoryDppStorage()) != null])
out.push(['overlay: the complete export join is exported', typeof joinEvidenceExport === 'function'])
const general = readManifest('general@2')
out.push(['profiles: manifest general@2 reads with fields', general.fields.length > 0])
out.push(['profiles: version 2 mapping ISSUE to Origin and RETIRE to RECYCLED', mapNativeOperation(general, { nativeOperation: 'ISSUE' }).eventType === 'Origin' && VERSION_2_OPERATION_MAPPING.RETIRE === 'RECYCLED'])
out.push(['profiles: native-baseline@2 selection known', checkSelection({ baseline: 'native-baseline@2', purpose: 'read' }).conflicts.every((c) => c.code !== 'baseline-unknown')])
out.push(['profiles: gs1 grammar reads a serialised identifier', parseGs1DigitalLinkUri('https://id.example.org/01/09520123456788/21/SER1').kind === 'uncompressed'])
out.push(['profiles: gs1 decompression decodes the compression standard worked example', decompressGs1DigitalLink('https://example.com/eh30164596f40c0e5cbe991a83').ok === true])
out.push(['profiles: interoperability manifests carried', ['gs1-digital-link@1', 'epcis-json@1', 'epcis-vsc@1'].every((id) => typeof readInteroperabilityProfile(id).role === 'string')])
out.push(['profiles: the retired battery@3 still reads, as the manifest version 2 draft it was frozen as', readManifestAny('battery@3').manifestVersion === '2' && readManifestAny('battery@3').status === 'draft'])
out.push(['profiles: applicability evaluator answers unresolved for an unresolved rule', evaluateApplicability({ rule: 'unresolved', reason: 'no criterion' }, {}).outcome === 'unresolved'])
out.push(['profiles: projectPassport exported', typeof projectPassport === 'function'])
// The retired sector profiles: every frozen file is still packaged and read, nothing is validated under one, and each refusal is by name.
out.push(['profiles: the seven sector profiles are retired and general@2 and general@1 are supported', RETIRED_PROFILE_IDS.join(',') === 'battery@2,battery@3,battery@4,textile@1,textile@2,textile@3,textile@4' && SUPPORTED_PROFILE_IDS.join(',') === 'general@2,general@1'])
const consumerRegistry = createProfileRegistry({ trustedBindingDigests: [] })
const retiredValidator = profilePayloadValidator({ compile: () => { throw new Error('no schema is compiled for a retired profile') }, getSchema: () => undefined })
for (const retired of RETIRED_PROFILE_IDS) {
  const [id, version] = retired.split('@')
  out.push(['profiles: the retired ' + retired + ' manifest is packaged and still reads', readManifestAny(retired).profile === retired])
  for (const tier of ['public', 'restricted']) {
    const path = import.meta.resolve('@bsv/dpp-profiles/generated/payload-schema/' + retired + '.' + tier + '.schema.json')
    out.push(['profiles: the retired ' + retired + ' ' + tier + ' schema is packaged', JSON.parse(readFileSync(new URL(path), 'utf8')).type === 'object'])
  }
  const answer = await retiredValidator({ profile: id, profileVersion: Number(version), payloadPublic: '{}' })
  out.push(['profiles: a payload that declares ' + retired + ' is unknown with profile-retired, never passed or failed', answer.status === 'unknown' && answer.reasonCode === 'schema-unavailable' && answer.detail.cause === 'profile-retired' && answer.detail.replacedBy === RETIRED_PROFILE_REPLACEMENTS[retired]])
  const status = consumerRegistry.status(id, Number(version))
  out.push(['profiles: the registry reports ' + retired + ' as retired and does not resolve it', status.state === 'retired' && consumerRegistry.resolve(id, Number(version)) === undefined])
  let reviewRefusal
  try { reviewProfileData(retired, {}) } catch (e) { reviewRefusal = e.code }
  out.push(['profiles: the data review refuses ' + retired + ' as profile-retired', reviewRefusal === 'profile-retired'])
  out.push(['profiles: no selection may name ' + retired, checkSelection({ baseline: 'native-baseline@2', industry: retired, purpose: 'read' }).conflicts.some((c) => c.code === 'industry-retired')])
}
const changes = compareProfiles('battery@2', 'battery@4')
out.push(['profiles: two frozen manifests still compare, as history', changes.from.profile === 'battery@2' && changes.to.profile === 'battery@4' && changes.activation === 'explicit-consumer-selection'])
out.push(['profiles: the registry distinguishes an unknown profile from a retired one', consumerRegistry.status('toaster', 9).state === 'unknown' && consumerRegistry.status('general', 2).state === 'registered'])

out.push(['dpp-credentials: root re-exports strict parsing and the EPCIS source helpers, and none of the parked SEAL profile', typeof credentials.parseStrictJsonBytes === 'function' && typeof credentials.parseEpcisSource === 'function' && !('verifySeal' in credentials) && !('mapEpcisEventWithReport' in credentials)])
out.push(['dpp-credentials/exchange: verifies the external representation', typeof exchange.verifyExternalCredential === 'function' && exchange.EXTERNAL_REPRESENTATIONS.includes('vc-di-ecdsa-rdfc-2019@1')])
const parsed = epcisSource.parseEpcisSource(new TextEncoder().encode(JSON.stringify({ '@context': ['https://ref.gs1.org/standards/epcis/2.0.1/epcis-context.jsonld'], type: 'EPCISDocument', schemaVersion: '2.0', creationDate: '2026-09-06T00:00:00Z', epcisBody: { eventList: [] } })), { mediaType: 'application/json' })
out.push(['dpp-credentials/epcis-source: parses an empty document', parsed.ok === true])
// GS1 publishes its files under its own terms, so no installed package contains one, and validation refuses by name until the consumer provisions them.
out.push(['dpp-credentials and dpp-profiles: no GS1 file is inside the installed packages', !existsSync(join('node_modules', '@bsv', 'dpp-credentials', 'artifacts', 'epcis')) && !existsSync(join('node_modules', '@bsv', 'dpp-profiles', 'schemas', 'gs1'))])
let unprovisioned
try { epcisSource.validateEpcisDocument(parsed.document, { artefactsDir: join(process.cwd(), 'gs1-not-provisioned') }) } catch (e) { unprovisioned = e }
out.push(['dpp-credentials/epcis-source: validation without the provisioned GS1 schema throws gs1-artefact-unavailable and returns nothing', unprovisioned instanceof credentials.Gs1ArtefactUnavailableError && unprovisioned.code === 'gs1-artefact-unavailable' && unprovisioned.artefactId === 'epcis-json-schema'])
// The durable import refuses the same way, and a refusal leaves the store as it found it.
const exchangeStore = epcisExchange.createMemoryEpcisStorage()
const unprovisionedImport = await epcisExchange.importEpcisSource({ storage: exchangeStore, sourceId: 'consumer-check', requestId: 'request-1', bytes: new TextEncoder().encode(JSON.stringify(parsed.document)), mediaType: 'application/json', receivedAt: '2026-09-06T00:00:00Z', provenance: { kind: 'file' }, policy: { policyId: 'consumer-check@1' }, artefactsDir: join(process.cwd(), 'gs1-not-provisioned') })
out.push(['dpp-credentials/epcis-exchange: an import without the provisioned GS1 schema is refused by name and keeps nothing', unprovisionedImport.outcome === 'refused' && unprovisionedImport.reason === 'gs1-artefact-unavailable' && exchangeStore.state.bytes.size === 0 && exchangeStore.state.records.size === 0 && typeof epcisExchange.exportEpcisSource === 'function' && typeof epcisExchange.epcisStorageAdapterSuite === 'function'])
// A pull from a source with no base address requests nothing, and says so by name.
const linkMissing = await epcisExchange.pullEpcisEvents({ storage: exchangeStore, source: { sourceId: 'consumer-check', permittedOrigins: [], policy: { policyId: 'consumer-check@1' } }, queryId: 'query-1', query: {}, fetch: () => { throw new Error('nothing may be requested') } })
out.push(['dpp-credentials/epcis-exchange: a pull from a source with no base address answers source-link-missing, requests nothing and keeps nothing', linkMissing.outcome === 'source-link-missing' && linkMissing.completion === 'failed' && linkMissing.pull === undefined && exchangeStore.state.records.size === 0 && typeof epcisExchange.getEpcisPull === 'function'])
// A recovery export of a store that holds no source scope says so by name, a restore with no descriptor is refused before anything is written, and neither changes the store.
const nothingToCarry = await epcisExchange.exportEpcisRecovery({ storage: exchangeStore })
const noSnapshot = await epcisExchange.restoreEpcisRecovery({ storage: exchangeStore, source: epcisExchange.epcisRecoveryFiles(new Map()), inventory: [] })
out.push(['dpp-credentials/epcis-exchange: a recovery export of an empty store answers no-source-scope, a restore without a descriptor answers descriptor-missing, and neither writes anything', nothingToCarry.ok === false && nothingToCarry.code === 'no-source-scope' && noSnapshot.ok === false && noSnapshot.code === 'descriptor-missing' && exchangeStore.state.bytes.size === 0 && exchangeStore.state.records.size === 0 && typeof epcisExchange.verifyEpcisRecovery === 'function' && typeof epcisExchange.exportEpcisPublicEvidence === 'function'])
out.push(['dpp-credentials: the root exports the GS1 provisioning functions and the three pinned EPCIS files', typeof credentials.provisionGs1Artefacts === 'function' && typeof credentials.verifyGs1Artefacts === 'function' && credentials.EPCIS_GS1_ARTEFACTS.length === 3 && credentials.verifyGs1Artefacts({ dir: join(process.cwd(), 'gs1-not-provisioned') }).ok === false])
out.push(['dpp-credentials: the dpp-gs1-artefacts executable is installed', existsSync(join('node_modules', '.bin', 'dpp-gs1-artefacts'))])
// The validator service and its client install with the profiles package and need nothing more to load. This consumer
// did not install the engine libraries, so a client with no service to ask answers that the engine could not run,
// never a result, and the service refuses to start and names a library it lacks. Which one it names first depends on
// what another package brought in: the credentials package depends on a JSON-LD processor of its own.
out.push(['dpp-profiles: the dpp-validator executable is installed', existsSync(join('node_modules', '.bin', 'dpp-validator'))])
const validatorClient = await import('@bsv/dpp-profiles/validator-client')
const unanswered = await validatorClient.createValidatorClient({ url: 'http://127.0.0.1:9', timeoutMs: 2000 }).jsonLd.toRdf({ document: {}, contexts: [] })
out.push(['dpp-profiles/validator-client: with no service at its address the engine answers that it could not run and returns no result', unanswered.ok === false && (unanswered.reason === 'engine-error' || unanswered.reason === 'timeout')])
const validatorService = await import('@bsv/dpp-profiles/validator-service')
let notStarted
try { const started = await validatorService.startValidatorService(); await started.close() } catch (e) { notStarted = e }
out.push(['dpp-profiles/validator-service: without the engine libraries installed the service does not start and names one it lacks', notStarted instanceof Error && notStarted.message.includes('The validation engine did not load') && /\\b(n3@2\\.13\\.12|shacl-engine@1\\.1\\.3|jsonld@9\\.0\\.0)\\b/.test(notStarted.message)])
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
    const notices = ['NOTICE', 'PATENTS'].filter((file) => !existsSync(join(pkgDir, file)) || !readFileSync(join(pkgDir, file)).equals(readFileSync(join(root, file))))
    say(notices.length === 0, `${c.name} carries the repository's NOTICE and PATENTS, byte for byte${notices.length === 0 ? '' : `, but not ${notices.join(' or ')}`}.`)
  }

  // 4. The types: a strict TypeScript project importing every package and every credentials subpath, using a declaration from each.
  run(['npm', 'install', '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', cache, 'typescript@7.0.2', '@types/node@26.6.6'], dir)
  writeFileSync(join(dir, 'types.ts'), `
import type { DppState, DppStateV2, ManagedAcceptanceRecord, EvidenceReport, EvidencePackageManifest } from '@bsv/dpp-protocol'
import { verifyChain } from '@bsv/dpp-protocol'
import { DppTopicManager, type DppRecordStore, type EvidenceExportPart } from '@bsv/dpp-overlay'
import { startOverlayService, type OverlayHttpOptions } from '@bsv/dpp-overlay/server'
import { readManifest, type ProfileManifest, type InteroperabilityProfileId, type ProfileStatus, type RetiredProfileId } from '@bsv/dpp-profiles'
import { parseStrictJsonBytes, type Credential } from '@bsv/dpp-credentials'
import { verifyExternalCredential, type ExternalVerification, type ExternalVerificationPolicy } from '@bsv/dpp-credentials/exchange'
import { parseEpcisSource, type EpcisParseResult, type EpcisLimits } from '@bsv/dpp-credentials/epcis-source'
import { exportEpcisRecovery, importEpcisSource, pullEpcisEvents, restoreEpcisRecovery, type EpcisExchangeStorage, type EpcisFetch, type EpcisImportRecord, type EpcisImportOutcome, type EpcisPullOutcome, type EpcisPullSource, type EpcisRecoveryExportRefusal, type EpcisRecoveryRefusal, type EpcisRecoverySource, type ExportedEpcisRecovery, type RestoredEpcisRecovery } from '@bsv/dpp-credentials/epcis-exchange'
import { verifyEpcisLifecycleClaim, epcisLifecycleCredentialVerifierFor, type EpcisLifecycleVerification, type SignedEpcisLifecycleClaim } from '@bsv/dpp-credentials/epcis-lifecycle'
import type { ExternalCredentialVerifier } from '@bsv/dpp-protocol'
import type { Transaction } from '@bsv/sdk'
export const hostOptions: OverlayHttpOptions = { host: '127.0.0.1', network: 'test' }
export const startHost: typeof startOverlayService = startOverlayService
export async function check(txs: Transaction[], key: string): Promise<{ v2: DppStateV2 | undefined; report?: EvidenceReport; record?: ManagedAcceptanceRecord; manifest?: EvidencePackageManifest }> {
  const result = await verifyChain(txs, { chainTracker: 'scripts only', serverIdentityKey: key, managedAcceptance: true })
  const tm = new DppTopicManager(key, { managedAcceptance: true, controlAuthorities: [] })
  const states: DppState[] = result.states.length === 0 ? [] : []
  const state: DppState | undefined = states[0]
  const manifest: ProfileManifest = readManifest('general@2')
  const id: InteroperabilityProfileId = 'gs1-digital-link@1'
  const retired: RetiredProfileId = 'battery@2'
  const status: ProfileStatus = { state: 'retired', profile: retired, replacedBy: 'eu-battery@1' }
  void tm; void manifest; void id; void status
  return { v2: state != null && state.version === '2' ? state : undefined }
}
export function stores(store: DppRecordStore, part: EvidenceExportPart): [DppRecordStore, EvidenceExportPart] { return [store, part] }
export async function credentials(credential: Credential, bytes: Uint8Array, policy: ExternalVerificationPolicy, limits: Partial<EpcisLimits>): Promise<[ExternalVerification, EpcisParseResult]> {
  void parseStrictJsonBytes
  const external = await verifyExternalCredential({ bytes, representation: 'vc-di-ecdsa-rdfc-2019@1', policy })
  const parsed = parseEpcisSource(bytes, { mediaType: 'application/json', limits })
  void credential
  return [external, parsed]
}
export async function retain(storage: EpcisExchangeStorage, bytes: Uint8Array): Promise<EpcisImportRecord | undefined> {
  const outcome: EpcisImportOutcome = await importEpcisSource({ storage, sourceId: 'source', requestId: 'request', bytes, mediaType: 'application/json', receivedAt: '2026-09-06T00:00:00Z', provenance: { kind: 'file' }, policy: { policyId: 'policy@1' } })
  return outcome.outcome === 'retained' ? outcome.record : undefined
}
// The claim's verifier fills the protocol's slot for external credential verifiers without a cast.
export const lifecycleVerifier: ExternalCredentialVerifier = epcisLifecycleCredentialVerifierFor()
export async function claim(bytes: number[]): Promise<[EpcisLifecycleVerification, SignedEpcisLifecycleClaim | undefined]> {
  const verification = await verifyEpcisLifecycleClaim(bytes)
  return [verification, verification.claim]
}
// The standard fetch is the transport a pull is handed, with no adapter between them.
export const transport: EpcisFetch = fetch
export async function pull(storage: EpcisExchangeStorage, source: EpcisPullSource): Promise<EpcisPullOutcome> {
  return pullEpcisEvents({ storage, source, queryId: 'query', query: { perPage: 10 }, fetch })
}
// A snapshot's own inventory is what a restore is handed, when no larger manifest carries it.
export async function snapshot(storage: EpcisExchangeStorage): Promise<ExportedEpcisRecovery | EpcisRecoveryExportRefusal> {
  return exportEpcisRecovery({ storage })
}
export async function restore(storage: EpcisExchangeStorage, source: EpcisRecoverySource, taken: ExportedEpcisRecovery): Promise<RestoredEpcisRecovery | EpcisRecoveryRefusal> {
  return restoreEpcisRecovery({ storage, source, inventory: taken.inventory })
}
`)
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', strict: true, noEmit: true, skipLibCheck: false, types: ['node'] }, files: ['types.ts'] }))
  try {
    run(['npx', 'tsc', '-p', 'tsconfig.json'], dir)
    say(true, 'the declarations of @bsv/dpp-protocol, @bsv/dpp-overlay, @bsv/dpp-profiles, @bsv/dpp-credentials, @bsv/dpp-credentials/exchange, @bsv/dpp-credentials/epcis-source, @bsv/dpp-credentials/epcis-exchange and @bsv/dpp-credentials/epcis-lifecycle resolve and type-check in a strict TypeScript consumer with skipLibCheck off.')
  } catch (error) {
    say(false, `type-check failed: ${String(error.stdout ?? error.message).split('\n').slice(0, 8).join(' | ')}`)
  }
} catch (error) {
  say(false, `the consumer check could not complete: ${error.stderr ?? error.message}`)
} finally {
  if (process.env.KEEP_CONSUMER === '1') console.log(`consumer project kept at ${dir}`)
  else rmSync(dir, { recursive: true, force: true })
}

// 5. The two narrower installations: the protocol alone, and the index alone. Each is a project of its own, so
// nothing the full installation above brought in can stand in for something these lack.
const ENGINE_LIBRARIES = ['jsonld', 'n3', 'shacl-engine']
const narrow = (label, names) => {
  const project = mkdtempSync(join(tmpdir(), `dpp-consumer-${label}-`))
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: `dpp-consumer-${label}`, private: true, type: 'module', version: '0.0.0' }, null, 2))
  const specs = names.map((name) => { const c = record.candidates.find((x) => x.name === name); return fromRegistry ? `${c.name}@${c.version}` : join(candidateDir, c.filename) })
  run(['npm', 'install', '--save-exact', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--registry', NPM_REGISTRY, '--cache', join(project, '.npm-cache'), ...specs], project)
  return { project, has: (name) => existsSync(join(project, 'node_modules', ...name.split('/'), 'package.json')) }
}
const freePort = () => new Promise((done, fail) => { const server = createServer(); server.once('error', fail); server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => done(port)) }) })
const hasAll = (names) => names.every((name) => record.candidates.some((c) => c.name === name))

if (hasAll(['@bsv/dpp-protocol'])) {
  let protocolOnly
  try {
    protocolOnly = narrow('protocol', ['@bsv/dpp-protocol'])
    const beside = ['@bsv/dpp-profiles', '@bsv/dpp-overlay', '@bsv/dpp-credentials', 'mongodb', ...ENGINE_LIBRARIES].filter((name) => protocolOnly.has(name))
    say(protocolOnly.has('@bsv/dpp-protocol') && beside.length === 0, `protocol-only installation: @bsv/dpp-protocol installs with @bsv/sdk and no other package of the set, no database driver and no engine library of the validator service${beside.length === 0 ? '' : `, but it brought ${beside.join(', ')}`}.`)
    cpSync(join(root, 'examples/lifecycle-v2.mjs'), join(protocolOnly.project, 'lifecycle-v2.mjs'))
    run(['node', 'lifecycle-v2.mjs'], protocolOnly.project)
    say(true, 'protocol-only installation: the lifecycle example issues, updates, transfers and retires a passport and verifies each step offline, with no index and no validator service.')
  } catch (error) {
    say(false, `the protocol-only installation could not be checked: ${error.stderr ?? error.message}`)
  } finally {
    if (protocolOnly != null && process.env.KEEP_CONSUMER !== '1') rmSync(protocolOnly.project, { recursive: true, force: true })
  }
}

if (hasAll(['@bsv/dpp-protocol', '@bsv/dpp-profiles', '@bsv/dpp-overlay'])) {
  let indexOnly
  let child
  try {
    indexOnly = narrow('index', ['@bsv/dpp-protocol', '@bsv/dpp-profiles', '@bsv/dpp-overlay'])
    const beside = ['@bsv/dpp-credentials', ...ENGINE_LIBRARIES].filter((name) => indexOnly.has(name))
    say(indexOnly.has('@bsv/dpp-overlay') && beside.length === 0, `index-only installation: @bsv/dpp-overlay installs with the two packages it depends on, without the credentials package and without an engine library of the validator service${beside.length === 0 ? '' : `, but it brought ${beside.join(', ')}`}.`)
    const driver = JSON.parse(readFileSync(join(indexOnly.project, 'node_modules', 'mongodb', 'package.json'), 'utf8')).version
    const expectedDriver = set.runtime.dependencies.find((d) => d.name === 'mongodb')?.version
    say(driver === expectedDriver, `index-only installation: the database driver resolved to mongodb@${driver}, the release set's runtime (${expectedDriver}), which is what the index image installs.`)
    const port = await freePort()
    const key = JSON.parse(readFileSync(join(root, 'fixtures', 'chain-v2.json'), 'utf8')).custodianKey
    let output = ''
    // A clean environment: none of this shell's settings, no database, and no validator address anywhere.
    child = spawn(join(indexOnly.project, 'node_modules', '.bin', 'dpp-index'), [], { cwd: indexOnly.project, env: { PATH: process.env.PATH, HOME: process.env.HOME ?? tmpdir(), SERVICE_IDENTITY_KEY: key, NETWORK: 'test', CHAIN_TRACKER: 'scripts-only', HOST: '127.0.0.1', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    const ended = new Promise((done) => child.once('exit', (code) => done(code)))
    let health
    for (let attempt = 0; attempt < 100 && health == null && child.exitCode == null; attempt++) {
      try { const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) }); if (response.status === 200) health = await response.json() } catch { await new Promise((wait) => setTimeout(wait, 200)) }
    }
    say(health?.status === 'ok' && health.topic === 'tm_dpp', `index-only installation: the dpp-index command starts from the installed package and answers GET /health${health == null ? `, but it did not: ${output.trim().split('\n').slice(-3).join(' | ')}` : ''}.`)
    if (health != null) {
      const capabilities = await (await fetch(`http://127.0.0.1:${port}/capabilities`)).json()
      say(Array.isArray(capabilities.profiles) && capabilities.profiles.length > 0, 'index-only installation: it names its capabilities, with no validator service running and none configured.')
    }
    child.kill('SIGTERM')
    const code = await ended
    say(code === 0, `index-only installation: told to stop, the command closed with exit code ${code}.`)
  } catch (error) {
    say(false, `the index-only installation could not be checked: ${error.stderr ?? error.message}`)
  } finally {
    if (child != null && child.exitCode == null) child.kill('SIGKILL')
    if (indexOnly != null && process.env.KEEP_CONSUMER !== '1') rmSync(indexOnly.project, { recursive: true, force: true })
  }
}
console.log(failures === 0 ? 'Every sentence above holds.' : 'At least one sentence above does not hold.')
process.exit(failures === 0 ? 0 : 1)
