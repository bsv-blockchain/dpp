#!/usr/bin/env node
/**
 * A record version 3 lifecycle, the token carrier, from fresh keys, with no
 * wallet and no network: the shape a writer follows under
 * spec/token-carrier.md, which carries the version 2 body behind the BRC-162
 * token prefix so that readers of that token protocol follow the passport as
 * a fungible token of one unit.
 *
 *   node examples/lifecycle-v3.mjs
 *
 * Three parties, each a key made for this run and thrown away after it: an
 * issuer who opens the passport, a custodian who holds the lock and publishes
 * every state, and a recipient. The script walks the lifecycle in order and
 * prints one sentence per step: ISSUE carried as a fixed-supply deploy of one
 * unit at output 0, whose outpoint is the token id; UPDATE and TRANSFER
 * carried as value outputs naming that token id; RETIRE, a value output
 * nothing may spend; then the verifier's own check and the report a stranger
 * produces from the bytes. Then the refusals the carrier makes, each shown
 * refused: a genesis away from output 0, a value output naming another
 * token, a version 2 body behind the prefix, and the burn, which to a token
 * reader ends the token and to a passport reader is no state at all.
 *
 * Nothing here is sent anywhere. The transactions are unsigned at the input,
 * because a verifier does not run scripts, and their inclusion reads
 * pending, because no header source holds them. Results print one sentence
 * per check, never a score, as GOVERNANCE.md requires of every conformance
 * surface.
 */
import { CachedKeyDeriver, LockingScript, OP, PrivateKey, ProtoWallet, Transaction, UnlockingScript, Utils } from '@bsv/sdk'
import {
  CARRIER_REFUSALS,
  EVIDENCE_CHECK_LABELS,
  buildLockingScript,
  carrierPrefixChunks,
  completeState,
  findDppOutputs,
  ownerBlobHash,
  ownerKeyFromDeriver,
  ownerLinkageFromDeriver,
  parseDppOutput,
  tokenIdOf,
  tokenIdWireBytes,
  verifyChain,
  verifyPassportEvidence,
} from '@bsv/dpp-core'

let failures = 0
const say = (ok, sentence) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok' : 'FAIL'}: ${sentence}`)
}
const step = (sentence) => console.log(`step: ${sentence}`)
const instant = (offsetSeconds = 0) => new Date(Date.now() + offsetSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')

// ------------------------------------------------------------- the parties
const issuerPriv = PrivateKey.fromRandom()
const custodianPriv = PrivateKey.fromRandom()
const recipientPriv = PrivateKey.fromRandom()
const idKey = (priv) => priv.toPublicKey().toString()
const issuerWallet = new ProtoWallet(issuerPriv)
const custodianWallet = new ProtoWallet(custodianPriv)
const recipientWallet = new ProtoWallet(recipientPriv)

// A demonstration identifier under GS1 prefix 952 (spec/record-model.md §3), serialised per run.
const passportId = `https://dpp.bsvb.net/01/09521000000018/21/CARRIER-${Date.now().toString(36).toUpperCase()}`
const controllerKeyOf = (priv) => ownerKeyFromDeriver(passportId, new CachedKeyDeriver(priv))
const controlLinkageOf = (priv) => ownerLinkageFromDeriver(passportId, new CachedKeyDeriver(priv))
const lockKey = custodianPriv.toPublicKey()

console.log(`Passport ${passportId}`)
console.log(`Issuer ${idKey(issuerPriv).slice(0, 12)}..., custodian ${idKey(custodianPriv).slice(0, 12)}..., recipient ${idKey(recipientPriv).slice(0, 12)}...`)

// ------------------------------------------------------------ the builders
const PAYLOAD_1 = JSON.stringify({ name: 'Cell pack 40', chemistry: 'LFP', dataCarrier: 'CARRIER-UID' })
const PAYLOAD_2 = JSON.stringify({ name: 'Cell pack 40', chemistry: 'LFP', dataCarrier: 'CARRIER-UID', recycledContent: 12 })
const BLOB_1 = [10, 20, 30, 40]
const BLOB_2 = [50, 60, 70]

const txs = []
const outputIndexes = []
const tip = () => ({ tx: txs[txs.length - 1], outputIndex: outputIndexes[outputIndexes.length - 1] })
const genesis = () => ({ txid: txs[0].id('hex'), outputIndex: 0 })
const link = () => ({ previousTxid: tip().tx.id('hex'), previousOutputIndex: tip().outputIndex, lineageGenesis: genesis() })

/** A version 3 state's data with the fields every state shares filled in. */
function data(overrides) {
  return {
    version: '3',
    passportId,
    timestamp: instant(),
    actorKeyId: 'carrier example',
    eventData: '',
    payloadPublic: PAYLOAD_1,
    payloadOwnerHash: ownerBlobHash(BLOB_1),
    previousTxid: '',
    previousOutputIndex: null,
    lineageGenesis: null,
    controlLinkage: '',
    authorisationCommitment: '',
    ...overrides,
  }
}

/**
 * Sign as the actor and the custodian (publisher), wrap into a transaction
 * spending the tip, keep it. The token prefix is derived from the state:
 * a genesis is the deploy, every later state a value output naming the
 * genesis (spec/token-carrier.md §2, §5). `carrier` overrides it, which the
 * refusals below use; `opReturnFirst` puts the carrier output at index 1.
 */
async function write(d, actorWallet, { keep = true, prev = txs.length === 0 ? null : tip(), carrier, opReturnFirst = false } = {}) {
  const state = await completeState(d, actorWallet, custodianWallet)
  const tx = new Transaction()
  if (prev != null) tx.addInput({ sourceTransaction: prev.tx, sourceOutputIndex: prev.outputIndex, unlockingScript: new UnlockingScript([]) })
  if (opReturnFirst) tx.addOutput({ satoshis: 0, lockingScript: new LockingScript([{ op: 0 }, { op: OP.OP_RETURN }]) })
  tx.addOutput({ satoshis: 1, lockingScript: buildLockingScript(state, lockKey, carrier) })
  const outputIndex = opReturnFirst ? 1 : 0
  if (keep) { txs.push(tx); outputIndexes.push(outputIndex) }
  return { state, tx, outputIndex }
}

const checked = (chain, options = {}) => verifyChain(chain, { chainTracker: 'scripts only', serverIdentityKey: idKey(custodianPriv), ...options })

// ------------------------------------------------------------ the lifecycle
step('ISSUE: the issuer opens the passport as a fixed-supply deploy of one unit at output 0; the custodian holds the lock.')
const issued = await write(data({ op: 'ISSUE', ownerIdentityKey: controllerKeyOf(issuerPriv), actorIdentityKey: idKey(issuerPriv) }), issuerWallet)
const genesisScript = issued.tx.outputs[0].lockingScript
say(genesisScript.chunks.slice(0, 3).map((c) => c.op).join(' ') === `0 ${OP.OP_1} ${OP.OP_2DROP}`, 'the genesis begins OP_0 OP_1 OP_2DROP: a deploy, amount one, then the body.')
say(parseDppOutput(genesisScript).carrier.role === 'deploy', 'a reader finds the deploy prefix and reads the body as version 3.')
say((await checked(txs)).valid, 'the genesis verifies alone: ISSUE at output 0 with empty predecessor, lineage and linkage.')
const tokenId = tokenIdOf(genesis())
console.log(`  token id ${tokenId}; on the wire ${Utils.toHex(tokenIdWireBytes(genesis().txid)).slice(0, 16)}... (the deploy txid in internal byte order).`)

step('UPDATE: the issuer revises the payload as a value output naming the token id, proving control by linkage.')
const updated = await write(data({ op: 'UPDATE', ownerIdentityKey: controllerKeyOf(issuerPriv), actorIdentityKey: idKey(issuerPriv), controlLinkage: controlLinkageOf(issuerPriv), payloadPublic: PAYLOAD_2, payloadOwnerHash: ownerBlobHash(BLOB_2), ...link() }), issuerWallet)
const valuePrefix = updated.tx.outputs[0].lockingScript.chunks
say(Utils.toHex(valuePrefix[0].data) === Utils.toHex(tokenIdWireBytes(genesis().txid)) && valuePrefix[1].op === OP.OP_1 && valuePrefix[2].op === OP.OP_2DROP, 'the value output begins with the 32-byte token id, OP_1 and OP_2DROP.')
say((await checked(txs)).valid, 'two states verify; the token id and field 12 name the same genesis.')

step('TRANSFER: control moves to the recipient, the carrier output at index 1 behind an OP_RETURN; a value output may sit anywhere.')
await write(data({ op: 'TRANSFER', ownerIdentityKey: controllerKeyOf(recipientPriv), actorIdentityKey: idKey(issuerPriv), controlLinkage: controlLinkageOf(issuerPriv), eventData: JSON.stringify({ word: 'Passed on' }), payloadPublic: PAYLOAD_2, payloadOwnerHash: ownerBlobHash(BLOB_2), ...link() }), issuerWallet, { opReturnFirst: true })
say((await checked(txs)).valid, 'three states verify; the carrier output at index 1 is found by its prefix, not by its position.')

step('RETIRE: the recipient ends the lineage. To a token reader the unit is still live; to a passport reader nothing may spend it.')
await write(data({ op: 'RETIRE', ownerIdentityKey: controllerKeyOf(recipientPriv), actorIdentityKey: idKey(recipientPriv), controlLinkage: controlLinkageOf(recipientPriv), eventData: JSON.stringify({ reason: 'recycled' }), payloadPublic: PAYLOAD_2, payloadOwnerHash: ownerBlobHash(BLOB_2), ...link() }), recipientWallet)
const whole = await checked(txs)
say(whole.valid, `the four-state lineage verifies as a whole; operations ${txs.map((tx) => findDppOutputs(tx)[0].state.op).join(' -> ')}.`)
for (const [i, s] of whole.states.entries()) {
  console.log(`  state ${i + 1} (${s.op}, ${s.txid.slice(0, 12)}): actor signature ${s.userSignatureValid ? 'verifies' : 'FAILS'}; publisher signature ${s.serverSignatureValid === false ? 'FAILS' : 'verifies'}; linkage ${s.linkageValid ? 'holds' : 'FAILS'}; inclusion ${s.spv}.`)
}

// ----------------------------------------------------------- the report
step('The report a stranger produces from the bytes, under a policy naming the custodian as publisher.')
const report = await verifyPassportEvidence({ tokenHistory: txs }, { passportId, source: 'request-context' }, { publisherKeys: [idKey(custodianPriv)], chainTracker: 'scripts only' })
for (const c of report.checks) console.log(`  ${EVIDENCE_CHECK_LABELS[c.name]}: ${c.status}${c.reasonCode == null ? '' : ` (${c.reasonCode})`} [${c.name}]`)
const status = (name) => report.checks.find((c) => c.name === name).status
say(status('recordEncoding') === 'pass' && status('actorSignatures') === 'pass' && status('publisherSignatures') === 'pass' && status('linkage') === 'pass', 'the token rail passes: prefix and body decode, both signatures verify, linkage holds with control proven.')
const detail = report.checks.find((c) => c.name === 'linkage').detail
say(Array.isArray(detail) && detail.every((s) => s.version === '3' && s.tokenId === tokenId), 'every state in the detail carries version 3 and the token id.')
say(report.limits.some((l) => l.includes('token id alone')), 'the limits say a reader following the token id alone verifies nothing in the body.')

// ---------------------------------------------------------- the refusals
step('The refusals the carrier makes, each shown refused.')
const prefix = txs.slice(0, 2)
const away = await write(data({ op: 'ISSUE', ownerIdentityKey: controllerKeyOf(issuerPriv), actorIdentityKey: idKey(issuerPriv) }), issuerWallet, { keep: false, prev: null, opReturnFirst: true })
const refusedAway = await checked([away.tx])
say(!refusedAway.valid && (refusedAway.error ?? '').includes(CARRIER_REFUSALS.genesisNotAtOutputZero), `a genesis away from output 0 is refused: ${refusedAway.error}.`)

const elsewhere = await write(data({ op: 'UPDATE', ownerIdentityKey: controllerKeyOf(issuerPriv), actorIdentityKey: idKey(issuerPriv), controlLinkage: controlLinkageOf(issuerPriv), payloadPublic: PAYLOAD_2, payloadOwnerHash: ownerBlobHash(BLOB_2), previousTxid: prefix[1].id('hex'), previousOutputIndex: 0, lineageGenesis: genesis() }), issuerWallet, { keep: false, prev: { tx: prefix[1], outputIndex: 0 }, carrier: { role: 'value', tokenId: 'ef'.repeat(32) } })
const refusedElsewhere = await checked([...prefix, elsewhere.tx])
say(!refusedElsewhere.valid && (refusedElsewhere.error ?? '').includes(CARRIER_REFUSALS.tokenIdMismatch), `a value output naming another token is refused: ${refusedElsewhere.error}.`)

const versionTwo = await completeState({ ...data({ op: 'UPDATE', ownerIdentityKey: controllerKeyOf(issuerPriv), actorIdentityKey: idKey(issuerPriv), controlLinkage: controlLinkageOf(issuerPriv), payloadPublic: PAYLOAD_2, payloadOwnerHash: ownerBlobHash(BLOB_2), previousTxid: prefix[1].id('hex'), previousOutputIndex: 0, lineageGenesis: genesis() }), version: '2' }, issuerWallet, custodianWallet)
const v2Behind = new Transaction()
v2Behind.addInput({ sourceTransaction: prefix[1], sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
v2Behind.addOutput({ satoshis: 1, lockingScript: new LockingScript([...carrierPrefixChunks({ role: 'value', tokenId: genesis().txid }), ...buildLockingScript(versionTwo, lockKey).chunks]) })
const refusedV2 = await checked([...prefix, v2Behind])
say(!refusedV2.valid && (refusedV2.error ?? '').includes('found 0'), `a version 2 body behind the prefix is no DPP output to this reader: ${refusedV2.error}.`)

const burn = new Transaction()
burn.addInput({ sourceTransaction: prefix[1], sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
burn.addOutput({ satoshis: 1, lockingScript: new LockingScript([{ op: OP.OP_DUP }, { op: OP.OP_HASH160 }, { op: 20, data: Array(20).fill(0) }, { op: OP.OP_EQUALVERIFY }, { op: OP.OP_CHECKSIG }]) })
const burned = await checked([...prefix, burn])
say(!burned.valid && (burned.error ?? '').includes('found 0'), `the tip spent with no carrier output is a burn to a token reader and no state here: ${burned.error}; the lineage ended without a RETIRE.`)

const afterRetire = await write(data({ op: 'UPDATE', ownerIdentityKey: controllerKeyOf(recipientPriv), actorIdentityKey: idKey(recipientPriv), controlLinkage: controlLinkageOf(recipientPriv), payloadPublic: PAYLOAD_2, payloadOwnerHash: ownerBlobHash(BLOB_2), ...link() }), recipientWallet, { keep: false })
const refusedAfterRetire = await checked([...txs, afterRetire.tx])
say(!refusedAfterRetire.valid && (refusedAfterRetire.error ?? '').includes('retired'), `nothing follows a RETIRE, as under version 2: ${refusedAfterRetire.error}.`)

console.log(failures === 0 ? 'Every sentence above holds.' : 'At least one sentence above does not hold.')
process.exit(failures === 0 ? 0 : 1)
