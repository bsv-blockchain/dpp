// The HTTP surface for profiles held by a binding, and the one promise it
// has to keep above all: a restricted value of a product document reaches
// the holder who may open it and nobody else. One test issues passports
// carrying a value that appears nowhere else, then searches everything this
// application prints, lists, indexes and exports for it, the EPCIS exchange
// included. The last does the same for the credential of an EPCIS source.
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { format } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ViewCheck } from '../src/bound-profiles.js'
import { EPCIS_RECORD_KINDS } from '@bsv/dpp-credentials/epcis-exchange'
import { loadConfig } from '../src/config.js'
import { startEpcisExchange, type EpcisExchange } from '../src/epcis/exchange.js'
import { openPlatform, type Platform } from '../src/platform.js'
import type { AuthorisedReading, PassportReading } from '../src/reader.js'
import { createServer } from '../src/server.js'
import { epcisDocument, gs1Dir, item, objectEvent, startEpcisSource, type FixtureSource } from './epcis-fixtures.js'

type Json = Record<string, unknown>

/** The credential of the EPCIS source below. It is in no fixture and no key: wherever it turns up, it was copied there. */
const credential = 'EPCIS-CREDENTIAL-CANARY-4D1E88F0'

const config = loadConfig({ NETWORK: 'main', PASSPORT_HOST: 'passports.example.com', GS1_PREFIX: '952', LIVE_PUBLISHING: 'false' })
const brandId = 'dev-brand'
const printed: string[] = []
let platform: Platform
let exchange: EpcisExchange
let epcisSource: FixtureSource
let echoingSource: FixtureSource
let server: Server
let base: string
const spies: Array<{ mockRestore: () => void }> = []

beforeAll(async () => {
  // Everything the process prints is kept: the platform's own log, the console and the two streams under it.
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) spies.push(vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void printed.push(format(...args))))
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream)
    spies.push(
      vi.spyOn(stream, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
        printed.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8'))
        return (write as (...args: unknown[]) => boolean)(chunk, ...rest)
      }) as typeof stream.write)
    )
  }
  platform = await openPlatform({ config, mode: 'test', log: (line) => printed.push(line) })
  const party = platform.parties.brand(brandId)
  await platform.store.saveBrand({ id: brandId, name: 'Development brand', identityKey: party.identityKey, did: party.did, createdAt: new Date().toISOString() })
  // Two EPCIS sources on this machine. One wants the credential. The other answers with whatever credential it was sent, as a careless source might.
  epcisSource = await startEpcisSource(Array.from({ length: 5 }, (_, index) => objectEvent(index + 1, [item(`LEAK-${index + 1}`)])), { requireAuthorization: `Bearer ${credential}` })
  echoingSource = await startEpcisSource([], { answer: { status: 200, mediaType: 'application/ld+json', body: JSON.stringify({ type: 'EPCISQueryDocument', note: `you sent ${credential}` }) } })
  const sources = loadConfig({
    DPP_GS1_ARTEFACTS_DIR: gs1Dir(),
    DPP_GS1_ARTEFACTS_OFFLINE: 'true',
    EPCIS_SOURCES: 'supplier-a,echo,stranger',
    EPCIS_SOURCE_SUPPLIER_A_URL: epcisSource.baseUrl,
    EPCIS_SOURCE_SUPPLIER_A_LOCAL_TEST: 'true',
    EPCIS_SOURCE_SUPPLIER_A_BEARER_TOKEN: credential,
    EPCIS_SOURCE_ECHO_URL: echoingSource.baseUrl,
    EPCIS_SOURCE_ECHO_LOCAL_TEST: 'true',
    EPCIS_SOURCE_ECHO_HEADER_NAME: 'X-Api-Key',
    EPCIS_SOURCE_ECHO_HEADER_VALUE: credential,
    // The same source again, under a credential it does not accept.
    EPCIS_SOURCE_STRANGER_URL: epcisSource.baseUrl,
    EPCIS_SOURCE_STRANGER_LOCAL_TEST: 'true',
    EPCIS_SOURCE_STRANGER_BASIC_USER: 'operator',
    EPCIS_SOURCE_STRANGER_BASIC_PASSWORD: credential,
  }).epcis
  exchange = await startEpcisExchange({ config: sources, log: (line) => printed.push(line) })
  const app = createServer({ platform, exchange, devSession: { userId: 'developer', email: 'developer@localhost', name: 'Developer', brandIds: [brandId] } })
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  server.closeAllConnections()
  server.close()
  await exchange.close()
  await epcisSource.close()
  await echoingSource.close()
  await platform.close()
  for (const spy of spies) spy.mockRestore()
})

const get = async (path: string): Promise<{ status: number; text: string; body: any }> => {
  const response = await fetch(`${base}${path}`)
  const text = await response.text()
  return { status: response.status, text, body: text === '' ? undefined : JSON.parse(text) }
}
const post = async (path: string, body: unknown, raw?: string): Promise<{ status: number; text: string; body: any }> => {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) })
  const text = await response.text()
  return { status: response.status, text, body: text === '' ? undefined : JSON.parse(text) }
}
const ref = (passportId: string): string => encodeURIComponent(passportId)
/** A body sent as the bytes given, which is how an EPCIS document is uploaded. */
const upload = async (path: string, text: string, mediaType = 'application/ld+json'): Promise<{ status: number; text: string; body: any }> => {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': mediaType }, body: text })
  const answer = await response.text()
  let body: unknown
  try {
    body = answer === '' ? undefined : JSON.parse(answer)
  } catch {
    body = undefined
  }
  return { status: response.status, text: answer, body }
}
/** Everything the EPCIS store holds, as text: every record of every kind, and the retained bytes of every import. */
async function epcisStore(): Promise<string> {
  const out: string[] = []
  for (const kind of Object.values(EPCIS_RECORD_KINDS)) for (const held of await exchange.storage.list(kind, { limit: 100_000 })) out.push(JSON.stringify(held))
  for (const record of await exchange.listImports({ limit: 200 })) out.push(Buffer.from((await exchange.storage.getBytes(record.sha256))!).toString('latin1'))
  return out.join('\n')
}

/** The profile's example as the API serves it, under a serial of the test's own. */
async function exampleFor(profile: string, serial: string): Promise<{ itemReference: string; serial: string; passportId: string; product: Json }> {
  const { body } = await get(`/api/profiles/${encodeURIComponent(profile)}`)
  const example = body.examples[0] as { itemReference: string; serial: string; passportId: string; product: Json }
  const swap = (value: string): string => value.replaceAll(example.serial, serial)
  return { itemReference: example.itemReference, serial, passportId: swap(example.passportId), product: JSON.parse(swap(JSON.stringify(example.product))) as Json }
}

describe('profiles over HTTP', () => {
  it('lists the manifest profiles and the bound profiles, each with its format', async () => {
    const { body } = await get('/api/profiles')
    const formats = Object.fromEntries((body as Array<{ id: string; format: string }>).map((p) => [p.id, p.format]))
    // The retired sector profiles are not among them: the bound profiles replace them.
    expect(formats).toEqual({ 'general@2': 'manifest', 'eu-battery@1': 'binding', 'eu-textile@1': 'binding' })
    expect((await get('/api/health')).body.validationEngine).toBe(true)
  })

  it('describes a bound profile: its split, its contexts and an example for this deployment', async () => {
    const { body } = await get('/api/profiles/eu-battery%401')
    expect(body).toMatchObject({ id: 'eu-battery@1', format: 'binding', engine: { available: true }, demonstration: true })
    expect(body.access.public).toContain('gs1:gtin')
    expect(body.access.public).not.toContain('eubat:hasBatteryState')
    expect(body.contexts.map((c: { path: string }) => c.path)).toContain('battery-context.jsonld')
    expect(body.prefixes.gs1).toBe('https://ref.gs1.org/voc/')
    const example = body.examples[0]
    expect(example.passportId).toMatch(/^https:\/\/passports\.example\.com\/01\/0952\d{10}\/21\//)
    expect(example.product.id).toBe(example.passportId)
    expect(example.product['@context']).toEqual(body.contexts.filter((c: { path: string }) => ['dpp-core-context.jsonld', 'battery-context.jsonld'].includes(c.path)).map((c: { uri: string }) => c.uri))
    // A manifest profile is described as before.
    const general = (await get('/api/profiles/general%402')).body
    expect(general.format).toBe('manifest')
    expect(general.fields.length).toBeGreaterThan(0)
  })

  it('serves the code lists the profile\'s own vocabulary defines', async () => {
    const { body } = await get('/api/profiles/eu-textile%401/codes?class=eutex:CareSymbolCode&class=eutex:FabricType&class=nothing:Here')
    expect(body['eutex:CareSymbolCode'].map((c: { value: string }) => c.value)).toContain('eutex:Wash30')
    expect(body['eutex:CareSymbolCode'].find((c: { value: string }) => c.value === 'eutex:Wash30').label).not.toBe('')
    expect(body['eutex:FabricType'].map((c: { value: string }) => c.value).sort()).toEqual(['eutex:Denim', 'eutex:Knitted', 'eutex:WovenNonDenim'])
    expect(body['nothing:Here']).toEqual([])
    const battery = (await get('/api/profiles/eu-battery%401/codes?class=oec:OperatorRole&class=eubat:BatteryCategory')).body
    expect(battery['oec:OperatorRole']).toHaveLength(11)
    expect(battery['eubat:BatteryCategory'].map((c: { value: string }) => c.value)).toContain('eubat:IndustrialBattery')
  })

  it('issues from a product document, and refuses one whose serial is not the passport\'s', async () => {
    const example = await exampleFor('eu-battery@1', 'HTTP-BAT-0001')
    const wrong = await post(`/api/brands/${brandId}/passports`, { profile: 'eu-battery@1', itemReference: example.itemReference, serial: 'HTTP-BAT-0002', product: example.product })
    expect(wrong.status).toBe(409)
    expect(wrong.body).toMatchObject({ error: 'product-invalid', cause: 'product-identity-mismatch' })
    expect((wrong.body.validation as ViewCheck).steps.at(-1)).toMatchObject({ step: 'passport-identity', status: 'fail' })
    expect((await get(`/api/passports/${ref(example.passportId.replace('0001', '0002'))}`)).status).toBe(404)

    const issued = await post(`/api/brands/${brandId}/passports`, { profile: 'eu-battery@1', itemReference: example.itemReference, serial: example.serial, product: example.product })
    expect(issued.status).toBe(200)
    expect(issued.body).toMatchObject({ passportId: example.passportId, profile: 'eu-battery@1' })
    expect(issued.body.payload.product['eubat:batteryModelIdentifier']).toBe('HC-LFP-48-100')
    expect(issued.body.payload.product['eubat:hasBatteryState']).toBeUndefined()

    const missing = await post(`/api/brands/${brandId}/passports`, { profile: 'eu-battery@1', itemReference: example.itemReference, serial: 'HTTP-BAT-0003', payload: {} })
    expect(missing.body.error).toBe('product-required')
  })

  it('reports the two views apart: the public one to anyone, the authorised one to the holder', async () => {
    const example = await exampleFor('eu-battery@1', 'HTTP-BAT-0001')
    const reading = (await get(`/api/verify?passportId=${ref(example.passportId)}`)).body as PassportReading
    expect(reading.payloadChecks[0].publicView).toMatchObject({ view: 'public', status: 'pass' })
    expect(reading.product?.publicProduct['eubat:hasBatteryState']).toBeUndefined()
    // A public reading carries no authorised view and no restricted part at all.
    expect(reading).not.toHaveProperty('authorisedView')
    expect(reading).not.toHaveProperty('restrictedProduct')

    const authorised = (await post(`/api/passports/${ref(example.passportId)}/authorised-view`, {})).body as AuthorisedReading
    expect(authorised.ownerTier.status).toBe('pass')
    expect(authorised.authorisedView).toMatchObject({ view: 'authorised', status: 'pass' })
    expect(authorised.product).toEqual(example.product)

    // A passport under a manifest profile has no such view, and a passport of another brand is not this session's to open.
    const general = (await get('/api/profiles/general%402')).body.sample as Json
    const other = await post(`/api/brands/${brandId}/passports`, { profile: 'general@2', itemReference: '100000055', serial: 'HTTP-GEN-0001', payload: general, ownerFields: {} })
    expect(other.status).toBe(200)
    expect((await post(`/api/passports/${ref(other.body.passportId)}/authorised-view`, {})).body.error).toBe('profile-not-bound')
    const foreign = await exampleFor('eu-battery@1', 'HTTP-BAT-0009')
    await platform.writer.issue({ brandId: 'someone-else', brand: platform.parties.brand('someone-else'), passportId: foreign.passportId, profile: 'eu-battery@1', product: foreign.product })
    expect((await post(`/api/passports/${ref(foreign.passportId)}/authorised-view`, {})).status).toBe(403)
  })
})

describe('the authorised view, asked by someone it does not belong to', () => {
  let anonymous: Server
  let open: string

  beforeAll(async () => {
    // The same platform behind a server that knows no session: what a request from someone who has not signed in meets.
    anonymous = createServer({ platform }).listen(0, '127.0.0.1')
    await once(anonymous, 'listening')
    open = `http://127.0.0.1:${(anonymous.address() as AddressInfo).port}`
  })

  afterAll(() => {
    anonymous.closeAllConnections()
    anonymous.close()
  })

  const ask = async (passportId: string, body: unknown): Promise<{ status: number; text: string; body: any }> => {
    const response = await fetch(`${open}/api/passports/${ref(passportId)}/authorised-view`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const text = await response.text()
    return { status: response.status, text, body: JSON.parse(text) }
  }

  it('answers 401 to a request with no session while the brand holds the passport, and opens nothing', async () => {
    const example = await exampleFor('eu-battery@1', 'HTTP-ANON-0001')
    expect((await post(`/api/brands/${brandId}/passports`, { profile: 'eu-battery@1', itemReference: example.itemReference, serial: example.serial, product: example.product })).status).toBe(200)
    for (const body of [{}, { claimCode: 'anything' }]) {
      const answer = await ask(example.passportId, body)
      expect(answer.status).toBe(401)
      expect(answer.body).toEqual({ error: 'sign-in-required', description: 'sign in first' })
      expect(answer.text).not.toContain('eubat:hasBatteryState')
    }
    // The control: the same request with the brand's session opens it.
    const member = await post(`/api/passports/${ref(example.passportId)}/authorised-view`, {})
    expect(member.status).toBe(200)
    expect((member.body as AuthorisedReading).authorisedView.status).toBe('pass')
    expect(member.text).toContain('eubat:hasBatteryState')
  })

  it('answers 403 to a request for a handed-on passport without the claim code it was accepted with, or with another one', async () => {
    const example = await exampleFor('eu-textile@1', 'HTTP-RECIPIENT-0001')
    expect((await post(`/api/brands/${brandId}/passports`, { profile: 'eu-textile@1', itemReference: example.itemReference, serial: example.serial, product: example.product })).status).toBe(200)
    const offered = await post(`/api/passports/${ref(example.passportId)}/offer`, { terms: { word: 'Sold' } })
    expect(offered.status).toBe(200)
    const { offer, claimCode } = offered.body as { offer: { requestId: string }; claimCode: string }
    expect((await post(`/api/offers/${encodeURIComponent(offer.requestId)}/accept`, { claimCode })).status).toBe(200)

    for (const body of [{}, { claimCode: 'not-the-claim-code' }, { claimCode: `${claimCode}0` }]) {
      const answer = await ask(example.passportId, body)
      expect(answer.status).toBe(403)
      expect(answer.body).toMatchObject({ error: 'claim-code-required' })
      expect(answer.text).not.toContain('eutex:hasWaterUsage')
    }
    // The brand's session is no longer a way in either: the passport is the recipient's.
    expect((await post(`/api/passports/${ref(example.passportId)}/authorised-view`, {})).status).toBe(403)

    // The control: with the claim code the recipient is answered. The restricted part is still sealed to the brand that wrote it, so the view is not checked.
    const holder = await ask(example.passportId, { claimCode })
    expect(holder.status).toBe(200)
    expect((holder.body as AuthorisedReading).ownerTier.status).toBe('pass')
    expect((holder.body as AuthorisedReading).authorisedView.status).toBe('not-checked')
    expect(holder.text).not.toContain('eutex:hasWaterUsage')
  })
})

describe('a restricted value', () => {
  // A value that is in no fixture, no log line and no key: wherever it turns up, it was copied there.
  const canary = 'RESTRICTED-CANARY-7F3A91C2'

  const withCanary = (profile: string, product: Json): Json => {
    const copy = structuredClone(product)
    if (profile === 'eu-battery@1') {
      copy['eubat:manufacturerIdentifier'] = canary
      ;(copy['eubat:hasSupplyChainDueDiligence'] as Json)['eubat:auditBody'] = `${canary} audit body`
      ;((copy['eubat:hasMaterialComposition'] as Json[])[0]['schema:name'] as Json)['@value'] = `${canary} material`
    } else {
      ;(copy['eutex:hasSubstancesOfConcern'] as Json[])[0]['oec:substanceLocation'] = `${canary} location`
      ;(copy['oec:hasOperatorInformation'] as Json)['gs1:organizationName'] = `${canary} operator`
      copy['eutex:hasCutAndSewFacility'] = { ...(copy['eutex:hasCutAndSewFacility'] as Json), 'schema:name': `${canary} facility` }
    }
    return copy
  }

  it('reaches the holder who opens it, and nothing this application prints, lists, indexes or exports', async () => {
    const seen: Array<[string, string]> = []
    const keep = (where: string, text: string): string => {
      seen.push([where, text])
      return text
    }
    const passports: string[] = []

    for (const [profile, serial] of [
      ['eu-battery@1', 'LEAK-BAT-0001'],
      ['eu-textile@1', 'LEAK-TEX-0001'],
    ] as const) {
      const example = await exampleFor(profile, serial)
      const product = withCanary(profile, example.product)
      passports.push(example.passportId)

      // Issued, then updated, so the value passes through both write paths.
      const issued = await post(`/api/brands/${brandId}/passports`, { profile, itemReference: example.itemReference, serial, product })
      expect(issued.status).toBe(200)
      keep(`issue response, ${profile}`, issued.text)
      const updated = await post(`/api/passports/${ref(example.passportId)}/update`, { product: { ...product, 'oec:lastUpdated': '2026-11-04T08:00:00Z' } })
      expect(updated.status).toBe(200)
      keep(`update response, ${profile}`, updated.text)

      // A write that is refused, with the value inside the document: the refusal is answered and not printed.
      const refused = await post(`/api/brands/${brandId}/passports`, { profile, itemReference: example.itemReference, serial: `${serial}-X`, product })
      expect(refused.status).toBe(409)
      // A body that is not JSON, with the value in it: the parser's own error quotes the body.
      const garbled = await post(`/api/brands/${brandId}/passports`, undefined, `{"profile":"${profile}","product":{"x":"${canary}"`)
      expect(garbled.status).toBe(400)
      expect(garbled.body.error).toBe('body-not-json')
      keep(`garbled body response, ${profile}`, garbled.text)

      // The control: the holder's view does carry the value, so this search can find it where it is.
      const authorised = await post(`/api/passports/${ref(example.passportId)}/authorised-view`, {})
      expect(authorised.text).toContain(canary)
      expect((authorised.body as AuthorisedReading).authorisedView.status).toBe('pass')

      // Everything another reader can ask for.
      keep(`journal view, ${profile}`, (await get(`/api/passports/${ref(example.passportId)}`)).text)
      keep(`verify, ${profile}`, (await get(`/api/verify?passportId=${ref(example.passportId)}`)).text)
      const claim = await post(`/api/passports/${ref(example.passportId)}/claims`, { assertedRole: 'observer', event: { type: 'ObjectEvent', eventID: `urn:uuid:6c000000-0000-4000-8000-${profile === 'eu-battery@1' ? '0000000000b1' : '0000000000b2'}`, eventTime: '2026-11-04T07:00:00.000Z', eventTimeZoneOffset: '+00:00', epcList: [example.passportId], action: 'OBSERVE', bizStep: 'inspecting', disposition: 'conformant' } })
      expect(claim.status).toBe(200)
      keep(`claim, ${profile}`, claim.text)
      keep(`claim bytes, ${profile}`, (await get(`/api/lifecycle-claims/${ref(claim.body.attestationId)}`)).text)
      keep(`claims, ${profile}`, (await get(`/api/passports/${ref(example.passportId)}/claims`)).text)
      const offer = await post(`/api/passports/${ref(example.passportId)}/offer`, { terms: { word: 'Sold' } })
      keep(`offer, ${profile}`, offer.text)
      keep(`offers, ${profile}`, (await get(`/api/passports/${ref(example.passportId)}/offers`)).text)
      keep(`offer preview, ${profile}`, (await get(`/api/offers/${encodeURIComponent(offer.body.offer.requestId)}`)).text)

      // The index this process runs: its lookup, and its public history and evidence exports.
      const lookup = await fetch(`${platform.index.url}/lookup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ service: 'ls_dpp', query: { passportId: example.passportId } }) })
      const answer = (await lookup.json()) as { outputs: Array<{ beef: number[] }> }
      expect(answer.outputs.length).toBeGreaterThan(0)
      for (const output of answer.outputs) keep(`index lookup bytes, ${profile}`, Buffer.from(output.beef).toString('latin1'))
      for (const path of ['/history', '/evidence-package', '/evidence-export']) {
        keep(`index ${path}, ${profile}`, await (await fetch(`${platform.index.url}${path}?passportId=${ref(example.passportId)}`)).text())
      }
    }

    // The EPCIS exchange: events that name both passports are imported, and everything it lists and exports is searched too.
    const events = epcisDocument(passports.map((passportId, index) => objectEvent(index + 1, [passportId], { bizStep: 'shipping', disposition: 'in_transit' })))
    const imported = await upload('/api/epcis/imports?requestId=leak-events', JSON.stringify(events))
    expect(imported.status).toBe(201)
    keep('epcis import response', imported.text)
    keep('epcis imports', (await get('/api/epcis/imports')).text)
    keep('epcis import record', (await get(`/api/epcis/imports/${ref(imported.body.record.importId)}`)).text)
    keep('epcis original', (await get(`/api/epcis/imports/${ref(imported.body.record.importId)}/original`)).text)
    for (const passportId of passports) {
      const named = await get(`/api/epcis/events?identifier=${ref(passportId)}`)
      expect(named.body.events).toHaveLength(1)
      keep(`epcis events, ${passportId}`, named.text)
    }
    keep('epcis status', (await get('/api/epcis/status')).text)
    keep('epcis conflicts', (await get('/api/epcis/conflicts')).text)
    keep('epcis store', await epcisStore())

    keep('passport list', (await get(`/api/brands/${brandId}/passports`)).text)
    keep('operations', (await get('/api/operations')).text)
    keep('operations run', (await post('/api/operations/run', {})).text)
    keep('health', (await get('/api/health')).text)
    keep('profiles', (await get('/api/profiles')).text)
    // The journal as the store holds it, which is what a database dump would show.
    keep('journal', JSON.stringify(await platform.store.listPassports()))
    keep('everything printed', printed.join('\n'))

    // The listings did return the passports, so an empty answer is not what kept the value out.
    for (const passportId of passports) expect(seen.find(([where]) => where === 'passport list')![1]).toContain(passportId)
    expect(seen.find(([where]) => where === 'journal')![1]).toContain('ciphertext')
    expect(printed.length).toBeGreaterThan(0)

    const leaks = seen.filter(([, text]) => text.includes(canary)).map(([where]) => where)
    expect(leaks).toEqual([])
  })

  it('is not echoed in an error the API did not expect', async () => {
    // An error object can carry the request among its properties; only its name and stack are printed.
    const error = Object.assign(new Error('unexpected'), { body: `{"secret":"${canary}"}` })
    const spy = vi.spyOn(platform.store, 'getBrand').mockRejectedValueOnce(error)
    const before = printed.length
    const answer = await post(`/api/brands/${brandId}/passports`, { profile: 'eu-battery@1', itemReference: '100200300', serial: 'LEAK-ERR-0001', product: {} })
    spy.mockRestore()
    expect(answer.status).toBe(500)
    const lines = printed.slice(before).join('\n')
    expect(lines).toMatch(/request failed: Error: unexpected/)
    expect(lines).not.toContain(canary)
  })
})

describe('the credential of an EPCIS source', () => {
  // Every form the credential travels in: as it is, as an address would spell it, and as a basic authorisation carries it.
  const forms = [credential, encodeURIComponent(credential), Buffer.from(`operator:${credential}`).toString('base64')]

  it('reaches the source it was configured for, and nothing this application answers, lists, stores, exports or prints', async () => {
    const seen: Array<[string, string]> = []
    const keep = (where: string, text: string): string => {
      seen.push([where, text])
      return text
    }
    const before = printed.length

    // The source is described: that a credential is set, and which kind.
    const described = await get('/api/epcis/sources')
    expect(described.body.map((source: Json) => [source.sourceId, source.credentialConfigured, source.credentialScheme])).toEqual([['supplier-a', true, 'bearer'], ['echo', true, 'header'], ['stranger', true, 'basic']])
    keep('sources', described.text)
    keep('status', (await get('/api/epcis/status')).text)

    // A pull that works, over several pages. The control: the source did receive the credential, so this search can find it where it is.
    const pulled = await post('/api/epcis/sources/supplier-a/pulls', { queryId: 'leak', query: { perPage: 2 } })
    expect(pulled.body).toMatchObject({ outcome: 'ok', events: { total: 5 }, pull: { source: { credentialsConfigured: true } } })
    expect(epcisSource.requests.filter((request) => request.headers.authorization === `Bearer ${credential}`)).toHaveLength(3)
    keep('pull result', pulled.text)
    keep('pull state', (await get('/api/epcis/sources/supplier-a/pulls/leak')).text)
    for (const page of pulled.body.pages as Json[]) {
      keep(`page import ${String(page.page)}`, (await get(`/api/epcis/imports/${ref(String(page.importId))}`)).text)
      keep(`page original ${String(page.page)}`, (await get(`/api/epcis/imports/${ref(String(page.importId))}/original`)).text)
    }
    keep('events of a pulled item', (await get(`/api/epcis/events?identifier=${ref(item('LEAK-3'))}`)).text)

    // A source that refuses the credential it is sent, and one that sends it back in its answer. Neither answer is kept, and neither refusal quotes it.
    const refused = await post('/api/epcis/sources/stranger/pulls', { queryId: 'leak', query: {} })
    expect(refused.body).toMatchObject({ outcome: 'source-authentication-required', pages: [] })
    expect(epcisSource.requests.at(-1)!.headers.authorization).toBe(`Basic ${Buffer.from(`operator:${credential}`).toString('base64')}`)
    keep('refused pull', refused.text)
    const echoed = await post('/api/epcis/sources/echo/pulls', { queryId: 'leak', query: {} })
    expect(echoed.body).toMatchObject({ outcome: 'invalid-source', reason: 'credential-echoed', pages: [] })
    expect(echoingSource.requests.at(-1)!.headers['x-api-key']).toBe(credential)
    keep('echoed pull', echoed.text)
    keep('echoed pull state', (await get('/api/epcis/sources/echo/pulls/leak')).text)

    // A request that carries the credential itself: as a query value, which the pull refuses, and in a body that is not JSON.
    const carried = await post('/api/epcis/sources/supplier-a/pulls', { queryId: 'carried', query: { eventIds: [`urn:example:${credential}`] } })
    expect(carried.status).toBe(400)
    keep('pull with the credential as a query value', carried.text)
    const garbled = await post('/api/epcis/sources/supplier-a/pulls', undefined, `{"queryId":"${credential}`)
    expect(garbled.status).toBe(400)
    expect(garbled.body.error).toBe('body-not-json')
    keep('garbled pull request', garbled.text)

    keep('imports', (await get('/api/epcis/imports?limit=200')).text)
    keep('conflicts', (await get('/api/epcis/conflicts')).text)
    keep('health', (await get('/api/health')).text)
    keep('operations', (await get('/api/operations')).text)
    // The store, which is what a database dump would show, and every line printed since this test began.
    keep('epcis store', await epcisStore())
    keep('everything printed', printed.slice(before).join('\n'))

    // The listings did hold the pulled pages and the log did follow the pulls, so an empty answer is not what kept the credential out.
    expect((await get('/api/epcis/imports?limit=200')).body.imports.filter((entry: Json) => (entry.provenance as Json).kind === 'query')).toHaveLength(3)
    expect(seen.find(([where]) => where === 'epcis store')![1]).toContain('"credentialsConfigured":true')
    expect(printed.slice(before).some((line) => line.startsWith('EPCIS pull supplier-a/leak:') && line.includes('"credentialSent":true'))).toBe(true)

    const leaks = seen.filter(([, text]) => forms.some((form) => text.includes(form))).map(([where]) => where)
    expect(leaks).toEqual([])
    // Nor is it anywhere this file's earlier tests printed.
    expect(forms.some((form) => printed.join('\n').includes(form))).toBe(false)
  })
})
