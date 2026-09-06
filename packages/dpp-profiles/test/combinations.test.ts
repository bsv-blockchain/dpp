import { describe, expect, it } from 'vitest'
import { checkSelection, type ProfileSelection } from '../src/index.js'

const codes = (s: ProfileSelection): string[] => checkSelection(s).conflicts.map((c) => c.code)

describe('profile combinations (conformance.md §4)', () => {
  it('accepts the combinations the reference deployment runs', () => {
    const supported: ProfileSelection[] = [
      { baseline: 'native-baseline@1', industry: 'battery@2', exchange: ['vsc-draft-compat@0.1.0'], operator: 'single-operator@1', purpose: 'write' },
      { baseline: 'native-baseline@1', industry: 'textile@2', operator: 'single-operator@1', deployment: { operators: 1, discovery: 'none', gasp: false }, purpose: 'write' },
      { baseline: 'native-baseline@1', industry: 'general@2', purpose: 'read' },
      { baseline: 'native-baseline@1', industry: 'battery@2', exchange: ['vsc-draft-compat@0.1.0'], operator: 'single-operator@1', purpose: 'claim' },
      { baseline: 'native-baseline@1', industry: 'battery@2', exchange: ['untp-0.7.0-jose@1'], operator: 'federated-operators@1', deployment: { operators: 2, discovery: 'static-peers', gasp: true }, purpose: 'write' },
    ]
    for (const s of supported) expect(checkSelection(s), JSON.stringify(s)).toMatchObject({ ok: true, conflicts: [] })
  })

  it('reads a superseded version and refuses to write under it', () => {
    const read = checkSelection({ baseline: 'native-baseline@1', industry: 'textile@1', purpose: 'read' })
    expect(read.ok).toBe(true)
    expect(read.notes[0]).toMatch(/superseded by textile@2/)
    expect(codes({ baseline: 'native-baseline@1', industry: 'textile@1', purpose: 'write' })).toEqual(['industry-superseded'])
    expect(codes({ baseline: 'native-baseline@1', industry: 'general@1', purpose: 'claim' })).toEqual(['industry-superseded'])
  })

  it('lets a proposed exchange profile run a pilot and refuses a claim on it', () => {
    const pilot = checkSelection({ baseline: 'native-baseline@1', exchange: ['untp-0.7.0-jose@1'], purpose: 'write' })
    expect(pilot.ok).toBe(true)
    expect(pilot.notes[0]).toMatch(/proposed with unpinned artefacts/)
    expect(codes({ baseline: 'native-baseline@1', exchange: ['untp-0.7.0-jose@1'], purpose: 'claim' })).toEqual(['exchange-proposed', 'exchange-artefacts-unpinned'])
    expect(codes({ baseline: 'native-baseline@1', exchange: ['vsc-draft-compat@0.1.0', 'vsc-draft-compat@0.1.0'], purpose: 'read' })).toEqual(['exchange-duplicate'])
  })

  it('refuses a single operator with federation options and a federation of one or without discovery', () => {
    expect(codes({ baseline: 'native-baseline@1', operator: 'single-operator@1', deployment: { gasp: true }, purpose: 'write' })).toEqual(['operator-single-with-federation-options'])
    expect(codes({ baseline: 'native-baseline@1', operator: 'single-operator@1', deployment: { operators: 2 }, purpose: 'write' })).toEqual(['operator-single-with-federation-options'])
    expect(codes({ baseline: 'native-baseline@1', operator: 'federated-operators@1', deployment: { operators: 1, discovery: 'ship-slap' }, purpose: 'write' })).toEqual(['operator-federation-needs-two'])
    expect(codes({ baseline: 'native-baseline@1', operator: 'federated-operators@1', deployment: { operators: 2 }, purpose: 'write' })).toEqual(['operator-federation-without-discovery'])
    expect(codes({ baseline: 'native-baseline@1', operator: 'federated-operators@1', deployment: { operators: 2, discovery: 'ship-slap' }, purpose: 'claim' })).toEqual(['operator-proposed'])
  })

  it('names an unknown baseline or profile instead of guessing', () => {
    expect(codes({ baseline: 'native-baseline@9', industry: 'battery@9', exchange: ['x@1'], operator: 'solo@1', purpose: 'read' })).toEqual(['baseline-unknown', 'industry-unknown', 'exchange-unknown', 'operator-unknown'])
  })
})
