import { LockingScript, PrivateKey, Transaction, UnlockingScript, Utils } from '@bsv/sdk'
import { verifyPassportEvidence, type ExpectedSubject } from '../src/index.js'
import { CHAIN_V1_FIXTURE } from './chain-v1-fixture.js'
import { chainV2Fixture } from './chain-v2-fixture.js'
import { managedAcceptanceV1Fixture } from './managed-acceptance-v1-fixture.js'
import { materialise, type EvidenceCase } from './evidence-v1-fixture.js'
import { PASSPORT_ID_V2, custodianPriv, idKey, issuerPriv } from './helpers-v2.js'

/**
 * The second verification-report case set (`spec/verification.md` §7): the
 * report a conforming verifier produces over version 2 lineages, the
 * managed-custody profile, retirement, a fork, the upgrade from version 1 and
 * a state under a version this reader does not know. The report version is
 * unchanged; what is new is the evidence. **Duplicated verbatim** as
 * `fixtures/evidence-v2.json`, built from `chain-v2.json`,
 * `managed-acceptance-v1.json` and `chain-v1.json` and their published test
 * keys, so every case is reproducible with no wallet and no network.
 */
export const EVIDENCE_V2_CHECKED_AT = '2027-06-01T12:00:00Z'

export async function evidenceV2Fixture(): Promise<{ fixtureVersion: 2; description: string; checkedAt: string; cases: EvidenceCase[] }> {
  const chain = await chainV2Fixture()
  const acceptance = await managedAcceptanceV1Fixture()
  const raw = chain.states.map((s) => s.rawTx)
  const asked: ExpectedSubject = { passportId: PASSPORT_ID_V2, source: 'request-context' }
  const custodian = idKey(custodianPriv)
  const issuer = idKey(issuerPriv)
  const refusal = (name: string) => {
    const r = chain.refusals.find((x) => x.name === name)
    if (r == null) throw new Error(`no refusal ${name}`)
    return r
  }
  const prefixPlus = (r: { appendAfter: number; rawTx: string }): string[] => [...raw.slice(0, r.appendAfter + 1), r.rawTx]

  // A state under version 3: seventeen fields with the version string changed,
  // signed by nobody in particular. A reader that does not know version 3
  // finds no DPP output at all in the transaction, and says so.
  const unknownVersion = (() => {
    const tx = Transaction.fromHex(raw[1])
    const chunks = tx.outputs[0].lockingScript.chunks.map((c) => ({ ...c }))
    chunks[3] = { op: 1, data: Utils.toArray('3', 'utf8') }
    const rewritten = new Transaction()
    rewritten.addInput({ sourceTXID: chain.states[0].txid, sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
    rewritten.addOutput({ satoshis: 1, lockingScript: new LockingScript(chunks) })
    return rewritten.toHex()
  })()

  const v1Raw = CHAIN_V1_FIXTURE.states.map((s) => s.rawTx)
  const v1Asked: ExpectedSubject = { passportId: CHAIN_V1_FIXTURE.states[0].data.passportId, source: 'request-context' }

  const declared: Array<Omit<EvidenceCase, 'report'>> = [
    {
      id: 'v2-valid-lineage',
      description: 'The five pinned version 2 states under the managed-custody profile with the custodian selected as publisher and no header source: the token rail passes with control proven on every non-genesis state, the TRANSFER carries its acceptance commitment, and the acceptance record it commits to was not supplied, so availability is unknown.',
      evidence: { tokenHistory: raw },
      expectedSubject: asked,
      policy: { publisherKeys: [custodian], managedAcceptance: { required: true }, chainTracker: 'scripts-only' },
    },
    {
      id: 'v2-valid-with-acceptance',
      description: 'The same lineage with the acceptance record supplied and an authority policy naming the issuer and the custodian: the record binds to the TRANSFER, availability passes, and the custodian is an authorised acceptance custodian.',
      evidence: { tokenHistory: raw, acceptanceRecords: [acceptance.record] },
      expectedSubject: asked,
      policy: { policyId: 'managed-custody@1/demonstration', publisherKeys: [custodian], managedAcceptance: { required: true }, chainTracker: 'scripts-only', authority: { required: true, genesisIssuers: [issuer], acceptanceCustodians: [custodian] } },
    },
    {
      id: 'v2-retired-tip-observed',
      description: 'The retired lineage with an index reporting its RETIRE unspent: the latest state is observed, and a retired tip is a valid tip.',
      evidence: { tokenHistory: raw, acceptanceRecords: [acceptance.record] },
      expectedSubject: asked,
      policy: { publisherKeys: [custodian], managedAcceptance: { required: true }, chainTracker: 'scripts-only' },
      observers: [{ id: 'index-a', kind: 'overlay-lookup', result: 'unspent' }],
    },
    {
      id: 'v2-update-after-retire',
      description: 'An UPDATE by the controller spending the RETIRE: linkage fails with lineage-retired, and the findings before it stand.',
      evidence: { tokenHistory: prefixPlus(refusal('updateAfterRetire')), acceptanceRecords: [acceptance.record] },
      expectedSubject: asked,
      policy: { publisherKeys: [custodian], managedAcceptance: { required: true }, chainTracker: 'scripts-only' },
    },
    {
      id: 'v2-control-not-proven',
      description: "A stranger's UPDATE with an empty control_linkage after the second state: linkage fails with control-not-proven.",
      evidence: { tokenHistory: prefixPlus(refusal('controlNotProven')) },
      expectedSubject: asked,
      policy: { publisherKeys: [custodian], chainTracker: 'scripts-only' },
    },
    {
      id: 'v2-transfer-without-commitment',
      description: 'A TRANSFER with no acceptance commitment under the managed-custody profile: linkage fails with acceptance-commitment-absent; the same bytes pass with the profile off.',
      evidence: { tokenHistory: prefixPlus(refusal('transferWithoutCommitment')) },
      expectedSubject: asked,
      policy: { publisherKeys: [custodian], managedAcceptance: { required: true }, chainTracker: 'scripts-only' },
    },
    {
      id: 'v2-transfer-without-commitment-profile-off',
      description: 'The same bytes with the profile off: the record model alone is satisfied.',
      evidence: { tokenHistory: prefixPlus(refusal('transferWithoutCommitment')) },
      expectedSubject: asked,
      policy: { publisherKeys: [custodian], chainTracker: 'scripts-only' },
    },
    {
      id: 'v2-fork',
      description: "The first three states as the history and, as an alternative, the first two plus the valid 'boundaryControl' successor: two valid successors of one state, reported as a conflicting latest state and never resolved here.",
      evidence: { tokenHistory: raw.slice(0, 3), alternativeHistories: [[...raw.slice(0, 2), chain.boundaryControl.rawTx]] },
      expectedSubject: asked,
      policy: { publisherKeys: [custodian], chainTracker: 'scripts-only' },
    },
    {
      id: 'v2-acceptance-mismatch',
      description: 'A well-formed, custodian-signed acceptance record naming another destination supplied beside the lineage: it does not bind to the TRANSFER, so availability fails with referenced-artefact-mismatch.',
      evidence: { tokenHistory: raw, acceptanceRecords: [acceptance.refusals.find((r) => r.name === 'destinationMismatch')!.record] },
      expectedSubject: asked,
      policy: { publisherKeys: [custodian], managedAcceptance: { required: true }, chainTracker: 'scripts-only' },
    },
    {
      id: 'v2-acceptance-custodian-unauthorised',
      description: 'The acceptance record supplied under an authority policy that names a different custodian: availability passes and issuer authority fails.',
      evidence: { tokenHistory: raw, acceptanceRecords: [acceptance.record] },
      expectedSubject: asked,
      policy: { publisherKeys: [custodian], managedAcceptance: { required: true }, chainTracker: 'scripts-only', authority: { required: true, genesisIssuers: [issuer], acceptanceCustodians: [PrivateKey.fromHex('99'.repeat(32)).toPublicKey().toString()] } },
    },
    {
      id: 'v1-to-v2-upgrade',
      description: 'The six version 1 fixture states followed by the version 2 UPDATE that upgrades the lineage: every check passes under the version 1 publisher key, and the limits name the version 1 assurance boundary.',
      evidence: { tokenHistory: [...v1Raw, chain.upgrade.rawTx] },
      expectedSubject: v1Asked,
      policy: { publisherKeys: [CHAIN_V1_FIXTURE.serverKey], chainTracker: 'scripts-only' },
    },
    {
      id: 'v1-to-v2-upgrade-not-update',
      description: 'A version 2 TRANSFER spending the version 1 tip: linkage fails with version-transition-invalid.',
      evidence: { tokenHistory: [...v1Raw, chain.upgrade.refusals.find((r) => r.name === 'upgradeNotUpdate')!.rawTx] },
      expectedSubject: v1Asked,
      policy: { publisherKeys: [CHAIN_V1_FIXTURE.serverKey], chainTracker: 'scripts-only' },
    },
    {
      id: 'unknown-version',
      description: 'A seventeen-field output carrying version "3" after the genesis: this reader finds no DPP output in that transaction, so encoding fails and nothing about the state is guessed.',
      evidence: { tokenHistory: [raw[0], unknownVersion] },
      expectedSubject: asked,
      policy: { publisherKeys: [custodian], chainTracker: 'scripts-only' },
    },
  ]

  const cases: EvidenceCase[] = []
  for (const c of declared) {
    const { evidence, policy } = materialise(c)
    const report = await verifyPassportEvidence(evidence, c.expectedSubject, { ...policy, checkedAt: EVIDENCE_V2_CHECKED_AT })
    cases.push({ ...c, report })
  }
  return {
    fixtureVersion: 2,
    description: 'The report a conforming verifier produces for version 2 lineages, the managed-custody profile, retirement, a fork, the upgrade from version 1 and an unknown version; report version 1 throughout. Rebuild each case from its hex and stand-ins with checkedAt injected and compare the report byte for byte.',
    checkedAt: EVIDENCE_V2_CHECKED_AT,
    cases,
  }
}

