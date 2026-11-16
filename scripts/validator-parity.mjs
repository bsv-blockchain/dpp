#!/usr/bin/env node
/**
 * Hold a running validator service to the engine in this process.
 *
 *   node scripts/validator-parity.mjs --url http://127.0.0.1:8090 [--token <token>] [--result]
 *                                      [--package <installed @bsv/dpp-profiles>] [--replacement | --expect-unavailable]
 *
 * It runs every vector of packages/dpp-profiles/test/validator-vectors.mjs
 * twice: with the engine adapter in this process, and with a client of the
 * service at the address given. The service is the same engine only if the
 * two answers are identical for every vector, down to each finding and each
 * sentence. It then says what the service reported about itself, and how
 * large and how slow the exchanges were.
 *
 * `--package` takes the client, and the package the vectors are made with,
 * from an installed copy of @bsv/dpp-profiles instead of this checkout's
 * build: the folder of the package inside a consumer's node_modules. The
 * reference stays the engine in this checkout, so the run holds a clean
 * consumer's configured client to it. That consumer needs none of the engine
 * libraries.
 *
 * `--replacement` is for another implementation of the contract. Its
 * sentences are its own, so what is compared is what each vector decided:
 * the status, the cause, and every step with its findings. Its capability
 * document names its own engine, so the library check is left out.
 *
 * `--expect-unavailable` is for an address where no service answers, because
 * it is stopped or was never started. It holds the other half of the rule:
 * nothing that needs the engine passes, and what passed with the engine is
 * unknown.
 *
 * The vectors are the two bundled sector bindings' positive and negative
 * cases and the two example custom profiles' payload vectors. This is the
 * same list the package's tests run against a service started in the test,
 * so the three arrangements are held to one another: the engine in process,
 * the service in process and the service in its image.
 *
 * Run it from a checkout that has been installed and built. It reads the
 * built package and writes nothing. Results print one sentence per check,
 * never a score. `--result` adds one last line, `RESULT ` and a JSON
 * summary, for scripts/validator-image-check.mjs to read. The exit code is 1
 * when anything fails.
 */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name) => { const at = args.indexOf(name); return at === -1 ? undefined : args[at + 1] }
const url = option('--url')
if (url == null) { console.error('Usage: node scripts/validator-parity.mjs --url <service address> [--token <token>] [--result]'); process.exit(2) }

const replacement = args.includes('--replacement')
const expectUnavailable = args.includes('--expect-unavailable')
if (replacement && expectUnavailable) { console.error('Choose --replacement or --expect-unavailable, not both.'); process.exit(2) }

const dist = join(repo, 'packages', 'dpp-profiles', 'dist')
const installed = option('--package') == null ? undefined : resolve(option('--package'))
let api, engineModule, clientModule, clientApi
try {
  api = await import(join(dist, 'index.js'))
  engineModule = await import(join(dist, 'validation-engine.js'))
  clientModule = await import(join(installed == null ? dist : join(installed, 'dist'), 'validator-client.js'))
  clientApi = installed == null ? api : await import(join(installed, 'dist', 'index.js'))
} catch (cause) {
  console.error(`The built profiles package could not be loaded from ${installed ?? dist}: ${cause.message}. Run npm ci and npm run build first.`)
  process.exit(2)
}
const { validatorVectors, runVectors, expectationProblems, decisionOf } = await import(join(repo, 'packages', 'dpp-profiles', 'test', 'validator-vectors.mjs'))

let failures = 0
const say = (ok, sentence) => { console.log(`${ok ? 'Holds:' : 'FAILS:'} ${sentence}`); if (!ok) failures += 1 }

const compiler = () => { const ajv = new Ajv2020({ allErrors: true, strict: false }); addFormats(ajv); return ajv }
const vectors = await validatorVectors({ api, repo, compiler })
// With --package the vectors the client runs are made with the installed package, so the registry, the binding trust
// and the identity rules it applies are the consumer's own. They are the same vectors, in the same order.
const clientVectors = installed == null ? vectors : await validatorVectors({ api: clientApi, repo, compiler })
if (installed != null) {
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
  say(isDeepStrictEqual(clientVectors.map((v) => v.name), vectors.map((v) => v.name)), `the client and its vectors come from ${manifest.name}@${manifest.version} installed at ${installed}, and they are the ${vectors.length} vectors this checkout runs.`)
}

// Every exchange with the service is timed and measured on its way through.
const exchanges = []
let running = ''
const measured = async (address, init) => {
  const started = performance.now()
  const response = await fetch(address, init)
  const body = await response.arrayBuffer()
  exchanges.push({ vector: running, path: new URL(address).pathname, requestBytes: init.body == null ? 0 : Buffer.byteLength(init.body), responseBytes: body.byteLength, ms: performance.now() - started })
  return new Response(body, { status: response.status, headers: response.headers })
}
const createClient = (timeoutMs) => clientModule.createValidatorClient({ url, ...(option('--token') == null ? {} : { token: option('--token') }), ...(timeoutMs == null ? {} : { timeoutMs }), fetch: measured })
const client = createClient()

const reference = await runVectors(vectors, await engineModule.createValidationEngine())
const unexpected = reference.flatMap((run, index) => expectationProblems(vectors[index], run.result))
say(unexpected.length === 0, `the engine in this process answers all ${vectors.length} vectors as each expects${unexpected.length === 0 ? '' : `: ${unexpected.join('; ')}`}.`)

if (expectUnavailable) {
  // No service answers here. The client must say so for every step that needs the engine, and nothing may pass on it.
  const probe = await createClient(3000).probe()
  say(!probe.ok, `no service describes itself at ${url}${probe.ok ? ', but one answered' : `: ${probe.detail}`}.`)
  const stepsOf = (result) => result.detail?.steps ?? []
  const usesEngine = (result) => stepsOf(result).some((step) => step.step === 'json-ld-expand' || step.step === 'shacl')
  const stopped = await runVectors(clientVectors, createClient(3000))
  const needing = stopped.filter((run, index) => usesEngine(reference[index].result))
  const passing = needing.filter((run) => run.result.status === 'pass').map((run) => run.name)
  say(passing.length === 0 && needing.length > 0, `of the ${needing.length} vectors that need the engine, ${passing.length} pass without it${passing.length === 0 ? '' : `: ${passing.join(', ')}`}.`)
  const passedBefore = stopped.filter((run, index) => usesEngine(reference[index].result) && reference[index].result.status === 'pass')
  const notUnknown = passedBefore.filter((run) => !(run.result.status === 'unknown' && run.result.reasonCode === 'schema-unavailable' && run.result.detail?.cause === 'validator-unavailable')).map((run) => run.name)
  say(notUnknown.length === 0 && passedBefore.length > 0, `each of the ${passedBefore.length} vectors that pass with the engine is unknown, with the cause validator-unavailable${notUnknown.length === 0 ? '' : `, except ${notUnknown.join(', ')}`}.`)
  const wrongSteps = stopped.flatMap((run) => stepsOf(run.result).filter((step) => (step.step === 'json-ld-expand' || step.step === 'shacl') && step.status !== 'fail' && !(step.status === 'unknown' && step.cause === 'validator-unavailable')).map((step) => `${run.name} ${step.step}`))
  say(wrongSteps.length === 0, `every engine step that did not fail on the application's own word says it could not run${wrongSteps.length === 0 ? '' : `, except ${wrongSteps.join(', ')}`}.`)
  const untouched = stopped.filter((run, index) => !usesEngine(reference[index].result))
  const changed = untouched.filter((run) => !isDeepStrictEqual(decisionOf(run.result), decisionOf(reference[stopped.indexOf(run)].result))).map((run) => run.name)
  say(changed.length === 0, `the ${untouched.length} vectors decided before any engine is asked are decided the same way${changed.length === 0 ? '' : `, except ${changed.join(', ')}`}.`)
  const counts = { pass: 0, fail: 0, unknown: 0 }
  for (const run of stopped) counts[run.result.status] += 1
  console.log(`Measured: with no service, the answers are ${counts.pass} pass, ${counts.fail} fail and ${counts.unknown} unknown.`)
  if (args.includes('--result')) console.log(`RESULT ${JSON.stringify({ mode: 'unavailable', vectors: vectors.length, needingEngine: needing.length, passingWithoutEngine: passing.length, unknownThatPassedWithEngine: passedBefore.length - notUnknown.length, passedWithEngine: passedBefore.length, answers: counts, client: installed == null ? 'checkout' : 'installed', failures })}`)
  process.exit(failures === 0 ? 0 : 1)
}

const probe = await client.probe()
say(probe.ok, probe.ok ? `the service at ${url} answers the ${probe.service.contract} contract as ${probe.service.engine.name} ${probe.service.engine.version}.` : `the service at ${url} did not describe itself: ${probe.detail}.`)
if (!probe.ok) process.exit(1)
const { service } = probe
const expected = engineModule.VALIDATION_ENGINE_LIBRARIES
if (!replacement) say(isDeepStrictEqual(service.engine.libraries, { ...expected }), `it runs ${Object.entries(service.engine.libraries).map(([name, version]) => `${name}@${version}`).join(', ') || 'no named library'}; the adapter is tested with ${Object.entries(expected).map(([name, version]) => `${name}@${version}`).join(', ')}.`)
say(isDeepStrictEqual([...service.capabilities].sort(), ['shacl-core', 'shacl-sparql-constraints']), `it declares ${service.capabilities.join(' and ')}.`)

const answers = []
const perVector = []
for (const vector of clientVectors) {
  running = vector.name
  const before = exchanges.length
  const started = performance.now()
  answers.push({ name: vector.name, result: await vector.run(client) })
  perVector.push({ name: vector.name, ms: performance.now() - started, exchanges: exchanges.length - before })
}
// The same code gives the same sentences. Another implementation words a refusal its own way and must decide the same.
const same = (answer, index) => (replacement ? isDeepStrictEqual(decisionOf(answer.result), decisionOf(reference[index].result)) : isDeepStrictEqual(answer.result, reference[index].result))
const differing = answers.filter((answer, index) => !same(answer, index)).map((answer) => answer.name)
say(differing.length === 0, replacement
  ? `through the replacement service, ${answers.length - differing.length} of ${answers.length} vectors are decided the same way, step for step and finding for finding${differing.length === 0 ? '' : `; these differ: ${differing.join(', ')}`}.`
  : `through the service, ${answers.length - differing.length} of ${answers.length} vectors give the identical answer, findings and sentences included${differing.length === 0 ? '' : `; these differ: ${differing.join(', ')}`}.`)
if (replacement) {
  const unmet = answers.flatMap((run, index) => expectationProblems(vectors[index], run.result))
  say(unmet.length === 0, `through the replacement service every vector answers as it expects${unmet.length === 0 ? '' : `: ${unmet.join('; ')}`}.`)
}
const sparqlOnly = vectors.filter((v) => v.sparqlOnly).map((v) => v.name)
const sparqlFound = sparqlOnly.filter((name) => (answers.find((a) => a.name === name).result.detail.steps.find((s) => s.step === 'shacl')?.findings ?? []).some((f) => f.constraint === 'SPARQLConstraintComponent' && f.severity === 'Violation'))
say(sparqlFound.length === sparqlOnly.length && sparqlOnly.length > 0, `each of the ${sparqlOnly.length} violations only a SPARQL constraint finds is found through the service.`)
const counts = { pass: 0, fail: 0, unknown: 0 }
for (const answer of answers) counts[answer.result.status] += 1
say(counts.pass > 0 && counts.fail > 0 && counts.unknown > 0, `the answers are ${counts.pass} pass, ${counts.fail} fail and ${counts.unknown} unknown.`)

// What the exchanges cost. These are measurements of this run, not promises.
const round = (ms) => Math.round(ms * 10) / 10
const stats = (path) => {
  const times = exchanges.filter((e) => e.path.endsWith(path)).map((e) => e.ms).sort((a, b) => a - b)
  return times.length === 0 ? undefined : { count: times.length, medianMs: round(times[Math.floor(times.length / 2)]), maxMs: round(times.at(-1)) }
}
const operations = exchanges.filter((e) => e.path.endsWith('/expand') || e.path.endsWith('/validate'))
const largest = operations.reduce((a, b) => (b.requestBytes > a.requestBytes ? b : a))
const slowest = perVector.reduce((a, b) => (b.ms > a.ms ? b : a))
const largestVector = perVector.find((v) => v.name === largest.vector)
console.log(`Measured: ${operations.length} operations for ${vectors.length} vectors. Expansion: median ${stats('/expand').medianMs} ms, slowest ${stats('/expand').maxMs} ms. Validation: median ${stats('/validate').medianMs} ms, slowest ${stats('/validate').maxMs} ms.`)
console.log(`Measured: the largest request was ${largest.requestBytes} bytes, a ${largest.path.slice(largest.path.lastIndexOf('/') + 1)} for "${largest.vector}", answered in ${round(largest.ms)} ms with ${largest.responseBytes} bytes. That vector took ${round(largestVector.ms)} ms in all, over ${largestVector.exchanges} exchanges. The slowest vector, "${slowest.name}", took ${round(slowest.ms)} ms.`)

if (args.includes('--result')) {
  console.log(`RESULT ${JSON.stringify({
    mode: replacement ? 'replacement' : 'identical',
    client: installed == null ? 'checkout' : 'installed',
    service: { contract: service.contract, engine: service.engine, capabilities: service.capabilities, limits: service.limits },
    vectors: vectors.length,
    identical: answers.length - differing.length,
    differing,
    sparqlOnlyViolations: sparqlOnly.length,
    sparqlOnlyViolationsFound: sparqlFound.length,
    answers: counts,
    operations: operations.length,
    expand: stats('/expand'),
    validate: stats('/validate'),
    largestRequest: { vector: largest.vector, operation: largest.path.slice(largest.path.lastIndexOf('/') + 1), requestBytes: largest.requestBytes, responseBytes: largest.responseBytes, ms: round(largest.ms), vectorMs: round(largestVector.ms), vectorExchanges: largestVector.exchanges },
    slowestVector: { vector: slowest.name, ms: round(slowest.ms) },
    failures,
  })}`)
}
process.exit(failures === 0 ? 0 : 1)
