import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { EXCHANGE_PROFILE_IDS, OPERATOR_PROFILE_IDS, readExchangeProfile, readOperatorProfile } from '../src/index.js'

const root = join(import.meta.dirname, '..')
const read = (relative: string): object => JSON.parse(readFileSync(join(root, relative), 'utf8'))
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
addFormats(ajv)
const validateExchange = ajv.compile(read('schemas/exchange-profile.schema.json'))
const validateOperator = ajv.compile(read('schemas/operator-profile.schema.json'))
const validateExtension = ajv.compile(read('../../contracts/native-evidence-extension.schema.json'))

describe('the exchange and operator profile catalogue', () => {
  it.each(EXCHANGE_PROFILE_IDS)('%s validates against the exchange profile schema and never pins a digest it did not compute', (profile) => {
    const manifest = readExchangeProfile(profile) as { profile: string; artefacts: Array<{ retrieval: string; digest?: string }> }
    expect(validateExchange(manifest), JSON.stringify(validateExchange.errors)).toBe(true)
    expect(manifest.profile).toBe(profile)
    for (const artefact of manifest.artefacts) {
      if (artefact.retrieval === 'not-retrieved' || artefact.retrieval === 'unavailable') expect(artefact.digest, `${profile} ${JSON.stringify(artefact)}`).toBeUndefined()
      if (artefact.retrieval === 'pinned' || artefact.retrieval === 'owned') expect(artefact.digest).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('records the owned VSC artefacts with the digests the VSC package publishes', () => {
    const vsc = readExchangeProfile('vsc-draft-compat@0.1.0') as { artefacts: Array<{ id: string; digest?: string }> }
    const manifest = read('../vsc/artifacts/profile-0.1.0.json') as { artifactDigests: Record<string, string> }
    const digest = (id: string): string | undefined => vsc.artefacts.find((a) => a.id === id)?.digest
    expect(digest('owned-context')).toBe(manifest.artifactDigests['context-0.1.0.jsonld'])
    expect(digest('owned-seal-schema')).toBe(manifest.artifactDigests['seal-0.1.0.schema.json'])
    expect(digest('owned-disclosure-schema')).toBe(manifest.artifactDigests['disclosure-0.1.0.schema.json'])
  })

  it.each(OPERATOR_PROFILE_IDS)('%s validates against the operator profile schema', (profile) => {
    const manifest = readOperatorProfile(profile) as { profile: string; acceptance: Array<{ independence: string }> }
    expect(validateOperator(manifest), JSON.stringify(validateOperator.errors)).toBe(true)
    expect(manifest.profile).toBe(profile)
  })

  it('keeps the independently administered exercise separate from any local federation run', () => {
    const federated = readOperatorProfile('federated-operators@1') as { status: string; acceptance: Array<{ id: string; independence: string; evidence: string }> }
    expect(federated.status).toBe('proposed')
    const external = federated.acceptance.filter((a) => a.independence === 'independently-administered')
    expect(external).toHaveLength(1)
    expect(external[0].evidence).toMatch(/not yet run/)
  })

  it('validates a native evidence extension and refuses a circular or malformed one', () => {
    const good = {
      type: 'urn:bsv:dpp:native-evidence:1',
      passportId: 'https://id.gs1.org/01/09506000134352/21/JERSEY-001',
      state: { txid: 'ab'.repeat(32), outputIndex: 0, op: 'REPAIRED' },
      nativeClaim: { representation: 'dpp-lifecycle-json-v1', digest: 'cd'.repeat(32), eventType: 'Transformation' },
      anchor: { txid: 'ef'.repeat(32), outputIndex: 1, format: 'bsv-attestation-anchor-v1' },
      nativeProfile: { id: 'textile', version: 2 },
      mappingVersion: 'untp-0.7.0-jose@1',
      mappingResult: 'transformed',
      losses: ['the repair facility is not carried by the native claim'],
    }
    expect(validateExtension(good), JSON.stringify(validateExtension.errors)).toBe(true)
    expect(validateExtension({ ...good, type: 'urn:something:else' })).toBe(false)
    expect(validateExtension({ ...good, anchor: { ...good.anchor, format: 'uora-anchor-v3' } })).toBe(false)
    expect(validateExtension({ ...good, selfDigest: 'ab'.repeat(32) })).toBe(false)
    const { nativeProfile: _p, ...withoutProfile } = good
    expect(validateExtension(withoutProfile)).toBe(false)
  })
})
