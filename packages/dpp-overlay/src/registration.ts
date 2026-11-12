/**
 * Self-service registration, the persistent half (the request is
 * `spec/services.md` section 2's; what an accepted one does is this package's,
 * in its README): the policy versions an index appends when it admits a
 * registered publisher, and the record of each registration by publisher
 * key. The route and the operator commands (`index.ts`, `registrationsCommand.ts`)
 * drive one state machine over these records; this module keeps them.
 *
 * Three stores share one contract. Memory for tests and the memory-only node.
 * The policy file itself, when `PUBLISHER_POLICY_FILE` names one: an
 * appended version is written back into the file as the next element of the
 * chain, so the file stays the one record of the policy, and the
 * registrations sit beside it in `<name>.registrations.json`; both are
 * re-read when their modification time or size changed, so a version the
 * operator's command line appended reaches a running index. The index's
 * MongoDB database, for a hosted index: `publisherPolicyVersionsV1`, unique
 * on the version number, and `registrationsV1`, unique on the publisher key.
 *
 * What the store holds is never trusted on its own: at boot the configured
 * chain and the stored versions are verified as one chain
 * (`mergeAppendedVersions`), and a stored version that no longer verifies
 * stops the boot by name. A running index refreshes the same way
 * (`refreshPolicyChain`), into the array the topic managers already hold.
 */
import { accessSync, constants, existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { basename, dirname, extname, join } from 'node:path'
import type { Collection, Db } from 'mongodb'
import { PrivateKey } from '@bsv/sdk'
import { appendPublisherVersion, publisherKeysAt, verifyPolicyChain, type PublisherChange, type PublisherPolicy, type RegistrationRequest } from '@bsv/dpp-protocol'
import type { PublisherPolicyConfig } from './policyConfig.js'
import { issueToken, type PublisherTokenStore } from './publisherTokens.js'

export const REGISTRATIONS_FORMAT = 'dpp-registrations@1' as const

export type RegistrationStatus = 'pending' | 'approved' | 'collected' | 'registered' | 'refused' | 'revoked'

export interface Registration {
  /** Compressed public key, lower-case hex: the one key this record is about. */
  publisherKey: string
  /** The application's own name for itself, from its first request. */
  label: string
  network: string
  custodyProfile: string
  /** From the first request. */
  requestedAt: string
  status: RegistrationStatus
  /** The version that admitted the key, once one was appended. */
  policyVersion?: number
  /** When the operator or the open route decided. */
  decidedAt?: string
  /** When the application collected its credentials under approval. */
  collectedAt?: string
}

export interface RegistrationStore {
  /** Every version the store holds, oldest first: the policy file's whole chain, or the collection's appended versions. */
  versions(): Promise<PublisherPolicy[]>
  /** Adds a version; refuses a version number the store already holds. */
  appendVersion(policy: PublisherPolicy): Promise<void>
  registration(publisherKey: string): Promise<Registration | undefined>
  /** Adds or replaces the record for its publisher key. */
  saveRegistration(record: Registration): Promise<void>
  /** Every record, oldest request first. */
  listRegistrations(): Promise<Registration[]>
}

const byVersion = (a: PublisherPolicy, b: PublisherPolicy): number => a.policyVersion - b.policyVersion
const byRequest = (a: Registration, b: Registration): number => a.requestedAt < b.requestedAt ? -1 : a.requestedAt > b.requestedAt ? 1 : a.publisherKey < b.publisherKey ? -1 : 1
const duplicate = (version: number): Error => new Error(`the store already holds policy version ${version}`)
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export class InMemoryRegistrationStore implements RegistrationStore {
  private readonly held: PublisherPolicy[] = []
  private readonly records = new Map<string, Registration>()

  async versions(): Promise<PublisherPolicy[]> {
    return this.held.map(clean)
  }

  async appendVersion(policy: PublisherPolicy): Promise<void> {
    if (this.held.some((p) => p.policyVersion === policy.policyVersion)) throw duplicate(policy.policyVersion)
    this.held.push(clean(policy))
    this.held.sort(byVersion)
  }

  async registration(publisherKey: string): Promise<Registration | undefined> {
    const record = this.records.get(publisherKey)
    return record == null ? undefined : clean(record)
  }

  async saveRegistration(record: Registration): Promise<void> {
    this.records.set(record.publisherKey, clean(record))
  }

  async listRegistrations(): Promise<Registration[]> {
    return [...this.records.values()].map(clean).sort(byRequest)
  }
}

interface RegistrationsDocument { format: typeof REGISTRATIONS_FORMAT; registrations: Registration[] }

/** A JSON file re-read when its modification time or size changed, written through a temporary file and a rename. */
class WatchedJsonFile<T> {
  private seen: { mtimeMs: number; size: number } | undefined
  private value: T | undefined

  constructor(readonly path: string, private readonly parse: (text: string) => T, private readonly empty: () => T) {}

  read(): T {
    if (!existsSync(this.path)) {
      this.seen = undefined
      this.value = this.empty()
      return this.value
    }
    const stat = statSync(this.path)
    if (this.value != null && this.seen != null && this.seen.mtimeMs === stat.mtimeMs && this.seen.size === stat.size) return this.value
    this.value = this.parse(readFileSync(this.path, 'utf8'))
    this.seen = { mtimeMs: stat.mtimeMs, size: stat.size }
    return this.value
  }

  write(value: T): void {
    const temporary = join(dirname(this.path), `.${randomBytes(6).toString('hex')}.${basename(this.path)}.tmp`)
    try {
      writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o644 })
      renameSync(temporary, this.path)
    } finally {
      rmSync(temporary, { force: true })
    }
    const stat = statSync(this.path)
    this.seen = { mtimeMs: stat.mtimeMs, size: stat.size }
    this.value = value
  }
}

/** The sibling of a policy file that holds its registrations: `publisher-policy.json` has `publisher-policy.registrations.json`. */
export function registrationsFileFor(policyFile: string): string {
  const extension = extname(policyFile)
  return join(dirname(policyFile), `${basename(policyFile, extension)}.registrations${extension === '' ? '.json' : extension}`)
}

/**
 * The policy file as the store: its array of versions is the chain, written
 * back whole on each append, and the registrations live in the sibling file.
 */
export class FileRegistrationStore implements RegistrationStore {
  private readonly chain: WatchedJsonFile<PublisherPolicy[]>
  private readonly records: WatchedJsonFile<RegistrationsDocument>

  constructor(readonly path: string) {
    this.chain = new WatchedJsonFile(path, (text) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error(`${path} is not JSON`)
      }
      if (!Array.isArray(parsed)) throw new Error(`${path} must hold a JSON array of dpp-publisher-policy@1 documents, oldest first`)
      return parsed as PublisherPolicy[]
    }, () => [])
    const sibling = registrationsFileFor(path)
    this.records = new WatchedJsonFile(sibling, (text) => {
      let parsed: RegistrationsDocument
      try {
        parsed = JSON.parse(text) as RegistrationsDocument
      } catch {
        throw new Error(`${sibling} is not JSON`)
      }
      if (parsed?.format !== REGISTRATIONS_FORMAT || !Array.isArray(parsed.registrations)) throw new Error(`${sibling} is not a ${REGISTRATIONS_FORMAT} document`)
      return parsed
    }, () => ({ format: REGISTRATIONS_FORMAT, registrations: [] }))
  }

  /** Where the registrations are kept, for logs. */
  get registrationsPath(): string {
    return this.records.path
  }

  /** Throws when the policy file, or the directory a sibling goes into, cannot be written: registration would then fail at its first success. */
  assertWritable(): void {
    try {
      accessSync(this.path, constants.W_OK)
      accessSync(dirname(this.path), constants.W_OK)
    } catch {
      throw new Error(`PUBLISHER_POLICY_FILE ${this.path} is not writable by this process, and registration appends to it`)
    }
  }

  async versions(): Promise<PublisherPolicy[]> {
    return this.chain.read().map(clean)
  }

  async appendVersion(policy: PublisherPolicy): Promise<void> {
    const held = this.chain.read()
    if (held.some((p) => p.policyVersion === policy.policyVersion)) throw duplicate(policy.policyVersion)
    this.chain.write([...held, clean(policy)].sort(byVersion))
  }

  async registration(publisherKey: string): Promise<Registration | undefined> {
    const record = this.records.read().registrations.find((r) => r.publisherKey === publisherKey)
    return record == null ? undefined : clean(record)
  }

  async saveRegistration(record: Registration): Promise<void> {
    const document = this.records.read()
    const registrations = [...document.registrations.filter((r) => r.publisherKey !== record.publisherKey), clean(record)].sort(byRequest)
    this.records.write({ format: REGISTRATIONS_FORMAT, registrations })
  }

  async listRegistrations(): Promise<Registration[]> {
    return this.records.read().registrations.map(clean).sort(byRequest)
  }
}

/** The index's database: `publisherPolicyVersionsV1` unique on the version number, `registrationsV1` unique on the publisher key. */
export class MongoRegistrationStore implements RegistrationStore {
  private readonly policies: Collection<PublisherPolicy>
  private readonly records: Collection<Registration>
  private indexed = false

  constructor(db: Db) {
    this.policies = db.collection<PublisherPolicy>('publisherPolicyVersionsV1')
    this.records = db.collection<Registration>('registrationsV1')
  }

  private async ensureIndexes(): Promise<void> {
    if (this.indexed) return
    await this.policies.createIndex({ policyVersion: 1 }, { unique: true })
    await this.records.createIndex({ publisherKey: 1 }, { unique: true })
    this.indexed = true
  }

  async versions(): Promise<PublisherPolicy[]> {
    await this.ensureIndexes()
    return await this.policies.find({}, { projection: { _id: 0 } }).sort({ policyVersion: 1 }).toArray()
  }

  async appendVersion(policy: PublisherPolicy): Promise<void> {
    await this.ensureIndexes()
    if ((await this.policies.countDocuments({ policyVersion: policy.policyVersion }, { limit: 1 })) > 0) throw duplicate(policy.policyVersion)
    await this.policies.insertOne(clean(policy))
  }

  async registration(publisherKey: string): Promise<Registration | undefined> {
    await this.ensureIndexes()
    const record = await this.records.findOne({ publisherKey }, { projection: { _id: 0 } })
    return record ?? undefined
  }

  async saveRegistration(record: Registration): Promise<void> {
    await this.ensureIndexes()
    await this.records.replaceOne({ publisherKey: record.publisherKey }, clean(record), { upsert: true })
  }

  async listRegistrations(): Promise<Registration[]> {
    await this.ensureIndexes()
    return (await this.records.find({}, { projection: { _id: 0 } }).toArray()).sort(byRequest)
  }
}

/**
 * The configured chain extended by every stored version newer than its
 * newest, verified as one chain against the operator keys. A stored version
 * that does not verify is an error naming the version and the reason: the
 * boot stops on it, and a running refresh reports it.
 */
export function mergeAppendedVersions(
  configured: PublisherPolicy[],
  stored: PublisherPolicy[],
  operators: Record<string, string>
): { chain: PublisherPolicy[]; versions: number[] } {
  const newest = configured.length === 0 ? 0 : configured[configured.length - 1].policyVersion
  const extra = stored.filter((p) => p.policyVersion > newest).sort(byVersion)
  const chain = [...configured, ...extra]
  const result = verifyPolicyChain(chain, operators)
  if (!result.ok || result.failure != null) {
    const failure = result.failure ?? { version: 0, reason: 'format', detail: 'the chain did not verify' }
    throw new Error(`appended policy version ${failure.version} refused, ${failure.reason}: ${failure.detail}`)
  }
  return { chain, versions: result.versions }
}

/**
 * Bring a running configuration up to the store, in place: the chain array
 * the topic managers and GET /publisher-policy hold grows by the versions
 * the store has beyond it, and `versions` follows. Returns the version
 * numbers added.
 */
export async function refreshPolicyChain(config: PublisherPolicyConfig, store: RegistrationStore): Promise<number[]> {
  const merged = mergeAppendedVersions(config.chain, await store.versions(), config.operators)
  const added = merged.chain.slice(config.chain.length)
  config.chain.push(...added)
  config.versions.splice(0, config.versions.length, ...merged.versions)
  return added.map((p) => p.policyVersion)
}

/**
 * The store the environment selects: the index's MongoDB database when there
 * is one, else the policy file `PUBLISHER_POLICY_FILE` names, else none: a
 * chain held inline in `PUBLISHER_POLICY_JSON` has nowhere to grow.
 */
export function registrationStoreFromEnvironment(env: Record<string, string | undefined>, db: Db | undefined): RegistrationStore | undefined {
  if (db != null) return new MongoRegistrationStore(db)
  const file = (env.PUBLISHER_POLICY_FILE ?? '').trim()
  if (file !== '') return new FileRegistrationStore(file)
  return undefined
}

export type RegistrationMode = 'open' | 'approval'

export interface RegistrationSettings {
  mode: RegistrationMode
  /** OPERATOR_SIGNING_KEY: the identity key of the operator in the policy's scope, which signs each appended version. */
  signingKey: PrivateKey
  /** PUBLIC_URL: what a request's indexUrl is compared with. */
  indexUrl: string
  /** The custody profile the capability document declares, which a request must name. */
  custodyProfile: string
  store: RegistrationStore
  /** REGISTRATION_RATE_LIMIT: requests per source address per hour; default 10. */
  rateLimitPerHour: number
  /** TRUST_PROXY=1: the source address is the first hop of X-Forwarded-For. */
  trustProxy: boolean
}

export const DEFAULT_REGISTRATION_RATE_LIMIT = 10

/** Whether two index addresses name the same index: scheme, host and path, with one trailing slash and host case ignored; a query or fragment counts. */
export function sameIndexUrl(a: string, b: string): boolean {
  const normalise = (value: string): string | undefined => {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      return undefined
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname
    return `${url.origin}${path}${url.search}${url.hash}`
  }
  const left = normalise(a)
  return left != null && left === normalise(b)
}

/** OPERATOR_SIGNING_KEY: the identity key of an operator in the policy's newest scope, which signs each appended version. */
export function operatorSigningKeyFromEnvironment(env: Record<string, string | undefined>, policy: PublisherPolicyConfig): PrivateKey {
  const keyHex = (env.OPERATOR_SIGNING_KEY ?? '').trim()
  if (keyHex === '') throw new Error('set OPERATOR_SIGNING_KEY, the identity key of the operator in the policy scope, to sign an appended policy version')
  let signingKey: PrivateKey
  try {
    signingKey = PrivateKey.fromHex(keyHex)
  } catch {
    throw new Error('OPERATOR_SIGNING_KEY is not a private key in hex')
  }
  const signer = signingKey.toPublicKey().toString()
  const newest = policy.chain[policy.chain.length - 1]
  if (!newest.scope.operators.some((op) => policy.operators[op] === signer)) throw new Error('OPERATOR_SIGNING_KEY is not the identity key of an operator in the policy scope (OPERATOR_IDENTITY_KEYS)')
  return signingKey
}

/**
 * The settings REGISTRATION selects, checked at boot so a misconfigured
 * registration stops the index rather than failing at the first request:
 * a policy chain, a store it can grow in (MongoDB, or a writable policy
 * file; a chain held inline has nowhere to grow), a single-operator scope,
 * the operator's own signing key, and the public address a request must
 * name. Unset, registration is off and nothing else here is consulted.
 */
export function registrationSettingsFromEnvironment(
  env: Record<string, string | undefined>,
  policy: PublisherPolicyConfig | undefined,
  store: RegistrationStore | undefined,
  custodyProfile: string
): RegistrationSettings | undefined {
  const declared = (env.REGISTRATION ?? '').trim()
  if (declared === '') return undefined
  if (declared !== 'open' && declared !== 'approval') throw new Error(`REGISTRATION must be open or approval, got "${declared}"`)
  if (policy == null) throw new Error('REGISTRATION needs a publisher policy (PUBLISHER_POLICY_FILE with OPERATOR_IDENTITY_KEYS): a registered key is admitted through a policy version')
  if (store == null) throw new Error('REGISTRATION needs MONGO_URL or PUBLISHER_POLICY_FILE: a chain held in PUBLISHER_POLICY_JSON has nowhere to grow')
  if (store instanceof FileRegistrationStore) store.assertWritable()
  const newest = policy.chain[policy.chain.length - 1]
  if (newest.scope.operatorProfile !== 'single-operator@1') throw new Error(`REGISTRATION appends to a single-operator@1 scope; this policy is ${newest.scope.operatorProfile}, whose rotations need a countersignature`)
  const signingKey = operatorSigningKeyFromEnvironment(env, policy)
  const indexUrl = (env.PUBLIC_URL ?? '').trim()
  if (indexUrl === '' || !sameIndexUrl(indexUrl, indexUrl)) throw new Error('REGISTRATION needs PUBLIC_URL, the http or https address applications register against')
  const limitText = (env.REGISTRATION_RATE_LIMIT ?? '').trim()
  const rateLimitPerHour = limitText === '' ? DEFAULT_REGISTRATION_RATE_LIMIT : Number(limitText)
  if (!Number.isInteger(rateLimitPerHour) || rateLimitPerHour < 1) throw new Error('REGISTRATION_RATE_LIMIT must be a positive integer, requests per source address per hour')
  return { mode: declared, signingKey, indexUrl, custodyProfile, store, rateLimitPerHour, trustProxy: (env.TRUST_PROXY ?? '').trim() === '1' }
}

/** Requests per source address in a sliding hour: a map of address to the instants of its recent requests. */
export class RegistrationRateLimiter {
  private readonly recent = new Map<string, number[]>()

  constructor(private readonly perHour: number) {}

  /** Records a request from `source` at `at` and says whether it is within the limit. */
  allow(source: string, at: Date): boolean {
    const now = at.getTime()
    const floor = now - 60 * 60 * 1000
    const kept = (this.recent.get(source) ?? []).filter((t) => t > floor)
    if (kept.length >= this.perHour) {
      this.recent.set(source, kept)
      return false
    }
    kept.push(now)
    this.recent.set(source, kept)
    // Addresses whose hour has passed are dropped on the way, so the map is bounded by the live sources.
    for (const [address, times] of this.recent) if (address !== source && times.every((t) => t <= floor)) this.recent.delete(address)
    return true
  }
}

const MAX_SOURCE_LENGTH = 64

/**
 * The address a request counts against: the socket's peer, or, when the
 * operator trusts the proxy in front of the index, the hop that proxy
 * appended last to X-Forwarded-For (the first hop is whatever the client
 * chose to send). Bounded, so a header cannot grow the limiter's map.
 */
export function sourceAddress(headers: Record<string, string | string[] | undefined>, remoteAddress: string | undefined, trustProxy: boolean): string {
  if (trustProxy) {
    const header = headers['x-forwarded-for']
    const raw = Array.isArray(header) ? header[header.length - 1] : header
    const hops = (raw ?? '').split(',').map((hop) => hop.trim()).filter((hop) => hop !== '')
    const last = hops[hops.length - 1]
    if (last != null) return last.slice(0, MAX_SOURCE_LENGTH)
  }
  return (remoteAddress ?? 'unknown').slice(0, MAX_SOURCE_LENGTH)
}

export interface RegistrationContext {
  settings: RegistrationSettings
  policy: PublisherPolicyConfig
  tokens: PublisherTokenStore
}

export type RegistrationOutcome =
  | { kind: 'registered'; policyVersion: number; tokens: { submit: string; callback: string } }
  | { kind: 'pending' }
  | { kind: 'already-registered' }
  | { kind: 'refused' }
  | { kind: 'revoked' }
  | { kind: 'full' }

/** One registration transition at a time per process: two requests in flight would both build on the same newest version, or both pass the same record check. */
let transitionQueue: Promise<unknown> = Promise.resolve()

async function serialised<T>(run: () => Promise<T>): Promise<T> {
  const next = transitionQueue.then(run, run)
  transitionQueue = next.catch(() => undefined)
  return await next
}

const duplicateVersion = (cause: unknown): boolean =>
  (cause instanceof Error && /already holds policy version/.test(cause.message)) || (typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 11000)

/** The next version for one change, built on the chain as the store now has it, kept, and pushed into the array the topic managers hold. */
async function appendNow(policy: PublisherPolicyConfig, store: RegistrationStore, signingKey: PrivateKey, change: PublisherChange, now: Date): Promise<PublisherPolicy> {
  await refreshPolicyChain(policy, store)
  // Strictly after the newest version even when the clock has not moved since it was issued.
  const newest = policy.chain[policy.chain.length - 1]
  const at = newest != null && now.getTime() <= Date.parse(newest.issuedAt) ? new Date(Date.parse(newest.issuedAt) + 1) : now
  const version = appendPublisherVersion(policy.chain, policy.operators, change, signingKey, at)
  await store.appendVersion(version)
  policy.chain.push(version)
  policy.versions.push(version.policyVersion)
  return version
}

/**
 * Append a version for one change: the running chain is first brought up to
 * the store, the operator signs the next version, the store keeps it, and
 * the array the topic managers hold grows by it. Serialised in this process;
 * when another process appended the same version number first (the store's
 * uniqueness says so), the chain is refreshed and the version rebuilt once.
 */
export async function appendRegistrationVersion(
  policy: PublisherPolicyConfig,
  store: RegistrationStore,
  signingKey: PrivateKey,
  change: PublisherChange,
  now: Date
): Promise<PublisherPolicy> {
  return await serialised(async () => {
    try {
      return await appendNow(policy, store, signingKey, change, now)
    } catch (cause) {
      if (!duplicateVersion(cause)) throw cause
      return await appendNow(policy, store, signingKey, change, now)
    }
  })
}

const stamp = (at: Date): string => at.toISOString()

/**
 * The state machine behind POST /register, for a request that has passed
 * inspection, run as one transition: the record and the chain are read
 * together, so two requests for one key in flight settle as one
 * registration. A key with no record registers at once in open mode, or
 * waits as pending under approval; an approved key collects its tokens once;
 * a key that registered or collected already, that the policy names without
 * a record, or that was refused or revoked, is told so. The record is saved
 * before the tokens are issued, so a failure in between leaves a registered
 * key the operator reissues for, never an active key nobody can account for.
 */
export async function processRegistration(context: RegistrationContext, request: RegistrationRequest, now: Date): Promise<RegistrationOutcome> {
  const { settings, policy, tokens } = context
  const { store } = settings
  const issue = async (label: string): Promise<{ submit: string; callback: string }> => ({
    submit: (await issueToken(tokens, request.publisherKey, 'submit', label, () => now)).token,
    callback: (await issueToken(tokens, request.publisherKey, 'callback', label, () => now)).token,
  })
  return await serialised(async () => {
    await refreshPolicyChain(policy, store)
    const existing = await store.registration(request.publisherKey)
    if (existing == null) {
      if (publisherKeysAt(policy.chain, now).includes(request.publisherKey)) return { kind: 'already-registered' }
      const record: Registration = { publisherKey: request.publisherKey, label: request.label, network: request.network, custodyProfile: request.custodyProfile, requestedAt: request.requestedAt, status: 'pending' }
      if (settings.mode === 'approval') {
        await store.saveRegistration(record)
        return { kind: 'pending' }
      }
      let version: PublisherPolicy
      try {
        version = await appendNow(policy, store, settings.signingKey, { add: { key: request.publisherKey, role: 'state-publisher' } }, now)
      } catch (cause) {
        if (cause instanceof Error && /at most \d+ publisher entries/.test(cause.message)) return { kind: 'full' }
        if (!duplicateVersion(cause)) throw cause
        version = await appendNow(policy, store, settings.signingKey, { add: { key: request.publisherKey, role: 'state-publisher' } }, now)
      }
      await store.saveRegistration({ ...record, status: 'registered', policyVersion: version.policyVersion, decidedAt: stamp(now) })
      return { kind: 'registered', policyVersion: version.policyVersion, tokens: await issue(request.label) }
    }
    switch (existing.status) {
      case 'pending':
        return { kind: 'pending' }
      case 'approved': {
        // The version the operator appended out of process reached this index in the refresh above.
        await store.saveRegistration({ ...existing, status: 'collected', collectedAt: stamp(now) })
        return { kind: 'registered', policyVersion: existing.policyVersion ?? policy.chain[policy.chain.length - 1].policyVersion, tokens: await issue(existing.label) }
      }
      case 'refused':
        return { kind: 'refused' }
      case 'revoked':
        return { kind: 'revoked' }
      default:
        return { kind: 'already-registered' }
    }
  })
}
