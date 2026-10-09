import { verifyPassportEvidence, type ExpectedSubject } from '../src/index.js'
import { chainV3Fixture } from './chain-v3-fixture.js'
import { materialise, type EvidenceCase } from './evidence-v1-fixture.js'
import { custodianPriv, idKey } from './helpers-v2.js'
import { PASSPORT_ID_V3 } from './helpers-v3.js'

/**
 * The third verification-report case set (`spec/token-carrier.md` §10): the
 * report a conforming verifier produces over a carried version 3 lineage, its
 * retirement, a token id that names another lineage, a genesis away from
 * output 0, a value output behind a deploy prefix, and the burn. The report
 * version is unchanged; what is new is the evidence and two shared reason
 * codes. **Duplicated verbatim** as `fixtures/evidence-v3.json`, built from
 * `chain-v3.json` and its published test keys, so every case is reproducible
 * with no wallet and no network.
 */
export const EVIDENCE_V3_CHECKED_AT = '2027-06-01T12:00:00Z'

export async function evidenceV3Fixture(): Promise<{ fixtureVersion: 3; description: string; checkedAt: string; cases: EvidenceCase[] }> {
  const chain = await chainV3Fixture()
  const raw = chain.states.map((s) => s.rawTx)
  const asked: ExpectedSubject = { passportId: PASSPORT_ID_V3, source: 'request-context' }
  const custodian = idKey(custodianPriv)
  const refusal = (name: string) => {
    const r = chain.refusals.find((x) => x.name === name)
    if (r == null) throw new Error(`no refusal ${name}`)
    return r
  }
  const prefixPlus = (r: { appendAfter: number; rawTx: string }): string[] => [...raw.slice(0, r.appendAfter + 1), r.rawTx]

  const declared: Array<Omit<EvidenceCase, 'report'>> = [
    {
      id: 'v3-valid-lineage',
      description: 'The five pinned carried states with the custodian selected as publisher and no header source: the token rail passes, every state carries the token id, control is proven on every non-genesis state, and the limits say what a token reader does not verify.',
      evidence: { tokenHistory: raw },
      expectedSubject: asked,
      policy: { publisherKeys: [custodian], chainTracker: 'scripts-only' },
    },
    {
      id: 'v3-retired-tip-observed',
      description: 'The retired lineage with an index reporting its RETIRE unspent: the latest state is observed; a retired tip is a valid tip, and to a token reader a live unit.',
      evidence: { tokenHistory: raw },
      expectedSubject: asked,
      policy: { publisherKeys: [custodian], chainTracker: 'scripts-only' },
      observers: [{ id: 'index-a', kind: 'overlay-lookup', result: 'unspent' }],
    },
    {
      id: 'v3-update-after-retire',
      description: 'An UPDATE by the recipient spending the RETIRE: linkage fails with lineage-retired, and the findings before it stand.',
      evidence: { tokenHistory: prefixPlus(refusal('stateAfterRetire')) },
      expectedSubject: asked,
      policy: { publisherKeys: [custodian], chainTracker: 'scripts-only' },
    },
    {
      id: 'v3-token-id-not-lineage-genesis',
      description: 'A value output naming another deploy as its token id after the genesis: a valid token output to a generic reader, and linkage fails here with token-id-mismatch.',
      evidence: { tokenHistory: prefixPlus(refusal('tokenIdNotLineageGenesis')) },
      expectedSubject: asked,
      policy: { publisherKeys: [custodian], chainTracker: 'scripts-only' },
    },
    {
      id: 'v3-deploy-not-at-output-zero',
      description: 'The genesis behind an OP_RETURN at output 1: linkage fails on the genesis with carrier-prefix-invalid.',
      evidence: { tokenHistory: [refusal('deployNotAtOutputZero').rawTx] },
      expectedSubject: asked,
      policy: { publisherKeys: [custodian], chainTracker: 'scripts-only' },
    },
    {
      id: 'v3-value-with-empty-id',
      description: 'A state after the genesis behind a deploy prefix: linkage fails with carrier-prefix-invalid.',
      evidence: { tokenHistory: prefixPlus(refusal('valueWithEmptyId')) },
      expectedSubject: asked,
      policy: { publisherKeys: [custodian], chainTracker: 'scripts-only' },
    },
    {
      id: 'v3-control-not-proven',
      description: "A stranger's UPDATE with an empty control_linkage after the genesis: linkage fails with control-not-proven, as for version 2.",
      evidence: { tokenHistory: prefixPlus(refusal('strangerWithoutControl')) },
      expectedSubject: asked,
      policy: { publisherKeys: [custodian], chainTracker: 'scripts-only' },
    },
    {
      id: 'v3-version-two-behind-prefix',
      description: 'A version 2 body behind the token prefix after the genesis: this reader finds no DPP output in that transaction, so encoding fails and nothing about the state is guessed.',
      evidence: { tokenHistory: prefixPlus(refusal('versionTwoBehindPrefix')) },
      expectedSubject: asked,
      policy: { publisherKeys: [custodian], chainTracker: 'scripts-only' },
    },
    {
      id: 'v3-burn-without-retire',
      description: 'The tip after the second state spent by a transaction with no carrier output: no DPP output is found in it, so encoding fails on that transaction; the two states before it stand, and the lineage ended without a RETIRE.',
      evidence: { tokenHistory: [...raw.slice(0, 2), chain.burn.rawTx] },
      expectedSubject: asked,
      policy: { publisherKeys: [custodian], chainTracker: 'scripts-only' },
    },
  ]

  const cases: EvidenceCase[] = []
  for (const c of declared) {
    const { evidence, policy } = materialise(c)
    const report = await verifyPassportEvidence(evidence, c.expectedSubject, { ...policy, checkedAt: EVIDENCE_V3_CHECKED_AT })
    cases.push({ ...c, report })
  }
  return {
    fixtureVersion: 3,
    description: 'The report a conforming verifier produces for a carried version 3 lineage, its retirement, the carrier refusals and the burn; report version 1 throughout. Rebuild each case from its hex with checkedAt injected and compare the report byte for byte.',
    checkedAt: EVIDENCE_V3_CHECKED_AT,
    cases,
  }
}
