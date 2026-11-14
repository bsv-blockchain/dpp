import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PrivateKey, ProtoWallet, Utils } from '@bsv/sdk'
import {
  EPCIS_CONTEXT_IRI,
  EPCIS_CONTEXT_PREFIXES,
  EPCIS_EVENT_REPRESENTATION,
  EpcisEventHashError,
  base64UrlDecode,
  base64UrlEncode,
  buildEpcisEventCredential,
  constrainedCanonicalDigitalLink,
  didKeyFromIdentityKey,
  epcUriToDigitalLink,
  epcisEventAnchorMetadata,
  epcisEventCredentialKey,
  epcisEventCredentialVerifierFor,
  epcisEventHashId,
  epcisEventSubjects,
  gs1CheckDigit,
  parseStrictJson,
  signEpcisEventCredential,
  verifyEpcisEventCredential,
} from '../src/index.js'
import { COMMISSIONING_EVENT } from './epcis-event-vectors.js'
import { EPCIS_GS1_ARTEFACTS, readGs1Artefact } from '../../dpp-credentials/src/gs1-artefacts.js'

const vectors = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'fixtures', 'vectors', 'dpp', 'interoperability', 'epcis', 'hash-v1.json'), 'utf8'))
const expected = (id: string): any => vectors.vectors.find((v: any) => v.id === id).expected

describe('the pinned EPCIS context', () => {
  it('declares exactly the prefixes the hash builder knows', () => {
    // GS1's context is not in the repository; the test set-up provisions it and readGs1Artefact refuses any bytes but the pinned ones.
    const context = JSON.parse(readGs1Artefact(EPCIS_GS1_ARTEFACTS[1]).toString('utf8'))['@context']
    const prefixes = Object.fromEntries(Object.entries(context).filter(([, v]) => typeof v === 'string' && /[/#:]$/.test(v as string)))
    expect(prefixes).toEqual(EPCIS_CONTEXT_PREFIXES)
  })
})

describe('GS1 identifiers under the @1 subset', () => {
  it('computes the modulo-10 check digit', () => {
    expect(gs1CheckDigit('0952123412345')).toBe('3')
    expect(gs1CheckDigit('09521234000000001')).toBe('3')
    expect(gs1CheckDigit('952123400001')).toBe('3')
  })

  it.each([
    ['urn:epc:id:sgtin:9521234.012345.SER1', 'https://id.gs1.org/01/09521234123453/21/SER1'],
    ['urn:epc:class:lgtin:9521234.033333.LOT7', 'https://id.gs1.org/01/09521234333333/10/LOT7'],
    ['urn:epc:idpat:sgtin:9521234.055555.*', 'https://id.gs1.org/01/09521234555551'],
    ['urn:epc:id:sscc:9521234.0000000001', 'https://id.gs1.org/00/095212340000000013'],
    ['urn:epc:id:sgln:9521234.00001.0', 'https://id.gs1.org/414/9521234000013'],
    ['urn:epc:id:sgln:9521234.00002.EXT1', 'https://id.gs1.org/414/9521234000020/254/EXT1'],
    ['urn:epc:id:pgln:9521234.00003', 'https://id.gs1.org/417/9521234000037'],
    ['urn:epc:id:grai:9521234.00001.A1', 'https://id.gs1.org/8003/09521234000013A1'],
    ['urn:epc:id:giai:9521234.TOOL-9', 'https://id.gs1.org/8004/9521234TOOL-9'],
    ['urn:epc:id:gsrn:9521234.0000000001', 'https://id.gs1.org/8018/952123400000000017'],
    ['urn:epc:id:gdti:9521234.00001.DOC7', 'https://id.gs1.org/253/9521234000013DOC7'],
    ['urn:epc:id:cpi:9521234.PART-1.42', 'https://id.gs1.org/8010/9521234PART-1/8011/42'],
  ])('converts %s', (uri, link) => {
    expect(epcUriToDigitalLink(uri)).toBe(link)
  })

  it.each([
    'urn:epc:id:gid:95212.34.56',
    'urn:epc:id:sgcn:9521234.00001.1',
    'urn:epc:id:sgtin:9521234.012345.SER%2F2',
    'urn:epc:id:sgtin:9521234.0123456.SER1',
    'urn:epc:id:sscc:9521234.00000000011',
  ])('refuses %s by name', (uri) => {
    expect(() => epcUriToDigitalLink(uri)).toThrow(EpcisEventHashError)
    try { epcUriToDigitalLink(uri) } catch (e) { expect((e as EpcisEventHashError).code).toBe('event-hash-unsupported') }
  })

  it.each([
    ['https://example.com/01/09521234000012/21/ABC?linkType=all', 'https://id.gs1.org/01/09521234000012/21/ABC'],
    ['https://id.gs1.org/01/09521234000012/22/CPV1/10/LOT1/21/S1', 'https://id.gs1.org/01/09521234000012/21/S1'],
    ['https://id.gs1.org/01/09521234000012/22/CPV1/10/LOT1', 'https://id.gs1.org/01/09521234000012/10/LOT1'],
    ['https://id.gs1.org/01/09521234000012/22/CPV9', 'https://id.gs1.org/01/09521234000012'],
    ['https://id.gs1.org/414/9521234000050/254/EXT#frag', 'https://id.gs1.org/414/9521234000050/254/EXT'],
    ['https://dpp.example/path/00/095212340000000013', 'https://id.gs1.org/00/095212340000000013'],
    ['https://example.org/items/plain-identifier', 'https://example.org/items/plain-identifier'],
  ])('constrains %s', (url, link) => {
    expect(constrainedCanonicalDigitalLink(url)).toBe(link)
  })

  it.each([
    'https://id.gs1.org/01/9521234000012/21/SER2',
    'https://brand.example/gtin/09521234000012/ser/Q',
    'https://id.gs1.org/01/09521234000012/99/X',
    'https://id.gs1.org/414/9521234000050/21/S',
  ])('refuses the Digital Link %s under @1', (url) => {
    expect(() => constrainedCanonicalDigitalLink(url)).toThrow(EpcisEventHashError)
  })
})

describe('the strict JSON parse', () => {
  it('refuses a duplicate member and trailing content', () => {
    expect(() => parseStrictJson('{"a":1,"a":2}')).toThrow('duplicate member a')
    expect(() => parseStrictJson('{"a":1} x')).toThrow('trailing content')
  })

  it('carries a number only when a double carries its digits', () => {
    expect(parseStrictJson('[1.0, 1e2, 0.5, -0]')).toEqual([1, 100, 0.5, -0])
    expect(() => parseStrictJson('9007199254740993')).toThrow('cannot be carried exactly')
    expect(() => parseStrictJson('1e400')).toThrow('cannot be carried exactly')
  })

  it('refuses malformed UTF-8 and nesting past the bound', () => {
    expect(() => parseStrictJson([0x22, 0xff, 0x22])).toThrow('UTF-8')
    expect(() => parseStrictJson('['.repeat(70) + ']'.repeat(70))).toThrow('nesting')
  })
})

describe('base64url', () => {
  it('round-trips and refuses padding and non-canonical trailing bits', () => {
    const bytes = [0, 1, 2, 250, 251, 252, 253, 254, 255]
    expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes)
    expect(() => base64UrlDecode('AQ==')).toThrow('not base64url')
    expect(() => base64UrlDecode('A')).toThrow('not base64url')
    expect(() => base64UrlDecode('AR')).toThrow('not canonical')
  })
})

describe('the Event Hash ID', () => {
  it('reproduces the pinned vectors and ignores eventID and recordTime', () => {
    const { hashId, preHash } = epcisEventHashId(COMMISSIONING_EVENT)
    expect(hashId).toBe(expected('object-event-commissioning').hash_id)
    expect(preHash).toBe(expected('object-event-commissioning').pre_hash)
    const { eventID: _id, recordTime: _rt, ...bare } = COMMISSIONING_EVENT
    expect(epcisEventHashId(bare).hashId).toBe(hashId)
    expect(epcisEventSubjects(COMMISSIONING_EVENT)).toEqual(['https://id.gs1.org/01/09521234123453/21/SER1'])
  })

  it('refuses an error declaration by name and a mangled value as schema-invalid', () => {
    try { epcisEventHashId({ ...COMMISSIONING_EVENT, errorDeclaration: { declarationTime: '2026-03-12T09:00:00Z' } }); expect.fail('hashed') } catch (e) { expect((e as EpcisEventHashError).code).toBe('error-declaration-unsupported') }
    try { epcisEventHashId({ ...COMMISSIONING_EVENT, epcList: 'not-a-list' }); expect.fail('hashed') } catch (e) { expect((e as EpcisEventHashError).code).toBe('schema-invalid') }
  })
})

describe('the credential', () => {
  const priv = PrivateKey.fromHex('7a'.repeat(32))
  const identityKey = priv.toPublicKey().toString()
  const credentialKey = epcisEventCredentialKey(identityKey)
  const issuer = didKeyFromIdentityKey(credentialKey)
  const kid = `${issuer}#${issuer.slice('did:key:'.length)}`
  const wallet = new ProtoWallet(priv)
  const checkedAt = '2026-11-09T12:00:00Z'

  it('signs with the published credential key and verifies from the did:key alone', async () => {
    const credential = buildEpcisEventCredential({ event: COMMISSIONING_EVENT, issuer, validFrom: '2026-11-09T00:00:00Z' })
    expect(credential.id).toBe(expected('object-event-commissioning').hash_id)
    expect(credential['@context']).toEqual(['https://www.w3.org/ns/credentials/v2', EPCIS_CONTEXT_IRI])
    const jws = await signEpcisEventCredential(credential, { kid, signer: wallet })
    const result = await verifyEpcisEventCredential(jws, { checkedAt })
    expect(result.proof).toEqual({ status: 'pass' })
    expect(result.verificationKey).toBe(credentialKey)
    expect(result.time).toEqual({ status: 'pass' })
    expect(result.schema.status).toBe('unknown')
    expect(epcisEventAnchorMetadata(result)).toEqual({
      digest: result.digest, attestationId: credential.id, issuer, subject: 'https://id.gs1.org/01/09521234123453/21/SER1',
      attestationType: 'ObjectEvent', representation: EPCIS_EVENT_REPRESENTATION, mediaType: 'application/vc+jwt',
    })
  })

  it('refuses to build over an eventID that names another hash, and to sign under a kid of another issuer', async () => {
    expect(() => buildEpcisEventCredential({ event: { ...COMMISSIONING_EVENT, eventID: `ni:///sha-256;${'0'.repeat(64)}?ver=CBV2.0` }, issuer, validFrom: '2026-11-09T00:00:00Z' })).toThrow('hashes to')
    const credential = buildEpcisEventCredential({ event: COMMISSIONING_EVENT, issuer, validFrom: '2026-11-09T00:00:00Z' })
    await expect(signEpcisEventCredential(credential, { kid: 'did:key:zQ3shother#zQ3shother', signer: wallet })).rejects.toThrow('verification method of the issuer')
  })

  it('reports a wrong key, a changed byte and a missing resolver separately', async () => {
    const credential = buildEpcisEventCredential({ event: COMMISSIONING_EVENT, issuer: 'did:web:issuer.example', validFrom: '2026-11-09T00:00:00Z' })
    const jws = await signEpcisEventCredential(credential, { kid: 'did:web:issuer.example#credential', signer: wallet })
    expect((await verifyEpcisEventCredential(jws, { checkedAt })).proof).toMatchObject({ status: 'unknown', reasonCode: 'referenced-artefact-unavailable' })
    expect((await verifyEpcisEventCredential(jws, { checkedAt, resolveKey: () => credentialKey })).proof).toEqual({ status: 'pass' })
    expect((await verifyEpcisEventCredential(jws, { checkedAt, resolveKey: () => identityKey })).proof).toMatchObject({ status: 'fail', reasonCode: 'signature-invalid' })
    const flipped = jws.slice(0, -1) + (jws.endsWith('A') ? 'B' : 'A')
    const changed = await verifyEpcisEventCredential(flipped, { checkedAt, resolveKey: () => credentialKey })
    expect(changed.proof.status).toBe('fail')
    expect(() => epcisEventAnchorMetadata(changed)).toThrow('proof held')
  })

  it('answers the report as a credential verifier and names another representation unsupported', async () => {
    const verifier = epcisEventCredentialVerifierFor()
    const other = await verifier({ representation: 'vc-di-ecdsa-rdfc-2019@1', bytes: Utils.toArray('{}', 'utf8'), digest: '00'.repeat(32), checkedAt })
    expect(other.proof).toMatchObject({ status: 'unknown', reasonCode: 'representation-unsupported' })
    const credential = buildEpcisEventCredential({ event: COMMISSIONING_EVENT, issuer, validFrom: '2026-11-09T00:00:00Z' })
    const jws = await signEpcisEventCredential(credential, { kid, signer: wallet })
    const ours = await verifier({ representation: EPCIS_EVENT_REPRESENTATION, bytes: Utils.toArray(jws, 'utf8'), digest: '00'.repeat(32), checkedAt })
    expect(ours.proof).toEqual({ status: 'pass' })
    expect(ours.subjects).toEqual(['https://id.gs1.org/01/09521234123453/21/SER1'])
    expect(ours.attestationType).toBe('ObjectEvent')
  })
})
