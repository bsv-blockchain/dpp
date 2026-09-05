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
 * the baseline's role requirements exist, its fixtures' digests match, and its
 * wire values are the ones the reference implementation exports; every report
 * in fixtures/evidence-v1.json validates against the report schema with its
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
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import {
  ATTESTATION_ANCHOR_FIELD_COUNT,
  ATTESTATION_ANCHOR_PREFIX,
  ATTESTATION_ANCHOR_PROTOCOL,
  DPP_PROTOCOL_ID,
  EVIDENCE_CHECK_NAMES,
  FIELD_COUNT,
  LIFECYCLE_CLAIM_FORMAT,
  LIFECYCLE_CLAIM_PROTOCOL,
  OWNER_PROTOCOL_ID,
  PROTOCOL_MARKER,
  REPORT_VERSION,
  STANDARD_VERSION,
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
const validateWith = (schemaPath, value, name) => {
  const validate = ajv.compile(read(schemaPath))
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

// 3. The baseline.
const baseline = read('conformance/baseline-native-1.json')
validateWith('conformance/baseline.schema.json', baseline, 'conformance/baseline-native-1.json')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const expectWire = (label, actual, expected) => (same(actual, expected) ? note(`baseline ${label} is ${JSON.stringify(expected)}, as the reference exports it.`) : defect(`baseline ${label} is ${JSON.stringify(actual)} but the reference exports ${JSON.stringify(expected)}.`))
expectWire('record.protocolMarker', baseline.wire.record.protocolMarker, PROTOCOL_MARKER)
expectWire('record.version', baseline.wire.record.version, STANDARD_VERSION)
expectWire('record.fieldCount', baseline.wire.record.fieldCount, FIELD_COUNT)
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
    if (!rows.has(id)) defect(`baseline role ${role} names requirement ${id}, which the ledger does not carry.`)
  }
  const below = spec.requires.filter((id) => rows.get(id) != null && rank[rows.get(id).status] < rank.tested)
  if (below.length === 0) note(`baseline role ${role}: every mandatory requirement is tested.`)
  else blocked(`baseline role ${role}: ${below.map((id) => `${id} is ${rows.get(id).status}`).join(', ')}.`)
}
for (const f of baseline.fixtures) {
  if (!existsSync(join(root, f.path))) { defect(`baseline fixture ${f.path} does not exist.`); continue }
  const actual = sha256(f.path)
  if (actual === f.sha256) note(`baseline fixture ${f.path} has the recorded digest.`)
  else defect(`baseline fixture ${f.path} has digest ${actual.slice(0, 12)}…, not the recorded ${f.sha256.slice(0, 12)}…; review the change and run conformance/pin-sources.mjs.`)
}

// 4. The report schema and every pinned report.
const reportSchema = read('contracts/verification-report.schema.json')
if (!same(reportSchema.$defs.checkName.enum, [...EVIDENCE_CHECK_NAMES])) defect('the report schema lists the check names in a different order from the reference implementation.')
else note('the report schema names the sixteen checks in the reference order.')
const validateReport = ajv.compile(reportSchema)
const evidence = read('fixtures/evidence-v1.json')
let reportDefects = 0
for (const c of evidence.cases) {
  if (!validateReport(c.report)) {
    reportDefects += 1
    for (const e of validateReport.errors ?? []) defect(`evidence case ${c.id} report ${e.instancePath || '/'} ${e.message}.`)
  }
  if (!same(c.report.checks.map((k) => k.name), [...EVIDENCE_CHECK_NAMES])) { reportDefects += 1; defect(`evidence case ${c.id} lists its checks out of order.`) }
  if (c.report.checkedAt !== evidence.checkedAt) { reportDefects += 1; defect(`evidence case ${c.id} was checked at ${c.report.checkedAt}, not the fixture's ${evidence.checkedAt}.`) }
}
if (reportDefects === 0) note(`all ${evidence.cases.length} pinned reports validate against the report schema in check order.`)

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
