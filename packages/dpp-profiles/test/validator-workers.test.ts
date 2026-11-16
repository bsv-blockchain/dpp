import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { EngineContext, EngineFile } from '../src/index.js'
import type { ValidatorService, ValidatorServiceOptions } from '../src/validator-service.js'
import { createValidatorClient } from '../src/validator-client.js'

// The service as it ships: its engine in threads of its own, the command
// that starts it, and the files the image is made of. The threads and the
// command are files of the built package, so everything here runs on
// `dist/`, which `npm run build` writes. A missing build fails these tests
// by name. It never skips them.
const packageRoot = join(import.meta.dirname, '..')
const repo = join(packageRoot, '..', '..')
const dist = join(packageRoot, 'dist')
const folder = join(repo, 'examples', 'custom-profile', 'example-bottle@1')
const bytes = (file: string): Uint8Array => new Uint8Array(readFileSync(join(folder, file)))
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
const CONTEXT = 'https://profiles.example/bottle/v1/context.jsonld'
const contexts: EngineContext[] = [{ uri: CONTEXT, bytes: bytes('context.jsonld') }]
const shapes: EngineFile[] = [{ path: 'shapes.ttl', mediaType: 'text/turtle', bytes: bytes('shapes.ttl') }]
const background: EngineFile[] = [{ path: 'background.ttl', mediaType: 'text/turtle', bytes: bytes('background.ttl') }]
const product = (JSON.parse(readFileSync(join(folder, 'vectors', 'item.json'), 'utf8')) as { payload: { product: Record<string, unknown> } }).payload.product

let startBuilt: (options?: ValidatorServiceOptions) => Promise<ValidatorService>
beforeAll(async () => {
  expect(existsSync(join(dist, 'validator-service.js')), 'packages/dpp-profiles/dist is missing: run npm run build before the tests').toBe(true)
  ;({ startValidatorService: startBuilt } = (await import(join(dist, 'validator-service.js'))) as typeof import('../src/validator-service.js'))
})

const running: ValidatorService[] = []
const start = async (options: ValidatorServiceOptions = {}): Promise<ValidatorService> => { const service = await startBuilt(options); running.push(service); return service }
afterEach(async () => { await Promise.all(running.splice(0).map((service) => service.close())) })

/**
 * Shapes whose one pattern takes longer than anyone will wait: a regular
 * expression that backtracks through every way of splitting a run of letters.
 * The match never yields, so a time limit on the thread that runs it cannot
 * fire. Only stopping the thread ends it.
 */
const RUNAWAY_SHAPES: EngineFile[] = [{ path: 'runaway.ttl', mediaType: 'text/turtle', bytes: utf8('@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix ex: <https://profiles.example/runaway#> .\nex:Shape a sh:NodeShape ; sh:targetSubjectsOf ex:text ; sh:property [ sh:path ex:text ; sh:pattern "^(a+)+$" ] .\n') }]
const RUNAWAY_DATA = `<https://id.example/runaway> <https://profiles.example/runaway#text> "${'a'.repeat(40)}!" .\n`

describe('the service with its engine in threads of its own', () => {
  it('names the adapter, the versions installed and both capabilities', async () => {
    const service = await start()
    const own = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version: string }
    expect(service.capabilities).toMatchObject({
      contract: 'dpp-validator/1',
      engine: { name: '@bsv/dpp-profiles/validation-engine', version: own.version, libraries: { jsonld: '9.0.0', n3: '2.13.12', 'shacl-engine': '1.1.3' } },
      capabilities: ['shacl-core', 'shacl-sparql-constraints'],
      limits: { concurrency: 2, queueLimit: 16, timeoutMs: 10_000, maxRequestBytes: 8 * 1024 * 1024 },
    })
    expect((await startBuiltCoreOnly()).capabilities.capabilities).toEqual(['shacl-core'])
  })
  const startBuiltCoreOnly = (): Promise<ValidatorService> => start({ sparql: false, concurrency: 1 })

  it('stops an operation that runs over the limit, and is ready for the next one', async () => {
    const service = await start({ concurrency: 1, queueLimit: 4, timeoutMs: 2000 })
    const client = createValidatorClient({ url: service.url, timeoutMs: 20_000 })
    const began = performance.now()
    const runaway = await client.shacl.validate({ nquads: RUNAWAY_DATA, shapes: RUNAWAY_SHAPES, background: [] })
    const took = performance.now() - began
    expect(runaway).toEqual({ ok: false, reason: 'timeout', detail: 'the operation did not finish within 2000 ms and was stopped' })
    // Answered at the limit, although the work itself would not have ended for a very long time.
    expect(took).toBeGreaterThanOrEqual(1990)
    expect(took).toBeLessThan(8000)
    // One thread, and it was running that match. The next operation is answered only because the thread was ended and replaced.
    // The replacement loads its engine first. Until it has, the service answers that no engine is free, so the question is asked again.
    let expansion = await client.jsonLd.toRdf({ document: product, contexts })
    for (let i = 0; i < 40 && !expansion.ok; i++) {
      await new Promise((r) => setTimeout(r, 250))
      expansion = await client.jsonLd.toRdf({ document: product, contexts })
    }
    expect(expansion).toMatchObject({ ok: true })
    if (!expansion.ok) return
    const validation = await client.shacl.validate({ nquads: expansion.nquads, shapes, background })
    expect(validation).toMatchObject({ ok: true })
    expect(performance.now() - began).toBeLessThan(25_000)
  })

  it('control: the same operation on a thread nobody can stop holds that thread long past the limit', async () => {
    // The adapter's own limit, in a process of its own: the limit cannot fire while the match runs, so the call
    // returns only when the match ends or the process is killed. Here the process is killed after two seconds.
    const script = `import { createValidationEngine } from ${JSON.stringify(join(dist, 'validation-engine.js'))}
const { shacl } = await createValidationEngine({ timeoutMs: 400 })
const utf8 = (t) => new TextEncoder().encode(t)
console.log('started')
const result = await shacl.validate({ nquads: ${JSON.stringify(RUNAWAY_DATA)}, shapes: [{ path: 'runaway.ttl', mediaType: 'text/turtle', bytes: utf8(${JSON.stringify(new TextDecoder().decode(RUNAWAY_SHAPES[0]!.bytes))}) }], background: [] })
console.log('finished', JSON.stringify(result))`
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: packageRoot, stdio: ['ignore', 'pipe', 'inherit'] })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
    const ended = new Promise<string>((resolve) => child.once('exit', (_code, signal) => resolve(signal ?? 'exited')))
    for (let i = 0; i < 400 && !output.includes('started'); i++) await new Promise((r) => setTimeout(r, 25))
    expect(output).toContain('started')
    await new Promise((r) => setTimeout(r, 2000))
    // Five times the limit later it has neither answered nor timed out.
    expect(output).not.toContain('finished')
    child.kill('SIGKILL')
    expect(await ended).toBe('SIGKILL')
  })

  it('serves other requests while one thread is taken, and answers /health throughout', async () => {
    const service = await start({ concurrency: 2, queueLimit: 4, timeoutMs: 1500 })
    const client = createValidatorClient({ url: service.url, timeoutMs: 20_000 })
    const runaway = client.shacl.validate({ nquads: RUNAWAY_DATA, shapes: RUNAWAY_SHAPES, background: [] })
    await new Promise((r) => setTimeout(r, 100))
    // The service's own thread is not the one running the match, so it still answers.
    expect((await fetch(`${service.url}/health`)).status).toBe(200)
    expect(await client.jsonLd.toRdf({ document: product, contexts })).toMatchObject({ ok: true })
    expect(await runaway).toMatchObject({ ok: false, reason: 'timeout' })
  })

  it('stops the work of a caller that went away', async () => {
    const service = await start({ concurrency: 1, queueLimit: 4, timeoutMs: 30_000 })
    // This caller gives up after 300 ms. The service's own limit is far off.
    const impatient = createValidatorClient({ url: service.url, timeoutMs: 300 })
    expect(await impatient.shacl.validate({ nquads: RUNAWAY_DATA, shapes: RUNAWAY_SHAPES, background: [] })).toMatchObject({ ok: false, reason: 'timeout' })
    // The one thread is free again long before the limit, so the abandoned match was ended.
    const began = performance.now()
    expect(await createValidatorClient({ url: service.url, timeoutMs: 20_000 }).jsonLd.toRdf({ document: product, contexts })).toMatchObject({ ok: true })
    expect(performance.now() - began).toBeLessThan(10_000)
  })

  it('answers an engine error when a thread runs out of memory, and replaces the thread', async () => {
    const service = await start({ concurrency: 1, queueLimit: 4, timeoutMs: 20_000, maxWorkerMemoryMb: 64 })
    const client = createValidatorClient({ url: service.url, timeoutMs: 30_000 })
    // Data far larger than the thread may hold once it is parsed into a store.
    const line = (i: number): string => `<https://id.example/n${i}> <https://profiles.example/runaway#value> "${'v'.repeat(40)}${i}" .\n`
    let data = ''
    for (let i = 0; data.length < 6_000_000; i++) data += line(i)
    const result = await client.shacl.validate({ nquads: data, shapes, background })
    expect(result).toMatchObject({ ok: false, reason: 'engine-error' })
    if (!result.ok) expect(result.detail).toMatch(/engine thread/)
    expect(await client.jsonLd.toRdf({ document: product, contexts })).toMatchObject({ ok: true })
  }, 60_000)
})

// The files of the built package that the service is made of: what the command imports, and the thread it starts.
const STATIC = /(?:^|[\s;])(?:import|export)\s(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]/g
function closure(entries: string[]): { files: string[]; bare: string[] } {
  const files = new Set<string>()
  const bare = new Set<string>()
  const visit = (file: string): void => {
    if (files.has(file)) return
    files.add(file)
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(STATIC)) {
      if (specifier!.startsWith('.')) visit(resolve(dirname(file), specifier!))
      else bare.add(specifier!)
    }
  }
  entries.forEach(visit)
  return { files: [...files].map((file) => file.slice(dist.length + 1)).sort(), bare: [...bare].sort() }
}

describe('the files the service is made of', () => {
  it('are seven files of the built package, which import Node\'s own modules and nothing else', () => {
    const { files, bare } = closure([join(dist, 'validator-cli.js'), join(dist, 'validator-worker.js')])
    expect(files).toEqual(['strict-json.js', 'validation-engine.js', 'validator-cli.js', 'validator-command.js', 'validator-service.js', 'validator-wire.js', 'validator-worker.js'])
    // The engine libraries are reached only by the adapter's dynamic import, inside a thread.
    expect(bare.every((specifier) => specifier.startsWith('node:'))).toBe(true)
  })

  it('are exactly the files the image copies', () => {
    const dockerfile = readFileSync(join(packageRoot, 'validator-image', 'Dockerfile'), 'utf8')
    const copied = [...dockerfile.matchAll(/^COPY --from=build \/repo\/packages\/dpp-profiles\/dist\/(\S+) /gm)].map((m) => m[1]!).sort()
    expect(copied).toEqual(closure([join(dist, 'validator-cli.js'), join(dist, 'validator-worker.js')]).files)
  })

  it('the client and the service entry points import the package\'s own code and Node\'s, and no library', () => {
    for (const entry of ['validator-client.js', 'validator-service.js']) {
      const { files, bare } = closure([join(dist, entry)])
      expect(files.every((file) => /^(validator-[a-z]+|strict-json)\.js$/.test(file)), entry).toBe(true)
      expect(bare.every((specifier) => specifier.startsWith('node:')), entry).toBe(true)
      // No computed import either: the one in the adapter is reached only through the thread.
      for (const file of files) expect(readFileSync(join(dist, file), 'utf8'), file).not.toMatch(/\bimport\(/)
    }
  })
})

describe('the dpp-validator command', () => {
  const cli = join(dist, 'validator-cli.js')
  const children: Array<ReturnType<typeof spawn>> = []
  afterAll(() => { for (const child of children) child.kill('SIGKILL') })
  const run = (args: string[], env: Record<string, string> = {}, cwd = packageRoot): { child: ReturnType<typeof spawn>; out: () => string; err: () => string; exit: Promise<number | null> } => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env: { PATH: process.env.PATH ?? '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(child)
    let out = ''
    let err = ''
    child.stdout!.on('data', (chunk: Buffer) => { out += chunk.toString('utf8') })
    child.stderr!.on('data', (chunk: Buffer) => { err += chunk.toString('utf8') })
    return { child, out: () => out, err: () => err, exit: new Promise((resolve) => child.once('exit', (code) => resolve(code))) }
  }
  const lines = (text: string): Array<Record<string, unknown>> => text.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line) as Record<string, unknown>)

  it('starts the service from the environment, answers, logs no content and stops cleanly when told to', async () => {
    const service = run([], { VALIDATOR_PORT: '0', VALIDATOR_TOKEN: 'correct-horse', VALIDATOR_CONCURRENCY: '1', VALIDATOR_TIMEOUT_MS: '7000' })
    for (let i = 0; i < 400 && !service.out().includes('"listening"'); i++) await new Promise((r) => setTimeout(r, 25))
    const [listening] = lines(service.out())
    expect(listening).toMatchObject({ event: 'listening', token: 'required', contract: 'dpp-validator/1', capabilities: ['shacl-core', 'shacl-sparql-constraints'], limits: { concurrency: 1, timeoutMs: 7000 } })
    const url = listening!.url as string
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(await createValidatorClient({ url, token: 'correct-horse' }).jsonLd.toRdf({ document: product, contexts })).toMatchObject({ ok: true })
    expect(await createValidatorClient({ url }).jsonLd.toRdf({ document: product, contexts })).toMatchObject({ ok: false, reason: 'engine-error' })
    // The health command asks the service the same environment describes.
    const port = new URL(url).port
    const health = run(['health'], { VALIDATOR_PORT: port })
    expect(await health.exit).toBe(0)
    expect(health.out()).toContain('is running')
    service.child.kill('SIGTERM')
    expect(await service.exit).toBe(0)
    const logged = lines(service.out())
    expect(logged.map((entry) => entry.event ?? `${String(entry.route)} ${String(entry.status)} ${String(entry.outcome)}`)).toEqual(['listening', 'expand 200 ok', 'expand 401 unauthorised', 'health 200 ok', 'stopped'])
    expect(service.out()).not.toContain('correct-horse')
    expect(service.out()).not.toContain('BTL-0001')
    expect(service.err()).toBe('')
    // Once it has stopped, the health command says so with its exit code.
    const after = run(['health'], { VALIDATOR_PORT: port })
    expect(await after.exit).toBe(1)
    expect(after.err()).toContain('No validator service answered')
  })

  it.each([
    [{ VALIDATOR_PORT: 'eighty' }, 'VALIDATOR_PORT'],
    [{ VALIDATOR_PORT: '70000' }, 'VALIDATOR_PORT'],
    [{ VALIDATOR_TIMEOUT_MS: '0' }, 'VALIDATOR_TIMEOUT_MS'],
    [{ VALIDATOR_CONCURRENCY: '-1' }, 'VALIDATOR_CONCURRENCY'],
    [{ VALIDATOR_QUEUE_LIMIT: '1.5' }, 'VALIDATOR_QUEUE_LIMIT'],
    [{ VALIDATOR_MAX_REQUEST_BYTES: 'lots' }, 'VALIDATOR_MAX_REQUEST_BYTES'],
    [{ VALIDATOR_WORKER_MEMORY_MB: '8' }, 'VALIDATOR_WORKER_MEMORY_MB'],
    [{ VALIDATOR_TOKEN: 'two words' }, 'VALIDATOR_TOKEN'],
  ])('refuses to start on a setting it cannot read, names it and guesses nothing: %o', async (env, name) => {
    const command = run([], env)
    expect(await command.exit).toBe(2)
    expect(command.err()).toContain(name)
    expect(command.out()).toBe('')
    expect(command.err()).not.toContain('two words')
  })

  it('prints its usage, and refuses a command it does not know', async () => {
    const help = run(['--help'])
    expect(await help.exit).toBe(0)
    expect(help.out()).toContain('VALIDATOR_PORT')
    const unknown = run(['migrate'])
    expect(await unknown.exit).toBe(2)
    expect(unknown.err()).toContain('does not know')
  })

  it('does not start without the engine libraries, and says which one is missing', async () => {
    // The service's files alone, in a folder with no node_modules above it: what an install that forgot the libraries looks like.
    const bare = mkdtempSync(join(tmpdir(), 'dpp-validator-bare-'))
    try {
      mkdirSync(join(bare, 'dist'))
      for (const file of closure([cli, join(dist, 'validator-worker.js')]).files) cpSync(join(dist, file), join(bare, 'dist', file))
      cpSync(join(packageRoot, 'package.json'), join(bare, 'package.json'))
      const child = spawn(process.execPath, [join(bare, 'dist', 'validator-cli.js')], { cwd: bare, env: { PATH: process.env.PATH ?? '', VALIDATOR_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
      children.push(child)
      let err = ''
      child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString('utf8') })
      expect(await new Promise((resolvePromise) => child.once('exit', (code) => resolvePromise(code)))).toBe(1)
      expect(err).toContain('The validation engine did not load, so the validator service did not start')
      expect(err).toContain('jsonld@9.0.0')
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })
})
