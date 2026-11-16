import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import * as api from '../src/index.js'
import type { BindingValidationDetail, PayloadValidation, ValidationEngines } from '../src/index.js'
import { createValidationEngine } from '../src/validation-engine.js'
import { createValidatorClient } from '../src/validator-client.js'
import { startValidatorService, type ValidatorService } from '../src/validator-service.js'
// @ts-expect-error a plain JavaScript module shared with scripts/validator-parity.mjs
import { decisionOf, expectationProblems, runVectors, validatorVectors } from './validator-vectors.mjs'

// One list of vectors, run with the engine in four places. The engine in this
// process is the reference. A validator service is the same engine only if a
// client of it gives the same answer for every vector, sentence for sentence.
// The image is held to the same list by scripts/validator-image-check.mjs.
const packageRoot = join(import.meta.dirname, '..')
const repo = join(packageRoot, '..', '..')

interface Vector { name: string; expected: { status?: string; cause?: string; step?: string; constraint?: string }; sparqlOnly: boolean; run: (engines: ValidationEngines) => Promise<PayloadValidation> }
interface Run { name: string; result: PayloadValidation }
const compiler = () => { const ajv = new Ajv2020({ allErrors: true, strict: false }); addFormats(ajv); return ajv }
const stepsOf = (result: PayloadValidation): BindingValidationDetail['steps'] => (result.detail as BindingValidationDetail).steps ?? []
const usesEngine = (result: PayloadValidation): boolean => stepsOf(result).some((s) => s.step === 'json-ld-expand' || s.step === 'shacl')

let vectors: Vector[]
let reference: Run[]
let networkAttempts = 0
const realFetch = globalThis.fetch

beforeAll(async () => {
  vectors = await validatorVectors({ api, repo, compiler })
  // The engine in this process needs no network. Any attempt while it runs is counted, and fails.
  globalThis.fetch = (async () => { networkAttempts += 1; throw new Error('the network is off while the reference runs') }) as typeof fetch
  try {
    reference = await runVectors(vectors, await createValidationEngine())
  } finally {
    globalThis.fetch = realFetch
  }
})

describe('the vectors, with the engine in this process', () => {
  it('are the sector bindings\' and the example profiles\' vectors, and every one answers as its vector expects', () => {
    expect(networkAttempts).toBe(0)
    expect(reference.flatMap((run, index) => expectationProblems(vectors[index]!, run.result))).toEqual([])
    const names = vectors.map((v) => v.name)
    expect(new Set(names).size).toBe(names.length)
    // Two documents and twelve payload cases for each sector, each document also as a public payload alone, one battery
    // payload with a required public property left out, and the example profiles' payload vectors.
    expect(names.filter((n) => n.startsWith('eu-battery@1 ')).length).toBe(17)
    expect(names.filter((n) => n.startsWith('eu-textile@1 ')).length).toBe(16)
    expect(names.filter((n) => n.startsWith('example-bottle@1 ')).length).toBe(12)
    expect(names.filter((n) => n.startsWith('example-notebook@1 ')).length).toBe(4)
  })

  it('include every violation that only a SPARQL constraint finds', () => {
    expect(vectors.filter((v) => v.sparqlOnly).map((v) => v.name).sort()).toEqual([
      'eu-battery@1 granularity-mismatch', 'eu-battery@1 granularity-product-link', 'eu-textile@1 granularity-mismatch', 'eu-textile@1 granularity-product-link',
      'example-bottle@1 vectors/part-not-dishwasher-safe.json',
    ].sort())
  })

  it('cover a pass, a failure and an answer that could not be decided', () => {
    const statuses = new Set(reference.map((r) => r.result.status))
    expect([...statuses].sort()).toEqual(['fail', 'pass', 'unknown'])
    // Each document is also read as any reader reads it, from the public payload alone.
    const alone = reference.filter((r) => r.name.includes('(public payload alone'))
    expect(alone.map((r) => (r.result.detail as BindingValidationDetail).access?.view)).toEqual(['public', 'public', 'public', 'public', 'public'])
  })
})

describe('the same vectors through a validator service', () => {
  const services: ValidatorService[] = []
  afterAll(async () => { await Promise.all(services.map((s) => s.close())) })

  it('started in this process over the engine in this process: every answer is identical', async () => {
    const service = await startValidatorService({ engines: await createValidationEngine() })
    services.push(service)
    const client = createValidatorClient({ url: service.url })
    expect(await runVectors(vectors, client)).toEqual(reference)
  })

  it('started in this process as it ships, with the engine in threads of its own: every answer is identical', async () => {
    // The threads load the built adapter, so this arrangement is the built package's.
    const built = join(packageRoot, 'dist', 'validator-service.js')
    expect(existsSync(built), 'packages/dpp-profiles/dist is missing: run npm run build before the tests').toBe(true)
    const { startValidatorService: startBuilt } = (await import(built)) as typeof import('../src/validator-service.js')
    const service = await startBuilt()
    services.push(service)
    expect(service.capabilities.engine.libraries).toEqual({ jsonld: '9.0.0', n3: '2.13.12', 'shacl-engine': '1.1.3' })
    const client = createValidatorClient({ url: service.url })
    expect(await runVectors(vectors, client)).toEqual(reference)
  })

  it('without the SPARQL capability: each violation only SPARQL finds is unknown, never pass and never a silent miss', async () => {
    const service = await startValidatorService({ engines: await createValidationEngine({ sparql: false }) })
    services.push(service)
    expect(service.capabilities.capabilities).toEqual(['shacl-core'])
    const client = createValidatorClient({ url: service.url })
    const sparqlOnly = vectors.filter((v) => v.sparqlOnly)
    for (const { name, result } of (await runVectors(sparqlOnly, client)) as Run[]) {
      // The engine is never asked, so its silence cannot count: the SHACL step could not run.
      const shacl = stepsOf(result).find((s) => s.step === 'shacl')
      expect(shacl, name).toMatchObject({ status: 'unknown', cause: 'validator-unavailable' })
      expect(shacl?.messages?.[0], name).toContain('shacl-sparql-constraints')
      expect(shacl?.findings, name).toBeUndefined()
      expect(result.status, name).not.toBe('pass')
      // Where the identity rules also see the fault the answer is a failure, on their word alone. Where only SPARQL could, it is unknown.
      const identity = stepsOf(result).find((s) => s.step === 'passport-identity')
      expect(result.status, name).toBe(identity?.status === 'fail' ? 'fail' : 'unknown')
    }
    expect(((await runVectors(sparqlOnly, client)) as Run[]).filter((r) => r.result.status === 'unknown').map((r) => r.name).sort()).toEqual(['eu-battery@1 granularity-product-link', 'eu-textile@1 granularity-product-link', 'example-bottle@1 vectors/part-not-dishwasher-safe.json'])
  })

  it('stopped: nothing that needs the engine passes, and what passed before is unknown', async () => {
    const service = await startValidatorService({ engines: await createValidationEngine() })
    const client = createValidatorClient({ url: service.url })
    await service.close()
    const stopped = (await runVectors(vectors, client)) as Run[]
    for (const [index, { name, result }] of stopped.entries()) {
      const before = reference[index]!.result
      if (!usesEngine(before)) { expect(result, name).toEqual(before); continue }
      expect(result.status, name).not.toBe('pass')
      if (before.status === 'pass') expect(result, name).toMatchObject({ status: 'unknown', reasonCode: 'schema-unavailable', detail: { cause: 'validator-unavailable' } })
      // A failure the application decides by itself, such as the identity check, is still a failure.
      for (const step of stepsOf(result).filter((s) => s.step === 'json-ld-expand' || s.step === 'shacl')) if (step.status !== 'fail') expect(step, name).toMatchObject({ status: 'unknown', cause: 'validator-unavailable' })
    }
    expect(stopped.filter((r) => r.result.status === 'unknown').length).toBeGreaterThan(10)
  })
})

describe('the same vectors through another implementation of the contract', () => {
  let child: ChildProcess
  let url: string
  beforeAll(async () => {
    // A second service, written for this test from the contract alone, in a process of its own.
    child = spawn(process.execPath, [join(import.meta.dirname, 'stand-in-validator.mjs')], { stdio: ['ignore', 'pipe', 'inherit'] })
    const port = await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => reject(new Error(`the stand-in service ended with code ${code}`)))
      child.stdout!.once('data', (line: Buffer) => resolve((JSON.parse(line.toString('utf8')) as { port: number }).port))
    })
    url = `http://127.0.0.1:${port}`
  })
  afterAll(() => { child.kill('SIGTERM') })

  it('shares no code with the package\'s service', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(join(import.meta.dirname, 'stand-in-validator.mjs'), 'utf8')
    const imports = [...source.matchAll(/^import .* from '([^']+)'$/gm)].map((m) => m[1])
    expect(imports.sort()).toEqual(['jsonld', 'n3', 'node:crypto', 'node:http', 'shacl-engine', 'shacl-engine/sparql.js'])
  })

  it('a client reconfigured to it decides every vector the same way, finding for finding', async () => {
    const client = createValidatorClient({ url })
    expect(await client.probe()).toMatchObject({ ok: true, service: { engine: { name: 'stand-in-validator' }, capabilities: ['shacl-core', 'shacl-sparql-constraints'] } })
    const answers = (await runVectors(vectors, client)) as Run[]
    // The sentences that explain a refusal are each implementation's own. What was decided, and every finding, must be the same.
    expect(answers.map((r) => ({ name: r.name, decision: decisionOf(r.result) }))).toEqual(reference.map((r) => ({ name: r.name, decision: decisionOf(r.result) })))
    expect(answers.flatMap((run, index) => expectationProblems(vectors[index]!, run.result))).toEqual([])
  })
})
