#!/usr/bin/env node
/**
 * Check a passport the way the standard says a stranger can: from transaction
 * bytes and public block headers, with no account and no operator's word.
 *
 *   node examples/verify-passport.mjs <passportId> [indexUrl]
 *   node examples/verify-passport.mjs --fixture
 *
 * With a passport identifier, the script asks an index (default: the
 * demonstration deployment) for the record's outputs, rebuilds the chain from
 * the BEEF the index returns, and verifies it: every user signature, every
 * link, every merkle proof against WhatsOnChain's headers. The index is only
 * used to find the bytes; nothing it says is trusted, which is the point.
 *
 * With --fixture, it verifies fixtures/chain-v1.json offline instead, so the
 * recipe runs in CI without a network. Inclusion then reports pending, because
 * the fixture's transactions are synthetic and no header source holds them.
 *
 * Results print one sentence per check, never a score, as GOVERNANCE.md
 * requires of every conformance surface.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Beef, Transaction, WhatsOnChain } from '@bsv/sdk'
import { chainFromBeef, findDppOutputs, verifyChain } from '@bsv/dpp-core'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const fixtureMode = args.includes('--fixture')
const passportId = args.find((a) => !a.startsWith('--'))
const indexUrl = (args.filter((a) => !a.startsWith('--'))[1] ?? 'https://dpp-overlay.bsvb.net').replace(/\/+$/, '')

if (!fixtureMode && passportId == null) {
  console.error('usage: verify-passport.mjs <passportId> [indexUrl] | --fixture')
  process.exit(2)
}

let chain
let tracker
if (fixtureMode) {
  const fixture = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'chain-v1.json'), 'utf8'))
  chain = fixture.states.map((s) => Transaction.fromHex(s.rawTx))
  tracker = 'scripts only'
  console.log(`Fixture chain: ${chain.length} states, verified from raw transaction hex, no header source.`)
} else {
  const response = await fetch(`${indexUrl}/lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service: 'ls_dpp', query: { passportId } }),
  })
  if (!response.ok) {
    console.error(`The index answered HTTP ${response.status}.`)
    process.exit(1)
  }
  const answer = await response.json()
  if (answer.outputs.length === 0) {
    console.log('The index knows no record with that identifier. That says nothing about whether one exists.')
    process.exit(1)
  }
  const tip = answer.outputs.reduce((a, b) => (a.beef.length >= b.beef.length ? a : b))
  chain = chainFromBeef(Beef.fromBinary(tip.beef), passportId)
  tracker = new WhatsOnChain('main')
  console.log(`The index returned ${answer.outputs.length} outputs; the tip's BEEF reconstructs a chain of ${chain.length} states.`)
}

const ops = chain.map((tx) => findDppOutputs(tx)[0].state.op)
console.log(`Operations, genesis to tip: ${ops.join(' -> ')}.`)

const result = await verifyChain(chain, { chainTracker: tracker })

for (const [i, s] of result.states.entries()) {
  console.log(`State ${i + 1} (${s.op}, ${s.txid.slice(0, 12)}): user signature ${s.userSignatureValid ? 'verifies' : 'FAILS'}; linkage ${s.linkageValid ? 'holds' : 'FAILS'}; inclusion ${s.spv}.`)
}
console.log(`The chain as a whole is ${result.valid ? 'valid' : 'INVALID'}${result.error ? `: ${result.error}` : ''}.`)
console.log(`Inclusion across the chain: ${result.spv}${result.spv === 'pending' ? ' (a proof the verifier could not evaluate is evidence of nothing, never a failure)' : ''}.`)
process.exit(result.valid ? 0 : 1)
