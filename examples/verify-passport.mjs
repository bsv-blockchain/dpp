#!/usr/bin/env node
/**
 * Check a passport the way the standard says a stranger can: from transaction
 * bytes and public block headers, with no account and no operator's word.
 *
 *   node examples/verify-passport.mjs <passportId> [indexUrl] [--report]
 *   node examples/verify-passport.mjs 01/<gtin>/21/<serial> [indexUrl] [--report]
 *   node examples/verify-passport.mjs --fixture
 *   node examples/verify-passport.mjs --fixture --owner-consent [--authorities=<hex,hex>]
 *   node examples/verify-passport.mjs --fixture --report
 *   node examples/verify-passport.mjs --fixture --version=2 [--report]
 *   node examples/verify-passport.mjs --fixture --version=3 [--report]
 *
 * With a passport identifier, the script asks an index (default: the
 * demonstration deployment) for the record's outputs, rebuilds the chain from
 * the BEEFs the index returns, merged into one, and verifies it: every user signature, every
 * link, every merkle proof against WhatsOnChain's headers. The index is only
 * used to find the bytes; nothing it says is trusted, which is the point.
 *
 * A bare `01/<gtin>/21/<serial>` (or the key tuple `01:<gtin>|21:<serial>`) is
 * a GS1 key, not a passport identifier: two hosts can each issue a passport
 * for it. The index is asked by key, every passport it holds for that key is
 * named under its exact identifier, and when there is exactly one it is
 * verified, with its host marked as taken from the index's answer.
 * WhatsOnChain answers an anonymous caller 429 past a few requests a second,
 * so headers are asked one at a time, a little apart, and each answer is kept
 * for the rest of the run, and WOC_API_KEY, when set, is sent as the key.
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
 * With --report, the same evidence is reported under the one verification
 * contract of spec/verification.md: sixteen named checks, four answers each,
 * the subject the caller asked about, and an observation of the latest state
 * that is never a proof. Live, the report is printed for the chain the index
 * returned, with the identifier the caller typed as the independently expected
 * subject. In fixture mode the script is the standalone surface of the
 * contract's equivalence test: it rebuilds every case of
 * fixtures/evidence-v1.json from its hex, produces its own report, and compares
 * it to the pinned one, one sentence per case.
 *
 * With --version=2 in fixture mode, the same is done for record version 2
 * (spec/record-model-v2.md): fixtures/chain-v2.json is verified under the
 * managed-custody profile with the custodian as publisher, every one of its
 * refusals is shown refused for the pinned reason under the option it names
 * (and accepted again with the profile off, or under the named control
 * authorities, where the fixture says so), the upgrade of the version 1
 * fixture chain is verified and its refusals refused, and --report compares
 * every case of fixtures/evidence-v2.json. Live, the reader is version-aware
 * by itself: a lineage of either version, or one that was upgraded, verifies
 * under the same call, and the flag changes nothing.
 *
 * With --version=3 in fixture mode, the same is done for the token carrier
 * (spec/token-carrier.md): fixtures/chain-v3.json, a lineage carried as a
 * BRC-162 token of one unit, is verified under the custodian's publisher key,
 * every one of its refusals is shown refused for the pinned reason, the burn
 * is shown to be no state, and --report compares every case of
 * fixtures/evidence-v3.json. Live, a carried lineage verifies under the same
 * call as any other; the reader finds the prefix by itself.
 *
 * Results print one sentence per check, never a score, as GOVERNANCE.md
 * requires of every conformance surface.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Beef, LockingScript, MerklePath, Transaction, WhatsOnChain } from '@bsv/sdk'
import { EVIDENCE_CHECK_LABELS, chainFromBeef, findDppOutputs, verifyChain, verifyPassportEvidence } from '@bsv/dpp-core'

// One question at a time, a little apart, each answer kept for the run: the
// chain check and the report ask about the same blocks, and questions asked
// as fast as they come are what the rate limit refuses. The same tracker as
// docs/packages/build-an-application.md step 1.
function pacedTracker(inner, gapMs = 400) {
  const answers = new Map()
  let queue = Promise.resolve()
  const ask = (key, question) => {
    if (!answers.has(key)) {
      const answer = queue.then(() => new Promise((wait) => setTimeout(wait, gapMs))).then(question)
      queue = answer.catch(() => {})
      answers.set(key, answer.catch((error) => { answers.delete(key); throw error }))
    }
    return answers.get(key)
  }
  return {
    isValidRootForHeight: (root, height) => ask(`${height}:${root}`, () => inner.isValidRootForHeight(root, height)),
    currentHeight: () => ask('height', () => inner.currentHeight()),
  }
}

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const fixtureMode = args.includes('--fixture')
const consentFlag = args.includes('--owner-consent')
const reportFlag = args.includes('--report')
const versionFlag = args.find((a) => a.startsWith('--version='))?.slice('--version='.length) ?? '1'
if (versionFlag !== '1' && versionFlag !== '2' && versionFlag !== '3') {
  console.error('usage: --version=1 (default), --version=2 or --version=3')
  process.exit(2)
}
const versionTwo = versionFlag === '2'
// Version 3 is the token carrier (spec/token-carrier.md): fixtures/chain-v3.json is a
// carried lineage published by the custodian, verified under the custodian's key.
const versionThree = versionFlag === '3'
const authorities = args
  .filter((a) => a.startsWith('--authorities='))
  .flatMap((a) => a.slice('--authorities='.length).split(','))
  .map((k) => k.trim())
  .filter((k) => k !== '')
const ownerConsent = consentFlag ? (authorities.length > 0 ? { authorities } : true) : undefined
let passportId = args.find((a) => !a.startsWith('--'))
const indexUrl = (args.filter((a) => !a.startsWith('--'))[1] ?? 'https://dpp-overlay.bsvb.net').replace(/\/+$/, '')

if (!fixtureMode && passportId == null) {
  console.error('usage: verify-passport.mjs <passportId> [indexUrl] [--report] | --fixture [--owner-consent] [--report]')
  process.exit(2)
}

let failures = 0
const say = (ok, sentence) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok' : 'FAIL'}: ${sentence}`)
}

/** One sentence per check, the label first and the technical name behind it. */
function printReport(report) {
  console.log(`Report version ${report.reportVersion}, checked at ${report.checkedAt}, policy ${report.policyId}, subject ${report.expectedSubject.passportId} (${report.expectedSubject.source}).`)
  for (const c of report.checks) {
    const reason = c.reasonCode == null ? '' : ` (${c.reasonCode})`
    console.log(`  ${EVIDENCE_CHECK_LABELS[c.name]}: ${c.status}${reason} [${c.name}]`)
  }
  console.log(`Latest state as observed: ${report.observations.latestState}; ${report.observations.queryScope}.`)
  for (const l of report.limits) console.log(`  limit: ${l}`)
}

/** Rebuild one fixture case's evidence and policy from its declared hex and stand-ins. */
function materialise(c) {
  const history = (c.evidence.tokenHistory ?? []).map((hex, i) => {
    const tx = Transaction.fromHex(hex)
    const path = c.evidence.merklePaths?.[i]
    if (path != null) tx.merklePath = MerklePath.fromHex(path)
    return tx
  })
  const evidence = {
    ...(c.evidence.tokenHistory == null ? {} : { tokenHistory: history }),
    ...(c.evidence.alternativeHistories == null ? {} : { alternativeHistories: c.evidence.alternativeHistories.map((h) => h.map((hex) => Transaction.fromHex(hex))) }),
    ...(c.evidence.nativeClaims == null ? {} : { nativeClaims: c.evidence.nativeClaims }),
    ...(c.evidence.acceptanceRecords == null ? {} : { acceptanceRecords: c.evidence.acceptanceRecords }),
    ...(c.evidence.anchors == null ? {} : { anchors: c.evidence.anchors.map((a) => ({ ...a, lockingScript: LockingScript.fromHex(a.lockingScript) })) }),
  }
  let chainTracker = 'scripts only'
  if (c.policy.chainTracker === 'header-source') {
    if (c.policy.headerSource === 'unavailable') {
      chainTracker = { isValidRootForHeight: async () => { throw new Error('header source unavailable') }, currentHeight: async () => 0 }
    } else {
      const roots = c.policy.headerSource ?? {}
      chainTracker = { isValidRootForHeight: async (root, height) => roots[String(height)] === root, currentHeight: async () => 999999 }
    }
  }
  const observers = (c.observers ?? []).map((o) => ({
    id: o.id,
    kind: o.kind,
    observe: async () => ({ result: o.result, ...(o.spendingTxid == null ? {} : { spendingTxid: o.spendingTxid }) }),
  }))
  const policy = {
    checkedAt: FIXTURE_CHECKED_AT,
    chainTracker,
    ...(c.policy.policyId == null ? {} : { policyId: c.policy.policyId }),
    ...(c.policy.publisherKeys == null ? {} : { publisherKeys: c.policy.publisherKeys }),
    ...(c.policy.ownerConsent == null ? {} : { ownerConsent: c.policy.ownerConsent }),
    ...(c.policy.controlAuthorities == null ? {} : { controlAuthorities: c.policy.controlAuthorities }),
    ...(c.policy.managedAcceptance == null ? {} : { managedAcceptance: c.policy.managedAcceptance }),
    ...(c.policy.authority == null ? {} : { authority: c.policy.authority }),
    ...(observers.length === 0 ? {} : { observers }),
  }
  return { evidence, policy }
}
let FIXTURE_CHECKED_AT

let chain
let tracker
let fixture
/** True when the identifier came from the index's answer to a GS1 key, not from the caller. */
let resolvedFromKey = false
if (fixtureMode) {
  fixture = JSON.parse(readFileSync(join(here, '..', 'fixtures', versionThree ? 'chain-v3.json' : versionTwo ? 'chain-v2.json' : 'chain-v1.json'), 'utf8'))
  chain = fixture.states.map((s) => Transaction.fromHex(s.rawTx))
  tracker = 'scripts only'
  console.log(`Fixture chain (record version ${versionFlag}): ${chain.length} states, verified from raw transaction hex, no header source.`)
} else {
  const lookup = async (query) => {
    const response = await fetch(`${indexUrl}/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'ls_dpp', query }),
    })
    if (!response.ok) {
      console.error(`The index answered HTTP ${response.status}${query.gs1Key != null ? '; an index on an earlier release does not look passports up by GS1 key' : ''}.`)
      process.exit(1)
    }
    return await response.json()
  }
  if (!/^https?:\/\//.test(passportId)) {
    // A GS1 key: find every passport the index holds for it, by exact identifier.
    const found = new Map()
    for (const output of (await lookup({ gs1Key: passportId })).outputs) {
      const id = findDppOutputs(Transaction.fromBEEF(output.beef))[0]?.state.passportId
      if (id != null) found.set(id, (found.get(id) ?? 0) + 1)
    }
    if (found.size === 0) {
      console.log(`The index holds no passport for the GS1 key ${passportId}. That says nothing about whether one exists.`)
      process.exit(1)
    }
    console.log(`${passportId} is a GS1 key, not a passport identifier. The index holds ${found.size} passport${found.size === 1 ? '' : 's'} for it:`)
    for (const [id, states] of found) console.log(`  ${id} (${states} state${states === 1 ? '' : 's'})`)
    if (found.size > 1) {
      console.log('Verify each by its full identifier, and choose by the host you trust.')
      process.exit(0)
    }
    passportId = [...found.keys()][0]
    resolvedFromKey = true
    console.log(`Verifying ${passportId}. Its host came from the index's answer, not from you: check it is a host you trust.`)
  }
  const answer = await lookup({ passportId })
  if (answer.outputs.length === 0) {
    console.log('The index knows no record with that identifier. That says nothing about whether one exists.')
    process.exit(1)
  }
  // Every retained state comes back as its own BEEF, and how much each one
  // carries depends on how it reached the index: a state announced with its
  // ancestors carries them, a state a peer synchronised or an operator
  // restored from a package is compact and carries its own proof alone.
  // Merged, they are one BEEF holding the whole lineage whichever way each
  // state arrived, which is the one BEEF this check takes (spec/record-model.md
  // section 8); reading the largest alone worked only on an index that had
  // been announced to directly.
  const merged = answer.outputs.slice(1).reduce((all, output) => {
    all.mergeBeef(output.beef)
    return all
  }, Beef.fromBinary(answer.outputs[0].beef))
  chain = chainFromBeef(merged, passportId)
  tracker = pacedTracker(new WhatsOnChain('main', process.env.WOC_API_KEY ? { apiKey: process.env.WOC_API_KEY } : {}))
  console.log(`The index returned ${answer.outputs.length} outputs; merged, their BEEFs reconstruct a chain of ${chain.length} states.`)
}

const ops = chain.map((tx) => findDppOutputs(tx)[0].state.op)
console.log(`Operations, genesis to tip: ${ops.join(' -> ')}.`)

if (consentFlag) {
  console.log(`The owner-signed transfer is selected${authorities.length > 0 ? `, with ${authorities.length} transfer authorit${authorities.length === 1 ? 'y' : 'ies'}` : ', with no transfer authorities'}.`)
}

// The version 2 fixture is a managed-custody lineage published by the custodian, so it is
// verified as a verifier configured for that profile and publisher would (spec/managed-custody.md §5).
const versionTwoOptions = fixtureMode && versionTwo ? { managedAcceptance: true, serverIdentityKey: fixture.custodianKey } : {}
if (fixtureMode && versionTwo) console.log('The managed-custody profile is selected, with the custodian as the publisher and no control authorities.')
const versionThreeOptions = fixtureMode && versionThree ? { serverIdentityKey: fixture.custodianKey } : {}
if (fixtureMode && versionThree) console.log(`The lineage is carried as a token of one unit; its token id is ${fixture.tokenId}. The custodian is the publisher and no control authorities are named.`)
const result = await verifyChain(chain, { chainTracker: tracker, ownerConsent, ...versionTwoOptions, ...versionThreeOptions })

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
if (fixtureMode && consentFlag) {
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

// The version 2 fixture's refusals, each under the option it names, with the control
// that the profile's rule accepts the same bytes with the profile off and that a named
// authority is admitted; then the upgrade of the version 1 chain and its refusals.
if (fixtureMode && versionTwo) {
  console.log(`Version 2 refusals in the fixture: ${fixture.refusals.length}.`)
  for (const r of fixture.refusals) {
    const prefix = fixture.states.slice(0, r.appendAfter + 1).map((s) => Transaction.fromHex(s.rawTx))
    const attempt = [...prefix, Transaction.fromHex(r.rawTx)]
    const refused = await verifyChain(attempt, { chainTracker: 'scripts only', managedAcceptance: r.managedAcceptance === true })
    say(!refused.valid && (refused.error ?? '').includes(r.error), `the verifier refuses ${r.name}: ${r.error}.`)
    if (r.managedAcceptance) {
      const without = await verifyChain(attempt, { chainTracker: 'scripts only' })
      say(without.valid, 'and accepts the same bytes with the managed-custody profile off, as the record model alone requires.')
    }
    if (r.acceptedUnder != null) {
      const under = await verifyChain(attempt, { chainTracker: 'scripts only', controlAuthorities: r.acceptedUnder.authorities })
      say(under.valid, `and admits it with ${r.acceptedUnder.authorities.map((k) => k.slice(0, 12) + '...').join(', ')} as a control authority: a recovery, visibly.`)
    }
  }
  const v1 = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'chain-v1.json'), 'utf8'))
  const v1Chain = v1.states.map((s) => Transaction.fromHex(s.rawTx))
  const upgraded = await verifyChain([...v1Chain, Transaction.fromHex(fixture.upgrade.rawTx)], { chainTracker: 'scripts only', serverIdentityKey: v1.serverKey })
  say(upgraded.valid, `the six version 1 states followed by the version 2 UPDATE verify as one lineage under the version 1 publisher key: ${upgraded.states.map((s) => s.op).join(' -> ')}.`)
  for (const r of fixture.upgrade.refusals) {
    const refused = await verifyChain([...v1Chain, Transaction.fromHex(r.rawTx)], { chainTracker: 'scripts only' })
    say(!refused.valid && (refused.error ?? '').includes(r.error), `the verifier refuses upgrade ${r.name}: ${r.error}.`)
  }
}

// The version 3 fixture's refusals, the carrier's own rules among them, each from raw
// hex alone; then the burn, the tip spent with no carrier output, which is no state at all.
if (fixtureMode && versionThree) {
  console.log(`Version 3 refusals in the fixture: ${fixture.refusals.length}.`)
  for (const r of fixture.refusals) {
    const prefix = fixture.states.slice(0, r.appendAfter + 1).map((s) => Transaction.fromHex(s.rawTx))
    const refused = await verifyChain([...prefix, Transaction.fromHex(r.rawTx)], { chainTracker: 'scripts only' })
    say(!refused.valid && (refused.error ?? '').includes(r.error), `the verifier refuses ${r.name}: ${r.error}${r.brc162Accepts ? ' (a generic reader of the token protocol accepts this output; the rule is the carrier\'s own)' : ''}.`)
  }
  const burnPrefix = fixture.states.slice(0, fixture.burn.appendAfter + 1).map((s) => Transaction.fromHex(s.rawTx))
  const burned = await verifyChain([...burnPrefix, Transaction.fromHex(fixture.burn.rawTx)], { chainTracker: 'scripts only' })
  say(!burned.valid && (burned.error ?? '').includes(fixture.burn.error), `the burn is no state: ${fixture.burn.error}; the lineage ended without a RETIRE.`)
}

// The one verification contract. Live: the report for what the index returned,
// with the typed identifier as the independently expected subject. Fixture: the
// standalone surface of the equivalence test over fixtures/evidence-v1.json.
if (reportFlag && !fixtureMode) {
  const report = await verifyPassportEvidence(
    { tokenHistory: chain },
    { passportId, source: resolvedFromKey ? 'none' : 'request-context' },
    { chainTracker: tracker, ownerConsent }
  )
  printReport(report)
}
if (reportFlag && fixtureMode) {
  const cases = JSON.parse(readFileSync(join(here, '..', 'fixtures', versionThree ? 'evidence-v3.json' : versionTwo ? 'evidence-v2.json' : 'evidence-v1.json'), 'utf8'))
  FIXTURE_CHECKED_AT = cases.checkedAt
  console.log(`Report cases in the fixture: ${cases.cases.length}, checked at ${cases.checkedAt}.`)
  for (const c of cases.cases) {
    const { evidence, policy } = materialise(c)
    const report = await verifyPassportEvidence(evidence, c.expectedSubject, policy)
    const same = JSON.stringify(report) === JSON.stringify(c.report)
    const summary = c.report.checks.map((k) => `${k.name} ${k.status}`).filter((_, i) => c.report.checks[i].status !== 'unknown').join(', ')
    say(same, `${c.id}: this verifier's report is the pinned one (${summary || 'nothing established'}; latest state ${c.report.observations.latestState}).`)
    if (!same) {
      for (const [i, k] of report.checks.entries()) {
        const pinned = c.report.checks[i]
        if (JSON.stringify(k) !== JSON.stringify(pinned)) console.log(`      ${k.name}: got ${k.status} ${k.reasonCode ?? ''}, pinned ${pinned.status} ${pinned.reasonCode ?? ''}`)
      }
    }
  }
}
process.exit(result.valid && failures === 0 ? 0 : 1)
