import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { verifyPassportEvidence, type EvidenceReport } from '@bsv/dpp-protocol'
import { idKey, makeData, serverPriv, signedState, stateTx } from '../../dpp-protocol/test/helpers.js'
import { bindingPayloadValidator, createProfileRegistry, profileBindingDigest, type BindingArtefact, type BindingValidationDetail, type ProfileRegistry, type ValidationEngines } from '../src/index.js'
import { createValidationEngine } from '../src/validation-engine.js'

// The validator in the place a verifier uses it: as `payloadValidator` in the
// evidence policy of `verifyPassportEvidence` (spec/verification.md section 4,
// `schema`). The report hands it the passport identifier of each decoded
// state, which is what lets the identity rules run at all.
const repo = join(import.meta.dirname, '..', '..', '..')
const folder = join(repo, 'examples', 'custom-profile', 'example-bottle@1')
const bindingBytes = new Uint8Array(readFileSync(join(folder, 'binding.json')))
const vector = JSON.parse(readFileSync(join(folder, 'vectors', 'item.json'), 'utf8')) as { passportId: string; payload: Record<string, unknown> }
const payloadPublic = JSON.stringify(vector.payload)

const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
const validateReport = ajv.compile(JSON.parse(readFileSync(join(repo, 'contracts', 'verification-report.schema.json'), 'utf8')) as Record<string, unknown>)

let registry: ProfileRegistry
let engines: ValidationEngines
beforeAll(async () => {
  registry = createProfileRegistry({ trustedBindingDigests: [profileBindingDigest(bindingBytes)] })
  const registered = await registry.register({ bindingBytes, resolveArtefact: (artefact: BindingArtefact) => new Uint8Array(readFileSync(join(folder, artefact.path))) })
  expect(registered.ok).toBe(true)
  engines = { jsonSchema: ajv, ...(await createValidationEngine()) }
})

/** A one-state history whose state names `passportId` and carries the example payload. */
async function report(passportId: string, given: ValidationEngines = engines): Promise<EvidenceReport> {
  const state = await signedState(makeData({ passportId, payloadPublic }))
  return await verifyPassportEvidence(
    { tokenHistory: [stateTx(state, serverPriv.toPublicKey())] },
    { passportId, source: 'request-context' },
    { publisherKeys: [idKey(serverPriv)], chainTracker: 'scripts only', checkedAt: '2026-11-14T00:00:00Z', payloadValidator: bindingPayloadValidator({ registry, engines: given }) },
  )
}
const schemaCheck = (r: EvidenceReport) => r.checks.find((c) => c.name === 'schema')!
const detailOf = (r: EvidenceReport): BindingValidationDetail => (schemaCheck(r).detail as BindingValidationDetail[])[0]!

describe('bindingPayloadValidator inside a verification report', () => {
  it('passes `schema` for a payload carried by the passport its product document names', async () => {
    const r = await report(vector.passportId)
    expect(schemaCheck(r)).toMatchObject({ name: 'schema', status: 'pass' })
    expect(detailOf(r).steps.map((s) => [s.step, s.status])).toEqual([['envelope', 'pass'], ['binding', 'pass'], ['json-schema', 'pass'], ['json-ld-expand', 'pass'], ['shacl', 'pass'], ['passport-identity', 'pass']])
    expect(validateReport(r), JSON.stringify(validateReport.errors)).toBe(true)
  })

  it('fails `schema` when the same valid payload sits in another passport\'s state', async () => {
    const r = await report(vector.passportId.replace('BTL-0001', 'BTL-0002'))
    expect(schemaCheck(r)).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid' })
    expect(detailOf(r)).toMatchObject({ profile: 'example-bottle@1', cause: 'product-identity-mismatch' })
    expect(validateReport(r), JSON.stringify(validateReport.errors)).toBe(true)
  })

  it('answers `schema` unknown, with a reason code the report schema accepts, when the engines are missing', async () => {
    const r = await report(vector.passportId, { jsonSchema: ajv })
    expect(schemaCheck(r)).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable' })
    expect(detailOf(r).cause).toBe('validator-unavailable')
    expect(validateReport(r), JSON.stringify(validateReport.errors)).toBe(true)
  })
})
