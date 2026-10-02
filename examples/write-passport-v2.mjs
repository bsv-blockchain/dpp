#!/usr/bin/env node
/**
 * Write a version 2 passport lineage the way spec/writing.md says a writer
 * must: each state built unsent, checked with the reader's own rules,
 * announced to the writer's own index before it is sent, sent and answered
 * for, proven, and kept. The lineage is an ISSUE genesis and one UPDATE that
 * spends it, under managed-custody@1 and the record model of
 * spec/record-model-v2.md.
 *
 *   node examples/write-passport-v2.mjs --dry-run [passportId]
 *   node examples/write-passport-v2.mjs <passportId> <indexUrl> [--submit-token=<t>]
 *                                       [--callback-token=<t>] [--wait-proof=<minutes>]
 *                                       [--originator=<host>] [--journal=<dir>]
 *
 * LIVE RUNS SPEND REAL SATOSHIS ON BSV MAINNET. Without --dry-run, this
 * program asks a BRC-100 wallet on this machine for two transactions, each of
 * which pays a miner fee and leaves a one-satoshi output that nothing can
 * withdraw, and it announces both to the index you name. A state, once mined,
 * is permanent. The identifier must be a GS1 Digital Link under the GS1
 * demonstration prefix 952 on a host you control (docs/identifiers.md), and
 * the program refuses anything else, so that nobody writes under a GTIN that
 * belongs to somebody else. It is a demonstration writer and nothing more: the
 * payload is the general@2 sample, marked as a demonstration.
 *
 * Live, the script is one application with one BRC-100 wallet, reached through
 * WalletClient under the originator you give (localhost by default). The
 * wallet is actor, publisher and lock: it signs every state in both roles,
 * and locks each state to the passport's controller key, which is one
 * derivation below its identity key (spec/custody.md section 2). No key leaves
 * the wallet. The index is your own, never the hosted reference, whose
 * POST /submit needs its operator's token, and its GET /capabilities must name
 * this wallet's identity key as a state publisher before anything is built.
 *
 * Every state then goes through the steps of spec/writing.md in order, one
 * sentence each: the state is built unsent (section 3); the verifier's own
 * checks run on it (section 2); it is announced with POST /submit, and the
 * unsent action is aborted if the index refuses it; it is sent, and reported
 * only in the network's own words (sections 4 and 5); the wallet's merkle path
 * is pushed to the index's POST /arc-ingest with the callback token when the
 * wallet has it (section 7); and the bytes are kept (section 8). The UPDATE
 * proves control of the tip it spends by carrying controlLinkage, because the
 * wallet's identity key, the actor, is not the controller key
 * (spec/record-model-v2.md section 6). A wallet cannot list an output once a
 * later state has spent it, so the path of the ISSUE is only readable before
 * the UPDATE is built: pass --wait-proof=<minutes> to wait for it, and each
 * state is then proven before the next is written, which takes a block each.
 * The journal, written before each step is acted on, holds what the chain and
 * the wallet do not: the owner-tier ciphertext each state commits to, beside
 * the transaction, its BEEF, the answers of the index and the network, and the
 * proof. Live it goes to ./dpp-journal unless --journal=<dir> says otherwise;
 * a dry run writes one only when it is given --journal.
 *
 * With --dry-run, what CI runs, no wallet, no funds and no network are used.
 * A ProtoWallet with fixed test keys stands in for the wallet; the two
 * transactions are built unsent from a made-up funding output; the index is
 * started in this process on a loopback port, with in-memory storage and a
 * publisher key policy naming the writer's key, from the built
 * @bsv/dpp-overlay-topics and its host. Both states are checked, announced
 * and shown admitted, the index is asked for the lineage and a verification
 * report is made over what it returns, and then a state the record model
 * refuses is shown refused by the writer's own check and by the index. Nothing
 * is broadcast, mainnet is never touched and no hosted service is called. The
 * send and the proof, which need a network, print as what they would do, and
 * the proofs pushed to the in-process index are made up, which is the only
 * kind it could take with its header checks off.
 *
 * Results print one sentence per step, never a score, as GOVERNANCE.md
 * requires of every conformance surface.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import {
  Beef,
  Hash,
  LockingScript,
  MerklePath,
  PrivateKey,
  ProtoWallet,
  PushDrop,
  Transaction,
  UnlockingScript,
  Utils,
  WalletClient,
} from '@bsv/sdk'
import {
  EVIDENCE_CHECK_LABELS,
  OWNER_PROTOCOL_ID,
  buildLockingScript,
  chainFromBeef,
  completeState,
  decryptOwnerLinkage,
  findDppOutputs,
  ownerBlobHash,
  ownerKeyFor,
  policySigningPreimage,
  revealOwnerLinkage,
  verifyChain,
  verifyOwnerBlob,
  verifyOwnerLinkage,
  verifyPassportEvidence,
} from '@bsv/dpp-core'
import { gs1CheckDigit, buildGs1DigitalLink, parseGs1DigitalLink, readPublicPayloadSchema, readRestrictedPayloadSchema } from '@bsv/dpp-profiles'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const dryRun = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))
const waitMinutes = Number(flag('wait-proof') ?? 0)
let submitToken = flag('submit-token')
let callbackToken = flag('callback-token')
const originator = flag('originator') ?? 'localhost'
const journalDirectory = flag('journal')

const PROFILE = 'general@2'
/** BRC-43 protocol the owner tier is encrypted under (spec/record-model.md section 7); dpp-core does not export it. */
const OWNER_DATA_PROTOCOL = [2, 'dpp owner data v1']
const CUSTODY_PROFILE = 'managed-custody@1'
const ANYONE = new LockingScript([{ op: 0x51 }])
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The dry run's identifier when none is given: the demonstration prefix 952, an item reference this example owns, a serial of its own. */
function defaultIdentifier() {
  const data = `0952${'200000002'}`
  return buildGs1DigitalLink('dpp.example.com', data + gs1CheckDigit(data), 'WRITER-V2')
}

const passportId = dryRun ? (positional[0] ?? defaultIdentifier()) : positional[0]
const indexArgument = positional[1]
const usage = 'usage: write-passport-v2.mjs <passportId> <indexUrl> [--submit-token=<t>] [--callback-token=<t>] [--wait-proof=<minutes>] [--originator=<host>] [--journal=<dir>] | --dry-run [passportId]'
if (!dryRun && (passportId == null || indexArgument == null)) {
  console.error(usage)
  process.exit(2)
}
if (!Number.isFinite(waitMinutes) || waitMinutes < 0) {
  console.error(`--wait-proof takes a number of minutes, not ${flag('wait-proof')}. ${usage}`)
  process.exit(2)
}
if (!dryRun && !/^https?:\/\/[^/]/.test(indexArgument)) {
  console.error(`The index address must be an http or https URL, not ${indexArgument}. ${usage}`)
  process.exit(2)
}
if (dryRun) {
  console.log('Dry run: a ProtoWallet with fixed test keys stands in for the wallet, the index runs in this process on a loopback port, and nothing is broadcast, spent or sent to any hosted service.')
} else {
  console.log('LIVE RUN: this spends real satoshis on BSV mainnet. Each of the two states pays a miner fee and leaves an output nothing can withdraw, and a state once mined is permanent.')
}
// Set to the in-process index's address in a dry run, to the argument live.
let indexUrl = indexArgument == null ? '' : indexArgument.replace(/\/+$/, '')

let failures = 0
const say = (ok, sentence) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok' : 'FAIL'}: ${sentence}`)
}
const short = (hex) => `${hex.slice(0, 12)}...`
const instant = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

// ------------------------------------------------------------- the identifier

/** Why a live run refuses this identifier; empty when it may be written. */
function identifierProblems(id) {
  let link
  let url
  try {
    url = new URL(id)
    link = parseGs1DigitalLink(id)
  } catch (cause) {
    return [`it is not a GS1 Digital Link this example reads (${cause.message})`]
  }
  const problems = []
  if (url.protocol !== 'https:') problems.push('it does not use https')
  if (url.search !== '' || url.hash !== '') problems.push('it carries a query or a fragment')
  if (!link.checkDigitValid) problems.push('its GTIN check digit does not hold')
  if (!link.demonstration) problems.push('its GTIN is not under the GS1 demonstration prefix 952, so it would name a product that someone else may own')
  if (link.serial == null) problems.push('it has no serial under application identifier 21')
  if (link.host === 'id.gs1.org') problems.push("its host is GS1's own resolver, which is not a host you control")
  return problems
}

// ---------------------------------------------------------------- the payloads

const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
const validatorFor = (schema) => ajv.getSchema(schema.$id) ?? ajv.compile(schema)

/** The sample public payload of the profile, as a demonstration, from the generator the quick start documents. */
function demonstrationPayload() {
  const printed = execFileSync(process.execPath, [join(here, 'sample-payload.mjs'), PROFILE, '--demonstration'], { encoding: 'utf8' })
  return JSON.parse(printed)
}

// -------------------------------------------------------------------- the index

/** What a dry run's in-process index logs, kept so that a refusal's reason can be read from it as an operator would. */
const indexLog = []

/** A request to the index. In a dry run the in-process index's own log lines are taken, not printed. */
async function indexFetch(path, init) {
  if (!dryRun) return await fetch(`${indexUrl}${path}`, init)
  const kept = { log: console.log, info: console.info, warn: console.warn, error: console.error }
  console.log = console.info = console.warn = console.error = (...line) => indexLog.push(line.map(String).join(' '))
  try {
    return await fetch(`${indexUrl}${path}`, init)
  } finally {
    Object.assign(console, kept)
  }
}

/**
 * The capability document, read before anything is built: it must name this
 * wallet's identity key as a state publisher, or the index refuses every
 * state it is given (docs/packages/build-an-application.md section 2).
 */
async function checkCapabilities(identityKey) {
  let response
  try {
    response = await indexFetch('/capabilities')
  } catch (cause) {
    say(false, `the index at ${indexUrl} could not be reached (${cause.message}); nothing was built.`)
    return false
  }
  if (!response.ok) {
    say(false, `the index at ${indexUrl} answered HTTP ${response.status} to GET /capabilities; nothing was built.`)
    return false
  }
  const document = await response.json()
  const keys = document.publisherPolicy?.publisherKeys ?? []
  const named = keys.includes(identityKey)
  say(
    named,
    named
      ? `the index's capability document names this wallet's identity key ${short(identityKey)} as a state publisher, so it can admit what this wallet countersigns.`
      : `the index's publisher keys are ${keys.length === 0 ? 'none' : keys.map(short).join(', ')} and not this wallet's ${short(identityKey)}; it would refuse every state, so nothing was built.`
  )
  const custody = (document.profiles ?? []).find((p) => p.kind === 'custody')
  console.log(
    custody == null
      ? 'The index declares no custody profile.'
      : custody.id + '@' + custody.version === CUSTODY_PROFILE
        ? `The index declares the custody profile ${CUSTODY_PROFILE}: a version 2 TRANSFER would need its acceptance commitment, which this lineage never reaches.`
        : `The index declares ${custody.id}@${custody.version}, not ${CUSTODY_PROFILE}; it admits this lineage under the record model alone, and the check below still runs with ${CUSTODY_PROFILE} selected.`
  )
  return named
}

/** The lineage the index holds for the passport, genesis first, or an empty list. */
async function lineageOnIndex() {
  const response = await indexFetch('/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service: 'ls_dpp', query: { passportId } }),
  })
  if (!response.ok) throw new Error(`the index answered HTTP ${response.status} to the lookup`)
  const { outputs } = await response.json()
  if (outputs.length === 0) return []
  const merged = Beef.fromBinary(outputs[0].beef)
  for (const output of outputs.slice(1)) merged.mergeBeef(output.beef)
  return chainFromBeef(merged, passportId)
}

/**
 * Section 3. Announce the unsent transaction. Only an answer refuses: the
 * index admitted it (or already held it), refused it, or could not be
 * reached, which says nothing about the state. A 401 or 403 is the writer's
 * own configuration, which announcing again after the send would not mend, so
 * it stops the run while the state is still a draft.
 */
async function announce(beef, txid) {
  let response
  try {
    response = await indexFetch('/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Topics': JSON.stringify(['tm_dpp']),
        ...(submitToken != null ? { Authorization: `Bearer ${submitToken}` } : {}),
      },
      body: new Uint8Array(beef),
    })
  } catch (cause) {
    console.log(`The index at ${indexUrl} could not be reached (${cause.message}). That is not a refusal; only an answer refuses (section 3).`)
    return 'unreachable'
  }
  if (response.status === 401 || response.status === 403) {
    console.log(`The index answered HTTP ${response.status}: it wants a submit token, or a different one from the one given. Nothing about the state was learnt, and announcing again will be answered the same way.`)
    return 'unauthorised'
  }
  if (response.status === 400) {
    const body = await response.json().catch(() => ({}))
    console.log(`The index refused ${short(txid)}: ${body.description ?? 'no reason given'}.`)
    return 'refused'
  }
  if (!response.ok) {
    console.log(`The index answered HTTP ${response.status} to the announcement, which says nothing about the state; it will be announced again after the send (section 6).`)
    return 'unreachable'
  }
  const admission = response.headers.get('x-admission') ?? ''
  if (admission.includes('tm_dpp=none')) {
    console.log(`The index refused ${short(txid)} on admission (X-Admission: ${admission}); the answer carries no reason, and its operator's log names it.`)
    return 'refused'
  }
  if (admission.includes('duplicate')) {
    console.log(`The index already held ${short(txid)} (X-Admission: ${admission}), which is not a refusal: announcing the same bytes again changes nothing (section 6).`)
    return 'duplicate'
  }
  console.log(`The index admitted ${short(txid)} while it was still a draft (X-Admission: ${admission}) (section 3).`)
  return 'admitted'
}

/**
 * Section 3's second qualification. The index admitted the draft and the
 * network then refused it, so the index holds a tip that never existed. The
 * writer, who alone knows the network's answer, withdraws it
 * (contracts/overlay.yaml, POST /retract), behind the /submit token.
 */
async function retract(txid, reason) {
  let response
  try {
    response = await indexFetch('/retract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(submitToken != null ? { Authorization: `Bearer ${submitToken}` } : {}) },
      body: JSON.stringify({ txid, outputIndex: 0, reason }),
    })
  } catch (cause) {
    say(false, `the index at ${indexUrl} could not be reached to withdraw ${short(txid)} (${cause.message}); withdraw it before writing this passport again, or the index keeps a tip that never existed.`)
    return
  }
  const body = await response.json().catch(() => ({}))
  say(
    response.ok && body.status === 'retracted',
    response.ok
      ? `the index withdrew ${short(txid)}, the state the network refused${body.networkChecked === false ? ', without asking the network' : ''}.`
      : `the index did not withdraw ${short(txid)}: HTTP ${response.status}${body.error != null ? ` ${body.error}` : ''}${body.description != null ? `, ${body.description}` : ''}.`
  )
}

/** Section 7. Offer the wallet's proof to the index, in the shape a broadcaster's own callback carries. */
async function pushProof(txid, path) {
  let response
  try {
    response = await indexFetch('/arc-ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(callbackToken != null ? { 'X-Callback-Token': callbackToken } : {}) },
      body: JSON.stringify({ txid, merklePath: path.toHex(), blockHeight: path.blockHeight }),
    })
  } catch (cause) {
    say(false, `the index at ${indexUrl} could not be reached to take the proof of ${short(txid)} (${cause.message}); the proof is kept in the journal, and pushing it again later is harmless (section 7).`)
    return
  }
  const body = await response.json().catch(() => ({}))
  say(
    response.ok && body.status === 'applied',
    `the proof (block ${path.blockHeight}) for ${short(txid)} reached the index: ${body.status ?? `HTTP ${response.status}`}${body.description != null ? `, ${body.description}` : ''} (section 7).`
  )
}

// ------------------------------------------------------------------ the dry run

/** A funding output with a made-up proof, standing in for coins a wallet would hold. Anyone can spend it, which is why it is never used live. */
function syntheticFunding() {
  const tx = new Transaction()
  tx.addOutput({ satoshis: 10_000, lockingScript: ANYONE })
  tx.merklePath = MerklePath.fromCoinbaseTxidAndHeight(tx.id('hex'), 800_000)
  return tx
}

/**
 * The dry run's wallet side: builds the two transactions itself, the way a
 * wallet would fund them, and answers the network steps with what they would
 * do. Its outputs have the same shape as the live adapter's, so everything
 * after the build is the same code in both modes.
 */
function dryAdapter(wallet) {
  let proofHeight = 800_001
  return {
    async build({ lockingScript, tip }) {
      const tx = new Transaction()
      if (tip == null) {
        tx.addInput({ sourceTransaction: syntheticFunding(), sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
        tx.addOutput({ satoshis: 1, lockingScript })
        tx.addOutput({ satoshis: 9_000, lockingScript: ANYONE })
      } else {
        // The tip, then its change, the way a wallet funds the next state; the passport output stays first.
        tx.addInput({ sourceTransaction: tip.tx, sourceOutputIndex: tip.outputIndex, unlockingScript: new UnlockingScript([]) })
        tx.addInput({ sourceTransaction: tip.tx, sourceOutputIndex: 1, unlockingScript: new UnlockingScript([]) })
        tx.addOutput({ satoshis: 1, lockingScript })
        tx.addOutput({ satoshis: 8_000, lockingScript: ANYONE })
        tx.inputs[0].unlockingScript = await new PushDrop(wallet).unlock(OWNER_PROTOCOL_ID, passportId, 'self').sign(tx, 0)
      }
      return { tx, txid: tx.id('hex'), beef: tx.toAtomicBEEF(), reference: tip == null ? undefined : '<the signable transaction reference>' }
    },
    async send(built) {
      console.log(`Would send: a send-only action with sendWith [${short(built.txid)}] and acceptDelayedBroadcast false, reporting the network's answer and nothing sooner (sections 4 and 5). A dry run carries on as though the network had accepted it, which only a dry run may do.`)
      return 'accepted'
    },
    async discard(built) {
      console.log(`Would abort: wallet.abortAction({ reference: ${built.reference ?? short(built.txid)} }), so the wallet has its inputs back.`)
    },
    async waitForProof(txid) {
      // Nothing is mined: a single-transaction path at a made-up height, which an index with its header checks off will take.
      return MerklePath.fromCoinbaseTxidAndHeight(txid, proofHeight++)
    },
  }
}

/** Whether a merkle path contains the transaction, which is all a path can show before a header source is asked. */
function pathContains(path, txid) {
  try {
    path.computeRoot(txid)
    return true
  } catch {
    return false
  }
}

/** The wallet side of a live run: createAction, signAction, abortAction and listOutputs, as docs/packages/build-an-application.md section 3 describes. */
function liveAdapter(wallet) {
  return {
    async build({ lockingScript, tip }) {
      const output = { lockingScript: lockingScript.toHex(), satoshis: 1, outputDescription: 'dpp passport state', basket: 'dpp', customInstructions: JSON.stringify({ passportId }) }
      const options = { noSend: true, randomizeOutputs: false, acceptDelayedBroadcast: false }
      if (tip == null) {
        // The genesis needs no signature from this application, so the wallet returns it signed, with no reference.
        const created = await wallet.createAction({ description: 'dpp issue', outputs: [output], options })
        if (created.tx == null || created.txid == null) {
          // A wallet that asks for a signature here still holds its inputs for the action.
          if (created.signableTransaction?.reference != null) await wallet.abortAction({ reference: created.signableTransaction.reference }).catch(() => undefined)
          throw new Error('the wallet did not return a signed transaction')
        }
        return { tx: Transaction.fromAtomicBEEF(created.tx), txid: created.txid, beef: created.tx, reference: undefined }
      }
      // Every later state spends the tip, whose lock only this wallet can open.
      const created = await wallet.createAction({
        description: 'dpp update',
        inputBEEF: tip.beef,
        inputs: [{ outpoint: `${tip.txid}.${tip.outputIndex}`, unlockingScriptLength: 73, inputDescription: 'dpp passport tip' }],
        outputs: [output],
        options,
      })
      const signable = created.signableTransaction
      if (signable == null) throw new Error('the wallet did not return a transaction to sign')
      try {
        const unsigned = Transaction.fromAtomicBEEF(signable.tx)
        const at = unsigned.inputs.findIndex((input) => (input.sourceTXID ?? input.sourceTransaction?.id('hex')) === tip.txid && input.sourceOutputIndex === tip.outputIndex)
        if (at === -1) throw new Error('the wallet built a transaction that does not spend the tip')
        const unlockingScript = await new PushDrop(wallet).unlock(OWNER_PROTOCOL_ID, passportId, 'self').sign(unsigned, at)
        const signed = await wallet.signAction({ reference: signable.reference, spends: { [at]: { unlockingScript: unlockingScript.toHex() } }, options: { noSend: true } })
        if (signed.tx == null || signed.txid == null) throw new Error('the wallet did not return a signed transaction')
        return { tx: Transaction.fromAtomicBEEF(signed.tx), txid: signed.txid, beef: signed.tx, reference: signable.reference }
      } catch (cause) {
        // The action already holds the wallet's inputs: give them back before stopping.
        await wallet.abortAction({ reference: signable.reference }).catch(() => undefined)
        throw cause
      }
    },
    /**
     * Sections 4 and 5. Send with a send-only action and report nothing but
     * the network's answer: `unproven` is accepted and pending, `sending` is
     * not yet an answer, `failed` never existed.
     */
    async send(built) {
      const txid = built.txid
      let result
      try {
        result = await wallet.createAction({ description: 'dpp send', options: { sendWith: [txid], acceptDelayedBroadcast: false } })
      } catch (cause) {
        const reviews = cause?.reviewActionResults ?? []
        const detail = reviews.length > 0 ? reviews.map((r) => `${short(r.txid)} ${r.status}`).join(', ') : cause.message
        say(false, `the network did not accept ${short(txid)}: ${detail}. The state never existed and nothing was spent; rebuild only after learning why (section 4).`)
        return reviews.some((r) => r.txid === txid && r.status === 'invalidTx') ? 'refused' : 'unanswered'
      }
      const status = result.sendWithResults?.find((r) => r.txid === txid)?.status
      if (status === 'unproven') {
        say(true, `the network accepted ${txid}: the state exists and is pending until mined (sections 4 and 5).`)
        return 'accepted'
      }
      if (status === 'sending') {
        say(false, `the wallet is still sending ${short(txid)}; that is not yet the network's answer, so the state is not yet written. Wait for the wallet, and do not rebuild (section 4).`)
        return 'unanswered'
      }
      say(false, `the network answered ${status ?? 'nothing the wallet reported'} for ${short(txid)}: the state never existed and nothing was spent (section 4).`)
      return status === 'failed' ? 'refused' : 'unanswered'
    },
    /**
     * Section 3, the other way round. An unsent action holds the wallet's
     * inputs until it is sent or aborted. A state that spends the tip has a
     * reference; an issue that needed no signature has none, and
     * @bsv/wallet-toolbox then finds the action by its transaction identifier.
     */
    async discard(built) {
      const reference = built.reference ?? built.txid
      try {
        const result = await wallet.abortAction({ reference })
        say(result.aborted !== false, result.aborted !== false ? `the unsent action ${short(built.txid)} is aborted, and the wallet has its inputs back.` : `the wallet did not abort ${short(built.txid)}, because the network already knows it; do not build again.`)
      } catch (cause) {
        say(false, `the wallet did not abort ${short(built.txid)} (${cause.message}); abort it before building again, or its inputs stay out of use.`)
      }
    },
    /**
     * Section 7. The wallet obtains the proof as part of being a wallet and
     * attaches it to the transaction it holds. It can return that transaction
     * only while it is the tip: listOutputs lists spendable outputs, so once a
     * later state spends one, its path can no longer be read this way.
     */
    async waitForProof(txid, minutes) {
      const deadline = Date.now() + minutes * 60_000
      console.log(`Waiting up to ${minutes} minute${minutes === 1 ? '' : 's'} for the wallet to attach the merkle path of ${short(txid)}; its monitor asks a header source once the block is a minute old.`)
      for (;;) {
        const outputs = await wallet.listOutputs({ basket: 'dpp', include: 'entire transactions', limit: 10000 })
        if (outputs.BEEF != null) {
          // A parsed BEEF keeps a proven transaction's path in its bumps, not on the transaction.
          const beef = Beef.fromBinary(outputs.BEEF)
          const held = beef.findTxid(txid)
          const path = held?.bumpIndex == null ? held?.tx?.merklePath : beef.bumps[held.bumpIndex]
          if (path != null && pathContains(path, txid)) return path
        }
        if (Date.now() > deadline) return undefined
        await sleep(30_000)
      }
    },
  }
}

// ----------------------------------------------------- the in-process index

/**
 * The dry run's index: the real topic manager, lookup service and HTTP host
 * the reference deployment runs, over in-memory storage, on an ephemeral
 * loopback port, with a publisher key policy that names the writer's key
 * and the managed-custody profile selected. It is loaded here and not at the
 * top, so a live run needs none of it. The host is reached by path because
 * the package's entry point is the library and never starts a server.
 */
async function startLocalIndex(publisherKey) {
  let overlay, topics, host
  try {
    overlay = await import('@bsv/overlay')
    topics = await import('@bsv/dpp-overlay-topics')
    host = await import(pathToFileURL(join(here, '..', 'packages', 'overlay-topics', 'dist', 'index.js')).href)
  } catch (cause) {
    throw new Error(`the in-process index could not be loaded (${cause.message}); run npm ci and npm run build in the repository first`)
  }

  // The policy chain of spec/services.md section 1: one operator signs a genesis that names the writer's key as a state publisher.
  const operatorKey = PrivateKey.fromHex('44'.repeat(32))
  const operator = 'Example operator'
  const genesis = {
    policyFormat: 'dpp-publisher-policy@1',
    policyVersion: 1,
    scope: { operatorProfile: 'single-operator@1', operators: [operator], topics: ['tm_dpp'] },
    issuedAt: '2026-01-01T00:00:00Z',
    publishers: [{ key: publisherKey, role: 'state-publisher', activeFrom: '2026-01-01T00:00:00Z' }],
    authorisation: { kind: 'genesis', signer: operatorKey.toPublicKey().toString(), suite: 'bsv-ecdsa-der', value: '' },
  }
  genesis.authorisation.value = operatorKey.sign(policySigningPreimage(genesis)).toDER('hex')
  const policy = topics.loadPublisherPolicyJson(JSON.stringify([genesis]), { [operator]: operatorKey.toPublicKey().toString() })

  const records = new topics.InMemoryDppStorage()
  const storage = new topics.InMemoryOverlayStorage()
  const lookupServices = { ls_dpp: new topics.DppLookupService(records) }
  const silent = { ...console, log() {}, info() {}, warn() {}, error() {} }
  const engine = new overlay.Engine(
    { tm_dpp: new topics.DppTopicManager('', { publisherPolicy: policy.chain, managedAcceptance: true, admittedOutputs: storage }) },
    lookupServices,
    storage,
    'scripts only', // header checks off: nothing here is mined
    undefined, undefined, undefined, undefined, undefined,
    { tm_dpp: false }, // no peers, no synchronisation
    false,
    '[index] ',
    false,
    undefined,
    silent
  )
  const service = await host.startOverlayService(engine, {
    port: 0,
    host: '127.0.0.1',
    submitToken: 'dry-run-submit-token',
    proofToken: 'dry-run-callback-token',
    components: { records, engineStorage: storage, lookupServices, publisherPolicy: policy, managedAcceptance: true },
  })
  return { url: `http://127.0.0.1:${service.port}`, port: service.port, close: service.close }
}

// ------------------------------------------------------------------ the writer

/** The journal the application keeps (section 8, and docs/packages/build-an-application.md section 5): written before each step is acted on, so a retry continues and never rebuilds. */
function journalFile() {
  const digest = Utils.toHex(Hash.sha256(Utils.toArray(passportId, 'utf8'))).slice(0, 16)
  return join(journalDirectory ?? 'dpp-journal', `passport-${digest}.json`)
}
const journalEnabled = () => journalDirectory != null || !dryRun

function writeJournal(ctx) {
  if (!journalEnabled()) return
  const file = journalFile()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ passportId, indexUrl, states: ctx.journal }, null, 2)}\n`)
}

/** Seal the owner tier the way spec/record-model.md section 7 recommends: checked against the restricted schema, encrypted by the wallet to itself, bound by its hash, and read back before anything is built. */
async function sealOwnerTier(ctx, fields, label) {
  const validate = validatorFor(readRestrictedPayloadSchema(PROFILE))
  if (!validate(fields)) {
    say(false, `the ${label} owner tier is refused by the restricted schema of ${PROFILE}: ${validate.errors.map((e) => `${e.instancePath || 'the tier'} ${e.message}`).join('; ')}.`)
    return undefined
  }
  const plaintext = Utils.toArray(JSON.stringify(fields), 'utf8')
  const { ciphertext } = await ctx.wallet.encrypt({ plaintext, protocolID: OWNER_DATA_PROTOCOL, keyID: passportId, counterparty: 'self' })
  const hash = ownerBlobHash(ciphertext)
  const { plaintext: back } = verifyOwnerBlob(ciphertext, hash)
    ? await ctx.wallet.decrypt({ ciphertext, protocolID: OWNER_DATA_PROTOCOL, keyID: passportId, counterparty: 'self' })
    : { plaintext: [] }
  const sound = Utils.toHex(back) === Utils.toHex(plaintext)
  say(
    sound,
    `the ${label} owner tier is valid under the restricted schema of ${PROFILE}, encrypted by the wallet to itself, and only its hash ${short(hash)} goes into the state; the ciphertext stays off chain, in the journal, and decrypts back to what was sealed.`
  )
  return sound ? { ciphertext, hash } : undefined
}

/**
 * One state, through the steps of spec/writing.md in order. Returns what was
 * written, or undefined when the state was not written: refused by its own
 * check or by the index, and aborted, or not answered for by the network.
 */
async function writeState(adapter, ctx, spec) {
  const { op, label, payload, ownerFields, tip, genesis, controlLinkage } = spec
  console.log(`step: ${label}`)

  const sealed = await sealOwnerTier(ctx, ownerFields, op)
  if (sealed == null) return undefined
  const data = {
    version: '2',
    op,
    passportId,
    timestamp: instant(),
    ownerIdentityKey: ctx.controllerKey,
    actorIdentityKey: ctx.identityKey,
    actorKeyId: 'writer',
    eventData: '',
    payloadPublic: JSON.stringify(payload),
    payloadOwnerHash: sealed.hash,
    previousTxid: tip == null ? '' : tip.txid,
    previousOutputIndex: tip == null ? null : tip.outputIndex,
    lineageGenesis: genesis == null ? null : { txid: genesis.txid, outputIndex: genesis.outputIndex },
    controlLinkage: controlLinkage ?? '',
    authorisationCommitment: '',
  }
  const state = await completeState(data, ctx.wallet, ctx.wallet)
  const lockingScript = buildLockingScript(state, ctx.controllerKey)

  // Section 3: built unsent, complete and signed, spending nothing until it is sent.
  let built
  try {
    built = await adapter.build({ lockingScript, tip })
  } catch (cause) {
    say(false, `the wallet could not build the ${op} (${cause.message}); nothing was sent.`)
    return undefined
  }
  const outputIndex = findDppOutputs(built.tx)[0]?.outputIndex ?? 0
  console.log(`The wallet built ${built.txid} unsent: complete, signed, and spending nothing until it is sent.`)
  const entry = {
    op,
    txid: built.txid,
    rawTx: built.tx.toHex(),
    beef: Utils.toBase64(built.beef),
    ownerTier: { hash: sealed.hash, ciphertext: Utils.toBase64(sealed.ciphertext) },
  }
  ctx.journal.push(entry)
  writeJournal(ctx)

  // Section 2: the verifier's own checks on the unsent transaction, with the lineage so far in front of it.
  const checked = await verifyChain([...ctx.written.map((w) => w.tx), built.tx], {
    chainTracker: 'scripts only',
    serverIdentityKey: ctx.identityKey,
    managedAcceptance: true,
  })
  const finding = checked.states.at(-1)
  say(
    checked.valid,
    checked.valid
      ? `the writer's own check accepts the unsent ${op} (spec/writing.md section 2): the actor signature ${finding.userSignatureValid ? 'verifies' : 'FAILS'}, the publisher signature ${finding.serverSignatureValid === false ? 'FAILS' : 'verifies'}, ${tip == null ? 'the genesis rules hold' : 'the link to the tip holds and control is proven by linkage'}, and inclusion is ${finding.spv} because nothing is mined.`
      : `the writer's own check refuses the unsent ${op} (spec/writing.md section 2): ${checked.error ?? 'no reason given'}.`
  )
  if (!checked.valid) {
    console.log('Nothing was sent.')
    await adapter.discard(built)
    entry.index = 'not asked'
    entry.network = 'not sent'
    writeJournal(ctx)
    return undefined
  }

  // Section 3: a state after the genesis spends the tip the index returns for the passport.
  if (tip != null) {
    const held = await lineageOnIndex().catch(() => undefined)
    if (held != null) {
      const heldTip = held.at(-1)?.id('hex')
      say(
        heldTip === tip.txid,
        heldTip === tip.txid
          ? `the index's tip for this passport is ${short(heldTip)}, the state this one spends.`
          : `the index's tip for this passport is ${heldTip == null ? 'nothing' : short(heldTip)}, not ${short(tip.txid)}; this state would be refused.`
      )
      if (heldTip !== tip.txid) {
        await adapter.discard(built)
        return undefined
      }
    }
  }

  // Section 3: announce first, send only on admission. An unreachable index refuses nothing: the state is sent and announced again afterwards.
  let announced = await announce(built.beef, built.txid)
  entry.index = announced
  writeJournal(ctx)
  if (announced === 'refused' || announced === 'unauthorised') {
    console.log(
      announced === 'refused'
        ? 'Nothing was sent: the state was refused while it was still a draft (section 3).'
        : 'Nothing was sent: fix the index address or the submit token, and build again.'
    )
    await adapter.discard(built)
    return undefined
  }

  // Sections 4 and 5: send, and report only the network's answer.
  const sent = await adapter.send(built)
  entry.network = sent
  writeJournal(ctx)
  if (sent === 'refused' && announced === 'admitted') await retract(built.txid, 'the network refused the transaction after the index admitted it')
  if (sent !== 'accepted') return undefined

  // Section 6: an announcement that could not be made is retried, and is never a reason to spend again.
  if (announced === 'unreachable') {
    announced = await announce(built.beef, built.txid)
    entry.index = announced
  }

  const written = { op, tx: built.tx, txid: built.txid, outputIndex, beef: built.beef, ownerHash: sealed.hash }
  ctx.written.push(written)
  writeJournal(ctx)
  return written
}

/** Section 7: the wallet's proof, pushed to the index, attached to the bytes the journal holds. */
async function proveState(adapter, ctx, written) {
  const entry = ctx.journal.find((e) => e.txid === written.txid)
  if (!dryRun && waitMinutes <= 0) {
    console.log(`Not waiting for the merkle path of ${short(written.txid)}; pass --wait-proof=<minutes> to wait and push it to ${indexUrl}/arc-ingest. Until it reaches the index, every verifier reads this state as pending (section 7).${written.op === 'ISSUE' ? ' Once the UPDATE spends this state the wallet cannot list it again, so its path will not be readable from the wallet afterwards.' : ''}`)
    return false
  }
  if (dryRun) {
    console.log(`Would prove: wait for the wallet's merkle path of ${short(written.txid)}, then POST ${indexUrl}/arc-ingest {"txid","merklePath","blockHeight"}. Nothing is mined here, so the path pushed instead is made up; only an index with its header checks off would take it.`)
  }
  const path = await adapter.waitForProof(written.txid, waitMinutes)
  if (path == null) {
    console.log(`No merkle path for ${short(written.txid)} yet. Every verifier reads this state as pending until one reaches the index; point the wallet's broadcaster callback at ${indexUrl}/arc-ingest, or push the path when the wallet has it (section 7).`)
    return false
  }
  await pushProof(written.txid, path)
  // The bytes kept for the state now carry their proof, and the next state is built on them.
  written.tx.merklePath = path
  written.beef = written.tx.toAtomicBEEF()
  entry.proof = { merklePath: path.toHex(), blockHeight: path.blockHeight }
  entry.beef = Utils.toBase64(written.beef)
  writeJournal(ctx)
  return true
}

/** Section 8, and the lineage read back the way a stranger reads it. */
async function keepAndReadBack(ctx) {
  const file = journalEnabled() ? journalFile() : undefined
  const kept = ctx.written
    .map((w) => `${w.op} ${short(w.txid)} (${w.tx.toHex().length / 2} bytes, BEEF ${w.beef.length} bytes${ctx.journal.find((e) => e.txid === w.txid)?.proof == null ? ', no proof yet' : ', with its proof'})`)
    .join('; ')
  console.log(
    `Kept: ${kept}, with the owner-tier ciphertext of each, ${file == null ? 'in memory only, because a dry run writes nothing; pass --journal=<dir> to write them' : `in ${file}`}. ${dryRun ? '' : 'The wallet keeps the transactions, their BEEFs and their proofs as part of being a wallet, in its basket "dpp", but never the ciphertext, which only this journal holds. '}The index is where the lineage is found, never where it is kept (section 8).`
  )
  const lineage = await lineageOnIndex()
  say(
    lineage.length === ctx.written.length && lineage.every((tx, i) => tx.id('hex') === ctx.written[i].txid),
    `the index's lookup returns the lineage as written: ${lineage.map((tx) => `${findDppOutputs(tx)[0].state.op} ${short(tx.id('hex'))}`).join(' -> ')}.`
  )
  console.log(`step: The report a stranger makes from those bytes, accepting ${short(ctx.identityKey)} as the one publisher and genesis issuer.`)
  const report = await verifyPassportEvidence(
    { tokenHistory: lineage },
    { passportId, source: 'request-context' },
    {
      policyId: `${CUSTODY_PROFILE}/write-passport-v2`,
      publisherKeys: [ctx.identityKey],
      managedAcceptance: { required: true },
      chainTracker: 'scripts only',
      authority: { required: true, genesisIssuers: [ctx.identityKey] },
    }
  )
  for (const c of report.checks) console.log(`  ${EVIDENCE_CHECK_LABELS[c.name]}: ${c.status}${c.reasonCode == null ? '' : ` (${c.reasonCode})`} [${c.name}]`)
  const status = (name) => report.checks.find((c) => c.name === name).status
  say(
    status('recordEncoding') === 'pass' && status('actorSignatures') === 'pass' && status('publisherSignatures') === 'pass' && status('linkage') === 'pass',
    'the token rail passes: encoding, both signatures on both states, and linkage with control proven on the UPDATE.'
  )
  say(status('issuerAuthority') === 'pass', 'the genesis was made by the issuer this policy names.')
  console.log(
    `Inclusion reads ${status('inclusion')}: no header source was asked, because ${dryRun ? 'nothing here is mined' : 'this report runs with header checks off; run the reader of docs/packages/build-an-application.md section 1 with a header source once the states are mined'}.`
  )
}

/** The refusals, dry run only: a state the record model forbids, shown refused by the writer's own check and by the index, and aborted. */
async function showRefusal(adapter, ctx) {
  console.log('step: A state the record model forbids: an UPDATE that spends the tip without proving control.')
  const tip = ctx.written.at(-1)
  const state = await completeState(
    {
      version: '2',
      op: 'UPDATE',
      passportId,
      timestamp: instant(),
      ownerIdentityKey: ctx.controllerKey,
      actorIdentityKey: ctx.identityKey,
      actorKeyId: 'writer',
      eventData: '',
      payloadPublic: JSON.stringify(ctx.revisedPayload),
      payloadOwnerHash: tip.ownerHash,
      previousTxid: tip.txid,
      previousOutputIndex: tip.outputIndex,
      lineageGenesis: { txid: ctx.written[0].txid, outputIndex: ctx.written[0].outputIndex },
      controlLinkage: '', // the actor is not the controller, so this must carry the scalar
      authorisationCommitment: '',
    },
    ctx.wallet,
    ctx.wallet
  )
  const built = await adapter.build({ lockingScript: buildLockingScript(state, ctx.controllerKey), tip })
  const checked = await verifyChain([...ctx.written.map((w) => w.tx), built.tx], { chainTracker: 'scripts only', serverIdentityKey: ctx.identityKey, managedAcceptance: true })
  say(!checked.valid, `the writer's own check refuses it before anything is sent: ${checked.error ?? 'no reason given'}.`)
  // Announced anyway, to show what the index does with what the writer's own check already refused.
  const announced = await announce(built.beef, built.txid)
  say(announced === 'refused', 'the index refuses it too, and its answer carries no reason.')
  const reason = indexLog.filter((line) => line.includes('tm_dpp refused')).at(-1)
  if (reason != null) console.log(`Its operator's log reads: ${reason}`)
  await adapter.discard(built)
  const held = await lineageOnIndex()
  say(held.at(-1)?.id('hex') === tip.txid, `the index's tip is still ${short(tip.txid)}: a refused announcement changes nothing it holds.`)
  const again = await announce(tip.beef, tip.txid)
  say(again === 'duplicate', 'announcing the tip again answers duplicate, which is no refusal: the same bytes change nothing (section 6).')
}

/**
 * The checks that need no wallet and no index, made first so that a refusal
 * costs nothing and reaches no wallet: the identifier, which a live run
 * writes under, and the two public payloads. Answers an exit code to stop
 * with, or the payloads.
 */
function prepare() {
  const problems = identifierProblems(passportId)
  if (problems.length > 0) {
    if (!dryRun) {
      console.error(`Refused: ${passportId} cannot be written by this example, because ${problems.join('; and ')}. Use a GS1 Digital Link under demonstration prefix 952 on a host you control (docs/identifiers.md); nothing was built.`)
      return 2
    }
    console.log(`Note: ${passportId} would be refused by a live run, because ${problems.join('; and ')}.`)
  } else {
    const link = parseGs1DigitalLink(passportId)
    say(
      true,
      `the identifier is a GS1 Digital Link under demonstration prefix 952 with a correct check digit and the serial ${link.serial}. It is written into every state and cannot change, and this program cannot see that you control ${link.host}: use a host you do.`
    )
  }

  // A demonstration, checked against the profile before anything is written.
  const payload = demonstrationPayload()
  const revisedPayload = { ...payload, careNote: `${payload.careNote}, revised by the UPDATE` }
  const validatePublic = validatorFor(readPublicPayloadSchema(PROFILE))
  let valid = true
  for (const [name, candidate] of [['first', payload], ['revised', revisedPayload]]) {
    const accepted = validatePublic(candidate)
    valid &&= accepted
    say(
      accepted,
      accepted
        ? `the ${name} public payload is valid under the ${PROFILE} schema${candidate.notice == null ? '' : ' and starts with the demonstration notice'}.`
        : `the ${name} public payload is refused by the ${PROFILE} schema: ${validatePublic.errors.map((e) => `${e.instancePath || 'the payload'} ${e.message}`).join('; ')}.`
    )
  }
  return valid ? { payload, revisedPayload } : 1
}

/** Everything both modes share, from the keys to the last report. */
async function run(adapter, wallet, { payload, revisedPayload }) {
  const { publicKey: identityKey } = await wallet.getPublicKey({ identityKey: true })

  // The keys: the calls that read them and reveal the linkage come first, so a refused approval costs nothing. Approvals to sign and spend come with each transaction.
  const controllerKey = await ownerKeyFor(passportId, wallet)
  const controlLinkage = await decryptOwnerLinkage(await revealOwnerLinkage(passportId, wallet, identityKey), wallet)
  console.log(
    `The wallet's identity key is ${short(identityKey)}; the passport's controller key, one derivation below it, is ${short(controllerKey)} (spec/custody.md section 2). The wallet signs as actor and as publisher and holds the lock.`
  )
  say(
    verifyOwnerLinkage(identityKey, controllerKey, controlLinkage),
    'the control linkage the wallet revealed to itself links its identity key to the controller key; it goes into the UPDATE, and is public on chain from then on.'
  )

  // The index: its policy must name this wallet, and it must hold nothing under this identifier.
  if (!(await checkCapabilities(identityKey))) return 1
  const held = await lineageOnIndex().catch((cause) => {
    console.log(`The index could not be asked what it holds for this passport (${cause.message}); that is not a refusal, and the announcement will say.`)
    return undefined
  })
  if (held != null && held.length > 0) {
    say(false, `the index already holds ${held.length} state${held.length === 1 ? '' : 's'} for this identifier; this program writes a new lineage and never a second genesis, so use a serial that is not in use. Nothing was built.`)
    return 1
  }
  if (held != null) console.log('The index holds nothing under this identifier yet, so the ISSUE will be its genesis.')

  const ctx = { wallet, identityKey, controllerKey, revisedPayload, written: [], journal: [] }

  const genesis = await writeState(adapter, ctx, {
    op: 'ISSUE',
    label: 'ISSUE: the demonstration payload and a sealed owner tier become the genesis, locked to the controller key.',
    payload,
    ownerFields: { serviceNotes: 'Demonstration owner-tier note, first revision.' },
  })
  if (genesis == null) return 1
  await proveState(adapter, ctx, genesis)

  const update = await writeState(adapter, ctx, {
    op: 'UPDATE',
    label: 'UPDATE: the care note and the owner tier are revised, spending the ISSUE output and proving control by linkage.',
    payload: revisedPayload,
    ownerFields: { serviceNotes: 'Demonstration owner-tier note, revised by the UPDATE.' },
    tip: genesis,
    genesis,
    controlLinkage,
  })
  if (update == null) return 1
  await proveState(adapter, ctx, update)

  try {
    await keepAndReadBack(ctx)
  } catch (cause) {
    say(false, `both states are written, but reading the lineage back from the index failed (${cause.message}); the index is a courtesy and the bytes are kept, so this does not unwrite them.`)
  }
  if (dryRun) await showRefusal(adapter, ctx)
  return failures === 0 ? 0 : 1
}

async function main() {
  const prepared = prepare()
  if (typeof prepared === 'number') return prepared
  if (dryRun) {
    const wallet = new ProtoWallet(PrivateKey.fromHex('11'.repeat(32)))
    const { publicKey: identityKey } = await wallet.getPublicKey({ identityKey: true })
    const index = await startLocalIndex(identityKey)
    indexUrl = index.url
    submitToken = 'dry-run-submit-token'
    callbackToken = 'dry-run-callback-token'
    console.log(`The index is in this process at ${indexUrl}, with in-memory storage and a publisher key policy that names the writer's key and selects ${CUSTODY_PROFILE}.`)
    try {
      return await run(dryAdapter(wallet), wallet, prepared)
    } finally {
      await index.close()
    }
  }
  // The originator names this application to the wallet. In Node the SDK's
  // local substrates need one, and without it no wallet is found at all.
  const wallet = new WalletClient('auto', originator)
  return await run(liveAdapter(wallet), wallet, prepared)
}

let code
try {
  code = await main()
} catch (cause) {
  console.error(
    `Stopped: ${cause?.message ?? cause}.${dryRun ? '' : ` If no BRC-100 wallet answered on this machine, start one and run again. Otherwise read the journal${existsSync(journalFile()) ? ` at ${journalFile()}` : ''} before running again: a state built and not sent holds the wallet's inputs until it is aborted, and a state that was sent must never be built a second time.`}`
  )
  code = 1
}
// Code 2 is a refusal of the input, already explained on stderr, with nothing built.
if (code !== 2) console.log(code === 0 ? 'Every sentence above holds.' : 'At least one sentence above does not hold, or the run stopped.')
process.exit(code)
