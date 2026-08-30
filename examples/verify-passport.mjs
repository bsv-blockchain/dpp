#!/usr/bin/env node
/**
 * Check a passport the way the standard says a stranger can: from transaction
 * bytes and public block headers, with no account and no operator's word.
 *
 *   node examples/verify-passport.mjs <passportId> [indexUrl]
 *   node examples/verify-passport.mjs --fixture
 *   node examples/verify-passport.mjs --fixture --owner-consent [--authorities=<hex,hex>]
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
 * With --owner-consent, it also runs the optional owner-signed transfer of
 * spec/custody.md section 4, as a verifier configured for a profile that
 * selects it would: every TRANSFER must prove its actor is the previous owner,
 * by equality or by owner_linkage, unless a transfer authority named with
 * --authorities made it. In fixture mode the flag also runs the fixture's
 * consent refusals, each under the option it names, and shows each accepted
 * again with the option off, which is the control that keeps the rule honest.
 * A check that is not run gets no sentence: without the flag, consent is not
 * mentioned.
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
const consentFlag = args.includes('--owner-consent')
const authorities = args
  .filter((a) => a.startsWith('--authorities='))
  .flatMap((a) => a.slice('--authorities='.length).split(','))
  .map((k) => k.trim())
  .filter((k) => k !== '')
const ownerConsent = consentFlag ? (authorities.length > 0 ? { authorities } : true) : undefined
const passportId = args.find((a) => !a.startsWith('--'))
const indexUrl = (args.filter((a) => !a.startsWith('--'))[1] ?? 'https://dpp-overlay.bsvb.net').replace(/\/+$/, '')

if (!fixtureMode && passportId == null) {
  console.error('usage: verify-passport.mjs <passportId> [indexUrl] | --fixture')
  process.exit(2)
}

let chain
let tracker
let fixture
if (fixtureMode) {
  fixture = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'chain-v1.json'), 'utf8'))
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

if (consentFlag) {
  console.log(`The owner-signed transfer is selected${authorities.length > 0 ? `, with ${authorities.length} transfer authorit${authorities.length === 1 ? 'y' : 'ies'}` : ', with no transfer authorities'}.`)
}

const result = await verifyChain(chain, { chainTracker: tracker, ownerConsent })

const consentSentence = (s) =>
  s.ownerConsentValid == null ? 'not applicable (not a TRANSFER)' : s.ownerConsentValid ? 'holds' : 'FAILS'
for (const [i, s] of result.states.entries()) {
  console.log(`State ${i + 1} (${s.op}, ${s.txid.slice(0, 12)}): user signature ${s.userSignatureValid ? 'verifies' : 'FAILS'}; linkage ${s.linkageValid ? 'holds' : 'FAILS'}; inclusion ${s.spv}${consentFlag ? `; owner consent ${consentSentence(s)}` : ''}.`)
}
console.log(`The chain as a whole is ${result.valid ? 'valid' : 'INVALID'}${result.error ? `: ${result.error}` : ''}.`)
console.log(`Inclusion across the chain: ${result.spv}${result.spv === 'pending' ? ' (a proof the verifier could not evaluate is evidence of nothing, never a failure)' : ''}.`)

// The fixture's consent refusals, each under the option it names, and the
// control: the same bytes accepted with the option off, and, where the fixture
// says so, accepted again with the named transfer authorities.
let failures = 0
if (fixtureMode && consentFlag) {
  const say = (ok, sentence) => {
    if (!ok) failures += 1
    console.log(`${ok ? 'ok' : 'FAIL'}: ${sentence}`)
  }
  const refusals = fixture.refusals.filter((r) => r.ownerConsent != null)
  console.log(`Consent refusals in the fixture: ${refusals.length}.`)
  for (const r of refusals) {
    const prefix = fixture.states.slice(0, r.appendAfter + 1).map((s) => Transaction.fromHex(s.rawTx))
    const attempt = [...prefix, Transaction.fromHex(r.rawTx)]
    const refused = await verifyChain(attempt, { chainTracker: 'scripts only', ownerConsent: r.ownerConsent })
    say(!refused.valid && (refused.error ?? '').includes(r.error), `the verifier refuses ${r.name} under owner consent: ${r.error}.`)
    const without = await verifyChain(attempt, { chainTracker: 'scripts only' })
    say(without.valid, `and accepts the same bytes with the option off, as the record model alone requires.`)
    if (r.acceptedUnder != null) {
      const under = await verifyChain(attempt, { chainTracker: 'scripts only', ownerConsent: r.acceptedUnder })
      say(under.valid, `and admits it with ${r.acceptedUnder.authorities.map((k) => k.slice(0, 12) + '...').join(', ')} as a transfer authority: a recovery, visibly.`)
    }
  }
}
process.exit(result.valid && failures === 0 ? 0 : 1)
