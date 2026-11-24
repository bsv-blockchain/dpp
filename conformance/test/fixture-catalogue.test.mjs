import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { fixtureCatalogue } from '../../scripts/lib/fixture-catalogue.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const catalogue = fixtureCatalogue(root)

test('the implementer catalogue covers every distributed fixture with resolvable case locations', () => {
  const paths = readdirSync(join(root, 'fixtures'), { recursive: true })
    .filter((file) => file.endsWith('.json')).map((file) => 'fixtures/' + file.split(sep).join('/')).sort()
  assert.deepEqual(Object.keys(catalogue.files), paths)
  for (const [file, entry] of Object.entries(catalogue.files)) {
    const fixture = JSON.parse(readFileSync(join(root, file), 'utf8'))
    assert.match(entry.sha256, /^[0-9a-f]{64}$/)
    assert.ok(entry.cases.length > 0, file)
    assert.equal(new Set(entry.cases.map((c) => c.id)).size, entry.cases.length, file)
    for (const { id, pointer } of entry.cases) {
      const value = pointer.split('/').slice(1).reduce((parent, field) => parent[field], fixture)
      assert.notEqual(value, undefined, file + '#' + id)
    }
    if (fixture.vectors || fixture.cases) {
      assert.deepEqual(entry.cases.map((c) => c.id), (fixture.vectors ?? fixture.cases).map((c) => c.id))
    }
  }
})

test('the catalogue identifies the policy controls and legacy script refusal variants separately', () => {
  const cases = (file) => catalogue.files['fixtures/' + file + '.json'].cases
  assert.ok(cases('chain-v2').some((c) => c.policy === 'managed-acceptance-off'))
  assert.ok(cases('chain-v2').some((c) => c.policy === 'named-control-authorities'))
  assert.equal(cases('chain-v2').filter((c) => c.pointer.startsWith('/upgrade/refusals/')).length, 3)
  assert.equal(cases('anchor-v3').filter((c) => c.pointer.startsWith('/boundaryShifted/')).length, 4)
  assert.equal(cases('record-v1').filter((c) => c.pointer.startsWith('/malformedTail/')).length, 3)
  assert.ok(cases('battery-lifecycle-v1').some((c) => c.pointer === '/report'))
  const superseded = cases('evidence-v1').find((c) => c.id === 'anchor-tampered-bytes')
  assert.equal(superseded.skip, true)
  assert.match(superseded.skipReason, /anchor-supplied-bytes-digest-mismatch/)
})
