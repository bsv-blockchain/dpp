import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { PrivateKey, ProtoWallet, Transaction, Utils } from '@bsv/sdk'
import * as lifecycle from '../src/epcis-lifecycle/claim.js'
import * as parked from '../src/parked/epcis-event.js'
import * as shared from '../src/epcis-lifecycle/shared.js'
import {
  EPCIS_LIFECYCLE_REPRESENTATION,
  assertEpcisLifecycleClaim,
  buildEpcisLifecycleAnchors,
  buildEpcisLifecycleClaim,
  epcisIdentifierGranularity,
  epcisLifecycleAnchorMetadata,
  epcisLifecycleClaimBytes,
  epcisLifecycleClaimDigest,
  epcisLifecycleClaimId,
  epcisLifecycleCredentialVerifierFor,
  parseEpcisLifecycleClaim,
  signEpcisLifecycleClaim,
  verifyEpcisLifecycleClaim,
} from '../src/epcis-lifecycle.js'
import { buildAttestationAnchor, decodeAttestationAnchor, verifyLifecycleClaim, verifyPassportEvidence } from '@bsv/dpp-protocol'
import { attachProof, mockTracker } from '../../dpp-protocol/test/helpers.js'
import {
  ANCHOR_SERVICE, EVENTS, ID, P, PARTY, S, SECOND_ANCHOR_SERVICE, SHREDDING_RULE, SHREDDING_STEP,
  bind, gs1Comparison, fixtureIssuancePolicy, input, issue, lifecycleClaims, lifecycleEventVectors, optionsOf, pinnedSchemaValidator, runVector, expectedOf, signUnchecked, text, unchecked, type VectorOptions,
} from './epcis-lifecycle-vectors.js'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const FILE = 'fixtures/vectors/dpp/epcis-lifecycle/v1.json'

type VectorFile = Record<string, unknown> & { id: string; vectors: Array<Record<string, any> & { id: string }> }

const generated = await lifecycleEventVectors()
if (process.env.REGENERATE_FIXTURES === '1') writeFileSync(join(ROOT, FILE), JSON.stringify(generated, null, 2) + '\n')
const published = JSON.parse(readFileSync(join(ROOT, FILE), 'utf8')) as VectorFile
const vector = (id: string): Record<string, any> => {
  const v = published.vectors.find((x) => x.id === id)
  if (v == null) throw new Error(`no vector ${id}`)
  return v
}
const findings = (id: string): Record<string, any> => vector(id).expected.findings

describe('the published dpp-epcis-lifecycle@1 vectors', () => {
  it(`${FILE} is lifecycleEventVectors(), verbatim, and shaped as the stack expects`, () => {
    expect(published).toEqual(JSON.parse(JSON.stringify(generated)))
    for (const key of ['id', 'name', 'version', 'reference_impl', 'parity_class', 'vectors']) expect(published).toHaveProperty(key)
    const ids = published.vectors.map((v) => v.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const v of published.vectors) {
      for (const key of ['id', 'description', 'input', 'expected', 'tags']) expect(v).toHaveProperty(key)
      expect(v.id).toMatch(/^[a-z0-9-]+$/)
      expect(v.tags.length === 1 && ['happy-path', 'error-case'].includes(v.tags[0])).toBe(true)
    }
    const hexOnly = (value: unknown): void => {
      if (typeof value === 'string') expect(value).toMatch(/^[0-9a-f]*$/)
      else if (Array.isArray(value)) value.forEach(hexOnly)
      else if (value != null && typeof value === 'object') Object.values(value).forEach(hexOnly)
    }
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(walk)
      if (value == null || typeof value !== 'object') return
      for (const [k, v] of Object.entries(value)) (k.endsWith('_hex') ? hexOnly(v) : walk(v))
    }
    walk(published)
  })

  it('every vector reproduces from the bytes and options in the file alone', async () => {
    for (const v of published.vectors) {
      if (v.input.claim != null) expect(expectedOf(await runVector(v.input.claim, v.input.options as VectorOptions)), v.id).toEqual(v.expected)
      else {
        let refused = false
        try { assertEpcisLifecycleClaim(v.input.unsigned_claim) } catch { refused = true }
        expect(refused, v.id).toBe(v.expected.refused)
      }
    }
  })

  it('covers all five EPCIS event types', () => {
    const types = new Set(published.vectors.filter((v) => v.tags[0] === 'happy-path').map((v) => v.expected.event_type))
    expect([...types].sort()).toEqual(['AggregationEvent', 'AssociationEvent', 'ObjectEvent', 'TransactionEvent', 'TransformationEvent'])
  })

  it('holds every positive event to the pinned EPCIS 2.0.1 schema, and the schema does refuse a broken one', () => {
    for (const v of published.vectors.filter((x) => x.tags[0] === 'happy-path')) expect(findings(v.id).event_structure, v.id).toEqual({ status: 'pass' })
    for (const e of Object.values(EVENTS)) expect(pinnedSchemaValidator(JSON.parse(JSON.stringify(e))).status).toBe('pass')
    expect(pinnedSchemaValidator({ ...EVENTS.receiving, action: 'MOVE' }).status).toBe('fail')
  })
})

describe('the representative lifecycle cases', () => {
  it('passes every finding the caller gave evidence for, and leaves the rest unknown', () => {
    expect(findings('object-event-commissioning')).toMatchObject({
      event_structure: { status: 'pass' }, event_semantics: { status: 'pass' }, product_binding: { status: 'pass' }, signature: { status: 'pass' }, authority: { status: 'supported' },
      anchor_commitment: { status: 'unknown', reason_code: 'no-evidence' }, inclusion: { status: 'unknown', reason_code: 'no-evidence' }, correction: { status: 'unknown', reason_code: 'no-evidence' },
    })
    expect(findings('without-caller-evidence')).toMatchObject({
      event_structure: { status: 'unknown', reason_code: 'schema-unavailable' }, product_binding: { status: 'unknown', reason_code: 'x-comparison-unavailable' },
      signature: { status: 'pass' }, authority: { status: 'unavailable', reason_code: 'authority-unavailable' },
    })
    expect(vector('without-caller-evidence').expected.item_participants).toEqual([])
  })

  it('keeps multi-product roles and never turns a class reference into an item', () => {
    const m = vector('transformation-event-manufacturing').expected
    expect(m.bound_passports).toEqual([P.battery2, P.cell, P.moduleA, P.moduleB].sort())
    expect(m.item_participants).toEqual([P.battery2, P.moduleA, P.moduleB].sort())
    expect(m.bindings.find((b: any) => b.passport_id === P.cell)).toMatchObject({ level: 'class', field: 'inputQuantityList', status: 'pass' })
    expect(m.findings.anchor_commitment).toEqual({ status: 'pass' })
    expect(vector('recycling-3-shredding-with-rule').expected.item_participants).toEqual([P.moduleA, P.moduleC].sort())
    expect(findings('class-reference-as-item').product_binding).toEqual({ status: 'fail', reason_code: 'x-class-as-item' })
    expect(findings('lot-in-epc-list-as-item').product_binding).toEqual({ status: 'fail', reason_code: 'x-class-as-item' })
    expect(vector('class-reference-as-item').expected.item_participants).toEqual([])
  })

  it('reports ownership and possession separately, and infers neither', () => {
    expect(findings('separate-ownership-and-possession').ownership).toMatchObject({ status: 'asserted', from: [PARTY.maker], to: [PARTY.retailer] })
    expect(findings('separate-ownership-and-possession').possession).toMatchObject({ status: 'asserted', from: [PARTY.maker], to: [PARTY.carrier] })
    expect(findings('possession-without-ownership').possession).toMatchObject({ status: 'asserted', from: [PARTY.carrier], to: [PARTY.retailer] })
    expect(findings('possession-without-ownership').ownership.status).toBe('not-asserted')
    expect(findings('sale-label-asserts-no-ownership').ownership.status).toBe('not-asserted')
    expect(findings('object-event-shipping').possession.status).toBe('not-asserted')
    expect(findings('object-event-shipping').ownership.status).toBe('not-asserted')
  })

  it('links the four recycling claims through the identifiers they share', () => {
    const steps = ['recycling-1-collection', 'recycling-2-disassembly', 'recycling-3-shredding-with-rule', 'recycling-4-end-of-life'].map((id) => vector(id).expected)
    for (const s of steps) expect(s.findings.signature.status).toBe('pass')
    expect(steps[0].item_participants).toEqual([P.battery2])
    expect(steps[1].item_participants).toEqual([P.battery2, P.moduleA, P.moduleC].sort())
    expect(steps[2].item_participants).toEqual([P.moduleA, P.moduleC].sort())
    expect(steps[3].item_participants).toEqual([P.battery2])
    expect(steps.map((s) => s.event_type)).toEqual(['ObjectEvent', 'AssociationEvent', 'TransformationEvent', 'ObjectEvent'])
  })

  it('keeps standard and extension terms and members distinguishable', () => {
    expect(vector('recycling-3-shredding-with-rule').expected.terms).toContainEqual({ path: 'event.bizStep', value: SHREDDING_STEP, kind: 'extension' })
    expect(vector('object-event-commissioning').expected.terms).toContainEqual({ path: 'event.bizStep', value: 'commissioning', kind: 'standard' })
    expect(vector('object-event-commissioning').expected.extensions).toEqual([
      { path: 'event.ilmd.example:chemistry', name: 'example:chemistry', namespace: 'https://example.org/dpp-ext/' },
      { path: 'event.ilmd.example:nominalCapacityAh', name: 'example:nominalCapacityAh', namespace: 'https://example.org/dpp-ext/' },
    ])
    expect(findings('recycling-3-shredding-rule-unavailable').event_semantics).toEqual({ status: 'unavailable', reason_code: 'x-extension-rule-unavailable' })
    expect(findings('recycling-3-shredding-with-rule').event_semantics).toEqual({ status: 'pass' })
  })

  it('preserves extension members and decimal readings byte for byte', async () => {
    const { c } = await lifecycleClaims()
    expect(c.commissioning.event.ilmd).toEqual(EVENTS.commissioning.ilmd)
    const sensor = text(c.sensor)
    for (const literal of ['"value":21.5', '"value":45.25', '"minValue":-3.75', '"maxValue":38.125']) expect(sensor).toContain(literal)
    expect(parseEpcisLifecycleClaim(sensor)).toEqual(c.sensor)
  })
})

describe('refusals', () => {
  it('never issues an event built from a token operation, a sale label or a metadata edit alone', () => {
    expect(vector('refused-sale-label-without-object').expected).toEqual({ refused: true, reason_codes: ['x-no-observation', 'x-binding-identifier-absent'] })
    expect(vector('refused-transformation-from-metadata-edit').expected.reason_codes).toContain('x-no-observation')
    expect(vector('refused-custody-from-token-transfer').expected.reason_codes).toContain('x-no-observation')
    expect(vector('refused-transformation-with-action').expected).toEqual({ refused: true, reason_codes: ['schema-invalid'] })
    expect(vector('refused-aggregation-without-parent').expected.refused).toBe(true)
    expect(vector('refused-extension-event-type').expected.reason_codes).toContain('x-event-type-unsupported')
    expect(vector('refused-importer-as-observer').expected).toEqual({ refused: true, reason_codes: ['x-importer-not-observer'] })
  })

  it('offers no path from a token operation to an event', () => {
    const names = Object.keys(lifecycle)
    expect(names.filter((n) => /token|operation|mapping|eventtype(?!s)|origin|disposition/i.test(n) && n !== 'EpcisEventType')).toEqual([])
    expect(() => buildEpcisLifecycleClaim(input(S.maker, { type: 'ObjectEvent', eventTime: '2026-11-02T09:00:00.000Z', eventTimeZoneOffset: '+10:00', eventID: 'urn:uuid:6b000000-0000-4000-8000-000000000999', action: 'OBSERVE', bizStep: 'shipping', epcList: [] }, [bind(P.battery, 'epcList', ID.battery)]))).toThrow(/x-no-observation/)
  })

  it('fails a binding to the wrong passport, an absent identifier, altered bytes and altered digests, each by name', () => {
    expect(findings('binding-to-another-passport').product_binding).toEqual({ status: 'fail', reason_code: 'subject-mismatch' })
    expect(findings('binding-identifier-absent').product_binding).toEqual({ status: 'fail', reason_code: 'x-binding-identifier-absent' })
    expect(findings('altered-secured-bytes').signature).toEqual({ status: 'fail', reason_code: 'signature-invalid' })
    expect(findings('non-canonical-bytes').event_structure).toEqual({ status: 'fail', reason_code: 'x-not-canonical' })
    expect(findings('non-canonical-bytes').signature.status).toBe('unknown')
    expect(findings('altered-context-digest')).toMatchObject({ event_structure: { status: 'fail', reason_code: 'x-context-digest-mismatch' }, signature: { status: 'pass' } })
    expect(findings('altered-profile-digest')).toMatchObject({ event_structure: { status: 'fail', reason_code: 'x-profile-digest-mismatch' }, signature: { status: 'pass' } })
  })

  it('refuses a wrong, missing or relabelled event identifier', () => {
    expect(findings('event-id-not-expected').event_structure).toEqual({ status: 'fail', reason_code: 'x-event-id-mismatch' })
    expect(findings('event-id-missing').event_structure).toEqual({ status: 'fail', reason_code: 'x-event-id-missing' })
    expect(findings('source-digest-relabelled-as-cbv-hash').event_structure).toEqual({ status: 'fail', reason_code: 'x-digest-relabelled' })
    expect(findings('local-identity-as-event-id').event_structure).toEqual({ status: 'fail', reason_code: 'x-local-identity-as-event-id' })
  })

  it('separates a valid signature from authority, and refuses the contradictions', () => {
    expect(findings('valid-signature-unsupported-authority')).toMatchObject({ signature: { status: 'pass' }, authority: { status: 'refused', reason_code: 'authority-unconfirmed' } })
    expect(findings('importer-signing-as-observer')).toMatchObject({ signature: { status: 'pass' }, authority: { status: 'refused', reason_code: 'x-importer-not-observer' } })
    expect(findings('importer-as-authorised-reporter').authority).toEqual({ status: 'supported' })
    expect(findings('owner-contradicted-by-party-roles').authority).toEqual({ status: 'refused', reason_code: 'x-party-role-contradicted' })
    expect(findings('authority-scope-without-binding').authority).toEqual({ status: 'refused', reason_code: 'x-scope-without-binding' })
  })

  it('reports the same claim, a conflict, a restatement and another issuer, and merges none', () => {
    expect(vector('duplicate-and-conflicting-observations').expected.relations.map((r: any) => r.relation)).toEqual(['same-claim', 'conflict', 'restatement', 'other-issuer'])
  })

  it('applies an error declaration by the original issuer and no other', async () => {
    const { n } = await lifecycleClaims()
    const v = await runVector(vector('error-declaration-applies').input.claim, vector('error-declaration-applies').input.options)
    expect(v.findings.correction.status).toBe('declared-in-error')
    expect((v.findings.correction.detail as any).correctiveClaims).toEqual([epcisLifecycleClaimId(n.correctiveInspection)])
    expect(findings('error-declaration-itself').correction).toEqual({ status: 'declared-in-error', reason_code: 'x-self-declared' })
    expect(findings('error-declaration-by-another-issuer').correction).toEqual({ status: 'unknown', reason_code: 'x-declaration-unauthorised' })
    expect(findings('no-declaration-in-a-complete-set').correction).toEqual({ status: 'none' })
    const supported = await runVector(vector('error-declaration-by-another-issuer').input.claim, { ...vector('error-declaration-by-another-issuer').input.options, authority: [{ issuer: S.repairer.issuer, role: 'observer', passport_id: P.battery, answer: 'supported' }, { issuer: S.carrier.issuer, role: 'observer', passport_id: P.battery, answer: 'supported' }] })
    expect(supported.findings.correction.status).toBe('declared-in-error')
    const incomplete = await runVector(vector('no-declaration-in-a-complete-set').input.claim, { ...vector('no-declaration-in-a-complete-set').input.options, related: { claims: [], complete: false } })
    expect(incomplete.findings.correction).toMatchObject({ status: 'unknown', reasonCode: 'x-related-incomplete' })
  })
})

describe('signing, bytes and identity', () => {
  it('L05: an account and a signing key alone cannot issue a scoped observation', async () => {
    const claim = buildEpcisLifecycleClaim(input(S.maker, EVENTS.receiving, [bind(P.battery, 'epcList', ID.battery)]))
    const signer = { createSignature: vi.fn(S.maker.wallet.createSignature.bind(S.maker.wallet)) }
    await expect(signEpcisLifecycleClaim(claim, signer, { eventSchemaValidator: pinnedSchemaValidator, compareProduct: gs1Comparison })).rejects.toMatchObject({ code: 'authority-unavailable' })
    expect(signer.createSignature).not.toHaveBeenCalled()
  })

  it('L06: every declared passport needs affirmative event-time evidence, and a resolver failure never reaches the wallet', async () => {
    const claim = buildEpcisLifecycleClaim(input(S.maker, EVENTS.moduleInstalled, [
      bind(P.battery2, 'parentID', ID.battery2), bind(P.moduleC, 'childEPCs', ID.moduleC),
    ]))
    const policy = fixtureIssuancePolicy(S.maker)
    const signer = { createSignature: vi.fn(S.maker.wallet.createSignature.bind(S.maker.wallet)) }
    for (const failure of ['unsupported', 'unavailable', 'exception'] as const) {
      const authorityResolver = vi.fn((q: lifecycle.EpcisLifecycleAuthorityQuestion): lifecycle.EpcisLifecycleAuthorityAnswer => {
        expect(q).toMatchObject({ purpose: 'claim', issuer: S.maker.issuer, issuerKey: S.maker.identityKey, role: 'observer', eventId: claim.event.eventID, eventType: claim.event.type, eventTime: claim.event.eventTime, issuedAt: claim.issuedAt })
        if (q.passportId === P.battery2) return { status: 'supported' }
        if (failure === 'exception') throw new Error('the evidence provider is unavailable')
        return { status: failure }
      })
      await expect(signEpcisLifecycleClaim(claim, signer, { ...policy, authorityResolver })).rejects.toMatchObject({ code: failure === 'unsupported' ? 'authority-unconfirmed' : 'authority-unavailable' })
      expect(authorityResolver.mock.calls.map(([q]) => q.passportId)).toEqual([P.battery2, P.moduleC])
    }
    expect(signer.createSignature).not.toHaveBeenCalled()
    const signed = await signEpcisLifecycleClaim(claim, signer, policy)
    expect(signer.createSignature).toHaveBeenCalledTimes(1)
    expect((await verifyEpcisLifecycleClaim(text(signed), policy)).findings).toMatchObject({ signature: { status: 'pass' }, authority: { status: 'supported' } })
  })

  it('refuses deficient structure, product bindings and required semantics before asking the authority or wallet', async () => {
    const plain = buildEpcisLifecycleClaim(input(S.maker, EVENTS.receiving, [bind(P.battery, 'epcList', ID.battery)]))
    const extension = buildEpcisLifecycleClaim(input(S.recycler, EVENTS.shredding, [bind(P.moduleA, 'inputEPCList', ID.moduleA)], { requiredExtensions: [SHREDDING_RULE] }))
    const signer = { createSignature: vi.fn(S.maker.wallet.createSignature.bind(S.maker.wallet)) }
    const authorityResolver = vi.fn(() => ({ status: 'supported' as const }))
    const policy = { ...fixtureIssuancePolicy(S.maker), authorityResolver }
    await expect(signEpcisLifecycleClaim(plain, signer, { ...policy, eventSchemaValidator: undefined })).rejects.toMatchObject({ code: 'schema-unavailable' })
    await expect(signEpcisLifecycleClaim(plain, signer, { ...policy, compareProduct: () => ({ status: 'fail', reasonCode: 'subject-mismatch' }) })).rejects.toMatchObject({ code: 'subject-mismatch' })
    await expect(signEpcisLifecycleClaim(extension, signer, { ...policy, extensionRules: {} })).rejects.toMatchObject({ code: 'x-extension-rule-unavailable' })
    expect(authorityResolver).not.toHaveBeenCalled()
    expect(signer.createSignature).not.toHaveBeenCalled()
  })

  it('signs through the wallet under the lifecycle protocol and refuses a wallet that is not the issuer', async () => {
    const claim = buildEpcisLifecycleClaim(input(S.maker, EVENTS.receiving, [bind(P.battery, 'epcList', ID.battery)]))
    const signed = await signEpcisLifecycleClaim(claim, S.maker.wallet, fixtureIssuancePolicy(S.maker))
    expect(epcisLifecycleClaimId(signed)).toBe(`urn:sha256:${epcisLifecycleClaimDigest(signed)}`)
    expect(Utils.toUTF8(epcisLifecycleClaimBytes(signed))).toBe(text(signed))
    await expect(signEpcisLifecycleClaim(claim, S.carrier.wallet, fixtureIssuancePolicy(S.maker))).rejects.toThrow('signer does not match')
  })

  it('names the signing key by issuerKeyDid when the issuer is resolvable, and reports that its binding needs resolution', async () => {
    const signed = await signEpcisLifecycleClaim(buildEpcisLifecycleClaim(input(S.maker, EVENTS.receiving, [bind(P.battery, 'epcList', ID.battery)], { issuer: 'did:web:maker.example.org', issuerKeyDid: S.maker.issuer })), S.maker.wallet, fixtureIssuancePolicy(S.maker))
    const v = await verifyEpcisLifecycleClaim(text(signed))
    expect(v.findings.signature.status).toBe('pass')
    expect(v.identityBinding).toBe('requires-resolution')
  })

  it('dispatches by claimFormat: the native claim and the EPCIS claim each refuse the other', async () => {
    const native = JSON.parse(readFileSync(join(ROOT, 'fixtures/attestation-anchor-v1.json'), 'utf8'))
    expect(verifyLifecycleClaim(native.claim).signature).toBe('verified')
    const asEpcis = await verifyEpcisLifecycleClaim(JSON.stringify(native.claim))
    expect(asEpcis.findings.eventStructure.status).toBe('fail')
    const { c } = await lifecycleClaims()
    expect(verifyLifecycleClaim(c.receiving).signature).toBe('invalid')
  })

  it('never reads a historical native claim as its own, from the exact bytes that claim was anchored with', async () => {
    const fixture = JSON.parse(readFileSync(join(ROOT, 'fixtures/attestation-anchor-v1.json'), 'utf8')) as { representationHex: string }
    const asEpcis = await verifyEpcisLifecycleClaim(Utils.toArray(fixture.representationHex, 'hex'))
    expect(asEpcis.findings.eventStructure.status).toBe('fail')
    expect(asEpcis.findings.signature.status).toBe('unknown')
    expect(asEpcis.claim).toBeUndefined()
  })

  it('classifies identifier granularity from the GS1 grammar', () => {
    expect(epcisIdentifierGranularity(ID.battery)).toBe('instance')
    expect(epcisIdentifierGranularity(ID.cellLot)).toBe('class')
    expect(epcisIdentifierGranularity(`urn:epc:idpat:sgtin:9521234.054321.*`)).toBe('class')
    expect(epcisIdentifierGranularity(P.battery)).toBe('instance')
    expect(epcisIdentifierGranularity(P.battery.replace(/\/21\/.*$/, ''))).toBe('class')
    expect(epcisIdentifierGranularity('https://example.org/things/1')).toBe('undetermined')
  })

  it('refuses envelope members the format does not define', async () => {
    const { c } = await lifecycleClaims()
    expect(() => parseEpcisLifecycleClaim(Utils.toUTF8(epcisLifecycleClaimBytes(c.receiving)).replace('{"assertedRole"', '{"accountId":"x","assertedRole"'))).toThrow(/unsupported member accountId/)
    expect(() => assertEpcisLifecycleClaim({ ...buildEpcisLifecycleClaim(input(S.maker, EVENTS.receiving, [bind(P.battery, 'epcList', ID.battery)])), event: { ...EVENTS.receiving, dppPassport: 'x' } })).toThrow(/schema-invalid/)
  })
})

describe('anchoring and inclusion', () => {
  it('anchors once per bound passport with one digest and identifier, and proves inclusion against headers', async () => {
    const { c } = await lifecycleClaims()
    const scripts = await buildEpcisLifecycleAnchors(c.manufacturing, ANCHOR_SERVICE.identityKey, ANCHOR_SERVICE.wallet)
    const decoded = scripts.map((s) => decodeAttestationAnchor(s)!)
    expect(decoded.map((d) => d.subject)).toEqual([P.battery2, P.cell, P.moduleA, P.moduleB].sort())
    expect(new Set(decoded.map((d) => d.digest))).toEqual(new Set([epcisLifecycleClaimDigest(c.manufacturing)]))
    expect(new Set(decoded.map((d) => d.attestationId))).toEqual(new Set([epcisLifecycleClaimId(c.manufacturing)]))
    expect(decoded.every((d) => d.attestationType === 'TransformationEvent' && d.representation === EPCIS_LIFECYCLE_REPRESENTATION && d.mediaType === 'application/json')).toBe(true)
    expect(epcisLifecycleAnchorMetadata(c.manufacturing, ANCHOR_SERVICE.identityKey)).toHaveLength(4)

    const tx = new Transaction()
    for (const lockingScript of scripts) tx.addOutput({ lockingScript, satoshis: 1 })
    const roots: Record<number, string> = {}
    attachProof(tx, 900001, roots)
    const anchors = scripts.map((_, outputIndex) => ({ transaction: tx, outputIndex }))
    const held = await verifyEpcisLifecycleClaim(text(c.manufacturing), { anchors, chainTracker: mockTracker(roots) })
    expect(held.findings.anchorCommitment.status).toBe('pass')
    expect(held.findings.anchorCommitment.detail).toEqual({ coveredPassports: [P.battery2, P.cell, P.moduleA, P.moduleB].sort(), uncoveredPassports: [] })
    expect(held.findings.inclusion.status).toBe('pass')
    expect((await verifyEpcisLifecycleClaim(text(c.manufacturing), { anchors })).findings.inclusion).toMatchObject({ status: 'unknown', reasonCode: 'header-source-unavailable' })
    expect((await verifyEpcisLifecycleClaim(text(c.manufacturing), { anchors, chainTracker: mockTracker({ 900001: 'ff'.repeat(32) }) })).findings.inclusion).toMatchObject({ status: 'fail', reasonCode: 'proof-refuted' })
    const partial = await verifyEpcisLifecycleClaim(text(c.manufacturing), { anchors: anchors.slice(0, 1) })
    expect(partial.findings.anchorCommitment.detail).toEqual({ coveredPassports: [P.battery2], uncoveredPassports: [P.cell, P.moduleA, P.moduleB].sort() })
    // Another claim's anchors for the same passport do not commit to these bytes; anchors about passports the claim does not bind are no evidence for it.
    const shippingAnchors = (await buildEpcisLifecycleAnchors(c.shipping, ANCHOR_SERVICE.identityKey, ANCHOR_SERVICE.wallet)).map((lockingScript) => ({ lockingScript }))
    expect((await verifyEpcisLifecycleClaim(text(c.receiving), { anchors: shippingAnchors })).findings.anchorCommitment).toMatchObject({ status: 'fail', reasonCode: 'digest-mismatch' })
    const other = await verifyEpcisLifecycleClaim(text(c.receiving), { anchors })
    expect(other.findings.anchorCommitment).toMatchObject({ status: 'unknown', reasonCode: 'no-evidence' })
    expect(other.findings.inclusion).toMatchObject({ status: 'unknown', reasonCode: 'no-evidence' })
  })

  it('derives anchor metadata only from a claim whose signature holds', async () => {
    const { c } = await lifecycleClaims()
    expect(() => epcisLifecycleAnchorMetadata({ ...c.receiving, signature: c.shipping.signature }, ANCHOR_SERVICE.identityKey)).toThrow(/signature holds/)
  })
})

describe('the verification report', () => {
  it('compares the verified EPCIS lifecycle issuer with the independent subject expectation', async () => {
    const { c } = await lifecycleClaims()
    const evidence = { externalCredentials: [{ representation: EPCIS_LIFECYCLE_REPRESENTATION, mediaType: 'application/json', bytes: text(c.manufacturing) }] }
    const policy = { checkedAt: '2026-11-16T00:00:00Z', credentialVerifier: epcisLifecycleCredentialVerifierFor(optionsOf({ schema: true, comparison: 'gs1-digital-link' })) }
    for (const expectedIssuer of [S.maker.issuer, 'did:web:another-issuer.example']) {
      const report = await verifyPassportEvidence(evidence, { passportId: P.battery2, source: 'request-context', expectedIssuer }, policy)
      expect(report.checks.find(c => c.name === 'externalCredentialProof')?.status).toBe('pass')
      expect(report.checks.find(c => c.name === 'subjectBinding')).toMatchObject(
        expectedIssuer === S.maker.issuer ? { status: 'pass' } : { status: 'fail', reasonCode: 'issuer-mismatch' },
      )
    }
  })

  it('carries the findings under the frozen checks with their precise cause, and the report validates against its schema', async () => {
    const { c } = await lifecycleClaims()
    const scripts = await buildEpcisLifecycleAnchors(c.manufacturing, ANCHOR_SERVICE.identityKey, ANCHOR_SERVICE.wallet)
    const anchor = scripts[0]
    const options = optionsOf({ schema: true, comparison: 'gs1-digital-link', authority: [P.battery2, P.moduleA, P.moduleB].map((p) => ({ issuer: S.maker.issuer, role: 'observer', passport_id: p, answer: 'supported' as const })) })
    const report = await verifyPassportEvidence(
      { anchors: [{ lockingScript: anchor, securedBytes: text(c.manufacturing) }], externalCredentials: [{ representation: EPCIS_LIFECYCLE_REPRESENTATION, mediaType: 'application/json', bytes: text(c.manufacturing) }] },
      { passportId: P.battery2, source: 'request-context' },
      { checkedAt: '2026-11-16T00:00:00Z', credentialVerifier: epcisLifecycleCredentialVerifierFor(options), authority: { required: false, reason: 'not under test' } },
    )
    const byName = Object.fromEntries(report.checks.map((k) => [k.name, k]))
    expect(byName.anchorDigestAndMetadataBinding.status).toBe('pass')
    expect(byName.externalCredentialProof.status).toBe('pass')
    expect(byName.subjectBinding.status).toBe('pass')
    expect(byName.schema.status).toBe('pass')
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    ;(addFormats as unknown as (a: Ajv2020) => void)(ajv)
    const validate = ajv.compile(JSON.parse(readFileSync(join(ROOT, 'contracts/verification-report.schema.json'), 'utf8')))
    expect(validate(JSON.parse(JSON.stringify(report))), JSON.stringify(validate.errors)).toBe(true)

    const entries = await epcisLifecycleCredentialVerifierFor({})({ representation: EPCIS_LIFECYCLE_REPRESENTATION, bytes: Utils.toArray(text(c.manufacturing), 'utf8'), digest: '', checkedAt: '2026-11-16T00:00:00Z' })
    expect(entries.proof.status).toBe('pass')
    expect(entries.schema).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable' })
    expect(entries.authority).toMatchObject({ status: 'unknown', reasonCode: 'authority-unavailable' })
    expect(entries.subjects).toEqual([P.battery2, P.cell, P.moduleA, P.moduleB].sort())
    const other = await epcisLifecycleCredentialVerifierFor({})({ representation: 'epcis-event-vc@1', bytes: [], digest: '', checkedAt: '2026-11-16T00:00:00Z' })
    expect(other.proof).toMatchObject({ status: 'unknown', reasonCode: 'representation-unsupported' })
  })

  it('reads a claim bound to several passports from each of them when all of its anchors are supplied', async () => {
    const v = vector('transformation-event-manufacturing')
    const bound: string[] = v.expected.bound_passports
    expect(bound).toHaveLength(4)
    const evidence = { anchors: (v.input.options.anchors_hex as string[]).map((lockingScript) => ({ lockingScript, securedBytes: v.input.claim as string })) }
    const policy = { checkedAt: '2026-11-16T00:00:00Z', credentialVerifier: epcisLifecycleCredentialVerifierFor(optionsOf(v.input.options)), authority: { required: false, reason: 'not under test' } }
    const check = async (anchors: typeof evidence.anchors, passportId: string, name: string) => (await verifyPassportEvidence({ anchors }, { passportId, source: 'request-context' }, policy)).checks.find((k) => k.name === name)!
    // One anchor per bound passport (spec/epcis-lifecycle-claim.md section 8): the anchors for the other bound passports are no mismatch for the one being read.
    for (const passportId of bound) {
      expect((await check(evidence.anchors, passportId, 'anchorDigestAndMetadataBinding')).status, passportId).toBe('pass')
      expect(await check(evidence.anchors, passportId, 'subjectBinding'), passportId).toMatchObject({ status: 'pass', detail: { otherSubjects: bound.filter((p) => p !== passportId) } })
    }
    // A passport the claim does not bind is not read from it, whatever the anchors name.
    expect(await check(evidence.anchors, P.battery, 'subjectBinding')).toMatchObject({ status: 'fail', reasonCode: 'subject-mismatch' })
    // An anchor about a subject the claim does not bind is still a mismatch in the report.
    const stray = vector('anchor-about-unbound-subject')
    const withStray = (stray.input.options.anchors_hex as string[]).map((lockingScript) => ({ lockingScript, securedBytes: stray.input.claim as string }))
    expect(await check(withStray, P.battery2, 'subjectBinding')).toMatchObject({ status: 'fail', reasonCode: 'subject-mismatch' })
  })

  it('reports a declared-in-error claim as a failed status entry', async () => {
    const v = vector('error-declaration-itself')
    const entries = lifecycle.epcisLifecycleReportEntries(await runVector(v.input.claim, v.input.options))
    expect(entries.status).toMatchObject({ status: 'fail', reasonCode: 'x-declared-in-error' })
  })
})

describe('the parked module', () => {
  it('still exports the helpers that moved, as the same functions', () => {
    expect(parked.parseStrictJson).toBe(shared.parseStrictJson)
    expect(parked.canonicalEpcisIdentifier).toBe(shared.canonicalEpcisIdentifier)
    expect(parked.EpcisEventHashError).toBe(shared.EpcisEventHashError)
    expect(parked.EPCIS_CONTEXT_IRI).toBe(shared.EPCIS_CONTEXT_IRI)
  })

  it('is not exported from the package root, the claim entry point or the protocol package, and neither is the shared module', async () => {
    for (const root of [await import('../src/index.js'), await import('../src/epcis-lifecycle.js'), await import('@bsv/dpp-protocol')]) {
      expect('verifyEpcisEventCredential' in root).toBe(false)
      expect('parseStrictJson' in root).toBe(false)
      expect('canonicalEpcisIdentifier' in root).toBe(false)
    }
  })
})

describe('the parked module in the published archive', () => {
  it('is left out: the package lists its build output without the parked folder, which no entry point loads', () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { files: string[]; exports: Record<string, unknown> }
    expect(manifest.files).toContain('dist')
    expect(manifest.files).toContain('!dist/parked')
    expect(JSON.stringify(manifest.exports)).not.toContain('parked')
  })
})

describe('where the claim sits in the package', () => {
  const src = join(import.meta.dirname, '..', 'src')
  const specifiers = (file: string): string[] => [...readFileSync(join(src, file), 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!)

  it('is the only code that imports the protocol package or the SDK, so every other entry point loads neither', () => {
    const files = (readdirSync(src, { recursive: true }) as string[]).map((f) => f.split('\\').join('/')).filter((f) => f.endsWith('.ts')).sort()
    const importing = files.filter((file) => specifiers(file).some((s) => s.startsWith('@bsv/')))
    expect(importing).toEqual(['epcis-lifecycle/claim.ts', 'epcis-lifecycle/jcs.ts', 'epcis-lifecycle/shared.ts', 'parked/epcis-event.ts'])
    // Nothing outside the claim's own folder and the parked module imports from either.
    const reaching = files.filter((file) => !/^(epcis-lifecycle|parked)\//.test(file) && specifiers(file).some((s) => /epcis-lifecycle|parked\//.test(s)))
    expect(reaching).toEqual(['epcis-lifecycle.ts'])
  })

  it('takes the anchor, the key helpers and the report types from the protocol package and restates none of them', () => {
    const claim = readFileSync(join(src, 'epcis-lifecycle', 'claim.ts'), 'utf8')
    for (const name of ['buildAttestationAnchor', 'decodeAttestationAnchor', 'compareCodePoints', 'identityKeyFromDidKey']) {
      expect(claim, name).toMatch(new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from '@bsv/dpp-protocol'`))
      expect(claim, name).not.toMatch(new RegExp(`(function|const) ${name}\\b`))
    }
  })

  it('exports every name the claim and its canonical JSON define, and no helper of the shared module', async () => {
    const entry = Object.keys(await import('../src/epcis-lifecycle.js')).sort()
    const defined = [...Object.keys(lifecycle), ...Object.keys(await import('../src/epcis-lifecycle/jcs.js'))].sort()
    expect(entry).toEqual(defined)
    expect(entry).toEqual(expect.arrayContaining(['buildEpcisLifecycleClaim', 'verifyEpcisLifecycleClaim', 'epcisLifecycleCredentialVerifierFor', 'jcsBytes', 'parseCanonicalJcs']))
    for (const name of Object.keys(shared)) expect(entry, name).not.toContain(name)
  })
})

describe('an extension rule the verifier holds', () => {
  it('is one the caller supplied itself: a rule that is only inherited is not held', async () => {
    const signed = await issue(S.recycler, input(S.recycler, EVENTS.shredding, [bind(P.moduleA, 'inputEPCList', ID.moduleA), bind(P.moduleC, 'inputEPCList', ID.moduleC)], { requiredExtensions: [SHREDDING_RULE] }))
    const rule = (): { status: 'pass' } => ({ status: 'pass' })
    const own = await verifyEpcisLifecycleClaim(text(signed), { extensionRules: { [SHREDDING_RULE]: rule } })
    expect(own.findings.eventSemantics).toMatchObject({ status: 'pass' })
    const inherited = await verifyEpcisLifecycleClaim(text(signed), { extensionRules: Object.create({ [SHREDDING_RULE]: rule }) as Record<string, typeof rule> })
    expect(inherited.findings.eventSemantics).toMatchObject({ status: 'unavailable', reasonCode: 'x-extension-rule-unavailable' })
  })
})

describe('a claim that does not verify', () => {
  it('names no item participant, in its verification or in the report, when its signature or its structure fails', async () => {
    for (const id of ['altered-secured-bytes', 'altered-context-digest', 'event-id-missing']) {
      const v = await runVector(vector(id).input.claim, vector(id).input.options)
      expect(v.bindings.some((b) => b.level === 'instance' && b.status === 'pass'), id).toBe(true)
      expect(v.itemParticipants, id).toEqual([])
      expect((lifecycle.epcisLifecycleReportEntries(v).schema.detail as any).itemParticipants, id).toEqual([])
    }
    for (const v of published.vectors) if (v.expected.findings != null && (v.expected.findings.signature.status !== 'pass' || v.expected.findings.event_structure.status === 'fail')) expect(v.expected.item_participants, v.id).toEqual([])
    // A structure that is only unknown, because no schema was supplied, takes no participant away.
    const { c } = await lifecycleClaims()
    const unchecked = await verifyEpcisLifecycleClaim(text(c.commissioning), { compareProduct: gs1Comparison })
    expect(unchecked.findings.eventStructure).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable' })
    expect(unchecked.itemParticipants).toEqual([P.battery])
  })
})

describe('an error declaration by a claim that is not sound', () => {
  it('declares nothing in error, and leaves the state unknown, never none', async () => {
    const { c, n } = await lifecycleClaims()
    const options = optionsOf({ schema: true, comparison: 'gs1-digital-link', authority: [S.repairer, S.carrier].map((s) => ({ issuer: s.issuer, role: 'observer', passport_id: P.battery, answer: 'supported' as const })) })
    const declaring = await verifyEpcisLifecycleClaim(text(n.malformedDeclaration), options)
    expect(declaring.findings).toMatchObject({ signature: { status: 'pass' }, eventStructure: { status: 'fail', reasonCode: 'schema-invalid' } })
    expect(declaring.findings.correction).toMatchObject({ status: 'unknown', reasonCode: 'x-declaration-unsound' })
    const v = await verifyEpcisLifecycleClaim(text(c.inspection), { ...options, related: { claims: [text(n.malformedDeclaration)], complete: true } })
    expect(v.relations).toEqual([{ digest: declaring.digest, relation: 'error-declaration' }])
    expect(v.findings.correction).toMatchObject({ status: 'unknown', reasonCode: 'x-declaration-unsound' })
    expect(lifecycle.epcisLifecycleReportEntries(v).status).toMatchObject({ status: 'unknown', reasonCode: 'x-declaration-unsound' })
    expect(findings('error-declaration-by-unsound-claim').correction).toEqual({ status: 'unknown', reason_code: 'x-declaration-unsound' })
    // Another issuer's unsound declaration counts no more, even when the resolver supports that issuer.
    const other = await signUnchecked(S.carrier, unchecked(input(S.carrier, { ...EVENTS.inspection, errorDeclaration: { declarationTime: '2026-11-12T09:00:00.000Z', reason: 'never_happened' } }, [bind(P.battery, 'epcList', ID.battery)], { issuedAt: '2026-11-12T10:00:00.000Z' })))
    expect((await verifyEpcisLifecycleClaim(text(c.inspection), { ...options, related: { claims: [text(other)], complete: true } })).findings.correction).toMatchObject({ status: 'unknown', reasonCode: 'x-declaration-unsound' })
    const mismatchedSignature = text({ ...n.inspectionDeclaredInError, signature: c.inspection.signature })
    const unverified = await verifyEpcisLifecycleClaim(text(c.inspection), { ...options, related: { claims: [mismatchedSignature], complete: true } })
    expect(unverified.relations[0].relation).toBe('unverified')
    expect(unverified.findings.correction).toMatchObject({ status: 'unknown', reasonCode: 'x-declaration-unsound' })
    // A sound declaration beside it still counts.
    const both = await verifyEpcisLifecycleClaim(text(c.inspection), { ...options, related: { claims: [text(n.malformedDeclaration), text(n.inspectionDeclaredInError)], complete: true } })
    expect(both.findings.correction).toMatchObject({ status: 'declared-in-error', detail: { declaredBy: epcisLifecycleClaimId(n.inspectionDeclaredInError) } })
  })
})

describe('an extension term the claim lists no rule for', () => {
  it('leaves the semantics unavailable whatever the verifier holds, while extension members alone need no rule', async () => {
    const { n } = await lifecycleClaims()
    expect(n.shreddingWithoutRule.requiredExtensions).toBeUndefined()
    const v = await verifyEpcisLifecycleClaim(text(n.shreddingWithoutRule), { extensionRules: { [SHREDDING_RULE]: () => ({ status: 'pass' }) } })
    expect(v.terms).toContainEqual({ path: 'event.bizStep', value: SHREDDING_STEP, kind: 'extension' })
    expect(v.findings.eventSemantics).toMatchObject({ status: 'unavailable', reasonCode: 'x-extension-rule-unavailable' })
    expect(lifecycle.epcisLifecycleReportEntries(v).schema.status).not.toBe('pass')
    expect(findings('extension-term-without-rule').event_semantics).toEqual({ status: 'unavailable', reason_code: 'x-extension-rule-unavailable' })
    expect(vector('object-event-commissioning').expected.extensions).toHaveLength(2)
    expect(findings('object-event-commissioning').event_semantics).toEqual({ status: 'pass' })
  })
})

describe('anchors that name other subjects', () => {
  it('judges each passport on the anchors that name it, and sets aside an anchor about a subject the claim does not bind', async () => {
    const { c } = await lifecycleClaims()
    const bound = [P.battery2, P.cell, P.moduleA, P.moduleB].sort()
    const own = (await buildEpcisLifecycleAnchors(c.manufacturing, ANCHOR_SERVICE.identityKey, ANCHOR_SERVICE.wallet)).map((lockingScript) => ({ lockingScript }))
    const metadata = epcisLifecycleAnchorMetadata(c.manufacturing, SECOND_ANCHOR_SERVICE.identityKey)
    const stray = { lockingScript: await buildAttestationAnchor({ ...metadata[0]!, subject: P.battery }, SECOND_ANCHOR_SERVICE.wallet) }
    const wrongType = { lockingScript: await buildAttestationAnchor({ ...metadata.find((m) => m.subject === P.moduleA)!, attestationType: 'ObjectEvent' }, SECOND_ANCHOR_SERVICE.wallet) }
    const read = async (anchors: Array<{ lockingScript: unknown }>, passportId?: string) => (await verifyEpcisLifecycleClaim(text(c.manufacturing), { anchors: anchors as any, ...(passportId == null ? {} : { expected: { passportId } }) })).findings.anchorCommitment

    // A stray anchor about an unbound subject changes nothing for the bound passports.
    expect(await read([...own, stray])).toEqual({ status: 'pass', detail: { coveredPassports: bound, uncoveredPassports: [], otherSubjects: [P.battery] } })
    for (const passportId of bound) expect((await read([...own, stray], passportId)).status, passportId).toBe('pass')
    // On its own it is no evidence for any bound passport.
    expect(await read([stray])).toMatchObject({ status: 'unknown', reasonCode: 'no-evidence' })
    // Read from the subject it names, it is an anchor whose subject the claim does not bind.
    expect(await read([...own, stray], P.battery)).toMatchObject({ status: 'fail', reasonCode: 'metadata-mismatch', detail: { subject: P.battery, mismatches: ['subject'] } })

    // A mismatch on an anchor that names a bound passport fails that passport, and no other.
    expect(await read([...own, wrongType])).toMatchObject({ status: 'fail', reasonCode: 'metadata-mismatch', detail: { subject: P.moduleA, mismatches: ['attestationType'] } })
    expect(await read([...own, wrongType], P.moduleA)).toMatchObject({ status: 'fail', reasonCode: 'metadata-mismatch' })
    expect((await read([...own, wrongType], P.battery2)).status).toBe('pass')
    // A passport no supplied anchor names has no anchor evidence, whatever the others have.
    expect(await read(own.slice(0, 1), P.moduleA)).toMatchObject({ status: 'unknown', reasonCode: 'no-evidence' })

    expect(findings('anchor-about-unbound-subject').anchor_commitment).toEqual({ status: 'pass' })
    expect(findings('anchor-about-unbound-subject-read-from-it')).toMatchObject({ product_binding: { status: 'fail', reason_code: 'subject-mismatch' }, anchor_commitment: { status: 'fail', reason_code: 'metadata-mismatch' } })
    expect(findings('anchor-mismatch-on-bound-passport').anchor_commitment).toEqual({ status: 'fail', reason_code: 'metadata-mismatch' })
    expect(findings('anchor-mismatch-on-another-bound-passport').anchor_commitment).toEqual({ status: 'pass' })
  })
})

describe('a second signer in another wallet', () => {
  it('produces the same bytes from the same scalar, because signatures are deterministic', async () => {
    const again = new ProtoWallet(PrivateKey.fromHex(S.recycler.scalar))
    const claim = buildEpcisLifecycleClaim(input(S.recycler, EVENTS.shredding, [bind(P.moduleA, 'inputEPCList', ID.moduleA), bind(P.moduleC, 'inputEPCList', ID.moduleC)], { requiredExtensions: [SHREDDING_RULE] }))
    const a = await signEpcisLifecycleClaim(claim, again, fixtureIssuancePolicy(S.recycler))
    const b = await issue(S.recycler, input(S.recycler, EVENTS.shredding, [bind(P.moduleA, 'inputEPCList', ID.moduleA), bind(P.moduleC, 'inputEPCList', ID.moduleC)], { requiredExtensions: [SHREDDING_RULE] }))
    expect(text(a)).toBe(text(b))
    expect(gs1Comparison({ passportId: P.moduleA, identifier: ID.moduleA, field: 'inputEPCList', level: 'instance', eventType: 'TransformationEvent' }).status).toBe('pass')
  })
})
