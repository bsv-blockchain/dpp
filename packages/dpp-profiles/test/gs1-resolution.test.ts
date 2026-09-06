import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import {
  DPP_EVIDENCE_PACKAGE_LINK_TYPE,
  GS1_LINK_TYPES,
  GS1_VOCABULARY,
  LINKSET_CONTEXT_URI,
  bestMatch,
  decompressGs1DigitalLink,
  describeResolver,
  granularityOf,
  gs1KeyOf,
  gs1KeyTuple,
  legacyEvidencePaths,
  linksetDocument,
  matchRecords,
  normaliseLinkType,
  parseAcceptHeader,
  parseAcceptLanguage,
  parseGs1DigitalLinkUri,
  resolutionRecordProblems,
  resolveLinks,
  sameGs1Key,
  selectLink,
  uncompressedUri,
  type Gs1Key,
  type LinksetDocument,
  type ResolutionRecord,
  type ResolutionRequest,
} from '../src/gs1-resolution.js'
import { encodeSgtinBits, hexFromBits } from '../src/gs1-epc-binary.js'

const root = join(import.meta.dirname, '..')
const FIXTURES = join(root, '..', '..', 'fixtures', 'vectors', 'dpp', 'interoperability', 'gs1')
const read = (relative: string): object => JSON.parse(readFileSync(join(root, relative), 'utf8'))

/**
 * GS1 publishes its schemas in draft-07 with keywords Ajv's strict mode does
 * not know (`name`, a misspelt `decription`), so they are compiled with strict
 * mode off. The pinned bytes are not edited to please a validator.
 */
const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)
const validateLinkset = ajv.compile(read('schemas/gs1/resolver-linkset-schema-1.2.1.json'))
const validateDescription = ajv.compile(read('schemas/gs1/resolver-description-file-schema-1.2.0.json'))

/** A GTIN under the demonstration prefix, check digit computed and never typed. */
const GTIN = '09521234000013'
const OTHER_GTIN = '09521234000020'
const ROOT = 'https://id.example.org'
const REL = GS1_LINK_TYPES

/** The records one demonstration resolver holds: a model, a variant, a lot, a variant-and-lot and one item. */
function records(): ResolutionRecord[] {
  return [
    {
      key: { ai: '01', value: GTIN },
      qualifiers: [],
      configurationRevision: 'cfg-7',
      description: 'Demonstration cell pack',
      links: [
        { rel: REL.pip, href: 'https://products.example.org/cell-pack', title: 'Product information', default: 'single', disclosure: 'public' },
        { rel: REL.pip, href: 'https://products.example.org/fr/cell-pack', title: 'Fiche produit', hreflang: ['fr'], default: 'multi', disclosure: 'public' },
        { rel: REL.pip, href: 'https://products.example.org/en/cell-pack', title: 'Product information', hreflang: ['en'], default: 'multi', disclosure: 'public' },
        { rel: REL.sustainabilityInfo, href: 'https://products.example.org/cell-pack/sustainability', title: 'Sustainability', type: 'text/html', disclosure: 'public' },
        { rel: REL.sustainabilityInfo, href: 'https://api.example.org/cell-pack/sustainability.json', title: 'Sustainability data', type: 'application/json', disclosure: 'public' },
        { rel: REL.epcis, href: 'https://epcis.example.org/events', title: 'Event query service', type: 'application/json', disclosure: 'restricted' },
      ],
    },
    {
      key: { ai: '01', value: GTIN },
      qualifiers: [{ ai: '22', value: '2A' }],
      configurationRevision: 'cfg-7',
      links: [{ rel: REL.pip, href: 'https://products.example.org/cell-pack/variant-2A', title: 'Variant 2A', disclosure: 'public' }],
    },
    {
      key: { ai: '01', value: GTIN },
      qualifiers: [{ ai: '10', value: 'LOT-2026-01' }],
      configurationRevision: 'cfg-7',
      links: [{ rel: REL.recallStatus, href: 'https://products.example.org/recalls/LOT-2026-01', title: 'Recall status', disclosure: 'public' }],
    },
    {
      key: { ai: '01', value: GTIN },
      qualifiers: [{ ai: '22', value: '2A' }, { ai: '10', value: 'LOT-2026-01' }],
      configurationRevision: 'cfg-7',
      links: [{ rel: REL.certificationInfo, href: 'https://products.example.org/certificates/2A-LOT-2026-01', title: 'Lot certificate', disclosure: 'public' }],
    },
    {
      key: { ai: '01', value: GTIN },
      qualifiers: [{ ai: '21', value: 'SER-0001' }],
      passportId: `https://dpp.example.org/01/${GTIN}/21/SER-0001`,
      bindingRef: 'genesis:aa'.padEnd(74, 'a') + ':0',
      configurationRevision: 'cfg-7',
      links: [
        { rel: DPP_EVIDENCE_PACKAGE_LINK_TYPE, href: `https://registry.example.org/passports/${encodeURIComponent(`https://dpp.example.org/01/${GTIN}/21/SER-0001`)}/evidence-package`, title: 'Evidence package', type: 'application/json', disclosure: 'public' },
      ],
    },
  ]
}

const request = (overrides: Partial<ResolutionRequest> & { key: Gs1Key }): ResolutionRequest => ({ audience: 'public', resolverRoot: ROOT, ...overrides })
const itemKey: Gs1Key = { ai: '01', value: GTIN, qualifiers: [{ ai: '21', value: 'SER-0001' }] }
const modelKey: Gs1Key = { ai: '01', value: GTIN, qualifiers: [] }

describe('the uncompressed Digital Link grammar for primary key 01', () => {
  it('reads the key, every qualifier in order, data attributes, linkType and the rest of the query', () => {
    const parsed = parseGs1DigitalLinkUri(`https://id.example.org/stem/01/9521234000013/22/2A/10/LOT-2026-01/21/SER%2F0001?17=261231&3103=001500&7003=2611011200&90=INTERNAL&linkType=gs1:pip&utm=x`)
    expect(parsed.kind).toBe('uncompressed')
    if (parsed.kind !== 'uncompressed') return
    expect(parsed.host).toBe('id.example.org')
    expect(parsed.pathStem).toBe('stem')
    expect(parsed.primaryKey).toEqual({ ai: '01', value: GTIN, checkDigitValid: true, demonstration: true })
    expect(parsed.qualifiers).toEqual([{ ai: '22', value: '2A' }, { ai: '10', value: 'LOT-2026-01' }, { ai: '21', value: 'SER/0001' }])
    expect(parsed.dataAttributes).toEqual([
      { ai: '17', value: '261231', validated: true },
      { ai: '3103', value: '001500', validated: true },
      { ai: '7003', value: '2611011200', validated: false },
      { ai: '90', value: 'INTERNAL', validated: true },
    ])
    expect(parsed.linkType).toEqual({ raw: 'gs1:pip', iri: `${GS1_VOCABULARY}pip` })
    expect(parsed.otherQuery).toEqual([['utm', 'x']])
  })

  it('tolerates one trailing slash, reads a bare GTIN, and reports a failing check digit without refusing it', () => {
    const bare = parseGs1DigitalLinkUri(`https://id.example.org/01/${GTIN}/`)
    expect(bare.kind === 'uncompressed' && bare.qualifiers).toEqual([])
    const failing = parseGs1DigitalLinkUri('https://id.example.org/01/09521234000014/21/X')
    expect(failing.kind === 'uncompressed' && failing.primaryKey.checkDigitValid).toBe(false)
    const eight = parseGs1DigitalLinkUri('https://id.example.org/01/96385074')
    expect(eight.kind === 'uncompressed' && eight.primaryKey.value).toBe('00000096385074')
  })

  it('reads the three spellings of linkType and leaves an unknown CURIE unexpanded', () => {
    const at = (query: string) => parseGs1DigitalLinkUri(`https://id.example.org/01/${GTIN}?linkType=${query}`)
    expect(at('linkset').kind === 'uncompressed' && at('linkset')).toMatchObject({ linkType: { raw: 'linkset', linkset: true } })
    expect(at('all')).toMatchObject({ linkType: { raw: 'all', linkset: true } })
    expect(at('https://gs1.org/voc/pip')).toMatchObject({ linkType: { iri: `${GS1_VOCABULARY}pip` } })
    expect(at('dpp:evidence')).toMatchObject({ linkType: { raw: 'dpp:evidence' } })
    expect((at('dpp:evidence') as { linkType?: { iri?: string } }).linkType?.iri).toBeUndefined()
  })

  it('refuses each departure from the grammar by name', () => {
    const reason = (uri: string) => {
      const parsed = parseGs1DigitalLinkUri(uri)
      return parsed.kind === 'invalid' ? parsed.reason : parsed.kind
    }
    expect(reason('not a url')).toBe('not-a-url')
    expect(reason(`ftp://id.example.org/01/${GTIN}`)).toBe('scheme')
    expect(reason(`https://id.example.org/01/${GTIN}/21/%E0%A4%A`)).toBe('percent-encoding')
    expect(reason(`https://id.example.org/gtin/${GTIN}`)).toBe('no-primary-key')
    expect(reason(`https://id.example.org/2024/01/${GTIN}`)).toBe('no-primary-key')
    expect(reason('https://id.example.org/00/095212340000000013')).toBe('unsupported-primary-key')
    expect(reason('https://id.example.org/8006/095212340000130102')).toBe('unsupported-primary-key')
    expect(reason('https://id.example.org/01/09521234000')).toBe('primary-key-not-a-gtin')
    expect(reason(`https://id.example.org/01/${GTIN}/21`)).toBe('trailing-segment')
    expect(reason(`https://id.example.org/01/${GTIN}/21/S/10/L`)).toBe('qualifier-order')
    expect(reason(`https://id.example.org/01/${GTIN}/10/L/10/M`)).toBe('qualifier-repeated')
    expect(reason(`https://id.example.org/01/${GTIN}/235/TPX1`)).toBe('qualifier-unsupported')
    expect(reason(`https://id.example.org/01/${GTIN}/99/X`)).toBe('qualifier-unsupported')
    expect(reason(`https://id.example.org/01/${GTIN}/21/${'a'.repeat(21)}`)).toBe('qualifier-value')
    expect(reason(`https://id.example.org/01/${GTIN}/21/with%20space`)).toBe('qualifier-value')
    expect(reason(`https://id.example.org/01/${GTIN}?21=X`)).toBe('key-in-query')
    expect(reason(`https://id.example.org/01/${GTIN}?414=9521234000013`)).toBe('key-in-query')
    expect(reason(`https://id.example.org/01/${GTIN}?17=261332`)).toBe('attribute-value')
    expect(reason(`https://id.example.org/01/${GTIN}?410=9521234000014`)).toBe('attribute-value')
    expect(reason(`https://id.example.org/01/${GTIN}?90=with%20space`)).toBe('attribute-value')
    expect(reason(`https://id.example.org/01/${GTIN}?410=9521234000013`)).toBe('uncompressed')
  })

  it('detects the special compressed form and nothing else as compressed', () => {
    const compressed = parseGs1DigitalLinkUri('https://id.example.org/stem/eh30164596f40c0e5cbe991a83?linkType=gs1:pip')
    expect(compressed).toMatchObject({ kind: 'compressed', prefix: 'eh', compressionString: 'eh30164596f40c0e5cbe991a83', pathStem: 'stem', query: '?linkType=gs1:pip' })
    expect(parseGs1DigitalLinkUri('https://id.example.org/AQnYUc')).toMatchObject({ kind: 'invalid', reason: 'no-primary-key' })
  })
})

describe('decompression of the EPC binary form', () => {
  it('decodes both worked examples of the compression standard to the uncompressed URI under the given stem', () => {
    for (const compressed of ['https://example.com/eh30164596f40c0e5cbe991a83', 'https://example.com/exMBZFlvQMDly-mRqD']) {
      const result = decompressGs1DigitalLink(compressed)
      expect(result.ok, compressed).toBe(true)
      if (!result.ok) return
      expect(result.uri).toBe('https://example.com/01/09528765123457/21/123456789123')
      expect(result.key).toEqual({ ai: '01', value: '09528765123457', qualifiers: [{ ai: '21', value: '123456789123' }] })
      expect(result.epc.epcUri).toBe('urn:epc:id:sgtin:9528765.012345.123456789123')
    }
  })

  it('keeps a stem and a query string, and refuses what is not a decodable compressed URI', () => {
    const withStem = decompressGs1DigitalLink('https://id.example.org/dl/eh30164596f40c0e5cbe991a83?linkType=gs1:pip')
    expect(withStem.ok && withStem.uri).toBe('https://id.example.org/dl/01/09528765123457/21/123456789123?linkType=gs1:pip')
    expect(decompressGs1DigitalLink(`https://id.example.org/01/${GTIN}`)).toMatchObject({ ok: false, reason: 'not-compressed' })
    expect(decompressGs1DigitalLink('https://id.example.org/eh31' + '0'.repeat(22))).toMatchObject({ ok: false, reason: 'unsupported-epc-scheme', header: '31' })
    expect(decompressGs1DigitalLink('https://id.example.org/ehzz')).toMatchObject({ ok: false, reason: 'not-hex' })
    expect(decompressGs1DigitalLink('not a url')).toMatchObject({ ok: false, reason: 'not-compressed' })
  })
})

describe('key tuples', () => {
  it('names one entity across hosts and never joins a serial across GTINs', () => {
    const here = parseGs1DigitalLinkUri(`https://id.example.org/01/${GTIN}/21/SER-0001`)
    const there = parseGs1DigitalLinkUri(`https://resolver.example.org/dl/01/9521234000013/21/SER-0001`)
    const other = parseGs1DigitalLinkUri(`https://id.example.org/01/${OTHER_GTIN}/21/SER-0001`)
    expect(gs1KeyTuple(here as never)).toBe(`01:${GTIN}|21:SER-0001`)
    expect(sameGs1Key(here as never, there as never)).toBe(true)
    expect(sameGs1Key(here as never, other as never)).toBe(false)
    expect(gs1KeyTuple(gs1KeyOf({ gtin: '9521234000013', qualifiers: [{ ai: '21', value: 'S' }, { ai: '22', value: 'V' }] }))).toBe(`01:${GTIN}|22:V|21:S`)
    expect(granularityOf([])).toBe('model')
    expect(granularityOf([{ ai: '22', value: 'V' }])).toBe('variant')
    expect(granularityOf([{ ai: '22', value: 'V' }, { ai: '10', value: 'L' }])).toBe('lot')
    expect(granularityOf([{ ai: '21', value: 'S' }])).toBe('item')
  })

  it('spells an uncompressed URI and the legacy evidence paths for an item', () => {
    expect(uncompressedUri(`${ROOT}/`, { ai: '01', value: GTIN, qualifiers: [{ ai: '10', value: 'L/1' }, { ai: '21', value: 'S' }] })).toBe(`${ROOT}/01/${GTIN}/10/L%2F1/21/S`)
    expect(legacyEvidencePaths(itemKey)).toEqual({ legacy: `/01/${GTIN}/21/SER-0001`, alias: `/resolve/gs1/01/${GTIN}/21/SER-0001` })
    expect(legacyEvidencePaths(modelKey)).toBeUndefined()
    expect(legacyEvidencePaths({ ai: '01', value: GTIN, qualifiers: [{ ai: '10', value: 'L' }, { ai: '21', value: 'S' }] })).toBeUndefined()
  })
})

describe('resolution records', () => {
  it('admits the demonstration records and refuses each rule breach by name', () => {
    for (const record of records()) expect(resolutionRecordProblems(record), record.qualifiers.map((q) => q.ai).join('+')).toEqual([])
    const [model] = records()
    const broken = (patch: Partial<ResolutionRecord>): string => resolutionRecordProblems({ ...model, ...patch }).join('; ')
    expect(broken({ key: { ai: '01', value: '09521234000014' } })).toContain('check digit')
    expect(broken({ qualifiers: [{ ai: '21', value: 'S' }, { ai: '10', value: 'L' }] })).toContain('out of order')
    expect(broken({ qualifiers: [{ ai: '10', value: 'L' }, { ai: '21', value: 'S' }] })).toContain('neither a variant nor a lot')
    expect(broken({ qualifiers: [{ ai: '235', value: 'X' }] })).toContain('not a hosted key qualifier')
    expect(broken({ qualifiers: [{ ai: '10', value: 'a'.repeat(21) }] })).toContain('1 to 20')
    expect(broken({ configurationRevision: '' })).toContain('revision')
    expect(broken({ links: [{ ...model.links[0] }, { ...model.links[0], href: 'https://x.example.org/second' }] })).toContain('at most one default')
    expect(broken({ links: [{ ...model.links[0], type: 'text/html' }] })).toContain('no optional attributes')
    expect(broken({ links: [{ ...model.links[3], href: 'http://insecure.example.org' }] })).toContain('https')
    expect(broken({ links: [{ ...model.links[3], title: ' ' }] })).toContain('title')
    expect(broken({ links: [{ ...model.links[3], rel: 'https://bsv-blockchain.github.io/dpp/link/evidence-package/1' }] })).toContain('linkset schema')
    expect(broken({ links: [{ ...model.links[3], rel: REL.defaultLink }] })).toContain('descriptive type')
    expect(broken({ links: [{ ...model.links[3], type: 'html' }] })).toContain('not a media type')
    expect(broken({ links: [{ ...model.links[3], hreflang: ['english'] }] })).toContain('language tag')
    expect(broken({ links: [{ ...model.links[3], hreflang: [] }] })).toContain('at least one tag')
    expect(broken({ links: [{ ...model.links[3], disclosure: 'secret' as never }] })).toContain('disclosure')
  })
})

describe('resolution against the records, as the standard\'s flow chart reads them', () => {
  it('walks up the tree: a serialised request inherits model links, each kept at its own granularity', () => {
    const result = resolveLinks(records(), request({ key: itemKey }))
    expect(result.outcome).toBe('redirect')
    if (result.outcome !== 'redirect') return
    expect(result.matched.map((m) => m.granularity)).toEqual(['item', 'model'])
    expect(result.matched.map((m) => m.anchor)).toEqual([`${ROOT}/01/${GTIN}/21/SER-0001`, `${ROOT}/01/${GTIN}`])
    expect(result.link.href).toBe('https://products.example.org/cell-pack')
    expect(result.link.granularity).toBe('model')
    expect(result.link.anchor).toBe(`${ROOT}/01/${GTIN}`)
    const evidence = result.links.find((l) => l.rel === DPP_EVIDENCE_PACKAGE_LINK_TYPE)
    expect(evidence?.granularity).toBe('item')
    expect(result.links.some((l) => l.rel === REL.epcis)).toBe(false)
  })

  it('unions exactly the registration levels the standard names for a variant-and-lot request', () => {
    const both = matchRecords(records(), { ai: '01', value: GTIN, qualifiers: [{ ai: '22', value: '2A' }, { ai: '10', value: 'LOT-2026-01' }] }, ROOT)
    expect(both.map((m) => m.record.qualifiers.map((q) => q.ai).join('+') || '01')).toEqual(['22+10', '10', '22', '01'])
    const lotOnly = matchRecords(records(), { ai: '01', value: GTIN, qualifiers: [{ ai: '10', value: 'LOT-2026-01' }] }, ROOT)
    expect(lotOnly.map((m) => m.record.qualifiers.map((q) => q.ai).join('+') || '01')).toEqual(['10', '01'])
    const otherLot = matchRecords(records(), { ai: '01', value: GTIN, qualifiers: [{ ai: '10', value: 'LOT-9' }] }, ROOT)
    expect(otherLot.map((m) => m.granularity)).toEqual(['model'])
    expect(matchRecords(records(), { ai: '01', value: OTHER_GTIN, qualifiers: [] }, ROOT)).toEqual([])
    expect(resolveLinks(records(), request({ key: { ai: '01', value: OTHER_GTIN, qualifiers: [] } }))).toEqual({ outcome: 'no-records', matched: [] })
  })

  it('redirects to a requested type when it exists, and answers not-found with the rest when it does not', () => {
    const recall = resolveLinks(records(), request({ key: { ai: '01', value: GTIN, qualifiers: [{ ai: '10', value: 'LOT-2026-01' }] }, linkType: REL.recallStatus }))
    expect(recall.outcome === 'redirect' && recall.link.href).toBe('https://products.example.org/recalls/LOT-2026-01')
    const missing = resolveLinks(records(), request({ key: modelKey, linkType: REL.traceability }))
    expect(missing.outcome).toBe('not-found')
    if (missing.outcome !== 'not-found') return
    expect(missing.requested).toBe(REL.traceability)
    expect(missing.links.length).toBeGreaterThan(0)
    const viaAlias = resolveLinks(records(), request({ key: modelKey, linkType: 'http://gs1.org/voc/recallStatus' }))
    expect(viaAlias.outcome).toBe('not-found')
  })

  it('refines the default by language and falls back to the single default when nothing matches', () => {
    const french = resolveLinks(records(), request({ key: modelKey, acceptLanguage: parseAcceptLanguage('fr-CH, fr;q=0.9, en;q=0.5') }))
    expect(french.outcome === 'redirect' && french.link.href).toBe('https://products.example.org/fr/cell-pack')
    const german = resolveLinks(records(), request({ key: modelKey, acceptLanguage: ['de'] }))
    expect(german.outcome === 'redirect' && german.link.href).toBe('https://products.example.org/cell-pack')
    const none = resolveLinks(records(), request({ key: modelKey }))
    expect(none.outcome === 'redirect' && none.link.href).toBe('https://products.example.org/cell-pack')
  })

  it('answers multiple choices when a requested type has equally good matches, and picks by media type first', () => {
    // The standard's example 11: two product pages, French and English, and a
    // Vietnamese reader; neither matches, so the resolver answers 300.
    const [model] = records()
    const twoPages: ResolutionRecord = { ...model, links: model.links.filter((l) => l.default === 'multi') }
    const vietnamese = resolveLinks([twoPages], request({ key: modelKey, linkType: REL.pip, acceptLanguage: ['vi'] }))
    expect(vietnamese.outcome).toBe('multiple-choices')
    if (vietnamese.outcome === 'multiple-choices') expect(vietnamese.candidates.map((c) => c.href).sort()).toEqual(['https://products.example.org/en/cell-pack', 'https://products.example.org/fr/cell-pack'])
    // With the undeclared-language default beside them, the link that makes
    // no language claim outranks the two that contradict the request.
    const undeclared = resolveLinks(records(), request({ key: modelKey, linkType: REL.pip, acceptLanguage: ['vi'] }))
    expect(undeclared.outcome === 'redirect' && undeclared.link.href).toBe('https://products.example.org/cell-pack')
    const english = resolveLinks(records(), request({ key: modelKey, linkType: REL.pip, acceptLanguage: ['en'] }))
    expect(english.outcome === 'redirect' && english.link.href).toBe('https://products.example.org/en/cell-pack')
    const preferred = resolveLinks(records(), request({ key: modelKey, linkType: REL.pip, acceptLanguage: parseAcceptLanguage('fr-CH, en;q=0.9') }))
    expect(preferred.outcome === 'redirect' && preferred.link.href).toBe('https://products.example.org/fr/cell-pack')
    const json = resolveLinks(records(), request({ key: modelKey, linkType: REL.sustainabilityInfo, accept: parseAcceptHeader('application/json, text/html;q=0.5') }))
    expect(json.outcome === 'redirect' && json.link.href).toBe('https://api.example.org/cell-pack/sustainability.json')
    const anyType = resolveLinks(records(), request({ key: modelKey, linkType: REL.sustainabilityInfo, accept: ['*/*'] }))
    expect(anyType.outcome).toBe('multiple-choices')
  })

  it('never shows a restricted link to a public audience, and flags it to an authorised one', () => {
    const publicView = resolveLinks(records(), request({ key: modelKey, linkType: REL.epcis }))
    expect(publicView.outcome).toBe('not-found')
    const authorised = resolveLinks(records(), request({ key: modelKey, linkType: REL.epcis, audience: 'authorised' }))
    expect(authorised.outcome === 'redirect' && authorised.link.disclosure).toBe('restricted')
    const doc = linksetDocument(records(), request({ key: modelKey, audience: 'authorised' }))
    const entry = doc?.linkset[0] as Record<string, Array<{ public?: boolean }>>
    expect(entry[REL.epcis][0].public).toBe(false)
    const publicDoc = linksetDocument(records(), request({ key: modelKey }))
    expect(JSON.stringify(publicDoc)).not.toContain('epcis.example.org')
  })

  it('parses Accept and Accept-Language with their weights', () => {
    expect(parseAcceptHeader('text/html;q=0.9, application/json, */*;q=0')).toEqual(['application/json', 'text/html'])
    expect(parseAcceptLanguage(undefined)).toEqual([])
    expect(parseAcceptLanguage('en;q=0.8, fr-CH')).toEqual(['fr-CH', 'en'])
    expect(bestMatch([], { accept: [] })).toBeUndefined()
  })
})

describe('linksets and the discovery client', () => {
  it('builds a linkset that validates against the pinned GS1 schema, anchored at each record\'s own uncompressed URI', () => {
    const doc = linksetDocument(records(), request({ key: itemKey }))
    expect(doc).toBeDefined()
    if (doc == null) return
    expect(validateLinkset(doc), JSON.stringify(validateLinkset.errors)).toBe(true)
    expect(doc.linkset.map((e) => e.anchor)).toEqual([`${ROOT}/01/${GTIN}/21/SER-0001`, `${ROOT}/01/${GTIN}`])
    const model = doc.linkset[1] as Record<string, unknown>
    expect(model.description).toBe('Demonstration cell pack')
    expect((model[REL.defaultLink] as unknown[]).length).toBe(1)
    expect((model[REL.defaultLinkMulti] as unknown[]).length).toBe(2)
    expect((model[REL.pip] as unknown[]).length).toBe(3)
    expect((model[REL.defaultLink] as Array<Record<string, unknown>>)[0]).toEqual({ href: 'https://products.example.org/cell-pack', title: 'Product information' })
    expect(Object.keys(doc.linkset[0])).toEqual(['anchor', DPP_EVIDENCE_PACKAGE_LINK_TYPE])
    expect(linksetDocument(records(), request({ key: { ai: '01', value: OTHER_GTIN, qualifiers: [] } }))).toBeUndefined()
  })

  it('selects a link over its own linkset and over one spelled with the other GS1 namespace, reporting the anchor\'s scope', () => {
    const doc = linksetDocument(records(), request({ key: itemKey })) as LinksetDocument
    const chosen = selectLink(doc, { rel: 'gs1:pip', language: 'fr' })
    expect(chosen.outcome).toBe('selected')
    if (chosen.outcome !== 'selected') return
    expect(chosen.link.href).toBe('https://products.example.org/fr/cell-pack')
    expect(chosen.anchor).toBe(`${ROOT}/01/${GTIN}`)
    expect(chosen.scope.granularity).toBe('model')
    expect(chosen.scope.key && gs1KeyTuple(chosen.scope.key)).toBe(`01:${GTIN}`)
    const evidence = selectLink(doc, { rel: DPP_EVIDENCE_PACKAGE_LINK_TYPE, mediaType: 'application/json' })
    expect(evidence.outcome === 'selected' && evidence.scope.granularity).toBe('item')
    const ambiguous = selectLink(doc, { rel: REL.pip })
    expect(ambiguous.outcome).toBe('ambiguous')
    const absent = selectLink(doc, { rel: REL.traceability })
    expect(absent.outcome === 'not-found' && absent.available).toContain(REL.pip)
    const foreign: LinksetDocument = { linkset: [{ anchor: 'https://other.example.org/01/09521234000013', 'http://gs1.org/voc/pip': [{ href: 'https://other.example.org/p', title: 'Elsewhere' }] }, { anchor: 'urn:opaque:1', 'http://gs1.org/voc/epcis': [{ href: 'https://other.example.org/e', title: 'Events' }] }] }
    const fromForeign = selectLink(foreign, { rel: REL.pip })
    expect(fromForeign.outcome === 'selected' && fromForeign.scope.granularity).toBe('model')
    const opaque = selectLink(foreign, { rel: REL.epcis })
    expect(opaque.outcome === 'selected' && opaque.scope.granularity).toBe('unknown')
    expect(normaliseLinkType('https://gs1.org/voc/pip')).toBe(REL.pip)
    expect(normaliseLinkType(DPP_EVIDENCE_PACKAGE_LINK_TYPE)).toBe(DPP_EVIDENCE_PACKAGE_LINK_TYPE)
  })

  it('describes the resolver in a file that validates against the pinned description schema, for one primary key', () => {
    const description = describeResolver({ resolverRoot: 'https://id.example.org/', name: 'Demonstration resolver', contact: { fn: 'Operator' }, supportedContextValuesEnumerated: ['CH'] })
    expect(validateDescription(description), JSON.stringify(validateDescription.errors)).toBe(true)
    expect(description.resolverRoot).toBe('https://id.example.org')
    expect(description.supportedPrimaryKeys).toEqual(['01'])
    expect(description.linkTypeDefaultCanBeLinkset).toBe(false)
    expect(description.jsonLdContextLocation).toBe(LINKSET_CONTEXT_URI)
    expect(description.supportedLinkType.map((s) => s.prefix)).toEqual(['gs1:', 'dpp:'])
    expect(() => describeResolver({ resolverRoot: 'http://id.example.org' })).toThrow('TLS')
    expect(() => describeResolver({ resolverRoot: 'https://id.example.org/?x=1' })).toThrow('query')
    expect(() => describeResolver({ resolverRoot: 'id.example.org' })).toThrow('absolute')
  })
})

/* ------------------------------------------------------------------------ */
/* Published vectors                                                        */
/* ------------------------------------------------------------------------ */

const REFERENCE = 'dpp-profiles@0.3.0'
const VECTOR_SCHEMA = 'https://raw.githubusercontent.com/bsv-blockchain/ts-stack/main/conformance/schema/vector.schema.json'

function expectPublished(name: string, generated: unknown): void {
  const path = join(FIXTURES, name)
  const canonical = JSON.parse(JSON.stringify(generated))
  if (process.env.REGENERATE_FIXTURES === '1') writeFileSync(path, JSON.stringify(canonical, null, 2) + '\n')
  expect(JSON.parse(readFileSync(path, 'utf8')), name).toEqual(canonical)
}

/** The public shape of a parse, without host-specific noise, so a vector is a statement about the grammar. */
const parseVector = (id: string, description: string, uri: string, tags: string[]) => ({ id, description, input: { uri }, expected: parseGs1DigitalLinkUri(uri) as unknown as Record<string, unknown>, tags })

function uriSyntaxVectors() {
  return {
    $schema: VECTOR_SCHEMA,
    id: 'dpp.interoperability.gs1.uri-syntax',
    name: 'GS1 Digital Link URI syntax for primary key 01: what the discovery profile reads and what it refuses',
    version: '1.0.0',
    reference_impl: REFERENCE,
    parity_class: 'required',
    vectors: [
      parseVector('gtin-with-every-qualifier-and-attributes', 'Primary key 01 with the consumer product variant, lot and serial in order, a percent-encoded serial, dates and measures as data attributes, an unknown attribute carried unvalidated, a gs1: CURIE linkType and a foreign query parameter.', `https://id.example.org/01/9521234000013/22/2A/10/LOT-2026-01/21/SER%2F0001?17=261231&3103=001500&7003=2611011200&linkType=gs1:pip&utm=x`, ['happy-path']),
      parseVector('gtin-only-with-trailing-slash', 'A bare GTIN with one trailing slash, tolerated as the resolver standard section 2.13 asks.', `https://id.example.org/01/${GTIN}/`, ['happy-path']),
      parseVector('gtin-eight-digits-and-stem', 'A GTIN-8 under a stem is spelled at fourteen digits; the stem is kept apart.', 'https://resolver.example.org/dl/01/96385074/21/S1', ['happy-path']),
      parseVector('check-digit-failure-reported', 'A GTIN whose check digit fails is read and reported, never refused: historical records carry such numbers.', 'https://id.example.org/01/09521234000014/21/X', ['happy-path']),
      parseVector('linktype-linkset', 'linkType=linkset asks for the list, not a redirect.', `https://id.example.org/01/${GTIN}?linkType=linkset`, ['happy-path']),
      parseVector('compressed-detected', 'The special compressed form is recognised by its prefix and handed to decompression; nothing is guessed from it here.', 'https://id.example.org/eh30164596f40c0e5cbe991a83', ['happy-path']),
      parseVector('refuse-unsupported-primary-key', 'An SSCC is a real primary key this profile does not host.', 'https://id.example.org/00/095212340000000013', ['error-case']),
      parseVector('refuse-no-primary-key', 'No segment is an application identifier, and the general compressed form is not decoded.', 'https://id.example.org/AQnYUc', ['error-case']),
      parseVector('refuse-qualifier-order', 'A lot after a serial breaks the fixed order 22, 10, 21.', `https://id.example.org/01/${GTIN}/21/S/10/L`, ['error-case']),
      parseVector('refuse-qualifier-repeated', 'A qualifier appears twice.', `https://id.example.org/01/${GTIN}/10/L/10/M`, ['error-case']),
      parseVector('refuse-tpx', 'The third-party serialised extension is a GTIN qualifier outside the hosted scope.', `https://id.example.org/01/${GTIN}/235/TPX1`, ['error-case']),
      parseVector('refuse-serial-too-long', 'Twenty-one characters exceed AI 21.', `https://id.example.org/01/${GTIN}/21/${'a'.repeat(21)}`, ['error-case']),
      parseVector('refuse-key-in-query', 'A key qualifier in the query belongs in the path.', `https://id.example.org/01/${GTIN}?21=X`, ['error-case']),
      parseVector('refuse-bad-date-attribute', 'AI 17 is a six-digit date; month 13 is not one.', `https://id.example.org/01/${GTIN}?17=261332`, ['error-case']),
      parseVector('refuse-trailing-segment', 'An application identifier with no value.', `https://id.example.org/01/${GTIN}/21`, ['error-case']),
      parseVector('refuse-percent-encoding', 'A malformed percent sequence in a qualifier.', `https://id.example.org/01/${GTIN}/21/%E0%A4%A`, ['error-case']),
    ],
  }
}

function epcBinaryVectors() {
  const decompress = (id: string, description: string, uri: string, tags: string[]) => ({ id, description, input: { uri }, expected: decompressGs1DigitalLink(uri) as unknown as Record<string, unknown>, tags })
  return {
    $schema: VECTOR_SCHEMA,
    id: 'dpp.interoperability.gs1.epc-binary',
    name: 'Special compressed GS1 Digital Link URIs carrying EPC binary strings, decompressed to primary key 01 and serial',
    version: '1.0.0',
    reference_impl: REFERENCE,
    parity_class: 'required',
    vectors: [
      decompress('worked-example-hexadecimal', 'The compression standard\'s worked example under the eh prefix (section 4.2.1), an SGTIN-96 in hexadecimal; GS1 published the expected result.', 'https://example.com/eh30164596f40c0e5cbe991a83', ['happy-path']),
      decompress('worked-example-base64', 'The same EPC under the ex prefix (section 4.2.2), URI-safe base 64.', 'https://example.com/exMBZFlvQMDly-mRqD', ['happy-path']),
      decompress('stem-and-query-carried', 'The stem before the compression string and the query after it survive decompression.', 'https://id.example.org/dl/eh30164596f40c0e5cbe991a83?linkType=gs1:pip', ['happy-path']),
      decompress('sgtin-198-demonstration-prefix', 'An SGTIN-198 under the demonstration prefix with a character serial, fifty hexadecimal characters with two zero padding bits; built by this package\'s encoder, so a positive vector of the 198-bit layout rather than an independent one.', `https://id.example.org/eh${hexFromBits(encodeSgtinBits({ scheme: 'sgtin-198', filter: 1, partition: 5, companyPrefix: '9521234', itemReference: '000001', serial: 'SER-0001' }))}`, ['happy-path']),
      decompress('refuse-uncompressed', 'An uncompressed URI is not echoed as a decompression.', `https://id.example.org/01/${GTIN}`, ['error-case']),
      decompress('refuse-other-epc-scheme', 'An SSCC-96 header (31) is a GS1 scheme outside the declared scope.', 'https://id.example.org/eh310000000000000000000000', ['error-case']),
      decompress('refuse-upper-case-hex', 'The eh form is lower-case hexadecimal.', 'https://id.example.org/eh30164596F40C0E5CBE991A83', ['error-case']),
      decompress('refuse-wrong-length', 'A truncated SGTIN-96.', 'https://id.example.org/eh3016459', ['error-case']),
    ],
  }
}

function resolutionVectors() {
  const held = records()
  const strip = (outcome: ReturnType<typeof resolveLinks>): Record<string, unknown> => {
    const links = 'links' in outcome ? outcome.links.map((l) => ({ rel: l.rel, href: l.href, anchor: l.anchor, granularity: l.granularity, disclosure: l.disclosure })) : []
    const matched = outcome.matched.map((m) => ({ anchor: m.anchor, granularity: m.granularity }))
    switch (outcome.outcome) {
      case 'no-records': return { outcome: 'no-records' }
      case 'linkset': return { outcome: 'linkset', matched, links }
      case 'redirect': return { outcome: 'redirect', matched, href: outcome.link.href, anchor: outcome.link.anchor, granularity: outcome.link.granularity, links }
      case 'multiple-choices': return { outcome: 'multiple-choices', matched, candidates: outcome.candidates.map((c) => c.href).sort(), links }
      case 'not-found': return { outcome: 'not-found', matched, requested: outcome.requested, links }
    }
  }
  const resolve = (id: string, description: string, req: Omit<ResolutionRequest, 'resolverRoot'>, tags: string[]) => ({ id, description, input: { request: { ...req, resolverRoot: ROOT } }, expected: strip(resolveLinks(held, { ...req, resolverRoot: ROOT })), tags })
  const item = itemKey
  const lot: Gs1Key = { ai: '01', value: GTIN, qualifiers: [{ ai: '10', value: 'LOT-2026-01' }] }
  const both: Gs1Key = { ai: '01', value: GTIN, qualifiers: [{ ai: '22', value: '2A' }, { ai: '10', value: 'LOT-2026-01' }] }
  return {
    $schema: VECTOR_SCHEMA,
    id: 'dpp.interoperability.gs1.resolution',
    name: 'Resolution over one set of records: the hierarchy of section 2.5.10, defaults, requested types, negotiation, disclosure and the linkset',
    version: '1.0.0',
    reference_impl: REFERENCE,
    parity_class: 'required',
    records: held.map((r) => ({ ...r, links: r.links })),
    vectors: [
      resolve('serial-default-inherits-model', 'A serialised request with no linkType redirects to the model\'s default; the link is model information and the item record contributes only its own link.', { key: item, audience: 'public' }, ['happy-path']),
      resolve('serial-linkset-two-anchors', 'The linkset for a serialised request carries the item anchor and the model anchor, each with its own links.', { key: item, audience: 'public', linkType: 'linkset' }, ['happy-path']),
      resolve('variant-and-lot-union', 'A variant-and-lot request unions the 01+22+10, 01+10, 01+22 and 01 levels, most specific first.', { key: both, audience: 'public', linkType: 'linkset' }, ['happy-path']),
      resolve('lot-only-excludes-variant-level', 'A lot-only request does not find a link registered against the variant and lot together.', { key: lot, audience: 'public', linkType: 'linkset' }, ['happy-path']),
      resolve('requested-type-redirect', 'A requested type registered at the lot level redirects to it.', { key: lot, audience: 'public', linkType: REL.recallStatus }, ['happy-path']),
      resolve('language-refines-default', 'Accept-Language fr picks the French refined default.', { key: modelKey, audience: 'public', acceptLanguage: ['fr'] }, ['happy-path']),
      resolve('language-without-match-falls-back', 'Accept-Language de matches no refined default, so the single default answers.', { key: modelKey, audience: 'public', acceptLanguage: ['de'] }, ['happy-path']),
      resolve('media-type-picks-json', 'A requested type with two representations is decided by the Accept header.', { key: modelKey, audience: 'public', linkType: REL.sustainabilityInfo, accept: ['application/json'] }, ['happy-path']),
      resolve('restricted-hidden-from-public', 'A restricted link type requested by a public audience is not found; it is not disclosed by refusal wording either.', { key: modelKey, audience: 'public', linkType: REL.epcis }, ['error-case']),
      resolve('restricted-shown-to-authorised', 'The same request from an authorised audience redirects, with the link flagged restricted.', { key: modelKey, audience: 'authorised', linkType: REL.epcis }, ['happy-path']),
      resolve('undeclared-language-outranks-mismatch', 'Three product pages, one with no language declared and two contradicting Vietnamese: the one that makes no claim answers.', { key: modelKey, audience: 'public', linkType: REL.pip, acceptLanguage: ['vi'] }, ['happy-path']),
      resolve('multiple-choices-on-tie', 'Two sustainability representations under an Accept of */*: neither is better, so the resolver answers 300 rather than choosing.', { key: modelKey, audience: 'public', linkType: REL.sustainabilityInfo, accept: ['*/*'] }, ['error-case']),
      resolve('type-not-available', 'A requested type nobody registered is 404 with the available links beside it.', { key: modelKey, audience: 'public', linkType: REL.traceability }, ['error-case']),
      resolve('unknown-gtin', 'A GTIN nobody registered is 404 with nothing beside it.', { key: { ai: '01', value: OTHER_GTIN, qualifiers: [] }, audience: 'public' }, ['error-case']),
      {
        id: 'linkset-document-item',
        description: 'The linkset document for the serialised request, which validates against the pinned GS1 linkset schema.',
        input: { request: { key: item, audience: 'public', resolverRoot: ROOT } },
        expected: linksetDocument(held, { key: item, audience: 'public', resolverRoot: ROOT }) as unknown as Record<string, unknown>,
        tags: ['happy-path'],
      },
      {
        id: 'description-file',
        description: 'The resolver description file for the demonstration root, which validates against the pinned description schema.',
        input: { resolverRoot: ROOT, name: 'Demonstration resolver' },
        expected: describeResolver({ resolverRoot: ROOT, name: 'Demonstration resolver' }) as unknown as Record<string, unknown>,
        tags: ['happy-path'],
      },
    ],
  }
}

describe('the published vectors', () => {
  it('uri-syntax.json is what the grammar produces', () => {
    expectPublished('uri-syntax.json', uriSyntaxVectors())
  })
  it('epc-binary.json is what decompression produces', () => {
    expectPublished('epc-binary.json', epcBinaryVectors())
  })
  it('resolution.json is what resolution over the demonstration records produces, and its linkset and description validate', () => {
    const generated = resolutionVectors()
    expectPublished('resolution.json', generated)
    const linkset = generated.vectors.find((v) => v.id === 'linkset-document-item')?.expected
    expect(validateLinkset(linkset), JSON.stringify(validateLinkset.errors)).toBe(true)
    const description = generated.vectors.find((v) => v.id === 'description-file')?.expected
    expect(validateDescription(description), JSON.stringify(validateDescription.errors)).toBe(true)
  })
  it('every vector file has the stack\'s shape and no competitor host', () => {
    for (const file of [uriSyntaxVectors(), epcBinaryVectors(), resolutionVectors()]) {
      expect(file.id).toMatch(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/)
      const ids = file.vectors.map((v) => v.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const v of file.vectors) {
        expect(v.id).toMatch(/^[a-z0-9-]+$/)
        expect(v.tags?.some((t) => t === 'happy-path' || t === 'error-case')).toBe(true)
      }
      expect(JSON.stringify(file)).toMatch(/example\.(org|com)/)
    }
  })
})
