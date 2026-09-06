import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hash, LockingScript, MerklePath, PrivateKey, ProtoWallet, Transaction, Utils, type ChainTracker } from '@bsv/sdk'
import {
  buildAttestationAnchor,
  verifyPassportEvidence,
  type EvidencePolicy,
  type EvidenceReport,
  type ExpectedSubject,
  type LatestStateObserver,
  type ObservationResult,
  type PassportEvidence,
} from '../src/index.js'
import { CHAIN_V1_FIXTURE as CHAIN } from './chain-v1-fixture.js'
import { makeData, makerPriv, signedState, stateTx } from './helpers.js'

/**
 * The verification-report fixture (`spec/verification.md` §7): a set of
 * evidence cases and the report a conforming verifier produces for each, so an
 * API, an embedded view and a standalone tool are compared on the same bytes.
 *
 * **Duplicated verbatim** as `fixtures/evidence-v1.json`. Every case is built
 * from the two fixtures that already pin bytes, `chain-v1.json` and
 * `attestation-anchor-v1.json`, plus a rival genesis and a re-metadata'd anchor
 * made from their published test keys, so nothing here needs a wallet or a
 * network and every signature is reproducible. The report is what
 * `verifyPassportEvidence` returned with `checkedAt` injected; a consumer
 * rebuilds the evidence from the hex, supplies the case's declared observers and
 * header source, and compares its own report to `report`.
 *
 * Declarative stand-ins keep the cases portable. `observers` are sources that
 * answer as written; `headerSource` maps a height to the root the source holds,
 * or is `unavailable` for an outage; `chainTracker: 'scripts-only'` disables the
 * header check. Nothing derived from the published private keys will ever hold
 * value.
 */

const ANCHOR = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'fixtures', 'attestation-anchor-v1.json'), 'utf8'))
export const EVIDENCE_CHECKED_AT = '2026-09-05T12:00:00Z'

export interface DeclaredObserver {
  id: string
  kind: LatestStateObserver['kind']
  result: ObservationResult
  spendingTxid?: string
}

export interface EvidenceCase {
  id: string
  description: string
  evidence: {
    tokenHistory?: string[]
    /** BUMP hex per state of `tokenHistory`, `null` for a state with no proof. */
    merklePaths?: Array<string | null>
    alternativeHistories?: string[][]
    nativeClaims?: unknown[]
    anchors?: Array<{ lockingScript: string; txid?: string; outputIndex?: number; securedBytes?: string }>
    /** Managed acceptance records (`spec/managed-custody.md`), as posted; version 2 cases only. */
    acceptanceRecords?: unknown[]
  }
  expectedSubject: ExpectedSubject
  policy: {
    policyId?: string
    publisherKeys?: string[]
    ownerConsent?: boolean | { authorities: string[] }
    /** Version 2 control authorities and the managed-custody profile; absent on version 1 cases. */
    controlAuthorities?: string[]
    managedAcceptance?: { required: boolean }
    chainTracker: 'scripts-only' | 'header-source'
    headerSource?: Record<string, string> | 'unavailable'
    authority?: { required: false; reason: string } | { required: true; genesisIssuers?: string[]; claimIssuers?: string[]; anchoringServices?: string[]; acceptanceCustodians?: string[] }
  }
  observers?: DeclaredObserver[]
  report: EvidenceReport
}

function tracker(policy: EvidenceCase['policy']): ChainTracker | 'scripts only' {
  if (policy.chainTracker === 'scripts-only') return 'scripts only'
  if (policy.headerSource === 'unavailable') {
    return { isValidRootForHeight: async () => { throw new Error('header source unavailable') }, currentHeight: async () => 0 }
  }
  const roots = policy.headerSource ?? {}
  return { isValidRootForHeight: async (root, height) => roots[String(height)] === root, currentHeight: async () => 999999 }
}

/** Rebuild the evidence and policy a case declares; consumers in any language do the same from the JSON. */
export function materialise(c: Omit<EvidenceCase, 'report'>): { evidence: PassportEvidence; policy: EvidencePolicy } {
  const history = (c.evidence.tokenHistory ?? []).map((hex, i) => {
    const tx = Transaction.fromHex(hex)
    const path = c.evidence.merklePaths?.[i]
    if (path != null) tx.merklePath = MerklePath.fromHex(path)
    return tx
  })
  const evidence: PassportEvidence = {
    ...(c.evidence.tokenHistory == null ? {} : { tokenHistory: history }),
    ...(c.evidence.alternativeHistories == null ? {} : { alternativeHistories: c.evidence.alternativeHistories.map((h) => h.map((hex) => Transaction.fromHex(hex))) }),
    ...(c.evidence.nativeClaims == null ? {} : { nativeClaims: c.evidence.nativeClaims }),
    ...(c.evidence.anchors == null ? {} : { anchors: c.evidence.anchors.map((a) => ({ ...a, lockingScript: LockingScript.fromHex(a.lockingScript) })) }),
    ...(c.evidence.acceptanceRecords == null ? {} : { acceptanceRecords: c.evidence.acceptanceRecords }),
  }
  const observers: LatestStateObserver[] = (c.observers ?? []).map((o) => ({
    id: o.id,
    kind: o.kind,
    observe: async () => ({ result: o.result, ...(o.spendingTxid == null ? {} : { spendingTxid: o.spendingTxid }) }),
  }))
  const policy: EvidencePolicy = {
    checkedAt: EVIDENCE_CHECKED_AT,
    chainTracker: tracker(c.policy),
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

export async function evidenceV1Fixture(): Promise<{ fixtureVersion: 1; description: string; checkedAt: string; cases: EvidenceCase[] }> {
  const raw = CHAIN.states.map((s) => s.rawTx)
  const passportId = CHAIN.states[0].data.passportId
  const asked: ExpectedSubject = { passportId, source: 'request-context' }
  const anchoring = new ProtoWallet(PrivateKey.fromHex(ANCHOR.anchoringPrivateKey))

  // A second, validly signed genesis under the same identifier, one second later.
  const rival = stateTx(await signedState(makeData({ timestamp: '2026-06-11T12:00:01Z' })), makerPriv.toPublicKey())

  // The fixture anchor with its subject changed and signed again by the same service.
  const otherSubject = await buildAttestationAnchor({ ...ANCHOR.anchor, subject: 'https://id.example.test/products/other' }, anchoring)

  // Synthetic proofs for the pinned chain: two-leaf paths with the state at offset 1, roots recorded per height.
  const proofs: string[] = []
  const roots: Record<string, string> = {}
  CHAIN.states.forEach((s, i) => {
    const height = 800000 + i
    const path = new MerklePath(height, [[{ offset: 0, hash: 'ab'.repeat(32) }, { offset: 1, hash: s.txid, txid: true }]])
    roots[String(height)] = path.computeRoot(s.txid)
    proofs.push(path.toHex())
  })

  const missingMiddle = F(2)
  function F(skip: number): string[] {
    return raw.filter((_, i) => i !== skip)
  }
  const twoOutputs = CHAIN.refusals.find((r) => r.name === 'twoDppOutputs')!
  const stranger = CHAIN.refusals.find((r) => r.name === 'transferByStranger')!
  const opaque = Utils.toArray('opaque bytes of a format this verifier does not know', 'utf8')
  const opaqueAnchor = await buildAttestationAnchor({ ...ANCHOR.anchor, digest: Utils.toHex(Hash.sha256(opaque)), representation: 'x-unknown-format-v9', mediaType: 'application/octet-stream', attestationType: 'Unknown' }, anchoring)

  const declared: Array<Omit<EvidenceCase, 'report'>> = [
    {
      id: 'valid-chain',
      description: 'The six pinned states with the publisher selected and no header source: the token rail passes, inclusion is unknown for want of proofs, and every other rail stays unknown.',
      evidence: { tokenHistory: raw },
      expectedSubject: asked,
      policy: { publisherKeys: [CHAIN.serverKey], chainTracker: 'scripts-only' },
    },
    {
      id: 'valid-chain-proved',
      description: 'The same chain with a proof per state and a header source that holds every root: inclusion passes.',
      evidence: { tokenHistory: raw, merklePaths: proofs },
      expectedSubject: asked,
      policy: { publisherKeys: [CHAIN.serverKey], chainTracker: 'header-source', headerSource: roots },
    },
    {
      id: 'header-source-unavailable',
      description: 'Proofs present but the header source does not answer: inclusion is unknown, not failed, and the chain is not refused.',
      evidence: { tokenHistory: raw, merklePaths: proofs },
      expectedSubject: asked,
      policy: { publisherKeys: [CHAIN.serverKey], chainTracker: 'header-source', headerSource: 'unavailable' },
    },
    {
      id: 'proof-refuted',
      description: 'The header source holds a different root for the third state: inclusion fails at that state.',
      evidence: { tokenHistory: raw, merklePaths: proofs },
      expectedSubject: asked,
      policy: { publisherKeys: [CHAIN.serverKey], chainTracker: 'header-source', headerSource: { ...roots, '800002': 'ff'.repeat(32) } },
    },
    {
      id: 'stale-prefix-superseded',
      description: 'The first four states, valid as history, with an index that saw the fifth spend the fourth: the token checks pass and the latest state is superseded.',
      evidence: { tokenHistory: raw.slice(0, 4) },
      expectedSubject: asked,
      policy: { publisherKeys: [CHAIN.serverKey], chainTracker: 'scripts-only' },
      observers: [{ id: 'index-a', kind: 'overlay-lookup', result: 'spent', spendingTxid: CHAIN.states[4].txid }],
    },
    {
      id: 'missing-middle',
      description: 'States one, two and four: the fourth does not spend the tip it names, so linkage fails at index 2 and the findings before it stand.',
      evidence: { tokenHistory: missingMiddle },
      expectedSubject: asked,
      policy: { publisherKeys: [CHAIN.serverKey], chainTracker: 'scripts-only' },
    },
    {
      id: 'two-dpp-outputs',
      description: 'A transaction carrying two DPP outputs after the pinned prefix: encoding fails and the other checks on that state cannot run.',
      evidence: { tokenHistory: [...raw.slice(0, twoOutputs.appendAfter + 1), twoOutputs.rawTx] },
      expectedSubject: asked,
      policy: { chainTracker: 'scripts-only' },
    },
    {
      id: 'wrong-publisher',
      description: 'A publisher key that countersigned nothing: the publisher check fails at the genesis and later states are not inspected.',
      evidence: { tokenHistory: raw },
      expectedSubject: asked,
      policy: { publisherKeys: [PrivateKey.fromHex('99'.repeat(32)).toPublicKey().toString()], chainTracker: 'scripts-only' },
    },
    {
      id: 'consent-not-proven',
      description: 'The transferByStranger refusal under a policy that selects the owner-signed transfer: linkage fails with the consent reason.',
      evidence: { tokenHistory: [...raw.slice(0, stranger.appendAfter + 1), stranger.rawTx] },
      expectedSubject: asked,
      policy: { chainTracker: 'scripts-only', ownerConsent: true },
    },
    {
      id: 'subject-substitution',
      description: 'A valid chain for JERSEY-001 presented for JERSEY-002: every token check passes and subject binding fails.',
      evidence: { tokenHistory: raw },
      expectedSubject: { passportId: 'https://id.gs1.org/01/09506000134352/21/JERSEY-002', source: 'request-context' },
      policy: { chainTracker: 'scripts-only' },
    },
    {
      id: 'subject-not-independent',
      description: 'The verifier took the subject from the evidence: subject binding is unknown and the report says so in its limits.',
      evidence: { tokenHistory: raw },
      expectedSubject: { passportId, source: 'none' },
      policy: { chainTracker: 'scripts-only' },
    },
    {
      id: 'duplicate-genesis',
      description: 'A second valid genesis under the same identifier: two candidates, no winner, until an expectation selects one.',
      evidence: { tokenHistory: raw, alternativeHistories: [[rival.toHex()]] },
      expectedSubject: asked,
      policy: { chainTracker: 'scripts-only' },
    },
    {
      id: 'duplicate-genesis-selected',
      description: 'The same two candidates with the expected genesis outpoint named: subject binding passes and the rival remains visible as a candidate.',
      evidence: { tokenHistory: raw, alternativeHistories: [[rival.toHex()]] },
      expectedSubject: { ...asked, source: 'established-binding', expectedGenesisOutpoint: { txid: CHAIN.states[0].txid, outputIndex: CHAIN.states[0].outputIndex } },
      policy: { chainTracker: 'scripts-only' },
    },
    {
      id: 'genesis-authority',
      description: 'The maker named as a permitted genesis issuer by policy: authority passes for the token rail.',
      evidence: { tokenHistory: raw },
      expectedSubject: asked,
      policy: { policyId: 'urn:dpp:fixture:policy:genesis', chainTracker: 'scripts-only', authority: { required: true, genesisIssuers: [CHAIN.makerKey] } },
    },
    {
      id: 'anchor-and-claim',
      description: 'The portable anchor with its signed native claim: the attestation and anchor rails pass, the claim binds to the anchor, and authority is unknown without a policy.',
      evidence: { anchors: [{ lockingScript: ANCHOR.lockingScript, txid: 'aa'.repeat(32), outputIndex: 0 }], nativeClaims: [ANCHOR.claim] },
      expectedSubject: { passportId: ANCHOR.anchor.subject, source: 'request-context' },
      policy: { chainTracker: 'scripts-only' },
    },
    {
      id: 'anchor-and-claim-authorised',
      description: 'The same evidence under a policy naming the claim issuer and the anchoring service: authority passes.',
      evidence: { anchors: [{ lockingScript: ANCHOR.lockingScript, txid: 'aa'.repeat(32), outputIndex: 0 }], nativeClaims: [ANCHOR.claim] },
      expectedSubject: { passportId: ANCHOR.anchor.subject, source: 'request-context' },
      policy: { policyId: 'urn:dpp:fixture:policy:anchor', chainTracker: 'scripts-only', authority: { required: true, claimIssuers: [ANCHOR.claim.issuer], anchoringServices: [ANCHOR.anchor.anchoredBy] } },
    },
    {
      id: 'anchor-tampered-bytes',
      description: 'The anchor with secured bytes that differ from the committed ones by one word: binding fails on the digest.',
      evidence: { anchors: [{ lockingScript: ANCHOR.lockingScript, securedBytes: ANCHOR.representationBytes.replace('"eventType":"Origin"', '"eventType":"Transfer"') }] },
      expectedSubject: { passportId: ANCHOR.anchor.subject, source: 'request-context' },
      policy: { chainTracker: 'scripts-only' },
    },
    {
      id: 'anchor-metadata-mismatch',
      description: 'An anchor validly signed by the same service but naming another subject for the fixture claim: binding fails on metadata and subject binding fails.',
      evidence: { anchors: [{ lockingScript: otherSubject.toHex() }], nativeClaims: [ANCHOR.claim] },
      expectedSubject: { passportId: ANCHOR.anchor.subject, source: 'request-context' },
      policy: { chainTracker: 'scripts-only' },
    },
    {
      id: 'anchor-unsupported-representation',
      description: 'A valid anchor over bytes in a representation this verifier does not know: the commitment is indexed and the content check is unsupported.',
      evidence: { anchors: [{ lockingScript: opaqueAnchor.toHex(), securedBytes: Utils.toUTF8(opaque) }] },
      expectedSubject: { passportId: ANCHOR.anchor.subject, source: 'request-context' },
      policy: { chainTracker: 'scripts-only' },
    },
    {
      id: 'anchor-bytes-absent',
      description: 'A valid anchor with nothing supplied for its digest: binding is unknown and availability names the missing artefact.',
      evidence: { anchors: [{ lockingScript: ANCHOR.lockingScript }] },
      expectedSubject: { passportId: ANCHOR.anchor.subject, source: 'request-context' },
      policy: { chainTracker: 'scripts-only' },
    },
    {
      id: 'empty-evidence',
      description: 'No evidence at all: nothing passes, the two unselected checks are not applicable, and every other check is unknown.',
      evidence: {},
      expectedSubject: asked,
      policy: { chainTracker: 'scripts-only' },
    },
  ]

  const cases: EvidenceCase[] = []
  for (const c of declared) {
    const { evidence, policy } = materialise(c)
    const report = await verifyPassportEvidence(evidence, c.expectedSubject, policy)
    cases.push({ ...c, report })
  }
  return {
    fixtureVersion: 1,
    description: 'Verification-report cases built from chain-v1.json and attestation-anchor-v1.json with their published test keys. Rebuild the evidence from the hex, answer the declared observers and header source as written, inject checkedAt, and compare the report. Public synthetic keys only; no funds may be sent to fixture outputs.',
    checkedAt: EVIDENCE_CHECKED_AT,
    cases,
  }
}
