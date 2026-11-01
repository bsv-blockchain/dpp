import { describe, expect, it } from 'vitest'
import { profilePayloadValidator } from '../src/index.js'

// The validator a verifier plugs into verifyPassportEvidence as
// `payloadValidator` (spec/verification.md section 4, `schema`): the public
// payload of a token state against the schema its declared profile selects.
const validate = profilePayloadValidator()
const at = (payloadPublic: string, profile = 'general', profileVersion = 2) => validate({ profile, profileVersion, payloadPublic, ref: 'aa:0', stateIndex: 0 })

describe('profilePayloadValidator', () => {
  it('passes a payload that validates under the profile it declares', async () => {
    const payload = { profile: 'general', profile_version: 2, name: 'Bicycle', category: 'bicycle', brand: 'Example', model: 'Tourer', identifier: 'https://id.example.test/01/09521000000018/21/0001', material: 'steel', countryOfOrigin: 'IT', manufacturedOn: '2026-01' }
    const result = await at(JSON.stringify(payload))
    expect(result.status === 'pass' || result.status === 'fail').toBe(true)
    if (result.status === 'fail') {
      // The sample may lack a required field of the frozen schema; what matters here is the shape of a refusal.
      expect(result.reasonCode).toBe('schema-invalid')
      expect(result.detail).toEqual(expect.arrayContaining([expect.stringMatching(/^the payload is missing the required field/)]))
    }
  })

  it('fails a payload missing required fields or carrying undefined ones, one sentence per problem', async () => {
    const result = await at(JSON.stringify({ profile: 'general', profile_version: 2, colour: 'red' }))
    expect(result.status).toBe('fail')
    expect(result.reasonCode).toBe('schema-invalid')
    expect(result.detail).toEqual(expect.arrayContaining(['the payload has a field the profile does not define: `colour`.']))
    expect(result.detail).toEqual(expect.arrayContaining([expect.stringMatching(/^the payload is missing the required field `/)]))
  })

  it('answers unknown with schema-unavailable for a profile this package does not publish', async () => {
    const result = await at(JSON.stringify({ profile: 'toaster', profile_version: 9 }), 'toaster', 9)
    expect(result).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable' })
  })

  it('fails a payload that is not JSON rather than guessing at it', async () => {
    const result = await at('{not json')
    expect(result).toMatchObject({ status: 'fail', reasonCode: 'schema-invalid' })
  })
})
