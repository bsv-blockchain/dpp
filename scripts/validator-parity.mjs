#!/usr/bin/env node
/**
 * Hold a running validator service to the engine in this process.
 *
 *   node scripts/validator-parity.mjs --url http://127.0.0.1:8090 [--token <token>] [--result]
 *
 * It runs every vector of packages/dpp-profiles/test/validator-vectors.mjs
 * twice: with the engine adapter in this process, and with a client of the
 * service at the address given. The service is the same engine only if the
 * two answers are identical for every vector, down to each finding and each
 * sentence. It then says what the service reported about itself, and how
 * large and how slow the exchanges were.
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
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name) => { const at = args.indexOf(name); return at === -1 ? undefined : args[at + 1] }
const url = option('--url')
if (url == null) { console.error('Usage: node scripts/validator-parity.mjs --url <service address> [--token <token>] [--result]'); process.exit(2) }

const dist = join(repo, 'packages', 'dpp-profiles', 'dist')
let api, engineModule, clientModule
try {
  api = await import(join(dist, 'index.js'))
  engineModule = await import(join(dist, 'validation-engine.js'))
  clientModule = await import(join(dist, 'validator-client.js'))
} catch (cause) {
  console.error(`The built profiles package could not be loaded from ${dist}: ${cause.message}. Run npm ci and npm run build first.`)
  process.exit(2)
}
const { validatorVectors, runVectors, expectationProblems } = await import(join(repo, 'packages', 'dpp-profiles', 'test', 'validator-vectors.mjs'))

let failures = 0
const say = (ok, sentence) => { console.log(`${ok ? 'Holds:' : 'FAILS:'} ${sentence}`); if (!ok) failures += 1 }

const compiler = () => { const ajv = new Ajv2020({ allErrors: true, strict: false }); addFormats(ajv); return ajv }
const vectors = await validatorVectors({ api, repo, compiler })

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
const client = clientModule.createValidatorClient({ url, ...(option('--token') == null ? {} : { token: option('--token') }), fetch: measured })

const probe = await client.probe()
say(probe.ok, probe.ok ? `the service at ${url} answers the ${probe.service.contract} contract as ${probe.service.engine.name} ${probe.service.engine.version}.` : `the service at ${url} did not describe itself: ${probe.detail}.`)
if (!probe.ok) process.exit(1)
const { service } = probe
const expected = engineModule.VALIDATION_ENGINE_LIBRARIES
say(isDeepStrictEqual(service.engine.libraries, { ...expected }), `it runs ${Object.entries(service.engine.libraries).map(([name, version]) => `${name}@${version}`).join(', ') || 'no named library'}; the adapter is tested with ${Object.entries(expected).map(([name, version]) => `${name}@${version}`).join(', ')}.`)
say(isDeepStrictEqual([...service.capabilities].sort(), ['shacl-core', 'shacl-sparql-constraints']), `it declares ${service.capabilities.join(' and ')}.`)

const reference = await runVectors(vectors, await engineModule.createValidationEngine())
const unexpected = reference.flatMap((run, index) => expectationProblems(vectors[index], run.result))
say(unexpected.length === 0, `the engine in this process answers all ${vectors.length} vectors as each expects${unexpected.length === 0 ? '' : `: ${unexpected.join('; ')}`}.`)

const answers = []
const perVector = []
for (const vector of vectors) {
  running = vector.name
  const before = exchanges.length
  const started = performance.now()
  answers.push({ name: vector.name, result: await vector.run(client) })
  perVector.push({ name: vector.name, ms: performance.now() - started, exchanges: exchanges.length - before })
}
const differing = answers.filter((answer, index) => !isDeepStrictEqual(answer.result, reference[index].result)).map((answer) => answer.name)
say(differing.length === 0, `through the service, ${answers.length - differing.length} of ${answers.length} vectors give the identical answer, findings and sentences included${differing.length === 0 ? '' : `; these differ: ${differing.join(', ')}`}.`)
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
