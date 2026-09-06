/**
 * The selected-claim qualification (spec/conformance.md section 6): positive
 * and refusal tests of the actual command over ledgers built for the
 * purpose, and the consistency of its verdicts with the diagnostic checker
 * over the real ledger. Run by `node --test conformance/test/*.test.mjs`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assessClaims, assessSelection, readRows, readSources, rowCarriesProfile } from '../assess.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const qualify = join(root, 'conformance', 'qualify.mjs')
const check = join(root, 'conformance', 'check.mjs')

const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const run = (args, cwd = root) => {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' })
  return { status: result.status, out: `${result.stdout}${result.stderr}` }
}

/** A ledger of its own under a temporary root, with one local source whose bytes the test controls. */
function scaffold() {
  const dir = mkdtempSync(join(tmpdir(), 'dpp-qualify-'))
  mkdirSync(join(dir, 'conformance', 'selections'), { recursive: true })
  mkdirSync(join(dir, 'spec'), { recursive: true })
  mkdirSync(join(dir, 'release'), { recursive: true })
  const text = '# a local source\n'
  writeFileSync(join(dir, 'spec', 'local.md'), text)
  const row = (id, status, extra = {}) => ({
    id,
    sourceId: 'local',
    sourceUri: 'spec/local.md',
    sourceVersion: 'draft',
    clause: '§1',
    summary: `${id} summary`,
    layer: 'core',
    roles: ['all'],
    applicability: 'always',
    profileId: 'core',
    implementationRefs: status === 'unassessed' || status === 'gap' || status === 'not-applicable' ? [] : ['impl'],
    testRefs: status === 'tested' ? ['test'] : [],
    evidenceRefs: [],
    status,
    reviewedAt: '2026-09-06',
    reviewOwner: 'test',
    ...extra,
  })
  const ledger = {
    ledgerVersion: '1',
    updatedAt: '2026-09-06',
    sources: [
      { id: 'local', uri: 'spec/local.md', version: 'draft', kind: 'local', path: 'spec/local.md', digest: sha256(text) },
      { id: 'gone', uri: 'https://example.invalid/gone', version: 'x', kind: 'unavailable' },
      { id: 'licensed-bare', uri: 'https://example.invalid/licensed', version: 'EN 0:2026', kind: 'licensed' },
      { id: 'licensed-provenance', uri: 'https://example.invalid/licensed2', version: 'EN 1:2026', kind: 'licensed', retrievedAt: '2026-09-06', notes: 'view-only copy under licence' },
    ],
    requirements: [
      row('R-ok', 'tested'),
      row('R-ok-2', 'tested'),
      row('R-unassessed', 'unassessed'),
      row('R-gap', 'gap'),
      row('R-implemented', 'implemented'),
      row('R-na-bare', 'not-applicable'),
      row('R-na-reasoned', 'not-applicable', { notes: 'this build never selects the option' }),
      row('R-unavailable-tested', 'tested', { sourceId: 'gone', sourceUri: 'https://example.invalid/gone', sourceVersion: 'x' }),
      row('R-licensed-bare-tested', 'tested', { sourceId: 'licensed-bare', sourceUri: 'https://example.invalid/licensed', sourceVersion: 'EN 0:2026' }),
      row('R-licensed-provenance-tested', 'tested', { sourceId: 'licensed-provenance', sourceUri: 'https://example.invalid/licensed2', sourceVersion: 'EN 1:2026' }),
      row('R-sys-required', 'tested', { profileId: 'sys' }),
      row('R-sys-silent', 'gap', { profileId: 'sys (proposed)' }),
      row('R-sys-other', 'tested', { profileId: 'sys' }),
    ],
    claims: [
      { id: 'C-pass', description: 'passes', requires: ['R-ok', 'R-ok-2'] },
      { id: 'C-blocked', description: 'blocked', requires: ['R-ok', 'R-unassessed'] },
      { id: 'C-below', description: 'below minimum', requires: ['R-ok', 'R-implemented'] },
      { id: 'C-implemented', description: 'implemented is enough', requires: ['R-implemented'], minimumStatus: 'implemented' },
      { id: 'C-na-bare', description: 'not-applicable without notes', requires: ['R-ok', 'R-na-bare'] },
      { id: 'C-na-reasoned', description: 'not-applicable with notes', requires: ['R-ok', 'R-na-reasoned'] },
      { id: 'C-unavailable', description: 'tested against nothing', requires: ['R-unavailable-tested'] },
      { id: 'C-licensed-bare', description: 'licensed without provenance', requires: ['R-licensed-bare-tested'] },
      { id: 'C-licensed-provenance', description: 'licensed with provenance', requires: ['R-licensed-provenance-tested'] },
      { id: 'C-sys', description: 'a system claim', profileId: 'sys', requires: ['R-sys-required'] },
      { id: 'C-sys-other', description: 'covers the other row', profileId: 'sys', requires: ['R-sys-other'] },
    ],
  }
  const write = (relative, value) => writeFileSync(join(dir, relative), JSON.stringify(value, null, 2) + '\n')
  write('conformance/manifest.json', ledger)
  const selection = (id, claims, exclusions = [], extra = {}) => {
    const path = `conformance/selections/${id}.json`
    write(path, { selectionVersion: '1', selectionId: id, purpose: 'test', claims, exclusions, reviewedAt: '2026-09-06', reviewOwner: 'test', ...extra })
    return path
  }
  const required = (id, kind = 'component') => ({ id, kind, disposition: 'required' })
  const withheld = (id, kind = 'component') => ({ id, kind, disposition: 'withheld', rationale: 'not this time' })
  const ask = (path) => run([qualify, path, '--root', dir])
  return { dir, ledger, write, selection, required, withheld, ask, text }
}

test('a selection of evidenced claims is qualified, and every unselected claim is named', () => {
  const s = scaffold()
  try {
    const path = s.selection('good', [s.required('C-pass'), s.required('C-implemented'), s.withheld('C-blocked')])
    const { status, out } = s.ask(path)
    assert.equal(status, 0, out)
    assert.match(out, /ok: required claim C-pass \(component\) can be made/)
    assert.match(out, /withheld: C-blocked \(component\): not this time/)
    assert.match(out, /note: withheld claim C-blocked is also blocked: R-unassessed is unassessed\./)
    assert.match(out, /not selected: C-below is not part of selection good\./)
    assert.match(out, /Selection good is qualified: every required claim can be made on the ledger's evidence\. This is the ledger's answer, not a conformity certificate\./)
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('a required claim with an unassessed row, or below the minimum status, refuses the qualification by sentence', () => {
  const s = scaffold()
  try {
    const blocked = s.ask(s.selection('blocked', [s.required('C-blocked')]))
    assert.equal(blocked.status, 1)
    assert.match(blocked.out, /refused: required claim C-blocked \(component\) cannot be made: R-unassessed is unassessed\./)
    assert.match(blocked.out, /Selection blocked is refused: a required claim cannot be made on the ledger's evidence\./)
    const below = s.ask(s.selection('below', [s.required('C-below')]))
    assert.equal(below.status, 1)
    assert.match(below.out, /R-implemented is implemented, below tested\./)
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('a selection naming a claim the ledger does not carry, naming one twice, or naming a superseded release set is defective', () => {
  const s = scaffold()
  try {
    const unknown = s.ask(s.selection('unknown', [s.required('C-nope')]))
    assert.equal(unknown.status, 1)
    assert.match(unknown.out, /DEFECT: selection unknown names claim C-nope, which the ledger does not carry\./)
    const twice = s.ask(s.selection('twice', [s.required('C-pass'), s.required('C-pass')]))
    assert.equal(twice.status, 1)
    assert.match(twice.out, /DEFECT: selection twice names claim C-pass twice\./)
    const missing = s.ask(s.selection('missing-set', [s.required('C-pass')], [], { releaseSet: 'dpp-release-none' }))
    assert.equal(missing.status, 1)
    assert.match(missing.out, /names release set dpp-release-none, which release\/dpp-release-none\.json does not define\./)
    s.write('release/dpp-release-old.json', { releaseSet: 'dpp-release-old', status: 'superseded' })
    const superseded = s.ask(s.selection('old-set', [s.required('C-pass')], [], { releaseSet: 'dpp-release-old' }))
    assert.equal(superseded.status, 1)
    assert.match(superseded.out, /which is superseded/)
    s.write('release/dpp-release-now.json', { releaseSet: 'dpp-release-now', status: 'candidate' })
    const current = s.ask(s.selection('now-set', [s.required('C-pass')], [], { releaseSet: 'dpp-release-now' }))
    assert.equal(current.status, 0, current.out)
    assert.match(current.out, /release set: selection now-set qualifies dpp-release-now \(candidate\)\./)
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('a changed source artefact refuses every required claim that cites it until reviewed', () => {
  const s = scaffold()
  try {
    writeFileSync(join(s.dir, 'spec', 'local.md'), s.text + 'edited\n')
    const { status, out } = s.ask(s.selection('moved', [s.required('C-pass')]))
    assert.equal(status, 1)
    assert.match(out, /DEFECT: source local \(spec\/local\.md\) has digest/)
    assert.match(out, /refused: required claim C-pass \(component\) cannot be made: R-ok cites a source whose artefact changed; R-ok-2 cites a source whose artefact changed\./)
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('not-applicable needs its reasoning; an assessment cannot rest on an unavailable source; a licensed source without a digest needs provenance', () => {
  const s = scaffold()
  try {
    const bare = s.ask(s.selection('na-bare', [s.required('C-na-bare')]))
    assert.equal(bare.status, 1)
    assert.match(bare.out, /R-na-bare is not-applicable with no reasoning in notes/)
    const reasoned = s.ask(s.selection('na-reasoned', [s.required('C-na-reasoned')]))
    assert.equal(reasoned.status, 0, reasoned.out)
    assert.match(reasoned.out, /not-applicable: R-na-reasoned under C-na-reasoned, reviewed 2026-09-06 by test: this build never selects the option/)
    const unavailable = s.ask(s.selection('unavailable', [s.required('C-unavailable')]))
    assert.equal(unavailable.status, 1)
    assert.match(unavailable.out, /R-unavailable-tested is tested against source gone, which is unavailable/)
    const licensedBare = s.ask(s.selection('licensed-bare', [s.required('C-licensed-bare')]))
    assert.equal(licensedBare.status, 1)
    assert.match(licensedBare.out, /with neither a digest nor recorded access provenance/)
    const licensed = s.ask(s.selection('licensed', [s.required('C-licensed-provenance')]))
    assert.equal(licensed.status, 0, licensed.out)
    assert.match(licensed.out, /licensed: R-licensed-provenance-tested under C-licensed-provenance is tested against licensed-provenance \(EN 1:2026\) without a byte digest; provenance: retrieved 2026-09-06; view-only copy under licence/)
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('a required system claim is held to every row of its profile: silent rows refuse, reasoned exclusions pass, deferral is not allowed', () => {
  const s = scaffold()
  const exclusion = (requirementId, scope, extra = {}) => ({ claimId: 'C-sys', requirementId, scope, rationale: 'because', reviewedAt: '2026-09-06', reviewOwner: 'test', ...extra })
  try {
    const silent = s.ask(s.selection('sys-silent', [s.required('C-sys', 'system')]))
    assert.equal(silent.status, 1)
    assert.match(silent.out, /refused: required claim C-sys \(system, sys\): R-sys-silent carries profile sys and the claim neither requires nor excludes it; no requirement leaves a claimed full scope silently\./)
    assert.match(silent.out, /R-sys-other carries profile sys and the claim neither requires nor excludes it/)

    const excluded = s.ask(s.selection('sys-excluded', [s.required('C-sys', 'system')], [
      exclusion('R-sys-silent', 'outside-claim-scope'),
      exclusion('R-sys-other', 'separately-claimed', { coveredBy: 'C-sys-other' }),
    ]))
    assert.equal(excluded.status, 0, excluded.out)
    assert.match(excluded.out, /excluded: R-sys-silent \(gap\) from C-sys, outside-claim-scope: because/)
    assert.match(excluded.out, /excluded: R-sys-other \(tested\) from C-sys, separately-claimed by C-sys-other: because/)

    const deferred = s.ask(s.selection('sys-deferred', [s.required('C-sys', 'system')], [exclusion('R-sys-silent', 'deferred'), exclusion('R-sys-other', 'separately-claimed', { coveredBy: 'C-sys-other' })]))
    assert.equal(deferred.status, 1)
    assert.match(deferred.out, /DEFECT: selection sys-deferred defers R-sys-silent under C-sys, a system claim; a system claim names every requirement of its scope or is withheld\./)

    // A component claim may defer, and the deferral is printed.
    const component = s.ask(s.selection('component-deferred', [s.required('C-sys', 'component')], [exclusion('R-sys-silent', 'deferred')]))
    assert.equal(component.status, 0, component.out)
    assert.match(component.out, /excluded: R-sys-silent \(gap\) from C-sys, deferred: because/)

    // An exclusion of a required row, an unknown row, or a wrong coveredBy is defective.
    const bad = s.ask(s.selection('sys-bad', [s.required('C-sys', 'system')], [
      exclusion('R-sys-required', 'outside-claim-scope'),
      exclusion('R-nope', 'outside-claim-scope'),
      exclusion('R-sys-other', 'separately-claimed', { coveredBy: 'C-pass' }),
    ]))
    assert.equal(bad.status, 1)
    assert.match(bad.out, /which requires it; an exclusion cannot remove a required row\./)
    assert.match(bad.out, /but the ledger carries no such requirement\./)
    assert.match(bad.out, /as covered by C-pass, which does not require it\./)

    // Withheld, the same system claim prints its silent rows as notes and refuses nothing.
    const withheld = s.ask(s.selection('sys-withheld', [s.required('C-pass'), s.withheld('C-sys', 'system')]))
    assert.equal(withheld.status, 0, withheld.out)
    assert.match(withheld.out, /note: R-sys-silent carries profile sys and withheld claim C-sys neither requires nor excludes it\./)
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('a selection that does not validate against its schema is defective before anything is assessed', () => {
  const s = scaffold()
  try {
    const noRationale = s.ask(s.selection('no-rationale', [{ id: 'C-pass', kind: 'component', disposition: 'withheld' }]))
    assert.equal(noRationale.status, 1)
    assert.match(noRationale.out, /DEFECT: .*no-rationale\.json \/claims\/0 must have required property 'rationale'\./)
    const badKind = s.ask(s.selection('bad-kind', [{ id: 'C-pass', kind: 'certificate', disposition: 'required' }]))
    assert.equal(badKind.status, 1)
    assert.match(badKind.out, /\/claims\/0\/kind must be equal to one of the allowed values/)
  } finally { rmSync(s.dir, { recursive: true, force: true }) }
})

test('rowCarriesProfile reads a profile among several and ignores a parenthetical qualifier', () => {
  assert.equal(rowCarriesProfile({ profileId: 'battery@2 (existing) and battery@3 (proposed)' }, 'battery@3'), true)
  assert.equal(rowCarriesProfile({ profileId: 'battery@2 (existing) and battery@3 (proposed)' }, 'battery@2'), true)
  assert.equal(rowCarriesProfile({ profileId: 'eu-dpp-system (proposed)' }, 'eu-dpp-system'), true)
  assert.equal(rowCarriesProfile({ profileId: 'eu-dpp-system-draft (proposed)' }, 'eu-dpp-system'), false)
  assert.equal(rowCarriesProfile({ profileId: 'single-operator@1, federated-operators@1' }, 'federated-operators@1'), true)
  assert.equal(rowCarriesProfile({ profileId: 'core' }, 'core'), true)
  assert.equal(rowCarriesProfile({ profileId: 'core' }, ''), false)
})

test('over the real ledger, the qualification and the checker give every claim the same verdict, and the committed selections read as they should', () => {
  const diagnostic = run([check])
  assert.equal(diagnostic.status, 0, diagnostic.out)
  const verdictOf = new Map()
  for (const line of diagnostic.out.split('\n')) {
    const ok = /^ok: claim (\S+) can be made/.exec(line)
    const blocked = /^blocked: claim (\S+) cannot be made: (.*)\.$/.exec(line)
    if (ok) verdictOf.set(ok[1], { canBeMade: true })
    if (blocked) verdictOf.set(blocked[1], { canBeMade: false, problems: blocked[2] })
  }
  assert.ok(verdictOf.size > 0)

  const ledger = JSON.parse(readFileSync(join(root, 'conformance', 'manifest.json'), 'utf8'))
  const { sources, moved } = readSources(ledger, root)
  const { rows } = readRows(ledger, sources)
  const verdicts = assessClaims(ledger, rows, moved)
  for (const [id, v] of verdicts) {
    assert.deepEqual(verdictOf.get(id)?.canBeMade, v.canBeMade, `claim ${id}: checker and assessment disagree`)
    if (!v.canBeMade) assert.equal(verdictOf.get(id).problems, v.problems.join('; '))
  }

  // The candidate set's selection is qualified; the European selection is refused on the same verdicts.
  const release = run([qualify, 'conformance/selections/dpp-release-2026-09-3.json'])
  assert.equal(release.status, 0, release.out)
  const eu = run([qualify, 'conformance/selections/eu-dpp-system-2026-09.json'])
  const euVerdict = verdicts.get('eu-dpp-system-conformance')
  assert.equal(eu.status, euVerdict.canBeMade ? 0 : 1, eu.out)
  if (!euVerdict.canBeMade) assert.match(eu.out, new RegExp(`refused: required claim eu-dpp-system-conformance \\(system, eu-dpp-system\\) cannot be made: ${euVerdict.problems.join('; ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`))
  assert.match(eu.out, /withheld: eu-dpp-draft-security-integrity-compatibility \(draft-compatibility, eu-dpp-system-draft\)/)
  assert.match(eu.out, /excluded: READY-2-eu-registry \(gap\) from eu-dpp-system-conformance, outside-claim-scope/)

  // And assessSelection over the real material matches the command's exit code.
  const euSelection = JSON.parse(readFileSync(join(root, 'conformance', 'selections', 'eu-dpp-system-2026-09.json'), 'utf8'))
  const result = assessSelection(euSelection, { ledger, rows, sources, verdicts, root })
  assert.deepEqual(result.invalid, [])
  assert.equal(result.qualified, eu.status === 0)
})
