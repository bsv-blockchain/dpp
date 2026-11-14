// The web client's sector forms, exercised here because the web app has no
// test runner of its own and these modules touch neither the page nor the
// network. What is tested is the part that decides what gets written: the
// document a form builds from what was entered, and where a validator's
// finding is shown. The pages around it are type-checked by the build.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { describeProduct, describeValue, humaniseName } from '../../web/src/lib/bound/display'
import { buildDocument, codeClasses, emptyState, fieldPointerFor, labelsOf, parseDocument, splitPreview, stripComments, tierOf, topLevelFields, type FormState, type Json, type SectorForm } from '../../web/src/lib/bound/form-model'
import { sectorFormFor } from '../../web/src/lib/bound/forms'
import { identityFromDocument, mintIdentity } from '../../web/src/lib/bound/identity'
import type { ViewCheck } from '../src/bound-profiles.js'
import { loadConfig } from '../src/config.js'
import { mintGtin, mintPassportId } from '../src/identifiers.js'
import { openPlatform, type Platform } from '../src/platform.js'
import { sectorExamples } from '../src/sector-examples.js'
import { WriteRefused } from '../src/writer.js'

const config = loadConfig({ NETWORK: 'main', PASSPORT_HOST: 'passports.example.com', GS1_PREFIX: '952', LIVE_PUBLISHING: 'false' })
const policy = { host: config.passportHost, prefix: config.gs1Prefix }
const brandId = 'brand-forms-1'
let platform: Platform

beforeAll(async () => {
  platform = await openPlatform({ config, mode: 'test', log: () => {} })
})
afterAll(async () => {
  await platform.close()
})

const formFor = (profile: string): SectorForm => {
  const form = sectorFormFor(profile)
  if (form == null) throw new Error(`no form for ${profile}`)
  return form
}
/** The addresses the registered binding lists for the form's context files, as the page receives them from the API. */
const contextsFor = (form: SectorForm): string[] => {
  const described = platform.profiles.describe(platform.profiles.get(form.profile)!)
  return form.contexts.map((path) => described.contexts.find((context) => context.path === path)!.uri)
}
const minted = (itemReference: string, serial: string) => {
  const identity = mintIdentity(policy, itemReference, serial)
  if (!identity.ok) throw new Error(identity.problem)
  return identity
}

describe('the identifier the form writes', () => {
  it('is the one the API mints, with the same GTIN and serial in the document', () => {
    for (const [itemReference, serial] of [
      ['100200300', 'HC48-2026-000117'],
      ['000000001', 'A/B+C 1'.replace(' ', '_')],
      ['999999999', "it's:<ok>"],
    ]) {
      const identity = minted(itemReference, serial)
      expect(identity.passportId).toBe(mintPassportId(policy, itemReference, serial))
      expect(identity.gtin).toBe(mintGtin(policy.prefix, itemReference))
      for (const profile of ['eu-battery@1', 'eu-textile@1']) {
        const form = formFor(profile)
        const { product } = buildDocument(form, emptyState(), identity, contextsFor(form))
        // One serial and one GTIN go in, and every member that states either is written from them.
        expect(product.id).toBe(identity.passportId)
        expect(product['gs1:gtin']).toBe(identity.gtin)
        for (const member of form.serialMembers) expect(product[member]).toBe(serial)
      }
    }
  })

  it('refuses an item reference or a serial the API would refuse', () => {
    expect(mintIdentity(policy, '12345', 'A1')).toMatchObject({ ok: false })
    expect(mintIdentity(policy, '12345678x', 'A1')).toMatchObject({ ok: false })
    expect(mintIdentity(policy, '100200300', '')).toMatchObject({ ok: false })
    expect(mintIdentity(policy, '100200300', 'has a space')).toMatchObject({ ok: false })
    expect(mintIdentity(policy, '100200300', 'x'.repeat(21))).toMatchObject({ ok: false })
  })

  it('reads the item reference and serial back from a loaded document under this prefix, and refuses another prefix', () => {
    expect(identityFromDocument(policy, 'https://id.example/01/09521002003000/21/HC48-2026-000117')).toEqual({ itemReference: '100200300', serial: 'HC48-2026-000117' })
    // The same document on a platform with another prefix is not that platform's to write.
    expect(identityFromDocument({ host: policy.host, prefix: '9539' }, 'https://id.example/01/09521002003000/21/HC48-2026-000117')).toHaveProperty('problem')
    expect(identityFromDocument(policy, 'https://id.example/01/09521002003000')).toHaveProperty('problem')
    expect(identityFromDocument(policy, undefined)).toHaveProperty('problem')
  })
})

describe('an empty form', () => {
  it('writes the identity and nothing else: no identifier, classification, date or unit is made up', () => {
    const identity = minted('100200300', 'EMPTY-0001')
    const battery = formFor('eu-battery@1')
    expect(buildDocument(battery, emptyState(), identity, contextsFor(battery))).toMatchObject({
      problems: [],
      product: { '@context': contextsFor(battery), id: identity.passportId, type: ['gs1:Product', 'eubat:Battery'], 'oec:granularityLevel': 'item', 'gs1:gtin': identity.gtin, 'gs1:hasSerialNumber': 'EMPTY-0001' },
    })
    expect(Object.keys(buildDocument(battery, emptyState(), identity, contextsFor(battery)).product)).toEqual(['@context', 'id', 'type', 'oec:granularityLevel', 'gs1:gtin', 'gs1:hasSerialNumber'])
    const textile = formFor('eu-textile@1')
    expect(Object.keys(buildDocument(textile, emptyState(), identity, contextsFor(textile)).product)).toEqual(['@context', 'id', 'type', 'oec:granularityLevel', 'gs1:gtin', 'schema:serialNumber'])
  })

  it('writes nothing for fields that were touched and left empty, and no node for a group with only its fixed members', () => {
    const identity = minted('100200300', 'EMPTY-0002')
    const form = formFor('eu-battery@1')
    const state: FormState = {
      ...emptyState(),
      values: {
        'eubat:batteryModelIdentifier': '   ',
        'gs1:productName': [{ value: '', language: 'en' }],
        'gs1:netWeight': { value: '', unit: '' },
        'gs1:manufacturer': { 'gs1:organizationName': '', 'gs1:address': { 'gs1:streetAddress': '' }, 'gs1:contactPoint': {} },
        'eubat:hasCarbonFootprintDeclaration': { 'oea:hasIndicator': { 'oea:hasCategoricalValue': '' } },
        'eubat:hasMaterialComposition': [{}, { 'schema:name': { value: '', language: '' } }],
        'eubat:ceMarkingIndicator': undefined,
      },
    }
    const built = buildDocument(form, state, identity, contextsFor(form))
    expect(built.problems).toEqual([])
    expect(Object.keys(built.product)).toEqual(['@context', 'id', 'type', 'oec:granularityLevel', 'gs1:gtin', 'gs1:hasSerialNumber'])
  })
})

describe('what a field writes', () => {
  const identity = () => minted('100200300', 'FIELD-0001')
  const build = (values: FormState['values']) => {
    const form = formFor('eu-battery@1')
    return buildDocument(form, { ...emptyState(), values }, identity(), contextsFor(form))
  }

  it('keeps the digits of a number as typed, and a measurement as a value with its unit', () => {
    const { product, problems } = build({
      'gs1:netWeight': { value: '41.50', unit: 'KGM' },
      'eubat:numberOfCells': '16',
      'eubat:hasTechnicalSpecifications': { 'eubat:cRate': '0.50', 'eubat:hasTemperatureRangeCharging': { 'eubat:hasMinimumTemperature': { value: '-0', unit: 'CEL' } } },
    })
    expect(problems).toEqual([])
    expect(product['gs1:netWeight']).toEqual({ type: 'gs1:QuantitativeValue', 'gs1:value': '41.50', 'gs1:unitCode': 'KGM' })
    expect(product['eubat:numberOfCells']).toBe(16)
    expect(product['eubat:hasTechnicalSpecifications']).toEqual({
      type: 'eubat:TechnicalSpecification',
      'eubat:cRate': '0.50',
      'eubat:hasTemperatureRangeCharging': { type: 'eubat:TemperatureRange', 'eubat:hasMinimumTemperature': { type: 'gs1:QuantitativeValue', 'gs1:value': '-0', 'gs1:unitCode': 'CEL' } },
    })
  })

  it('stops, and writes nothing in its place, for a measurement with no unit, a unit with no value, or a number that is not one', () => {
    const { problems, product } = build({
      'gs1:netWeight': { value: '41.5', unit: '' },
      'gs1:grossWeight': { value: '', unit: 'KGM' },
      'eubat:numberOfCells': '16.5',
      'eubat:hasTechnicalSpecifications': { 'eubat:cRate': 'half' },
      'gs1:productionDate': '18/09/2026',
      'oec:lastUpdated': '2026-11-02 09:30',
      'gs1:countryOfOrigin': 'Australia',
      'eubat:warrantyConditions': 'see the box',
    })
    expect(problems.map((p) => p.pointer).sort()).toEqual(
      ['/eubat:hasTechnicalSpecifications/eubat:cRate', '/eubat:numberOfCells', '/eubat:warrantyConditions', '/gs1:countryOfOrigin', '/gs1:grossWeight', '/gs1:netWeight', '/gs1:productionDate', '/oec:lastUpdated'].sort()
    )
    for (const key of ['gs1:netWeight', 'gs1:grossWeight', 'eubat:numberOfCells', 'gs1:productionDate', 'oec:lastUpdated', 'gs1:countryOfOrigin', 'eubat:warrantyConditions']) expect(product[key]).toBeUndefined()
  })

  it('writes text with its language, or as plain text when no language was chosen, and a code as a reference', () => {
    const { product } = build({
      'gs1:productName': [
        { value: 'Harbour module', language: 'en' },
        { value: 'Module Harbour', language: 'fr' },
        { value: '', language: 'de' },
      ],
      'schema:model': { value: 'Harbour 48-100', language: '' },
      'schema:category': 'eubat:StationaryBattery',
      'oec:passportStatus': 'draft',
      'eubat:ceMarkingIndicator': false,
    })
    expect(product['gs1:productName']).toEqual([
      { '@value': 'Harbour module', '@language': 'en' },
      { '@value': 'Module Harbour', '@language': 'fr' },
    ])
    expect(product['schema:model']).toBe('Harbour 48-100')
    expect(product['schema:category']).toEqual({ '@id': 'eubat:StationaryBattery' })
    expect(product['oec:passportStatus']).toBe('draft')
    expect(product['eubat:ceMarkingIndicator']).toBe(false)
  })

  it('keeps the manufacturer\'s identifiers apart from display names', () => {
    const fields = topLevelFields(formFor('eu-battery@1'))
    const keys = fields.map((field) => field.key)
    for (const key of ['eubat:batteryModelIdentifier', 'gs1:productName', 'schema:model', 'eubat:manufacturerIdentifier', 'eubat:operatorIdentifier', 'eubat:facilityIdentifier', 'gs1:manufacturer', 'eubat:hasOperatorInformation', 'eubat:hasManufacturingPlace']) expect(keys).toContain(key)
    // No field writes the serial or the GTIN: they come from the passport identifier alone.
    for (const profile of ['eu-battery@1', 'eu-textile@1']) {
      const all = JSON.stringify(formFor(profile).sections)
      for (const member of ['gs1:gtin', 'gs1:hasSerialNumber', 'schema:serialNumber', 'gs1:productID']) expect(all).not.toContain(`"key":"${member}"`)
    }
  })

  it('writes a fibre share as a typed number and the five care symbols as codes', () => {
    const form = formFor('eu-textile@1')
    const { product, problems } = buildDocument(
      form,
      {
        ...emptyState(),
        values: {
          'gs1:textileMaterial': [{ 'gs1:textileMaterialPercentage': '87.5', 'gs1:textileMaterialDescription': { value: 'Wool', language: 'en' }, 'eutex:fiberOrigin': 'NZ', 'eutex:isRecycledFiber': false }],
          'eutex:hasCareInstructions': { 'eutex:hasWashingSymbol': 'eutex:Wash30', 'eutex:hasDryingSymbol': 'eutex:DryFlat' },
          'eutex:hasDurabilityInfo': { 'oea:hasSubAssessment': [{ 'oea:hasMethod': 'eutex:PillingTest', 'oea:hasResult': { 'oea:hasObservedParameter': 'eutex:PillingResistance', 'oea:hasMeasuredValue': { value: '4', unit: 'C62' } } }] },
        },
      },
      minted('100200400', 'FIELD-0002'),
      contextsFor(form)
    )
    expect(problems).toEqual([])
    expect(product['gs1:textileMaterial']).toEqual([
      { type: 'gs1:TextileMaterialDetails', 'gs1:textileMaterialPercentage': { '@value': '87.5', '@type': 'xsd:decimal' }, 'gs1:textileMaterialDescription': { '@value': 'Wool', '@language': 'en' }, 'eutex:fiberOrigin': 'NZ', 'eutex:isRecycledFiber': false },
    ])
    expect(product['eutex:hasCareInstructions']).toEqual({ type: 'eutex:CareInstruction', 'eutex:hasWashingSymbol': { '@id': 'eutex:Wash30' }, 'eutex:hasDryingSymbol': { '@id': 'eutex:DryFlat' } })
    expect(product['eutex:hasDurabilityInfo']).toEqual({
      type: 'eutex:DurabilityInfo',
      'oea:hasSubAssessment': [
        {
          type: 'oea:TestExecution',
          'oea:hasMethod': { '@id': 'eutex:PillingTest' },
          'oea:hasResult': { type: 'oea:MeasurementResult', 'oea:hasObservedParameter': { '@id': 'eutex:PillingResistance' }, 'oea:hasMeasuredValue': { type: 'gs1:QuantitativeValue', 'gs1:value': '4', 'gs1:unitCode': 'C62' } },
        },
      ],
    })
  })
})

describe.each(['eu-battery@1', 'eu-textile@1'])('the %s form and its example', (profile) => {
  it('holds every property of the example in a field, and builds the same document back', () => {
    const form = formFor(profile)
    const example = sectorExamples(platform.profiles.get(profile)!, policy)[0]
    const parsed = parseDocument(form, example.product)
    expect(parsed.kept).toEqual([])
    expect(parsed.stated).toEqual({ id: example.passportId, gtin: mintGtin(policy.prefix, example.itemReference), serial: example.serial })
    expect(identityFromDocument(policy, parsed.stated.id)).toEqual({ itemReference: example.itemReference, serial: example.serial })
    const built = buildDocument(form, parsed.state, minted(example.itemReference, example.serial), contextsFor(form))
    expect(built.problems).toEqual([])
    expect(built.product).toEqual(example.product)
  })

  it('builds a document the writer accepts, and labels each property with the tier the binding gives it', async () => {
    const form = formFor(profile)
    const bound = platform.profiles.get(profile)!
    const example = sectorExamples(bound, policy)[0]
    const identity = minted(example.itemReference, `FORM-${profile.slice(3, 6).toUpperCase()}-1`)
    const { product } = buildDocument(form, parseDocument(form, example.product).state, identity, contextsFor(form))
    const outcome = await platform.writer.issue({ brandId, brand: platform.parties.brand(brandId), passportId: identity.passportId, profile, product })
    expect(outcome.entry.index).toBe('admitted')

    const access = platform.profiles.describe(bound).access
    const preview = splitPreview(product, access)
    const written = JSON.parse(outcome.state.payloadPublic) as { product: Json }
    // What the page says is public is exactly what went on chain.
    expect(preview.public).toEqual(Object.keys(written.product))
    expect(preview.restricted.length).toBeGreaterThan(0)
    for (const name of preview.restricted) expect(Object.hasOwn(written.product, name)).toBe(false)
    expect(tierOf(access, 'gs1:gtin')).toBe('public')
    expect(tierOf(access, 'a-property:nobody-heard-of')).toBe('restricted')
    expect(tierOf(undefined, 'anything')).toBe('public')
  })

  it('asks the API for code lists the profile\'s vocabulary has', async () => {
    const lists = await platform.profiles.codeLists(platform.profiles.get(profile)!, codeClasses(formFor(profile)))
    for (const [name, codes] of Object.entries(lists)) expect(codes.length, name).toBeGreaterThan(0)
  })
})

describe('a loaded document', () => {
  it('loses nothing: what the form cannot hold exactly is kept as it came', () => {
    const form = formFor('eu-battery@1')
    const example = sectorExamples(platform.profiles.get('eu-battery@1')!, policy)[0]
    const loaded = stripComments({
      _comment_architecture: ['a note'],
      ...example.product,
      'schema:serialNumber': example.serial,
      // A number where the form would write text, a nested member the form has no field for, and a property it has never heard of.
      'gs1:netWeight': { type: 'gs1:QuantitativeValue', 'gs1:value': 132, 'gs1:unitCode': 'KGM' },
      'eubat:hasBatteryChemistry': { type: 'eubat:BatteryChemistry', 'schema:name': 'LFP', _comment: 'nested note', 'eubat:somethingNew': 1 },
      'eubat:hasBatteryState': { ...(example.product['eubat:hasBatteryState'] as Json), 'oea:hasSubAssessment': [{ type: 'oea:TestExecution' }] },
      'gs1:regulatoryInformation': [{ type: 'gs1:RegulatoryInformation', 'gs1:regulatoryAct': 'An act' }],
    }) as Json
    expect(JSON.stringify(loaded)).not.toContain('_comment')
    const parsed = parseDocument(form, loaded)
    expect(parsed.kept.sort()).toEqual(['eubat:hasBatteryChemistry', 'eubat:hasBatteryState', 'gs1:regulatoryInformation'])
    // The number stays a number in its field.
    expect(parsed.state.values['gs1:netWeight']).toEqual({ value: 132, unit: 'KGM' })
    const built = buildDocument(form, parsed.state, minted(example.itemReference, example.serial), contextsFor(form))
    expect(built.problems).toEqual([])
    expect(built.product).toEqual(loaded)
    // Both serial members the document carried are written from the one serial.
    expect(built.product['schema:serialNumber']).toBe(example.serial)
    expect(built.product['gs1:hasSerialNumber']).toBe(example.serial)
  })

  it('keeps a node\'s own identifier and the spelling of a reference, in their fields', () => {
    const form = formFor('eu-battery@1')
    const example = sectorExamples(platform.profiles.get('eu-battery@1')!, policy)[0]
    const loaded: Json = {
      ...example.product,
      // A reference spelled with id, and nodes that carry identifiers of their own: both are as the document wrote them.
      'oec:hasReportingGranularity': { id: 'oec:ItemLevel' },
      'eubat:hasBatteryChemistry': { id: `${example.passportId}#chemistry`, ...(example.product['eubat:hasBatteryChemistry'] as Json) },
      'gs1:manufacturer': { ...(example.product['gs1:manufacturer'] as Json), 'gs1:contactPoint': { type: 'gs1:ContactPoint', 'gs1:email': 'info@harbour-cells.example', 'schema:url': { id: 'https://harbour-cells.example/' } } },
    }
    const parsed = parseDocument(form, loaded)
    expect(parsed.kept).toEqual([])
    expect(parsed.state.values['oec:hasReportingGranularity']).toEqual({ code: 'oec:ItemLevel', spelled: 'id' })
    const built = buildDocument(form, parsed.state, minted(example.itemReference, example.serial), contextsFor(form))
    expect(built.product).toEqual(loaded)
    expect(JSON.stringify(built.product['oec:hasReportingGranularity'])).toBe('{"id":"oec:ItemLevel"}')
    // A document the form builds from typed values never carries an identifier nobody entered.
    const typed = buildDocument(form, { ...emptyState(), values: { 'eubat:hasBatteryChemistry': { 'schema:alternateName': 'LFP' }, 'oec:hasReportingGranularity': 'oec:ItemLevel' } }, minted(example.itemReference, example.serial), contextsFor(form))
    expect(typed.product['eubat:hasBatteryChemistry']).toEqual({ type: 'eubat:BatteryChemistry', 'schema:alternateName': 'LFP' })
    expect(typed.product['oec:hasReportingGranularity']).toEqual({ '@id': 'oec:ItemLevel' })
  })

  it('says so when the JSON area repeats a property a field writes', () => {
    const form = formFor('eu-textile@1')
    const built = buildDocument(form, { ...emptyState(), values: { 'eutex:garmentType': 'Jacket' }, others: { 'eutex:garmentType': 'Coat' } }, minted('100200400', 'DUP-0001'), contextsFor(form))
    expect(built.problems).toEqual([{ pointer: '/~others', message: expect.stringContaining('eutex:garmentType') }])
    expect(built.product['eutex:garmentType']).toBe('Jacket')
  })

  it('does not let the JSON area state a second serial, GTIN or identifier', () => {
    for (const profile of ['eu-battery@1', 'eu-textile@1']) {
      const form = formFor(profile)
      const identity = minted('100200400', 'ONE-SERIAL-1')
      for (const member of ['schema:serialNumber', 'gs1:hasSerialNumber', 'gs1:gtin', 'id', '@id']) {
        const built = buildDocument(form, { ...emptyState(), others: { [member]: 'ANOTHER-ITEM' } }, identity, contextsFor(form))
        expect(built.problems, `${profile} ${member}`).toHaveLength(1)
        expect(JSON.stringify(built.product)).not.toContain('ANOTHER-ITEM')
      }
    }
  })
})

describe('where a finding is shown', () => {
  it('is the field it concerns, by the row the entry was typed in', async () => {
    const form = formFor('eu-battery@1')
    const example = sectorExamples(platform.profiles.get('eu-battery@1')!, policy)[0]
    const state = parseDocument(form, example.product).state
    // An empty row before the materials, so the second written material is the third row of the form.
    state.values['eubat:hasMaterialComposition'] = [{}, ...(state.values['eubat:hasMaterialComposition'] as Array<Record<string, unknown>>)] as FormState['values'][string]
    ;((state.values['eubat:hasMaterialComposition'] as Array<Record<string, unknown>>)[2] as Record<string, unknown>)['schema:name'] = undefined
    // A unit the rules do not allow for this measurement, and a missing required property.
    ;((state.values['eubat:hasTechnicalSpecifications'] as Record<string, unknown>)['eubat:hasRatedCapacity'] as Record<string, unknown>).unit = 'KWH'
    state.values['oec:passportStatus'] = undefined
    state.others = { 'gs1:regulatoryInformation': [{ type: 'gs1:QuantitativeValue', 'gs1:value': '1' }] }
    const identity = minted(example.itemReference, 'FIND-0001')
    const built = buildDocument(form, state, identity, contextsFor(form))
    expect(built.problems).toEqual([])

    let refused: WriteRefused | undefined
    try {
      await platform.writer.issue({ brandId, brand: platform.parties.brand(brandId), passportId: identity.passportId, profile: 'eu-battery@1', product: built.product })
    } catch (cause) {
      refused = cause as WriteRefused
    }
    expect(refused?.code).toBe('product-invalid')
    const findings = (refused!.data!.validation as ViewCheck).findings
    const shownAt = findings.map((finding) => (finding.pointer == null ? undefined : fieldPointerFor(form, state, built.rows, finding.pointer)))
    expect(shownAt).toContain('/eubat:hasMaterialComposition/2/schema:name')
    expect(shownAt).toContain('/eubat:hasTechnicalSpecifications/eubat:hasRatedCapacity')
    expect(shownAt).toContain('/oec:passportStatus')
    expect(shownAt).toContain('/~others')
    // A finding about the document's own identity is shown with the identifier inputs.
    expect(fieldPointerFor(form, state, built.rows, '/gs1:gtin')).toBe('/~identity')
    expect(fieldPointerFor(form, state, built.rows, '/oec:granularityLevel')).toBe('/~identity')
    expect(fieldPointerFor(form, state, built.rows, '/not:there')).toBeUndefined()
  })
})

describe('what a reader is shown', () => {
  it('draws a measurement, text in a language, a code, a list and a nested object as what they are', () => {
    expect(describeValue({ type: 'gs1:QuantitativeValue', 'gs1:value': '98.50', 'gs1:unitCode': 'P1' })).toEqual({ kind: 'quantity', value: '98.50', unitCode: 'P1', unitName: 'per cent' })
    expect(describeValue({ type: 'gs1:QuantitativeValue', 'gs1:value': 132, 'gs1:unitCode': 'XYZ' })).toEqual({ kind: 'quantity', value: '132', unitCode: 'XYZ', unitName: 'XYZ' })
    expect(describeValue({ '@value': 'Laine', '@language': 'fr' })).toEqual({ kind: 'langText', text: 'Laine', language: 'fr' })
    expect(describeValue({ '@value': '88', '@type': 'xsd:decimal' })).toEqual({ kind: 'typed', text: '88', type: 'xsd:decimal' })
    expect(describeValue({ '@id': 'eutex:TumbleDryLow' })).toEqual({ kind: 'reference', id: 'eutex:TumbleDryLow', label: 'Tumble dry low' })
    expect(describeValue('2026-09-18')).toEqual({ kind: 'date', text: '2026-09-18' })
    expect(describeValue('2026-11-02T09:30:00Z')).toEqual({ kind: 'date', text: '2026-11-02T09:30:00Z' })
    expect(describeValue(false)).toEqual({ kind: 'boolean', value: false })
    expect(describeValue([1, 'two'])).toEqual({ kind: 'list', items: [{ kind: 'number', text: '1' }, { kind: 'text', text: 'two' }] })
    const nested = describeValue({ type: 'gs1:Organization', id: 'https://id.example/417/9520000000011', 'gs1:organizationName': 'Harbour Cells', 'x:unknownThing': { deep: [true] } }, new Map([['gs1:organizationName', 'Name']]))
    expect(nested).toEqual({
      kind: 'object',
      type: 'gs1:Organization',
      id: 'https://id.example/417/9520000000011',
      entries: [
        { key: 'gs1:organizationName', label: 'Name', value: { kind: 'text', text: 'Harbour Cells' } },
        { key: 'x:unknownThing', label: 'Unknown thing', value: { kind: 'object', entries: [{ key: 'deep', label: 'Deep', value: { kind: 'list', items: [{ kind: 'boolean', value: true }] } }] } },
      ],
    })
    expect(humaniseName('eubat:hasBatteryState')).toBe('Battery state')
    expect(humaniseName('gs1:TargetConsumerGenderCode-UNISEX')).toBe('Unisex')
  })

  it('lists every top-level property with its tier, including ones the page has no label for', () => {
    const form = formFor('eu-textile@1')
    const shown = describeProduct(
      {
        publicProduct: { '@context': ['x'], id: 'https://passports.example.com/01/09521002004007/21/A1', 'eutex:garmentType': 'Jacket', 'eutex:hasWaterUsage': { type: 'gs1:QuantitativeValue', 'gs1:value': '5', 'gs1:unitCode': 'LTR' }, 'x:brandNew': 1 },
        restrictedProduct: { id: 'https://passports.example.com/01/09521002004007/21/A1', 'eutex:productionWastePercentage': '6.5', 'x:alsoNew': { a: 1 } },
        access: { public: ['@context', 'id', 'eutex:garmentType'] },
      },
      labelsOf(form)
    )
    expect(shown.map((p) => [p.key, p.label, p.tier, p.disclosed ?? false])).toEqual([
      ['@context', 'Contexts', 'public', false],
      ['id', 'Identifier', 'public', false],
      ['eutex:garmentType', 'Garment', 'public', false],
      // In the public payload although the binding does not list it: shown, and flagged.
      ['eutex:hasWaterUsage', 'Water used in production', 'public', true],
      ['x:brandNew', 'Brand new', 'public', true],
      ['eutex:productionWastePercentage', 'Production waste', 'restricted', false],
      ['x:alsoNew', 'Also new', 'restricted', false],
    ])
  })
})
