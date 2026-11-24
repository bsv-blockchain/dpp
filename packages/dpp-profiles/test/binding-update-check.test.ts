import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BINDING_UPDATE_LIMITS, BUNDLED_BINDINGS, BUNDLED_BINDING_DIGESTS, checkBindingUpdate, createProfileRegistry, profileBindingDigest, readProfileBinding, registerBundledBindings, type BindingArtefact, type BindingProfile, type BindingUpdateProposal, type CandidateArtefact, type ProfileBinding, type ProfileRegistry } from '../src/index.js'
import { SYNTHETIC_CONTEXT_URI, SYNTHETIC_FILES, bindingBytes, resolveSynthetic, sha256Hex, syntheticBinding, utf8 } from './binding-fixture.js'

// The update check answers one question: what would these files change, and
// what binding would the next version be? It decides nothing. These tests
// hold it to that: the active version is the same bytes afterwards, the
// proposal is a version of its own with a digest of its own, and it becomes
// usable only through the registry's ordinary rules.
const activeBytes = bindingBytes(syntheticBinding())
const activeDigest = sha256Hex(activeBytes)
const trusting = (...digests: string[]): ProfileRegistry => createProfileRegistry({ trustedBindingDigests: digests })

/** A registry that holds the synthetic profile at version 1, and the profile as it resolves. */
async function registered(...alsoTrusted: string[]): Promise<{ registry: ProfileRegistry; active: BindingProfile }> {
  const registry = trusting(activeDigest, ...alsoTrusted)
  const result = await registry.register({ bindingBytes: activeBytes, resolveArtefact: resolveSynthetic })
  if (!result.ok) throw new Error(`the synthetic binding did not register: ${result.detail}`)
  return { registry, active: result.profile }
}

/** The whole candidate set: the active files, with the named ones replaced or left out. */
const candidateFrom = (active: BindingProfile, change: Record<string, string | null> = {}): CandidateArtefact[] =>
  active.artefacts.flatMap(({ artefact, bytes }): CandidateArtefact[] => {
    const replacement = change[artefact.path]
    if (replacement === null) return []
    return [{ path: artefact.path, bytes: replacement === undefined ? bytes : utf8(replacement) }]
  })

/** The caller's side of registering a proposal: each artefact from the proposal itself. */
const fromProposal = (proposal: BindingUpdateProposal) => (artefact: BindingArtefact): Uint8Array | undefined => proposal.artefacts.find((entry) => entry.artefact.path === artefact.path)?.bytes

// The active context defines `name` and `lumens`. This one drops `lumens`, gives `name` another IRI and adds `colour`.
const CHANGED_CONTEXT = JSON.stringify({ '@context': { id: '@id', lamp: 'https://profiles.example/lamp/v1#', name: 'lamp:title', colour: 'lamp:colour' } })
const changedContextBytes = utf8(CHANGED_CONTEXT)

describe('checkBindingUpdate: the report', () => {
  it('lists every artefact with the length and digest on both sides, and says how far it looked', async () => {
    const { active } = await registered()
    const { report } = checkBindingUpdate({ active, candidate: { artefacts: candidateFrom(active, { 'context.jsonld': CHANGED_CONTEXT }) } })
    expect(report.reportVersion).toBe(1)
    expect(report.active).toEqual({ profile: 'example-lamp@1', bindingDigest: activeDigest })
    expect(report.artefacts.map((entry) => [entry.path, entry.change, entry.compared])).toEqual([
      ['product.schema.json', 'unchanged', 'digest'],
      ['context.jsonld', 'changed', 'terms'],
      ['shapes.ttl', 'unchanged', 'digest'],
      ['background.ttl', 'unchanged', 'digest'],
    ])
    const context = report.artefacts[1]!
    const before = utf8(SYNTHETIC_FILES['context.jsonld']!)
    expect(context.before).toEqual({ role: 'context', uri: SYNTHETIC_CONTEXT_URI, mediaType: 'application/ld+json', licence: 'Apache-2.0', byteLength: before.byteLength, sha256: sha256Hex(before) })
    expect(context.after).toEqual({ role: 'context', uri: SYNTHETIC_CONTEXT_URI, mediaType: 'application/ld+json', licence: 'Apache-2.0', byteLength: changedContextBytes.byteLength, sha256: sha256Hex(changedContextBytes) })
    expect(context.properties).toEqual(['bytes'])
    // An unchanged file states the same record twice, so a reviewer sees that it was compared and not skipped.
    for (const entry of report.artefacts.filter((e) => e.change === 'unchanged')) expect(entry.before).toEqual(entry.after)
  })

  it('lists the terms a changed context removes, redefines and adds, and marks the first two as breaking', async () => {
    const { active } = await registered()
    const { report } = checkBindingUpdate({ active, candidate: { artefacts: candidateFrom(active, { 'context.jsonld': CHANGED_CONTEXT }) } })
    const context = report.artefacts.find((entry) => entry.path === 'context.jsonld')!
    expect(context.breaking).toBe(true)
    expect(context.context).toEqual({
      read: true,
      terms: [
        { term: 'colour', change: 'added', breaking: false, after: 'lamp:colour' },
        { term: 'lumens', change: 'removed', breaking: true, why: expect.stringContaining('no longer read as it was'), before: 'lamp:lumens' },
        { term: 'name', change: 'redefined', breaking: true, why: expect.stringContaining('says something else'), before: 'lamp:name', after: 'lamp:title' },
      ],
      references: { added: [], removed: [] },
    })
    expect(report.breaking).toEqual(['context.jsonld removes: lumens.', 'context.jsonld redefines: name.'])
  })

  it('reads a term defined by an object, a scoped context included, and reports any difference inside it as a redefinition', async () => {
    const withObject = (unit: string) => JSON.stringify({ '@context': [{ id: '@id', lamp: 'https://profiles.example/lamp/v1#', name: 'lamp:name' }, { lumens: { '@id': 'lamp:lumens', '@context': { unit: `lamp:${unit}` } } }] })
    const first = bindingBytes({ ...syntheticBinding(), artefacts: syntheticBinding().artefacts.map((a) => (a.path === 'context.jsonld' ? { ...a, byteLength: utf8(withObject('unit')).byteLength, sha256: sha256Hex(utf8(withObject('unit'))) } : a)) })
    const registry = trusting(sha256Hex(first))
    const result = await registry.register({ bindingBytes: first, resolveArtefact: (a) => (a.path === 'context.jsonld' ? utf8(withObject('unit')) : resolveSynthetic(a)) })
    if (!result.ok) throw new Error(result.detail)
    const { report } = checkBindingUpdate({ active: result.profile, candidate: { artefacts: candidateFrom(result.profile, { 'context.jsonld': withObject('measure') }) } })
    const terms = report.artefacts.find((entry) => entry.path === 'context.jsonld')!.context
    expect(terms).toMatchObject({ read: true, terms: [{ term: 'lumens', change: 'redefined', breaking: true, before: { '@context': { unit: 'lamp:unit' } }, after: { '@context': { unit: 'lamp:measure' } } }] })
  })

  it('marks a new term as breaking where the active version set @vocab, which had already given the name a meaning', async () => {
    const vocab = JSON.stringify({ '@context': { '@vocab': 'https://profiles.example/lamp/v1#', id: '@id' } })
    const first = bindingBytes({ ...syntheticBinding(), artefacts: syntheticBinding().artefacts.map((a) => (a.path === 'context.jsonld' ? { ...a, byteLength: utf8(vocab).byteLength, sha256: sha256Hex(utf8(vocab)) } : a)) })
    const result = await trusting(sha256Hex(first)).register({ bindingBytes: first, resolveArtefact: (a) => (a.path === 'context.jsonld' ? utf8(vocab) : resolveSynthetic(a)) })
    if (!result.ok) throw new Error(result.detail)
    const next = JSON.stringify({ '@context': { '@vocab': 'https://profiles.example/lamp/v2#', id: '@id', name: 'https://schema.example/name' } })
    const { report } = checkBindingUpdate({ active: result.profile, candidate: { artefacts: candidateFrom(result.profile, { 'context.jsonld': next }) } })
    expect(report.artefacts.find((entry) => entry.path === 'context.jsonld')!.context).toMatchObject({
      read: true,
      terms: [
        { term: '@vocab', change: 'redefined', breaking: true, before: 'https://profiles.example/lamp/v1#', after: 'https://profiles.example/lamp/v2#' },
        { term: 'name', change: 'added', breaking: true, why: expect.stringContaining('@vocab') },
      ],
    })
    expect(report.breaking).toEqual(['context.jsonld redefines: @vocab.', 'context.jsonld adds, over a meaning the active version already gave: name.'])

    // A context file the active version does not list could not be named by any document written under it, so its terms break nothing.
    const extra: CandidateArtefact = { path: 'extra-context.jsonld', bytes: utf8(JSON.stringify({ '@context': { wattage: 'https://profiles.example/lamp/v1#wattage' } })), role: 'context', uri: 'https://profiles.example/lamp/v2/extra.jsonld', mediaType: 'application/ld+json', licence: 'Apache-2.0' }
    const added = checkBindingUpdate({ active: result.profile, candidate: { artefacts: [...candidateFrom(result.profile), extra] } })
    expect(added.report.artefacts.find((entry) => entry.path === 'extra-context.jsonld')).toMatchObject({ change: 'added', breaking: false, context: { read: true, terms: [{ term: 'wattage', change: 'added', breaking: false }] } })
    expect(added.report.breaking).toEqual([])
  })

  it('says a context could not be read, and never reports that as no change', async () => {
    const { active } = await registered()
    const { report, proposal } = checkBindingUpdate({ active, candidate: { artefacts: candidateFrom(active, { 'context.jsonld': '{"@context": {"name": "a", "name": "b"}}' }) } })
    const context = report.artefacts.find((entry) => entry.path === 'context.jsonld')!
    expect(context).toMatchObject({ change: 'changed', compared: 'digest', breaking: false, context: { read: false, reason: expect.stringContaining('the candidate file could not be read as a context') } })
    expect(report.review).toContainEqual(expect.stringMatching(/^context\.jsonld: .*Its terms were not compared\.$/u))
    // The files differ, so a version is still proposed: the report says what it could not tell, and the reviewer decides.
    expect(report.outcome).toBe('proposed')
    expect(proposal?.profile).toBe('example-lamp@2')
  })

  it('compares a file that is not a context by length and digest only, and says that its rules were not analysed', async () => {
    const { active } = await registered()
    const shapes = SYNTHETIC_FILES['shapes.ttl']!.replace('sh:minCount 1', 'sh:minCount 2')
    const { report } = checkBindingUpdate({ active, candidate: { artefacts: candidateFrom(active, { 'shapes.ttl': shapes }) } })
    const entry = report.artefacts.find((e) => e.path === 'shapes.ttl')!
    expect(entry).toMatchObject({ change: 'changed', compared: 'digest', breaking: false, properties: ['bytes'], after: { sha256: sha256Hex(utf8(shapes)), byteLength: utf8(shapes).byteLength } })
    expect(entry.context).toBeUndefined()
    expect(report.breaking).toEqual([])
    expect(report.review).toContain("shapes.ttl (shapes) has other bytes and was compared by length and digest only: what the profile's rules now require was not analysed.")
  })

  it('reports a file the candidate adds and one it leaves out, and a context that leaves as breaking', async () => {
    const { active } = await registered()
    const extra = utf8(JSON.stringify({ '@context': [SYNTHETIC_CONTEXT_URI, 'https://contexts.example/elsewhere.jsonld', { wattage: 'https://profiles.example/lamp/v1#wattage' }] }))
    const added: CandidateArtefact = { path: 'extra-context.jsonld', bytes: extra, role: 'context', uri: 'https://profiles.example/lamp/v2/extra.jsonld', mediaType: 'application/ld+json', licence: 'CC-BY-4.0' }
    const { report, proposal } = checkBindingUpdate({ active, candidate: { artefacts: [...candidateFrom(active, { 'background.ttl': null }), added] } })
    expect(report.artefacts.map((entry) => [entry.path, entry.change])).toEqual([['product.schema.json', 'unchanged'], ['context.jsonld', 'unchanged'], ['shapes.ttl', 'unchanged'], ['background.ttl', 'removed'], ['extra-context.jsonld', 'added']])
    const removed = report.artefacts[3]!
    expect(removed.after).toBeUndefined()
    expect(removed.before).toMatchObject({ role: 'background', sha256: sha256Hex(utf8(SYNTHETIC_FILES['background.ttl']!)) })
    const fresh = report.artefacts[4]!
    expect(fresh.before).toBeUndefined()
    expect(fresh).toMatchObject({ compared: 'terms', breaking: false, after: { role: 'context', licence: 'CC-BY-4.0', sha256: sha256Hex(extra) }, context: { read: true, terms: [{ term: 'wattage', change: 'added', breaking: false }], references: { added: ['https://contexts.example/elsewhere.jsonld', SYNTHETIC_CONTEXT_URI].sort(), removed: [] } } })
    // A context it names and the proposal does not list is a file a validator would refuse to read.
    expect(report.review).toContainEqual(expect.stringContaining('extra-context.jsonld names a context the proposed version does not list'))
    expect(report.review).toContainEqual(expect.stringContaining('https://contexts.example/elsewhere.jsonld'))
    expect(report.review).toContain('extra-context.jsonld is new, under CC-BY-4.0: confirm a notice accounts for it.')
    expect(proposal?.binding.artefacts.map((a) => a.path)).toEqual(['product.schema.json', 'context.jsonld', 'shapes.ttl', 'extra-context.jsonld'])

    const without = checkBindingUpdate({ active, candidate: { artefacts: candidateFrom(active, { 'context.jsonld': null }) } })
    expect(without.report.artefacts.find((entry) => entry.path === 'context.jsonld')).toMatchObject({ change: 'removed', breaking: true })
    expect(without.report.breaking).toEqual([`context.jsonld is no longer a context of the profile, so a document that names ${SYNTHETIC_CONTEXT_URI} is refused under the proposed version.`])
  })

  it('reports a context named by another URI as breaking, and a changed licence for review', async () => {
    const { active } = await registered()
    const artefacts = candidateFrom(active).map((entry) => (entry.path === 'context.jsonld' ? { ...entry, uri: 'https://profiles.example/lamp/v2/context.jsonld' } : entry.path === 'shapes.ttl' ? { ...entry, licence: 'CC-BY-4.0' } : entry))
    const { report, proposal } = checkBindingUpdate({ active, candidate: { artefacts } })
    expect(report.artefacts.map((entry) => [entry.path, entry.change, entry.properties])).toEqual([['product.schema.json', 'unchanged', []], ['context.jsonld', 'changed', ['uri']], ['shapes.ttl', 'changed', ['licence']], ['background.ttl', 'unchanged', []]])
    expect(report.breaking).toEqual([`context.jsonld is named by https://profiles.example/lamp/v2/context.jsonld in place of ${SYNTHETIC_CONTEXT_URI}, so a document that names the earlier URI is refused under the proposed version.`])
    expect(report.review).toContain('shapes.ttl is under CC-BY-4.0 in place of Apache-2.0: confirm the notices and the terms it may be passed on under.')
    expect(proposal?.binding.artefacts.find((a) => a.path === 'shapes.ttl')).toMatchObject({ licence: 'CC-BY-4.0', sha256: sha256Hex(utf8(SYNTHETIC_FILES['shapes.ttl']!)) })
  })

  it('states its limits in fixed words in every report', async () => {
    const { active } = await registered()
    const unchanged = checkBindingUpdate({ active, candidate: { artefacts: candidateFrom(active) } })
    const changed = checkBindingUpdate({ active, candidate: { artefacts: candidateFrom(active, { 'context.jsonld': CHANGED_CONTEXT }) } })
    for (const { report } of [unchanged, changed]) expect(report.limits).toEqual({ activation: 'explicit-registration', trust: 'registry-trusted-digests', rules: 'contexts-by-term-others-by-digest', vectors: 'not-run' })
    expect(changed.report.limits).toEqual(BINDING_UPDATE_LIMITS)
    // Each report holds its own copy: editing one changes neither the constant nor the next report.
    expect(changed.report.limits).not.toBe(BINDING_UPDATE_LIMITS)
    ;(changed.report.limits as { vectors: string }).vectors = 'run'
    expect(BINDING_UPDATE_LIMITS.vectors).toBe('not-run')
    expect(checkBindingUpdate({ active, candidate: { artefacts: candidateFrom(active, { 'context.jsonld': CHANGED_CONTEXT }) } }).report.limits.vectors).toBe('not-run')
    expect(changed.report.review).toContainEqual(expect.stringContaining('none was run under it'))
  })
})

describe('checkBindingUpdate: the proposal', () => {
  it('proposes the next version with a digest of its own, and changes nothing else about the binding', async () => {
    const { active } = await registered()
    const { report, proposal } = checkBindingUpdate({ active, candidate: { artefacts: candidateFrom(active, { 'context.jsonld': CHANGED_CONTEXT }) } })
    if (proposal == null) throw new Error('expected a proposal')
    expect(report.outcome).toBe('proposed')
    expect(report.proposed).toEqual({ profile: 'example-lamp@2', bindingDigest: proposal.bindingDigest })
    expect(proposal).toMatchObject({ id: 'example-lamp', version: 2, profile: 'example-lamp@2' })
    expect(proposal.bindingDigest).toBe(profileBindingDigest(proposal.bindingBytes))
    expect(proposal.bindingDigest).not.toBe(activeDigest)
    // The bytes read as a binding file, and say what the proposal says.
    expect(readProfileBinding(proposal.bindingBytes)).toEqual({ ok: true, binding: proposal.binding, digest: proposal.bindingDigest })
    const expected: ProfileBinding = { ...syntheticBinding(), version: 2, profile: 'example-lamp@2' }
    expected.artefacts = expected.artefacts.map((a) => (a.path === 'context.jsonld' ? { ...a, byteLength: changedContextBytes.byteLength, sha256: sha256Hex(changedContextBytes) } : a))
    expect(proposal.binding).toEqual(expected)
    // The same members in the same order as the active file, so the two files compare line for line.
    expect(Object.keys(proposal.binding)).toEqual(Object.keys(syntheticBinding()))
    expect(report.bindingChanges).toEqual([{ member: 'version', before: 1, after: 2 }, { member: 'profile', before: 'example-lamp@1', after: 'example-lamp@2' }])
    expect(proposal.artefacts.map(({ artefact, bytes }) => [artefact.path, sha256Hex(bytes)])).toEqual(proposal.binding.artefacts.map((a) => [a.path, a.sha256]))
  })

  it('gives the same bytes for the same files, in whatever order the candidate lists them', async () => {
    const { active } = await registered()
    const artefacts = candidateFrom(active, { 'context.jsonld': CHANGED_CONTEXT })
    const first = checkBindingUpdate({ active, candidate: { artefacts } })
    const again = checkBindingUpdate({ active, candidate: { artefacts: [...artefacts].reverse() } })
    expect(again.proposal?.bindingDigest).toBe(first.proposal?.bindingDigest)
    expect(again.report).toEqual(first.report)

    // New files too: two parties whose folders list the same new files in another order review one digest.
    const added = (path: string): CandidateArtefact => ({ path, bytes: utf8(`# ${path}\n`), role: 'background', mediaType: 'text/turtle', licence: 'Apache-2.0' })
    const [b, a] = [added('more-background-b.ttl'), added('more-background-a.ttl')]
    const oneWay = checkBindingUpdate({ active, candidate: { artefacts: [...artefacts, b, a] } })
    const otherWay = checkBindingUpdate({ active, candidate: { artefacts: [a, ...[...artefacts].reverse(), b] } })
    expect(oneWay.report.outcome).toBe('proposed')
    expect(otherWay.proposal?.bindingDigest).toBe(oneWay.proposal?.bindingDigest)
    expect(Buffer.from(otherWay.proposal!.bindingBytes).equals(Buffer.from(oneWay.proposal!.bindingBytes))).toBe(true)
    expect(otherWay.report).toEqual(oneWay.report)
    // The added files follow the active ones, by path.
    expect(oneWay.proposal?.binding.artefacts.map((artefact) => artefact.path)).toEqual(['product.schema.json', 'context.jsonld', 'shapes.ttl', 'background.ttl', 'more-background-a.ttl', 'more-background-b.ttl'])
    expect(oneWay.report.artefacts.slice(-2).map((entry) => [entry.path, entry.change])).toEqual([['more-background-a.ttl', 'added'], ['more-background-b.ttl', 'added']])
  })

  it('applies the source and publisher the candidate names, and asks about a revision left as it was', async () => {
    const withRevision = bindingBytes({ ...syntheticBinding(), source: { name: 'This test', release: '1.0.0', revision: 'a'.repeat(40), licence: 'Apache-2.0', notices: [] } })
    const result = await trusting(sha256Hex(withRevision)).register({ bindingBytes: withRevision, resolveArtefact: resolveSynthetic })
    if (!result.ok) throw new Error(result.detail)
    const artefacts = candidateFrom(result.profile, { 'context.jsonld': CHANGED_CONTEXT })

    const left = checkBindingUpdate({ active: result.profile, candidate: { artefacts } })
    expect(left.report.review).toContainEqual(expect.stringContaining(`\`source.revision\` is still ${'a'.repeat(40)} while the files differ`))

    const named = checkBindingUpdate({ active: result.profile, candidate: { artefacts, source: { release: '1.1.0', revision: 'b'.repeat(40) }, publisher: { name: 'Another operator', registration: 'local' } } })
    expect(named.proposal?.binding.source).toEqual({ name: 'This test', release: '1.1.0', revision: 'b'.repeat(40), licence: 'Apache-2.0', notices: [] })
    expect(named.proposal?.binding.publisher).toEqual({ name: 'Another operator', registration: 'local' })
    expect(named.report.bindingChanges).toEqual([
      { member: 'version', before: 1, after: 2 },
      { member: 'profile', before: 'example-lamp@1', after: 'example-lamp@2' },
      { member: 'source.release', before: '1.0.0', after: '1.1.0' },
      { member: 'source.revision', before: 'a'.repeat(40), after: 'b'.repeat(40) },
      { member: 'publisher.name', before: 'Test publisher', after: 'Another operator' },
    ])
    expect(named.report.review.some((sentence) => sentence.includes('source.revision'))).toBe(false)
  })

  it('reports no change and proposes nothing when the candidate is the active files, byte for byte', async () => {
    const { active } = await registered()
    const { report, proposal } = checkBindingUpdate({ active, candidate: { artefacts: [...candidateFrom(active)].reverse() } })
    expect(proposal).toBeUndefined()
    expect(report.outcome).toBe('unchanged')
    expect(report.proposed).toBeUndefined()
    expect(report.artefacts.map((entry) => entry.change)).toEqual(['unchanged', 'unchanged', 'unchanged', 'unchanged'])
    expect(report.bindingChanges).toEqual([])
    expect(report.breaking).toEqual([])
    expect(report.problems).toEqual([])
    expect(report.review).toEqual([])

    // Another revision that publishes the same bytes is not a new version either, and the report says the members were not applied.
    const renamed = checkBindingUpdate({ active, candidate: { artefacts: candidateFrom(active), source: { revision: 'c'.repeat(40) } } })
    expect(renamed.proposal).toBeUndefined()
    expect(renamed.report.outcome).toBe('unchanged')
    expect(renamed.report.review).toEqual([expect.stringContaining('No version is proposed for that alone')])
  })

  it('proposes nothing from a candidate that cannot make a binding, and says why', async () => {
    const { active } = await registered()
    const noShapes = checkBindingUpdate({ active, candidate: { artefacts: candidateFrom(active, { 'shapes.ttl': null }) } })
    expect(noShapes.proposal).toBeUndefined()
    expect(noShapes.report).toMatchObject({ outcome: 'refused', problems: ['the shacl step needs at least one shapes artefact.'] })
    expect(noShapes.report.proposed).toBeUndefined()

    // A new file has to say what it is. The binding format's own check names what is missing.
    const unnamed = checkBindingUpdate({ active, candidate: { artefacts: [...candidateFrom(active), { path: 'more-shapes.ttl', bytes: utf8('# nothing\n') }] } })
    expect(unnamed.proposal).toBeUndefined()
    expect(unnamed.report.outcome).toBe('refused')
    expect(unnamed.report.problems).toEqual(expect.arrayContaining([expect.stringContaining('missing the required member `role`'), expect.stringContaining('missing the required member `licence`')]))
  })

  it('refuses a version that is not above the active one, and an input that is not what it says', async () => {
    const { active } = await registered()
    const artefacts = candidateFrom(active, { 'context.jsonld': CHANGED_CONTEXT })
    for (const version of [1, 0, 1.5, -2]) expect(() => checkBindingUpdate({ active, candidate: { artefacts, version } })).toThrow(/whole number above 1/u)
    expect(checkBindingUpdate({ active, candidate: { artefacts, version: 5 } }).proposal).toMatchObject({ version: 5, profile: 'example-lamp@5' })
    expect(() => checkBindingUpdate({ active, candidate: { artefacts: [...artefacts, artefacts[0]!] } })).toThrow(/lists the artefact product\.schema\.json twice/u)
    expect(() => checkBindingUpdate({ active, candidate: { artefacts: [{ path: 'context.jsonld', bytes: 'text' as unknown as Uint8Array }] } })).toThrow(/Uint8Array/u)

    // A profile that is not its own record is not the active version, and a report about it would describe nothing.
    const otherBytes = { ...active, artefacts: active.artefacts.map((entry) => (entry.artefact.path === 'shapes.ttl' ? { ...entry, bytes: utf8('# another file\n') } : entry)) }
    expect(() => checkBindingUpdate({ active: otherBytes, candidate: { artefacts } })).toThrow(/copy of shapes\.ttl is not the file its binding records/u)
    const otherBinding = { ...active, bindingBytes: bindingBytes({ ...syntheticBinding(), title: 'Another title' }) }
    expect(() => checkBindingUpdate({ active: otherBinding, candidate: { artefacts } })).toThrow(/not the .* it is registered under/u)
  })
})

describe('checkBindingUpdate: the active version is left as it was', () => {
  it('resolves the active version byte for byte after a check, and registers nothing', async () => {
    const { registry, active } = await registered()
    const bindingBefore = Uint8Array.from(active.bindingBytes)
    const artefactsBefore = active.artefacts.map(({ artefact, bytes }) => ({ artefact: structuredClone(artefact), bytes: Uint8Array.from(bytes) }))
    const parsedBefore = structuredClone(active.binding)

    const { proposal } = checkBindingUpdate({ active, candidate: { artefacts: candidateFrom(active, { 'context.jsonld': CHANGED_CONTEXT, 'background.ttl': null }), source: { release: '2' } } })
    expect(proposal?.profile).toBe('example-lamp@2')

    const after = registry.resolve('example-lamp', 1)
    // The same object the registry held, and the same bytes in it.
    expect(after).toBe(active)
    if (after?.format !== 'binding') throw new Error('expected a binding')
    expect(after.bindingDigest).toBe(activeDigest)
    expect(Buffer.from(after.bindingBytes).equals(Buffer.from(bindingBefore))).toBe(true)
    expect(Buffer.from(after.bindingBytes).equals(Buffer.from(activeBytes))).toBe(true)
    expect(after.binding).toEqual(parsedBefore)
    expect(after.artefacts.map(({ artefact, bytes }) => ({ artefact, bytes: sha256Hex(bytes) }))).toEqual(artefactsBefore.map(({ artefact, bytes }) => ({ artefact, bytes: sha256Hex(bytes) })))
    // The proposal exists only in what the check returned.
    expect(registry.resolve('example-lamp', 2)).toBeUndefined()
    expect(registry.status('example-lamp', 2)).toEqual({ state: 'unknown', profile: 'example-lamp@2' })
    expect(registry.list().filter((profile) => profile.format === 'binding')).toEqual([active])
  })

  it('keeps bytes of its own, so a buffer the caller changes afterwards changes neither side', async () => {
    const { active } = await registered()
    const buffer = Uint8Array.from(changedContextBytes)
    const { proposal } = checkBindingUpdate({ active, candidate: { artefacts: candidateFrom(active).map((entry) => (entry.path === 'context.jsonld' ? { ...entry, bytes: buffer } : entry)) } })
    buffer.fill(0)
    const carried = proposal?.artefacts.find((entry) => entry.artefact.path === 'context.jsonld')
    expect(sha256Hex(carried!.bytes)).toBe(sha256Hex(changedContextBytes))
    expect(sha256Hex(carried!.bytes)).toBe(carried!.artefact.sha256)
  })
})

describe('checkBindingUpdate: a proposal is registered only by the registry’s own rules', () => {
  it('is refused as untrusted until its digest is on the trusted list, and then sits beside the active version', async () => {
    const { registry, active } = await registered()
    const { proposal } = checkBindingUpdate({ active, candidate: { artefacts: candidateFrom(active, { 'context.jsonld': CHANGED_CONTEXT }) } })
    if (proposal == null) throw new Error('expected a proposal')

    // The registry that holds the active version trusts the active digest and no other.
    expect(await registry.register({ bindingBytes: proposal.bindingBytes, resolveArtefact: fromProposal(proposal) })).toMatchObject({ ok: false, code: 'binding-untrusted', bindingDigest: proposal.bindingDigest })
    expect(registry.resolve('example-lamp', 2)).toBeUndefined()

    // Trusting it is a decision somebody makes: a registry built with the digest on its list.
    const both = await registered(proposal.bindingDigest)
    const accepted = await both.registry.register({ bindingBytes: proposal.bindingBytes, resolveArtefact: fromProposal(proposal) })
    expect(accepted).toMatchObject({ ok: true, alreadyRegistered: false, profile: { profile: 'example-lamp@2', bindingDigest: proposal.bindingDigest } })
    expect(both.registry.resolve('example-lamp', 2)).toMatchObject({ bindingDigest: proposal.bindingDigest })
    // The active version is still the active bytes, beside it.
    const first = both.registry.resolve('example-lamp', 1)
    if (first?.format !== 'binding') throw new Error('expected a binding')
    expect(first.bindingDigest).toBe(activeDigest)
    expect(Buffer.from(first.bindingBytes).equals(Buffer.from(activeBytes))).toBe(true)
  })

  it('holds the proposal’s files to the proposal, like any binding’s', async () => {
    const { active } = await registered()
    const { proposal } = checkBindingUpdate({ active, candidate: { artefacts: candidateFrom(active, { 'context.jsonld': CHANGED_CONTEXT }) } })
    if (proposal == null) throw new Error('expected a proposal')
    // Registered with the active version's files: the changed one is not the file the proposal records.
    expect(await trusting(proposal.bindingDigest).register({ bindingBytes: proposal.bindingBytes, resolveArtefact: resolveSynthetic })).toMatchObject({ ok: false, code: 'artefact-length-mismatch', artefact: 'context.jsonld' })
  })

  it('cannot be registered over the identifier and version it was derived from', async () => {
    const { active } = await registered()
    const { proposal } = checkBindingUpdate({ active, candidate: { artefacts: candidateFrom(active, { 'context.jsonld': CHANGED_CONTEXT }) } })
    if (proposal == null) throw new Error('expected a proposal')

    // The proposed files written back under the active identity, with that digest trusted: the one thing an update must never do.
    const overwrite = bindingBytes({ ...proposal.binding, version: 1, profile: 'example-lamp@1' })
    const { registry } = await registered(proposal.bindingDigest, sha256Hex(overwrite))
    const refused = await registry.register({ bindingBytes: overwrite, resolveArtefact: fromProposal(proposal) })
    expect(refused).toMatchObject({ ok: false, code: 'binding-conflict', profile: 'example-lamp@1', bindingDigest: sha256Hex(overwrite) })
    if (!refused.ok) expect(refused.detail).toContain(activeDigest)
    const still = registry.resolve('example-lamp', 1)
    if (still?.format !== 'binding') throw new Error('expected a binding')
    expect(still.bindingDigest).toBe(activeDigest)
    expect(Buffer.from(still.bindingBytes).equals(Buffer.from(activeBytes))).toBe(true)

    // And once a proposal holds the next version, another candidate cannot take that version from it.
    expect((await registry.register({ bindingBytes: proposal.bindingBytes, resolveArtefact: fromProposal(proposal) })).ok).toBe(true)
    const other = checkBindingUpdate({ active, candidate: { artefacts: candidateFrom(active, { 'shapes.ttl': `${SYNTHETIC_FILES['shapes.ttl']}# another candidate\n` }) } }).proposal
    if (other == null) throw new Error('expected a second proposal')
    expect(other.profile).toBe('example-lamp@2')
    const second = await registered(proposal.bindingDigest, other.bindingDigest)
    expect((await second.registry.register({ bindingBytes: proposal.bindingBytes, resolveArtefact: fromProposal(proposal) })).ok).toBe(true)
    expect(await second.registry.register({ bindingBytes: other.bindingBytes, resolveArtefact: fromProposal(other) })).toMatchObject({ ok: false, code: 'binding-conflict', profile: 'example-lamp@2' })
    expect(second.registry.resolve('example-lamp', 2)).toMatchObject({ bindingDigest: proposal.bindingDigest })
  })
})

describe('checkBindingUpdate: a bundled binding', () => {
  const pinned = BUNDLED_BINDINGS.find((entry) => entry.profile === 'eu-battery@1')!
  const folder = join(import.meta.dirname, '..', 'bindings', 'eu-battery@1')

  it('reports one changed shapes file and one removed term, proposes eu-battery@2 and leaves eu-battery@1 at its pinned digest', async () => {
    const registry = trusting(...BUNDLED_BINDING_DIGESTS)
    for (const result of await registerBundledBindings(registry)) expect(result.ok).toBe(true)
    const active = registry.resolve('eu-battery', 1)
    if (active?.format !== 'binding') throw new Error('expected the bundled binding')

    // A shapes file with one more line, and the profile's own context without the first term it defines.
    const shapes = new Uint8Array([...readFileSync(join(folder, 'shapes.ttl')), ...utf8('# a line the active version does not have\n')])
    const context = JSON.parse(readFileSync(join(folder, 'battery-context.jsonld'), 'utf8')) as { '@context': [string, Record<string, unknown>] }
    const dropped = Object.keys(context['@context'][1]).find((key) => !key.startsWith('@'))!
    delete context['@context'][1][dropped]
    const artefacts = active.artefacts.map(({ artefact, bytes }) => ({ path: artefact.path, bytes: artefact.path === 'shapes.ttl' ? shapes : artefact.path === 'battery-context.jsonld' ? utf8(JSON.stringify(context)) : bytes }))

    const { report, proposal } = checkBindingUpdate({ active, candidate: { artefacts } })
    expect(report.outcome).toBe('proposed')
    expect(report.artefacts.filter((entry) => entry.change !== 'unchanged').map((entry) => [entry.path, entry.change, entry.compared, entry.breaking, entry.before?.licence])).toEqual([
      ['battery-context.jsonld', 'changed', 'terms', true, 'Apache-2.0'],
      ['shapes.ttl', 'changed', 'digest', false, 'Apache-2.0'],
    ])
    expect(report.artefacts.find((entry) => entry.path === 'battery-context.jsonld')!.context).toMatchObject({ read: true, terms: [{ term: dropped, change: 'removed', breaking: true }], references: { added: [], removed: [] } })
    expect(report.breaking).toEqual([`battery-context.jsonld removes: ${dropped}.`])
    // A context whose bytes did not change was compared by its digest, and its terms were not read.
    expect(report.artefacts.filter((entry) => entry.change === 'unchanged' && entry.before?.role === 'context').map((entry) => [entry.path, entry.compared, entry.context])).toEqual([
      ['dpp-core-context.jsonld', 'digest', undefined],
      ['assessment-context.jsonld', 'digest', undefined],
      ['gs1-shortcuts-context.jsonld', 'digest', undefined],
    ])
    expect(proposal).toMatchObject({ profile: 'eu-battery@2', version: 2 })
    expect(proposal!.bindingDigest).not.toBe(pinned.bindingDigest)
    // The source is carried over, so the report asks which revision the new files come from.
    expect(report.review).toContainEqual(expect.stringContaining('`source.revision` is still'))

    const after = registry.resolve('eu-battery', 1)
    if (after?.format !== 'binding') throw new Error('expected the bundled binding')
    expect(after.bindingDigest).toBe(pinned.bindingDigest)
    expect(Buffer.from(after.bindingBytes).equals(readFileSync(join(folder, 'binding.json')))).toBe(true)
    expect(registry.resolve('eu-battery', 2)).toMatchObject({ bindingDigest: BUNDLED_BINDINGS.find((entry) => entry.profile === 'eu-battery@2')!.bindingDigest })
    // The package trusts the bindings it ships and nothing derived from them.
    expect(await registry.register({ bindingBytes: proposal!.bindingBytes, resolveArtefact: fromProposal(proposal!) })).toMatchObject({ ok: false, code: 'binding-untrusted' })
  })

  it('reports a context that stops naming another as breaking, and one that names another now for review', async () => {
    const registry = trusting(...BUNDLED_BINDING_DIGESTS)
    for (const result of await registerBundledBindings(registry)) expect(result.ok).toBe(true)
    const active = registry.resolve('eu-battery', 1)
    if (active?.format !== 'binding') throw new Error('expected the bundled binding')
    const uriOf = (path: string): string => active.binding.artefacts.find((artefact) => artefact.path === path)!.uri!
    const assessment = uriOf('assessment-context.jsonld')
    const shortcuts = uriOf('gs1-shortcuts-context.jsonld')

    // The core context without its first entry, the assessment context it names. The battery documents name the core and battery contexts only.
    const core = JSON.parse(readFileSync(join(folder, 'dpp-core-context.jsonld'), 'utf8')) as { '@context': unknown[] }
    expect(core['@context'][0]).toBe(assessment)
    core['@context'] = core['@context'].slice(1)
    // And the battery context naming the shortcuts context as well, a context the binding lists.
    const battery = JSON.parse(readFileSync(join(folder, 'battery-context.jsonld'), 'utf8')) as { '@context': unknown[] }
    expect(battery['@context']).not.toContain(shortcuts)
    battery['@context'] = [shortcuts, ...battery['@context']]
    const replaced: Record<string, Uint8Array> = { 'dpp-core-context.jsonld': utf8(JSON.stringify(core)), 'battery-context.jsonld': utf8(JSON.stringify(battery)) }
    const artefacts = active.artefacts.map(({ artefact, bytes }) => ({ path: artefact.path, bytes: replaced[artefact.path] ?? bytes }))

    const { report } = checkBindingUpdate({ active, candidate: { artefacts } })
    expect(report.outcome).toBe('proposed')
    // Not one term of the core context itself changed, and the change is still breaking: every assessment term is gone from a document that names the core context alone.
    expect(report.artefacts.find((entry) => entry.path === 'dpp-core-context.jsonld')).toMatchObject({ change: 'changed', compared: 'terms', breaking: true, context: { read: true, terms: [], references: { added: [], removed: [assessment] } } })
    expect(report.breaking).toEqual([`dpp-core-context.jsonld no longer names ${assessment}, so a document that names ${uriOf('dpp-core-context.jsonld')} and not ${assessment} loses the terms ${assessment} defines under the proposed version.`])
    // A context named now can redefine a name already in use. Nothing shows that it does, so it is for review and not breaking.
    expect(report.artefacts.find((entry) => entry.path === 'battery-context.jsonld')).toMatchObject({ change: 'changed', breaking: false, context: { read: true, terms: [], references: { added: [shortcuts], removed: [] } } })
    expect(report.review).toContainEqual(expect.stringContaining(`battery-context.jsonld now names ${shortcuts}, which is read wherever battery-context.jsonld is`))
  })

  it('reports no change for the files the package ships', async () => {
    const registry = trusting(...BUNDLED_BINDING_DIGESTS)
    await registerBundledBindings(registry)
    for (const entry of BUNDLED_BINDINGS) {
      const profile = entry.profile
      const [id, version] = profile.split('@') as [string, string]
      const active = registry.resolve(id, Number(version))
      if (active?.format !== 'binding') throw new Error('expected the bundled binding')
      const shipped = join(import.meta.dirname, '..', 'bindings', 'artefactDirectory' in entry ? entry.artefactDirectory : profile)
      const { report, proposal } = checkBindingUpdate({ active, candidate: { artefacts: active.binding.artefacts.map((artefact) => ({ path: artefact.path, bytes: new Uint8Array(readFileSync(join(shipped, artefact.path))) })) } })
      expect(report.outcome).toBe('unchanged')
      expect(proposal).toBeUndefined()
    }
  })
})
