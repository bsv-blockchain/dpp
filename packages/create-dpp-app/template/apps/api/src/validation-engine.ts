// The validation engine, chosen by configuration. A profile held by a binding
// is checked by a JSON-LD engine and a SHACL engine, and this file decides
// where they run:
//
//   VALIDATOR_URL unset   in this process, from the three libraries apps/api installs
//   VALIDATOR_URL set     in a validator service at that address, asked through
//                         the client of @bsv/dpp-profiles
//
// Either way the application is handed the same two engines and changes
// nothing else. The registry, the binding digests it trusts, the split into
// public and restricted parts and the comparison with the passport identifier
// all stay in this process. A service is sent the product document and the
// rule files of its binding, and answers for those only.
//
// One rule holds in both modes: an engine that cannot be used is never a
// pass. Libraries that did not load, a service that is stopped, slow, behind
// a wrong token or answering something else, all give `unknown`, and a
// document that was not validated is not written.
//
// This file imports nothing from the rest of the application, so the choice
// it makes can be exercised with the profiles package alone.
import type { ValidationEngines } from '@bsv/dpp-profiles'
import { VALIDATION_ENGINE_LIBRARIES, createValidationEngine } from '@bsv/dpp-profiles/validation-engine'
import { createValidatorClient, type ValidatorClient } from '@bsv/dpp-profiles/validator-client'

export interface ValidationEngineSettings {
  /** The address of a validator service. Unset, the engine runs in this process. */
  url?: string
  /** The bearer token that service requires, when it requires one. */
  token?: string
}

export interface ValidationEngineOptions {
  /** How a validation library is loaded, for the engine in this process. Tests pass one that fails, to stand in for libraries that are not installed. */
  load?: (name: string) => Promise<unknown>
  /** The transport to the service. The platform's by default. */
  fetch?: typeof globalThis.fetch
  /** How long one exchange with the service may take, in milliseconds. The client's own default when unset. */
  timeoutMs?: number
  log?: (line: string) => void
}

export interface ValidationEngine {
  /** Where the engines run. */
  kind: 'in-process' | 'service'
  /** The service's address without any path a secret could hide in: its origin. Absent for the engine in this process. */
  service?: string
  /** The two engines, or neither when the libraries did not load. */
  engines: Pick<ValidationEngines, 'jsonLd' | 'shacl'>
  /** Why the engine cannot be used, as last found. Undefined when it can. */
  readonly problem: string | undefined
  /**
   * Look again. For a service this asks it what it is, so a service that was
   * started, stopped or given another token since the last look is seen
   * without restarting the API. For the engine in this process the answer is
   * the one start-up found: libraries that did not load need a restart.
   */
  check(): Promise<string | undefined>
}

/** The settings as the environment names them. A value that cannot be used is the configuration's to refuse; this only reads. */
export function validationEngineSettings(env: Record<string, string | undefined>): ValidationEngineSettings {
  const text = (name: string): string | undefined => {
    const value = env[name]?.trim()
    return value == null || value === '' ? undefined : value
  }
  const url = text('VALIDATOR_URL')
  const token = text('VALIDATOR_TOKEN')
  return { ...(url == null ? {} : { url }), ...(token == null ? {} : { token }) }
}

const ENGINE_INSTALL = Object.entries(VALIDATION_ENGINE_LIBRARIES)
  .map(([name, version]) => `${name}@${version}`)
  .join(' ')

const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

/** How long a look at the service may take: short, because a page waits for it. */
const CHECK_TIMEOUT_MS = 3_000

export async function openValidationEngine(settings: ValidationEngineSettings = {}, options: ValidationEngineOptions = {}): Promise<ValidationEngine> {
  const log = options.log ?? (() => {})

  if (settings.url == null) {
    let engines: ValidationEngine['engines'] = {}
    let problem: string | undefined
    try {
      engines = await createValidationEngine(options.load == null ? {} : { load: options.load })
    } catch (cause) {
      problem = `${reasonOf(cause)}. Install ${ENGINE_INSTALL} in apps/api and restart.`
      log(`The validation engine is not available: ${problem} Until then a profile held by a binding cannot be written, and its readings say "not checked".`)
    }
    return {
      kind: 'in-process',
      engines,
      get problem() {
        return problem
      },
      check: async () => problem,
    }
  }

  // The client refuses an address or a token it cannot use, by throwing. That is a mistake in the configuration and stops the start.
  const shared = { url: settings.url, ...(settings.token == null ? {} : { token: settings.token }), ...(options.fetch == null ? {} : { fetch: options.fetch }) }
  const client: ValidatorClient = createValidatorClient({ ...shared, ...(options.timeoutMs == null ? {} : { timeoutMs: options.timeoutMs }) })
  const prober: ValidatorClient = createValidatorClient({ ...shared, timeoutMs: Math.min(options.timeoutMs ?? CHECK_TIMEOUT_MS, CHECK_TIMEOUT_MS) })
  const service = new URL(settings.url).origin
  const remedy = 'Start it, or correct VALIDATOR_URL and VALIDATOR_TOKEN. The API asks again by itself and needs no restart once the service answers.'
  let problem: string | undefined

  /**
   * Ask the service what it is, and then ask it to do something. The first
   * answer is open to anyone who can reach it. The second needs the token, so
   * a service that is up and refuses this application is found here and not
   * at the first write. The client's sentences name the address and never
   * the token.
   */
  const look = async (): Promise<{ ok: true; described: string } | { ok: false; detail: string }> => {
    const answer = await prober.probe()
    if (!answer.ok) return { ok: false, detail: answer.detail }
    // An empty document with no context is the smallest request there is. Whatever the engine makes of it, an answer from the engine means the token was taken.
    const asked = await prober.jsonLd.toRdf({ document: {}, contexts: [] })
    if (!asked.ok && (asked.reason === 'timeout' || asked.reason === 'engine-error')) return { ok: false, detail: asked.detail }
    return { ok: true, described: `${answer.service.engine.name} ${answer.service.engine.version}, which checks ${answer.service.capabilities.join(', ')}` }
  }
  const check = async (): Promise<string | undefined> => {
    const answer = await look()
    if (!answer.ok) {
      problem = `${answer.detail}. ${remedy}`
      return problem
    }
    // The client that validates learns what the engine can check from an answer of its own.
    if (client.shacl.capabilities.length === 0) await client.probe()
    problem = undefined
    return undefined
  }

  /** An engine call that did not finish may be the service's fault or the request's. Asking the service says which. */
  const after = async <T extends { ok: boolean }>(result: T): Promise<T> => {
    if (result.ok) problem = undefined
    else if ((result as { reason?: string }).reason === 'timeout' || (result as { reason?: string }).reason === 'engine-error') await check()
    return result
  }

  const first = await look()
  if (first.ok) {
    await client.probe()
    log(`Validation engine: the validator service at ${service}, ${first.described}.`)
  } else {
    problem = `${first.detail}. ${remedy}`
    log(`The validation engine is not available: ${problem} Until then a profile held by a binding cannot be written, and its readings say "not checked".`)
  }

  return {
    kind: 'service',
    service,
    engines: {
      jsonLd: { toRdf: async (input) => await after(await client.jsonLd.toRdf(input)) },
      shacl: {
        // Read each time it is asked for: the validator looks at it before every run, and it is whatever the service last said.
        get capabilities() {
          return client.shacl.capabilities
        },
        validate: async (input) => await after(await client.shacl.validate(input)),
      },
    },
    get problem() {
      return problem
    },
    check,
  }
}
