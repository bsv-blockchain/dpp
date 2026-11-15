// The exit exercise: leave one deployment and carry on in another.
//
// Deployment A is this application as it runs by default: MongoDB for its
// records and for the EPCIS exchange, and the two sector profiles read from
// the folder the profiles package ships. It issues a battery and a textile
// passport, imports and pulls EPCIS events, and is exported with the
// operator's `export` command. Then A is switched off: its database and its
// index are stopped, and nothing can be read from it again.
//
// Deployment B is configured differently on the two boundaries a replacement
// must be shown at. Its EPCIS store is the file-system adapter over a folder,
// not MongoDB, and its profiles are read from a profile bundle the restore
// installs, not from the package's folder. It has a database, an index and
// folders of its own. The operator's `restore` command is given the package
// and the key it must be signed under. From then on the network is kept to
// B's own services and the one EPCIS source: any other attempt is refused and
// recorded, and the record must be empty. The guard holds this process only:
// the second restore of B, run as `npm run restore` in a process of its own,
// is outside it.
//
// Deployment C is restored from the same package with keys of its own, none
// of them A's. It shows what the keys are for: C reads every passport and
// verifies it as A did, except for the issuer's authority, which it does not
// confirm without A's brand secret, and C is refused every write by name.
//
// What is real here and what stands in:
//
//   - MongoDB is a real server, started for the test: one for A and one for
//     B. C keeps its own database on B's server.
//   - Each index is the reference index's own code over in-memory storage,
//     with its header checks off. It admits and serves and proves no
//     inclusion: no reading here says a state is in a block.
//   - The wallet is the test wallet, with fixed keys and made-up funding.
//     B holding the same keys stands in for the wallet's own recovery, which
//     is what carries keys between deployments. The package carries none.
//   - The EPCIS source is the small fixture server of these tests.
//   - Sign-in is the development session in all three deployments. Accounts
//     and memberships are not carried by an export.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { PrivateKey } from '@bsv/sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { canonicalJson, evidencePackageSigningKey, signEvidenceManifest, type EvidencePackageManifest } from '@bsv/dpp-protocol'
import { BUNDLED_BINDINGS, profileBindingDigest } from '@bsv/dpp-profiles'
import { EPCIS_GS1_ARTEFACTS } from '@bsv/dpp-credentials'
import { EPCIS_RECORD_KINDS, checkEpcisExchangeInvariants, type EpcisExchangeStorage } from '@bsv/dpp-credentials/epcis-exchange'
import { loadConfig } from '../src/config.js'
import { startDevIndex, type DevIndex } from '../src/dev-index.js'
import { startEpcisExchange, type EpcisExchange } from '../src/epcis/exchange.js'
import { openPlatform, type Platform } from '../src/platform.js'
import { runExportCommand, runRemapCommand, runRestoreCommand } from '../src/portability/commands.js'
import type { ApplicationExportDescriptor } from '../src/portability/package.js'
import type { RestoreReport } from '../src/portability/restore.js'
import type { AuthorisedReading, PassportReading } from '../src/reader.js'
import { createServer } from '../src/server.js'
import { developer, epcisDocument, eventId, gs1Dir, item, objectEvent, sha256, startEpcisSource, utf8, type FixtureSource, type Json } from './epcis-fixtures.js'
import { guardNetwork, type NetworkGuard } from './network-guard.js'

/* --------------------------------- secrets ------------------------------- */

// Each is in no fixture and no key. Wherever one turns up, it was copied there.
const SOURCE_SECRET = 'EXIT-SOURCE-CREDENTIAL-6E2A91D4C7'
const BRAND_SECRET = 'e1'.repeat(32)
const IDENTITY_SECRET = 'e2'.repeat(32)
const AUTH_SECRET = 'e3'.repeat(32)
const RESTRICTED = 'EXIT-RESTRICTED-CANARY-93B7F1'
/** The test wallet's root key, which both deployments hold: the stand-in for the wallet's own recovery. */
const WALLET_ROOT = '11'.repeat(32)
const PUBLISHER_KEY = PrivateKey.fromHex(WALLET_ROOT).toPublicKey().toString()

const scratch = mkdtempSync(join(tmpdir(), 'dpp-exit-exercise-'))
const AUTHORISED = join(scratch, 'export-authorised')
const PUBLIC = join(scratch, 'export-public')

/* ------------------------------- deployments ----------------------------- */

interface Answer {
  status: number
  bytes: Uint8Array
  text: string
  body: any
  headers: Headers
}

interface Deployment {
  platform: Platform
  exchange: EpcisExchange
  lines: string[]
  base: string
  get(path: string): Promise<Answer>
  post(path: string, body: unknown): Promise<Answer>
  upload(path: string, bytes: Uint8Array): Promise<Answer>
  close(): Promise<void>
}

/** The API as main.ts assembles it, from an environment: the platform in its live mode, the exchange beside it and the server. */
async function start(env: Record<string, string>, onListen?: (port: number) => void): Promise<Deployment> {
  const config = loadConfig(env)
  const lines: string[] = []
  const log = (line: string): void => void lines.push(line)
  const platform = await openPlatform({ config, mode: 'live', log })
  const exchange = await startEpcisExchange({ config: config.epcis, ...(platform.db == null ? {} : { db: platform.db }), log })
  const server: Server = createServer({ platform, exchange, devSession: developer }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as AddressInfo).port
  onListen?.(port)
  const base = `http://127.0.0.1:${port}`
  const answer = async (response: Response): Promise<Answer> => {
    const bytes = new Uint8Array(await response.arrayBuffer())
    const text = new TextDecoder().decode(bytes)
    let body: unknown
    try {
      body = text === '' ? undefined : JSON.parse(text)
    } catch {
      body = undefined
    }
    return { status: response.status, bytes, text, body, headers: response.headers }
  }
  return {
    platform,
    exchange,
    lines,
    base,
    get: async (path) => answer(await fetch(`${base}${path}`)),
    post: async (path, body) => answer(await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })),
    upload: async (path, bytes) => answer(await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/ld+json' }, body: bytes as unknown as BodyInit })),
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await exchange.close()
      await platform.close()
    },
  }
}

const ref = (value: string): string => encodeURIComponent(value)
const portOf = (address: string): string => new URL(address).port

/** A command's function, called in this process: its exit code and every line it printed. */
async function command(run: (args: string[], context: { env: NodeJS.ProcessEnv; out: (line: string) => void; cwd: string }) => Promise<number>, args: string[], env: Record<string, string>): Promise<{ code: number; lines: string[]; text: string }> {
  const lines: string[] = []
  const code = await run(args, { env, out: (line) => void lines.push(line), cwd: scratch })
  return { code, lines, text: lines.join('\n') }
}

/** The generated project, whose package.json holds the operator's npm scripts. */
const projectRoot = join(import.meta.dirname, '..', '..', '..')

/**
 * A command exactly as the operator runs it: `npm run <script> -- <args>` in
 * the project, as a process of its own, through the script name, cli.js and
 * its argument parser. The process is given the deployment's settings. cli.js
 * reads the project's .env for any setting its environment does not hold, so
 * every name .env or .env.example sets is passed as well, empty unless the
 * deployment sets it: what the project's own .env holds never reaches the
 * deployment under test.
 */
async function npmRun(script: string, args: string[], env: Record<string, string>): Promise<{ code: number | null; lines: string[]; text: string }> {
  const named = ['.env', '.env.example'].flatMap((file) => (existsSync(join(projectRoot, file)) ? [...readFileSync(join(projectRoot, file), 'utf8').matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((match) => match[1]!) : []))
  // A command that hangs is stopped before the test that ran it times out, so no process outlives the test. npm passes the signal on to the command it runs, and the code is then null.
  const child = spawn('npm', ['run', '--silent', script, '--', ...args], { cwd: projectRoot, env: { ...process.env, ...Object.fromEntries(named.map((name) => [name, ''])), ...env }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 90_000 })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => void (output += chunk.toString('utf8')))
  child.stderr.on('data', (chunk: Buffer) => void (output += chunk.toString('utf8')))
  const [code] = (await once(child, 'close')) as [number | null]
  const lines = output.split('\n').filter((line) => line !== '')
  return { code, lines, text: lines.join('\n') }
}

/** Every file under a folder with its digest, so two moments of a folder can be compared. */
function digestsOf(folder: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string, prefix: string): void => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path, `${prefix}${name}/`)
      else out[`${prefix}${name}`] = createHash('sha256').update(readFileSync(path)).digest('hex')
    }
  }
  walk(folder, '')
  return out
}

/** Every document of every collection of a database, as text. */
async function databaseText(uri: string, name: string): Promise<string> {
  const client = await MongoClient.connect(uri)
  try {
    const db = client.db(name)
    const out: string[] = []
    for (const { name: collection } of (await db.listCollections().toArray()).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const documents = await db.collection(collection).find({}).sort({ _id: 1 }).toArray()
      out.push(`${collection}: ${JSON.stringify(documents)}`)
    }
    return out.join('\n')
  } finally {
    await client.close()
  }
}

/** Every record of an exchange's store of one kind, without revisions. */
async function recordsOf(storage: EpcisExchangeStorage, kind: string): Promise<Array<{ key: string; value: Json }>> {
  return (await storage.list(kind, { limit: 100_000 })).map((held) => ({ key: held.key, value: held.value as Json }))
}

/** A copy of a package with files changed or removed and its manifest signed again by the exporter, as a package assembled that way would be. */
async function repackaged(from: string, name: string, change: (folder: string, manifest: EvidencePackageManifest) => void): Promise<string> {
  const folder = join(scratch, name)
  cpSync(from, folder, { recursive: true })
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')) as EvidencePackageManifest
  change(folder, manifest)
  // The inventory is made to agree with the files as they now are, so the signature is correct for what the folder holds.
  manifest.inventory = manifest.inventory
    .filter((entry) => existsSync(join(folder, entry.path)))
    .map((entry) => {
      const bytes = readFileSync(join(folder, entry.path))
      return { ...entry, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
    })
  const key = evidencePackageSigningKey(PrivateKey.fromHex(WALLET_ROOT), manifest.passportId)
  const { value: _value, ...signature } = manifest.signature
  const signed = await signEvidenceManifest({ ...manifest, signature }, { sign: (preimage) => key.sign(preimage).toDER() as number[] })
  writeFileSync(join(folder, 'manifest.json'), JSON.stringify(signed, null, 2))
  return folder
}

/** Every file of a folder as bytes, for a search. */
function everyFile(folder: string): Array<[string, Buffer]> {
  return Object.keys(digestsOf(folder)).map((path) => [path, readFileSync(join(folder, path))])
}

/** The forms a secret is passed around in. */
const formsOf = (secret: string): string[] => [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64'), Buffer.from(secret).toString('base64url'), Buffer.from(secret).toString('hex')]

/* ---------------------------------- state -------------------------------- */

let mongoA: MongoMemoryServer
let mongoB: MongoMemoryServer
let indexA: DevIndex
let indexB: DevIndex
let source: FixtureSource
let guard: NetworkGuard | undefined
let b: Deployment | undefined
let envA: Record<string, string>
let envB: Record<string, string>

/** What A held and answered, kept in memory after A is gone, to hold B against. */
const kept = {
  passports: [] as Array<{ profile: string; passportId: string; product: Json; reading: PassportReading; authorised: AuthorisedReading }>,
  imports: [] as Array<{ importId: string; record: Json; original: Uint8Array; sha256: string; mediaType: string }>,
  associations: [] as Array<{ key: string; value: Json }>,
  observations: [] as Array<{ key: string; value: Json }>,
  resolutions: [] as Array<{ key: string; value: Json }>,
  pull: undefined as { pull: Json; pages: Json[] } | undefined,
  conflict: undefined as Json | undefined,
  conflictId: '',
  cursor: [] as string[],
  ownerTiers: [] as string[],
  upload: { requestId: 'exit-line-1', bytes: new Uint8Array(0), importId: '', receivedAt: '' },
}
const numbers: Record<string, unknown> = {}
const report = { first: undefined as RestoreReport | undefined }

const seven = (): Json[] => Array.from({ length: 7 }, (_, index) => objectEvent(index + 1, [item(`EXIT-${index + 1}`)]))

const shared = (over: Record<string, string>): Record<string, string> => ({
  NETWORK: 'main',
  PASSPORT_HOST: 'passports.example.com',
  GS1_PREFIX: '952',
  LIVE_PUBLISHING: 'false',
  AUTH_SECRET,
  BRAND_ROOT_SECRET: BRAND_SECRET,
  MANAGED_IDENTITY_SECRET: IDENTITY_SECRET,
  INDEX_SUBMIT_TOKEN: 'dev-submit-token',
  INDEX_CALLBACK_TOKEN: 'dev-callback-token',
  DPP_GS1_ARTEFACTS_DIR: gs1Dir(),
  DPP_GS1_ARTEFACTS_OFFLINE: 'true',
  EPCIS_SOURCES: 'supplier-a',
  EPCIS_SOURCE_SUPPLIER_A_URL: source.baseUrl,
  EPCIS_SOURCE_SUPPLIER_A_LOCAL_TEST: 'true',
  ...over,
})

beforeAll(async () => {
  mongoA = await MongoMemoryServer.create()
  indexA = await startDevIndex({ publisherKey: PUBLISHER_KEY, network: 'main' })
  // The third page request is answered 503, once: the pull below is interrupted after two pages.
  source = await startEpcisSource(seven(), { requireAuthorization: `Bearer ${SOURCE_SECRET}`, failRequest: (n) => (n === 3 ? 503 : undefined) })
  envA = shared({ MONGO_URL: mongoA.getUri(), MONGO_DB: 'deployment_a', INDEX_URL: indexA.url, EPCIS_SOURCE_SUPPLIER_A_BEARER_TOKEN: SOURCE_SECRET })
}, 180_000)

afterAll(async () => {
  guard?.restore()
  await b?.close().catch(() => undefined)
  await source?.close()
  await indexA?.close().catch(() => undefined)
  await indexB?.close().catch(() => undefined)
  await mongoA?.stop().catch(() => undefined)
  await mongoB?.stop().catch(() => undefined)
  // The record of the run, when one was asked for, beside the other evidence of the repository.
  const recordPath = process.env.DPP_EXIT_EXERCISE_RECORD
  if (recordPath != null && recordPath !== '' && numbers.completed === true) {
    mkdirSync(dirname(recordPath), { recursive: true })
    writeFileSync(recordPath, `${JSON.stringify(numbers.record, null, 2)}\n`)
  }
  rmSync(scratch, { recursive: true, force: true })
}, 120_000)

describe('the exit exercise', () => {
  it('builds deployment A: two sector passports with restricted parts, two source scopes that share an event identifier, a decided conflict and an interrupted pull', async () => {
    const a = await start(envA)
    try {
      expect(a.platform.db).toBeDefined()
      expect(a.exchange.storageKind).toBe('mongodb')
      expect(a.platform.profiles.source).toBe('package')
      expect(a.platform.wallet.identityKey).toBe(PUBLISHER_KEY)
      const party = a.platform.parties.brand('dev-brand')
      await a.platform.store.saveBrand({ id: 'dev-brand', name: 'Development brand', identityKey: party.identityKey, did: party.did, createdAt: '2026-03-01T00:00:00.000Z' })

      for (const [profile, serial] of [
        ['eu-battery@1', 'EXIT-BAT-0001'],
        ['eu-textile@1', 'EXIT-TEX-0001'],
      ] as const) {
        const example = (await a.get(`/api/profiles/${ref(profile)}`)).body.examples[0] as { itemReference: string; serial: string; passportId: string; product: Json }
        const swap = (value: string): string => value.replaceAll(example.serial, serial)
        const product = JSON.parse(swap(JSON.stringify(example.product))) as Json
        // A restricted property carries a value that is nowhere else, so a search can tell where it went.
        if (profile === 'eu-battery@1') product['eubat:manufacturerIdentifier'] = `${RESTRICTED}-BAT`
        else (product['oec:hasOperatorInformation'] as Json)['gs1:organizationName'] = `${RESTRICTED}-TEX`
        const passportId = swap(example.passportId)
        const issued = await a.post('/api/brands/dev-brand/passports', { profile, itemReference: example.itemReference, serial, product })
        expect(issued.status, issued.text).toBe(200)
        expect(issued.body).toMatchObject({ passportId, profile })
        expect(issued.text).not.toContain(RESTRICTED)
        const reading = (await a.get(`/api/verify?passportId=${ref(passportId)}`)).body as PassportReading
        expect(reading.payloadChecks).toHaveLength(1)
        expect(reading.payloadChecks[0]!.publicView.status).toBe('pass')
        const authorised = (await a.post(`/api/passports/${ref(passportId)}/authorised-view`, {})).body as AuthorisedReading
        expect(authorised.ownerTier.status).toBe('pass')
        expect(authorised.authorisedView.status).toBe('pass')
        expect(authorised.product).toEqual(product)
        kept.passports.push({ profile, passportId, product, reading, authorised })
        const journal = (await a.platform.store.getPassport(passportId))!
        kept.ownerTiers.push(...journal.states.map((state) => state.ownerTier!.ciphertext))
      }

      // A file under the default scope, the request a client will make again in B.
      kept.upload.bytes = utf8(JSON.stringify(epcisDocument([objectEvent(11, [item('EXIT-LINE-11')]), objectEvent(12, [item('EXIT-LINE-11'), item('EXIT-LINE-12')])])))
      const uploaded = await a.upload(`/api/epcis/imports?requestId=${kept.upload.requestId}&filename=line.jsonld`, kept.upload.bytes)
      expect(uploaded.status).toBe(201)
      kept.upload.importId = uploaded.body.record.importId
      kept.upload.receivedAt = uploaded.body.record.receivedAt

      // One event identifier with two bodies under one scope: a conflict, which is decided with both observations kept.
      await a.upload('/api/epcis/imports?requestId=exit-body-1', utf8(JSON.stringify(epcisDocument([objectEvent(20, [item('EXIT-20')])]))))
      const second = await a.upload('/api/epcis/imports?requestId=exit-body-2', utf8(JSON.stringify(epcisDocument([objectEvent(20, [item('EXIT-20')], { disposition: 'in_transit' })]))))
      kept.conflictId = second.body.record.events[0].conflict.conflictId as string
      const decided = await a.post(`/api/epcis/conflicts/${ref(kept.conflictId)}/resolutions`, { decision: 'The later reading stands. Both are kept.', disposition: 'all-retained', decidedAt: '2026-03-10T00:00:00.000Z' })
      expect(decided.status).toBe(201)

      // The interrupted pull: two pages of four are acknowledged, then the source stops answering.
      const stopped = await a.post('/api/epcis/sources/supplier-a/pulls', { queryId: 'all', query: { perPage: 2 } })
      expect(stopped.body).toMatchObject({ outcome: 'source-unavailable', reason: 'http-error', status: 503, completion: 'failed', exhausted: false, events: { total: 4, new: 4 } })

      // A second source scope that uses an event identifier the first one holds, with another body. Under its own scope it is simply that source's event.
      const other = await a.upload('/api/epcis/imports?requestId=exit-b-1&sourceId=supplier-b', utf8(JSON.stringify(epcisDocument([objectEvent(1, [item('EXIT-1')], { bizStep: 'shipping' })]))))
      expect(other.status).toBe(201)
      expect(other.body.record).toMatchObject({ sourceId: 'supplier-b', state: 'evaluated', events: [{ arrival: 'new' }] })
      expect((await recordsOf(a.exchange.storage, EPCIS_RECORD_KINDS.observation)).filter((held) => held.value.identity === eventId(1)).map((held) => held.value.sourceId).sort()).toEqual(['supplier-a', 'supplier-b'])

      // What A holds, kept to hold B against.
      const listed = (await a.get('/api/epcis/imports?limit=200')).body.imports as Array<{ importId: string }>
      for (const { importId } of listed) {
        const record = (await a.get(`/api/epcis/imports/${ref(importId)}`)).body as Json
        const original = await a.get(`/api/epcis/imports/${ref(importId)}/original`)
        expect(original.headers.get('x-content-sha256')).toBe(sha256(original.bytes))
        kept.imports.push({ importId, record, original: original.bytes, sha256: sha256(original.bytes), mediaType: original.headers.get('content-type')! })
      }
      expect(kept.imports).toHaveLength(6)
      kept.associations = await recordsOf(a.exchange.storage, EPCIS_RECORD_KINDS.association)
      kept.observations = await recordsOf(a.exchange.storage, EPCIS_RECORD_KINDS.observation)
      kept.resolutions = await recordsOf(a.exchange.storage, EPCIS_RECORD_KINDS.resolution)
      kept.pull = (await a.get('/api/epcis/sources/supplier-a/pulls/all')).body
      expect(kept.pull!.pull).toMatchObject({ status: 'failed', pagesAcknowledged: 2 })
      expect(kept.pull!.pull.cursor).toBeDefined()
      kept.conflict = (await a.get(`/api/epcis/conflicts/${ref(kept.conflictId)}`)).body
      expect(kept.conflict).toMatchObject({ state: 'resolved' })
      expect((kept.conflict!.observations as unknown[]).length).toBe(2)
      // The cursor A holds: the address of the next page, with the token in it. It may not leave by default. The fixture's token is two
      // characters, too short to search for by itself, so the search is for every text of the cursor that is long enough to mean something.
      const texts: string[] = []
      const collect = (value: unknown): void => {
        if (typeof value === 'string') texts.push(value)
        else if (value !== null && typeof value === 'object') Object.values(value).forEach(collect)
      }
      collect(kept.pull!.pull.cursor)
      kept.cursor = [...new Set(texts.filter((text) => text.length >= 8 && !/^\d{4}-\d{2}-\d{2}T/.test(text)))]
      expect(kept.cursor.some((text) => text.includes('nextPageToken='))).toBe(true)
      expect(await checkEpcisExchangeInvariants(a.exchange.storage, { associations: true })).toEqual([])
    } finally {
      await a.close()
    }
  })

  it('exports A with the operator\'s command, in both forms, and neither holds a key or a credential', async () => {
    // The package everything below is restored from is written by `npm run export`, the command the documentation gives, as its own process.
    const authorised = await npmRun('export', ['--out', AUTHORISED], envA)
    expect(authorised.code, authorised.text).toBe(0)
    expect(authorised.text).toContain(`Authorised export written to ${AUTHORISED}`)
    expect(authorised.text).toContain(`Exporter identity key, which a restore is given: ${PUBLISHER_KEY}`)
    // The command says when the signature is the test wallet's, which anyone can make.
    expect(authorised.text).toMatch(/signed by the test wallet, whose key is public/)
    // An option the command does not take stops it before anything is opened or written, through the same script.
    const unknown = await npmRun('export', ['--out', join(scratch, 'never-written'), '--no-such-option'], envA)
    expect(unknown.code, unknown.text).toBe(2)
    expect(unknown.text).toMatch(/^usage: export --out <folder>/m)
    expect(existsSync(join(scratch, 'never-written'))).toBe(false)
    expect(authorised.text).not.toContain(SOURCE_SECRET)
    // An export never overwrites: the same folder is refused the second time.
    const again = await command(runExportCommand, ['--out', AUTHORISED], envA)
    expect(again.code).toBe(1)
    expect(again.text).toMatch(/^Refused \(destination-not-empty\)/)

    // The public form, with one source scope named as publishable. No other scope and no operational record goes with it.
    const open = await command(runExportCommand, ['--out', PUBLIC, '--public', '--public-source', 'supplier-b'], envA)
    expect(open.code, open.text).toBe(0)

    const manifest = JSON.parse(readFileSync(join(AUTHORISED, 'manifest.json'), 'utf8')) as EvidencePackageManifest
    const descriptor = JSON.parse(readFileSync(join(AUTHORISED, 'application/application-export.json'), 'utf8')) as ApplicationExportDescriptor
    expect(manifest.disclosure).toEqual({ scope: 'all-tiers', recoveryBackup: true })
    expect(manifest.exporter.id).toBe(PUBLISHER_KEY)
    expect(manifest.passportId).toMatch(/^urn:bsv:dpp:evidence-export:sha256:[0-9a-f]{64}$/)
    expect(manifest.profiles).toEqual(['eu-battery@1', 'eu-textile@1'])
    expect(descriptor).toMatchObject({ access: 'authorised-recovery', selection: 'all-passports', profiles: { root: 'profiles', carried: ['eu-battery@1', 'eu-textile@1'], named: [] }, epcis: { root: 'epcis', access: 'authorised-recovery', scopes: ['supplier-a', 'supplier-b', 'upload'], cursors: 'excluded' }, records: { brands: 1, offers: 0, claims: 0 } })
    expect(descriptor.passports.map((passport) => passport.index.form)).toEqual(['package', 'package'])
    expect(descriptor.passports.map((passport) => passport.bindingDigest).sort()).toEqual(BUNDLED_BINDINGS.map((entry) => entry.bindingDigest).sort())
    // The source is described so that it can be configured again, and its credential is only said to exist.
    expect(descriptor.epcis.sources).toEqual([{ sourceId: 'supplier-a', baseUrl: source.baseUrl, permittedOrigins: [source.origin], localTest: true, repeatListParameters: false, credentialConfigured: true, credentialScheme: 'bearer' }])
    // GS1's files are named by address and digest in the manifest, and are in no file of either package.
    for (const artefact of EPCIS_GS1_ARTEFACTS) {
      expect(manifest.completeness.withheld).toContain(`provisioned-by-destination ${artefact.uri} sha256:${artefact.sha256} bytes:${artefact.byteLength}`)
      for (const folder of [AUTHORISED, PUBLIC]) expect(Object.values(digestsOf(folder))).not.toContain(artefact.sha256)
    }

    const publicManifest = JSON.parse(readFileSync(join(PUBLIC, 'manifest.json'), 'utf8')) as EvidencePackageManifest
    const publicDescriptor = JSON.parse(readFileSync(join(PUBLIC, 'application/application-export.json'), 'utf8')) as ApplicationExportDescriptor
    expect(publicManifest.disclosure).toEqual({ scope: 'public', recoveryBackup: false })
    expect(publicDescriptor).toMatchObject({ access: 'public-evidence', epcis: { access: 'public-evidence', scopes: ['supplier-b'], cursors: 'excluded' }, records: { brands: 0, offers: 0, claims: 0 } })
    expect(publicDescriptor.epcis.sources).toBeUndefined()
    const publicPaths = Object.keys(digestsOf(PUBLIC))
    expect(publicPaths.some((path) => path.endsWith('/journal.json') || path.startsWith('application/brands/') || path.startsWith('epcis/records/import/') || path.startsWith('epcis/records/pull'))).toBe(false)
    expect(publicPaths.filter((path) => path.startsWith('epcis/originals/'))).toHaveLength(1)
    expect(publicPaths.some((path) => path.startsWith('profiles/eu-battery@1/'))).toBe(true)

    // Every byte of the public package is searched for what a public package may never hold.
    const forbiddenInPublic = [
      ...formsOf(`${RESTRICTED}-BAT`),
      ...formsOf(`${RESTRICTED}-TEX`),
      ...formsOf(SOURCE_SECRET),
      `Bearer ${SOURCE_SECRET}`,
      ...[BRAND_SECRET, IDENTITY_SECRET, AUTH_SECRET, WALLET_ROOT, 'dev-submit-token', 'dev-callback-token'].flatMap(formsOf),
      // Cursor material and where the source was read from.
      ...kept.cursor.flatMap(formsOf),
      'nextPageToken',
      source.origin,
      new URL(source.origin).host,
      // The sealed owner tiers, in the form the journal keeps them and as bytes.
      ...kept.ownerTiers,
      ...kept.ownerTiers.map((ciphertext) => Buffer.from(ciphertext, 'base64').toString('hex')),
      // Who signed in. The brand's label is not searched for: every state names its actor's key by it, on chain, so it is public by the record model.
      developer.email,
      // The file a client uploaded under another scope, and the requests that bind them.
      'line.jsonld',
      kept.upload.requestId,
    ]
    const publicFiles = everyFile(PUBLIC)
    for (const needle of forbiddenInPublic) {
      const found = publicFiles.filter(([, bytes]) => bytes.includes(Buffer.from(needle, 'utf8'))).map(([path]) => path)
      expect(found, `the public package holds ${needle.slice(0, 24)}`).toEqual([])
    }
    for (const ciphertext of kept.ownerTiers) expect(publicFiles.filter(([, bytes]) => bytes.includes(Buffer.from(ciphertext, 'base64')))).toEqual([])

    // The authorised package holds restricted records, sealed as they were, and still no key, credential or cursor.
    const authorisedFiles = everyFile(AUTHORISED)
    for (const needle of [...formsOf(SOURCE_SECRET), ...[BRAND_SECRET, IDENTITY_SECRET, AUTH_SECRET, WALLET_ROOT, 'dev-submit-token', 'dev-callback-token'].flatMap(formsOf), ...kept.cursor.flatMap(formsOf), 'nextPageToken', `${RESTRICTED}-BAT`, `${RESTRICTED}-TEX`]) {
      const found = authorisedFiles.filter(([, bytes]) => bytes.includes(Buffer.from(needle, 'utf8'))).map(([path]) => path)
      expect(found, `the authorised package holds ${needle.slice(0, 24)}`).toEqual([])
    }
    // The owner tiers travel as the ciphertext the journal holds, and nowhere as what they seal.
    expect(authorisedFiles.filter(([, bytes]) => bytes.includes(Buffer.from(kept.ownerTiers[0]!, 'utf8'))).map(([path]) => path)).toHaveLength(1)

    numbers.export = {
      authorised: { files: authorisedFiles.length, bytes: authorisedFiles.reduce((sum, [, bytes]) => sum + bytes.byteLength, 0), inventoryEntries: manifest.inventory.length, withheldLines: manifest.completeness.withheld.length, absentLines: manifest.completeness.absent.length, snapshotDeclarations: manifest.completeness.snapshots.length },
      public: { files: publicFiles.length, bytes: publicFiles.reduce((sum, [, bytes]) => sum + bytes.byteLength, 0), inventoryEntries: publicManifest.inventory.length, valuesSearchedFor: forbiddenInPublic.length + kept.ownerTiers.length },
    }
  })

  it('switches A off, so that nothing can be read from it', async () => {
    const uri = mongoA.getUri()
    const indexUrl = indexA.url
    await indexA.close()
    await mongoA.stop()
    await expect(MongoClient.connect(uri, { serverSelectionTimeoutMS: 1_000 })).rejects.toThrow()
    await expect(fetch(`${indexUrl}/health`)).rejects.toThrow()
    // The API of A was stopped when it had been built; the export ran against its stores with nothing else at work.
    numbers.disabled = { database: 'stopped', index: 'stopped', api: 'stopped' }
  })

  it('refuses what a restore must refuse, by name, before anything is written', async () => {
    // A database and folders that hold nothing, on a server of their own: each refusal below must leave them so.
    mongoB = await MongoMemoryServer.create()
    const fresh = (name: string, over: Record<string, string> = {}): Record<string, string> => {
      const { INDEX_SUBMIT_TOKEN: _submit, INDEX_CALLBACK_TOKEN: _callback, ...rest } = shared({ MONGO_URL: mongoB.getUri(), MONGO_DB: `refusal_${name}`, EPCIS_STORAGE: 'file', EPCIS_STORAGE_DIR: join(scratch, `refusal-${name}`, 'epcis'), PROFILE_BUNDLE_DIR: join(scratch, `refusal-${name}`, 'profiles'), ...over })
      return rest
    }
    const untouched = async (name: string): Promise<void> => {
      expect(Object.keys(digestsOf(join(scratch, `refusal-${name}`, 'profiles'))), `${name}: the profile folder`).toEqual([])
      const store = Object.keys(digestsOf(join(scratch, `refusal-${name}`, 'epcis')))
      expect(store.filter((path) => !path.endsWith('.lock') && !/^(format|store)\.json$/.test(path)), `${name}: the EPCIS folder`).toEqual([])
      const text = await databaseText(mongoB.getUri(), `refusal_${name}`)
      expect(text, `${name}: the database`).not.toMatch(/"passportId"|"requestId"/)
    }
    const refusals: Record<string, string> = {}
    const refused = async (name: string, folder: string, code: string, detail: RegExp, over: Record<string, string> = {}, args: string[] = []): Promise<void> => {
      const answer = await command(runRestoreCommand, ['--from', folder, '--exporter-key', PUBLISHER_KEY, ...args], fresh(name, over))
      expect(answer.code, answer.text).toBe(1)
      expect(answer.lines[0], answer.text).toMatch(new RegExp(`^Refused \\(${code}\\): `))
      expect(answer.text).toMatch(detail)
      expect(answer.text).toContain('Nothing was written.')
      await untouched(name)
      refusals[name] = answer.lines[0]!.slice(0, answer.lines[0]!.indexOf(':'))
    }

    // 1. A substituted, more permissive profile under a correct exporter signature: the rules are dropped and a restricted property is made public.
    let substituteDigest = ''
    const substituted = await repackaged(AUTHORISED, 'substituted', (folder) => {
      const at = join(folder, 'profiles/eu-battery@1/binding.json')
      const binding = JSON.parse(readFileSync(at, 'utf8')) as { validation: { steps: string[] }; access: { public: string[] } }
      binding.validation.steps = binding.validation.steps.filter((step) => step !== 'shacl')
      binding.access.public.push('eubat:manufacturerIdentifier')
      const bytes = utf8(JSON.stringify(binding, null, 2))
      substituteDigest = profileBindingDigest(bytes)
      writeFileSync(at, bytes)
      // The bundle's own descriptor is made to agree, as whoever built such a package would make it.
      const descriptorAt = join(folder, 'profiles/profile-bundle.json')
      const bundle = JSON.parse(readFileSync(descriptorAt, 'utf8')) as { profiles: Array<{ profile: string; bindingDigest: string }> }
      bundle.profiles.find((entry) => entry.profile === 'eu-battery@1')!.bindingDigest = substituteDigest
      writeFileSync(descriptorAt, JSON.stringify(bundle))
    })
    await refused('substituted', substituted, 'profile-refused', /bundle-binding-substituted/)
    // Trusting the substitute's digest does not let it take the place of the profile the records declare and this deployment knows.
    await refused('substituted-trusted', substituted, 'profile-refused', /bundle-binding-substituted/, { TRUSTED_BINDING_DIGESTS: substituteDigest })
    // The exporter's signature is not the question: under another key than the one expected, the same genuine package is refused too.
    await refused('other-exporter', AUTHORISED, 'exporter-unexpected', /expects the exporter/, {}, ['--exporter-key', PrivateKey.fromHex('77'.repeat(32)).toPublicKey().toString()])

    // 2. A package whose pull checkpoint stands on an import it does not carry.
    const epcisJson = <T>(folder: string, path: string): T => JSON.parse(readFileSync(join(folder, 'epcis', path), 'utf8')) as T
    type SnapshotDescriptor = { access: string; format: string; version: string; snapshot: { snapshotId: string }; inventory: Array<{ path: string; kind: string; sha256: string; byteLength: number }>; scopes: Array<{ sourceId: string; originals: number; imports: number; observations: number; resolutions: number }> }
    /** Remove records from the snapshot and make its descriptor an honest account of what is left: the files, the counts and the identity. */
    const withoutRecords = (folder: string, removed: (entry: { path: string; kind: string }, value: Json | undefined) => boolean): void => {
      const descriptor = epcisJson<SnapshotDescriptor>(folder, 'epcis-recovery.json')
      const gone = descriptor.inventory.filter((entry) => removed(entry, entry.kind === 'original' ? undefined : epcisJson<Json>(folder, entry.path)))
      for (const entry of gone) {
        const value = entry.kind === 'original' ? undefined : epcisJson<Json>(folder, entry.path)
        const scope = descriptor.scopes.find((candidate) => candidate.sourceId === value?.sourceId)
        if (scope != null && entry.kind === 'import') scope.imports -= 1
        if (scope != null && entry.kind === 'observation') scope.observations -= 1
        rmSync(join(folder, 'epcis', entry.path))
      }
      descriptor.inventory = descriptor.inventory.filter((entry) => !gone.includes(entry))
      descriptor.snapshot.snapshotId = sha256(canonicalJson({ access: descriptor.access, format: descriptor.format, inventory: descriptor.inventory, version: descriptor.version }))
      writeFileSync(join(folder, 'epcis/epcis-recovery.json'), canonicalJson(descriptor))
      const application = JSON.parse(readFileSync(join(folder, 'application/application-export.json'), 'utf8')) as ApplicationExportDescriptor
      application.epcis.snapshotId = descriptor.snapshot.snapshotId
      writeFileSync(join(folder, 'application/application-export.json'), canonicalJson(application))
    }
    const secondPage = kept.pull!.pages[1]!.importId as string
    const noCheckpointImport = await repackaged(AUTHORISED, 'checkpoint-omitted', (folder) => withoutRecords(folder, (entry, value) => (entry.kind === 'import' && value!.importId === secondPage) || (entry.kind === 'observation' && value!.importId === secondPage)))
    await refused('checkpoint-omitted', noCheckpointImport, 'epcis-refused', /checkpoint-imports-omitted/)

    // 3. A package whose conflict decision names an observation it does not carry.
    const decidedBetween = (kept.resolutions[0]!.value.observations as Array<{ sequence: number; importId: string }>)[1]!
    const noObservation = await repackaged(AUTHORISED, 'resolution-omitted', (folder) => withoutRecords(folder, (entry, value) => entry.kind === 'observation' && value!.importId === decidedBetween.importId && value!.sequence === decidedBetween.sequence))
    await refused('resolution-omitted', noObservation, 'epcis-refused', /resolution-observations-omitted/)

    // 4. An altered original. One bit is changed: under the genuine manifest the file is not the one listed, and under a manifest signed again for the changed bytes the snapshot's own descriptor refuses it.
    const original = `epcis/originals/${kept.imports[0]!.sha256}`
    const flip = (folder: string): void => {
      const bytes = readFileSync(join(folder, original))
      bytes[20] = bytes[20]! ^ 1
      writeFileSync(join(folder, original), bytes)
    }
    const alteredOnly = join(scratch, 'altered')
    cpSync(AUTHORISED, alteredOnly, { recursive: true })
    flip(alteredOnly)
    await refused('altered', alteredOnly, 'file-altered', new RegExp(original.replaceAll('/', '\\/')))
    await refused('altered-resigned', await repackaged(AUTHORISED, 'altered-resigned', flip), 'epcis-refused', /descriptor-inventory-mismatch/)

    // 5. An incomplete package, named for what it lacks: a file gone from the folder, and a journal a package was assembled without.
    const journal = `passports/${sha256(kept.passports[0]!.passportId)}/journal.json`
    const lacking = join(scratch, 'lacking')
    cpSync(AUTHORISED, lacking, { recursive: true })
    rmSync(join(lacking, journal))
    await refused('lacking', lacking, 'package-incomplete', new RegExp(journal.replaceAll('/', '\\/')))
    await refused('lacking-resigned', await repackaged(AUTHORISED, 'lacking-resigned', (folder) => rmSync(join(folder, journal))), 'package-incomplete', new RegExp(`does not carry the journal of ${kept.passports[0]!.passportId.replaceAll('/', '\\/')}`))

    // 6. The public package is not a recovery backup.
    await refused('public', PUBLIC, 'not-a-recovery-package', /public disclosure/)

    // 7. A file nobody listed is not carried along.
    const extra = join(scratch, 'extra')
    cpSync(AUTHORISED, extra, { recursive: true })
    writeFileSync(join(extra, 'application/notes.txt'), 'not part of the export')
    await refused('extra', extra, 'file-unlisted', /application\/notes\.txt/)

    numbers.refusals = refusals
  }, 240_000)

  it('restores into deployment B with another storage adapter and another profile resolver, and a second restore changes nothing', async () => {
    indexB = await startDevIndex({ publisherKey: PUBLISHER_KEY, network: 'main' })
    // B's settings: its own database and index, the file-system adapter for the exchange, the bundle resolver for profiles.
    // The source's credential is not configured yet. It is not in the package, and the operator provides it separately, below.
    envB = shared({ MONGO_URL: mongoB.getUri(), MONGO_DB: 'deployment_b', INDEX_URL: indexB.url, EPCIS_STORAGE: 'file', EPCIS_STORAGE_DIR: join(scratch, 'b-epcis-store'), PROFILE_BUNDLE_DIR: join(scratch, 'b-profile-bundle') })

    // From here on the network is B's own services and the one EPCIS source. Anything else is refused and written down.
    guard = guardNetwork()
    for (const address of [mongoB.getUri().replace('mongodb://', 'http://'), indexB.url, source.origin]) guard.allow(portOf(address))
    // The guard is shown to work before it is relied on: the hosts profile files and contexts are published at are out of reach.
    for (const host of ['https://ref.gs1.org/', 'https://w3id.org/', 'https://www.w3.org/', 'https://schema.org/']) await expect(fetch(host)).rejects.toThrow(/kept to this test's own services/)
    await expect(fetch(`${indexA.url}/health`)).rejects.toThrow(/kept to this test's own services/)
    expect(guard.attempts.splice(0)).toHaveLength(5)

    const reportFile = join(scratch, 'restore-report.json')
    const restored = await command(runRestoreCommand, ['--from', AUTHORISED, '--exporter-key', PUBLISHER_KEY, '--report', reportFile], envB)
    expect(restored.code, restored.text).toBe(0)
    const first = JSON.parse(readFileSync(reportFile, 'utf8')) as RestoreReport
    report.first = first
    expect(first).toMatchObject({
      outcome: 'restored',
      exporter: PUBLISHER_KEY,
      passports: { written: kept.passports.map((passport) => passport.passportId).sort(), unchanged: [] },
      records: { brands: { written: 1, unchanged: 0 } },
      profiles: { resolver: 'bundle', folder: join(scratch, 'b-profile-bundle'), filesUnchanged: 0, registered: BUNDLED_BINDINGS.map((entry) => ({ profile: entry.profile, bindingDigest: entry.bindingDigest })), notRegistered: [] },
      epcis: { outcome: 'restored', sourceIds: ['supplier-a', 'supplier-b', 'upload'], written: { originals: 6, imports: 6, resolutions: 1, pulls: 1, pullPages: 2 }, relocations: 6 },
      index: { rebuilt: true, announced: 2, admitted: 2, duplicate: 0, notAnnounced: [] },
      readings: { compared: 2, same: 2, different: [], notCompared: [] },
      attention: [],
    })
    expect(first.epcis!.written.observations).toBe(kept.observations.length)
    expect(first.epcis!.associationsRebuilt).toBe(kept.associations.length)
    expect(first.profiles.filesWritten).toBeGreaterThan(10)
    // The report says what the operator still provides, and names the credential the package did not carry.
    expect(first.provisionSeparately.join('\n')).toMatch(/The EPCIS source supplier-a: it is configured here at the address it had\. Its bearer credential is not configured here: set it before a pull\./)
    expect(first.provisionSeparately.join('\n')).toMatch(/wallet's own recovery/)
    expect(restored.text).not.toContain(SOURCE_SECRET)

    // The same package restored again, this time with `npm run restore`, the command the documentation gives, as its own process: nothing is written anywhere.
    // That process is outside this one's network guard. It reaches B's database and index, which is all the first restore, inside the guard, reached.
    const before = { database: await databaseText(mongoB.getUri(), 'deployment_b'), store: digestsOf(join(scratch, 'b-epcis-store')), bundle: digestsOf(join(scratch, 'b-profile-bundle')) }
    const again = await npmRun('restore', ['--from', AUTHORISED, '--exporter-key', PUBLISHER_KEY, '--report', reportFile], envB)
    expect(again.code, again.text).toBe(0)
    expect(again.text).toMatch(/^Restore unchanged: export /m)
    expect(again.text).not.toContain(SOURCE_SECRET)
    // A key that is not one is refused by the command's own argument check, before the package is read.
    const malformed = await npmRun('restore', ['--from', AUTHORISED, '--exporter-key', 'not-a-key'], envB)
    expect(malformed.code, malformed.text).toBe(2)
    expect(malformed.text).toMatch(/^--exporter-key is a compressed public key/m)
    const second = JSON.parse(readFileSync(reportFile, 'utf8')) as RestoreReport
    expect(second).toMatchObject({
      outcome: 'unchanged',
      passports: { written: [], unchanged: kept.passports.map((passport) => passport.passportId).sort() },
      records: { brands: { written: 0, unchanged: 1 } },
      profiles: { filesWritten: 0, filesUnchanged: first.profiles.filesWritten },
      epcis: { outcome: 'unchanged', written: { originals: 0, imports: 0, observations: 0, resolutions: 0, pulls: 0, pullPages: 0 } },
      index: { announced: 2, admitted: 0, duplicate: 2 },
      readings: { compared: 2, same: 2 },
      attention: [],
    })
    expect(await databaseText(mongoB.getUri(), 'deployment_b')).toBe(before.database)
    expect(digestsOf(join(scratch, 'b-epcis-store'))).toEqual(before.store)
    expect(digestsOf(join(scratch, 'b-profile-bundle'))).toEqual(before.bundle)
    // The exported package is unchanged by being restored from.
    expect(await command(runRestoreCommand, ['--from', AUTHORISED, '--exporter-key', PUBLISHER_KEY], envB)).toMatchObject({ code: 0 })
    numbers.restore = { first: { outcome: first.outcome, passports: first.passports.written.length, epcis: first.epcis!.written, relocations: first.epcis!.relocations, associationsRebuilt: first.epcis!.associationsRebuilt, profileFiles: first.profiles.filesWritten, statesAnnounced: first.index.announced, readingsSame: first.readings.same }, second: { outcome: second.outcome, statesAlreadyHeld: second.index.duplicate } }
  }, 240_000)

  it('proves in B the same passports, with the same reports, from the bundle and with the upstream hosts out of reach', async () => {
    b = await start(envB, (port) => guard!.allow(port))
    expect(b.exchange.storageKind).toBe('file')
    expect(b.platform.profiles.source).toBe('bundle')
    expect(b.platform.profiles.refusals).toEqual([])
    expect(b.lines).toContain('EPCIS recovery: nothing was left unfinished.')
    expect((await b.get('/api/operations')).body.profiles).toMatchObject({ source: 'bundle', engine: { available: true, kind: 'in-process' }, refused: [] })

    for (const passport of kept.passports) {
      const reading = (await b.get(`/api/verify?passportId=${ref(passport.passportId)}`)).body as PassportReading
      // The same native findings: every check of the report, by name, status and reason, and the report's own limits.
      expect(reading.checks).toEqual(passport.reading.checks)
      expect(reading.report.checks).toEqual(passport.reading.report.checks)
      expect(reading.report.limits).toEqual(passport.reading.report.limits)
      expect(reading.lineage).toEqual(passport.reading.lineage)
      // The same profile validation outcome, finding for finding.
      expect(reading.payloadChecks).toEqual(passport.reading.payloadChecks)
      expect(reading.product).toEqual(passport.reading.product)
      expect(reading.product!.bindingDigest).toBe(BUNDLED_BINDINGS.find((entry) => entry.profile === passport.profile)!.bindingDigest)

      // The holder's view: the stored ciphertext is the one the state commits to, and only then is it opened and checked whole.
      const authorised = (await b.post(`/api/passports/${ref(passport.passportId)}/authorised-view`, {})).body as AuthorisedReading
      expect(authorised).toEqual(passport.authorised)
      expect(authorised.ownerTier).toMatchObject({ status: 'pass' })
      // The profile's answer and the commitment's are two findings. A passing validation is never the statement about the commitment.
      expect(authorised.authorisedView.summary).toMatch(/This is not a statement about the on-chain commitment/)
    }

    // The identity rule is enforced here as it was there: a document about another item is refused for this passport, and nothing is signed.
    const battery = kept.passports[0]!
    const other = JSON.parse(JSON.stringify(battery.product).replaceAll('EXIT-BAT-0001', 'EXIT-BAT-0002')) as Json
    const wrong = await b.post(`/api/passports/${ref(battery.passportId)}/update`, { product: other })
    expect(wrong.status).toBe(409)
    expect(wrong.body).toMatchObject({ error: 'product-invalid', cause: 'product-identity-mismatch' })
    expect((await b.platform.store.getPassport(battery.passportId))!.states).toHaveLength(1)
    numbers.passports = { verified: kept.passports.length, checksPerReport: kept.passports.map((passport) => passport.reading.report.checks.length), payloadChecks: kept.passports.map((passport) => passport.reading.payloadChecks.length) }
  }, 120_000)

  it('proves in B the EPCIS exchange: exact originals, rebuilt associations and every durable record as it was', async () => {
    const storage = b!.exchange.storage
    expect(await checkEpcisExchangeInvariants(storage, { associations: true })).toEqual([])

    // Exact originals, byte for byte, under the media type they arrived with.
    for (const held of kept.imports) {
      const original = await b!.get(`/api/epcis/imports/${ref(held.importId)}/original`)
      expect(original.status).toBe(200)
      expect(Buffer.from(original.bytes).equals(Buffer.from(held.original)), held.importId).toBe(true)
      expect(original.headers.get('x-content-sha256')).toBe(held.sha256)
      expect(original.headers.get('content-type')).toBe(held.mediaType)
    }

    // Every import record as it was: its identity, its request binding, its receipt time, its results. Two things may differ, and no other: where the
    // bytes are kept, which the destination names for itself, and the page token a page was asked for with, which is cursor material and was left out.
    const withoutToken = (query: unknown): unknown => {
      if (query === null || typeof query !== 'object') return query
      const { nextPageToken: _token, ...rest } = query as Json
      return rest
    }
    const withoutLocation = ({ bytesRef: _bytesRef, ...record }: Json): Json => {
      const location = record.sourceLocation as Json | undefined
      return location?.query == null ? record : { ...record, sourceLocation: { ...location, query: withoutToken(location.query) } }
    }
    const pageWithoutToken = (page: Json): Json => (page.query == null ? page : { ...page, query: withoutToken(page.query) })
    for (const held of kept.imports) {
      const record = (await b!.get(`/api/epcis/imports/${ref(held.importId)}`)).body as Json
      expect(withoutLocation(record)).toEqual(withoutLocation(held.record))
      expect(record).toMatchObject({ importId: held.importId, requestId: held.record.requestId, requestDigest: held.record.requestDigest, receivedAt: held.record.receivedAt, sourceId: held.record.sourceId })
    }
    expect((await b!.get('/api/epcis/imports?limit=200')).body.imports).toHaveLength(kept.imports.length)

    // The associations were rebuilt, not carried, and are the ones A held.
    expect(await recordsOf(storage, EPCIS_RECORD_KINDS.association)).toEqual(kept.associations)
    expect(await recordsOf(storage, EPCIS_RECORD_KINDS.observation)).toEqual(kept.observations)
    expect(await recordsOf(storage, EPCIS_RECORD_KINDS.resolution)).toEqual(kept.resolutions)

    // The conflict is decided here as it was, by the same decision at the same time, with both observations kept.
    expect((await b!.get(`/api/epcis/conflicts/${ref(kept.conflictId)}`)).body).toEqual(kept.conflict)
    // The two scopes that share an event identifier were not merged.
    expect((await recordsOf(storage, EPCIS_RECORD_KINDS.observation)).filter((held) => held.value.identity === eventId(1)).map((held) => held.value.sourceId).sort()).toEqual(['supplier-a', 'supplier-b'])

    // The pull: its definition, its bounds, its checkpoint and its pages are the ones A held. Its cursor was left out.
    const pull = (await b!.get('/api/epcis/sources/supplier-a/pulls/all')).body as { pull: Json; pages: Json[] }
    const withoutCursor = ({ cursor: _cursor, ...record }: Json): Json => record
    expect(pull.pull.cursor).toBeUndefined()
    expect(withoutCursor(pull.pull)).toEqual(withoutCursor(kept.pull!.pull))
    expect(pull.pull).toMatchObject({ status: 'failed', pagesAcknowledged: 2 })
    expect(pull.pages).toEqual(kept.pull!.pages.map(pageWithoutToken))
    expect(JSON.stringify(pull)).not.toContain('nextPageToken')

    // A client that never heard its answer sends the request again, to B: the same import, the same receipt time, no new receipt.
    const retried = await b!.upload(`/api/epcis/imports?requestId=${kept.upload.requestId}&filename=line.jsonld`, kept.upload.bytes)
    expect(retried.status).toBe(200)
    expect(retried.body).toMatchObject({ outcome: 'retained', replayed: true, record: { importId: kept.upload.importId, receivedAt: kept.upload.receivedAt } })
    expect((await b!.get('/api/epcis/imports?limit=200')).body.imports).toHaveLength(kept.imports.length)
    // The same request identifier with other content still conflicts, and the restored import stands.
    const changed = await b!.upload(`/api/epcis/imports?requestId=${kept.upload.requestId}`, utf8(JSON.stringify(epcisDocument([objectEvent(13, [item('EXIT-LINE-13')])]))))
    expect(changed.status).toBe(409)
    expect(changed.body).toMatchObject({ error: 'request-conflict', existingImportId: kept.upload.importId, kept: false })
    expect((await b!.get('/api/epcis/imports?limit=200')).body.imports).toHaveLength(kept.imports.length)
    numbers.epcis = { originalsByteForByte: kept.imports.length, importRecordsEqual: kept.imports.length, associationsEqual: kept.associations.length, observationsEqual: kept.observations.length, decisionsEqual: kept.resolutions.length, pullPagesEqual: kept.pull!.pages.length, sourceScopes: 3 }
  }, 120_000)

  it('resumes the interrupted pull only once its credential is provided again, and replays safely without its cursor', async () => {
    const requestsBefore = source.requests.length
    // Without the credential the source refuses, and the pull is where it was.
    const without = await b!.post('/api/epcis/sources/supplier-a/pulls', { queryId: 'all', query: { perPage: 2 } })
    expect(without.status).toBe(200)
    expect(without.body.exhausted).toBe(false)
    expect(without.body.events.new).toBe(0)
    expect((await b!.get('/api/epcis/sources/supplier-a/pulls/all')).body.pull).toMatchObject({ pagesAcknowledged: 2 })
    expect((await b!.get('/api/epcis/sources')).body).toMatchObject([{ sourceId: 'supplier-a', credentialConfigured: false }])
    const refusedRequests = source.requests.length - requestsBefore

    // The operator provides the credential, in B's own settings, and starts the API again. The address is the one the pull is bound to, and declaring it changes nothing.
    await b!.close()
    b = undefined
    envB = { ...envB, EPCIS_SOURCE_SUPPLIER_A_BEARER_TOKEN: SOURCE_SECRET }
    const remap = await command(runRemapCommand, ['--source', 'supplier-a'], envB)
    expect(remap.code, remap.text).toBe(0)
    expect(remap.text).toMatch(/all: already bound to .*; cursor none\./)
    b = await start(envB, (port) => guard!.allow(port))
    expect((await b.get('/api/epcis/sources')).body).toMatchObject([{ sourceId: 'supplier-a', credentialConfigured: true, credentialScheme: 'bearer' }])

    const asked = source.requests.length
    const resumed = await b.post('/api/epcis/sources/supplier-a/pulls', { queryId: 'all', query: { perPage: 2 } })
    expect(resumed.status).toBe(200)
    expect(resumed.body).toMatchObject({ outcome: 'ok', reason: 'exhausted', exhausted: true })
    // With no cursor to use, the pass was asked for again from its retained bounds: from the first page, in order, with none skipped.
    const offsets = source.requests.slice(asked).map((request) => (request.query.nextPageToken == null ? 0 : Number(Buffer.from(request.query.nextPageToken, 'base64url').toString())))
    expect(offsets).toEqual([0, 2, 4, 6])
    // What was already held was recognised as it arrived: three events are new, and the pages A acknowledged made no second import.
    expect(resumed.body.events).toMatchObject({ new: 3, conflict: 0 })
    const state = (await b.get('/api/epcis/sources/supplier-a/pulls/all')).body as { pull: Json; pages: Json[] }
    expect(state.pull).toMatchObject({ status: 'exhausted', sourceId: 'supplier-a', pullId: kept.pull!.pull.pullId })
    expect(state.pages.slice(0, 2).map((page) => ({ importId: page.importId, sha256: page.sha256, sequence: page.sequence, page: page.page, receivedAt: page.receivedAt }))).toEqual(kept.pull!.pages.map((page) => ({ importId: page.importId, sha256: page.sha256, sequence: page.sequence, page: page.page, receivedAt: page.receivedAt })))
    const pageImports = [...new Set(state.pages.map((page) => page.importId as string))]
    expect(pageImports.slice(0, 2)).toEqual(kept.pull!.pages.map((page) => page.importId))
    expect(pageImports).toHaveLength(4)
    expect((await b.get('/api/epcis/imports?limit=200')).body.imports).toHaveLength(kept.imports.length + 2)
    // Every event of the source is held once under its scope.
    const observed = (await recordsOf(b.exchange.storage, EPCIS_RECORD_KINDS.observation)).filter((held) => held.value.sourceId === 'supplier-a').map((held) => held.value.identity as string)
    expect(observed.sort()).toEqual(Array.from({ length: 7 }, (_, index) => eventId(index + 1)).sort())
    expect(await checkEpcisExchangeInvariants(b.exchange.storage, { associations: true })).toEqual([])
    // The credential went to the source and nowhere else.
    for (const line of b.lines) expect(line).not.toContain(SOURCE_SECRET)
    expect(JSON.stringify(await recordsOf(b.exchange.storage, EPCIS_RECORD_KINDS.pull))).not.toContain(SOURCE_SECRET)
    numbers.pull = { pagesAcknowledgedBeforeExport: 2, requestsRefusedWithoutCredential: refusedRequests, cursor: 'excluded from the package, so the pass replayed from its retained bounds', pageOffsetsAskedForInB: offsets, eventsNewInB: resumed.body.events.new, pageRecordsAfter: state.pages.length, importsThosePagesStandOn: pageImports.length, importsAddedInB: 2 }
  }, 120_000)

  it('continues an authorised UPDATE in B, which verifies, and made no network attempt beyond its own services', async () => {
    const battery = kept.passports[0]!
    // An explicit passport operation, asked for by a member of the brand that holds the passport. It needs the keys: the brand's, derived from the secret B was
    // given by its operator, and the wallet's, which B holds by the wallet's own recovery. Neither came from the package.
    const product = { ...structuredClone(battery.product), 'gs1:productDescription': [{ '@value': 'Serviced and returned to use', '@language': 'en' }] }
    const updated = await b!.post(`/api/passports/${ref(battery.passportId)}/update`, { product })
    expect(updated.status, updated.text).toBe(200)
    expect(updated.body.states.map((state: Json) => state.op)).toEqual(['ISSUE', 'UPDATE'])
    expect(updated.body.states[1]).toMatchObject({ index: 'admitted', network: 'dry-run' })

    const reading = (await b!.get(`/api/verify?passportId=${ref(battery.passportId)}`)).body as PassportReading
    expect(reading.lineage.map((state) => state.op)).toEqual(['ISSUE', 'UPDATE'])
    expect(reading.lineage[0]!.txid).toBe(battery.reading.lineage[0]!.txid)
    // The lineage verifies as one: every check answers as it did for the genesis alone, and both payloads pass under the bundle's profile.
    expect(reading.checks.map((check) => [check.name, check.status])).toEqual(battery.reading.checks.map((check) => [check.name, check.status]))
    expect(reading.payloadChecks.map((check) => check.publicView.status)).toEqual(['pass', 'pass'])
    const authorised = (await b!.post(`/api/passports/${ref(battery.passportId)}/authorised-view`, {})).body as AuthorisedReading
    expect(authorised.ownerTier.status).toBe('pass')
    expect(authorised.authorisedView.status).toBe('pass')
    expect(authorised.product).toEqual(product)
    // The other passport was not touched.
    expect((await b!.platform.store.getPassport(kept.passports[1]!.passportId))!.states).toHaveLength(1)

    // Nothing left B for anywhere but its own database, its own index and the EPCIS source.
    expect(guard!.attempts).toEqual([])
    // A is still gone, and nothing above needed it.
    guard!.restore()
    guard = undefined
    await expect(fetch(`${indexA.url}/health`)).rejects.toThrow()

    numbers.update = { op: 'UPDATE', states: 2, indexAnswer: updated.body.states[1].index, networkAnswer: updated.body.states[1].network, verified: true }
    numbers.network = { attemptsRefused: 0, permitted: ['deployment B\'s database', 'deployment B\'s index', 'deployment B\'s API', 'the fixture EPCIS source'] }
    numbers.record = {
      check: 'packages/create-dpp-app/template/apps/api/test/exit-exercise.test.ts',
      recordedAt: new Date().toLocaleDateString('en-CA'),
      node: process.version,
      // The generated application is not a checkout. The check that generated it says which source it came from.
      releaseSet: process.env.DPP_EXIT_EXERCISE_RELEASE_SET ?? 'unknown',
      sourceRevision: process.env.DPP_EXIT_EXERCISE_SOURCE_REVISION ?? 'unknown',
      sourceState: process.env.DPP_EXIT_EXERCISE_SOURCE_STATE ?? 'unknown',
      failures: 0,
      exercised: [
        'Deployment A built two passports under eu-battery@1 and eu-textile@1, each with a public and a restricted part, and an EPCIS exchange with three source scopes, two of which share an event identifier, one conflict decided with both observations kept, and a pull interrupted after two of four pages.',
        'A was exported in the authorised form with npm run export, run as its own process, and in the public form with the same command called in the test process, then switched off: its API, its database and its index were stopped.',
        'Eleven packages that must be refused were refused by name with nothing written: a substituted and more permissive profile under a correct exporter signature, with and without its digest trusted, another exporter key, a pull checkpoint without its import, a conflict decision without its observation, an altered original under the genuine and under a re-signed manifest, a missing journal under the genuine and under a re-signed manifest, the public package, and a file the manifest does not list.',
        'The authorised package was restored with the restore command into deployment B, which keeps the exchange in the file-system adapter and resolves profiles from the installed bundle. A second restore, with npm run restore run as its own process, wrote nothing.',
        'In B both passports gave the reports they gave in A, check for check and finding for finding, the holder\'s view opened, and a document about another item was refused for the passport.',
        'In B every original was returned byte for byte, every import record, observation, decision and pull page equalled A\'s, and the associations rebuilt at B equalled the ones A held.',
        'A request A had acknowledged answered the same import in B with no new receipt, and the same request identifier with other content conflicted.',
        'The pull was refused by the source until its credential was configured in B, then replayed from its retained bounds without a cursor and finished with no event held twice.',
        'An UPDATE of the battery passport was written in B and the two-state lineage verified.',
      ],
      numbers: { export: numbers.export, restore: numbers.restore, refusals: numbers.refusals, passports: numbers.passports, epcis: numbers.epcis, pull: numbers.pull, update: numbers.update, network: numbers.network, disabled: numbers.disabled },
      simulated: [
        'Each index was the reference index\'s code in the test process, over in-memory storage, with its header checks off. It proves no inclusion: every reading in this exercise was made against scripts only, and nothing here is a statement that a state is in a block.',
        'The wallet was the test wallet, with fixed keys and made-up funding. Nothing was sent to a network: each state\'s network answer is dry-run.',
        'Both deployments held the same wallet key and the same secrets for brand and recipient keys, set by the test. That stands in for the wallet\'s own recovery and the operator\'s own handling of secrets. The package carried none of them.',
        'Sign-in was the development session in both deployments. An export carries no account, session or membership.',
        'The EPCIS source was the fixture server of the tests, on the loopback address, with a bearer credential.',
        'MongoDB was a real server for each deployment, started in memory by the test set-up. The pinned GS1 files were provisioned for the test and read offline.',
      ],
      limits: {
        reached: 'two passports of one state each, six retained EPCIS documents of at most two events, one pull of four pages. These are the sizes this run used, not a capacity.',
        notExercised: [
          'A TRANSFER and its acceptance record, a lifecycle claim and a hand-on offer: this run held none. apps/api/test/portability.test.ts exports and restores them, with records in memory.',
          'A lineage longer than the bound of the index\'s package. The same test carries a short lineage as the parts of the index\'s complete export; no long one was exported.',
          'A source that moved to another address: the remap command was run against the unchanged address only.',
          'A cursor carried at the operator\'s request (--cursors include).',
          'The validator service as B\'s engine: B validated with the engine in its process.',
          'A persistent index and a header source: inclusion was not checked by either deployment.',
        ],
      },
      statement: 'Profile validity is reported apart from the owner-tier check and is never a statement that disclosed data is what a state\'s payload_owner_hash commits to.',
    }
  }, 120_000)

  it('restores into a deployment that holds none of A\'s keys, which reads every passport and verifies all but the issuer\'s authority, opens no restricted part and refuses an UPDATE by name', async () => {
    // Deployment C is restored from the same package with keys of its own: another wallet root key, and other secrets for its brand and recipient keys.
    // Its index admits states under the publisher key A wrote with, which is public. Nothing that would let C act for A's brand reaches it.
    const indexC = await startDevIndex({ publisherKey: PUBLISHER_KEY, network: 'main' })
    const envC = shared({ MONGO_URL: mongoB.getUri(), MONGO_DB: 'deployment_c', INDEX_URL: indexC.url, EPCIS_STORAGE: 'file', EPCIS_STORAGE_DIR: join(scratch, 'c-epcis-store'), PROFILE_BUNDLE_DIR: join(scratch, 'c-profile-bundle'), WALLET_ROOT_KEY: 'c3'.repeat(32), DPP_TEST_WALLET: '1', BRAND_ROOT_SECRET: 'c1'.repeat(32), MANAGED_IDENTITY_SECRET: 'c2'.repeat(32) })
    let c: Deployment | undefined
    try {
      const reportFile = join(scratch, 'restore-report-c.json')
      const restored = await command(runRestoreCommand, ['--from', AUTHORISED, '--exporter-key', PUBLISHER_KEY, '--report', reportFile], envC)
      // Everything is restored, and the command ends with the code that says the operator has something to do: the passports read differently here, and the report says why.
      expect(restored.code, restored.text).toBe(3)
      const report = JSON.parse(readFileSync(reportFile, 'utf8')) as RestoreReport
      expect(report).toMatchObject({ outcome: 'restored', passports: { written: kept.passports.map((passport) => passport.passportId).sort(), unchanged: [] }, index: { rebuilt: true, announced: 2, admitted: 2 }, readings: { compared: 2, same: 0 } })
      expect(report.provisionSeparately.join('\n')).toMatch(/BRAND_ROOT_SECRET and MANAGED_IDENTITY_SECRET as they were: without them this deployment reads every passport and can write none of them/)
      expect([...report.attention].sort()).toEqual(kept.passports.map((passport) => `${passport.passportId} reads differently here: issuerAuthority: pass where it was exported, fail (authority-unconfirmed) here.`).sort())

      c = await start(envC)
      expect(c.platform.wallet.identityKey).not.toBe(PUBLISHER_KEY)
      for (const passport of kept.passports) {
        // C verifies the passport: the same lineage, signatures, linkage and payload checks as A. One finding differs. C reads a passport in its own journal
        // as issued by its own key for the brand, and its key is not the one the genesis was signed with, so the issuer's authority is not confirmed here.
        const reading = (await c.get(`/api/verify?passportId=${ref(passport.passportId)}`)).body as PassportReading
        expect(reading.lineage).toEqual(passport.reading.lineage)
        expect(reading.payloadChecks).toEqual(passport.reading.payloadChecks)
        expect(reading.product).toEqual(passport.reading.product)
        expect(reading.checks.map((check) => check.name)).toEqual(passport.reading.checks.map((check) => check.name))
        const differing = reading.checks.filter((check, at) => JSON.stringify(check) !== JSON.stringify(passport.reading.checks[at]))
        expect(differing).toEqual([{ name: 'issuerAuthority', label: expect.any(String), status: 'fail', reasonCode: 'authority-unconfirmed' }])
        expect(passport.reading.checks.find((check) => check.name === 'issuerAuthority')).toMatchObject({ status: 'pass' })

        // C reads the passport as its journal holds it.
        const view = await c.get(`/api/passports/${ref(passport.passportId)}`)
        expect(view.status).toBe(200)
        expect(view.body).toMatchObject({ passportId: passport.passportId, profile: passport.profile, holder: { party: 'brand:dev-brand' } })
        expect(view.text).not.toContain(RESTRICTED)
        // The restricted part is held and is the one the state commits to, but it is sealed to A's key. C does not open it, and says so: not checked, never a pass.
        const authorised = (await c.post(`/api/passports/${ref(passport.passportId)}/authorised-view`, {})).body as AuthorisedReading
        expect(authorised.ownerTier.status).toBe('pass')
        expect(authorised.authorisedView.status).toBe('not-checked')
        expect(authorised.authorisedView.summary).toMatch(/sealed to another key than brand:dev-brand's/)
        expect(authorised.product).toBeUndefined()
        expect(JSON.stringify(authorised)).not.toContain(RESTRICTED)
      }

      // C cannot write. An UPDATE or a RETIRE asked for by a member of the brand is refused by name before anything is signed, and the passport is as it was.
      const battery = kept.passports[0]!
      const product = { ...structuredClone(battery.product), 'gs1:productDescription': [{ '@value': 'Serviced and returned to use', '@language': 'en' }] }
      for (const [path, body] of [['update', { product }], ['retire', { reason: 'end of life' }]] as const) {
        const refused = await c.post(`/api/passports/${ref(battery.passportId)}/${path}`, body)
        expect(refused.status, path).toBe(409)
        expect(refused.body, path).toMatchObject({ error: 'not-the-controller' })
        expect(refused.body.description, path).toMatch(/the key this deployment derives for brand:dev-brand is another one: it does not hold the secret the passport was written under/)
      }
      expect((await c.platform.store.getPassport(battery.passportId))!.states).toHaveLength(1)
      expect(((await c.get(`/api/verify?passportId=${ref(battery.passportId)}`)).body as PassportReading).lineage).toEqual(battery.reading.lineage)
    } finally {
      await c?.close()
      await indexC.close()
    }
    // The record is written only once this, the last step, has passed, and only with the record the UPDATE step assembled.
    const record = numbers.record as { exercised: string[] } | undefined
    record?.exercised.push('The same package was restored into deployment C, which holds none of A\'s keys. C verified both passports with every finding as in A except the issuer\'s authority, which it does not confirm, read them, did not open their restricted parts, and refused an UPDATE and a RETIRE by name with nothing written.')
    numbers.completed = record != null
  }, 120_000)
})
