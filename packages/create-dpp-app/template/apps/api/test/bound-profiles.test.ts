// Passports under the two sector profiles the profiles package ships,
// eu-battery@2 and eu-textile@2, end to end with no wallet, funds or
// network: a complete product document goes in, the writer validates it,
// splits it and signs only the public part, the restricted part is sealed
// as every owner tier is, and the reader checks what it reads against the
// passport that carries it. The documents are the starter's own examples,
// all invented and under the GS1 demonstration prefix.
import http from 'node:http'
import https from 'node:https'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Utils } from '@bsv/sdk'
import { findDppOutputs, verifyOwnerBlob } from '@bsv/dpp-protocol'
import { BUNDLED_BINDINGS, PUBLIC_PAYLOAD_MAX_BYTES, type BindingProfile } from '@bsv/dpp-profiles'
import type { BoundProfiles, ViewCheck } from '../src/bound-profiles.js'
import { loadConfig } from '../src/config.js'
import { mintGtin, mintPassportId } from '../src/identifiers.js'
import type { IndexClient } from '../src/index-client.js'
import type { Party } from '../src/parties.js'
import { openPlatform, type Platform } from '../src/platform.js'
import { readPassport } from '../src/reader.js'
import { DEMONSTRATION_NOTICE, samplePayload } from '../src/profiles.js'
import { sectorExamples } from '../src/sector-examples.js'
import { OWNER_DATA_PROTOCOL, WriteRefused, Writer } from '../src/writer.js'

type Json = Record<string, unknown>

const config = loadConfig({ NETWORK: 'main', PASSPORT_HOST: 'passports.example.com', GS1_PREFIX: '952', LIVE_PUBLISHING: 'false' })
const policy = { host: config.passportHost, prefix: config.gs1Prefix }
const brandId = 'brand-sector-1'
let platform: Platform

beforeAll(async () => {
  platform = await openPlatform({ config, mode: 'test', log: () => {} })
})

afterAll(async () => {
  await platform.close()
})

const bindingOf = (profile: string): BindingProfile => {
  const bound = platform.profiles.get(profile)
  if (bound == null) throw new Error(`${profile} is not registered`)
  return bound
}

/** The starter's example for a sector, as a complete document, under a serial of the test's own so every test writes a fresh passport. */
function exampleFor(profile: string, serial: string): { passportId: string; itemReference: string; product: Json } {
  const example = sectorExamples(bindingOf(profile), policy)[0]
  const passportId = mintPassportId(policy, example.itemReference, serial)
  const product = JSON.parse(JSON.stringify(example.product).replaceAll(example.serial, serial)) as Json
  return { passportId, itemReference: example.itemReference, product }
}

/** A brand party whose wallet counts the signatures it makes, so a test can show a refusal came before any. */
function countingBrand(): { brand: Party; signatures: () => number } {
  const brand = platform.parties.brand(brandId)
  let count = 0
  const sign = brand.wallet.createSignature.bind(brand.wallet)
  brand.wallet.createSignature = (async (...args: Parameters<typeof sign>) => {
    count++
    return await sign(...args)
  }) as typeof brand.wallet.createSignature
  return { brand, signatures: () => count }
}

const refusal = async (work: Promise<unknown>): Promise<WriteRefused> => {
  try {
    await work
  } catch (cause) {
    if (cause instanceof WriteRefused) return cause
    throw cause
  }
  throw new Error('the write was not refused')
}

const nothingWritten = async (passportId: string): Promise<void> => {
  expect(await platform.store.getPassport(passportId)).toBeUndefined()
  expect(await platform.index.lineage(passportId)).toEqual([])
}

describe('managed transfers of a restricted product', () => {
  it('delivers the same product under each successive recipient key and preserves the final ciphertext on retirement', async () => {
    const profile = 'eu-battery@2'
    const { passportId, product } = exampleFor(profile, 'BAT-HANDOVER')
    const brand = platform.parties.brand(brandId)
    const issued = await platform.writer.issue({ brandId, brand, passportId, profile, product })
    let record = issued.record
    let holder = brand
    const hashes = new Set([issued.state.payloadOwnerHash])
    for (let i = 0; i < 2; i++) {
      const { offer, claimCode } = await platform.custody.offer({ record, holder, terms: { word: 'Passed on' } })
      const accepted = await platform.custody.accept({ requestId: offer.requestId, claimCode })
      record = (await platform.store.getPassport(passportId))!
      holder = platform.parties.recipient(offer.requestId)
      const read = await platform.readAuthorised(record, holder)
      expect(read.authorisedView.status).toBe('pass')
      expect(read.ownerTier.status).toBe('pass')
      expect(read.product).toEqual(product)
      const tip = (await platform.index.lineage(passportId)).at(-1)!
      expect(tip.id('hex')).toBe(accepted.transferTxid)
      const state = findDppOutputs(tip)[0].state
      expect(hashes.has(state.payloadOwnerHash)).toBe(false)
      hashes.add(state.payloadOwnerHash)
      expect(state.payloadPublic).toBe(issued.state.payloadPublic)
    }
    const beforeRetirement = record.states.at(-1)!.ownerTier
    const retired = await platform.writer.retire({ record, actor: holder, reason: 'End of the demonstration' })
    expect(retired.entry.ownerTier).toEqual(beforeRetirement)
    expect((await platform.readAuthorised(retired.record, holder)).product).toEqual(product)
  })
})

describe('start-up', () => {
  it('registers the two bundled sector bindings under the shipped trust list, with the engine built once', () => {
    expect(platform.profiles.engineProblem).toBeUndefined()
    expect(platform.profiles.refusals).toEqual([])
    expect(platform.profiles.list().map((p) => [p.profile, p.bindingDigest])).toEqual(BUNDLED_BINDINGS.map((b) => [b.profile, b.bindingDigest]))
    expect(platform.profiles.engines.jsonLd).toBeDefined()
    expect(platform.profiles.engines.shacl?.capabilities).toContain('shacl-sparql-constraints')
  })

  it.each([
    ['eu-battery@2', 'eubat:hasBatteryState'],
    ['eu-textile@2', 'eutex:hasWaterUsage'],
  ])('uses the current %s by default and separates public and authorised readings', async (profile, restricted) => {
    const selected = await openPlatform({
      config: loadConfig({ LIVE_PUBLISHING: 'false', GS1_PREFIX: '952', PASSPORT_HOST: policy.host }),
      mode: 'test', log: () => {},
    })
    try {
      expect(selected.profiles.list().map(entry => entry.profile).sort()).toEqual(BUNDLED_BINDINGS.map(entry => entry.profile).sort())
      const bound = selected.profiles.get(profile)!
      const example = sectorExamples(bound, policy)[0]!
      expect(example.product).toHaveProperty(restricted)
      const brand = selected.parties.brand(brandId)
      await selected.writer.issue({ brandId, brand, passportId: example.passportId, profile, product: example.product })
      const record = (await selected.store.getPassport(example.passportId))!
      const reading = await selected.read(example.passportId)
      expect(reading.product?.profile).toBe(profile)
      expect(reading.payloadChecks[0].publicView.status).toBe('pass')
      expect(JSON.stringify(reading)).not.toContain(restricted)
      const ownerReading = await selected.readAuthorised(record, brand)
      expect(ownerReading.authorisedView.status).toBe('pass')
      expect(ownerReading.restrictedProduct?.[restricted]).toEqual(example.product[restricted])
    } finally {
      await selected.close()
    }
  })

  it('validates without touching the network', async () => {
    const spies = [vi.spyOn(globalThis, 'fetch'), vi.spyOn(http, 'request'), vi.spyOn(http, 'get'), vi.spyOn(https, 'request'), vi.spyOn(https, 'get')]
    try {
      for (const profile of ['eu-battery@2', 'eu-textile@2']) {
        const { passportId, product } = exampleFor(profile, 'NO-NETWORK-1')
        const bound = bindingOf(profile)
        const prepared = await platform.profiles.prepare({ profile: bound, product, passportId })
        if (!prepared.ok) throw new Error(prepared.detail)
        expect((await platform.profiles.validatePublic({ profile: bound.id, profileVersion: bound.version, payloadPublic: prepared.payloadPublic, passportId })).status).toBe('pass')
        expect((await platform.profiles.validateAuthorised({ profile: bound.id, profileVersion: bound.version, payloadPublic: prepared.payloadPublic, passportId, restrictedProduct: prepared.restrictedProduct })).status).toBe('pass')
      }
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})

describe.each([
  { profile: 'eu-battery@2', serial: 'BAT-RT-0001', restricted: 'eubat:hasBatteryState', open: 'eubat:batteryModelIdentifier', nested: (product: Json) => ((product['eubat:hasBatteryState'] as Json)['oea:hasResult'] as Json[])[0]['oea:hasMeasuredValue'], expected: { type: 'gs1:QuantitativeValue', 'gs1:value': '98.50', 'gs1:unitCode': 'P1' } },
  { profile: 'eu-textile@2', serial: 'TEX-RT-0001', restricted: 'eutex:hasWaterUsage', open: 'gs1:textileMaterial', nested: (product: Json) => (product['gs1:textileMaterial'] as Json[])[0]['gs1:textileMaterialPercentage'], expected: { '@value': '88', '@type': 'xsd:decimal' } },
])('a $profile passport, written and read back', ({ profile, serial, restricted, open, nested, expected }) => {
  let passportId: string
  let product: Json

  it('signs exactly the public payload prepareBoundPayload returned, and seals the restricted part as an owner tier', async () => {
    ;({ passportId, product } = exampleFor(profile, serial))
    const bound = bindingOf(profile)
    const brand = platform.parties.brand(brandId)
    const outcome = await platform.writer.issue({ brandId, brand, passportId, profile, product })
    expect(outcome.entry.index).toBe('admitted')
    expect(outcome.record.profile).toBe(profile)

    // The same document prepared again gives the same text: that text, byte for byte, is what was signed and journalled.
    const prepared = await platform.profiles.prepare({ profile: bound, product, passportId, notice: DEMONSTRATION_NOTICE })
    if (!prepared.ok) throw new Error(prepared.detail)
    expect(outcome.state.payloadPublic).toBe(prepared.payloadPublic)
    expect(outcome.entry.payloadPublic).toBe(prepared.payloadPublic)
    const onChain = findDppOutputs((await platform.index.lineage(passportId)).at(-1)!)[0].state
    expect(onChain.payloadPublic).toBe(prepared.payloadPublic)
    expect(onChain.passportId).toBe(passportId)

    // The public payload carries the envelope and public properties only.
    const envelope = JSON.parse(onChain.payloadPublic) as { notice: string; profile: string; profile_version: number; profile_binding_sha256: string; product: Json }
    expect(Object.keys(envelope)).toEqual(['notice', 'profile', 'profile_version', 'profile_binding_sha256', 'product'])
    expect(envelope.profile_binding_sha256).toBe(bound.bindingDigest)
    expect(Object.hasOwn(envelope.product, open)).toBe(true)
    expect(Object.hasOwn(envelope.product, restricted)).toBe(false)
    for (const name of Object.keys(envelope.product)) expect(bound.binding.access?.public).toContain(name)

    // The restricted part went through the owner-tier seal: field 11 is the hash of the stored ciphertext, and the brand's own key opens it.
    const tier = outcome.entry.ownerTier!
    const ciphertext = Utils.toArray(tier.ciphertext, 'base64') as number[]
    expect(tier.hash).toBe(onChain.payloadOwnerHash)
    expect(verifyOwnerBlob(ciphertext, onChain.payloadOwnerHash)).toBe(true)
    const { plaintext } = await brand.wallet.decrypt({ ciphertext, protocolID: OWNER_DATA_PROTOCOL, keyID: passportId, counterparty: 'self' })
    const sealed = JSON.parse(Utils.toUTF8(plaintext)) as Json
    expect(sealed).toEqual(prepared.restrictedProduct)
    expect(Object.hasOwn(sealed, restricted)).toBe(true)
  })

  it('reads back with the public view checked for the state, inside the report', async () => {
    const reading = await platform.read(passportId)
    expect(reading.checks.find((c) => c.name === 'schema')?.status).toBe('pass')
    expect(reading.payloadChecks).toHaveLength(1)
    const view = reading.payloadChecks[0].publicView
    expect(view).toMatchObject({ view: 'public', status: 'pass' })
    expect(view.steps.map((s) => [s.step, s.status])).toEqual([
      ['envelope', 'pass'],
      ['binding', 'pass'],
      ['access', 'pass'],
      ['json-ld-expand', 'pass'],
      ['shacl', 'pass'],
      ['passport-identity', 'pass'],
    ])
    // A public pass is worded as one, and never as a statement about the restricted part.
    expect(view.summary).toMatch(/says nothing about restricted data/)
    expect(reading.product?.profile).toBe(profile)
    expect(Object.hasOwn(reading.product!.publicProduct, restricted)).toBe(false)
    expect(reading.product?.access?.public).toContain(open)
    expect(JSON.stringify(reading)).not.toContain(restricted)
  })

  it('gives the holder the authorised view, after the protocol\'s owner-tier check, with every nested value exactly as written', async () => {
    const record = (await platform.store.getPassport(passportId))!
    const authorised = await platform.readAuthorised(record, platform.parties.brand(brandId))
    expect(authorised.ownerTier.status).toBe('pass')
    expect(authorised.ownerTier.detail).toMatch(/payload_owner_hash/)
    expect(authorised.authorisedView).toMatchObject({ view: 'authorised', status: 'pass' })
    expect(authorised.authorisedView.steps.map((s) => s.step)).toContain('assembly')
    expect(authorised.authorisedView.summary).toMatch(/not a statement about the on-chain commitment/)
    // The round trip: the two parts rejoined are the document that went in, value for value.
    expect(authorised.product).toEqual(product)
    expect(nested(authorised.product!)).toEqual(expected)
    expect(JSON.stringify(nested(authorised.product!))).toBe(JSON.stringify(expected))
  })

  it('does not open a restricted part that is not the one the state commits to', async () => {
    const record = (await platform.store.getPassport(passportId))!
    const swapped = structuredClone(record)
    const bytes = Utils.toArray(swapped.states[0].ownerTier!.ciphertext, 'base64') as number[]
    bytes[bytes.length - 1] ^= 1
    swapped.states[0].ownerTier!.ciphertext = Utils.toBase64(bytes)
    const authorised = await platform.readAuthorised(swapped, platform.parties.brand(brandId))
    expect(authorised.ownerTier.status).toBe('fail')
    expect(authorised.authorisedView.status).toBe('not-checked')
    expect(authorised.restrictedProduct).toBeUndefined()
    expect(authorised.product).toBeUndefined()
  })

  it('never reports a valid, identity-matching part as matching payload_owner_hash when the journal holds no restricted part for the newest state', async () => {
    const record = (await platform.store.getPassport(passportId))!
    const newest = record.states.at(-1)!
    // What any reader holds is a valid document about this item: the public view passes, the identity rule included.
    const view = (await platform.read(passportId)).payloadChecks.at(-1)!.publicView
    expect(view.status).toBe('pass')
    expect(view.steps.find((s) => s.step === 'passport-identity')?.status).toBe('pass')
    // The same journal entry without its sealed restricted part: nothing to compare with the state's payload_owner_hash.
    const withoutEvidence = structuredClone(record)
    delete withoutEvidence.states.at(-1)!.ownerTier
    const authorised = await platform.readAuthorised(withoutEvidence, platform.parties.brand(brandId))
    expect(authorised.ownerTier).toEqual({ status: 'not-checked', txid: newest.txid, detail: "This platform's journal holds no restricted part for the newest state the index returned." })
    expect(authorised.authorisedView).toMatchObject({ view: 'authorised', status: 'not-checked', steps: [], findings: [] })
    expect(authorised.authorisedView.summary).toMatch(/A check that could not run is not a pass\.$/)
    expect(authorised.restrictedProduct).toBeUndefined()
    expect(authorised.product).toBeUndefined()
    // No sentence of the answer says a stored part hashes to the commitment, and the passing public view is not carried into it.
    expect(JSON.stringify(authorised)).not.toMatch(/hashes to the payload_owner_hash/)
    expect(JSON.stringify(authorised)).not.toMatch(/"status":"pass"/)
  })

  it('updates with a new complete document, and both states are checked', async () => {
    const revised = { ...product, 'oec:lastUpdated': '2026-11-03T10:00:00Z' }
    const outcome = await platform.writer.update({ record: (await platform.store.getPassport(passportId))!, actor: platform.parties.brand(brandId), product: revised })
    expect(outcome.entry.op).toBe('UPDATE')
    const reading = await platform.read(passportId)
    expect(reading.payloadChecks.map((c) => c.publicView.status)).toEqual(['pass', 'pass'])
    expect((reading.product!.publicProduct as Json)['oec:lastUpdated']).toBe('2026-11-03T10:00:00Z')
    const authorised = await platform.readAuthorised((await platform.store.getPassport(passportId))!, platform.parties.brand(brandId))
    expect(authorised.product).toEqual(revised)
  })
})

describe('what the writer refuses before anything is signed', () => {
  it('another product\'s valid document under this passport, and this passport\'s document under another identifier', async () => {
    const a = exampleFor('eu-battery@2', 'BAT-A-0001')
    const b = exampleFor('eu-battery@2', 'BAT-B-0001')
    for (const [passportId, product] of [
      [a.passportId, b.product],
      [b.passportId, a.product],
    ] as const) {
      const { brand, signatures } = countingBrand()
      const refused = await refusal(platform.writer.issue({ brandId, brand, passportId, profile: 'eu-battery@2', product }))
      expect(refused.code).toBe('product-invalid')
      expect(refused.data?.cause).toBe('product-identity-mismatch')
      expect(refused.message).toMatch(/different product/)
      expect(refused.message).toMatch(/Nothing was signed/)
      expect(signatures()).toBe(0)
      await nothingWritten(passportId)
    }
    // Each document under its own identifier is written.
    expect((await platform.writer.issue({ brandId, brand: platform.parties.brand(brandId), passportId: a.passportId, profile: 'eu-battery@2', product: a.product })).entry.index).toBe('admitted')
  })

  it('a GTIN or a serial member that disagrees with the document\'s own identifier', async () => {
    for (const [member, value] of [
      ['gs1:gtin', mintGtin('952', '999999999')],
      ['gs1:hasSerialNumber', 'SOME-OTHER-SERIAL'],
    ] as const) {
      const { passportId, product } = exampleFor('eu-battery@2', 'BAT-C-0001')
      const { brand, signatures } = countingBrand()
      const refused = await refusal(platform.writer.issue({ brandId, brand, passportId, profile: 'eu-battery@2', product: { ...product, [member]: value } }))
      expect(refused.code).toBe('product-invalid')
      expect(refused.data?.cause).toBe('product-identity-mismatch')
      expect(signatures()).toBe(0)
      await nothingWritten(passportId)
    }
    const { passportId, product } = exampleFor('eu-textile@2', 'TEX-C-0001')
    const refused = await refusal(platform.writer.issue({ brandId, brand: platform.parties.brand(brandId), passportId, profile: 'eu-textile@2', product: { ...product, 'schema:serialNumber': 'SOME-OTHER-SERIAL' } }))
    expect(refused.data?.cause).toBe('product-identity-mismatch')
    await nothingWritten(passportId)
  })

  it('a document about a model, not an item', async () => {
    for (const profile of ['eu-battery@2', 'eu-textile@2']) {
      const { passportId, product } = exampleFor(profile, 'MODEL-0001')
      const model = { ...product, id: passportId.replace(/\/21\/.*$/, ''), 'oec:granularityLevel': 'model' }
      const { brand, signatures } = countingBrand()
      const refused = await refusal(platform.writer.issue({ brandId, brand, passportId, profile, product: model }))
      expect(refused.code).toBe('product-invalid')
      expect(signatures()).toBe(0)
      await nothingWritten(passportId)
    }
  })

  it('a public payload over the size a state holds, naming the size and the limit', async () => {
    const { passportId, product } = exampleFor('eu-textile@2', 'TEX-BIG-0001')
    const { brand, signatures } = countingBrand()
    const large = { ...product, 'gs1:productDescription': [{ '@value': 'x'.repeat(PUBLIC_PAYLOAD_MAX_BYTES), '@language': 'en' }] }
    const refused = await refusal(platform.writer.issue({ brandId, brand, passportId, profile: 'eu-textile@2', product: large }))
    expect(refused.code).toBe('public-payload-too-large')
    expect(refused.data?.limit).toBe(PUBLIC_PAYLOAD_MAX_BYTES)
    expect(refused.data?.byteLength as number).toBeGreaterThan(PUBLIC_PAYLOAD_MAX_BYTES)
    expect(refused.message).toMatch(/65535/)
    expect(refused.message).toMatch(/restricted part does not count/)
    expect(signatures()).toBe(0)
    await nothingWritten(passportId)
    // The same text in a restricted property is not counted, and the document is written.
    const elsewhere = { ...product, 'eutex:hasSubstancesOfConcern': [{ ...(product['eutex:hasSubstancesOfConcern'] as Json[])[0], 'eutex:safeUseInstructions': 'x'.repeat(PUBLIC_PAYLOAD_MAX_BYTES) }] }
    expect((await platform.writer.issue({ brandId, brand: platform.parties.brand(brandId), passportId, profile: 'eu-textile@2', product: elsewhere })).entry.index).toBe('admitted')
  })

  it('a document that breaks a rule, with each finding placed at the property it concerns', async () => {
    const { passportId, product } = exampleFor('eu-battery@2', 'BAT-D-0001')
    const broken = structuredClone(product)
    delete (broken['gs1:netWeight'] as Json)['gs1:unitCode']
    delete broken['oec:passportStatus']
    ;((broken['eubat:hasMaterialComposition'] as Json[])[1] as Json)['schema:name'] = undefined
    const { brand, signatures } = countingBrand()
    const refused = await refusal(platform.writer.issue({ brandId, brand, passportId, profile: 'eu-battery@2', product: JSON.parse(JSON.stringify(broken)) as Json }))
    expect(refused.code).toBe('product-invalid')
    expect(refused.data?.cause).toBe('profile-rule-violation')
    const validation = refused.data?.validation as ViewCheck
    expect(validation).toMatchObject({ view: 'whole', status: 'fail' })
    const pointers = validation.findings.map((f) => f.pointer)
    expect(pointers).toContain('/gs1:netWeight/gs1:unitCode')
    expect(pointers).toContain('/oec:passportStatus')
    expect(pointers).toContain('/eubat:hasMaterialComposition/1/schema:name')
    expect(signatures()).toBe(0)
    await nothingWritten(passportId)
  })

  it('a payload and owner fields for a bound profile, and a product document for a manifest profile', async () => {
    const { passportId, product } = exampleFor('eu-battery@2', 'BAT-E-0001')
    const brand = platform.parties.brand(brandId)
    expect((await refusal(platform.writer.issue({ brandId, brand, passportId, profile: 'eu-battery@2', payload: product, ownerFields: {} }))).code).toBe('product-required')
    expect((await refusal(platform.writer.issue({ brandId, brand, passportId, profile: 'general@2', product }))).code).toBe('payload-required')
    expect((await refusal(platform.writer.issue({ brandId, brand, passportId, profile: 'eu-battery@7', product }))).code).toBe('profile-unknown')
    await nothingWritten(passportId)
  })
})

describe('the identifier that is validated is the identifier that is signed', () => {
  /** A writer whose preparation was tampered with: it validates the document against another identifier than the state's. */
  const tampered = (overrides: Partial<BoundProfiles>): Writer =>
    new Writer({ store: platform.store, wallet: platform.wallet, index: platform.index, identifiers: policy, bound: { ...platform.profiles, ...overrides }, livePublishing: false, spendCapSatoshis: 20_000 })

  it('refuses a state whose public payload was validated for another passport, on the bytes about to be sent', async () => {
    const mine = exampleFor('eu-battery@2', 'BAT-F-0001')
    const other = exampleFor('eu-battery@2', 'BAT-G-0001')
    // The document is the other item's, and so is the identifier the tampered preparation validates it against. Only the state's own identifier is this passport's.
    const writer = tampered({ prepare: (input) => platform.profiles.prepare({ ...input, passportId: other.passportId }) })
    const refused = await refusal(writer.issue({ brandId, brand: platform.parties.brand(brandId), passportId: mine.passportId, profile: 'eu-battery@2', product: other.product }))
    expect(refused.code).toBe('own-check-refused')
    expect(refused.message).toMatch(/product-identity-mismatch/)
    await nothingWritten(mine.passportId)
  })

  it('fails at read when such a state reaches an index all the same', async () => {
    const mine = exampleFor('eu-textile@2', 'TEX-F-0001')
    const other = exampleFor('eu-textile@2', 'TEX-G-0001')
    // A writer with both of its checks removed, standing in for someone else's faulty writer.
    const writer = tampered({ prepare: (input) => platform.profiles.prepare({ ...input, passportId: other.passportId }), validatePublic: async () => ({ status: 'pass' }) })
    await writer.issue({ brandId, brand: platform.parties.brand(brandId), passportId: mine.passportId, profile: 'eu-textile@2', product: other.product })
    const reading = await platform.read(mine.passportId)
    expect(reading.checks.find((c) => c.name === 'schema')).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid' })
    expect(reading.payloadChecks[0].publicView).toMatchObject({ status: 'fail', cause: 'product-identity-mismatch' })
    expect(reading.payloadChecks[0].publicView.steps.at(-1)).toMatchObject({ step: 'passport-identity', status: 'fail' })
  })

  it('checks a state against the identifier that state carries, not the one the reader was asked about', async () => {
    const asked = exampleFor('eu-battery@2', 'BAT-ASKED-0001')
    const carried = exampleFor('eu-battery@2', 'BAT-CARRIED-0001')
    await platform.writer.issue({ brandId, brand: platform.parties.brand(brandId), passportId: carried.passportId, profile: 'eu-battery@2', product: carried.product })
    // An index that answers a question about one passport with the lineage of another, as a faulty or hostile one might.
    const index = { publisherKeys: () => platform.index.publisherKeys(), lineage: (id: string) => platform.index.lineage(id === asked.passportId ? carried.passportId : id) } as unknown as IndexClient
    const reading = await readPassport(asked.passportId, { index, chainTracker: 'scripts only', profiles: platform.profiles })
    // The document is the carried passport's, and so is the identifier its state carries: checked against that, it matches.
    const view = reading.payloadChecks[0].publicView
    expect(view.steps.find((s) => s.step === 'passport-identity')).toMatchObject({ status: 'pass' })
    expect(view.status).toBe('pass')
    // Checked against the identifier asked about, the same payload fails the identity rule. So the pass above came from the state's identifier.
    const bound = bindingOf('eu-battery@2')
    const state = findDppOutputs((await platform.index.lineage(carried.passportId))[0])[0].state
    expect(state.passportId).toBe(carried.passportId)
    expect(await platform.profiles.validatePublic({ profile: bound.id, profileVersion: bound.version, payloadPublic: state.payloadPublic, passportId: asked.passportId })).toMatchObject({ status: 'fail', detail: { cause: 'product-identity-mismatch' } })
    // That the lineage is about another passport is the report's own finding, on a check of its own, and not the profile's.
    expect(reading.checks.find((c) => c.name === 'subjectBinding')?.status).toBe('fail')
  })

  it('fails at read when the payload declares another binding digest', async () => {
    const { passportId, product } = exampleFor('eu-battery@2', 'BAT-H-0001')
    const substituted = 'ab'.repeat(32)
    const writer = tampered({
      prepare: async (input) => {
        const prepared = await platform.profiles.prepare(input)
        return prepared.ok ? { ...prepared, payloadPublic: prepared.payloadPublic.replace(bindingOf('eu-battery@2').bindingDigest, substituted) } : prepared
      },
      validatePublic: async () => ({ status: 'pass' }),
    })
    await writer.issue({ brandId, brand: platform.parties.brand(brandId), passportId, profile: 'eu-battery@2', product })
    const reading = await platform.read(passportId)
    expect(reading.checks.find((c) => c.name === 'schema')?.status).toBe('fail')
    expect(reading.payloadChecks[0].publicView).toMatchObject({ status: 'fail', cause: 'profile-binding-mismatch' })
    // Nothing after the binding step ran: the payload was written to other rules.
    expect(reading.payloadChecks[0].publicView.steps.map((s) => s.step)).toEqual(['envelope', 'binding'])
  })
})

describe('after a hand-on', () => {
  it('opens the transferred textile tier for the recipient and reports an unavailable view under an unrelated key', async () => {
    const { passportId, product } = exampleFor('eu-textile@2', 'TEX-H-0001')
    const brand = platform.parties.brand(brandId)
    await platform.writer.issue({ brandId, brand, passportId, profile: 'eu-textile@2', product })
    const { offer, claimCode } = await platform.custody.offer({ record: (await platform.store.getPassport(passportId))!, holder: brand, terms: { word: 'Sold' } })
    await platform.custody.accept({ requestId: offer.requestId, claimCode })
    const record = (await platform.store.getPassport(passportId))!
    const recipient = platform.custody.holderOf(record)
    const authorised = await platform.readAuthorised(record, recipient)
    expect(authorised.authorisedView.status).toBe('pass')
    expect(authorised.product).toEqual(product)
    const other = await platform.readAuthorised(record, platform.parties.member('other-reader'))
    expect(other.ownerTier.status).toBe('pass')
    expect(other.authorisedView.status).toBe('not-checked')
    expect(other.product).toBeUndefined()
    expect(other.restrictedProduct).toBeUndefined()
    // The public view is unchanged by the hand-on.
    const reading = await platform.read(passportId)
    expect(reading.payloadChecks.map((c) => c.publicView.status)).toEqual(['pass', 'pass'])
    // A later update seals the new version to the current holder.
    await platform.writer.update({ record, actor: recipient, product })
    const again = await platform.readAuthorised((await platform.store.getPassport(passportId))!, recipient)
    expect(again.authorisedView.status).toBe('pass')
    expect(again.product).toEqual(product)
  })
})

describe('without the validation engine', () => {
  let bare: Platform

  beforeAll(async () => {
    // What a project sees when jsonld, n3 and shacl-engine are not installed.
    bare = await openPlatform({
      config,
      mode: 'test',
      log: () => {},
      loadEngineLibrary: async (name) => {
        throw new Error(`Cannot find package '${name}'`)
      },
    })
  })

  afterAll(async () => {
    await bare.close()
  })

  it('still starts, says what to install, and keeps the manifest profiles working', async () => {
    expect(bare.profiles.engineProblem).toMatch(/jsonld@9\.0\.0 n3@2\.13\.12 shacl-engine@1\.1\.3/)
    expect(bare.profiles.list().map((p) => p.profile).sort()).toEqual(BUNDLED_BINDINGS.map(entry => entry.profile).sort())
    const passportId = mintPassportId(policy, '100000077', 'GEN-NOENGINE-1')
    const outcome = await bare.writer.issue({ brandId, brand: bare.parties.brand(brandId), passportId, profile: 'general@2', payload: samplePayload('general@2', true), ownerFields: {} })
    expect(outcome.entry.index).toBe('admitted')
    // A manifest profile's payload is checked against its schema, and its answer says that and no more.
    const view = (await bare.read(passportId)).payloadChecks[0].publicView
    expect(view.status).toBe('pass')
    expect(view.summary).toMatch(/fits the public schema/)
    expect(view.summary).not.toMatch(/passport's item/)
  })

  it('refuses to write a bound profile, before anything is signed', async () => {
    const { passportId, product } = exampleFor('eu-battery@2', 'BAT-NOENGINE-1')
    const brand = bare.parties.brand(brandId)
    let signatures = 0
    const sign = brand.wallet.createSignature.bind(brand.wallet)
    brand.wallet.createSignature = (async (...args: Parameters<typeof sign>) => {
      signatures++
      return await sign(...args)
    }) as typeof brand.wallet.createSignature
    const refused = await refusal(bare.writer.issue({ brandId, brand, passportId, profile: 'eu-battery@2', product }))
    expect(refused.code).toBe('product-not-validated')
    expect(refused.message).toMatch(/Install jsonld@9\.0\.0 n3@2\.13\.12 shacl-engine@1\.1\.3/)
    expect(signatures).toBe(0)
    expect(await bare.store.getPassport(passportId)).toBeUndefined()
  })

  it('reads a bound passport as not checked, never as passed', async () => {
    const { passportId, product } = exampleFor('eu-battery@2', 'BAT-NOENGINE-2')
    await platform.writer.issue({ brandId, brand: platform.parties.brand(brandId), passportId, profile: 'eu-battery@2', product })
    const reading = await readPassport(passportId, { index: platform.index, chainTracker: 'scripts only', profiles: bare.profiles })
    expect(reading.checks.find((c) => c.name === 'schema')).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable' })
    const view = reading.payloadChecks[0].publicView
    expect(view).toMatchObject({ status: 'not-checked', cause: 'validator-unavailable' })
    expect(view.summary).toMatch(/not a pass/)
    expect(view.steps.find((s) => s.step === 'shacl')?.status).toBe('not-checked')
    // Reading every semantic identity assertion requires the selected contexts to be expanded.
    expect(view.steps.find((s) => s.step === 'passport-identity')?.status).toBe('not-checked')
  })
})
