/**
 * The refusals of the release pipeline's shared checks (scripts/lib/candidates.mjs):
 * a tarball whose bytes changed, a record whose digest does not match, a
 * missing candidate, an unexpected tarball, a record naming another set, a
 * set that is not a candidate, a set file that moved since the record
 * was made, and a set or selection kept on the wrong side of the archive.
 * Built on a temporary directory with tarballs made here, so the test needs
 * no build and no npm.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyCandidates, verifyRecordAgainstSet, sha256, integrityOf, releaseSetPath, selectionMisplacement, setMisplacement } from '../../scripts/lib/candidates.mjs'

const failing = (findings) => findings.filter((f) => !f.ok).map((f) => f.sentence)

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'dpp-candidates-'))
  const candidates = join(dir, 'candidates')
  mkdirSync(candidates)
  const a = Buffer.from('tarball a bytes')
  const b = Buffer.from('tarball b bytes, longer')
  writeFileSync(join(candidates, 'a-1.0.0.tgz'), a)
  writeFileSync(join(candidates, 'b-2.0.0.tgz'), b)
  const record = {
    releaseSet: 'dpp-release-2026-09-test',
    releaseSetSha256: sha256(Buffer.from('set bytes')),
    candidates: [
      { name: '@bsv/a', version: '1.0.0', filename: 'a-1.0.0.tgz', sha256: sha256(a), integrity: integrityOf(a), size: a.length },
      { name: '@bsv/b', version: '2.0.0', filename: 'b-2.0.0.tgz', sha256: sha256(b), integrity: integrityOf(b), size: b.length },
    ],
  }
  const set = { releaseSet: 'dpp-release-2026-09-test', status: 'candidate', packages: [{ name: '@bsv/a', version: '1.0.0' }, { name: '@bsv/b', version: '2.0.0' }] }
  return { dir, candidates, record, set, setBytes: Buffer.from('set bytes'), a, b }
}

test('the recorded bytes hold', () => {
  const f = fixture()
  try {
    assert.deepEqual(failing(verifyCandidates(f.record, f.candidates)), [])
    assert.deepEqual(failing(verifyRecordAgainstSet(f.record, f.set, f.setBytes)), [])
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('a changed tarball is refused by digest, integrity and size', () => {
  const f = fixture()
  try {
    writeFileSync(join(f.candidates, 'a-1.0.0.tgz'), Buffer.from('tarball a bytes!'))
    const sentences = failing(verifyCandidates(f.record, f.candidates))
    assert.equal(sentences.length, 3)
    assert.match(sentences[0], /@bsv\/a@1\.0\.0: a-1\.0\.0\.tgz has SHA-256 .* but the record says/)
    assert.match(sentences[1], /npm integrity that differs from the record/)
    assert.match(sentences[2], /is 16 bytes, but the record says 15/)
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('a mismatched record is refused even when the bytes are unchanged', () => {
  const f = fixture()
  try {
    f.record.candidates[1].sha256 = sha256(Buffer.from('something else'))
    const sentences = failing(verifyCandidates(f.record, f.candidates))
    assert.equal(sentences.length, 1)
    assert.match(sentences[0], /@bsv\/b@2\.0\.0: b-2\.0\.0\.tgz has SHA-256/)
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('a missing candidate and an unexpected tarball are refused by name', () => {
  const f = fixture()
  try {
    rmSync(join(f.candidates, 'b-2.0.0.tgz'))
    writeFileSync(join(f.candidates, 'c-3.0.0.tgz'), Buffer.from('stray'))
    const sentences = failing(verifyCandidates(f.record, f.candidates))
    assert.deepEqual(sentences, [
      `@bsv/b@2.0.0: b-2.0.0.tgz is missing from ${f.candidates}.`,
      `no tarball in ${f.candidates} is outside the record: c-3.0.0.tgz.`,
    ])
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('an empty or duplicated record is refused', () => {
  const f = fixture()
  try {
    assert.deepEqual(failing(verifyCandidates({ candidates: [] }, f.candidates)), ['the candidate record names no candidates.'])
    f.record.candidates.push({ ...f.record.candidates[0] })
    assert.ok(failing(verifyCandidates(f.record, f.candidates)).includes('no package is recorded twice.'))
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('a record is held to its set: identifier, status, every package once at the set version, no extras, the set digest', () => {
  const f = fixture()
  try {
    assert.ok(failing(verifyRecordAgainstSet({ ...f.record, releaseSet: 'dpp-release-other' }, f.set, f.setBytes)).some((s) => /names dpp-release-other; the set is dpp-release-2026-09-test/.test(s)))
    assert.ok(failing(verifyRecordAgainstSet(f.record, { ...f.set, status: 'superseded' }, f.setBytes)).some((s) => /is a superseded, not a candidate/.test(s)))
    const wrongVersion = { ...f.record, candidates: [f.record.candidates[0], { ...f.record.candidates[1], version: '2.0.1' }] }
    assert.ok(failing(verifyRecordAgainstSet(wrongVersion, f.set, f.setBytes)).some((s) => /@bsv\/b@2\.0\.0 is recorded once, but the record has 2\.0\.1/.test(s)))
    const missing = { ...f.record, candidates: [f.record.candidates[0]] }
    assert.ok(failing(verifyRecordAgainstSet(missing, f.set, f.setBytes)).some((s) => /@bsv\/b@2\.0\.0 is recorded once, but the record lacks it/.test(s)))
    const extra = { ...f.record, candidates: [...f.record.candidates, { name: '@bsv/c', version: '3.0.0', filename: 'c-3.0.0.tgz' }] }
    assert.ok(failing(verifyRecordAgainstSet(extra, f.set, f.setBytes)).some((s) => /names no package outside the set: @bsv\/c/.test(s)))
    assert.ok(failing(verifyRecordAgainstSet(f.record, f.set, Buffer.from('set bytes moved'))).some((s) => /not the one the record was made against; re-pack/.test(s)))
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('a superseded set and its selection belong in the archive, and nothing else does', () => {
  const current = { releaseSet: 'dpp-release-new', status: 'candidate' }
  const old = { releaseSet: 'dpp-release-old', status: 'superseded' }
  assert.equal(setMisplacement('release/dpp-release-new.json', current), null)
  assert.equal(setMisplacement('release/archive/dpp-release-old.json', old), null)
  assert.equal(setMisplacement('release/dpp-release-old.json', old), 'release/dpp-release-old.json is superseded; move it, bytes unchanged, to release/archive/.')
  assert.equal(setMisplacement('release/archive/dpp-release-new.json', current), 'release/archive/dpp-release-new.json is archived, but its status is candidate; only a superseded set is archived.')

  const selection = (releaseSet) => ({ selectionId: releaseSet ?? 'unnamed', ...(releaseSet ? { releaseSet } : {}) })
  assert.equal(selectionMisplacement('conformance/selections/dpp-release-new.json', selection('dpp-release-new'), 'candidate'), null)
  assert.equal(selectionMisplacement('conformance/selections/declaration.json', selection(), null), null)
  assert.equal(selectionMisplacement('release/archive/selections/dpp-release-old.json', selection('dpp-release-old'), 'superseded'), null)
  // The set's own status decides, wherever the set is kept: a selection left out
  // beside a superseded set that was itself left out is still asked to move.
  assert.equal(selectionMisplacement('conformance/selections/dpp-release-old.json', selection('dpp-release-old'), 'superseded'), 'conformance/selections/dpp-release-old.json qualifies the superseded set dpp-release-old; move it, bytes unchanged, to release/archive/selections/.')
  assert.match(selectionMisplacement('release/archive/selections/dpp-release-new.json', selection('dpp-release-new'), 'candidate'), /is archived, but dpp-release-new is candidate; only the selection of a superseded set is archived\.$/)
  assert.match(selectionMisplacement('release/archive/selections/dpp-release-gone.json', selection('dpp-release-gone'), null), /is archived, but dpp-release-gone is kept neither under release\/ nor under the archive;/)
  assert.match(selectionMisplacement('release/archive/selections/declaration.json', selection(), null), /is archived, but it names no release set;/)
})

test('a set is found under release/ while current and under the archive once superseded', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dpp-archive-'))
  try {
    mkdirSync(join(dir, 'release', 'archive'), { recursive: true })
    writeFileSync(join(dir, 'release', 'dpp-release-new.json'), '{}')
    writeFileSync(join(dir, 'release', 'archive', 'dpp-release-old.json'), '{}')
    assert.equal(releaseSetPath(dir, 'dpp-release-new'), 'release/dpp-release-new.json')
    assert.equal(releaseSetPath(dir, 'dpp-release-old'), 'release/archive/dpp-release-old.json')
    assert.equal(releaseSetPath(dir, 'dpp-release-none'), null)
    assert.equal(releaseSetPath(dir, undefined), null)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
