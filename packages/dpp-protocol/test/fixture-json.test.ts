import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Hash, PrivateKey, ProtoWallet, Utils } from '@bsv/sdk'
import { buildAttestationAnchor, canonicalBytes, canonicalString, inspectManagedAcceptance, lifecycleClaimBytes, signLifecycleClaim, verifyPassportEvidence } from '../src/index.js'
import { RECORD_V1_FIXTURE } from './record-v1-fixture.js'
import { CHAIN_V1_FIXTURE } from './chain-v1-fixture.js'
import { evidenceV1Fixture } from './evidence-v1-fixture.js'
import { publisherPolicyVectors } from './publisher-policy-vectors.js'
import { evidencePackageVectors } from './evidence-package-vectors.js'
import { recordV2Fixture } from './record-v2-fixture.js'
import { chainV2Fixture } from './chain-v2-fixture.js'
import { managedAcceptanceV2Fixture } from './managed-acceptance-v2-fixture.js'
import { evidenceV2Fixture } from './evidence-v2-fixture.js'
import { indexRegistrationV1Fixture } from './index-registration-v1-fixture.js'

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures')

/**
 * The files in fixtures/ are served to implementations that cannot import this
 * package, and the contract of each is that it is its generating module,
 * verbatim. This is the enforcement: regenerating the module without
 * regenerating the JSON, or editing the JSON by hand, goes red with a diff.
 *
 * REGENERATE_FIXTURES=1 rewrites the published file from its generator before
 * comparing, so the one way to change a published fixture is to change the
 * module and review the diff (fixtures/README.md, "Two forms, one per format").
 */
function expectPublished(relative: string, generated: unknown): void {
  const path = join(FIXTURES, ...relative.split('/'))
  const canonical = JSON.parse(JSON.stringify(generated))
  if (process.env.REGENERATE_FIXTURES === '1') {
    writeFileSync(path, JSON.stringify(canonical, null, 2) + '\n')
  }
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(canonical)
}

type VectorFile = Record<string, unknown> & { id: string; vectors: Array<Record<string, unknown> & { id: string }> }

/**
 * The stack's structural runner is an external checkout CI cannot run, so the
 * shape it validates is checked here: the envelope, one identifier per vector,
 * the four required properties, and lower-case hex under every key ending in
 * _hex, whether a string or a list of them.
 */
function expectStackShape(file: VectorFile): void {
  for (const key of ['id', 'name', 'version', 'reference_impl', 'parity_class', 'vectors']) {
    expect(file).toHaveProperty(key)
  }
  expect(file.id).toMatch(/^[a-z0-9]+(\.[a-z0-9]+)+$/)
  const ids = file.vectors.map((v) => v.id)
  expect(new Set(ids).size).toBe(ids.length)
  const hexOnly = (value: unknown, path: string): void => {
    if (typeof value === 'string') expect(value, path).toMatch(/^[0-9a-f]*$/)
    else if (Array.isArray(value)) value.forEach((v, i) => hexOnly(v, `${path}[${i}]`))
    else expect.fail(`${path} is neither a hex string nor a list of them`)
  }
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${path}[${i}]`))
    if (value == null || typeof value !== 'object') return
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.endsWith('_hex')) hexOnly(v, `${path}.${k}`)
      else walk(v, `${path}.${k}`)
    }
  }
  for (const v of file.vectors) {
    for (const key of ['id', 'description', 'input', 'expected']) expect(v).toHaveProperty(key)
    expect(v.id).toMatch(/^[a-z0-9-]+$/)
    walk(v, v.id)
  }
}

describe('the published fixture files', () => {
  it('record-v1.json is record-v1-fixture.ts, verbatim', () => {
    expectPublished('record-v1.json', RECORD_V1_FIXTURE)
  })

  it('chain-v1.json is chain-v1-fixture.ts, verbatim', () => {
    expectPublished('chain-v1.json', CHAIN_V1_FIXTURE)
  })

  it('evidence-v1.json is evidenceV1Fixture(), verbatim: the report every surface produces for each case', async () => {
    const generated = await evidenceV1Fixture()
    expect(generated.cases.map((c) => c.id)).toEqual([...new Set(generated.cases.map((c) => c.id))])
    for (const c of generated.cases.filter((c) => !c.skip)) {
      expect(c.report.checkedAt).toBe(generated.checkedAt)
      expect(c.report.limits, c.id).toContain('A credential status observation is only as fresh as its source.')
    }
    const historical = generated.cases.filter((c) => c.skip)
    expect(historical).toHaveLength(1)
    const { skip, skip_reason, ...published } = historical[0]!
    expect(skip).toBe(true)
    expect(skip_reason).toContain('anchor-supplied-bytes-digest-mismatch')
    expect(Utils.toHex(Hash.sha256(Utils.toArray(JSON.stringify(published), 'utf8')))).toBe('9bfc8aaa45239cdfa235a7cf00ddf76318164fb68b547bcece9a9c3b784ea688')
    expect(generated.cases.at(-1)).toMatchObject({ id: 'anchor-supplied-bytes-digest-mismatch', evidence: published.evidence })
    expectPublished('evidence-v1.json', generated)
  })

  it('publishes native anchor binding cases that distinguish source bytes, the identifier and the signature', async () => {
    const fixture = JSON.parse(readFileSync(join(FIXTURES, 'attestation-anchor-v1.json'), 'utf8'))
    const signer = new ProtoWallet(PrivateKey.fromHex(fixture.anchoringPrivateKey))
    const state = JSON.parse(readFileSync(join(FIXTURES, 'chain-v2.json'), 'utf8')).states[0]
    const passportId = state.data.passportId
    const claim = await signLifecycleClaim({
      ...fixture.unsignedClaim, passportId, recordId: state.txid + ':' + state.outputIndex,
      timestamp: state.data.timestamp,
    }, new ProtoWallet(PrivateKey.fromHex(fixture.issuerPrivateKey)))
    const canonical = Utils.toUTF8(lifecycleClaimBytes(claim))
    const cases = [
      { id: 'canonical-native-claim', description: 'The native identifier and the committed bytes both match the signed claim.', bytes: canonical, binding: 'pass' },
      { id: 'generic-identifier-on-native-claim', description: 'A valid service signature commits to the native claim using a different identifier.', bytes: canonical, attestationId: 'urn:uuid:b4a841db-611e-49e7-8f1e-ba20e5b9fd45', binding: 'fail', reason: 'metadata-mismatch' },
      { id: 'formatted-json-native-claim', description: 'The anchor commits to formatted JSON. The supplied bytes match the digest but are outside the native canonical representation.', bytes: JSON.stringify(claim, null, 2), binding: 'fail', reason: 'decode-failed' },
    ]
    const vectors = []
    for (const entry of cases) {
      const bytes = Utils.toArray(entry.bytes, 'utf8')
      const digest = Utils.toHex(Hash.sha256(bytes))
      const script = await buildAttestationAnchor({ ...fixture.anchor, subject: passportId, digest, attestationId: entry.attestationId ?? `urn:sha256:${digest}` }, signer)
      const expected = {
        nativeAttestationSignature: { status: 'unknown', reasonCode: 'no-evidence' },
        anchorSignature: { status: 'pass' },
        anchorDigestAndMetadataBinding: { status: entry.binding, ...(entry.reason == null ? {} : { reasonCode: entry.reason }) },
        evidenceAvailability: { status: 'pass' },
      }
      const input = { locking_script_hex: script.toHex(), secured_bytes_hex: Utils.toHex(bytes), passport_id: passportId, checked_at: '2026-09-07T12:00:00Z' }
      const report = await verifyPassportEvidence(
        { anchors: [{ lockingScript: script, securedBytes: bytes }] },
        { passportId, source: 'request-context' },
        { checkedAt: input.checked_at },
      )
      for (const [name, result] of Object.entries(expected)) {
        const check = report.checks.find((check) => check.name === name)
        expect(check?.status).toBe(result.status)
        expect(check?.reasonCode).toBe('reasonCode' in result ? result.reasonCode : undefined)
      }
      vectors.push({ id: entry.id, description: entry.description, input, expected, tags: [entry.binding === 'pass' ? 'happy-path' : 'error-case'] })
    }
    const generated = { $schema: 'https://raw.githubusercontent.com/bsv-blockchain/ts-stack/main/conformance/schema/vector.schema.json', id: 'dpp.nativeanchorbinding.v1', name: 'Native claim representation and anchor binding', version: '1.0.0', reference_impl: '@bsv/dpp-protocol', parity_class: 'required', brc: ['BRC-42', 'BRC-43', 'BRC-48'], vectors }
    expectStackShape(generated)
    expectPublished('vectors/dpp/attestation-anchor/native-binding-v1.json', generated)
  })

  it('vectors/dpp/publisher-policy/v1.json is publisherPolicyVectors(), verbatim, and shaped as the stack expects', () => {
    const generated = publisherPolicyVectors()
    expectPublished('vectors/dpp/publisher-policy/v1.json', generated)
    expectStackShape(generated as never)
  })

  it('vectors/dpp/evidence-package/v1.json is evidencePackageVectors(), verbatim, and shaped as the stack expects', async () => {
    const generated = await evidencePackageVectors()
    expectPublished('vectors/dpp/evidence-package/v1.json', generated)
    expectStackShape(generated as never)
  })

  it('record-v2.json is recordV2Fixture(), verbatim', async () => {
    expectPublished('record-v2.json', await recordV2Fixture())
  })

  it('chain-v2.json is chainV2Fixture(), verbatim', async () => {
    expectPublished('chain-v2.json', await chainV2Fixture())
  })

  it('managed-acceptance-v1.json is frozen: the superseded format, read under its own rule and never regenerated', () => {
    // No generator: nothing writes dpp-managed-acceptance@1 any more, and the
    // published bytes are the pin of what a reader must still verify (§9).
    const published = JSON.parse(readFileSync(join(FIXTURES, 'managed-acceptance-v1.json'), 'utf8'))
    expect(published.record.acceptanceFormat).toBe('dpp-managed-acceptance@1')
    expect(inspectManagedAcceptance(published.record)).toMatchObject({ structureValid: true, signatureValid: true, commitment: published.commitment, failures: [] })
  })

  it('managed-acceptance-v2.json is managedAcceptanceV2Fixture(), verbatim', async () => {
    expectPublished('managed-acceptance-v2.json', await managedAcceptanceV2Fixture())
  })

  it('evidence-v2.json is evidenceV2Fixture(), verbatim: the report every surface produces for each version 2 case', async () => {
    const generated = await evidenceV2Fixture()
    expect(generated.cases.map((c) => c.id)).toEqual([...new Set(generated.cases.map((c) => c.id))])
    for (const c of generated.cases) {
      expect(c.report.checkedAt).toBe(generated.checkedAt)
      expect(c.report.limits, c.id).toContain('A credential status observation is only as fresh as its source.')
    }
    expectPublished('evidence-v2.json', generated)
  })

  it('anchor-v3.json canonical bytes and digest are what this package computes', () => {
    const F = JSON.parse(readFileSync(join(FIXTURES, 'anchor-v3.json'), 'utf8'))
    expect(canonicalString(F.attestation)).toBe(F.canonical)
    expect(Utils.toHex(Hash.sha256(canonicalBytes(F.attestation)))).toBe(F.digest)
  })

  it('index-registration-v1.json is indexRegistrationV1Fixture(), verbatim', async () => {
    expectPublished('index-registration-v1.json', await indexRegistrationV1Fixture())
  })
})
