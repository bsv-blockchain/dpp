// The identifier host, over HTTP. A passport identifier is a GS1 Digital
// Link under PASSPORT_HOST, and the standard asks the host an identifier is
// minted under to be a GS1-Conformant Resolver for primary key 01
// (spec/gs1-discovery.md §1, rule 6). These tests issue one passport with the
// writer and then ask the server what a scanner, a discovery client and a
// browser would ask: the resolver description, the identifier with each
// Accept, a malformed and an unknown identifier, each method, and the walk
// from the identifier to the passport's verification.
//
// The item's GTIN and serial are the ones GS1's compression standard uses in
// its worked example, which is under the demonstration prefix, so the two
// compressed forms that standard publishes spell this passport's identifier.
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DPP_EVIDENCE_PACKAGE_LINK_TYPE, GS1_LINK_TYPES, JSON_LD_CONTEXT_RELATION, LINKSET_CONTEXT_URI, describeResolver, selectLink, type LinksetDocument } from '@bsv/dpp-profiles'
import { holderLabel, offerIdFromPath, publicPathOf } from '../../web/src/lib/format'
import { loadConfig } from '../src/config.js'
import { mintGtin, mintPassportId } from '../src/identifiers.js'
import { openPlatform, type Platform } from '../src/platform.js'
import { samplePayload } from '../src/profiles.js'
import type { PassportReading } from '../src/reader.js'
import { createServer } from '../src/server.js'

const config = loadConfig({ NETWORK: 'main', PASSPORT_HOST: 'passports.example.com', GS1_PREFIX: '952', LIVE_PUBLISHING: 'false' })
const policy = { host: config.passportHost, prefix: config.gs1Prefix }
const ROOT = `https://${policy.host}`
const GTIN = '09528765123457'
const SERIAL = '123456789123'
const ITEM = `/01/${GTIN}/21/${SERIAL}`
const PRODUCT = `/01/${GTIN}`
/** A GTIN under the same prefix that no passport was issued under. */
const OTHER_GTIN = mintGtin(policy.prefix, '876512346')
const SHELL = '<!doctype html><title>The web app</title>'
const BROWSER = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
const LINKSET = 'application/linkset+json'

const webDist = mkdtempSync(join(tmpdir(), 'dpp-identifier-host-'))
let platform: Platform
let server: Server
let base: string
let passportId: string

// Issuing a passport signs and announces a state, so the set-up has a time limit of its own.
beforeAll(async () => {
  platform = await openPlatform({ config, mode: 'test', log: () => {} })
  passportId = mintPassportId(policy, '876512345', SERIAL)
  await platform.writer.issue({ brandId: 'dev-brand', brand: platform.parties.brand('dev-brand'), passportId, profile: 'general@2', payload: samplePayload('general@2', true), ownerFields: {} })
  // The built web app is one page whatever the path. A stand-in for it shows that a redirect's target answers.
  writeFileSync(join(webDist, 'index.html'), SHELL)
  server = createServer({ platform, webDist }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}, 30_000)

afterAll(async () => {
  server.close()
  await platform.close()
  rmSync(webDist, { recursive: true, force: true })
})

/** One request that follows no redirect, so a redirect is seen as the answer it is. */
const ask = (path: string, accept?: string, method = 'GET'): Promise<Response> => fetch(`${base}${path}`, { method, redirect: 'manual', headers: accept == null ? {} : { accept } })
const linksetOf = async (response: Response): Promise<LinksetDocument> => (await response.json()) as LinksetDocument

describe('the identifier host', () => {
  it('mints the identifier the tests ask for', () => {
    expect(passportId).toBe(`${ROOT}${ITEM}`)
  })

  it('publishes the resolver description for primary key 01', async () => {
    const response = await ask('/.well-known/gs1resolver')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    const body = await response.json()
    expect(body).toEqual(describeResolver({ resolverRoot: ROOT }))
    expect(body).toMatchObject({ resolverRoot: ROOT, supportedPrimaryKeys: ['01'], linkTypeDefaultCanBeLinkset: false, jsonLdContextLocation: LINKSET_CONTEXT_URI })
  })

  it('redirects a browser from the identifier to the passport page with 307, and the page answers', async () => {
    const response = await ask(ITEM, BROWSER)
    expect(response.status).toBe(307)
    const location = response.headers.get('location')
    expect(location).toBe(`/passport${ITEM}`)
    // The web app links to the same page the resolver redirects to.
    expect(location).toBe(publicPathOf(passportId))
    const page = await ask(location!, BROWSER)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(await page.text()).toBe(SHELL)
    // A client that states no preference is redirected too, and the whole query string is passed on.
    expect((await ask(ITEM)).status).toBe(307)
    expect((await ask(`${ITEM}?lang=en&17=261231`)).headers.get('location')).toBe(`/passport${ITEM}?lang=en&17=261231`)
    // One trailing slash is tolerated, and the item is found under a lot it was not registered with.
    expect((await ask(`${ITEM}/`)).headers.get('location')).toBe(`/passport${ITEM}`)
    expect((await ask(`/01/${GTIN}/10/LOT-1/21/${SERIAL}`)).headers.get('location')).toBe(`/passport${ITEM}`)
    // The passport page is asked for by its link type as well.
    expect((await ask(`${ITEM}?linkType=gs1:dpp`)).headers.get('location')).toBe(`/passport${ITEM}?linkType=gs1:dpp`)
  })

  it('gives the linkset to a client that asks for it, and never redirects that request', async () => {
    const response = await ask(ITEM, LINKSET)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain(LINKSET)
    expect(response.headers.get('link')).toBe(`<${LINKSET_CONTEXT_URI}>; rel="${JSON_LD_CONTEXT_RELATION}"; type="application/ld+json"`)
    const linkset = await linksetOf(response)
    const passportPage = { href: `${ROOT}/passport${ITEM}`, title: 'Digital product passport' }
    const productPage = { href: `${ROOT}/passport${PRODUCT}`, title: 'Product information' }
    // The item first, then its GTIN, each anchored at its own identifier, and only the links this application serves.
    expect(linkset).toEqual({
      linkset: [
        { anchor: `${ROOT}${ITEM}`, [GS1_LINK_TYPES.dpp]: [passportPage], [GS1_LINK_TYPES.defaultLink]: [passportPage] },
        { anchor: `${ROOT}${PRODUCT}`, [GS1_LINK_TYPES.pip]: [productPage], [GS1_LINK_TYPES.defaultLink]: [productPage] },
      ],
    })
    expect(selectLink(linkset, { rel: 'gs1:dpp' })).toMatchObject({ outcome: 'selected', link: passportPage, scope: { granularity: 'item' } })
    expect(selectLink(linkset, { rel: DPP_EVIDENCE_PACKAGE_LINK_TYPE }).outcome).toBe('not-found')
    // The same answer for linkType=linkset from a browser, for a request for JSON, and beside a named link type.
    for (const [path, accept] of [
      [`${ITEM}?linkType=linkset`, BROWSER],
      [ITEM, 'application/json'],
      [`${ITEM}?linkType=gs1:dpp`, LINKSET],
    ] as const) {
      const again = await ask(path, accept)
      expect(again.status, path).toBe(200)
      expect(await linksetOf(again), path).toEqual(linkset)
    }
  })

  it('answers the GTIN alone, and a serial nobody issued under it, with the product page and never with a passport', async () => {
    const product = await ask(PRODUCT, BROWSER)
    expect(product.status).toBe(307)
    expect(product.headers.get('location')).toBe(`/passport${PRODUCT}`)
    expect((await ask(`/passport${PRODUCT}`, BROWSER)).status).toBe(200)
    // The resolver standard walks a request up to the GTIN's default (section 2.5.9). The answer is about the product, and the linkset says so by its anchor.
    const stranger = `/01/${GTIN}/21/NOBODY-ISSUED-THIS`
    expect((await ask(stranger, BROWSER)).headers.get('location')).toBe(`/passport${PRODUCT}`)
    const linkset = await linksetOf(await ask(stranger, LINKSET))
    expect(linkset.linkset.map((entry) => entry.anchor)).toEqual([`${ROOT}${PRODUCT}`])
    expect(selectLink(linkset, { rel: 'gs1:dpp' }).outcome).toBe('not-found')
    // No passport link exists for it, so asking for one by type is refused.
    const refused = await ask(`${stranger}?linkType=gs1:dpp`)
    expect(refused.status).toBe(404)
    expect(await refused.json()).toMatchObject({ error: 'link-type-unknown' })
  })

  it('refuses a malformed identifier with 400 and one this application did not issue with 404', async () => {
    for (const [path, reason] of [
      ['/01', 'primary-key-not-a-gtin'],
      ['/01/123', 'primary-key-not-a-gtin'],
      [`/01/${GTIN}/21`, 'trailing-segment'],
      [`/01/${GTIN}/21/A/10/B`, 'qualifier-order'],
      [`/01/${GTIN}/21/${'A'.repeat(21)}`, 'qualifier-value'],
      [`/01/${GTIN}/99/A`, 'qualifier-unsupported'],
      [`/01/${GTIN}?21=${SERIAL}`, 'key-in-query'],
      [`/01/${GTIN.slice(0, 13)}0/21/${SERIAL}`, 'check-digit'],
    ] as const) {
      for (const accept of [BROWSER, LINKSET]) {
        const response = await ask(path, accept)
        expect(response.status, path).toBe(400)
        expect(await response.json(), path).toMatchObject({ error: 'identifier-malformed', reason })
      }
    }
    for (const path of [`/01/${OTHER_GTIN}`, `/01/${OTHER_GTIN}/21/${SERIAL}`, `/01/${OTHER_GTIN}?linkType=linkset`]) {
      for (const accept of [BROWSER, LINKSET]) {
        const response = await ask(path, accept)
        expect(response.status, path).toBe(404)
        expect(await response.json(), path).toMatchObject({ error: 'identifier-unknown' })
      }
    }
  })

  it('answers GET, HEAD and OPTIONS from any origin, and no other method', async () => {
    const cors = (response: Response, what: string): void => {
      expect(response.headers.get('access-control-allow-origin'), what).toBe('*')
      expect(response.headers.get('access-control-allow-methods'), what).toBe('GET, HEAD, OPTIONS')
      expect(response.headers.get('vary'), what).toContain('Accept')
    }
    for (const [path, accept, status] of [
      ['/.well-known/gs1resolver', undefined, 200],
      [ITEM, LINKSET, 200],
      [ITEM, BROWSER, 307],
      ['/01/123', BROWSER, 400],
      [`/01/${OTHER_GTIN}`, BROWSER, 404],
    ] as const) {
      const got = await ask(path, accept)
      expect(got.status, path).toBe(status)
      cors(got, `GET ${path}`)
      const head = await ask(path, accept, 'HEAD')
      expect(head.status, path).toBe(status)
      expect(await head.text(), path).toBe('')
      cors(head, `HEAD ${path}`)
      const options = await ask(path, accept, 'OPTIONS')
      expect(options.status, path).toBe(204)
      cors(options, `OPTIONS ${path}`)
    }
    const post = await ask(ITEM, undefined, 'POST')
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD, OPTIONS')
  })

  it('decompresses an EPC binary string and answers it as the identifier it spells', async () => {
    // The two worked examples of the compression standard: one SGTIN-96, in hexadecimal and in URI-safe base 64.
    for (const compressed of ['/eh30164596f40c0e5cbe991a83', '/exMBZFlvQMDly-mRqD']) {
      const response = await ask(compressed, BROWSER)
      expect(response.status, compressed).toBe(307)
      expect(response.headers.get('location'), compressed).toBe(`/passport${ITEM}`)
      // A linkset is anchored at the decompressed form.
      const linkset = await linksetOf(await ask(compressed, LINKSET))
      expect(linkset.linkset[0]!.anchor, compressed).toBe(`${ROOT}${ITEM}`)
    }
    // A string of the same form that is no SGTIN is refused, not passed to the web app.
    const refused = await ask('/eh310000000000000000000000')
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ error: 'identifier-malformed', reason: 'unsupported-epc-scheme' })
  })

  it(
    'walks from the identifier to the verification of its passport',
    async () => {
      // A scanner asks for the identifier and is sent to the page.
      const redirect = await ask(ITEM, BROWSER)
      const pagePath = redirect.headers.get('location')!
      // A discovery client asks for the links, selects the passport and reaches the same page.
      const selected = selectLink(await linksetOf(await ask(ITEM, LINKSET)), { rel: GS1_LINK_TYPES.dpp })
      expect(selected.outcome === 'selected' && new URL(selected.link.href).pathname).toBe(pagePath)
      // The page reads the passport whose identifier is the passport host and its own path without the page prefix: the identifier that was scanned.
      const identifier = `${ROOT}${pagePath.slice('/passport'.length)}`
      expect(identifier).toBe(passportId)
      const reading = (await (await fetch(`${base}/api/verify?passportId=${encodeURIComponent(identifier)}`)).json()) as PassportReading
      expect(reading.passportId).toBe(passportId)
      expect(reading.lineage.map((state) => state.op)).toEqual(['ISSUE'])
      const status = (name: string): string | undefined => reading.checks.find((check) => check.name === name)?.status
      expect(status('recordEncoding')).toBe('pass')
      expect(status('actorSignatures')).toBe('pass')
      expect(status('publisherSignatures')).toBe('pass')
    },
    20_000
  )
})

describe('custody offer links', () => {
  it.each(['supplier/id', 'supplier%2Fid', 'offer:part:two', 'offer-previous-1'])('preserves the exact request ID %s', (id) => {
    const link = new URL(`/accept/${encodeURIComponent(id)}`, 'https://issuer.example')
    expect(offerIdFromPath(link.pathname)).toBe(id)
    expect(holderLabel(`recipient:${id}`)).toBe(`Recipient of offer ${id}`)
  })

  it('refuses a link with an invalid escape', () => {
    expect(offerIdFromPath('/accept/bad%')).toBeUndefined()
  })
})
