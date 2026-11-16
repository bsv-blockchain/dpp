/**
 * The `dpp-validator` command: starts a validator service from the
 * environment and runs it until it is told to stop.
 *
 *   dpp-validator                 start the service
 *   dpp-validator health          ask the service configured here whether it is running; exit 0 when it is
 *   dpp-validator --help
 *
 * Configuration is environment only, as for the index, so the same settings
 * serve the command and the image:
 *
 *   VALIDATOR_HOST               the address to listen on. Default 127.0.0.1
 *   VALIDATOR_PORT               the port. Default PORT, else 8090
 *   VALIDATOR_TOKEN              a bearer token the two operations then require. Default: none
 *   VALIDATOR_TIMEOUT_MS         how long one operation may run. Default 10000
 *   VALIDATOR_CONCURRENCY        how many operations run at once. Default 2
 *   VALIDATOR_QUEUE_LIMIT        how many more may wait. Default 16
 *   VALIDATOR_MAX_REQUEST_BYTES  the largest request body read. Default 8388608
 *   VALIDATOR_WORKER_MEMORY_MB   the heap one engine thread may use. Default 512
 *
 * A setting that cannot be read stops the command with exit code 2 and names
 * the variable. Nothing is guessed in its place.
 *
 * The service writes one JSON line per request to standard output: the
 * route, the status, the sizes and the time taken. It writes no document, no
 * file and no finding.
 */
import { VALIDATOR_DEFAULTS, VALIDATOR_PATHS } from './validator-wire.js'
import { startValidatorService, type ValidatorService, type ValidatorServiceOptions } from './validator-service.js'

export interface ValidatorCommandIo {
  env?: Record<string, string | undefined>
  stdout?: (line: string) => void
  stderr?: (line: string) => void
  /** Resolves when the service should stop. Default: the process receives SIGTERM or SIGINT. */
  stop?: Promise<void>
  /** Called once the service is listening. */
  started?: (service: ValidatorService) => void
}

const USAGE = [
  'dpp-validator           start the validator service',
  'dpp-validator health    exit 0 when the service configured here answers /health',
  '',
  'Settings are read from the environment: VALIDATOR_HOST (127.0.0.1), VALIDATOR_PORT (PORT, else 8090), VALIDATOR_TOKEN,',
  'VALIDATOR_TIMEOUT_MS (10000), VALIDATOR_CONCURRENCY (2), VALIDATOR_QUEUE_LIMIT (16), VALIDATOR_MAX_REQUEST_BYTES (8388608),',
  'VALIDATOR_WORKER_MEMORY_MB (512).',
]

class SettingError extends Error {}

/** The settings the environment names. Throws `SettingError`, naming the variable, for one that cannot be read. */
export function validatorSettingsFromEnvironment(env: Record<string, string | undefined>): Required<Pick<ValidatorServiceOptions, 'host' | 'port'>> & ValidatorServiceOptions {
  const text = (name: string): string | undefined => { const value = env[name]; return value == null || value === '' ? undefined : value }
  const whole = (name: string, minimum: number): number | undefined => {
    const value = text(name)
    if (value == null) return undefined
    if (!/^\d{1,10}$/.test(value) || Number(value) < minimum) throw new SettingError(`${name} must be a whole number, ${minimum} or more.`)
    return Number(value)
  }
  const port = whole('VALIDATOR_PORT', 0) ?? whole('PORT', 0) ?? VALIDATOR_DEFAULTS.port
  if (port > 65535) throw new SettingError('VALIDATOR_PORT must be a port number, 65535 or less.')
  const token = text('VALIDATOR_TOKEN')
  if (token != null && !/^[\x21-\x7e]+$/.test(token)) throw new SettingError('VALIDATOR_TOKEN must be visible ASCII with no spaces.')
  const optional = <K extends keyof ValidatorServiceOptions>(key: K, value: ValidatorServiceOptions[K] | undefined): Partial<ValidatorServiceOptions> => (value == null ? {} : { [key]: value })
  return {
    host: text('VALIDATOR_HOST') ?? '127.0.0.1',
    port,
    ...optional('token', token),
    ...optional('timeoutMs', whole('VALIDATOR_TIMEOUT_MS', 1)),
    ...optional('concurrency', whole('VALIDATOR_CONCURRENCY', 1)),
    ...optional('queueLimit', whole('VALIDATOR_QUEUE_LIMIT', 0)),
    ...optional('maxRequestBytes', whole('VALIDATOR_MAX_REQUEST_BYTES', 1)),
    ...optional('maxWorkerMemoryMb', whole('VALIDATOR_WORKER_MEMORY_MB', 64)),
  }
}

/** Runs the command and resolves with its exit code. It does not exit the process itself. */
export async function runValidatorCommand(args: readonly string[], io: ValidatorCommandIo = {}): Promise<number> {
  const env = io.env ?? process.env
  const out = io.stdout ?? ((line: string) => { process.stdout.write(`${line}\n`) })
  const err = io.stderr ?? ((line: string) => { process.stderr.write(`${line}\n`) })
  const [command, ...rest] = args
  if (command === '--help' || command === '-h' || command === 'help') { USAGE.forEach(out); return 0 }
  if ((command != null && command !== 'health') || rest.length > 0) { err(`dpp-validator does not know ${JSON.stringify(args.join(' '))}.`); USAGE.forEach(err); return 2 }

  let settings: ReturnType<typeof validatorSettingsFromEnvironment>
  try {
    settings = validatorSettingsFromEnvironment(env)
  } catch (cause) {
    if (!(cause instanceof SettingError)) throw cause
    err(cause.message)
    return 2
  }

  if (command === 'health') {
    // A service that listens on every address is asked on this machine's own.
    const host = settings.host === '0.0.0.0' || settings.host === '::' ? '127.0.0.1' : settings.host
    const address = `http://${host.includes(':') ? `[${host}]` : host}:${settings.port}${VALIDATOR_PATHS.health}`
    try {
      const response = await fetch(address, { redirect: 'manual', signal: AbortSignal.timeout(3000) })
      const body = (await response.json()) as { ok?: unknown }
      if (response.status === 200 && body.ok === true) { out(`The validator service at ${address} is running.`); return 0 }
      err(`The validator service at ${address} answered ${response.status} and is not ready.`)
    } catch {
      err(`No validator service answered at ${address}.`)
    }
    return 1
  }

  let service: ValidatorService
  try {
    service = await startValidatorService({ ...settings, log: (entry) => out(JSON.stringify({ at: new Date().toISOString(), ...entry })) })
  } catch (cause) {
    err(cause instanceof Error ? cause.message : String(cause))
    return 1
  }
  out(JSON.stringify({ at: new Date().toISOString(), event: 'listening', url: service.url, token: settings.token == null ? 'not required' : 'required', ...service.capabilities }))
  io.started?.(service)
  await (io.stop ?? new Promise<void>((resolve) => { for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => resolve()) }))
  await service.close()
  out(JSON.stringify({ at: new Date().toISOString(), event: 'stopped' }))
  return 0
}
