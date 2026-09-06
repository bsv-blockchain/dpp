#!/usr/bin/env node
/**
 * The conformance checker (spec/conformance.md section 6).
 *
 *   node conformance/check.mjs
 *
 * Validates the requirement ledger and the recommended baseline against their
 * schemas, then applies the rules a schema cannot: every requirement cites a
 * source the ledger pins, at the version the ledger records; every local
 * source's digest still matches its file, and a moved file invalidates every
 * row that cites it; every claim names rows that exist, and a claim is refused
 * while any required row is unassessed or below the claim's minimum status;
 * each baseline's role requirements exist, its fixtures' digests match, and its
 * wire values are the ones the reference implementation exports; every report
 * in fixtures/evidence-v1.json and fixtures/evidence-v2.json validates against the report schema with its
 * checks in the schema's order; the example capability document validates;
 * and the recorded dependency licences match what is installed.
 *
 * Findings print one sentence each, as GOVERNANCE.md requires of every
 * conformance surface: no score, no aggregate verdict. A blocked claim is a
 * finding and not a failure, because the ledger exists to say so. The exit
 * code is 1 only for a defect in the ledger itself: a schema violation, a
 * dangling reference, a moved source or a licence that changed.
 */
import { createHash } from 'node:crypto'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import {
  ATTESTATION_ANCHOR_FIELD_COUNT,
  ATTESTATION_ANCHOR_PREFIX,
  ATTESTATION_ANCHOR_PROTOCOL,
  DPP_PROTOCOL_ID,
  DPP_PROTOCOL_ID_V2,
  EVIDENCE_CHECK_NAMES,
  FIELD_COUNT,
  FIELD_COUNT_V2,
  LIFECYCLE_CLAIM_FORMAT,
  LIFECYCLE_CLAIM_PROTOCOL,
  OWNER_PROTOCOL_ID,
  PROTOCOL_MARKER,
  REPORT_VERSION,
  STANDARD_VERSION,
  STANDARD_VERSION_V2,
} from '@bsv/dpp-core'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => JSON.parse(readFileSync(join(root, relative), 'utf8'))
const sha256 = (relative) => createHash('sha256').update(readFileSync(join(root, relative))).digest('hex')

let defects = 0
const defect = (sentence) => { defects += 1; console.log(`DEFECT: ${sentence}`) }
const note = (sentence) => console.log(`ok: ${sentence}`)
const blocked = (sentence) => console.log(`blocked: ${sentence}`)

const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
const compiled = new Map()
const validateWith = (schemaPath, value, name) => {
  if (!compiled.has(schemaPath)) compiled.set(schemaPath, ajv.compile(read(schemaPath)))
  const validate = compiled.get(schemaPath)
  if (validate(value)) { note(`${name} validates against ${schemaPath}.`); return true }
  for (const e of validate.errors ?? []) defect(`${name} ${e.instancePath || '/'} ${e.message}${e.params?.allowedValues ? ` (${e.params.allowedValues.join(', ')})` : ''}.`)
  return false
}

// 1. The ledger.
const ledger = read('conformance/manifest.json')
validateWith('conformance/manifest.schema.json', ledger, 'conformance/manifest.json')

const sources = new Map(ledger.sources.map((s) => [s.id, s]))
if (sources.size !== ledger.sources.length) defect('two ledger sources share an identifier.')
const moved = new Set()
for (const s of ledger.sources) {
  if (s.kind === 'local') {
    if (s.path == null || s.digest == null) { defect(`local source ${s.id} records no path or no digest.`); continue }
    if (!existsSync(join(root, s.path))) { defect(`local source ${s.id} names ${s.path}, which does not exist.`); moved.add(s.id); continue }
    const actual = sha256(s.path)
    if (actual !== s.digest) { moved.add(s.id); defect(`source ${s.id} (${s.path}) has digest ${actual.slice(0, 12)}…, not the recorded ${s.digest.slice(0, 12)}…; every row citing it is invalidated until reviewed (run conformance/pin-sources.mjs after review).`) }
  }
}
note(`${ledger.sources.length} sources, ${[...sources.values()].filter((s) => s.kind === 'local').length} local, ${[...sources.values()].filter((s) => s.harmonisedReference).length} carrying the harmonised-reference marker.`)

const rows = new Map()
for (const r of ledger.requirements) {
  if (rows.has(r.id)) defect(`requirement ${r.id} appears twice.`)
  rows.set(r.id, r)
  const s = sources.get(r.sourceId)
  if (s == null) { defect(`requirement ${r.id} cites source ${r.sourceId}, which the ledger does not pin.`); continue }
  if (r.sourceUri !== s.uri) defect(`requirement ${r.id} records sourceUri ${r.sourceUri} but source ${s.id} is ${s.uri}.`)
  if (r.sourceVersion !== s.version) defect(`requirement ${r.id} records sourceVersion "${r.sourceVersion}" but source ${s.id} is "${s.version}".`)
  if (s.digest != null && r.sourceDigest != null && r.sourceDigest !== s.digest) defect(`requirement ${r.id} records a sourceDigest that differs from source ${s.id}.`)
  if (r.roles.includes('all') && r.roles.length > 1) defect(`requirement ${r.id} lists "all" beside other roles.`)
  if (r.roles.includes('none') && r.roles.length > 1) defect(`requirement ${r.id} lists "none" beside other roles.`)
}
const byStatus = {}
for (const r of ledger.requirements) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
note(`${ledger.requirements.length} requirements: ${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(', ')}.`)
for (const r of ledger.requirements) {
  if (r.status === 'unassessed') console.log(`unassessed: ${r.id} (${r.clause}): ${r.notes ?? r.summary}`)
}

// 2. The claims.
const rank = { unassessed: -1, gap: 0, 'not-applicable': 1, implemented: 2, tested: 3, 'independently-tested': 4 }
for (const claim of ledger.claims) {
  const minimum = claim.minimumStatus ?? 'tested'
  const problems = []
  for (const id of claim.requires) {
    const r = rows.get(id)
    if (r == null) { defect(`claim ${claim.id} requires ${id}, which the ledger does not carry.`); continue }
    if (moved.has(r.sourceId)) problems.push(`${id} cites a source whose artefact changed`)
    else if (r.status === 'unassessed') problems.push(`${id} is unassessed`)
    else if (r.status === 'not-applicable') continue
    else if (rank[r.status] < rank[minimum]) problems.push(`${id} is ${r.status}, below ${minimum}`)
  }
  if (problems.length === 0) note(`claim ${claim.id} can be made: every required row is ${minimum} or better.`)
  else blocked(`claim ${claim.id} cannot be made: ${problems.join('; ')}.`)
}

// 3. The baselines: native-baseline@1 reads version 1, native-baseline@2 reads both.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const checkBaseline = (path, record) => {
  const baseline = read(path)
  validateWith('conformance/baseline.schema.json', baseline, path)
  const expectWire = (label, actual, expected) => (same(actual, expected) ? note(`${baseline.baselineId} ${label} is ${JSON.stringify(expected)}, as the reference exports it.`) : defect(`${baseline.baselineId} ${label} is ${JSON.stringify(actual)} but the reference exports ${JSON.stringify(expected)}.`))
  expectWire('record.protocolMarker', baseline.wire.record.protocolMarker, PROTOCOL_MARKER)
  expectWire('record.version', baseline.wire.record.version, record.version)
  expectWire('record.fieldCount', baseline.wire.record.fieldCount, record.fieldCount)
  if (record.alsoReads != null) {
    expectWire('record.alsoReads.version', baseline.wire.record.alsoReads?.version, record.alsoReads.version)
    expectWire('record.alsoReads.fieldCount', baseline.wire.record.alsoReads?.fieldCount, record.alsoReads.fieldCount)
    expectWire('derivations.actorSignatureV2.protocolId', baseline.derivations.actorSignatureV2?.protocolId, DPP_PROTOCOL_ID_V2)
    expectWire('derivations.publisherSignatureV2.protocolId', baseline.derivations.publisherSignatureV2?.protocolId, DPP_PROTOCOL_ID_V2)
    expectWire('derivations.controllerKey.protocolId', baseline.derivations.controllerKey?.protocolId, OWNER_PROTOCOL_ID)
  }
  expectWire('nativeClaim.claimFormat', baseline.wire.nativeClaim.claimFormat, LIFECYCLE_CLAIM_FORMAT)
  expectWire('anchor.prefix', baseline.wire.anchor.prefix, ATTESTATION_ANCHOR_PREFIX)
  expectWire('anchor.signedFieldCount', baseline.wire.anchor.signedFieldCount, ATTESTATION_ANCHOR_FIELD_COUNT)
  expectWire('verificationReport.reportVersion', baseline.wire.verificationReport.reportVersion, REPORT_VERSION)
  expectWire('verificationReport.checkNames', baseline.wire.verificationReport.checkNames, [...EVIDENCE_CHECK_NAMES])
  expectWire('derivations.userSignature.protocolId', baseline.derivations.userSignature.protocolId, DPP_PROTOCOL_ID)
  expectWire('derivations.ownerKey.protocolId', baseline.derivations.ownerKey.protocolId, OWNER_PROTOCOL_ID)
  expectWire('derivations.nativeClaimSignature.protocolId', baseline.derivations.nativeClaimSignature.protocolId, LIFECYCLE_CLAIM_PROTOCOL)
  expectWire('derivations.anchorSignature.protocolId', baseline.derivations.anchorSignature.protocolId, ATTESTATION_ANCHOR_PROTOCOL)
  for (const [role, spec] of Object.entries(baseline.roles)) {
    for (const id of [...spec.requires, ...(spec.optional ?? [])]) {
      if (!rows.has(id)) defect(`${baseline.baselineId} role ${role} names requirement ${id}, which the ledger does not carry.`)
    }
    const below = spec.requires.filter((id) => rows.get(id) != null && rank[rows.get(id).status] < rank.tested)
    if (below.length === 0) note(`${baseline.baselineId} role ${role}: every mandatory requirement is tested.`)
    else blocked(`${baseline.baselineId} role ${role}: ${below.map((id) => `${id} is ${rows.get(id).status}`).join(', ')}.`)
  }
  for (const f of baseline.fixtures) {
    if (!existsSync(join(root, f.path))) { defect(`${baseline.baselineId} fixture ${f.path} does not exist.`); continue }
    const actual = sha256(f.path)
    if (actual === f.sha256) note(`${baseline.baselineId} fixture ${f.path} has the recorded digest.`)
    else defect(`${baseline.baselineId} fixture ${f.path} has digest ${actual.slice(0, 12)}…, not the recorded ${f.sha256.slice(0, 12)}…; review the change and run conformance/pin-sources.mjs.`)
  }
}
checkBaseline('conformance/baseline-native-1.json', { version: STANDARD_VERSION, fieldCount: FIELD_COUNT })
checkBaseline('conformance/baseline-native-2.json', { version: STANDARD_VERSION_V2, fieldCount: FIELD_COUNT_V2, alsoReads: { version: STANDARD_VERSION, fieldCount: FIELD_COUNT } })

// 4. The report schema and every pinned report.
const reportSchema = read('contracts/verification-report.schema.json')
if (!same(reportSchema.$defs.checkName.enum, [...EVIDENCE_CHECK_NAMES])) defect('the report schema lists the check names in a different order from the reference implementation.')
else note('the report schema names the sixteen checks in the reference order.')
const validateReport = ajv.compile(reportSchema)
for (const file of ['fixtures/evidence-v1.json', 'fixtures/evidence-v2.json']) {
  const evidence = read(file)
  let reportDefects = 0
  for (const c of evidence.cases) {
    if (!validateReport(c.report)) {
      reportDefects += 1
      for (const e of validateReport.errors ?? []) defect(`${file} case ${c.id} report ${e.instancePath || '/'} ${e.message}.`)
    }
    if (!same(c.report.checks.map((k) => k.name), [...EVIDENCE_CHECK_NAMES])) { reportDefects += 1; defect(`${file} case ${c.id} lists its checks out of order.`) }
    if (c.report.checkedAt !== evidence.checkedAt) { reportDefects += 1; defect(`${file} case ${c.id} was checked at ${c.report.checkedAt}, not the fixture's ${evidence.checkedAt}.`) }
  }
  if (reportDefects === 0) note(`all ${evidence.cases.length} pinned reports in ${file} validate against the report schema in check order.`)
}

// 4b. The release sets: a compatible set names the packages at the versions
// their manifests carry, the wire versions the reference exports, the runtime
// the root requires, a baseline that exists, and artefacts whose digests hold.
for (const name of readdirSync(join(root, 'release')).filter((f) => /^dpp-release-.*\.json$/.test(f))) {
  const set = read(`release/${name}`)
  if (!validateWith('release/release-set.schema.json', set, `release/${name}`)) continue
  // A superseded set is the record of what a set once named. Its package
  // versions and artefact digests describe that moment and are not held to
  // the tree, which has moved on; the successor set is what the tree answers to.
  if (set.status === 'superseded') { note(`${set.releaseSet} is superseded and is kept as history; its versions and digests are not checked against the tree.`); continue }
  for (const pkg of set.packages) {
    const manifest = read(`${pkg.directory}/package.json`)
    if (manifest.name === pkg.name && manifest.version === pkg.version) note(`${set.releaseSet} names ${pkg.name}@${pkg.version}, which ${pkg.directory}/package.json carries.`)
    else defect(`${set.releaseSet} names ${pkg.name}@${pkg.version} but ${pkg.directory}/package.json carries ${manifest.name}@${manifest.version}.`)
    for (const entry of pkg.entryPoints) {
      if (manifest.exports?.[entry] == null) defect(`${set.releaseSet}: ${pkg.name} does not export ${entry}.`)
    }
  }
  const rootManifest = read('package.json')
  if (set.runtime.node === rootManifest.engines?.node) note(`${set.releaseSet} requires Node ${set.runtime.node}, as the repository does.`)
  else defect(`${set.releaseSet} requires Node ${set.runtime.node} but the repository requires ${rootManifest.engines?.node}.`)
  for (const dep of set.runtime.dependencies) {
    const installed = join(root, 'node_modules', dep.name, 'package.json')
    if (!existsSync(installed)) { if (dep.name !== '@bsv/wallet-toolbox-client') defect(`${set.releaseSet} names ${dep.name}@${dep.version}, which is not installed here.`); continue }
    const version = JSON.parse(readFileSync(installed, 'utf8')).version
    if (version === dep.version) note(`${set.releaseSet} runtime ${dep.name}@${dep.version} is what is installed.`)
    else defect(`${set.releaseSet} runtime names ${dep.name}@${dep.version} but ${version} is installed.`)
  }
  const versions = set.wire.records.map((r) => r.version)
  if (same(versions, [STANDARD_VERSION, STANDARD_VERSION_V2])) note(`${set.releaseSet} names record versions ${versions.join(' and ')}, as the reference exports them.`)
  else defect(`${set.releaseSet} names record versions ${versions.join(', ')}; the reference exports ${STANDARD_VERSION} and ${STANDARD_VERSION_V2}.`)
  for (const r of set.wire.records) {
    const expected = r.version === STANDARD_VERSION ? { fieldCount: FIELD_COUNT, protocolId: DPP_PROTOCOL_ID } : { fieldCount: FIELD_COUNT_V2, protocolId: DPP_PROTOCOL_ID_V2 }
    if (r.fieldCount !== expected.fieldCount || !same(r.protocolId, expected.protocolId)) defect(`${set.releaseSet} record version ${r.version} names ${r.fieldCount} fields under ${JSON.stringify(r.protocolId)}; the reference exports ${expected.fieldCount} under ${JSON.stringify(expected.protocolId)}.`)
  }
  if (set.wire.verificationReport !== REPORT_VERSION) defect(`${set.releaseSet} names report version ${set.wire.verificationReport}; the reference exports ${REPORT_VERSION}.`)
  if (set.wire.nativeClaim !== LIFECYCLE_CLAIM_FORMAT) defect(`${set.releaseSet} names native claim ${set.wire.nativeClaim}; the reference exports ${LIFECYCLE_CLAIM_FORMAT}.`)
  if (set.wire.anchor !== ATTESTATION_ANCHOR_PREFIX) defect(`${set.releaseSet} names anchor ${set.wire.anchor}; the reference exports ${ATTESTATION_ANCHOR_PREFIX}.`)
  const overlayVersion = /^\s*version:\s*(\S+)/m.exec(readFileSync(join(root, 'contracts/overlay.yaml'), 'utf8'))?.[1]
  if (set.wire.overlayContract === overlayVersion) note(`${set.releaseSet} names overlay contract ${overlayVersion}, as contracts/overlay.yaml does.`)
  else defect(`${set.releaseSet} names overlay contract ${set.wire.overlayContract} but contracts/overlay.yaml is ${overlayVersion}.`)
  const baselinePath = `conformance/baseline-${set.baseline.replace(/^native-baseline@/, 'native-')}.json`
  if (existsSync(join(root, baselinePath))) note(`${set.releaseSet} claims ${set.baseline}, which ${baselinePath} defines.`)
  else defect(`${set.releaseSet} claims ${set.baseline}, which no baseline file defines.`)
  for (const a of set.artefacts) {
    if (!existsSync(join(root, a.path))) { defect(`${set.releaseSet} artefact ${a.path} does not exist.`); continue }
    const actual = sha256(a.path)
    if (actual === a.sha256) note(`${set.releaseSet} artefact ${a.path} has the recorded digest.`)
    else defect(`${set.releaseSet} artefact ${a.path} has digest ${actual.slice(0, 12)}…, not the recorded ${a.sha256.slice(0, 12)}…; review the change and run conformance/pin-sources.mjs.`)
  }
}

// 5. The capability document.
validateWith('contracts/capabilities.schema.json', read('conformance/examples/capabilities-reference-node.json'), 'conformance/examples/capabilities-reference-node.json')

// 6. Licences, as recorded against what is installed.
if (existsSync(join(root, 'conformance/licences.json'))) {
  const licences = read('conformance/licences.json')
  let drift = 0
  for (const component of licences.components) {
    for (const dep of component.dependencies) {
      const manifestPath = join(root, 'node_modules', dep.name, 'package.json')
      if (!existsSync(manifestPath)) { drift += 1; defect(`${component.name} depends on ${dep.name}, which is not installed.`); continue }
      const installed = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const licence = typeof installed.license === 'string' ? installed.license : JSON.stringify(installed.license ?? 'UNKNOWN')
      if (licence !== dep.licence || installed.version !== dep.version) { drift += 1; defect(`${component.name} records ${dep.name}@${dep.version} under ${dep.licence}; installed is ${installed.version} under ${licence}. Review and run conformance/pin-sources.mjs.`) }
    }
  }
  if (drift === 0) note(`recorded licences match the installed dependencies of ${licences.components.length} components.`)
} else {
  defect('conformance/licences.json is missing; run conformance/pin-sources.mjs.')
}

console.log(defects === 0 ? 'The ledger, baseline, reports and capability example are consistent.' : `${defects} defect${defects === 1 ? '' : 's'} in the conformance material.`)
process.exit(defects === 0 ? 0 : 1)
