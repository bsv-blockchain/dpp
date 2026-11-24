// JSON Pointers locate cases in the exact fixture files carried by the implementer bundle.
import { readFileSync, readdirSync } from 'node:fs'
import { basename, join, sep } from 'node:path'
import { sha256 } from './candidates.mjs'

const singleFixtures = new Set([
  'anchor-v3', 'attestation-anchor-v1', 'battery-lifecycle-v1', 'chain-v1',
  'chain-v2', 'index-registration-v1', 'managed-acceptance-v1', 'managed-acceptance-v2',
  'record-v1', 'record-v2',
])

function casesIn(file, fixture) {
  if (Array.isArray(fixture.vectors) || Array.isArray(fixture.cases)) {
    const field = Array.isArray(fixture.vectors) ? 'vectors' : 'cases'
    return fixture[field].map((entry, index) => ({
      id: entry.id,
      pointer: '/' + field + '/' + index,
      ...(entry.skip === true ? { skip: true, skipReason: entry.skip_reason } : {}),
    }))
  }

  const name = basename(file, '.json')
  if (!singleFixtures.has(name)) throw new Error('No catalogue mapping for ' + file)

  // The root carries the signing inputs, byte assertions or valid sequence. Individual
  // entries reference it for keys, predecessors and policy, as the fixture guide describes.
  const cases = [{ id: 'reference', pointer: '' }]
  for (const [index] of (fixture.states ?? []).entries()) {
    cases.push({ id: 'state-' + (index + 1), pointer: '/states/' + index })
  }
  for (const field of ['boundaryControl', 'upgrade', 'report']) {
    if (Object.hasOwn(fixture, field)) cases.push({ id: field, pointer: '/' + field })
  }
  for (const [index, refusal] of (fixture.refusals ?? []).entries()) {
    const pointer = '/refusals/' + index
    cases.push({ id: refusal.name, pointer })
    if (refusal.acceptedUnder) cases.push({ id: refusal.name + '-authorised', pointer, policy: 'named-control-authorities' })
    if (refusal.managedAcceptance) cases.push({ id: refusal.name + '-without-profile', pointer, policy: 'managed-acceptance-off' })
  }
  for (const [index, refusal] of (fixture.upgrade?.refusals ?? []).entries()) {
    cases.push({ id: 'upgrade-' + refusal.name, pointer: '/upgrade/refusals/' + index })
  }
  // Early layouts store refusal scripts as named fields or arrays without case identifiers.
  for (const field of ['boundaryShifted', 'uncompressedKey', 'malformedTail', 'rolledTimestamp', 'mangledUtf8', 'nulPassportId', 'emptyPushdata', 'overlongPassportId']) {
    if (Array.isArray(fixture[field])) {
      for (const [index] of fixture[field].entries()) cases.push({ id: field + '-' + (index + 1), pointer: '/' + field + '/' + index })
    } else if (Object.hasOwn(fixture, field)) {
      cases.push({ id: field, pointer: '/' + field })
    }
  }
  return cases
}

export function fixtureCatalogue(root) {
  const files = {}
  const directory = join(root, 'fixtures')
  const paths = readdirSync(directory, { recursive: true }).filter((file) => file.endsWith('.json')).sort()
  for (const path of paths) {
    const bytes = readFileSync(join(directory, path))
    const cases = casesIn(path, JSON.parse(bytes))
    if (cases.length === 0 || cases.some((c) => typeof c.id !== 'string' || !c.id) || new Set(cases.map((c) => c.id)).size !== cases.length) {
      throw new Error('Missing or duplicate case identifier in ' + path)
    }
    files['fixtures/' + path.split(sep).join('/')] = { sha256: sha256(bytes), cases }
  }
  return { catalogueVersion: 1, files }
}
