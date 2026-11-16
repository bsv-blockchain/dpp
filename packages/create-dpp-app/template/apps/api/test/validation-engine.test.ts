// The validation engine is a setting. With no address the JSON-LD and SHACL
// libraries run in this process; with VALIDATOR_URL a validator service is
// asked instead. These tests run the same sector passport through both, and
// then take the service away: a stopped, unreachable or wrongly credentialled
// service must block a write exactly as missing libraries do, and must never
// read as a pass.
//
// The service here is the one @bsv/dpp-profiles ships, started in this
// process on the loopback address. It is the code the dpp-validator command
// and the validator image run.
import { once } from 'node:events'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startValidatorService, type ValidatorService } from '@bsv/dpp-profiles/validator-service'
import { loadConfig } from '../src/config.js'
import { openPlatform, type Platform } from '../src/platform.js'
import type { PassportReading } from '../src/reader.js'
import { sectorExamples } from '../src/sector-examples.js'
import { createServer } from '../src/server.js'
import { openValidationEngine, validationEngineSettings } from '../src/validation-engine.js'
import { WriteRefused } from '../src/writer.js'

type Json = Record<string, unknown>

/** The service's token. It is in no fixture: wherever it turns up, it was copied there. */
const TOKEN = 'VALIDATOR-TOKEN-CANARY-58C3A1E7'
const base = { NETWORK: 'main', PASSPORT_HOST: 'passports.example.com', GS1_PREFIX: '952', LIVE_PUBLISHING: 'false' }
const brandId = 'brand-engine-1'

let service: ValidatorService
let withService: Platform
let inProcess: Platform
let server: Server
let api: string
const lines: string[] = []

const exampleFor = (platform: Platform, profile: string, serial: string): { passportId: string; product: Json } => {
  const bound = platform.profiles.get(profile)!
  const example = sectorExamples(bound, { host: 'passports.example.com', prefix: '952' })[0]!
  const swap = (value: string): string => value.replaceAll(example.serial, serial)
  return { passportId: swap(example.passportId), product: JSON.parse(swap(JSON.stringify(example.product))) as Json }
}
const issue = async (platform: Platform, profile: string, serial: string) => {
  const { passportId, product } = exampleFor(platform, profile, serial)
  return await platform.writer.issue({ brandId, brand: platform.parties.brand(brandId), passportId, profile, product })
}
const refusal = async (attempt: Promise<unknown>): Promise<WriteRefused> => {
  try {
    await attempt
  } catch (cause) {
    if (cause instanceof WriteRefused) return cause
    throw cause
  }
  throw new Error('the write was not refused')
}
const get = async (path: string): Promise<any> => await (await fetch(`${api}${path}`)).json()

beforeAll(async () => {
  service = await startValidatorService({ token: TOKEN })
  withService = await openPlatform({ config: loadConfig({ ...base, VALIDATOR_URL: service.url, VALIDATOR_TOKEN: TOKEN }), mode: 'test', log: (line) => void lines.push(line) })
  inProcess = await openPlatform({ config: loadConfig(base), mode: 'test', log: () => {} })
  server = createServer({ platform: withService, devSession: { userId: 'developer', email: 'developer@localhost', name: 'Developer', brandIds: [brandId] } }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  server.closeAllConnections()
  server.close()
  await service.close().catch(() => undefined)
  await withService.close()
  await inProcess.close()
})

describe('the validation engine, by configuration', () => {
  it('reads the two settings and nothing else', () => {
    expect(validationEngineSettings({})).toEqual({})
    expect(validationEngineSettings({ VALIDATOR_URL: ' http://validator:8090 ', VALIDATOR_TOKEN: '' })).toEqual({ url: 'http://validator:8090' })
    expect(validationEngineSettings({ VALIDATOR_URL: 'http://validator:8090', VALIDATOR_TOKEN: 'token' })).toEqual({ url: 'http://validator:8090', token: 'token' })
  })

  it('runs in this process by default, and in the service when VALIDATOR_URL names one', async () => {
    expect(inProcess.profiles.engineKind).toBe('in-process')
    expect(inProcess.profiles.engineProblem).toBeUndefined()
    expect(withService.profiles.engineKind).toBe('service')
    expect(withService.profiles.engineProblem).toBeUndefined()
    // Start-up says which engine it reached, by its address, and never by its token.
    expect(lines.some((line) => line.startsWith(`Validation engine: the validator service at ${service.url}`))).toBe(true)
    expect(await get('/api/health')).toMatchObject({ validationEngine: true, validationEngineKind: 'service' })
    expect((await get('/api/profiles/eu-battery%401')).engine).toEqual({ available: true, kind: 'service' })
  })

  it('gives the same answers either way: a valid document is written and read as passing, an invalid one is refused for the same cause', async () => {
    for (const profile of ['eu-battery@1', 'eu-textile@1']) {
      const readings: PassportReading[] = []
      for (const [platform, mode] of [
        [inProcess, 'IN'],
        [withService, 'SV'],
      ] as const) {
        const written = await issue(platform, profile, `ENGINE-${mode}-0001`)
        expect(written.entry.index).toBe('admitted')
        readings.push(await platform.read(written.record.passportId))
      }
      const outcome = (reading: PassportReading) => reading.payloadChecks.map((check) => ({ status: check.publicView.status, cause: check.publicView.cause, steps: check.publicView.steps.map((step) => [step.step, step.status]), findings: check.publicView.findings.length, withheld: check.publicView.withheld }))
      expect(outcome(readings[0]!)[0]!.status).toBe('pass')
      expect(outcome(readings[1]!)).toEqual(outcome(readings[0]!))
      expect(readings[1]!.checks.map((check) => [check.name, check.status, check.reasonCode])).toEqual(readings[0]!.checks.map((check) => [check.name, check.status, check.reasonCode]))
    }
    // A document about another item fails the same rule in both, before anything is signed.
    const causes: unknown[] = []
    for (const platform of [inProcess, withService]) {
      const { product } = exampleFor(platform, 'eu-battery@1', 'ENGINE-OTHER-1')
      const { passportId } = exampleFor(platform, 'eu-battery@1', 'ENGINE-MINE-1')
      const refused = await refusal(platform.writer.issue({ brandId, brand: platform.parties.brand(brandId), passportId, profile: 'eu-battery@1', product }))
      causes.push([refused.code, refused.data?.cause])
      expect(await platform.store.getPassport(passportId)).toBeUndefined()
    }
    expect(causes).toEqual([
      ['product-invalid', 'product-identity-mismatch'],
      ['product-invalid', 'product-identity-mismatch'],
    ])
  })

  it('blocks a write and reads as not checked when the service is stopped, exactly as missing libraries do', async () => {
    const written = await issue(withService, 'eu-battery@1', 'ENGINE-STOP-0001')
    const port = service.port
    await service.close()

    // The same refusal, by the same code, as a deployment whose libraries did not load.
    const bare = await openPlatform({ config: loadConfig(base), mode: 'test', log: () => {}, loadEngineLibrary: async (name) => { throw new Error(`Cannot find package '${name}'`) } })
    try {
      const stopped = await refusal(issue(withService, 'eu-battery@1', 'ENGINE-STOP-0002'))
      const missing = await refusal(issue(bare, 'eu-battery@1', 'ENGINE-STOP-0002'))
      expect(stopped.code).toBe('product-not-validated')
      expect(missing.code).toBe('product-not-validated')
      expect(stopped.data?.cause).toBe(missing.data?.cause)
      // Each says what is wrong with its own engine, and neither says the other's.
      expect(stopped.message).toMatch(/The validation engine is not available: the validator service at http:\/\/127\.0\.0\.1:\d+ could not be reached/)
      expect(stopped.message).toMatch(/Start it, or correct VALIDATOR_URL and VALIDATOR_TOKEN/)
      expect(stopped.message).not.toMatch(/Install jsonld/)
      expect(missing.message).toMatch(/Install jsonld@9\.0\.0 n3@2\.13\.12 shacl-engine@1\.1\.3/)
      expect(stopped.message).not.toContain(TOKEN)
      const { passportId } = exampleFor(withService, 'eu-battery@1', 'ENGINE-STOP-0002')
      expect(await withService.store.getPassport(passportId)).toBeUndefined()
    } finally {
      await bare.close()
    }

    // A passport that read as passing is now not checked. Nothing that needs the engine passes without it.
    const reading = await withService.read(written.record.passportId)
    expect(reading.checks.find((check) => check.name === 'schema')).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable' })
    const view = reading.payloadChecks[0]!.publicView
    expect(view).toMatchObject({ status: 'not-checked', cause: 'validator-unavailable' })
    expect(view.summary).toMatch(/The validation engine is not available: the validator service at/)
    expect(view.summary).toMatch(/A check that could not run is not a pass\./)
    expect(view.steps.find((step) => step.step === 'passport-identity')?.status).toBe('pass')

    // The API says so wherever a person looks: the health answer, the form's profile and the operations page.
    expect(await get('/api/health')).toMatchObject({ validationEngine: false, validationEngineKind: 'service' })
    const described = (await get('/api/profiles/eu-battery%401')).engine
    expect(described).toMatchObject({ available: false, kind: 'service' })
    expect(described.problem).toMatch(/could not be reached/)
    expect(described.problem).not.toContain(TOKEN)
    expect((await get('/api/operations')).profiles.engine).toMatchObject({ available: false, kind: 'service' })

    // The service comes back at the same address. Nothing here is restarted: the next look finds it.
    service = await startValidatorService({ token: TOKEN, port })
    expect(await get('/api/health')).toMatchObject({ validationEngine: true })
    expect((await get('/api/profiles/eu-battery%401')).engine).toEqual({ available: true, kind: 'service' })
    expect((await issue(withService, 'eu-battery@1', 'ENGINE-STOP-0002')).entry.index).toBe('admitted')
    expect((await withService.read(written.record.passportId)).payloadChecks[0]!.publicView.status).toBe('pass')
  })

  it('treats a service that refuses the token, or that is not there at all, the same way', async () => {
    const wrong = await openValidationEngine({ url: service.url, token: 'not-the-token' })
    expect(wrong.kind).toBe('service')
    expect(wrong.problem).toMatch(/answered 401/)
    const expansion = await wrong.engines.jsonLd!.toRdf({ document: {}, contexts: [] })
    expect(expansion.ok).toBe(false)

    const nowhere = await openValidationEngine({ url: 'http://127.0.0.1:9' })
    expect(nowhere.problem).toMatch(/could not be reached/)
    const platform = await openPlatform({ config: loadConfig({ ...base, VALIDATOR_URL: 'http://127.0.0.1:9' }), mode: 'test', log: () => {} })
    try {
      expect(platform.profiles.list().map((profile) => profile.profile)).toEqual(['eu-battery@1', 'eu-textile@1'])
      expect((await refusal(issue(platform, 'eu-textile@1', 'ENGINE-NONE-0001'))).code).toBe('product-not-validated')
    } finally {
      await platform.close()
    }
    // Nothing that was logged or answered carries the token.
    expect(lines.join('\n')).not.toContain(TOKEN)
  })
})
