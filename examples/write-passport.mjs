#!/usr/bin/env node
/**
 * Write a passport state the way spec/writing.md says a writer must: checked
 * before it is sent, announced before it is sent, sent and answered for,
 * proven, offered to the index, and kept.
 *
 *   node examples/write-passport.mjs --dry-run
 *   node examples/write-passport.mjs <passportId> [indexUrl] [--wait-proof=<minutes>]
 *                                    [--submit-token=<t>] [--callback-token=<t>]
 *                                    [--payload=<json>]
 *
 * Live, the script is one owner's application under possession
 * (spec/custody.md section 5): one BRC-100 wallet is actor, owner, publisher
 * and lock, each role one derivation from the wallet's root and no key ever
 * leaving it. It asks the wallet for its identity key and for the passport's
 * owner key, has the wallet make both signatures, builds the ACTIVATE state
 * locked to the owner key, and then walks the writer's lifecycle in order,
 * one sentence per step: the verifier's own checks on the unsent transaction
 * (section 2); the announcement to the index, which admits or refuses while
 * the state is still a draft (section 3); the send, reported only in the
 * network's own words (sections 4 and 5); the wait for the wallet's merkle
 * path and its push to the index's proof route (section 7); and where the
 * bytes now live (section 8). A refused admission stops before anything is
 * sent. The wallet is whatever BRC-100 wallet answers on this machine.
 *
 * With --dry-run, what CI runs, there is no wallet and no network: the
 * fixture's keys stand in, the script rebuilds the chain fixture's first state
 * and shows it byte for byte identical to fixtures/chain-v1.json, so the
 * recipe here is provably the fixture's; runs the section 2 check and shows it
 * accepting; then builds a state the record model forbids and shows the same
 * check refusing it before anything would have been sent. The network steps
 * print as what they would do.
 *
 * Results print one sentence per step, never a score, as GOVERNANCE.md
 * requires of every conformance surface.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Beef,
  PrivateKey,
  ProtoWallet,
  Transaction,
  UnlockingScript,
  Utils,
  WalletClient,
} from '@bsv/sdk'
import {
  buildLockingScript,
  chainFromBeef,
  completeState,
  ownerBlobHash,
  ownerKeyFor,
  verifyChain,
} from '@bsv/dpp-core'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const dryRun = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))
const passportId = positional[0]
const indexUrl = (positional[1] ?? 'https://dpp-overlay.bsvb.net').replace(/\/+$/, '')
const waitMinutes = Number(flag('wait-proof') ?? 0)
const submitToken = flag('submit-token')
const callbackToken = flag('callback-token')
const payloadFlag = flag('payload')

if (!dryRun && passportId == null) {
  console.error('usage: write-passport.mjs <passportId> [indexUrl] [--wait-proof=<minutes>] | --dry-run')
  process.exit(2)
}

let failures = 0
const say = (ok, sentence) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok' : 'FAIL'}: ${sentence}`)
}
const short = (hex) => `${hex.slice(0, 12)}...`

// ------------------------------------------------------------------ dry run

async function dryRunFromFixture() {
  const fixture = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'chain-v1.json'), 'utf8'))
  const pinned = fixture.states[0]
  const maker = new ProtoWallet(PrivateKey.fromHex('11'.repeat(32)))
  const server = new ProtoWallet(PrivateKey.fromHex('22'.repeat(32)))
  console.log("Dry run: the fixture's keys stand in for a wallet, and nothing is sent.")

  // The recipe, on the fixture's own data: sign, build the script, wrap it.
  const state = await completeState(pinned.data, maker, server)
  const lockingScript = buildLockingScript(state, pinned.lockingKey)
  const tx = new Transaction()
  tx.addOutput({ satoshis: 1, lockingScript })
  say(
    lockingScript.toHex() === pinned.lockingScript,
    "the locking script this recipe builds is the fixture's state 1, byte for byte."
  )
  say(
    tx.toHex() === pinned.rawTx && tx.id('hex') === pinned.txid,
    `and so is the transaction, ${tx.id('hex')}.`
  )

  // Section 2: the verifier's own checks, before anything is sent.
  const accepted = await verifyChain([tx], {
    chainTracker: 'scripts only',
    serverIdentityKey: fixture.serverKey,
  })
  say(
    accepted.valid,
    "the writer's own check accepts it (spec/writing.md section 2): user signature, server signature and the genesis rules hold; inclusion is pending because nothing is mined."
  )

  // A state the record model forbids: an EDIT that changes the owner. The same
  // check refuses it while it is still bytes in memory, which is the only
  // moment at which the mistake costs nothing.
  const forbidden = await completeState(
    {
      ...pinned.data,
      op: 'EDIT',
      timestamp: '2026-06-12T09:00:00Z',
      ownerIdentityKey: fixture.owner2Key,
      previousTxid: tx.id('hex'),
    },
    maker,
    server
  )
  const forbiddenTx = new Transaction()
  forbiddenTx.addInput({ sourceTransaction: tx, sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
  forbiddenTx.addOutput({ satoshis: 1, lockingScript: buildLockingScript(forbidden, pinned.lockingKey) })
  const refused = await verifyChain([tx, forbiddenTx], {
    chainTracker: 'scripts only',
    serverIdentityKey: fixture.serverKey,
  })
  say(
    !refused.valid,
    `the same check refuses a state the record model forbids before it could be sent: ${refused.error ?? 'no reason given'}.`
  )

  const beefBytes = tx.toBEEF().length
  console.log(
    `Would announce: POST ${indexUrl}/submit with X-Topics ["tm_dpp"] and a BEEF of ${beefBytes} bytes, and send only on tm_dpp=admitted (section 3).`
  )
  console.log(
    `Would send: a send-only action with sendWith [${short(tx.id('hex'))}] and acceptDelayedBroadcast false, reporting the network's answer and nothing sooner (sections 4 and 5).`
  )
  console.log(
    `Would prove: wait for the wallet's merkle path, then POST ${indexUrl}/arc-ingest {"txid","merklePath","blockHeight"} (section 7).`
  )
  console.log(
    "Would keep: the wallet holds the transaction, its BEEF and its proof for the passport's life (section 8)."
  )
}

// --------------------------------------------------------------------- live

/**
 * Section 3. Announce the unsent transaction. Three outcomes, and only one of
 * them is a refusal: the index admitted it, the index refused it, or the index
 * could not be reached, which says nothing about the state.
 */
async function announce(beef, txid) {
  let response
  try {
    response = await fetch(`${indexUrl}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Topics': JSON.stringify(['tm_dpp']),
        ...(submitToken != null ? { Authorization: `Bearer ${submitToken}` } : {}),
      },
      body: new Uint8Array(beef),
    })
  } catch (cause) {
    console.log(
      `The index at ${indexUrl} could not be reached (${cause.message}). That is not a refusal; only an answer refuses (section 3).`
    )
    return 'unreachable'
  }
  if (response.status === 400) {
    const body = await response.json().catch(() => ({}))
    console.log(`The index refused ${short(txid)}: ${body.description ?? 'no reason given'}.`)
    return 'refused'
  }
  if (!response.ok) {
    console.log(
      `The index answered HTTP ${response.status} to the announcement, which says nothing about the state; it will be announced again after the send (section 6).`
    )
    return 'unreachable'
  }
  const admission = response.headers.get('x-admission') ?? ''
  if (admission.includes('tm_dpp=none')) {
    console.log(`The index refused ${short(txid)} on admission; its log names the reason.`)
    return 'refused'
  }
  console.log(
    `The index ${admission.includes('duplicate') ? 'already held' : 'admitted'} ${short(txid)} while it was still a draft (section 3).`
  )
  return 'admitted'
}

/**
 * Sections 4 and 5. Send with a send-only action and report nothing but the
 * network's answer: `unproven` is accepted and pending, `sending` is not yet
 * an answer, `failed` never existed.
 */
async function send(wallet, txid) {
  let result
  try {
    result = await wallet.createAction({
      description: 'dpp send',
      options: { sendWith: [txid], acceptDelayedBroadcast: false },
    })
  } catch (cause) {
    const reviews = cause?.reviewActionResults ?? []
    const detail = reviews.length > 0 ? reviews.map((r) => `${short(r.txid)} ${r.status}`).join(', ') : cause.message
    say(false, `the network did not accept ${short(txid)}: ${detail}. The state never existed and nothing was spent; rebuild only after learning why (section 4).`)
    return false
  }
  const status = result.sendWithResults?.find((r) => r.txid === txid)?.status
  if (status === 'unproven') {
    say(true, `the network accepted ${txid}: the state exists and is pending until mined (sections 4 and 5).`)
    return true
  }
  if (status === 'sending') {
    say(false, `the wallet is still sending ${short(txid)}; that is not yet the network's answer, so the state is not yet written. Wait for the wallet, and do not rebuild (section 4).`)
    return false
  }
  say(false, `the network answered ${status ?? 'nothing the wallet reported'} for ${short(txid)}: the state never existed and nothing was spent (section 4).`)
  return false
}

/** The merkle path the wallet has attached, if any, read the way a client can. */
async function merklePathFromWallet(wallet, txid) {
  const outputs = await wallet.listOutputs({ basket: 'dpp', include: 'entire transactions', limit: 10000 })
  if (outputs.BEEF == null) return undefined
  return Beef.fromBinary(outputs.BEEF).findTxid(txid)?.tx?.merklePath
}

/**
 * Section 7. The wallet obtains the proof as part of being a wallet; the
 * application offers it to the index, because re-announcing the state would
 * do nothing and the index's stored bytes would stay unproven.
 */
async function proveAndPush(wallet, txid) {
  const deadline = Date.now() + waitMinutes * 60_000
  console.log(
    `Waiting up to ${waitMinutes} minute${waitMinutes === 1 ? '' : 's'} for the wallet to attach the merkle path; its monitor asks a header source once the block is a minute old.`
  )
  for (;;) {
    const path = await merklePathFromWallet(wallet, txid)
    if (path != null) {
      const response = await fetch(`${indexUrl}/arc-ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(callbackToken != null ? { 'X-Callback-Token': callbackToken } : {}),
        },
        body: JSON.stringify({ txid, merklePath: path.toHex(), blockHeight: path.blockHeight }),
      })
      const body = await response.json().catch(() => ({}))
      say(
        response.ok && body.status === 'applied',
        `the proof (block ${path.blockHeight}) reached the index: ${body.status ?? `HTTP ${response.status}`}${body.description != null ? `, ${body.description}` : ''} (section 7).`
      )
      return
    }
    if (Date.now() > deadline) {
      console.log(
        `No merkle path yet. Every verifier reads this state as pending until one reaches the index; run again later, or point the wallet's broadcaster callback at ${indexUrl}/arc-ingest (section 7).`
      )
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 30_000))
  }
}

async function live() {
  const wallet = new WalletClient('auto')
  const { publicKey: identityKey } = await wallet.getPublicKey({ identityKey: true })
  const ownerKey = await ownerKeyFor(passportId, wallet)
  console.log(
    `The wallet's identity key is ${short(identityKey)}; the passport's owner key, one derivation below it, is ${short(ownerKey)} (spec/custody.md section 2). Both signatures and the lock come from the same wallet: possession.`
  )

  // The owner tier lives off chain, encrypted; only its hash is written. This
  // example publishes none, so the hash is of a note saying so.
  const ownerTier = Utils.toArray(JSON.stringify({ note: 'the owner tier is stored off chain by a build; this example writes only its hash' }), 'utf8')
  const data = {
    passportId,
    op: 'ACTIVATE',
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ownerIdentityKey: ownerKey,
    actorIdentityKey: identityKey,
    actorKeyId: 'owner',
    eventData: '',
    payloadPublic: payloadFlag ?? JSON.stringify({ name: 'Example passport', dataCarrier: passportId }),
    payloadOwnerHash: ownerBlobHash(ownerTier),
    previousTxid: '',
  }
  const state = await completeState(data, wallet, wallet)
  const lockingScript = buildLockingScript(state, ownerKey)

  // Built unsent (section 3): complete and signed, spending nothing until sent.
  const created = await wallet.createAction({
    description: 'dpp activate',
    outputs: [
      {
        lockingScript: lockingScript.toHex(),
        satoshis: 1,
        outputDescription: 'dpp passport state',
        basket: 'dpp',
        customInstructions: JSON.stringify({ passportId }),
      },
    ],
    options: { noSend: true, randomizeOutputs: false, acceptDelayedBroadcast: false },
  })
  if (created.tx == null || created.txid == null) {
    console.error('The wallet did not return a signed transaction; nothing was sent.')
    process.exit(1)
  }
  const txid = created.txid
  console.log(`The wallet built ${txid} unsent: complete, signed, and spending nothing until it is sent.`)

  // Section 2: the verifier's own checks on the unsent transaction.
  const chain = chainFromBeef(Beef.fromBinary(created.tx), passportId)
  const checked = await verifyChain(chain, { chainTracker: 'scripts only', serverIdentityKey: identityKey })
  say(
    checked.valid,
    `the writer's own check ${checked.valid ? 'accepts' : 'refuses'} the unsent state (spec/writing.md section 2)${checked.error != null ? `: ${checked.error}` : ''}.`
  )
  if (!checked.valid) {
    console.log('Nothing was sent. The unsent action stays in the wallet and spends nothing.')
    process.exit(1)
  }

  // Section 3: announce first, send only on admission.
  let announced = await announce(created.tx, txid)
  if (announced === 'refused') {
    console.log('Nothing was sent: the state was refused while it was still a draft, and the unsent action spends nothing (section 3).')
    process.exit(1)
  }

  // Sections 4 and 5: send, and report only the network's answer.
  if (!(await send(wallet, txid))) process.exit(1)

  // Section 6: an announcement that could not be made is retried, and is never
  // a reason to spend again.
  if (announced === 'unreachable') announced = await announce(created.tx, txid)

  // Section 7: the proof, from the wallet, pushed to the index.
  if (waitMinutes > 0) {
    await proveAndPush(wallet, txid)
  } else {
    console.log(
      `Not waiting for the merkle path; pass --wait-proof=<minutes> to wait and push it to ${indexUrl}/arc-ingest. Until it reaches the index, every verifier reads this state as pending (section 7).`
    )
  }

  // Section 8.
  console.log(
    `The bytes live in the wallet's basket "dpp": the transaction, its BEEF and, once mined, its proof, for the passport's life (section 8). The index is where the state is found, never where it is kept.`
  )
}

if (dryRun) {
  await dryRunFromFixture()
} else {
  try {
    await live()
  } catch (cause) {
    console.error(`Stopped: ${cause?.message ?? cause}. If no BRC-100 wallet answered on this machine, start one and run again; nothing was sent.`)
    process.exit(1)
  }
}
process.exit(failures === 0 ? 0 : 1)
