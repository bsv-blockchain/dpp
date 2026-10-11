#!/usr/bin/env node
/**
 * Sign the first version of a publisher policy chain with an operator's
 * identity key, and check it the way an index does when it boots
 * (spec/services.md section 1, contracts/publisher-policy.schema.json).
 *
 *   OPERATOR_PRIVATE_KEY=<64 hex> node examples/sign-publisher-policy.mjs <unsigned-policy.json> <signed-chain.json>
 *   node examples/sign-publisher-policy.mjs --dry-run
 *
 * The unsigned policy is one dpp-publisher-policy@1 object whose scope names
 * exactly one operator. The script sets issuedAt to now when it is absent,
 * adds a genesis authorisation signed by the operator's key, verifies the
 * chain with verifyPolicyChain under that operator's public key, and writes
 * the chain, a JSON array holding the one version, only if it verifies. The
 * private key is read from the environment and is never printed or written;
 * the output holds public keys and the signature only. Give an index the
 * written file as PUBLISHER_POLICY_FILE, or its text as PUBLISHER_POLICY_JSON,
 * with the OPERATOR_IDENTITY_KEYS line the script prints.
 *
 * A later version names the digest of the one before in supersedes and is
 * authorised by a key the chain already trusts; spec/services.md section 1
 * says which. This script writes the genesis only.
 *
 * With --dry-run, what CI runs, a key made for the run stands in for the
 * operator's, the script signs a built-in draft and shows it verifying, then
 * shows the same chain refused when one signed byte changes and when the
 * genesis is signed by a key other than the operator's.
 *
 * Results print one sentence per step, never a score, as GOVERNANCE.md
 * requires of every conformance surface.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { PrivateKey } from '@bsv/sdk'
import { policyDigest, policySigningPreimage, verifyPolicyChain } from '@bsv/dpp-protocol'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const [input, output] = args.filter((a) => !a.startsWith('--'))
let failures = 0
const say = (ok, sentence) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok' : 'FAIL'}: ${sentence}`)
}

/** The genesis authorisation: the operator's signature over the policy without signature values. */
function signGenesis(unsigned, key) {
  const policy = structuredClone(unsigned)
  policy.issuedAt ??= new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  policy.authorisation = { kind: 'genesis', signer: key.toPublicKey().toString(), suite: 'bsv-ecdsa-der', value: '' }
  policy.authorisation.value = key.sign(policySigningPreimage(policy)).toDER('hex')
  return policy
}

if (dryRun) {
  const operatorKey = PrivateKey.fromRandom()
  const publisherKey = PrivateKey.fromRandom().toPublicKey().toString()
  const operator = 'Example operator'
  const draft = {
    policyFormat: 'dpp-publisher-policy@1',
    policyVersion: 1,
    scope: { operatorProfile: 'single-operator@1', operators: [operator], topics: ['tm_dpp'] },
    publishers: [{ key: publisherKey, role: 'state-publisher', activeFrom: '2026-01-01T00:00:00Z' }],
  }
  const policy = signGenesis(draft, operatorKey)
  const operatorKeys = { [operator]: operatorKey.toPublicKey().toString() }
  const result = verifyPolicyChain([policy], operatorKeys)
  say(result.ok, `the genesis signed by ${operator}'s key verifies as the whole chain (versions ${result.versions.join(', ')}); its digest is ${policyDigest(policy)}.`)
  const tampered = { ...policy, notes: 'changed after signing' }
  const refusedTamper = verifyPolicyChain([tampered], operatorKeys)
  say(!refusedTamper.ok && refusedTamper.failure?.reason === 'signature-invalid', `the same policy with one signed property changed is refused (${refusedTamper.failure?.reason}).`)
  const stranger = signGenesis(draft, PrivateKey.fromRandom())
  const refusedStranger = verifyPolicyChain([stranger], operatorKeys)
  say(!refusedStranger.ok && refusedStranger.failure?.reason === 'genesis-signer-not-operator', `a genesis signed by a key other than the operator's is refused (${refusedStranger.failure?.reason}).`)
  console.log(`An index given this chain is also given: OPERATOR_IDENTITY_KEYS=${operator}=${operatorKeys[operator]}`)
  console.log(failures === 0 ? 'Every sentence above holds.' : 'At least one sentence above does not hold.')
  process.exit(failures === 0 ? 0 : 1)
}

if (input == null || output == null) {
  console.error('usage: OPERATOR_PRIVATE_KEY=<64 hex> node examples/sign-publisher-policy.mjs <unsigned-policy.json> <signed-chain.json>')
  process.exit(2)
}
const secret = process.env.OPERATOR_PRIVATE_KEY ?? ''
if (!/^[0-9a-fA-F]{64}$/.test(secret)) {
  console.error('OPERATOR_PRIVATE_KEY must hold the operator\'s private key as 64 hex characters; nothing was signed.')
  process.exit(2)
}
const unsigned = JSON.parse(readFileSync(input, 'utf8'))
const operators = unsigned.scope?.operators
if (!Array.isArray(operators) || operators.length !== 1) {
  console.error('The unsigned policy must name exactly one operator in scope.operators; nothing was signed.')
  process.exit(2)
}
const key = PrivateKey.fromHex(secret)
const policy = signGenesis(unsigned, key)
const operatorKeys = { [operators[0]]: key.toPublicKey().toString() }
const result = verifyPolicyChain([policy], operatorKeys)
say(result.ok, result.ok
  ? `the genesis for "${operators[0]}", issued ${policy.issuedAt}, verifies as the whole chain; its digest is ${policyDigest(policy)}.`
  : `the signed policy does not verify (${result.failure?.reason}: ${result.failure?.detail}); nothing was written.`)
if (!result.ok) process.exit(1)
writeFileSync(output, `${JSON.stringify([policy], null, 2)}\n`)
console.log(`The chain is written to ${output}. Give an index that file as PUBLISHER_POLICY_FILE, or its text as PUBLISHER_POLICY_JSON, and: OPERATOR_IDENTITY_KEYS=${operators[0]}=${operatorKeys[operators[0]]}`)
