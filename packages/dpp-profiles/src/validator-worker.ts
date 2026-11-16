/**
 * The thread a validator service runs its engine in. It is started by
 * `validator-service.ts` and by nothing else, and is not an entry point of
 * the package.
 *
 * The engine runs here, and not on the service's own thread, for one reason:
 * JavaScript cannot interrupt work that does not yield, and a thread can be
 * stopped from outside. When an operation passes the service's time limit the
 * service terminates this thread, which ends the work whatever it was doing,
 * and starts another.
 *
 * The thread loads the engine once, says what it loaded, then answers one
 * operation at a time. It holds nothing between operations: the adapter
 * starts every call with an empty context cache.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parentPort, workerData } from 'node:worker_threads'
import type { EngineContext, EngineFile, JsonLdEngine, JsonLdExpansion, ShaclEngine, ShaclValidation } from './binding-validator.js'
import { VALIDATION_ENGINE_LIBRARIES, createValidationEngine } from './validation-engine.js'

export interface WorkerSettings { timeoutMs: number; sparql: boolean }
export type WorkerRequest =
  | { id: number; operation: 'expand'; input: { document: unknown; contexts: EngineContext[] } }
  | { id: number; operation: 'validate'; input: { nquads: string; shapes: EngineFile[]; background: EngineFile[] } }
export type WorkerMessage =
  | { type: 'ready'; capabilities: string[]; libraries: Record<string, string> }
  | { type: 'failed'; detail: string }
  | { type: 'result'; id: number; result: JsonLdExpansion | ShaclValidation }

const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

/** The version of a library as installed here, read from its own manifest: what the service runs, which need not be what the adapter was tested with. */
function installedVersion(name: string): string {
  try {
    let folder = dirname(fileURLToPath(import.meta.resolve(name)))
    for (;;) {
      try {
        const manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as { name?: string; version?: string }
        if (manifest.name === name && typeof manifest.version === 'string') return manifest.version
      } catch { /* no manifest in this folder; look in the one above */ }
      const above = dirname(folder)
      if (above === folder) return 'unknown'
      folder = above
    }
  } catch {
    return 'unknown'
  }
}

const port = parentPort
if (port == null) throw new Error('validator-worker.js runs only as a thread of the validator service')
const post = (message: WorkerMessage): void => port.postMessage(message)

// The engine is handed every context and fetches none. This closes the one general-purpose way out as well, so a
// library that reached for the network would fail here and be noticed.
globalThis.fetch = (async () => { throw new Error('the validator service makes no outbound request') }) as typeof fetch

const settings = workerData as WorkerSettings
let engines: { jsonLd: JsonLdEngine; shacl: ShaclEngine }
try {
  engines = await createValidationEngine({ timeoutMs: settings.timeoutMs, sparql: settings.sparql })
  post({ type: 'ready', capabilities: [...engines.shacl.capabilities], libraries: Object.fromEntries(Object.keys(VALIDATION_ENGINE_LIBRARIES).map((name) => [name, installedVersion(name)])) })
  port.on('message', (request: WorkerRequest) => {
    const work: Promise<JsonLdExpansion | ShaclValidation> = request.operation === 'expand' ? engines.jsonLd.toRdf(request.input) : engines.shacl.validate(request.input)
    work.then(
      (result) => post({ type: 'result', id: request.id, result }),
      (cause) => post({ type: 'result', id: request.id, result: { ok: false, reason: 'engine-error', detail: reasonOf(cause) } }),
    )
  })
} catch (cause) {
  post({ type: 'failed', detail: reasonOf(cause) })
}
