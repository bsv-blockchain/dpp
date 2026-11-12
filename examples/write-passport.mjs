#!/usr/bin/env node
/**
 * Historical: the version 1 writer's recipe, kept as a dry run. A writer MUST
 * NOT start a new lineage with a version 1 genesis (spec/writing.md section 1,
 * spec/record-model.md section 1), so this script no longer writes: run
 * without --dry-run, it refuses and names examples/write-passport-v2.mjs, the
 * version 2 writer, which walks every step of spec/writing.md live. Reading a
 * version 1 state is unchanged.
 *
 *   node examples/write-passport.mjs --dry-run
 *
 * With --dry-run, what CI runs, there is no wallet and no network: the
 * fixture's keys stand in, the script rebuilds the chain fixture's first state
 * and shows it byte for byte identical to fixtures/chain-v1.json, so the
 * recipe here is provably the fixture's; runs the check of spec/writing.md
 * section 2 and shows it accepting; then builds a state the record model
 * forbids and shows the same check refusing it before anything would have
 * been sent. The network steps print as what they would do.
 *
 * Results print one sentence per step, never a score, as GOVERNANCE.md
 * requires of every conformance surface.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PrivateKey,
  ProtoWallet,
  Transaction,
  UnlockingScript,
} from '@bsv/sdk'
import {
  buildLockingScript,
  completeState,
  verifyChain,
} from '@bsv/dpp-protocol'

const here = dirname(fileURLToPath(import.meta.url))
const dryRun = process.argv.slice(2).includes('--dry-run')
const indexUrl = 'https://dpp-overlay.bsvb.net'

if (!dryRun) {
  console.error('This version 1 writer no longer writes: a new lineage never starts at version 1 (spec/writing.md section 1). Write a new passport with node examples/write-passport-v2.mjs, or run this recipe with --dry-run.')
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

await dryRunFromFixture()
process.exit(failures === 0 ? 0 : 1)
