#!/usr/bin/env node
/**
 * Check the claims a registry holds against the chain, without trusting the
 * registry: what docs/implement/roles/attestation-verifier.md calls running an
 * anchor proof page.
 *
 *   node examples/check-registry.mjs --fixture                        # offline: the repository's own test data
 *   node examples/check-registry.mjs https://dpp-resolver.bsvb.net    # a live registry, its first 10 records
 *   node examples/check-registry.mjs <registry> --subject=<passportId> --limit=50 --anchoring-services=<key>,<key>
 *
 * For every record it prints one line per check, each pass, fail, unknown or
 * not-applicable, and never an overall verdict:
 *
 *   1. digest             the stored bytes hash to the digest the registry states
 *   2. claim signature    the claim's own signature verifies
 *   3. anchor             the anchor output, read from the chain, decodes and its signature verifies
 *   4. binding            the anchor commits to this digest and names this claim
 *   5. inclusion          the anchor transaction's merkle path matches a block header
 *   6. anchoring service  the key that wrote the anchor is one you accept, or else one the
 *                         registry's capability document names (anchoredBy in the registry
 *                         contract's document, publisherPolicy.anchoringServices in the schema's)
 *
 * The registry hands over the stored bytes and says which transaction holds
 * the anchor. Everything else comes from the chain: the transaction
 * (/tx/<txid>/hex) and its merkle proof as a BUMP (/tx/<txid>/proof/bump)
 * from WhatsOnChain (set WOC_API_KEY to raise its rate limit), checked against
 * block headers. A registry may send the BUMP itself as anchor.merklePath;
 * the example then checks that one against the headers first, so it trusts
 * the headers and not the registry. The exit code is 1 when any check fails.
 */
import { readFileSync } from 'node:fs'
import { Hash, LockingScript, MerklePath, PushDrop, Signature, Transaction, Utils, WhatsOnChain } from '@bsv/sdk'
import { inspectAttestationAnchor, verifyLifecycleClaim } from '@bsv/dpp-protocol'
import { tryParseUoraAnchor } from '@bsv/dpp-overlay-topics'

const args = process.argv.slice(2)
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const fixtureMode = args.includes('--fixture')
const registryUrl = (args.find((a) => !a.startsWith('--')) ?? 'https://dpp-resolver.bsvb.net').replace(/\/$/, '')
const subject = option('subject')
const limit = Number(option('limit') ?? 10)
const short = (hex) => `${String(hex).slice(0, 12)}...`

// ------------------------------------------------------------- the sources

/** The registry's routes (contracts/registry.yaml): the record list, one record's proof, and its capability document. */
function liveRegistry(base) {
  const get = async (path) => {
    const response = await fetch(`${base}${path}`)
    if (!response.ok) throw new Error(`${base}${path} answered HTTP ${response.status}`)
    return response.json()
  }
  return {
    async records() {
      const records = []
      let cursor
      do {
        const query = new URLSearchParams({ limit: String(Math.min(limit, 500)) })
        if (subject != null) query.set('subject', subject)
        if (cursor != null) query.set('cursor', cursor)
        const page = await get(`/attestations?${query}`)
        records.push(...page.items)
        cursor = page.nextCursor
      } while (cursor != null && records.length < limit)
      return records.slice(0, limit)
    },
    proof: (attestationId) => get(`/attestations/${encodeURIComponent(attestationId)}/proof`),
    capabilities: () => get('/capabilities').catch(() => ({})),
  }
}

/** The chain, through WhatsOnChain: transactions, merkle proofs and block headers, one request at a time. */
function liveChain() {
  const woc = 'https://api.whatsonchain.com/v1/bsv/main'
  const apiKey = process.env.WOC_API_KEY
  let queue = Promise.resolve()
  const pause = (ms) => new Promise((wait) => setTimeout(wait, ms))
  // Anonymous use allows a few requests a second, so each waits for the last,
  // and a refused one is asked once more after a longer pause.
  const paced = (ask) => {
    const answer = queue.then(() => pause(350)).then(ask).catch(() => pause(2000).then(ask))
    queue = answer.catch(() => {})
    return answer
  }
  const get = (path, read) => paced(async () => {
    const response = await fetch(`${woc}${path}`, { headers: apiKey ? { Authorization: apiKey } : {} })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`WhatsOnChain ${path} answered HTTP ${response.status}`)
    return read(response)
  })
  const headers = new WhatsOnChain('main', apiKey ? { apiKey } : {})
  return {
    async transaction(txid) {
      const hex = await get(`/tx/${txid}/hex`, (r) => r.text())
      return hex == null ? null : Transaction.fromHex(hex)
    },
    // The merkle proof as a BUMP (BRC-74), which the SDK reads as it is; an
    // unmined transaction has none yet.
    async merklePath(txid) {
      const bump = await get(`/tx/${txid}/proof/bump`, (r) => r.text())
      try {
        return bump == null || bump.trim() === '' ? null : MerklePath.fromHex(bump.trim())
      } catch {
        return null
      }
    },
    headers: {
      isValidRootForHeight: (root, height) => paced(() => headers.isValidRootForHeight(root, height)),
      currentHeight: () => paced(() => headers.currentHeight()),
    },
  }
}

/**
 * --fixture: a registry and a chain made from the repository's own test data,
 * a native claim (fixtures/attestation-anchor-v1.json) and a legacy UORA claim
 * (fixtures/anchor-v3.json). Each anchor sits alone in a made-up transaction
 * with a made-up merkle path whose root only the stand-in headers know.
 */
function fixtureSources() {
  const read = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'))
  const native = read('attestation-anchor-v1.json')
  const legacy = read('anchor-v3.json')
  const transactions = new Map()
  const paths = new Map()
  const roots = new Map()
  const anchorTransaction = (lockingScript, height) => {
    const tx = new Transaction()
    tx.addOutput({ satoshis: 1, lockingScript: LockingScript.fromHex(lockingScript) })
    const txid = tx.id('hex')
    const path = new MerklePath(height, [[{ offset: 0, hash: 'ab'.repeat(32) }, { offset: 1, hash: txid, txid: true }]])
    transactions.set(txid, tx)
    paths.set(txid, path)
    roots.set(height, path.computeRoot(txid))
    return txid
  }
  const nativeTxid = anchorTransaction(native.lockingScript, 900000)
  const proofs = new Map([
    [native.anchor.attestationId, {
      attestationId: native.anchor.attestationId,
      representation: 'dpp-lifecycle-json-v1',
      securedBytes: native.representationBytes,
      digest: native.digest,
      // This record's registry sends the merkle path with the anchor, as the contract allows; the legacy one below does not.
      anchor: { recordId: nativeTxid, outputIndex: 0, format: 'bsv-attestation-anchor-v1', blockHeight: 900000, merklePath: paths.get(nativeTxid).toHex() },
    }],
    [legacy.attestationId, {
      attestationId: legacy.attestationId,
      representation: 'legacy-uora-json',
      attestation: legacy.attestation,
      canonical: legacy.canonical,
      digest: legacy.digest,
      anchor: { recordId: anchorTransaction(legacy.lockingScript, 900001), outputIndex: 0, format: 'uora-anchor-v3' },
    }],
  ])
  return {
    registry: {
      records: async () => [...proofs.values()].map(({ attestationId, representation }) => ({ attestationId, representation })),
      proof: async (attestationId) => proofs.get(attestationId),
      // The test registry names its anchoring key, as a registry under the contract may.
      capabilities: async () => ({ anchoredBy: native.anchor.anchoredBy }),
    },
    chain: {
      transaction: async (txid) => transactions.get(txid) ?? null,
      merklePath: async (txid) => paths.get(txid) ?? null,
      headers: { isValidRootForHeight: async (root, height) => roots.get(height) === root, currentHeight: async () => 900100 },
    },
  }
}

// ------------------------------------------------------- reading an anchor

/**
 * The anchor output, decoded under the format its first field names. Each
 * format says different things: a bsv-attestation-anchor-v1 or uora-anchor-v3
 * output names its anchoring service and locks to a key derived from it; a
 * uora-anchor-v1 output names neither issuer nor service and is signed by a
 * key nobody else can reproduce (spec/legacy-uora-anchor-v3.md section 5).
 */
function readAnchor(script) {
  const prefix = script.chunks[2]?.data == null ? '' : Utils.toUTF8(script.chunks[2].data)
  if (prefix === 'bsv-attestation-anchor-v1') {
    const inspected = inspectAttestationAnchor(script)
    const m = inspected.metadata
    return {
      format: prefix,
      verified: inspected.signatureValid === true && inspected.keyDerivationValid === true,
      digest: m?.digest, attestationId: m?.attestationId, issuer: m?.issuer, subject: m?.subject, type: m?.attestationType, anchoredBy: m?.anchoredBy,
    }
  }
  if (prefix === 'uora-anchor-v3') {
    const parsed = tryParseUoraAnchor(script)
    return { format: prefix, verified: parsed != null, digest: parsed?.digest, attestationId: parsed?.attestationId, issuer: parsed?.issuer, subject: parsed?.subject, type: parsed?.uoraType, anchoredBy: parsed?.anchoredBy }
  }
  if (prefix === 'uora-anchor-v1') {
    const { lockingPublicKey, fields } = PushDrop.decode(script)
    let verified = false
    try {
      verified = fields.length === 4 && lockingPublicKey.verify(fields.slice(0, 3).flat(), Signature.fromDER(fields[3]))
    } catch {
      verified = false
    }
    return { format: prefix, verified, digest: Utils.toUTF8(fields[1] ?? []), attestationId: Utils.toUTF8(fields[2] ?? []) }
  }
  return { format: prefix === '' ? 'an unknown layout' : prefix }
}

// ------------------------------------------------------- checking a record

async function checkRecord(record, { registry, chain, accepted, registryKeys }) {
  const lines = []
  const say = (status, check, sentence) => lines.push({ status, check, sentence })
  const proof = await registry.proof(record.attestationId)

  // 1. The stored bytes hash to the digest the registry states. A current
  // record stores securedBytes; a legacy UORA record stores canonical.
  const stored = proof.securedBytes ?? proof.canonical
  if (stored == null) {
    say('unknown', 'digest', 'the registry served no stored bytes for this record')
  } else {
    const digest = Utils.toHex(Hash.sha256(Utils.toArray(stored, 'utf8')))
    say(digest === proof.digest ? 'pass' : 'fail', 'digest',
      digest === proof.digest ? `the stored bytes hash to ${short(digest)}, the digest the registry states` : `the stored bytes hash to ${short(digest)}, not the ${short(proof.digest)} the registry states`)
  }

  // 2. The claim's own signature. A native claim is checked with
  // verifyLifecycleClaim; a SEAL credential needs @bsv/vsc.
  let claim = proof.attestation
  if (proof.representation === 'dpp-lifecycle-json-v1') {
    claim = JSON.parse(proof.securedBytes)
    const result = verifyLifecycleClaim(claim)
    say(result.signature === 'verified' ? 'pass' : 'fail', 'claim signature',
      result.signature === 'verified' ? `the native claim's signature verifies under its issuer ${short(claim.issuer)}` : `the native claim's signature does not verify: ${result.reason}`)
  } else if (proof.representation === 'legacy-uora-json') {
    say('unknown', 'claim signature', 'not checked here: this example checks a legacy UORA record by its digest and its anchor')
  } else {
    say('unknown', 'claim signature', `not checked here: ${proof.representation} needs its own verifier, such as @bsv/vsc for a SEAL credential`)
  }
  if (subject != null) {
    say(claim?.passportId === subject ? 'pass' : 'fail', 'subject', `the claim names ${claim?.passportId}${claim?.passportId === subject ? ', the passport asked about' : `, not ${subject}`}`)
  }

  // 3. The anchor output, read from the chain rather than from the registry.
  const txid = proof.anchor?.recordId
  if (txid == null) {
    say('unknown', 'anchor', 'the registry names no anchor transaction for this record')
    return lines
  }
  const outputIndex = proof.anchor.outputIndex ?? 0
  const output = (await chain.transaction(txid))?.outputs[outputIndex]
  if (output == null) {
    say('unknown', 'anchor', `the chain source has no output ${short(txid)}:${outputIndex}`)
    return lines
  }
  if (proof.anchor.lockingScript != null && proof.anchor.lockingScript !== output.lockingScript.toHex()) {
    say('fail', 'anchor', "the registry's copy of the anchor script differs from the output on chain")
  }
  const anchor = readAnchor(output.lockingScript)
  if (anchor.verified == null) {
    say('unknown', 'anchor', `the output ${short(txid)}:${outputIndex} is ${anchor.format}, which this example does not read`)
  } else if (anchor.format === 'uora-anchor-v1') {
    say(anchor.verified ? 'pass' : 'fail', 'anchor',
      `the uora-anchor-v1 output ${anchor.verified ? 'is' : 'is not'} signed by its own locking key; whose key that is cannot be established from the output`)
  } else {
    say(anchor.verified ? 'pass' : 'fail', 'anchor',
      `the ${anchor.format} output's signature and derived locking key ${anchor.verified ? 'verify' : 'do not verify'}`)
  }

  // 4. The anchor commits to this digest and names this claim. The names are
  // compared for a native claim and a uora-anchor-v3 subject; a v1 anchor
  // carries none, and other representations name them in their own fields.
  if (anchor.digest != null) {
    const problems = []
    const named = proof.representation === 'dpp-lifecycle-json-v1' || anchor.format === 'uora-anchor-v3'
    if (anchor.digest !== proof.digest) problems.push(`it commits to ${short(anchor.digest)}`)
    if (anchor.format === 'bsv-attestation-anchor-v1' && proof.representation === 'dpp-lifecycle-json-v1') {
      if (anchor.attestationId !== proof.attestationId) problems.push(`it names attestation ${anchor.attestationId}`)
      if (anchor.issuer !== claim.issuer) problems.push(`it names issuer ${anchor.issuer}`)
      if (anchor.subject !== claim.passportId) problems.push(`it names subject ${anchor.subject}`)
      if (anchor.type !== claim.eventType) problems.push(`it names type ${anchor.type}`)
    }
    if (anchor.format === 'uora-anchor-v3' && anchor.subject !== claim?.passportId) problems.push(`it names subject ${anchor.subject}`)
    say(problems.length === 0 ? 'pass' : 'fail', 'binding',
      problems.length === 0 ? `the anchor commits to this digest${named ? ' and names this claim' : ''}` : problems.join('; '))
  }

  // 5. The anchor transaction is in a block: its merkle path matches that
  // block's header. A registry may send the path with the anchor
  // (anchor.merklePath, a BUMP); only the header decides, so a path the
  // registry sends that does not match is set aside and the chain source asked.
  const sent = proof.anchor?.merklePath
  let fromRegistry = false
  if (typeof sent === 'string' && /^[0-9a-f]+$/.test(sent)) {
    try {
      const path = MerklePath.fromHex(sent)
      if (await path.verify(txid, chain.headers)) {
        fromRegistry = true
        say('pass', 'inclusion', `the anchor transaction's merkle path, as the registry sent it, matches the header of block ${path.blockHeight}`)
      }
    } catch {
      // Not a path for this transaction, or the header source did not answer: ask the chain source below.
    }
  }
  if (!fromRegistry) {
    const path = await chain.merklePath(txid)
    if (path == null) {
      say('unknown', 'inclusion', 'the chain source has no merkle path for the anchor transaction yet')
    } else {
      try {
        const included = await path.verify(txid, chain.headers)
        say(included ? 'pass' : 'fail', 'inclusion',
          `the anchor transaction's merkle path ${included ? 'matches' : 'does not match'} the header of block ${path.blockHeight}${sent != null ? '; the path the registry sent did not' : ''}`)
      } catch {
        say('unknown', 'inclusion', `the header source did not answer for block ${path.blockHeight}`)
      }
    }
  }

  // 6. The key that wrote the anchor is one you accept; without a list of
  // your own, a key the registry's capability document names, which shows
  // the anchor is this registry's and not that the registry is trusted.
  if (anchor.anchoredBy == null) {
    say('unknown', 'anchoring service', `a ${anchor.format} output names no anchoring service`)
  } else if (accepted == null && registryKeys.length > 0) {
    const named = registryKeys.includes(anchor.anchoredBy)
    say(named ? 'pass' : 'fail', 'anchoring service',
      `written by ${short(anchor.anchoredBy)}, ${named ? 'an anchoring key the registry names in its capability document' : `not ${registryKeys.map(short).join(' or ')}, the anchoring keys the registry names`}`)
  } else if (accepted == null) {
    say('unknown', 'anchoring service', `written by ${short(anchor.anchoredBy)}; the registry names no anchoring key, so pass --anchoring-services=<key>,... to compare it with the services you accept`)
  } else {
    say(accepted.includes(anchor.anchoredBy) ? 'pass' : 'fail', 'anchoring service',
      `written by ${short(anchor.anchoredBy)}, ${accepted.includes(anchor.anchoredBy) ? 'a service you accept' : 'which is not among the services you accept'}`)
  }
  return lines
}

// -------------------------------------------------------------------- run

const sources = fixtureMode
  ? fixtureSources()
  : { registry: liveRegistry(registryUrl), chain: liveChain(), accepted: option('anchoring-services')?.split(',').filter(Boolean) }
// The registry contract's document names the key as anchoredBy; the capabilities schema's names
// its anchoring services under publisherPolicy.anchoringServices. Read whichever the registry serves.
const capabilities = await sources.registry.capabilities()
const named = [capabilities.anchoredBy, ...(Array.isArray(capabilities.publisherPolicy?.anchoringServices) ? capabilities.publisherPolicy.anchoringServices : [])]
sources.registryKeys = [...new Set(named.filter((k) => typeof k === 'string' && /^0[23][0-9a-f]{64}$/.test(k)))]
console.log(fixtureMode ? 'Checking the repository\'s test registry, offline.' : `Checking ${registryUrl}${subject == null ? '' : ` for ${subject}`}, at most ${limit} records.`)

const counts = { pass: 0, fail: 0, unknown: 0, 'not-applicable': 0 }
const records = await sources.registry.records()
for (const record of records) {
  console.log(`\nrecord ${record.attestationId} (${record.representation})`)
  for (const { status, check, sentence } of await checkRecord(record, sources)) {
    counts[status] += 1
    console.log(`  ${status.padEnd(14)} ${check}: ${sentence}`)
  }
}

const total = Object.values(counts).reduce((a, b) => a + b, 0)
console.log(`\n${records.length} records, ${total} checks: ${counts.pass} pass, ${counts.fail} fail, ${counts.unknown} unknown, ${counts['not-applicable']} not-applicable. Each check stands on its own; there is no overall verdict.`)
if (fixtureMode) {
  // The test data is built so that every check that applies passes.
  const expected = counts.fail === 0 && counts.pass === total - 1 && counts.unknown === 1
  console.log(expected ? 'Every sentence above holds.' : 'FAIL: the test data did not give the expected result.')
  process.exitCode = expected ? 0 : 1
} else {
  process.exitCode = counts.fail === 0 ? 0 : 1
}
