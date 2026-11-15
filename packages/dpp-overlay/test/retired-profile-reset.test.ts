import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Engine } from '@bsv/overlay'
import { PrivateKey, ProtoWallet, type Transaction } from '@bsv/sdk'
import { didKeyFromIdentityKey } from '@bsv/dpp-protocol'
import { BSON, MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
// The application's own store, so the rows this rehearsal removes are rows the application writes.
import { MongoStore, type ClaimRecord, type OfferRecord, type PassportRecord } from '../../create-dpp-app/template/apps/api/src/store.js'
import { buildAttestationAnchor } from '../src/attestationAnchor.js'
import { MongoAttestationStorage } from '../src/attestationStorage.js'
import { MongoOverlayStorage } from '../src/engineStorage.js'
import { DppLookupService } from '../src/lsDpp.js'
import { AttestationLookupService } from '../src/lsAttestation.js'
import { MongoPublisherTokenStore, issueToken } from '../src/publisherTokens.js'
import { MongoDppStorage } from '../src/storage.js'
import { AttestationTopicManager } from '../src/tmAttestation.js'
import { DppTopicManager } from '../src/tmDpp.js'
import { SERVER_ID, eventTx, genesisTx, makerPriv } from './helpers.js'
import { documentedBlocks, openMongoShell, type DocumentedBlock, type MongoShell } from './mongo-shell.js'

/**
 * The procedure of `docs/operate/retired-profile-records.md`, run.
 *
 * The page tells an operator how to clear demonstration records issued under
 * a retired profile from two databases of their own, the application's and
 * the index's, and promises that nothing else is touched. This test takes
 * the commands from the page itself, so the page and the test cannot drift:
 * it reads the Markdown, picks each code block by the heading it sits under
 * and runs it unchanged against a real MongoDB. The one thing it writes into
 * a block is what the page tells the operator to paste there, the reviewed
 * passport identifiers.
 *
 * Both databases are seeded through the code that writes them in a running
 * deployment: the index through a real engine over its MongoDB stores, and
 * the application through its own `MongoStore`. Beside the retired records
 * sit everything that shares those stores: passports under `general@1`,
 * `general@2`, `eu-battery@1` and `eu-textile@1`, a retired passport the
 * operator decided to keep, anchors, tokens, the publisher policy,
 * registrations, brands with their keys, sign-in rows, the spend ledger and
 * the EPCIS exchange's collections. Every document of every collection is
 * compared before and after, byte for byte.
 *
 * What is not rehearsed: the `docker compose` commands around the database
 * commands, which need a running preset, `mongosh` itself, for which
 * `mongo-shell.ts` stands in with the same calls and the strictest rule for
 * declaring a name again, and the wallet file and `.env`, which no database
 * command can reach. The test checks instead that the
 * page's shell commands are only the ones that open a shell, stop and start
 * the index and look a passport up.
 */
const page = readFileSync(new URL('../../../docs/operate/retired-profile-records.md', import.meta.url), 'utf8')
const blocks = documentedBlocks(page)
const under = (language: string, ...headings: string[]): DocumentedBlock[] => blocks.filter((block) => block.language === language && headings.every((heading, index) => block.headings[index] === heading))
/** The one block a step has. A page that gains or loses a block under the heading fails here, by name. */
const only = (language: string, ...headings: string[]): string => {
  const found = under(language, ...headings)
  if (found.length !== 1) throw new Error(`expected one ${language} block under ${headings.join(' > ')}, found ${found.length}`)
  return found[0]!.code
}
/** What the operator does with a block that holds a placeholder line: paste the reviewed identifiers in its place. */
const paste = (code: string, placeholder: string, identifiers: readonly string[]): string => {
  if (code.split(placeholder).length !== 2) throw new Error(`the block does not hold the placeholder line exactly once: ${placeholder}`)
  return code.replace(placeholder, identifiers.map((identifier) => JSON.stringify(identifier)).join(',\n  '))
}

const applicationListing = under('js', 'List what would be affected', 'In the application')
const indexListing = under('js', 'List what would be affected', 'In the index')
const indexRemoval = only('js', 'Remove the listed records', 'From the index')
const applicationRemoval = only('js', 'Remove the listed records', 'From the application')
const INDEX_PLACEHOLDER = '  // one passport identifier per line, in quotes, from the listing'
const APPLICATION_PLACEHOLDER = '  // one passport identifier per line, in quotes'

const GTIN = 'https://dpp.example.org/01/09521234000013/21/'
const id = (serial: string): string => `${GTIN}${serial}`
/** Two retired demonstration passports the operator reviewed, and one retired passport the operator decided to keep. */
const REVIEWED = [id('RETIRED-BATTERY-2'), id('RETIRED-TEXTILE-4')]
const KEPT_RETIRED = id('RETIRED-BATTERY-3-KEPT')
const UNRELATED = { 'general@1': id('GENERAL-1'), 'general@2': id('GENERAL-2'), 'eu-battery@1': id('EU-BATTERY-1'), 'eu-textile@1': id('EU-TEXTILE-1') }
const payload = (profile: string, more: Record<string, unknown> = {}): string => {
  const [name, version] = profile.split('@') as [string, string]
  return JSON.stringify({ profile: name, profile_version: Number(version), name: `A record under ${profile}`, ...more })
}

let mongod: MongoMemoryServer
let client: MongoClient
const shells: MongoShell[] = []

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
}, 300_000)

afterAll(async () => {
  for (const shell of shells) shell.close()
  await client?.close()
  await mongod?.stop()
}, 60_000)

const shellOn = (database: string): MongoShell => { const shell = openMongoShell(mongod.getUri(), database); shells.push(shell); return shell }

/** Every document of every collection, as canonical text, so two snapshots compare byte for byte. */
async function snapshot(db: Db): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>()
  for (const { name } of await db.listCollections().toArray()) {
    const documents = await db.collection(name).find({}).toArray()
    found.set(name, documents.map((document) => BSON.EJSON.stringify(document, { relaxed: false })).sort())
  }
  return found
}
/** The documents of `before` that `after` no longer holds, by collection, and a check that nothing was added or altered. */
function removedBetween(before: Map<string, string[]>, after: Map<string, string[]>): Record<string, Array<Record<string, any>>> {
  expect([...after.keys()].sort()).toEqual([...before.keys()].sort())
  const removed: Record<string, Array<Record<string, any>>> = {}
  for (const [name, documents] of before) {
    const now = new Set(after.get(name))
    const then = new Set(documents)
    // A document that is there afterwards was there before, in the same bytes: nothing is added and nothing is rewritten.
    expect([...now].filter((document) => !then.has(document)), `${name} holds a document it did not hold before`).toEqual([])
    const gone = documents.filter((document) => !now.has(document))
    if (gone.length > 0) removed[name] = gone.map((document) => JSON.parse(document) as Record<string, any>)
  }
  return removed
}

describe('the page itself', () => {
  it('holds the command blocks this rehearsal runs, each under the heading that says when to run it', () => {
    expect(applicationListing).toHaveLength(2)
    expect(indexListing).toHaveLength(2)
    expect(indexRemoval).toContain('deleteMany')
    expect(applicationRemoval).toContain('deleteMany')
    // Outside the two removal blocks nothing on the page writes to a database.
    const writes = /\b(?:delete\w*|drop\w*|remove\w*|insert\w*|update\w*|replace\w*|bulkWrite|findOneAnd\w+|renameCollection|createIndex\w*)\s*\(/u
    for (const block of blocks.filter((b) => b.language === 'js' && b.headings[0] !== 'Remove the listed records')) expect(block.code, `a block under ${block.headings.join(' > ')} writes`).not.toMatch(writes)
    // And the removal blocks write by deleteMany alone, each call with a filter that names the reviewed identifiers or their transactions.
    for (const block of [indexRemoval, applicationRemoval]) {
      const calls = [...block.matchAll(/db\.(\w+)\.(\w+)\(/gu)].filter(([, , method]) => writes.test(`${method}(`))
      expect(calls.length).toBeGreaterThan(0)
      for (const [, , method] of calls) expect(method).toBe('deleteMany')
    }
  })

  it('runs no shell command that removes a file, a volume or a container', () => {
    const commands = blocks.filter((block) => block.language === 'sh').flatMap((block) => block.code.trim().split('\n'))
    expect(commands.length).toBeGreaterThan(0)
    for (const command of commands) {
      expect(command, command).toMatch(/^(?:docker compose -f deploy\/compose\.yml --env-file (?:\.env|deploy\/operator\.env) (?:exec (?:-T )?(?:mongo mongosh \w+ --quiet|overlay node --input-type=module - < list-retired-records\.mjs)|stop overlay|start overlay)|curl -s -X POST http:\/\/localhost:8080\/lookup .*)$/u)
    }
  })
})

// Each half is one operator's session, and its tests run in order: the listings, then the removal, then what the
// index does afterwards. A test that removes pastes the identifiers it removes itself, as the page tells the operator to.
describe('the index half, run against the stores an index writes', () => {
  const anchoring = new ProtoWallet(PrivateKey.fromHex('77'.repeat(32)))
  let db: Db
  let engine: Engine
  let passports: DppTopicManager
  let shell: MongoShell
  const txids: Record<string, string[]> = {}
  const transactions: Record<string, Transaction[]> = {}
  let anchoredWithState: string

  const anchorFor = async (subject: string, digest: string) => buildAttestationAnchor({
    digest,
    attestationId: `urn:sha256:${digest}`,
    issuer: didKeyFromIdentityKey(makerPriv.toPublicKey().toString()),
    subject,
    attestationType: 'Origin',
    representation: 'dpp-lifecycle-json-v1',
    mediaType: 'application/json',
    anchoredBy: PrivateKey.fromHex('77'.repeat(32)).toPublicKey().toString(),
  }, anchoring)
  const admit = async (passportId: string, tx: Transaction, topics: string[] = ['tm_dpp']): Promise<void> => {
    const steak = await engine.submit({ beef: tx.toBEEF(), topics })
    for (const topic of topics) expect(steak[topic]?.outputsToAdmit.length, `${passportId} on ${topic}: ${String(passports.refusalFor(tx.id('hex')))}`).toBeGreaterThan(0)
    ;(txids[passportId] ??= []).push(tx.id('hex'))
    ;(transactions[passportId] ??= []).push(tx)
  }
  const lookup = async (passportId: string): Promise<unknown> => engine.lookup({ service: 'ls_dpp', query: { passportId } })

  beforeAll(async () => {
    db = client.db('rehearsal_index')
    const storage = new MongoOverlayStorage(db)
    await storage.ensureIndexes()
    const records = new MongoDppStorage(db)
    await records.ensureReady()
    const attestations = new MongoAttestationStorage(db)
    passports = new DppTopicManager(SERVER_ID, { admittedOutputs: storage })
    engine = new Engine(
      { tm_dpp: passports, tm_attestation: new AttestationTopicManager([]) },
      { ls_dpp: new DppLookupService(records), ls_attestation: new AttestationLookupService(attestations) },
      storage,
      'scripts only',
      undefined, undefined, undefined, undefined, undefined,
      { tm_dpp: false, tm_attestation: false }
    )

    // A retired battery passport with two states. The second declares another profile: a lineage is cleared whole.
    const battery = await genesisTx({ passportId: REVIEWED[0]!, payloadPublic: payload('battery@2') })
    await admit(REVIEWED[0]!, battery.tx)
    await admit(REVIEWED[0]!, (await eventTx(battery.tx, { passportId: REVIEWED[0]!, op: 'EDIT', eventData: '', payloadPublic: payload('general@2') })).tx)
    // A retired textile passport whose transaction also carries an anchor, an output of another topic.
    const textile = await genesisTx({ passportId: REVIEWED[1]!, payloadPublic: payload('textile@4') })
    textile.tx.addOutput({ satoshis: 1, lockingScript: await anchorFor(REVIEWED[1]!, 'a1'.repeat(32)) })
    await admit(REVIEWED[1]!, textile.tx, ['tm_dpp', 'tm_attestation'])
    anchoredWithState = textile.tx.id('hex')
    // A retired passport the operator keeps, and four passports the retirement has nothing to do with.
    await admit(KEPT_RETIRED, (await genesisTx({ passportId: KEPT_RETIRED, payloadPublic: payload('battery@3') })).tx)
    for (const [profile, passportId] of Object.entries(UNRELATED)) {
      const genesis = await genesisTx({ passportId, payloadPublic: payload(profile) })
      await admit(passportId, genesis.tx)
      if (profile === 'general@2') await admit(passportId, (await eventTx(genesis.tx, { passportId, op: 'EDIT', eventData: '', payloadPublic: payload(profile, { revision: 2 }) })).tx)
    }
    // A claim about a reviewed passport, anchored in a transaction of its own: a registry's record, which stays.
    const claim = await genesisTx({ passportId: id('ANCHOR-CARRIER'), payloadPublic: payload('general@2') })
    claim.tx.addOutput({ satoshis: 1, lockingScript: await anchorFor(REVIEWED[0]!, 'b2'.repeat(32)) })
    await admit(id('ANCHOR-CARRIER'), claim.tx, ['tm_dpp', 'tm_attestation'])

    // What else shares the database, and holds nothing per passport.
    await storage.updateLastInteraction('https://peer.example', 'tm_dpp', 41)
    await issueToken(new MongoPublisherTokenStore(db), makerPriv.toPublicKey().toString(), 'submit', 'the application')
    await db.collection('publisherPolicyVersionsV1').insertOne({ version: 1, scope: { operatorProfile: 'single-operator@1' }, publishers: [{ key: makerPriv.toPublicKey().toString(), roles: ['state-publisher'] }], signature: 'c3'.repeat(36) })
    await db.collection('registrationsV1').insertOne({ publisherKey: makerPriv.toPublicKey().toString(), label: 'the application', status: 'approved', requestedAt: '2026-10-01T00:00:00Z' })
    await db.collection('uoraAnchors').insertOne({ txid: 'd4'.repeat(32), outputIndex: 0, digest: 'e5'.repeat(32), subject: REVIEWED[0]!, uoraType: 'Origin' })
    shell = shellOn('rehearsal_index')
  }, 300_000)

  it('lists the passports that declare a retired profile with the page’s script, and changes nothing', async () => {
    const before = await snapshot(db)
    // As the page runs it: the script piped into node, from the root of the built checkout, with the database named in the environment.
    const run = spawnSync(process.execPath, ['--input-type=module', '-'], { cwd: fileURLToPath(new URL('../../../', import.meta.url)), input: indexListing[0]!.code, env: { ...process.env, MONGO_URL: mongod.getUri(), MONGO_DB: 'rehearsal_index' }, encoding: 'utf8' })
    expect(run.status, run.stderr).toBe(0)
    const lines = run.stdout.trim().split('\n')
    const listed = lines.slice(0, -1).map((line) => JSON.parse(line) as { passportId: string; profiles: string[]; states: string[] })
    expect(listed.map((entry) => [entry.passportId, entry.profiles]).sort()).toEqual([[REVIEWED[0], ['battery@2']], [REVIEWED[1], ['textile@4']], [KEPT_RETIRED, ['battery@3']]].sort())
    // The script names the states that declare the retired profile. The later state of the first passport declares another.
    expect(listed.find((entry) => entry.passportId === REVIEWED[0])!.states).toEqual([`${txids[REVIEWED[0]!]![0]}:0`])
    const total = Object.values(txids).flat().length
    expect(lines.at(-1)).toBe(`${total} tm_dpp outputs read; passports that declare a retired profile: 3. Nothing was changed.`)
    expect(await snapshot(db)).toEqual(before)
  })

  it('lists every row of the reviewed passports, whole lineages, and changes nothing', async () => {
    const before = await snapshot(db)
    const printed = shell.run(paste(indexListing[1]!.code, INDEX_PLACEHOLDER, REVIEWED))
    const counts = printed.at(-1)
    const rows = printed.slice(0, -1) as Array<{ passportId: string; txid: string }>
    // Three states: both states of the first passport, the one that declares general@2 included, and the one state of the second.
    expect(rows.map((row) => [row.passportId, row.txid])).toEqual([[REVIEWED[0], txids[REVIEWED[0]!]![0]], [REVIEWED[0], txids[REVIEWED[0]!]![1]], [REVIEWED[1], txids[REVIEWED[1]!]![0]]])
    expect(counts).toEqual({ records: 3, outputs: 3, outputsOfOtherTopics: 1, transactions: 3, appliedMarkers: 3, anchorsAboutThem: 2 })
    expect(await snapshot(db)).toEqual(before)
  })

  it('refuses to remove anything while the list is empty', async () => {
    const before = await snapshot(db)
    const empty = shellOn('rehearsal_index')
    empty.run(indexListing[1]!.code)
    expect(() => empty.run(indexRemoval)).toThrow('IDS is empty: paste the reviewed passport identifiers first')
    expect(await snapshot(db)).toEqual(before)
  })

  it('removes the rows of the reviewed passports and nothing else', async () => {
    const before = await snapshot(db)
    const kept = [KEPT_RETIRED, ...Object.values(UNRELATED)]
    const answersBefore = new Map<string, unknown>()
    for (const passportId of kept) answersBefore.set(passportId, await lookup(passportId))

    // The page's flow after the decision, in the listing's shell: IDS as first pasted, with a passport the operator then
    // decided to keep, pasted again with the shorter list. A block pasted again replaces what it declared, so the kept one stays.
    shell.run(paste(indexListing[1]!.code, INDEX_PLACEHOLDER, [...REVIEWED, KEPT_RETIRED]))
    shell.run(paste(indexListing[1]!.code, INDEX_PLACEHOLDER, REVIEWED))
    const [removed] = shell.run(indexRemoval)
    // The transaction that also carries an anchor keeps its bytes, so three transactions were listed and two are removed.
    expect(removed).toEqual({ records: 3, outputs: 3, appliedMarkers: 3, transactions: 2 })

    const gone = removedBetween(before, await snapshot(db))
    const reviewedTxids = REVIEWED.flatMap((passportId) => txids[passportId]!)
    expect(Object.keys(gone).sort()).toEqual(['dppRecords', 'overlayAppliedTransactions', 'overlayOutputs', 'overlayTransactions'])
    expect(gone.dppRecords!.map((row) => [row.passportId, row.txid]).sort()).toEqual([[REVIEWED[0], txids[REVIEWED[0]!]![0]], [REVIEWED[0], txids[REVIEWED[0]!]![1]], [REVIEWED[1], txids[REVIEWED[1]!]![0]]].sort())
    expect(gone.overlayOutputs!.map((row) => [row.topic, row.txid]).sort()).toEqual(reviewedTxids.map((txid) => ['tm_dpp', txid]).sort())
    expect(gone.overlayAppliedTransactions!.map((row) => [row.topic, row.txid]).sort()).toEqual(reviewedTxids.map((txid) => ['tm_dpp', txid]).sort())
    expect(gone.overlayTransactions!.map((row) => row.txid).sort()).toEqual([...txids[REVIEWED[0]!]!].sort())

    // What the page says stays, stays: the anchor that shared a transaction with a removed state, with that transaction's bytes.
    expect(await db.collection('overlayOutputs').countDocuments({ txid: anchoredWithState, topic: 'tm_attestation' })).toBe(1)
    expect(await db.collection('overlayTransactions').countDocuments({ txid: anchoredWithState })).toBe(1)
    expect(await db.collection('attestationAnchorsV1').countDocuments({ subject: { $in: REVIEWED } })).toBe(2)
    // The sequence counter is left where it was: a removed row's sequence stays assigned.
    expect(await db.collection('dppCounters').find({}).toArray()).toHaveLength(1)

    // The page's own check of the result: a removed passport answers with no outputs, and a kept one answers as before.
    for (const passportId of REVIEWED) expect(await lookup(passportId)).toMatchObject({ outputs: [] })
    for (const passportId of kept) expect(await lookup(passportId)).toEqual(answersBefore.get(passportId))
    for (const passportId of kept) expect((answersBefore.get(passportId) as { outputs: unknown[] }).outputs.length).toBeGreaterThan(0)
  })

  it('leaves an index that still admits a state for a kept passport, and takes a cleared state again if a peer offers it', async () => {
    const general = UNRELATED['general@2']
    const next = await eventTx(transactions[general]!.at(-1)!, { passportId: general, op: 'EDIT', eventData: '', timestamp: '2026-07-26T11:00:00Z', payloadPublic: payload('general@2', { revision: 3 }) })
    expect((await engine.submit({ beef: next.tx.toBEEF(), topics: ['tm_dpp'] })).tm_dpp?.outputsToAdmit).toEqual([0])
    // The page says so under "Decide": a peer that still holds a state offers it again. Clearing is not a block list.
    expect((await engine.submit({ beef: transactions[REVIEWED[0]!]![0]!.toBEEF(), topics: ['tm_dpp'] })).tm_dpp?.outputsToAdmit).toEqual([0])
    expect(await lookup(REVIEWED[0]!)).toMatchObject({ outputs: [expect.anything()] })
  })
})

describe('the application half, run against the store an application writes', () => {
  let db: Db
  let shell: MongoShell
  const brandKey = PrivateKey.fromHex('44'.repeat(32)).toPublicKey().toString()
  const holderKey = PrivateKey.fromHex('55'.repeat(32)).toPublicKey().toString()

  const passport = (passportId: string, profile: string, createdAt: string, seed: string): PassportRecord => ({
    passportId,
    brandId: 'brand-one',
    profile,
    createdAt,
    status: 'active',
    holder: { party: 'brand:brand-one', controllerKey: holderKey },
    states: [
      // The sealed restricted part and the controller key of each state: key material the journal holds nowhere else.
      { op: 'ISSUE', txid: seed.repeat(32), outputIndex: 0, rawTx: `0100${seed}`, beef: Buffer.from(`beef ${seed}`).toString('base64'), timestamp: createdAt, actor: 'brand:brand-one', controllerKey: holderKey, payloadPublic: payload(profile), ownerTier: { hash: seed.repeat(32), ciphertext: Buffer.from(`sealed ${passportId}`).toString('base64') }, index: 'admitted', network: 'accepted' },
    ],
    acceptanceRecords: [],
  })
  const offer = (requestId: string, passportId: string): OfferRecord => ({ requestId, passportId, brandId: 'brand-one', mechanism: 'claim-code', claimCodeHash: 'f6'.repeat(32), terms: {}, termsDigest: '07'.repeat(32), holderIdentityKey: holderKey, expectedPredecessor: { txid: '18'.repeat(32), outputIndex: 0 }, createdAt: '2026-10-02T00:00:00Z', expiresAt: '2026-12-02T00:00:00Z', status: 'open' })
  const claimAbout = (claimId: string, passportId: string): ClaimRecord => ({ id: claimId, passportId, issuer: 'did:key:example', issuedBy: 'brand:brand-one', claim: { claimFormat: 'dpp-lifecycle-v1', eventType: 'Origin', passportId } as unknown as ClaimRecord['claim'], createdAt: '2026-10-03T00:00:00Z' })

  beforeAll(async () => {
    db = client.db('rehearsal_application')
    const store = new MongoStore(db)
    await store.init()
    await store.saveBrand({ id: 'brand-one', name: 'Brand one', identityKey: brandKey, did: didKeyFromIdentityKey(brandKey), createdAt: '2026-09-01T00:00:00Z' })
    await store.saveBrand({ id: 'brand-two', name: 'Brand two', identityKey: holderKey, did: didKeyFromIdentityKey(holderKey), createdAt: '2026-09-02T00:00:00Z' })
    await store.savePassport(passport(REVIEWED[0]!, 'battery@2', '2026-10-01T00:00:00Z', 'a1'))
    await store.savePassport(passport(REVIEWED[1]!, 'textile@4', '2026-10-02T00:00:00Z', 'a2'))
    await store.savePassport(passport(KEPT_RETIRED, 'battery@3', '2026-10-03T00:00:00Z', 'a3'))
    let seed = 0xb0
    for (const [profile, passportId] of Object.entries(UNRELATED)) await store.savePassport(passport(passportId, profile, '2026-11-14T00:00:00Z', (seed++).toString(16)))
    for (const [requestId, passportId] of [['offer-1', REVIEWED[0]!], ['offer-2', REVIEWED[0]!], ['offer-3', KEPT_RETIRED], ['offer-4', UNRELATED['general@2']], ['offer-5', UNRELATED['eu-textile@1']]] as const) await store.saveOffer(offer(requestId, passportId))
    for (const [claimId, passportId] of [['claim-1', REVIEWED[0]!], ['claim-2', REVIEWED[1]!], ['claim-3', KEPT_RETIRED], ['claim-4', UNRELATED['eu-battery@1']]] as const) await store.saveClaim(claimAbout(claimId, passportId))
    // The spend ledger keeps a row per transaction sent, a removed passport's included: it accounts for money, not for passports.
    await store.recordSpend({ txid: 'a1'.repeat(32), satoshis: 12, at: '2026-10-01T00:00:00Z' })
    await store.recordSpend({ txid: 'b0'.repeat(32), satoshis: 12, at: '2026-11-14T00:00:00Z' })
    // The sign-in library's collections, under its own names, in the same database.
    await db.collection('user').insertOne({ id: 'user-1', email: 'developer@localhost', name: 'Developer' })
    await db.collection('session').insertOne({ id: 'session-1', userId: 'user-1', token: 'a-session-token', expiresAt: new Date('2026-12-01T00:00:00Z') })
    await db.collection('account').insertOne({ id: 'account-1', userId: 'user-1', providerId: 'credential', password: 'a-password-hash' })
    await db.collection('organization').insertOne({ id: 'brand-one', name: 'Brand one' })
    await db.collection('member').insertOne({ id: 'member-1', organizationId: 'brand-one', userId: 'user-1', role: 'owner' })
    // The EPCIS exchange's collections. They hold imported source documents and what was derived from them, and declare
    // no profile. One association names a passport this rehearsal removes. This procedure does not read these collections,
    // so the documents stand for whatever the exchange keeps there.
    await db.collection('epcis_log').insertOne({ _id: 1 as never, kind: 'import', importId: 'import-1' })
    await db.collection('epcis_records').insertOne({ _id: 'association/import-1/0' as never, kind: 'association', passportId: REVIEWED[0]!, eventId: 'urn:uuid:11111111-1111-4111-8111-111111111111' })
    await db.collection('epcis_records').insertOne({ _id: 'association/import-1/1' as never, kind: 'association', passportId: UNRELATED['eu-battery@1'], eventId: 'urn:uuid:22222222-2222-4222-8222-222222222222' })
    await db.collection('epcis_bytes').insertOne({ _id: 'sha256/aa' as never, byteLength: 3, chunks: 1, chunkBytes: 3 })
    await db.collection('epcis_chunks').insertOne({ _id: 'sha256/aa/0' as never, data: new BSON.Binary(Buffer.from([1, 2, 3])) })
    shell = shellOn('rehearsal_application')
  }, 300_000)

  it('lists the passports whose journal names a retired profile, with what belongs to them, and changes nothing', async () => {
    const before = await snapshot(db)
    const listed = shell.run(applicationListing[0]!.code) as Array<{ passportId: string; profile: string }>
    expect(listed.map((row) => [row.passportId, row.profile])).toEqual([[REVIEWED[0], 'battery@2'], [REVIEWED[1], 'textile@4'], [KEPT_RETIRED, 'battery@3']])
    expect(Object.keys(listed[0]!).sort()).toEqual(['brandId', 'createdAt', 'passportId', 'profile', 'status'])
    const [counts, ...states] = shell.run(applicationListing[1]!.code) as [Record<string, number>, ...Array<{ passportId: string; op: string; txid: string; network: string }>]
    expect(counts).toEqual({ passports: 3, offers: 3, claims: 3 })
    expect(states.map((state) => [state.passportId, state.op, state.txid, state.network]).sort()).toEqual([[REVIEWED[0], 'ISSUE', 'a1'.repeat(32), 'accepted'], [REVIEWED[1], 'ISSUE', 'a2'.repeat(32), 'accepted'], [KEPT_RETIRED, 'ISSUE', 'a3'.repeat(32), 'accepted']].sort())
    expect(await snapshot(db)).toEqual(before)
  })

  it('refuses an empty list, and a list that names a passport under a profile that is not retired', async () => {
    const before = await snapshot(db)
    expect(() => shell.run(applicationRemoval)).toThrow('REVIEWED is empty: paste the reviewed passport identifiers first')
    for (const passportId of Object.values(UNRELATED)) {
      expect(() => shell.run(paste(applicationRemoval, APPLICATION_PLACEHOLDER, [...REVIEWED, passportId]))).toThrow('1 listed passports do not declare a retired profile: take them off the list')
    }
    // Refused before the first removal: the reviewed passports on the same list are still there.
    expect(await snapshot(db)).toEqual(before)
  })

  it('removes the journal entries, offers and claims of the reviewed passports and nothing else', async () => {
    const before = await snapshot(db)
    const [removed] = shell.run(paste(applicationRemoval, APPLICATION_PLACEHOLDER, REVIEWED))
    expect(removed).toEqual({ claims: 2, offers: 2, passports: 2 })

    const gone = removedBetween(before, await snapshot(db))
    expect(Object.keys(gone).sort()).toEqual(['claims', 'offers', 'passports'])
    expect(gone.passports!.map((row) => [row.passportId, row.profile]).sort()).toEqual([[REVIEWED[0], 'battery@2'], [REVIEWED[1], 'textile@4']])
    expect(gone.offers!.map((row) => [row.requestId, row.passportId]).sort()).toEqual([['offer-1', REVIEWED[0]], ['offer-2', REVIEWED[0]]])
    expect(gone.claims!.map((row) => [row.id, row.passportId]).sort()).toEqual([['claim-1', REVIEWED[0]], ['claim-2', REVIEWED[1]]])

    // Through the application's own store: every other passport reads as it did, the retired one the operator kept included.
    const store = new MongoStore(db)
    expect((await store.listPassports()).map((record) => record.passportId).sort()).toEqual([KEPT_RETIRED, ...Object.values(UNRELATED)].sort())
    for (const passportId of REVIEWED) expect(await store.getPassport(passportId)).toBeUndefined()
    expect((await store.getPassport(UNRELATED['eu-battery@1']))?.states[0]?.ownerTier).toEqual({ hash: 'b2'.repeat(32), ciphertext: Buffer.from(`sealed ${UNRELATED['eu-battery@1']}`).toString('base64') })
    expect((await store.listBrands()).map((brand) => [brand.id, brand.identityKey]).sort()).toEqual([['brand-one', brandKey], ['brand-two', holderKey]])
    // Out of scope and left alone: the spend row of a removed passport's transaction, and the EPCIS association that names it.
    expect(await db.collection('spends').countDocuments({ txid: 'a1'.repeat(32) })).toBe(1)
    expect(await db.collection('epcis_records').countDocuments({ passportId: REVIEWED[0]! })).toBe(1)

    // The listing, run again as the page says, no longer names them.
    expect((shell.run(applicationListing[0]!.code) as Array<{ passportId: string }>).map((row) => row.passportId)).toEqual([KEPT_RETIRED])
  })
})
