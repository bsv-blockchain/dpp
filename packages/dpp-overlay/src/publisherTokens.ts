/**
 * Per-publisher write tokens (this package's README, write tokens; deployment
 * policy, not part of the standard): a bearer that belongs to one publisher or anchoring key and one
 * use, so that an index with several writers hands each its own credential
 * and a leaked token can write only what its key signs.
 *
 * A token is 32 random bytes as 64 hexadecimal characters, shown once when it
 * is issued and never stored: the store keeps its SHA-256, the key it belongs
 * to, its use (`submit` for POST /submit and POST /retract, `callback` for
 * POST /arc-ingest), an operator label and the issue and revocation times. A
 * revoked record stays, so a revoked token is refused as revoked and not as
 * unknown. Which key signed a submission is checked by the HTTP host against
 * the record's key; the store only says who a token belongs to.
 *
 * Three stores share one contract: memory for tests and the memory-only node,
 * a JSON file for an operator project whose index reads a mounted directory,
 * and a MongoDB collection beside the engine's own storage for a hosted index.
 * The file store re-reads the file whenever its modification time or size
 * changed, so a token issued or revoked by the command line on the host takes
 * effect in a running index without a restart; the Mongo store reads per
 * lookup. The legacy operator-wide SUBMIT_TOKEN and ARC_CALLBACK_TOKEN keep
 * working beside these.
 */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Collection, Db } from 'mongodb'

export const PUBLISHER_TOKENS_FORMAT = 'dpp-publisher-tokens@1' as const

export type TokenUse = 'submit' | 'callback'
export const TOKEN_USES: readonly TokenUse[] = ['submit', 'callback']

export interface PublisherToken {
  /** SHA-256 of the token's UTF-8 bytes, lower-case hex: the only form kept. */
  sha256: string
  /** The compressed public key the token belongs to, lower-case hex: a state publisher or an anchoring service. */
  publisherKey: string
  use: TokenUse
  /** The operator's own name for the holder, at most 128 printable bytes. */
  label: string
  issuedAt: string
  revokedAt?: string
}

export interface PublisherTokenStore {
  find(sha256: string): Promise<PublisherToken | undefined>
  /** Adds a record; refuses a digest the store already holds. */
  issue(record: PublisherToken): Promise<void>
  /** Marks a live record revoked at `at`; false when the digest is unknown or already revoked. */
  revoke(sha256: string, at: string): Promise<boolean>
  /** Every record, oldest issue first. */
  list(): Promise<PublisherToken[]>
}

const COMPRESSED_KEY = /^0[23][0-9a-f]{64}$/
const DIGEST = /^[0-9a-f]{64}$/
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u
const MAX_LABEL_BYTES = 128

/** A fresh token: 32 random bytes, 64 lower-case hexadecimal characters. */
export function newToken(): string {
  return randomBytes(32).toString('hex')
}

/** The stored form of a token. */
export function tokenDigest(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Issue a token for a key and a use: the plain token is returned once with the record the store now holds. */
export async function issueToken(
  store: PublisherTokenStore,
  publisherKey: string,
  use: TokenUse,
  label: string,
  now: () => Date = () => new Date()
): Promise<{ token: string; record: PublisherToken }> {
  const key = String(publisherKey).trim().toLowerCase()
  if (!COMPRESSED_KEY.test(key)) throw new Error('the publisher key must be a compressed public key, 66 hexadecimal characters')
  if (!TOKEN_USES.includes(use)) throw new Error(`the use must be one of ${TOKEN_USES.join(', ')}`)
  if (typeof label !== 'string' || label === '' || Buffer.byteLength(label, 'utf8') > MAX_LABEL_BYTES || CONTROL.test(label)) {
    throw new Error(`the label must be printable text of at most ${MAX_LABEL_BYTES} bytes`)
  }
  const token = newToken()
  const record: PublisherToken = { sha256: tokenDigest(token), publisherKey: key, use, label, issuedAt: now().toISOString().replace(/\.\d{3}Z$/, 'Z') }
  await store.issue(record)
  return { token, record }
}

function checkRecord(record: PublisherToken): void {
  if (!DIGEST.test(record.sha256)) throw new Error('a token record names its digest as 64 hexadecimal characters')
  if (!COMPRESSED_KEY.test(record.publisherKey)) throw new Error('a token record names a compressed public key')
  if (!TOKEN_USES.includes(record.use)) throw new Error('a token record names a known use')
}

/** Records in memory: the test double and the memory-only node, which then has no per-publisher tokens. */
export class InMemoryPublisherTokenStore implements PublisherTokenStore {
  private readonly records = new Map<string, PublisherToken>()

  async find(sha256: string): Promise<PublisherToken | undefined> {
    const record = this.records.get(sha256)
    return record == null ? undefined : { ...record }
  }

  async issue(record: PublisherToken): Promise<void> {
    checkRecord(record)
    if (this.records.has(record.sha256)) throw new Error('a token with that digest is already issued')
    this.records.set(record.sha256, { ...record })
  }

  async revoke(sha256: string, at: string): Promise<boolean> {
    const record = this.records.get(sha256)
    if (record == null || record.revokedAt != null) return false
    record.revokedAt = at
    return true
  }

  async list(): Promise<PublisherToken[]> {
    return [...this.records.values()].map((r) => ({ ...r }))
  }
}

interface TokenDocument {
  format: typeof PUBLISHER_TOKENS_FORMAT
  tokens: PublisherToken[]
}

/**
 * Records in one JSON file, `{ format: "dpp-publisher-tokens@1", tokens: [...] }`.
 * A missing file is an empty store, created by the first issue. Writes go to a
 * sibling temporary file and are renamed into place. Every read checks the
 * file's modification time and size and re-reads on a change, so a second
 * writer on the same path, the command line beside a running index, is seen.
 */
export class FilePublisherTokenStore implements PublisherTokenStore {
  private records: PublisherToken[] = []
  private seen: { mtimeMs: number; size: number } | undefined

  constructor(private readonly path: string) {}

  private load(): void {
    if (!existsSync(this.path)) {
      this.records = []
      this.seen = undefined
      return
    }
    const stat = statSync(this.path)
    if (this.seen != null && this.seen.mtimeMs === stat.mtimeMs && this.seen.size === stat.size) return
    let document: TokenDocument
    try {
      document = JSON.parse(readFileSync(this.path, 'utf8')) as TokenDocument
    } catch (cause) {
      throw new Error(`${this.path} is not a JSON token file: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
    if (document?.format !== PUBLISHER_TOKENS_FORMAT || !Array.isArray(document.tokens)) {
      throw new Error(`${this.path} is not a ${PUBLISHER_TOKENS_FORMAT} document`)
    }
    for (const record of document.tokens) checkRecord(record)
    this.records = document.tokens.map((r) => ({ ...r }))
    this.seen = { mtimeMs: stat.mtimeMs, size: stat.size }
  }

  private save(): void {
    const document: TokenDocument = { format: PUBLISHER_TOKENS_FORMAT, tokens: this.records }
    const temporary = join(dirname(this.path), `.${randomBytes(6).toString('hex')}.tokens.tmp`)
    // Readable by every user: the file holds SHA-256 digests of 256-bit random
    // tokens, never a token, and the index in a container reads it as a user
    // other than the operator who ran the command.
    try {
      writeFileSync(temporary, JSON.stringify(document, null, 2) + '\n', { mode: 0o644 })
      renameSync(temporary, this.path)
    } finally {
      rmSync(temporary, { force: true })
    }
    const stat = statSync(this.path)
    this.seen = { mtimeMs: stat.mtimeMs, size: stat.size }
  }

  async find(sha256: string): Promise<PublisherToken | undefined> {
    this.load()
    const record = this.records.find((r) => r.sha256 === sha256)
    return record == null ? undefined : { ...record }
  }

  async issue(record: PublisherToken): Promise<void> {
    checkRecord(record)
    this.load()
    if (this.records.some((r) => r.sha256 === record.sha256)) throw new Error('a token with that digest is already issued')
    this.records.push({ ...record })
    this.save()
  }

  async revoke(sha256: string, at: string): Promise<boolean> {
    this.load()
    const record = this.records.find((r) => r.sha256 === sha256)
    if (record == null || record.revokedAt != null) return false
    record.revokedAt = at
    this.save()
    return true
  }

  async list(): Promise<PublisherToken[]> {
    this.load()
    return this.records.map((r) => ({ ...r }))
  }
}

/** Records in the collection `publisherTokensV1` of the index's database, unique on the digest. */
export class MongoPublisherTokenStore implements PublisherTokenStore {
  private readonly records: Collection<PublisherToken>
  private indexed = false

  constructor(db: Db) {
    this.records = db.collection<PublisherToken>('publisherTokensV1')
  }

  private async ensureIndexes(): Promise<void> {
    if (this.indexed) return
    await this.records.createIndex({ sha256: 1 }, { unique: true })
    await this.records.createIndex({ issuedAt: 1 })
    this.indexed = true
  }

  async find(sha256: string): Promise<PublisherToken | undefined> {
    await this.ensureIndexes()
    const record = await this.records.findOne({ sha256 }, { projection: { _id: 0 } })
    return record ?? undefined
  }

  async issue(record: PublisherToken): Promise<void> {
    checkRecord(record)
    await this.ensureIndexes()
    if ((await this.records.countDocuments({ sha256: record.sha256 }, { limit: 1 })) > 0) throw new Error('a token with that digest is already issued')
    await this.records.insertOne({ ...record })
  }

  async revoke(sha256: string, at: string): Promise<boolean> {
    await this.ensureIndexes()
    const result = await this.records.updateOne({ sha256, revokedAt: { $exists: false } }, { $set: { revokedAt: at } })
    return result.modifiedCount === 1
  }

  async list(): Promise<PublisherToken[]> {
    await this.ensureIndexes()
    return await this.records.find({}, { projection: { _id: 0 } }).sort({ issuedAt: 1, sha256: 1 }).toArray()
  }
}

/**
 * What the boot log says about write access, once the store is known: a route
 * is open only when it has neither a legacy token nor a per-publisher store.
 */
export function writeAccessWarnings(settings: { submitToken?: string; proofToken?: string; store: boolean }): string[] {
  const warnings: string[] = []
  const legacySubmit = settings.submitToken != null && settings.submitToken !== ''
  const legacyProof = settings.proofToken != null && settings.proofToken !== ''
  if (!legacySubmit && !settings.store) {
    warnings.push('SUBMIT_TOKEN is unset and no per-publisher token store is configured: POST /submit and POST /retract accept requests from anyone. Set PUBLISHER_TOKENS_FILE or MONGO_URL and issue tokens, or set SUBMIT_TOKEN, on any deployment a stranger can reach.')
  }
  if (!legacyProof && !settings.store) {
    warnings.push('ARC_CALLBACK_TOKEN is unset and no per-publisher token store is configured: POST /arc-ingest accepts proofs from anyone. Each is still verified against block headers before it is stored, so an open route costs header quota, not truth; close it on any deployment a stranger can reach.')
  }
  return warnings
}

/**
 * The store the environment selects: PUBLISHER_TOKENS_FILE names the file
 * store; otherwise the index's MongoDB database when there is one; otherwise
 * memory, which holds nothing, so the memory-only node has operator-wide
 * tokens only.
 */
export function tokenStoreFromEnvironment(env: Record<string, string | undefined>, db: Db | undefined): PublisherTokenStore {
  const file = (env.PUBLISHER_TOKENS_FILE ?? '').trim()
  if (file !== '') return new FilePublisherTokenStore(file)
  if (db != null) return new MongoPublisherTokenStore(db)
  return new InMemoryPublisherTokenStore()
}
