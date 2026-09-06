#!/usr/bin/env node
/**
 * Render docs/implement/requirements-matrix.md from the ledger, the baseline
 * and the fixtures: for every role of native-baseline@2, every mandatory and
 * optional requirement with its clause, layer, status, and the fixtures and
 * vector counts that exercise it, so an independent implementer has one list
 * to fill in and nothing on it drifts from the ledger.
 *
 *   node scripts/render-requirements-matrix.mjs           # writes the page
 *   node scripts/render-requirements-matrix.mjs --check   # exits 1 when the page differs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'))
const R = 'https://github.com/bsv-blockchain/dpp/blob/main'
const ledger = read('conformance/manifest.json')
const baseline = read('conformance/baseline-native-2.json')
const rows = new Map(ledger.requirements.map((r) => [r.id, r]))

// The fixtures and their vector counts, read from the files themselves.
const vectorFiles = {
  'fixtures/vectors/dpp/record/v1.json': 'record-v1', 'fixtures/vectors/dpp/record/v2.json': 'record-v2',
  'fixtures/vectors/dpp/chain/v1.json': 'chain-v1', 'fixtures/vectors/dpp/chain/v2.json': 'chain-v2',
  'fixtures/vectors/dpp/anchor/v3.json': 'anchor-v3', 'fixtures/vectors/dpp/attestation-anchor/v1.json': 'attestation-anchor-v1',
  'fixtures/vectors/dpp/managed-acceptance/v1.json': 'managed-acceptance-v1',
  'fixtures/vectors/dpp/publisher-policy/v1.json': 'publisher-policy-v1', 'fixtures/vectors/dpp/evidence-package/v1.json': 'evidence-package-v1',
}
const counts = {}
for (const [path, key] of Object.entries(vectorFiles)) {
  const v = read(path)
  const positive = v.vectors.filter((x) => (x.tags ?? []).some((t) => t === 'happy-path' || t.endsWith('/valid'))).length
  const refusal = v.vectors.filter((x) => (x.tags ?? []).some((t) => t === 'error-case' || t.endsWith('/refusal'))).length
  counts[key] = { positive, refusal, id: v.id }
}
counts['evidence-v1'] = { cases: read('fixtures/evidence-v1.json').cases.length }
counts['evidence-v2'] = { cases: read('fixtures/evidence-v2.json').cases.length }

// Which fixtures exercise which requirement family: by the source document and clause the row cites.
const fixturesFor = (row) => {
  const s = row.sourceId ?? ''
  const out = []
  const add = (...keys) => out.push(...keys)
  if (s === 'spec-record-model') add('record-v1', 'chain-v1', 'evidence-v1')
  if (s === 'spec-record-model-v2') add('record-v2', 'chain-v2', 'evidence-v2')
  if (s === 'spec-custody') add('chain-v1')
  if (s === 'spec-managed-custody') add('managed-acceptance-v1', 'chain-v2', 'evidence-v2')
  if (s === 'spec-rules') add('attestation-anchor-v1', 'evidence-v1')
  if (s === 'spec-legacy-uora-anchor-v3') add('anchor-v3')
  if (s === 'spec-verification') add('evidence-v1', 'evidence-v2')
  if (s === 'spec-identity') add('attestation-anchor-v1', 'record-v1')
  if (/publisher-policy/.test(row.id)) add('publisher-policy-v1')
  if (/evidence-package|EXPORT-2|EXPORT-4/.test(row.id)) add('evidence-package-v1')
  return [...new Set(out)]
}
const describe = (key) => {
  const c = counts[key]
  if (c == null) return `\`${key}\``
  if (c.cases != null) return `\`${key}\` (${c.cases} report cases)`
  return `\`${key}\` (${c.positive} positive, ${c.refusal} refusal)`
}
const independentPredicate = (row) => {
  if (row.layer === 'core') return 'Yes: reproduce the rule and refuse every refusal vector'
  if (row.layer === 'role') return row.roles.includes('passport-writer') && /^WR-/.test(row.id) ? 'Self-report, one sentence, plus the demonstration' : 'Yes, against the contract or fixture named'
  if (row.layer === 'profile') return 'Yes, when the profile is selected'
  return 'Reference material; not an implementer predicate'
}

const lines = []
lines.push('# Requirements to assertions')
lines.push('')
lines.push(`**Generated** from [\`conformance/manifest.json\`](${R}/conformance/manifest.json) (ledger updated ${ledger.updatedAt}) and [\`conformance/baseline-native-2.json\`](${R}/conformance/baseline-native-2.json) by \`node scripts/render-requirements-matrix.mjs\`; edit the ledger, not this page. Vector counts are read from the fixture files.`)
lines.push('')
lines.push('For every role of `native-baseline@2`: each mandatory and optional requirement row, the clause it binds, its layer and its status in the ledger today, the fixtures that exercise it with their positive and refusal counts, and whether an independent implementer executes it as a predicate. A row an implementer does not implement stays visible as not implemented; a role not claimed is not reported. Statuses are the ledger\'s (`tested` is the reference suite; `independently-tested` needs another implementing party) and none of them is the implementer\'s to change.')
lines.push('')
lines.push('## Specified outcomes an implementer must reproduce')
lines.push('')
lines.push('| Situation | Specified outcome | Reason code |')
lines.push('|---|---|---|')
lines.push('| A record version, anchor prefix or claim format the reader does not know | Refused, never guessed | `decode-failed` |')
lines.push('| A credential representation or proof suite not supported or not selected | Named result that blocks what depended on it | `representation-unsupported`, `suite-unsupported`, `not-selected` |')
lines.push('| A merkle path absent, refuted by the header source, or the source unreachable | Inclusion `unknown` or `fail`, never pass | `proof-absent`, `proof-refuted`, `header-source-unavailable` |')
lines.push('| No authority policy supplied, authority unconfirmed or unavailable | Issuer authority `unknown` | `policy-missing`, `authority-unconfirmed`, `authority-unavailable` |')
lines.push('| Status unset, revoked, suspended, stale, unauthenticated or unknown | The named status result; a native claim `not-applicable` | `status-*`, `format-defines-no-status` |')
lines.push('| Secured bytes absent, digest or metadata mismatch | The binding check fails or is unknown | `secured-bytes-absent`, `digest-mismatch`, `metadata-mismatch` |')
lines.push('| Control not proven, lineage retired, commitment absent under the profile, invalid version transition | Linkage fails | `control-not-proven`, `lineage-retired`, `acceptance-commitment-absent`, `version-transition-invalid` |')
lines.push('| Subject not independently expected, mismatched, ambiguous genesis | Subject binding unknown or fails | `subject-not-independent`, `subject-mismatch`, `genesis-ambiguous`, `genesis-mismatch` |')
lines.push('| A check the verifier was not asked to run, or a resource limit reached | `unknown` | `not-inspected`, `resource-limit` |')
lines.push('')
for (const [role, spec] of Object.entries(baseline.roles)) {
  lines.push(`## ${role}`)
  lines.push('')
  lines.push(`${spec.responsibility} Test targets: ${spec.testTargets.map((t) => `\`${t}\``).join(', ')}.`)
  lines.push('')
  lines.push('| Requirement | Clause | Layer | Ledger status | Fixtures and vectors | Independent predicate |')
  lines.push('|---|---|---|---|---|---|')
  const emit = (id, optional) => {
    const row = rows.get(id)
    if (row == null) { lines.push(`| \`${id}\` | | | not in the ledger | | |`); return }
    const fixtures = fixturesFor(row).map(describe).join(', ') || 'contract or suite named by the row'
    lines.push(`| \`${id}\`${optional ? ' (optional)' : ''} | ${row.sourceUri} ${row.clause} | ${row.layer} | ${row.status} | ${fixtures} | ${independentPredicate(row)} |`)
  }
  for (const id of spec.requires) emit(id, false)
  for (const id of spec.optional ?? []) emit(id, true)
  lines.push('')
}
lines.push('## Fixture inventory')
lines.push('')
lines.push('| Fixture | Vector file identifier | Positive | Refusal |')
lines.push('|---|---|---|---|')
for (const [path, key] of Object.entries(vectorFiles)) lines.push(`| \`${key}\` | \`${counts[key].id}\` (\`${path}\`) | ${counts[key].positive} | ${counts[key].refusal} |`)
lines.push(`| \`evidence-v1\` | \`fixtures/evidence-v1.json\` | ${counts['evidence-v1'].cases} report cases | included |`)
lines.push(`| \`evidence-v2\` | \`fixtures/evidence-v2.json\` | ${counts['evidence-v2'].cases} report cases | included |`)
lines.push('')
lines.push('The bespoke JSON files carry the same bytes with their refusal variants beside them, and the chain fixtures\' refusals name the prefix each extends and the option under which it is refused; [running the fixtures](fixture-runner.md) says how a harness reads both forms.')
lines.push('')
const out = lines.join('\n') + '\n'
const target = join(root, 'docs', 'implement', 'requirements-matrix.md')
if (process.argv.includes('--check')) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : ''
  if (current !== out) { console.error('docs/implement/requirements-matrix.md is not what the ledger renders; run node scripts/render-requirements-matrix.mjs'); process.exit(1) }
  console.log('docs/implement/requirements-matrix.md matches the ledger and the fixtures.')
} else {
  writeFileSync(target, out)
  console.log('wrote docs/implement/requirements-matrix.md')
}
