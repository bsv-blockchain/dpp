/**
 * The index contract, asked of a running index over HTTP and nothing else.
 *
 * The overlay package's own contract tests (packages/dpp-overlay/test/) run
 * in the test process: they import the source, build an engine over stores
 * in memory and start the HTTP host on a port of their own, so they cannot
 * be pointed at an index somebody else started. This is the smallest set
 * that asks the same contract from outside: the routes of
 * contracts/overlay.yaml that http.test.ts, publisherTokensHttp.test.ts,
 * history.test.ts, evidenceExport.test.ts and evidenceExportParts.test.ts
 * exercise, in the order a writer and a reader meet them.
 *
 * It knows nothing about how the index was started. scripts/delivery-parity.mjs
 * runs it against the index a clean npm consumer started from the packed
 * packages and against the index the operator preset started from its image,
 * and compares what the two answered.
 *
 * Every state it announces is built once by `buildStates`, so both indexes
 * are sent the same bytes. The keys are test keys, published on purpose, the
 * same ones the package's tests use; nothing derived from them holds value.
 *
 * `runIndexContract` returns `checks`, one sentence each with whether it
 * holds, and `observed`, what the index answered with everything that
 * depends on the moment or the machine left out. Two indexes that are the
 * same runtime give the same `observed`.
 */
import { createHash } from 'node:crypto'

export const KEYS = { maker: '11'.repeat(32), publisher: '22'.repeat(32), owner: '33'.repeat(32), stranger: '44'.repeat(32), exporter: '77'.repeat(32) }
const sha256 = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex')
const OCTET = { 'Content-Type': 'application/octet-stream' }
const JSON_BODY = { 'Content-Type': 'application/json' }
const PASSPORT = (serial) => `https://dpp.example.org/01/09521234000013/21/${serial}`

/**
 * The states both indexes are sent, built with the SDK and protocol library
 * the caller hands over (the clean consumer's installed packages).
 *
 * `shared` is one passport of two states, sent to every index. `only` is a
 * passport of two states for each name in `owners`, sent to that index alone
 * and restored into the others from its evidence package.
 */
export async function buildStates({ sdk, protocol }, owners) {
  const { LockingScript, MerklePath, PrivateKey, ProtoWallet, Transaction, TransactionSignature, UnlockingScript, Hash } = sdk
  const maker = PrivateKey.fromHex(KEYS.maker)
  const ANYONE = new LockingScript([{ op: 0x51 }])
  const SIGHASH = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID
  const data = (passportId, uid, overrides = {}) => ({
    passportId,
    op: 'ACTIVATE',
    timestamp: '2026-07-26T09:00:00Z',
    ownerIdentityKey: PrivateKey.fromHex(KEYS.owner).toPublicKey().toString(),
    actorIdentityKey: maker.toPublicKey().toString(),
    actorKeyId: 'maker',
    eventData: '',
    payloadPublic: JSON.stringify({ name: 'Hearth 10', dataCarrier: uid }),
    payloadOwnerHash: protocol.ownerBlobHash([1, 2, 3]),
    previousTxid: '',
    ...overrides,
  })
  const funding = (satoshis) => {
    const tx = new Transaction()
    tx.addOutput({ satoshis, lockingScript: ANYONE })
    tx.merklePath = MerklePath.fromCoinbaseTxidAndHeight(tx.id('hex'), 800_000)
    return tx
  }
  // The DPP output is `<pubkey> OP_CHECKSIG <fields> OP_2DROP...`: a plain signature push unlocks it.
  const unlock = (spending, inputIndex) => {
    const input = spending.inputs[inputIndex]
    const source = input.sourceTransaction
    const sourceOutput = source.outputs[input.sourceOutputIndex]
    const preimage = TransactionSignature.format({
      sourceTXID: source.id('hex'), sourceOutputIndex: input.sourceOutputIndex, sourceSatoshis: sourceOutput.satoshis, transactionVersion: spending.version,
      otherInputs: spending.inputs.filter((_, i) => i !== inputIndex), outputs: spending.outputs, inputIndex, subscript: sourceOutput.lockingScript,
      inputSequence: input.sequence ?? 0xffffffff, lockTime: spending.lockTime, scope: SIGHASH,
    })
    const raw = maker.sign(Hash.sha256(preimage))
    const der = [...new TransactionSignature(raw.r, raw.s, SIGHASH).toChecksigFormat()]
    return new UnlockingScript([{ op: der.length, data: der }])
  }
  const genesis = async (passportId, uid, signer = KEYS.publisher, satoshis = 10_000) => {
    const state = await protocol.completeState(data(passportId, uid), new ProtoWallet(maker), new ProtoWallet(PrivateKey.fromHex(signer)))
    const tx = new Transaction()
    tx.addInput({ sourceTransaction: funding(satoshis), sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
    tx.addOutput({ satoshis: 1, lockingScript: protocol.buildLockingScript(state, maker.toPublicKey()) })
    tx.addOutput({ satoshis: satoshis - 1_000, lockingScript: ANYONE })
    return tx
  }
  const event = async (previous, passportId, uid, satoshis) => {
    const state = await protocol.completeState(data(passportId, uid, { op: 'SOLD', timestamp: '2026-07-26T10:00:00Z', eventData: '{"channel":"store"}', previousTxid: previous.id('hex') }), new ProtoWallet(maker), new ProtoWallet(PrivateKey.fromHex(KEYS.publisher)))
    const tx = new Transaction()
    tx.addInput({ sourceTransaction: previous, sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
    tx.addInput({ sourceTransaction: funding(satoshis), sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
    tx.addOutput({ satoshis: 1, lockingScript: protocol.buildLockingScript(state, maker.toPublicKey()) })
    tx.addOutput({ satoshis: satoshis - 1_000, lockingScript: ANYONE })
    tx.inputs[0].unlockingScript = unlock(tx, 0)
    return tx
  }
  const chain = async (serial, base) => {
    const passportId = PASSPORT(serial)
    const uid = `${serial}-UID`
    const first = await genesis(passportId, uid, KEYS.publisher, base)
    const second = await event(first, passportId, uid, base + 1)
    return { passportId, uid, states: [first, second].map((tx) => ({ txid: tx.id('hex'), beef: tx.toBEEF(), rawTx: tx.toHex() })) }
  }
  const refusedTx = await genesis(PASSPORT('PARITY-REFUSED'), 'PARITY-REFUSED-UID', KEYS.stranger, 10_500)
  // Signed by the admitted publisher, and naming a predecessor that no index holds and that it does not spend.
  const orphanState = await protocol.completeState(data(PASSPORT('PARITY-ORPHAN'), 'PARITY-ORPHAN-UID', { op: 'SOLD', timestamp: '2026-07-26T10:00:00Z', previousTxid: 'cd'.repeat(32) }), new ProtoWallet(maker), new ProtoWallet(PrivateKey.fromHex(KEYS.publisher)))
  const orphanTx = new Transaction()
  orphanTx.addInput({ sourceTransaction: funding(10_600), sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
  orphanTx.addOutput({ satoshis: 1, lockingScript: protocol.buildLockingScript(orphanState, maker.toPublicKey()) })
  orphanTx.addOutput({ satoshis: 9_600, lockingScript: ANYONE })
  const only = {}
  for (const [index, owner] of owners.entries()) only[owner] = await chain(`PARITY-ONLY-${owner.toUpperCase()}`, 11_000 + index * 10)
  return {
    publisherKey: PrivateKey.fromHex(KEYS.publisher).toPublicKey().toString(),
    exporterIdentityKey: PrivateKey.fromHex(KEYS.exporter).toPublicKey().toString(),
    shared: await chain('PARITY-SHARED', 10_000),
    refused: { txid: refusedTx.id('hex'), beef: refusedTx.toBEEF() },
    orphan: { txid: orphanTx.id('hex'), beef: orphanTx.toBEEF() },
    only,
  }
}

/** One request, and its answer read once: status, the headers this contract names, and the body as text and as JSON when it is JSON. */
async function ask(base, path, init = {}) {
  const response = await fetch(`${base}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(30_000), ...init })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = undefined }
  return { status: response.status, headers: response.headers, text, body }
}
const bearer = (token) => (token == null ? {} : { Authorization: `Bearer ${token}` })
const submit = (base, beef, token, headers = {}) => ask(base, '/submit', { method: 'POST', headers: { ...OCTET, 'x-topics': JSON.stringify(['tm_dpp']), ...bearer(token), ...headers }, body: new Uint8Array(beef) })
const lookup = (base, query) => ask(base, '/lookup', { method: 'POST', headers: JSON_BODY, body: JSON.stringify({ service: 'ls_dpp', query }) })

/** The states an index serves for a query, as `txid:outputIndex` with the digest of each BEEF, in a stable order. */
function served(sdk, answer) {
  return (answer.body?.outputs ?? []).map((o) => ({ outpoint: `${sdk.Transaction.fromBEEF(o.beef).id('hex')}:${o.outputIndex}`, beefSha256: sha256(o.beef), proven: sdk.Transaction.fromBEEF(o.beef).merklePath != null })).sort((a, b) => a.outpoint.localeCompare(b.outpoint))
}

/** A package's evidence files, by path with the digest of each, leaving out the two the moment of export writes. */
function evidenceFiles(sdk, files) {
  return Object.entries(files).filter(([path]) => path.startsWith('transactions/') || path.startsWith('proofs/') || path.startsWith('authority/')).map(([path, base64]) => ({ path, sha256: sha256(sdk.Utils.toArray(base64, 'base64')) })).sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Ask the contract of one index.
 *
 * @param {object} options
 * @param {string} options.base            the index's address
 * @param {object} options.modules         `{ sdk, protocol, overlay }`: @bsv/sdk, @bsv/dpp-protocol and @bsv/dpp-overlay as the reader loads them
 * @param {object} options.states          what `buildStates` returned
 * @param {string} options.own             which of `states.only` this index is sent
 * @param {object} options.tokens          `{ submit, callback, exportToken }`
 * @param {object} options.validators      `{ capabilities, evidencePackage, evidenceExport, history }`: compiled JSON Schema validators
 */
export async function runIndexContract({ base, modules, states, own, tokens, validators }) {
  const { sdk, protocol, overlay } = modules
  const checks = []
  const observed = {}
  const say = (ok, sentence) => { checks.push({ ok: ok === true, sentence }); return ok === true }
  const shared = states.shared
  const mine = states.only[own]

  // The node says what it is.
  const health = await ask(base, '/health')
  say(health.status === 200 && health.body?.status === 'ok' && health.body.topic === 'tm_dpp' && health.body.service === 'ls_dpp', `GET /health answers ${health.status} with the passport topic and service.`)
  const { startedAt: _startedAt, ...healthBody } = health.body ?? {}
  observed.health = healthBody
  const capabilities = await ask(base, '/capabilities')
  const capabilitiesValid = validators.capabilities(capabilities.body)
  say(capabilities.status === 200 && capabilitiesValid, `GET /capabilities answers a capability document that validates against contracts/capabilities.schema.json${capabilitiesValid ? '' : `: ${JSON.stringify(validators.capabilities.errors?.slice(0, 2))}`}.`)
  say(capabilities.body?.exporterIdentityKey === states.exporterIdentityKey, 'the capability document names the exporter identity key the node was configured with.')
  // The document carries when it was built, which no two answers share.
  observed.capabilities = JSON.parse(JSON.stringify(capabilities.body ?? {}, (key, value) => (['generatedAt', 'asOf', 'at', 'checkedAt'].includes(key) ? undefined : value)))
  const managers = await ask(base, '/listTopicManagers')
  const services = await ask(base, '/listLookupServiceProviders')
  say(managers.status === 200 && 'tm_dpp' in (managers.body ?? {}) && 'tm_attestation' in managers.body && services.status === 200 && 'ls_dpp' in (services.body ?? {}) && 'ls_attestation' in services.body, 'it lists the passport and attestation topic managers and lookup services.')
  observed.topicManagers = managers.body
  observed.lookupServices = services.body
  const documentation = await ask(base, '/getDocumentationForTopicManager?manager=tm_dpp')
  const lookupDocumentation = await ask(base, '/getDocumentationForLookupServiceProvider?lookupService=ls_dpp')
  const noDocumentation = await ask(base, '/getDocumentationForTopicManager?manager=tm_other')
  say(documentation.status === 200 && (documentation.headers.get('content-type') ?? '').startsWith('text/markdown') && documentation.text.length > 200 && lookupDocumentation.status === 200 && noDocumentation.status === 400, 'it serves Markdown documentation for an advertised name and refuses an unknown one with 400.')
  observed.documentation = { topicManager: sha256(documentation.text), lookupService: sha256(lookupDocumentation.text) }
  const preflight = await ask(base, '/submit', { method: 'OPTIONS' })
  const nowhere = await ask(base, '/no-such-route')
  say(preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === '*' && nowhere.status === 404, 'it answers a CORS preflight with 204 and an unknown route with 404.')
  observed.preflight = { status: preflight.status, methods: preflight.headers.get('access-control-allow-methods'), headers: preflight.headers.get('access-control-allow-headers') }

  // A write is refused without a token, and reads stay open.
  const refusals = []
  for (const headers of [{}, { Authorization: 'Bearer wrong' }, { Authorization: `Bearer ${tokens.submit}-plus` }, { Authorization: `Basic ${tokens.submit}` }, { Authorization: tokens.submit }, bearer(tokens.callback)]) {
    const refused = await ask(base, '/submit', { method: 'POST', headers: { ...OCTET, ...headers }, body: new Uint8Array(shared.states[0].beef) })
    refusals.push({ status: refused.status, description: refused.body?.description })
  }
  say(refusals.every((r) => r.status === 401), `POST /submit is refused with 401 for no token, a wrong token, a longer token, another scheme, a bare token and the callback token (${refusals.map((r) => r.status).join(', ')}).`)
  observed.submitRefusals = refusals
  const emptyBefore = await lookup(base, { passportId: shared.passportId })
  say(emptyBefore.status === 200 && Array.isArray(emptyBefore.body?.outputs) && emptyBefore.body.outputs.length === 0, 'nothing a refused write carried was admitted: the lookup of that passport is empty, and the lookup needs no token.')
  const retractRefused = await ask(base, '/retract', { method: 'POST', headers: JSON_BODY, body: JSON.stringify({ txid: shared.states[0].txid, outputIndex: 0, reason: 'parity' }) })
  const proofRefused = await ask(base, '/arc-ingest', { method: 'POST', headers: JSON_BODY, body: JSON.stringify({ txid: shared.states[0].txid, txStatus: 'SEEN_ON_NETWORK' }) })
  const proofWrongToken = await ask(base, '/arc-ingest', { method: 'POST', headers: { ...JSON_BODY, ...bearer(tokens.submit) }, body: JSON.stringify({ txid: shared.states[0].txid, txStatus: 'SEEN_ON_NETWORK' }) })
  say(retractRefused.status === 401 && proofRefused.status === 401 && proofWrongToken.status === 401, `POST /retract and POST /arc-ingest are refused with 401 without their token, and the proof route refuses the submit token (${retractRefused.status}, ${proofRefused.status}, ${proofWrongToken.status}).`)
  observed.otherWriteRefusals = [retractRefused, proofRefused, proofWrongToken].map((r) => ({ status: r.status, description: r.body?.description }))

  // Malformed requests, with the right token, before anything is admitted.
  const empty = await ask(base, '/submit', { method: 'POST', headers: { ...OCTET, ...bearer(tokens.submit) } })
  const badTopics = await ask(base, '/submit', { method: 'POST', headers: { ...OCTET, 'x-topics': 'tm_dpp', ...bearer(tokens.submit) }, body: new Uint8Array([1]) })
  const otherTopic = await submit(base, shared.states[0].beef, tokens.submit, { 'x-topics': JSON.stringify(['tm_other']) })
  const notBeef = await submit(base, [1, 2, 3, 4], tokens.submit)
  say(empty.status === 400 && empty.body?.description === 'empty body' && badTopics.status === 400 && String(badTopics.body?.description).includes('X-Topics') && otherTopic.status === 400 && String(otherTopic.body?.description).includes('tm_other') && notBeef.status === 400, `an empty body, a malformed topics header, an unregistered topic and bytes that are no transaction are each refused with 400 (${[empty, badTopics, otherTopic, notBeef].map((r) => r.status).join(', ')}).`)
  const noService = await ask(base, '/lookup', { method: 'POST', headers: JSON_BODY, body: JSON.stringify({ query: { uid: shared.uid } }) })
  const notJson = await ask(base, '/lookup', { method: 'POST', headers: JSON_BODY, body: '{' })
  const noKey = await lookup(base, {})
  const operatorShaped = await lookup(base, { passportId: { $ne: '' } })
  say(noService.status === 400 && notJson.status === 400 && noKey.status === 400 && String(noKey.body?.description).includes('passportId') && operatorShaped.status === 400, `a lookup with no service, a body that is not JSON, a query with neither key and an operator-shaped query are each refused with 400 (${[noService, notJson, noKey, operatorShaped].map((r) => r.status).join(', ')}).`)
  observed.malformed = [empty, badTopics, otherTopic, noService, notJson, noKey, operatorShaped].map((r) => ({ status: r.status, description: r.body?.description }))

  // A real record: admitted once, a no-op twice, served with the bytes that were announced.
  const first = await submit(base, shared.states[0].beef, tokens.submit)
  say(first.status === 200 && first.headers.get('x-admission') === 'tm_dpp=admitted' && JSON.stringify(first.body) === JSON.stringify({ tm_dpp: { outputsToAdmit: [0], coinsToRetain: [], coinsRemoved: [] } }), `the genesis is admitted with the token the node issued: ${first.status}, X-Admission ${first.headers.get('x-admission')}.`)
  const lowerScheme = await ask(base, '/submit', { method: 'POST', headers: { ...OCTET, Authorization: `bearer ${tokens.submit}` }, body: new Uint8Array(shared.states[0].beef) })
  say(lowerScheme.status === 200 && lowerScheme.headers.get('x-admission') === 'tm_dpp=duplicate' && lowerScheme.headers.get('x-admission-refusal') === null && JSON.stringify(lowerScheme.body?.tm_dpp?.outputsToAdmit) === '[]', `announced again, with the scheme in lower case and no topics header, it is a duplicate and no refusal: X-Admission ${lowerScheme.headers.get('x-admission')}.`)
  // The token is bound to one publisher key, so a state another key signed is refused before the engine is asked.
  const stranger = await submit(base, states.refused.beef, tokens.submit)
  say(stranger.status === 403 && stranger.body?.error === 'token-publisher-mismatch', `a state signed by another key is refused with the publisher's own token: ${stranger.status} ${stranger.body?.error}.`)
  const orphan = await submit(base, states.orphan.beef, tokens.submit)
  say(orphan.status === 200 && orphan.headers.get('x-admission') === 'tm_dpp=none' && /^tm_dpp=[a-z-]+$/.test(orphan.headers.get('x-admission-refusal') ?? '') && orphan.headers.get('access-control-expose-headers') === 'X-Admission, X-Admission-Refusal' && JSON.stringify(orphan.body?.tm_dpp?.outputsToAdmit) === '[]', `a state the publisher signed that names a predecessor nobody holds is admitted nowhere and the answer says why: X-Admission ${orphan.headers.get('x-admission')}, X-Admission-Refusal ${orphan.headers.get('x-admission-refusal')}.`)
  const second = await submit(base, shared.states[1].beef, tokens.submit)
  say(second.status === 200 && second.headers.get('x-admission') === 'tm_dpp=admitted', `the state that spends the genesis is admitted: X-Admission ${second.headers.get('x-admission')}.`)
  observed.admission = [first, lowerScheme, stranger, orphan, second].map((r) => ({ status: r.status, admission: r.headers.get('x-admission'), refusal: r.headers.get('x-admission-refusal'), body: r.body }))
  const byPassport = await lookup(base, { passportId: shared.passportId })
  const byUid = await lookup(base, { uid: shared.uid })
  const expected = shared.states.map((s) => ({ outpoint: `${s.txid}:0`, beefSha256: sha256(s.beef), proven: false })).sort((a, b) => a.outpoint.localeCompare(b.outpoint))
  say(byPassport.status === 200 && byPassport.body?.type === 'output-list' && JSON.stringify(served(sdk, byPassport)) === JSON.stringify(expected) && JSON.stringify(served(sdk, byUid)) === JSON.stringify(expected), `a lookup by passport identifier and by data carrier each answer both states, byte for byte as they were announced (${served(sdk, byPassport).length} states).`)
  const miss = await lookup(base, { uid: 'nothing-here' })
  const refusedLookup = await lookup(base, { passportId: PASSPORT('PARITY-REFUSED') })
  const orphanLookup = await lookup(base, { passportId: PASSPORT('PARITY-ORPHAN') })
  say(miss.status === 200 && JSON.stringify(miss.body?.outputs) === '[]' && JSON.stringify(refusedLookup.body?.outputs) === '[]' && JSON.stringify(orphanLookup.body?.outputs) === '[]', 'an unknown data carrier and the passports of the two refused states each answer an empty list.')
  observed.lookup = { byPassport: served(sdk, byPassport), byUid: served(sdk, byUid) }

  // A proof, pushed with the callback token.
  const statusOnly = await ask(base, '/arc-ingest', { method: 'POST', headers: { ...JSON_BODY, ...bearer(tokens.callback) }, body: JSON.stringify({ txid: shared.states[0].txid, txStatus: 'SEEN_ON_NETWORK' }) })
  say(statusOnly.status === 200 && statusOnly.body?.status === 'ignored', `a status-only callback is acknowledged and ignored (${statusOnly.status}, ${statusOnly.body?.status}).`)
  const strangerTxid = 'ab'.repeat(32)
  const unknownProof = await ask(base, '/arc-ingest', { method: 'POST', headers: { ...JSON_BODY, ...bearer(tokens.callback) }, body: JSON.stringify({ txid: strangerTxid, merklePath: sdk.MerklePath.fromCoinbaseTxidAndHeight(strangerTxid, 800_001).toHex() }) })
  const malformedProof = await ask(base, '/arc-ingest', { method: 'POST', headers: { ...JSON_BODY, ...bearer(tokens.callback) }, body: JSON.stringify({ txid: shared.states[0].txid, merklePath: 'not hex' }) })
  say(unknownProof.status === 404 && malformedProof.status === 400, `a proof for a transaction the index does not hold answers 404 and a body that is no proof answers 400 (${unknownProof.status}, ${malformedProof.status}).`)
  const proof = sdk.MerklePath.fromCoinbaseTxidAndHeight(shared.states[0].txid, 800_001)
  const pushed = await ask(base, '/arc-ingest', { method: 'POST', headers: { ...JSON_BODY, 'X-Callback-Token': tokens.callback }, body: JSON.stringify({ txid: shared.states[0].txid, merklePath: proof.toHex(), blockHeight: 800_001 }) })
  const afterProof = await lookup(base, { passportId: shared.passportId })
  const proven = (afterProof.body?.outputs ?? []).map((o) => sdk.Transaction.fromBEEF(o.beef)).find((tx) => tx.id('hex') === shared.states[0].txid)
  say(pushed.status === 503 && pushed.body?.description === 'proof ingestion requires a chain tracker' && proven != null && proven.merklePath == null, `the scripts-only index defers proof ingestion and continues serving the unproven state (${pushed.status}).`)
  observed.proofs = { statusOnly: statusOnly.body, unknown: { status: unknownProof.status, description: unknownProof.body?.description }, malformed: { status: malformedProof.status, description: malformedProof.body?.description }, deferred: pushed.body, served: served(sdk, afterProof) }

  // The passport this index alone is sent.
  for (const state of mine.states) {
    const admitted = await submit(base, state.beef, tokens.submit)
    say(admitted.status === 200 && admitted.headers.get('x-admission') === 'tm_dpp=admitted', `its own passport's state ${state.txid.slice(0, 12)} is admitted.`)
  }

  // History and the two exports.
  const history = await ask(base, `/history?passportId=${encodeURIComponent(shared.passportId)}`)
  const historyValid = validators.history(history.body)
  say(history.status === 200 && historyValid && history.body.completeForSnapshot === true && JSON.stringify(history.body.items.map((i) => [i.txid, i.spent])) === JSON.stringify([[shared.states[0].txid, true], [shared.states[1].txid, false]]), `GET /history answers one complete page that validates against its schema: the genesis spent and the second state unspent${historyValid ? '' : `: ${JSON.stringify(validators.history.errors?.slice(0, 2))}`}.`)
  observed.history = (history.body?.items ?? []).map((i) => ({ txid: i.txid, outputIndex: i.outputIndex, op: i.op, spent: i.spent, sequence: i.sequence }))
  const signer = protocol.evidencePackageSigner(states.exporterIdentityKey, shared.passportId)
  const exported = await ask(base, `/evidence-package?passportId=${encodeURIComponent(shared.passportId)}`)
  const manifest = exported.body?.manifest
  const manifestValid = exported.status === 200 && validators.evidencePackage(manifest)
  const inspection = exported.status === 200 ? protocol.inspectEvidencePackage(manifest, overlay.envelopeFiles(exported.body), { expectedPassportId: shared.passportId, expectedSigner: signer }) : undefined
  say(manifestValid && inspection.structureValid && inspection.inventoryVerified && inspection.signatureValid && inspection.failures.length === 0, `GET /evidence-package answers a package whose manifest validates against contracts/evidence-package.schema.json and whose structure, inventory and signature verify under the exporter's key for the passport${manifestValid ? '' : `: ${JSON.stringify(validators.evidencePackage.errors?.slice(0, 2))}`}.`)
  const packagePaths = Object.keys(exported.body?.files ?? {}).sort()
  const expectedPaths = [...shared.states.map((s) => `proofs/${s.txid}.beef`), 'reports/verification-report.json', 'status/spend-observations.json', ...shared.states.map((s) => `transactions/${s.txid}.tx`)].sort()
  const rawMatches = shared.states.every((s) => sdk.Utils.toHex(sdk.Utils.toArray(exported.body?.files?.[`transactions/${s.txid}.tx`] ?? '', 'base64')) === s.rawTx)
  say(JSON.stringify(packagePaths) === JSON.stringify(expectedPaths) && rawMatches, `the package carries each state's transaction and proof, the spend observations and the report, and each transaction is the bytes announced (${packagePaths.length} files).`)
  say(manifest?.genesis?.txid === shared.states[0].txid && manifest?.selectedTip?.txid === shared.states[1].txid && manifest?.exporter?.id === states.exporterIdentityKey && manifest?.signature?.signer === signer && manifest.signature.signer !== states.exporterIdentityKey, 'the manifest names the genesis, the tip and the exporter, and is signed by the exporter key\'s child for the passport, not by the identity key itself.')
  const tampered = exported.status === 200 ? overlay.envelopeFiles(exported.body) : new Map()
  const tamperedPath = `transactions/${shared.states[0].txid}.tx`
  if (tampered.has(tamperedPath)) { const bytes = [...tampered.get(tamperedPath)]; bytes[10] ^= 0x01; tampered.set(tamperedPath, bytes) }
  const flipped = exported.status === 200 ? protocol.inspectEvidencePackage(manifest, tampered, { expectedPassportId: shared.passportId, expectedSigner: signer }) : undefined
  say(flipped != null && flipped.signatureValid === true && flipped.inventoryVerified === false && flipped.failures.length === 1 && flipped.failures[0].reason === 'digest-mismatch', 'a flipped byte in one file fails the inventory and nothing else.')
  const unknownPackage = await ask(base, `/evidence-package?passportId=${encodeURIComponent(PASSPORT('NOBODY'))}`)
  const missingPackage = await ask(base, '/evidence-package')
  say(unknownPackage.status === 404 && unknownPackage.body?.error === 'passport-unknown' && missingPackage.status === 400 && missingPackage.body?.error === 'query-invalid', `an unknown passport answers 404 passport-unknown and a request without one 400 query-invalid (${unknownPackage.status}, ${missingPackage.status}).`)
  const report = exported.status === 200 ? JSON.parse(sdk.Utils.toUTF8(sdk.Utils.toArray(exported.body.files['reports/verification-report.json'], 'base64'))) : undefined
  observed.evidencePackage = {
    files: evidenceFiles(sdk, exported.body?.files ?? {}),
    paths: packagePaths,
    manifest: manifest == null ? undefined : { format: manifest.format, version: manifest.version, passportId: manifest.passportId, genesis: manifest.genesis, selectedTip: manifest.selectedTip, exporter: manifest.exporter, profiles: manifest.profiles, policyId: manifest.policyId, disclosure: manifest.disclosure, absent: manifest.completeness?.absent, withheld: manifest.completeness?.withheld, sources: (manifest.sources ?? []).map((s) => [s.kind, s.result]), signer: manifest.signature?.signer },
    report: report == null ? undefined : { reportVersion: report.reportVersion, checks: report.checks.map((c) => [c.name, c.status, c.reasonCode]), latestState: report.observations?.latestState },
  }

  const closed = await ask(base, `/evidence-export?passportId=${encodeURIComponent(shared.passportId)}`)
  const wrongBearer = await ask(base, `/evidence-export?passportId=${encodeURIComponent(shared.passportId)}`, { headers: bearer(tokens.submit) })
  say(closed.status === 401 && closed.body?.error === 'export-unauthorised' && wrongBearer.status === 401, `GET /evidence-export is refused with 401 export-unauthorised without the export bearer, and with the submit token in its place (${closed.status}, ${wrongBearer.status}).`)
  const parts = []
  let cursor
  let partsValid = true
  for (let guard = 0; guard < 50; guard++) {
    const part = await ask(base, `/evidence-export?passportId=${encodeURIComponent(shared.passportId)}${cursor == null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`, { headers: bearer(tokens.exportToken) })
    if (part.status !== 200) { partsValid = false; break }
    if (!validators.evidenceExport(part.body)) partsValid = false
    parts.push(part.body)
    cursor = part.body.nextCursor
    if (cursor == null) break
  }
  const joined = parts.length === 0 ? undefined : overlay.joinEvidenceExport(parts, { expectedPassportId: shared.passportId, expectedSigner: signer })
  say(partsValid && joined?.complete === true && joined.problems.length === 0 && shared.states.every((s) => joined.files.has(`transactions/${s.txid}.tx`) && joined.files.has(`proofs/${s.txid}.beef`)), `with the bearer, the complete export answers ${parts.length} part${parts.length === 1 ? '' : 's'} that validate against the package's schema and join into every state's transaction and proof.`)
  observed.evidenceExport = { parts: parts.length, complete: joined?.complete, problems: joined?.problems, absent: joined?.absent, files: joined == null ? [] : [...joined.files.entries()].filter(([path]) => path.startsWith('transactions/') || path.startsWith('proofs/')).map(([path, bytes]) => ({ path, sha256: sha256(bytes) })).sort((a, b) => a.path.localeCompare(b.path)) }

  return { checks, observed }
}

/**
 * What an index still answers after it and its database were stopped and
 * started again: the same states, byte for byte, the same history, the same
 * package files, and the same token still accepted and still required.
 */
export async function runAfterRestart({ base, modules, states, own, tokens }) {
  const { sdk } = modules
  const checks = []
  const observed = {}
  const say = (ok, sentence) => { checks.push({ ok: ok === true, sentence }); return ok === true }
  const health = await ask(base, '/health')
  say(health.status === 200 && health.body?.status === 'ok', 'after the restart GET /health answers again.')
  for (const [label, chain] of [['shared', states.shared], ['own', states.only[own]]]) {
    const answer = await lookup(base, { passportId: chain.passportId })
    const held = served(sdk, answer)
    say(held.length === chain.states.length && chain.states.every((s) => held.some((h) => h.outpoint === `${s.txid}:0`)), `the ${label} passport's ${chain.states.length} states are still served after the restart.`)
    observed[`lookup:${label}`] = held
  }
  const history = await ask(base, `/history?passportId=${encodeURIComponent(states.shared.passportId)}`)
  observed.history = (history.body?.items ?? []).map((i) => ({ txid: i.txid, outputIndex: i.outputIndex, op: i.op, spent: i.spent, sequence: i.sequence }))
  const exported = await ask(base, `/evidence-package?passportId=${encodeURIComponent(states.shared.passportId)}`)
  say(exported.status === 200, 'the evidence package is still exported after the restart.')
  observed.evidenceFiles = evidenceFiles(sdk, exported.body?.files ?? {})
  const again = await submit(base, states.shared.states[1].beef, tokens.submit)
  const refused = await submit(base, states.shared.states[1].beef, undefined)
  say(again.status === 200 && again.headers.get('x-admission') === 'tm_dpp=duplicate' && refused.status === 401, `the token issued before the restart is still accepted and still required: a repeated announcement is a duplicate, and one without the token is refused (${again.status}, ${refused.status}).`)
  observed.afterRestartWrites = { withToken: again.headers.get('x-admission'), withoutToken: refused.status }
  return { checks, observed }
}

/**
 * Restore a passport into an index that has never seen it, from another
 * index's evidence package alone, the way a second operator does: each
 * `proofs/` BEEF submitted, genesis first. Returns what the index then serves.
 */
export async function restoreFromPackage({ base, modules, envelope, passportId, token }) {
  const { sdk, protocol } = modules
  const proofs = new Map()
  const merged = new sdk.Beef()
  for (const [path, base64] of Object.entries(envelope.files)) {
    if (!path.startsWith('proofs/')) continue
    const beef = sdk.Utils.toArray(base64, 'base64')
    proofs.set(path.slice('proofs/'.length, -'.beef'.length), beef)
    merged.mergeBeef(beef)
  }
  const ordered = protocol.chainFromBeef(merged, passportId)
  const admissions = []
  for (const tx of ordered) admissions.push((await submit(base, proofs.get(tx.id('hex')), token)).headers.get('x-admission'))
  const answer = await lookup(base, { passportId })
  return { admissions, served: served(sdk, answer) }
}

export { ask as askIndex, lookup as lookupPassport, served as servedStates, evidenceFiles }
