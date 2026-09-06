#!/usr/bin/env node
/**
 * A record version 2 lifecycle under managed custody, from fresh keys, with
 * no wallet and no network: the shape a custodian's application follows
 * under spec/record-model-v2.md and spec/managed-custody.md.
 *
 *   node examples/lifecycle-v2.mjs
 *
 * Three parties, each a key made for this run and thrown away after it: an
 * issuer who opens the passport, a custodian who holds the lock and the
 * controller keys for everyone and publishes every state, and a recipient
 * whose identity the custodian keeps for them, because under this profile a
 * recipient needs no wallet, no identifier scheme and no funds. The script
 * walks the lifecycle in order and prints one sentence per step: ISSUE by
 * the issuer; UPDATE with the control proof in its linkage form; an offer
 * the custodian holds against the current tip, accepted by the recipient
 * with a claim code and written down as a custodian-signed acceptance
 * record; the TRANSFER that commits to that record in field 15; RETIRE by
 * the recipient; then the verifier's own check over the whole lineage and
 * the verification report a stranger produces from the bytes and the
 * record. Then the refusals the profile and the record model make, each
 * shown refused and, where the rule is the profile's, accepted again with
 * the profile off, which is the control that keeps the rule honest.
 *
 * Nothing here is sent anywhere. The transactions are unsigned at the input,
 * because a verifier does not run scripts, and their inclusion reads
 * pending, because no header source holds them. Results print one sentence
 * per check, never a score, as GOVERNANCE.md requires of every conformance
 * surface.
 */
import { CachedKeyDeriver, Hash, PrivateKey, ProtoWallet, Transaction, UnlockingScript, Utils } from '@bsv/sdk'
import {
  ACCEPTANCE_COMMITMENT_REFUSAL,
  EVIDENCE_CHECK_LABELS,
  LIFECYCLE_MEDIA_TYPE,
  LIFECYCLE_REPRESENTATION,
  acceptanceCommitment,
  bindAcceptanceToState,
  buildAttestationAnchor,
  buildLockingScript,
  canonicalJson,
  completeState,
  didKeyFromIdentityKey,
  findDppOutputs,
  inspectAttestationAnchor,
  inspectManagedAcceptance,
  lifecycleClaimDigest,
  ownerBlobHash,
  ownerKeyFromDeriver,
  ownerLinkageFromDeriver,
  signLifecycleClaim,
  signManagedAcceptance,
  verifyChain,
  verifyLifecycleClaim,
  verifyPassportEvidence,
} from '@bsv/dpp-core'

let failures = 0
const say = (ok, sentence) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok' : 'FAIL'}: ${sentence}`)
}
const step = (sentence) => console.log(`step: ${sentence}`)
const instant = (offsetSeconds = 0) => new Date(Date.now() + offsetSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
const sha256hex = (text) => Utils.toHex(Hash.sha256(Utils.toArray(text, 'utf8')))

// ------------------------------------------------------------- the parties
const issuerPriv = PrivateKey.fromRandom()
const custodianPriv = PrivateKey.fromRandom()
const recipientPriv = PrivateKey.fromRandom() // held by the custodian for the recipient
const strangerPriv = PrivateKey.fromRandom()
const idKey = (priv) => priv.toPublicKey().toString()
const issuerWallet = new ProtoWallet(issuerPriv)
const custodianWallet = new ProtoWallet(custodianPriv)
const recipientWallet = new ProtoWallet(recipientPriv)
const strangerWallet = new ProtoWallet(strangerPriv)
const custodianSigner = { sign: (preimage) => custodianPriv.sign(preimage).toDER() }

// A demonstration identifier under GS1 prefix 952 (spec/record-model.md §3), serialised per run.
const passportId = `https://dpp.bsvb.net/01/09521000000018/21/LIFECYCLE-${Date.now().toString(36).toUpperCase()}`
// The controller key of a party for this passport, and the scalar that proves the party derived it (spec/custody.md §2, §4).
const controllerKeyOf = (priv) => ownerKeyFromDeriver(passportId, new CachedKeyDeriver(priv))
const controlLinkageOf = (priv) => ownerLinkageFromDeriver(passportId, new CachedKeyDeriver(priv))
const lockKey = custodianPriv.toPublicKey() // the custodian holds the lock (spec/managed-custody.md §2)

console.log(`Passport ${passportId}`)
console.log(`Issuer ${idKey(issuerPriv).slice(0, 12)}..., custodian ${idKey(custodianPriv).slice(0, 12)}..., recipient ${idKey(recipientPriv).slice(0, 12)}... (managed identity).`)

// ------------------------------------------------------------ the builders
const PAYLOAD_1 = JSON.stringify({ name: 'Cell pack 40', chemistry: 'LFP', dataCarrier: 'LIFECYCLE-UID' })
const PAYLOAD_2 = JSON.stringify({ name: 'Cell pack 40', chemistry: 'LFP', dataCarrier: 'LIFECYCLE-UID', recycledContent: 12 })
const BLOB_1 = [10, 20, 30, 40]
const BLOB_2 = [50, 60, 70]

const txs = []
const outputIndexes = []
const tip = () => ({ tx: txs[txs.length - 1], outputIndex: outputIndexes[outputIndexes.length - 1] })
const outpoint = (tx, outputIndex) => ({ txid: tx.id('hex'), outputIndex })
const genesis = () => outpoint(txs[0], outputIndexes[0])
const link = () => ({ previousTxid: tip().tx.id('hex'), previousOutputIndex: tip().outputIndex, lineageGenesis: genesis() })

/** A version 2 state's data with the fields every state shares filled in. */
function data(overrides) {
  return {
    version: '2',
    passportId,
    timestamp: instant(),
    actorKeyId: 'lifecycle example',
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

/** Sign as the actor and the custodian (publisher), wrap into a transaction spending the tip, keep it. */
async function write(d, actorWallet, { keep = true, prev = txs.length === 0 ? null : tip() } = {}) {
  const state = await completeState(d, actorWallet, custodianWallet)
  const tx = new Transaction()
  if (prev != null) tx.addInput({ sourceTransaction: prev.tx, sourceOutputIndex: prev.outputIndex, unlockingScript: new UnlockingScript([]) })
  tx.addOutput({ satoshis: 1, lockingScript: buildLockingScript(state, lockKey) })
  if (keep) { txs.push(tx); outputIndexes.push(0) }
  return { state, tx }
}

const checked = (chain, options = {}) => verifyChain(chain, { chainTracker: 'scripts only', serverIdentityKey: idKey(custodianPriv), ...options })

// ------------------------------------------------------------ the lifecycle
step('ISSUE: the issuer opens the passport; the custodian holds the lock and derives the issuer\'s controller key.')
await write(data({ op: 'ISSUE', ownerIdentityKey: controllerKeyOf(issuerPriv), actorIdentityKey: idKey(issuerPriv) }), issuerWallet)
say((await checked(txs)).valid, 'the genesis verifies alone: ISSUE with empty predecessor, lineage and linkage.')

step('UPDATE: the issuer revises the payload, proving control by linkage from its identity key to the controller key it derived.')
await write(data({ op: 'UPDATE', ownerIdentityKey: controllerKeyOf(issuerPriv), actorIdentityKey: idKey(issuerPriv), controlLinkage: controlLinkageOf(issuerPriv), payloadPublic: PAYLOAD_2, payloadOwnerHash: ownerBlobHash(BLOB_2), ...link() }), issuerWallet)
say((await checked(txs)).valid, 'two states verify; the UPDATE names the genesis and the spent tip and its control proof holds.')

step('Offer: the custodian fixes the tip, the terms and an expiry, and issues a claim code to the recipient out of band.')
const terms = { word: 'Passed on', note: 'Handed to the recipient at the counter' }
const claimCode = Utils.toHex(PrivateKey.fromRandom().toArray().slice(0, 8))
const claim = {
  acceptanceFormat: 'dpp-managed-acceptance@1',
  requestId: `offer-${Date.now().toString(36)}`,
  passportId,
  lineageGenesis: genesis(),
  expectedPredecessor: outpoint(tip().tx, tip().outputIndex),
  termsDigest: sha256hex(canonicalJson(terms)),
  offer: { holderIdentityKey: idKey(issuerPriv), createdAt: instant(-60), expiresAt: instant(7 * 24 * 3600), mechanism: 'claim-code', recipientRef: sha256hex(claimCode) },
  acceptance: { recipientIdentityKey: idKey(recipientPriv), destinationKey: controllerKeyOf(recipientPriv), acceptedAt: instant(-1), evidenceKind: 'custodian-attested' },
  custodian: idKey(custodianPriv),
}
step('Acceptance: the recipient redeems the code; the custodian records, signs and retains the acceptance.')
const record = await signManagedAcceptance(claim, custodianSigner)
const inspection = inspectManagedAcceptance(record, { custodians: [idKey(custodianPriv)] })
say(inspection.structureValid && inspection.signatureValid && inspection.failures.length === 0, `the acceptance record is well formed, custodian-signed, in time order; its commitment is ${inspection.commitment.slice(0, 16)}...`)

step('TRANSFER: the custodian writes the transfer for the holder, moving control to the accepted destination and committing to the record in field 15.')
const transfer = await write(data({ op: 'TRANSFER', ownerIdentityKey: controllerKeyOf(recipientPriv), actorIdentityKey: idKey(issuerPriv), controlLinkage: controlLinkageOf(issuerPriv), eventData: JSON.stringify({ word: terms.word }), payloadPublic: PAYLOAD_2, payloadOwnerHash: ownerBlobHash(BLOB_2), authorisationCommitment: acceptanceCommitment(record), ...link() }), issuerWallet)
say(bindAcceptanceToState(record, transfer.state).length === 0, 'the record binds to the TRANSFER: passport, lineage, predecessor, destination, holder, commitment and time order.')
say((await checked(txs, { managedAcceptance: true })).valid, 'three states verify under managed-custody@1: the TRANSFER carries its commitment.')

step('RETIRE: the recipient ends the lineage, proving control from the identity the custodian keeps for them.')
await write(data({ op: 'RETIRE', ownerIdentityKey: controllerKeyOf(recipientPriv), actorIdentityKey: idKey(recipientPriv), controlLinkage: controlLinkageOf(recipientPriv), eventData: JSON.stringify({ reason: 'recycled' }), payloadPublic: PAYLOAD_2, payloadOwnerHash: ownerBlobHash(BLOB_2), ...link() }), recipientWallet)
const whole = await checked(txs, { managedAcceptance: true })
say(whole.valid, `the four-state lineage verifies as a whole; operations ${txs.map((tx) => findDppOutputs(tx)[0].state.op).join(' -> ')}.`)
for (const [i, s] of whole.states.entries()) {
  console.log(`  state ${i + 1} (${s.op}, ${s.txid.slice(0, 12)}): actor signature ${s.userSignatureValid ? 'verifies' : 'FAILS'}; publisher signature ${s.serverSignatureValid === false ? 'FAILS' : 'verifies'}; linkage ${s.linkageValid ? 'holds' : 'FAILS'}; inclusion ${s.spv}.`)
}

// ----------------------------------------------------------- the report
step('The report a stranger produces from the bytes and the acceptance record, under a policy naming the custodian.')
const report = await verifyPassportEvidence(
  { tokenHistory: txs, acceptanceRecords: [record] },
  { passportId, source: 'request-context' },
  { policyId: 'managed-custody@1/example', publisherKeys: [idKey(custodianPriv)], managedAcceptance: { required: true }, chainTracker: 'scripts only', authority: { required: true, genesisIssuers: [idKey(issuerPriv)], acceptanceCustodians: [idKey(custodianPriv)] } }
)
for (const c of report.checks) console.log(`  ${EVIDENCE_CHECK_LABELS[c.name]}: ${c.status}${c.reasonCode == null ? '' : ` (${c.reasonCode})`} [${c.name}]`)
const status = (name) => report.checks.find((c) => c.name === name).status
say(status('recordEncoding') === 'pass' && status('actorSignatures') === 'pass' && status('publisherSignatures') === 'pass' && status('linkage') === 'pass', 'the token rail passes: encoding, both signatures and linkage with control proven on every non-genesis state.')
say(status('evidenceAvailability') === 'pass', 'the acceptance record the TRANSFER commits to was supplied and binds, so availability passes.')
say(status('issuerAuthority') === 'pass', 'the custodian is one the policy names as an acceptance custodian.')
say(status('inclusion') === 'unknown', 'inclusion is unknown, because nothing here was mined and no header source was asked.')
say(report.limits.some((l) => l.includes('custody-dependent')), 'the limits say the commitment is custody-dependent evidence and not a recipient signature.')

// ---------------------------------------------------------- the refusals
step('The refusals, each shown refused and, where the rule is the profile\'s, accepted with the profile off.')
const prefix = txs.slice(0, 2)
const uncommitted = await write(data({ op: 'TRANSFER', ownerIdentityKey: controllerKeyOf(recipientPriv), actorIdentityKey: idKey(issuerPriv), controlLinkage: controlLinkageOf(issuerPriv), payloadPublic: PAYLOAD_2, payloadOwnerHash: ownerBlobHash(BLOB_2), previousTxid: prefix[1].id('hex'), previousOutputIndex: 0, lineageGenesis: genesis() }), issuerWallet, { keep: false, prev: { tx: prefix[1], outputIndex: 0 } })
const refusedUncommitted = await checked([...prefix, uncommitted.tx], { managedAcceptance: true })
say(!refusedUncommitted.valid && (refusedUncommitted.error ?? '').includes(ACCEPTANCE_COMMITMENT_REFUSAL), `a TRANSFER without a commitment is refused under the profile: ${refusedUncommitted.error}.`)
say((await checked([...prefix, uncommitted.tx])).valid, 'and accepted with the profile off, as the record model alone requires.')

const elsewhere = { ...record, acceptance: { ...record.acceptance, destinationKey: controllerKeyOf(strangerPriv) } }
const resigned = await signManagedAcceptance((({ signature: _s, ...c }) => c)(elsewhere), custodianSigner)
const mismatches = bindAcceptanceToState(resigned, transfer.state)
say(mismatches.length > 0, `a custodian-signed record naming another destination does not bind to the TRANSFER: ${mismatches[0].detail}.`)

const strangersUpdate = await write(data({ op: 'UPDATE', ownerIdentityKey: controllerKeyOf(issuerPriv), actorIdentityKey: idKey(strangerPriv), payloadPublic: PAYLOAD_2, payloadOwnerHash: ownerBlobHash(BLOB_2), previousTxid: prefix[1].id('hex'), previousOutputIndex: 0, lineageGenesis: genesis() }), strangerWallet, { keep: false, prev: { tx: prefix[1], outputIndex: 0 } })
const refusedStranger = await checked([...prefix, strangersUpdate.tx])
say(!refusedStranger.valid && (refusedStranger.error ?? '').includes('not the controller'), `a stranger's UPDATE with an empty control_linkage is refused: ${refusedStranger.error}.`)
say((await checked([...prefix, strangersUpdate.tx], { controlAuthorities: [idKey(strangerPriv)] })).valid, 'and admitted when the policy names the stranger as a control authority: a recovery, visibly.')

const afterRetire = await write(data({ op: 'UPDATE', ownerIdentityKey: controllerKeyOf(recipientPriv), actorIdentityKey: idKey(recipientPriv), controlLinkage: controlLinkageOf(recipientPriv), payloadPublic: PAYLOAD_2, payloadOwnerHash: ownerBlobHash(BLOB_2), ...link() }), recipientWallet, { keep: false })
const refusedAfterRetire = await checked([...txs, afterRetire.tx])
say(!refusedAfterRetire.valid && (refusedAfterRetire.error ?? '').includes('retired'), `nothing follows a RETIRE: ${refusedAfterRetire.error}.`)

let expiredRefused = false
try {
  await signManagedAcceptance({ ...claim, acceptance: { ...claim.acceptance, acceptedAt: instant(8 * 24 * 3600) } }, custodianSigner)
} catch (error) {
  expiredRefused = String(error.message).includes('expired')
}
say(expiredRefused, 'the custodian cannot sign an acceptance recorded after the offer expired; the signer refuses it before a signature exists.')

// ------------------------------------------------------- the later claim
step('A lifecycle claim after retirement, on the other rail: a recycler signs it and an anchoring service commits to it, and neither spends the passport.')
const recyclerPriv = PrivateKey.fromRandom()
const anchoringPriv = PrivateKey.fromRandom()
const recyclerWallet = new ProtoWallet(recyclerPriv)
const anchoringWallet = new ProtoWallet(anchoringPriv)
const lifecycleClaim = await signLifecycleClaim(
  {
    claimFormat: 'dpp-lifecycle-v1',
    passportId,
    recordId: txs[txs.length - 1].id('hex'),
    eventType: 'Disposition',
    timestamp: instant(),
    issuer: didKeyFromIdentityKey(idKey(recyclerPriv)),
    issuerKeyId: 'recycler line 3',
    profile: 'battery',
    profile_version: 2,
  },
  recyclerWallet
)
say(verifyLifecycleClaim(lifecycleClaim).signature === 'verified', 'the recycler\'s claim about the retired passport verifies under the recycler\'s own key; the custodian was not asked and could not have made it.')
const digest = lifecycleClaimDigest(lifecycleClaim)
const anchor = await buildAttestationAnchor(
  {
    digest,
    attestationId: `urn:sha256:${digest}`,
    issuer: lifecycleClaim.issuer,
    subject: passportId,
    attestationType: lifecycleClaim.eventType,
    representation: LIFECYCLE_REPRESENTATION,
    mediaType: LIFECYCLE_MEDIA_TYPE,
    anchoredBy: idKey(anchoringPriv),
  },
  anchoringWallet
)
const anchorInspection = inspectAttestationAnchor(anchor)
say(anchorInspection.keyDerivationValid === true && anchorInspection.signatureValid === true && anchorInspection.metadata?.digest === digest, 'the anchoring service\'s output commits to the claim\'s complete bytes and its key derives from the service it names: a separate rail, a separate authority, and the passport token untouched.')
say(!(await checked([...txs, afterRetire.tx], { managedAcceptance: true })).valid, 'and the token rail still refuses any state after the RETIRE: a claim on the other rail moves nothing here.')

console.log(failures === 0 ? 'Every sentence above holds.' : 'At least one sentence above does not hold.')
process.exit(failures === 0 ? 0 : 1)
