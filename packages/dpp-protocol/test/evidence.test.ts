import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Hash, LockingScript, PrivateKey, ProtoWallet, Transaction, Utils, type ChainTracker } from '@bsv/sdk'
import {
  EVIDENCE_CHECK_NAMES,
  buildAttestationAnchor,
  verifyPassportEvidence,
  type EvidenceCheck,
  type EvidenceReport,
  type ExpectedSubject,
  type LatestStateObserver,
} from '../src/index.js'
import { CHAIN_V1_FIXTURE as F } from './chain-v1-fixture.js'
import { attachProof, buildChainFixture, makeData, mockTracker, serverPriv, signedState, stateTx, makerPriv, idKey } from './helpers.js'

const ANCHOR = JSON.parse(readFileSync(new URL('../../../fixtures/attestation-anchor-v1.json', import.meta.url), 'utf8'))
const CHECKED_AT = '2026-09-05T12:00:00Z'
const chain = F.states.map((s) => Transaction.fromHex(s.rawTx))
const passportId = F.states[0].data.passportId
const asked: ExpectedSubject = { passportId, source: 'request-context' }

const byName = (report: EvidenceReport, name: EvidenceCheck['name']): EvidenceCheck => {
  const found = report.checks.find((c) => c.name === name)
  if (found == null) throw new Error(`no check ${name}`)
  return found
}
const statuses = (report: EvidenceReport): Record<string, string> =>
  Object.fromEntries(report.checks.map((c) => [c.name, c.reasonCode == null ? c.status : `${c.status}:${c.reasonCode}`]))

describe('verifyPassportEvidence, the one verification contract (spec/verification.md)', () => {
  it('reports exactly the sixteen checks in order, versioned, at the injected time', async () => {
    const report = await verifyPassportEvidence({ tokenHistory: chain }, asked, { checkedAt: CHECKED_AT, publisherKeys: [F.serverKey], chainTracker: 'scripts only' })
    expect(report.reportVersion).toBe('1')
    expect(report.checkedAt).toBe(CHECKED_AT)
    expect(report.checks.map((c) => c.name)).toEqual([...EVIDENCE_CHECK_NAMES])
    expect(report.policyId).toBe('none')
    expect(report.suppliedTip).toEqual({ txid: F.states[5].txid, outputIndex: F.states[5].outputIndex })
    for (const c of report.checks) {
      if (c.status !== 'pass') expect(c.reasonCode, c.name).toBeDefined()
      if (c.status === 'pass') expect(c.evidenceRefs.length, c.name).toBeGreaterThan(0)
    }
  })

  it('passes the token rail for the pinned chain and leaves every other rail unknown, never passed', async () => {
    const report = await verifyPassportEvidence({ tokenHistory: chain }, asked, { checkedAt: CHECKED_AT, publisherKeys: [F.serverKey], chainTracker: 'scripts only' })
    expect(statuses(report)).toEqual({
      recordEncoding: 'pass',
      actorSignatures: 'pass',
      publisherSignatures: 'pass',
      linkage: 'pass',
      inclusion: 'unknown:proof-absent',
      nativeAttestationSignature: 'unknown:no-evidence',
      anchorSignature: 'unknown:no-evidence',
      anchorKeyDerivation: 'unknown:no-evidence',
      anchorDigestAndMetadataBinding: 'unknown:no-evidence',
      externalCredentialProof: 'not-applicable:no-external-credential',
      subjectBinding: 'pass',
      issuerAuthority: 'unknown:policy-missing',
      schema: 'unknown:no-evidence',
      credentialTime: 'unknown:no-evidence',
      credentialStatus: 'unknown:no-evidence',
      evidenceAvailability: 'pass',
    })
    expect(report.observations).toMatchObject({ latestState: 'unknown', sources: [], candidateOutpoints: [report.suppliedTip] })
    expect(report.limits.some((l) => l.includes('does not establish current ownership'))).toBe(true)
    expect(JSON.stringify(report)).not.toMatch(/"valid"|"verified":true/)
  })

  it('does not select the publisher check when the policy names no publisher', async () => {
    const report = await verifyPassportEvidence({ tokenHistory: chain }, asked, { checkedAt: CHECKED_AT, chainTracker: 'scripts only' })
    expect(byName(report, 'publisherSignatures')).toMatchObject({ status: 'not-applicable', reasonCode: 'publisher-not-selected' })
  })

  it('fails the publisher check for a key that did not countersign and leaves later states uninspected', async () => {
    const stranger = PrivateKey.fromHex('99'.repeat(32)).toPublicKey().toString()
    const report = await verifyPassportEvidence({ tokenHistory: chain }, asked, { checkedAt: CHECKED_AT, publisherKeys: [stranger], chainTracker: 'scripts only' })
    expect(byName(report, 'publisherSignatures')).toMatchObject({ status: 'fail', reasonCode: 'signature-invalid', scope: { stateIndex: 0 } })
    expect(byName(report, 'actorSignatures')).toMatchObject({ status: 'unknown', reasonCode: 'not-inspected' })
    expect(byName(report, 'linkage')).toMatchObject({ status: 'unknown', reasonCode: 'not-inspected' })
  })

  it('accepts any of several publisher keys', async () => {
    const stranger = PrivateKey.fromHex('99'.repeat(32)).toPublicKey().toString()
    const report = await verifyPassportEvidence({ tokenHistory: chain }, asked, { checkedAt: CHECKED_AT, publisherKeys: [stranger, F.serverKey], chainTracker: 'scripts only' })
    expect(byName(report, 'publisherSignatures').status).toBe('pass')
  })

  it('reports a valid stale prefix as valid history and a superseded latest state when a source saw the spend', async () => {
    const spent: LatestStateObserver = {
      id: 'index-a',
      kind: 'overlay-lookup',
      observe: async ({ tip }) => ({ result: 'spent', spendingTxid: F.states[4].txid, detail: `${tip?.txid} was spent` }),
    }
    const report = await verifyPassportEvidence({ tokenHistory: chain.slice(0, 4) }, asked, { checkedAt: CHECKED_AT, publisherKeys: [F.serverKey], chainTracker: 'scripts only', observers: [spent] })
    expect(byName(report, 'linkage').status).toBe('pass')
    expect(byName(report, 'actorSignatures').status).toBe('pass')
    expect(report.suppliedTip).toEqual({ txid: F.states[3].txid, outputIndex: F.states[3].outputIndex })
    expect(report.observations.latestState).toBe('superseded')
    expect(report.observations.sources[0]).toMatchObject({ id: 'index-a', result: 'spent', spendingTxid: F.states[4].txid, observedAt: CHECKED_AT })
    expect(report.limits.some((l) => l.includes('not a proof that no later spend exists'))).toBe(true)
  })

  it('reports agreement as observed, disagreement as conflicting and an outage as unknown', async () => {
    const answer = (id: string, result: 'unspent' | 'spent' | 'unavailable'): LatestStateObserver => ({
      id, kind: 'spend-status', observe: async () => (result === 'unavailable' ? Promise.reject(new Error('timeout')) : { result }),
    })
    const agree = await verifyPassportEvidence({ tokenHistory: chain }, asked, { checkedAt: CHECKED_AT, observers: [answer('a', 'unspent'), answer('b', 'unspent')] })
    expect(agree.observations.latestState).toBe('observed')
    const disagree = await verifyPassportEvidence({ tokenHistory: chain }, asked, { checkedAt: CHECKED_AT, observers: [answer('a', 'unspent'), answer('b', 'spent')] })
    expect(disagree.observations.latestState).toBe('conflicting')
    const outage = await verifyPassportEvidence({ tokenHistory: chain }, asked, { checkedAt: CHECKED_AT, observers: [answer('a', 'unavailable')] })
    expect(outage.observations.latestState).toBe('unknown')
    expect(outage.observations.sources[0]).toMatchObject({ result: 'unavailable', detail: 'timeout' })
  })

  it('fails linkage on a missing middle and keeps the findings before it', async () => {
    const report = await verifyPassportEvidence({ tokenHistory: [chain[0], chain[1], chain[3]] }, asked, { checkedAt: CHECKED_AT, publisherKeys: [F.serverKey], chainTracker: 'scripts only' })
    expect(byName(report, 'linkage')).toMatchObject({ status: 'fail', reasonCode: 'link-broken', scope: { stateIndex: 2 } })
    expect(byName(report, 'actorSignatures').status).toBe('pass')
    expect(byName(report, 'recordEncoding').status).toBe('pass')
    expect(report.suppliedTip).toEqual({ txid: F.states[3].txid, outputIndex: F.states[3].outputIndex })
  })

  it('fails encoding for a transaction with two DPP outputs and cannot check the rest of that state', async () => {
    const twice = F.refusals.find((r) => r.name === 'twoDppOutputs')!
    const report = await verifyPassportEvidence({ tokenHistory: [...chain.slice(0, twice.appendAfter + 1), Transaction.fromHex(twice.rawTx)] }, asked, { checkedAt: CHECKED_AT, chainTracker: 'scripts only' })
    expect(byName(report, 'recordEncoding')).toMatchObject({ status: 'fail', reasonCode: 'decode-failed', scope: { stateIndex: twice.appendAfter + 1 } })
    expect(byName(report, 'actorSignatures')).toMatchObject({ status: 'unknown', reasonCode: 'decode-failed' })
    expect(byName(report, 'linkage')).toMatchObject({ status: 'unknown', reasonCode: 'decode-failed' })
  })

  it('reports the owner-signed transfer under linkage when the policy selects it', async () => {
    const stranger = F.refusals.find((r) => r.name === 'transferByStranger')!
    const txs = [...chain.slice(0, stranger.appendAfter + 1), Transaction.fromHex(stranger.rawTx)]
    const off = await verifyPassportEvidence({ tokenHistory: txs }, asked, { checkedAt: CHECKED_AT, chainTracker: 'scripts only' })
    expect(byName(off, 'linkage').status).toBe('pass')
    const on = await verifyPassportEvidence({ tokenHistory: txs }, asked, { checkedAt: CHECKED_AT, chainTracker: 'scripts only', ownerConsent: true })
    expect(byName(on, 'linkage')).toMatchObject({ status: 'fail', reasonCode: 'consent-not-proven' })
  })

  it('fails subject binding when validly signed evidence names another product', async () => {
    const report = await verifyPassportEvidence({ tokenHistory: chain }, { passportId: 'https://id.gs1.org/01/09506000134352/21/JERSEY-002', source: 'request-context' }, { checkedAt: CHECKED_AT, chainTracker: 'scripts only' })
    expect(byName(report, 'actorSignatures').status).toBe('pass')
    expect(byName(report, 'linkage').status).toBe('pass')
    expect(byName(report, 'subjectBinding')).toMatchObject({ status: 'fail', reasonCode: 'subject-mismatch' })
  })

  it('checks the expected genesis, state and issuer when the expectation names them', async () => {
    const genesis = { txid: F.states[0].txid, outputIndex: F.states[0].outputIndex }
    const tip = { txid: F.states[5].txid, outputIndex: F.states[5].outputIndex }
    const good = await verifyPassportEvidence({ tokenHistory: chain }, { ...asked, source: 'established-binding', expectedGenesisOutpoint: genesis, expectedStateOutpoint: tip, expectedIssuer: F.makerKey }, { checkedAt: CHECKED_AT })
    expect(byName(good, 'subjectBinding').status).toBe('pass')
    const wrongGenesis = await verifyPassportEvidence({ tokenHistory: chain }, { ...asked, expectedGenesisOutpoint: tip }, { checkedAt: CHECKED_AT })
    expect(byName(wrongGenesis, 'subjectBinding')).toMatchObject({ status: 'fail', reasonCode: 'genesis-mismatch' })
    const stale = await verifyPassportEvidence({ tokenHistory: chain.slice(0, 3) }, { ...asked, expectedStateOutpoint: tip }, { checkedAt: CHECKED_AT })
    expect(byName(stale, 'subjectBinding')).toMatchObject({ status: 'fail', reasonCode: 'state-mismatch' })
    const otherIssuer = await verifyPassportEvidence({ tokenHistory: chain }, { ...asked, expectedIssuer: F.owner1Key }, { checkedAt: CHECKED_AT })
    expect(byName(otherIssuer, 'subjectBinding')).toMatchObject({ status: 'fail', reasonCode: 'issuer-mismatch' })
  })

  it('reports subject binding as unknown when nobody expected a subject independently', async () => {
    const report = await verifyPassportEvidence({ tokenHistory: chain }, { passportId, source: 'none' }, { checkedAt: CHECKED_AT })
    expect(byName(report, 'subjectBinding')).toMatchObject({ status: 'unknown', reasonCode: 'subject-not-independent' })
    expect(report.limits.some((l) => l.includes('taken from the evidence itself'))).toBe(true)
  })

  it('keeps two valid genesis records under one identifier as candidates until the expectation selects one', async () => {
    const second = await signedState(makeData({ timestamp: '2026-06-11T12:00:01Z' }))
    const rival = stateTx(second, makerPriv.toPublicKey())
    const ambiguous = await verifyPassportEvidence({ tokenHistory: chain, alternativeHistories: [[rival]] }, asked, { checkedAt: CHECKED_AT })
    expect(byName(ambiguous, 'subjectBinding')).toMatchObject({ status: 'unknown', reasonCode: 'genesis-ambiguous' })
    expect(ambiguous.observations.latestState).toBe('conflicting')
    expect(ambiguous.observations.candidateOutpoints).toEqual([{ txid: F.states[5].txid, outputIndex: 0 }, { txid: rival.id('hex'), outputIndex: 0 }])
    const selected = await verifyPassportEvidence({ tokenHistory: chain, alternativeHistories: [[rival]] }, { ...asked, expectedGenesisOutpoint: { txid: F.states[0].txid, outputIndex: 0 } }, { checkedAt: CHECKED_AT })
    expect(byName(selected, 'subjectBinding').status).toBe('pass')
  })

  it('reports inclusion from the header source: proved, refuted, outage, or not selected', async () => {
    const { txs } = await buildChainFixture()
    const roots: Record<number, string> = {}
    txs.forEach((tx, i) => attachProof(tx, 800000 + i, roots))
    const subject = { passportId: makeData().passportId, source: 'request-context' as const }
    const proved = await verifyPassportEvidence({ tokenHistory: txs }, subject, { checkedAt: CHECKED_AT, chainTracker: mockTracker(roots) })
    expect(byName(proved, 'inclusion').status).toBe('pass')
    const refuted = await verifyPassportEvidence({ tokenHistory: txs }, subject, { checkedAt: CHECKED_AT, chainTracker: mockTracker({ ...roots, 800002: 'ff'.repeat(32) }) })
    expect(byName(refuted, 'inclusion')).toMatchObject({ status: 'fail', reasonCode: 'proof-refuted', scope: { stateIndex: 2 } })
    const outage: ChainTracker = { isValidRootForHeight: async () => { throw new Error('header service unavailable') }, currentHeight: async () => 0 }
    const down = await verifyPassportEvidence({ tokenHistory: txs }, subject, { checkedAt: CHECKED_AT, chainTracker: outage })
    expect(byName(down, 'inclusion')).toMatchObject({ status: 'unknown', reasonCode: 'header-source-unavailable' })
    const disabled = await verifyPassportEvidence({ tokenHistory: txs }, subject, { checkedAt: CHECKED_AT, chainTracker: 'scripts only' })
    expect(byName(disabled, 'inclusion')).toMatchObject({ status: 'unknown', reasonCode: 'not-selected' })
  })

  it('verifies the anchor rail and binds the portable fixture claim to its anchor', async () => {
    const subject = { passportId: ANCHOR.anchor.subject, source: 'request-context' as const }
    const report = await verifyPassportEvidence({ anchors: [{ lockingScript: ANCHOR.lockingScript, txid: 'aa'.repeat(32), outputIndex: 0 }], nativeClaims: [ANCHOR.claim] }, subject, { checkedAt: CHECKED_AT })
    expect(statuses(report)).toMatchObject({
      nativeAttestationSignature: 'pass',
      anchorSignature: 'pass',
      anchorKeyDerivation: 'pass',
      anchorDigestAndMetadataBinding: 'pass',
      subjectBinding: 'pass',
      issuerAuthority: 'unknown:policy-missing',
      schema: 'unknown:schema-unavailable',
      credentialTime: 'pass',
      credentialStatus: 'not-applicable:format-defines-no-status',
      evidenceAvailability: 'pass',
      recordEncoding: 'unknown:no-evidence',
    })
    expect(report.suppliedTip).toBeNull()
    expect(byName(report, 'anchorDigestAndMetadataBinding').evidenceRefs).toContain(`sha256:${ANCHOR.digest}`)
  })

  it('binds supplied secured bytes to a native anchor and fails a single changed byte', async () => {
    const subject = { passportId: ANCHOR.anchor.subject, source: 'request-context' as const }
    const exact = await verifyPassportEvidence({ anchors: [{ lockingScript: ANCHOR.lockingScript, securedBytes: ANCHOR.representationBytes }] }, subject, { checkedAt: CHECKED_AT })
    expect(byName(exact, 'anchorDigestAndMetadataBinding').status).toBe('pass')
    expect(byName(exact, 'nativeAttestationSignature')).toMatchObject({ status: 'unknown', reasonCode: 'no-evidence' })
    const changed = ANCHOR.representationBytes.replace('"eventType":"Origin"', '"eventType":"Transfer"')
    const tampered = await verifyPassportEvidence({ anchors: [{ lockingScript: ANCHOR.lockingScript, securedBytes: changed }] }, subject, { checkedAt: CHECKED_AT })
    expect(byName(tampered, 'anchorDigestAndMetadataBinding')).toMatchObject({ status: 'fail', reasonCode: 'digest-mismatch' })
    const absent = await verifyPassportEvidence({ anchors: [{ lockingScript: ANCHOR.lockingScript }] }, subject, { checkedAt: CHECKED_AT })
    expect(byName(absent, 'anchorDigestAndMetadataBinding')).toMatchObject({ status: 'unknown', reasonCode: 'secured-bytes-absent' })
    expect(byName(absent, 'evidenceAvailability')).toMatchObject({ status: 'unknown', reasonCode: 'referenced-artefact-unavailable' })
  })

  it('fails metadata binding and subject binding for an anchor whose carried metadata disagrees with its claim', async () => {
    const wallet = new ProtoWallet(PrivateKey.fromHex(ANCHOR.anchoringPrivateKey))
    const script = await buildAttestationAnchor({ ...ANCHOR.anchor, subject: 'https://id.example.test/products/other' }, wallet)
    const report = await verifyPassportEvidence({ anchors: [{ lockingScript: script }], nativeClaims: [ANCHOR.claim] }, { passportId: ANCHOR.anchor.subject, source: 'request-context' }, { checkedAt: CHECKED_AT })
    expect(byName(report, 'anchorSignature').status).toBe('pass')
    expect(byName(report, 'anchorDigestAndMetadataBinding')).toMatchObject({ status: 'fail', reasonCode: 'metadata-mismatch', detail: [['subject']] })
    expect(byName(report, 'subjectBinding')).toMatchObject({ status: 'fail', reasonCode: 'subject-mismatch' })
  })

  it('leaves the external proof unknown, never not-applicable, for an external-representation anchor whose bytes were not supplied', async () => {
    const wallet = new ProtoWallet(PrivateKey.fromHex(ANCHOR.anchoringPrivateKey))
    const opaque = Utils.toArray('an external credential nobody supplied', 'utf8')
    const script = await buildAttestationAnchor({ ...ANCHOR.anchor, digest: Utils.toHex(Hash.sha256(opaque)), representation: 'x-unknown-format-v9', mediaType: 'application/octet-stream' }, wallet)
    const subject = { passportId: ANCHOR.anchor.subject, source: 'request-context' as const }
    const report = await verifyPassportEvidence({ anchors: [{ lockingScript: script }] }, subject, { checkedAt: CHECKED_AT })
    expect(byName(report, 'anchorSignature').status).toBe('pass')
    expect(byName(report, 'externalCredentialProof')).toMatchObject({ status: 'unknown', reasonCode: 'secured-bytes-absent' })
    const withBytes = await verifyPassportEvidence({ anchors: [{ lockingScript: script, securedBytes: opaque }] }, subject, { checkedAt: CHECKED_AT })
    expect(byName(withBytes, 'externalCredentialProof').status).toBe('unknown')
    expect(byName(withBytes, 'externalCredentialProof').reasonCode).not.toBe('secured-bytes-absent')
  })

  it('reports an anchor whose script is not hex as a failed finding instead of throwing', async () => {
    const subject = { passportId: ANCHOR.anchor.subject, source: 'request-context' as const }
    const report = await verifyPassportEvidence({ anchors: [{ lockingScript: 'not hex at all' }] }, subject, { checkedAt: CHECKED_AT })
    expect(byName(report, 'anchorSignature').status).not.toBe('pass')
    expect(byName(report, 'anchorKeyDerivation').status).not.toBe('pass')
    expect(JSON.stringify(report)).toContain('lockingScript is not hex')
  })

  it('separates a bad signature from a bad key derivation', async () => {
    const subject = { passportId: ANCHOR.anchor.subject, source: 'request-context' as const }
    const signatureFlipped = LockingScript.fromHex(ANCHOR.lockingScript)
    signatureFlipped.chunks[11].data![4] ^= 1
    const badSignature = await verifyPassportEvidence({ anchors: [{ lockingScript: signatureFlipped }] }, subject, { checkedAt: CHECKED_AT })
    expect(byName(badSignature, 'anchorSignature')).toMatchObject({ status: 'fail', reasonCode: 'signature-invalid' })
    expect(byName(badSignature, 'anchorKeyDerivation').status).toBe('pass')
    const wrongLock = LockingScript.fromHex(ANCHOR.lockingScript)
    wrongLock.chunks[0].data = PrivateKey.fromHex('66'.repeat(32)).toPublicKey().encode(true) as number[]
    const badDerivation = await verifyPassportEvidence({ anchors: [{ lockingScript: wrongLock }] }, subject, { checkedAt: CHECKED_AT })
    expect(byName(badDerivation, 'anchorKeyDerivation')).toMatchObject({ status: 'fail', reasonCode: 'key-derivation-mismatch' })
    expect(byName(badDerivation, 'anchorSignature').status).toBe('pass')
    const legacy = JSON.parse(readFileSync(new URL('../../../fixtures/anchor-v3.json', import.meta.url), 'utf8'))
    const notCurrent = await verifyPassportEvidence({ anchors: [{ lockingScript: legacy.lockingScript }] }, subject, { checkedAt: CHECKED_AT })
    expect(byName(notCurrent, 'anchorSignature')).toMatchObject({ status: 'fail', reasonCode: 'decode-failed' })
    expect(byName(notCurrent, 'anchorKeyDerivation')).toMatchObject({ status: 'unknown', reasonCode: 'decode-failed' })
  })

  it('indexes an unknown representation as a commitment and reports its content check unsupported', async () => {
    const wallet = new ProtoWallet(PrivateKey.fromHex(ANCHOR.anchoringPrivateKey))
    const bytes = Utils.toArray('opaque bytes of a format this verifier does not know', 'utf8')
    const script = await buildAttestationAnchor({ ...ANCHOR.anchor, digest: Utils.toHex(Hash.sha256(bytes)), representation: 'x-unknown-format-v9', mediaType: 'application/octet-stream', attestationType: 'Unknown' }, wallet)
    const report = await verifyPassportEvidence({ anchors: [{ lockingScript: script, securedBytes: bytes }] }, { passportId: ANCHOR.anchor.subject, source: 'request-context' }, { checkedAt: CHECKED_AT })
    expect(byName(report, 'anchorSignature').status).toBe('pass')
    expect(byName(report, 'anchorDigestAndMetadataBinding')).toMatchObject({ status: 'unknown', reasonCode: 'representation-unsupported' })
    expect(byName(report, 'externalCredentialProof')).toMatchObject({ status: 'unknown', reasonCode: 'verifier-not-supplied' })
  })

  it('applies the authority policy role by role and never infers it from the evidence', async () => {
    const subject = { passportId: ANCHOR.anchor.subject, source: 'request-context' as const }
    const evidence = { anchors: [{ lockingScript: ANCHOR.lockingScript }], nativeClaims: [ANCHOR.claim] }
    const permitted = await verifyPassportEvidence(evidence, subject, { checkedAt: CHECKED_AT, policyId: 'urn:test:policy:1', authority: { required: true, claimIssuers: [ANCHOR.claim.issuer], anchoringServices: [ANCHOR.anchor.anchoredBy] } })
    expect(byName(permitted, 'issuerAuthority').status).toBe('pass')
    expect(byName(permitted, 'issuerAuthority').evidenceRefs).toContain('urn:test:policy:1')
    const refused = await verifyPassportEvidence(evidence, subject, { checkedAt: CHECKED_AT, authority: { required: true, claimIssuers: ['did:key:zQ3sSomebodyElse'], anchoringServices: [ANCHOR.anchor.anchoredBy] } })
    expect(byName(refused, 'issuerAuthority')).toMatchObject({ status: 'fail', reasonCode: 'authority-unconfirmed' })
    const unlisted = await verifyPassportEvidence(evidence, subject, { checkedAt: CHECKED_AT, authority: { required: true, claimIssuers: [ANCHOR.claim.issuer] } })
    expect(byName(unlisted, 'issuerAuthority')).toMatchObject({ status: 'unknown', reasonCode: 'authority-unconfirmed' })
    const notRequired = await verifyPassportEvidence(evidence, subject, { checkedAt: CHECKED_AT, authority: { required: false, reason: 'a demonstration verifier checks signatures only' } })
    expect(byName(notRequired, 'issuerAuthority')).toMatchObject({ status: 'not-applicable', reasonCode: 'authority-not-required' })
    const genesis = await verifyPassportEvidence({ tokenHistory: chain }, asked, { checkedAt: CHECKED_AT, authority: { required: true, genesisIssuers: [F.makerKey] } })
    expect(byName(genesis, 'issuerAuthority').status).toBe('pass')
    const stranger = await verifyPassportEvidence({ tokenHistory: chain }, asked, { checkedAt: CHECKED_AT, authority: { required: true, genesisIssuers: [idKey(serverPriv)] } })
    expect(byName(stranger, 'issuerAuthority')).toMatchObject({ status: 'fail', reasonCode: 'authority-unconfirmed' })
  })

  it('routes external credentials through the supplied verifier and reports each check separately', async () => {
    const bytes = JSON.stringify({ stub: 'credential', product: ANCHOR.anchor.subject })
    const subject = { passportId: ANCHOR.anchor.subject, source: 'request-context' as const }
    const withVerifier = await verifyPassportEvidence({ externalCredentials: [{ representation: 'vsc-seal-json-v1', mediaType: 'application/vc+ld+json', bytes }] }, subject, {
      checkedAt: CHECKED_AT,
      credentialVerifier: async (input) => {
        expect(input.representation).toBe('vsc-seal-json-v1')
        expect(input.checkedAt).toBe(CHECKED_AT)
        return {
          id: 'urn:uuid:stub', issuer: 'did:web:issuer.example', subjects: [ANCHOR.anchor.subject], attestationType: 'VSC-SEAL',
          proof: { status: 'pass', evidenceRefs: ['did:web:issuer.example#key-1'] },
          schema: { status: 'pass' },
          time: { status: 'pass' },
          status: { status: 'unknown', reasonCode: 'status-unauthenticated', detail: { purpose: 'revocation', value: 'unknown' } },
          authority: { status: 'unknown', reasonCode: 'authority-unconfirmed' },
        }
      },
    })
    expect(statuses(withVerifier)).toMatchObject({
      externalCredentialProof: 'pass',
      schema: 'pass',
      credentialTime: 'pass',
      credentialStatus: 'unknown:status-unauthenticated',
      issuerAuthority: 'unknown:policy-missing',
      subjectBinding: 'pass',
    })
    const without = await verifyPassportEvidence({ externalCredentials: [{ representation: 'vsc-seal-json-v1', bytes }] }, subject, { checkedAt: CHECKED_AT })
    expect(byName(without, 'externalCredentialProof')).toMatchObject({ status: 'unknown', reasonCode: 'verifier-not-supplied' })
    expect(byName(without, 'credentialStatus')).toMatchObject({ status: 'unknown', reasonCode: 'verifier-not-supplied' })
  })

  it('binds a non-native anchor to the credential the verifier accepted, and only then', async () => {
    const bytes = JSON.stringify({ stub: 'credential', product: ANCHOR.anchor.subject })
    const digest = Utils.toHex(Hash.sha256(Utils.toArray(bytes, 'utf8')))
    const wallet = new ProtoWallet(PrivateKey.fromHex(ANCHOR.anchoringPrivateKey))
    const script = await buildAttestationAnchor({ ...ANCHOR.anchor, digest, attestationId: 'urn:uuid:stub', issuer: 'did:web:issuer.example', attestationType: 'VSC-SEAL', representation: 'vsc-seal-json-v1', mediaType: 'application/vc+ld+json' }, wallet)
    const verifier = (proof: 'pass' | 'fail') => async () => ({
      id: 'urn:uuid:stub', issuer: 'did:web:issuer.example', subjects: [ANCHOR.anchor.subject], attestationType: 'VSC-SEAL',
      proof: { status: proof, ...(proof === 'fail' ? { reasonCode: 'signature-invalid' } : {}) }, schema: { status: 'pass' }, time: { status: 'pass' }, status: { status: 'pass' }, authority: { status: 'pass' },
    } as const)
    const subject = { passportId: ANCHOR.anchor.subject, source: 'request-context' as const }
    const bound = await verifyPassportEvidence({ anchors: [{ lockingScript: script }], externalCredentials: [{ representation: 'vsc-seal-json-v1', bytes }] }, subject, { checkedAt: CHECKED_AT, credentialVerifier: verifier('pass') })
    expect(byName(bound, 'anchorDigestAndMetadataBinding').status).toBe('pass')
    const unproven = await verifyPassportEvidence({ anchors: [{ lockingScript: script }], externalCredentials: [{ representation: 'vsc-seal-json-v1', bytes }] }, subject, { checkedAt: CHECKED_AT, credentialVerifier: verifier('fail') })
    expect(byName(unproven, 'externalCredentialProof').status).toBe('fail')
    expect(byName(unproven, 'anchorDigestAndMetadataBinding')).toMatchObject({ status: 'unknown', reasonCode: 'referenced-artefact-mismatch' })
  })

  it('reports empty evidence as unknown everywhere it could not look', async () => {
    const report = await verifyPassportEvidence({}, asked, { checkedAt: CHECKED_AT })
    expect(report.suppliedTip).toBeNull()
    const unknowns = report.checks.filter((c) => c.status === 'unknown').map((c) => c.name)
    expect(unknowns).toHaveLength(14)
    expect(report.checks.filter((c) => c.status === 'pass')).toHaveLength(0)
    expect(byName(report, 'publisherSignatures').status).toBe('not-applicable')
    expect(byName(report, 'externalCredentialProof').status).toBe('not-applicable')
  })
})
