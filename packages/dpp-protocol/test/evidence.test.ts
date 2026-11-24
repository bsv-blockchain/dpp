import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Hash, LockingScript, PrivateKey, ProtoWallet, Transaction, Utils, type ChainTracker } from '@bsv/sdk'
import {
  EVIDENCE_CHECK_NAMES,
  buildAttestationAnchor,
  canonicalBytes,
  didKeyFromIdentityKey,
  lifecycleClaimBytes,
  lifecycleClaimDigest,
  signLifecycleClaim,
  verifyPassportEvidence,
  type EvidenceCheck,
  type EvidenceReport,
  type ExpectedSubject,
  type LatestStateObserver,
  type ObservationResult,
} from '../src/index.js'
import { nativeAnchorMetadataMismatches } from '../src/nativeAnchorBinding.js'
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
    expect(report.reportVersion).toBe('2')
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
      schema: 'unknown:profile-undeclared',
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

  it.each<[ObservationResult[], string]>([
    [['not-found'], 'unknown'],
    [['not-found', 'unavailable'], 'unknown'],
    [['unspent', 'unavailable'], 'unknown'],
    [['not-found', 'unspent'], 'unknown'],
    [['spent', 'not-found', 'unavailable'], 'superseded'],
    [['unspent', 'spent', 'unspent', 'unavailable'], 'conflicting'],
    [['unavailable', 'conflicting'], 'conflicting'],
  ])('combines the source results %j as %s and records every answer', async (results, expected) => {
    const observers: LatestStateObserver[] = results.map((result, i) => ({
      id: String(i), kind: 'spend-status', observe: async () => ({ result }),
    }))
    const report = await verifyPassportEvidence({ tokenHistory: chain.slice(0, 1) }, asked, { checkedAt: CHECKED_AT, observers })
    expect(report.observations.sources.map((source) => source.result)).toEqual(results)
    expect(report.observations.latestState).toBe(expected)
  })

  it('requires a supplied tip for an observed or superseded result', async () => {
    for (const result of ['unspent', 'spent'] as const) {
      const observers: LatestStateObserver[] = [{ id: 'a', kind: 'spend-status', observe: async () => ({ result }) }]
      const report = await verifyPassportEvidence({}, asked, { checkedAt: CHECKED_AT, observers })
      expect(report.suppliedTip).toBeNull()
      expect(report.observations.latestState).toBe('unknown')
    }
  })

  it('compares named spending transactions and keeps distinct candidate outpoints visible', async () => {
    const tip = { txid: F.states[0].txid, outputIndex: F.states[0].outputIndex }
    const successor = { txid: F.states[1].txid, outputIndex: F.states[1].outputIndex }
    const rival = { txid: 'ab'.repeat(32), outputIndex: 1 }
    type Answer = Awaited<ReturnType<LatestStateObserver['observe']>>
    const observe = async (...answers: Answer[]) => {
      const observers: LatestStateObserver[] = answers.map((answer, i) => ({
        id: String(i), kind: 'spend-status', observe: async () => answer,
      }))
      return (await verifyPassportEvidence({ tokenHistory: chain.slice(0, 1) }, asked, { checkedAt: CHECKED_AT, observers })).observations
    }
    const spent: Answer = { result: 'spent', spendingTxid: successor.txid, candidateOutpoints: [successor] }
    expect(await observe(spent, spent, { result: 'spent' })).toMatchObject({ latestState: 'superseded', candidateOutpoints: [tip, successor] })
    expect((await observe(spent, { result: 'spent', spendingTxid: rival.txid })).latestState).toBe('conflicting')
    expect(await observe({ result: 'spent', candidateOutpoints: [successor, rival] })).toMatchObject({ latestState: 'conflicting', candidateOutpoints: [tip, successor, rival] })
    expect((await observe({ result: 'unspent', candidateOutpoints: [rival] })).latestState).toBe('conflicting')
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

  it('retains an interrupted history tip without reporting a fork with the only complete history', async () => {
    const interrupted = chain.filter((_, i) => i !== 2)
    const report = await verifyPassportEvidence({ tokenHistory: interrupted, alternativeHistories: [chain] }, asked, { checkedAt: CHECKED_AT })
    expect(byName(report, 'linkage').status).toBe('fail')
    expect(report.observations).toMatchObject({
      latestState: 'unknown',
      candidateOutpoints: [
        { txid: F.states[3].txid, outputIndex: F.states[3].outputIndex },
        { txid: F.states[5].txid, outputIndex: F.states[5].outputIndex },
      ],
    })
    expect(report.limits.some((l) => l.includes('Two valid successors'))).toBe(false)
  })

  it('keeps repeated histories and different lengths of one valid history on a single branch', async () => {
    const prefix = chain.slice(0, 2)
    const report = await verifyPassportEvidence({ tokenHistory: prefix, alternativeHistories: [prefix, chain, chain] }, asked, { checkedAt: CHECKED_AT })
    expect(byName(report, 'linkage').status).toBe('pass')
    expect(byName(report, 'subjectBinding').status).toBe('pass')
    expect(report.observations).toMatchObject({
      latestState: 'unknown',
      candidateOutpoints: [
        { txid: F.states[1].txid, outputIndex: F.states[1].outputIndex },
        { txid: F.states[5].txid, outputIndex: F.states[5].outputIndex },
      ],
    })
    expect(report.limits.some((l) => l.includes('Two valid successors'))).toBe(false)
  })

  it('reports two distinct valid successors in the alternatives even with no primary history', async () => {
    const fixture = JSON.parse(readFileSync(new URL('../../../fixtures/evidence-v2.json', import.meta.url), 'utf8')) as {
      cases: Array<{ id: string; evidence: { tokenHistory: string[]; alternativeHistories: string[][] }; expectedSubject: ExpectedSubject }>
    }
    const fork = fixture.cases.find((c) => c.id === 'v2-fork')!
    const branches = [fork.evidence.tokenHistory, ...fork.evidence.alternativeHistories].map((raw) => raw.map((hex) => Transaction.fromHex(hex)))
    const report = await verifyPassportEvidence({ alternativeHistories: branches }, fork.expectedSubject, { checkedAt: CHECKED_AT })
    expect(report.suppliedTip).toBeNull()
    expect(report.observations.latestState).toBe('conflicting')
    expect(report.observations.candidateOutpoints.map((p) => p.txid)).toEqual(branches.map((branch) => branch.at(-1)!.id('hex')))
    expect(report.limits.some((l) => l.includes('Two valid successors'))).toBe(true)
    expect(byName(report, 'subjectBinding').reasonCode).not.toBe('genesis-ambiguous')
  })

  it('counts each valid rival genesis once when only alternative histories were supplied', async () => {
    const rival = stateTx(await signedState(makeData({ timestamp: '2026-06-11T12:00:01Z' })), makerPriv.toPublicKey())
    const report = await verifyPassportEvidence({ alternativeHistories: [chain, [rival], [rival]] }, asked, { checkedAt: CHECKED_AT })
    expect(report.observations.latestState).toBe('conflicting')
    expect(report.observations.candidateOutpoints).toHaveLength(2)
    expect(report.limits.some((l) => l.includes('Two valid successors'))).toBe(false)
    expect(byName(report, 'subjectBinding')).toMatchObject({
      status: 'unknown', reasonCode: 'genesis-ambiguous', evidenceRefs: [F.states[0].txid + ':0', rival.id('hex') + ':0'],
      detail: [{ reasonCode: 'genesis-ambiguous', detail: '2 valid genesis records carry this passport identifier' }],
    })
  })

  describe('subject expectations with alternative histories', () => {
    const genesis = { txid: F.states[0].txid, outputIndex: 0 }
    const tip = { txid: F.states[5].txid, outputIndex: F.states[5].outputIndex }
    const claimRef = 'sha256:' + ANCHOR.digest
    const read = async (alternatives: Transaction[][], pins: Partial<ExpectedSubject>, claims: unknown[] = [], primary?: Transaction[]) => {
      const report = await verifyPassportEvidence({ tokenHistory: primary, alternativeHistories: alternatives, nativeClaims: claims }, { ...asked, ...pins }, { checkedAt: CHECKED_AT })
      return byName(report, 'subjectBinding')
    }

    it('compares a trusted genesis with the two actual alternatives even when a native claim matches the passport', async () => {
      const rival = stateTx(await signedState(makeData({ timestamp: '2026-06-11T12:00:01Z' })), makerPriv.toPublicKey())
      const branches = [chain, [rival], [rival]]
      const refs = [F.states[0].txid + ':0', rival.id('hex') + ':0', claimRef]
      expect(await read(branches, { source: 'none', expectedGenesisOutpoint: genesis }, [ANCHOR.claim])).toMatchObject({ status: 'unknown', reasonCode: 'subject-not-independent', evidenceRefs: [] })
      expect(await read(branches, {}, [ANCHOR.claim])).toMatchObject({ status: 'unknown', reasonCode: 'genesis-ambiguous', evidenceRefs: refs })
      for (const selected of [genesis, { txid: rival.id('hex'), outputIndex: 0 }]) {
        expect(await read(branches, { expectedGenesisOutpoint: selected }, [ANCHOR.claim])).toMatchObject({ status: 'pass', evidenceRefs: refs })
      }
      expect(await read(branches, { expectedGenesisOutpoint: tip }, [ANCHOR.claim])).toMatchObject({ status: 'fail', reasonCode: 'genesis-mismatch', evidenceRefs: refs })
    })

    it('checks the only eligible alternative against the requested genesis, issuer and exact tip', async () => {
      const pins = { expectedGenesisOutpoint: genesis, expectedIssuer: F.makerKey, expectedStateOutpoint: tip }
      expect(await read([chain], pins)).toMatchObject({ status: 'pass', evidenceRefs: [genesis.txid + ':0', tip.txid + ':' + tip.outputIndex] })
      expect(await read([chain], { ...pins, expectedIssuer: didKeyFromIdentityKey(F.makerKey) })).toMatchObject({ status: 'pass' })
      expect(await read([chain], { ...pins, expectedGenesisOutpoint: tip })).toMatchObject({ status: 'fail', reasonCode: 'genesis-mismatch' })
      expect(await read([chain], { ...pins, expectedIssuer: F.owner1Key })).toMatchObject({ status: 'fail', reasonCode: 'issuer-mismatch' })
      expect(await read([chain], { ...pins, expectedStateOutpoint: genesis })).toMatchObject({ status: 'fail', reasonCode: 'state-mismatch' })
      expect(await read([chain.filter((_, index) => index !== 2)], { expectedGenesisOutpoint: genesis }, [ANCHOR.claim])).toMatchObject({ status: 'unknown', reasonCode: 'no-evidence' })
    })

    it('requires the selected genesis, issuer and tip to belong to the same history', async () => {
      const rival = stateTx(await signedState(makeData({ actorIdentityKey: idKey(serverPriv) }), new ProtoWallet(serverPriv)), makerPriv.toPublicKey())
      const branches = [chain, [rival]]
      const rivalGenesis = { txid: rival.id('hex'), outputIndex: 0 }
      expect(await read(branches, { expectedGenesisOutpoint: rivalGenesis, expectedIssuer: idKey(serverPriv), expectedStateOutpoint: rivalGenesis })).toMatchObject({ status: 'pass' })
      expect(await read(branches, { expectedGenesisOutpoint: rivalGenesis, expectedIssuer: F.makerKey })).toMatchObject({ status: 'fail', reasonCode: 'issuer-mismatch' })
      expect(await read(branches, { expectedGenesisOutpoint: rivalGenesis, expectedStateOutpoint: tip })).toMatchObject({ status: 'fail', reasonCode: 'state-mismatch' })
      expect(await read([[rival]], { expectedGenesisOutpoint: rivalGenesis }, [], chain)).toMatchObject({ status: 'fail', reasonCode: 'genesis-mismatch' })
      expect(await read([chain], { expectedStateOutpoint: tip }, [], chain.filter((_, index) => index !== 2))).toMatchObject({ status: 'fail', reasonCode: 'state-mismatch' })
    })

    it('compares a signed native state reference without inferring a genesis from it', async () => {
      expect(await read([], { expectedGenesisOutpoint: genesis }, [ANCHOR.claim])).toMatchObject({ status: 'unknown', reasonCode: 'no-evidence' })
      expect(await read([], { expectedStateOutpoint: genesis }, [ANCHOR.claim])).toMatchObject({ status: 'pass' })
      expect(await read([], { expectedStateOutpoint: tip }, [ANCHOR.claim])).toMatchObject({ status: 'fail', reasonCode: 'state-mismatch' })
      expect(await read([], { expectedStateOutpoint: { ...genesis, outputIndex: 1 } }, [ANCHOR.claim])).toMatchObject({ status: 'fail', reasonCode: 'state-mismatch' })
    })

    it('compares each signed recordId on an exact-state read and accepts earlier claims on a passport-level read', async () => {
      const wallet = new ProtoWallet(PrivateKey.fromHex(ANCHOR.issuerPrivateKey))
      const tipClaim = await signLifecycleClaim({ ...ANCHOR.unsignedClaim, recordId: tip.txid + ':' + tip.outputIndex }, wallet)
      for (const primary of [undefined, chain]) {
        const alternatives = primary == null ? [chain] : []
        expect(await read(alternatives, {}, [ANCHOR.claim, tipClaim], primary)).toMatchObject({ status: 'pass' })
        expect(await read(alternatives, { expectedStateOutpoint: tip }, [tipClaim], primary)).toMatchObject({ status: 'pass' })
        expect(await read(alternatives, { expectedStateOutpoint: tip }, [ANCHOR.claim, tipClaim], primary)).toMatchObject({ status: 'fail', reasonCode: 'state-mismatch' })
      }
    })

    it('retains the identity and limited precision of a historical transaction-only signed claim', async () => {
      const historical = { ...ANCHOR.unsignedClaim, recordId: genesis.txid }
      const wallet = new ProtoWallet(PrivateKey.fromHex(ANCHOR.issuerPrivateKey))
      const { signature } = await wallet.createSignature({ data: canonicalBytes(historical), protocolID: [1, 'dpp attestation v1'], keyID: historical.passportId, counterparty: 'anyone' })
      const signed = { ...historical, signature: Utils.toHex(signature) }
      for (const primary of [undefined, [chain[0]]]) {
        expect(await read([], {}, [signed], primary)).toMatchObject({ status: 'pass' })
        expect(await read([], { expectedStateOutpoint: genesis }, [signed], primary)).toMatchObject({ status: 'unknown', reasonCode: 'no-evidence' })
        expect(await read([], { expectedStateOutpoint: tip }, [signed], primary)).toMatchObject({ status: 'fail', reasonCode: 'state-mismatch' })
      }
    })
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
    expect(byName(tampered, 'evidenceAvailability')).toMatchObject({
      status: 'fail', reasonCode: 'referenced-artefact-mismatch',
      evidenceRefs: byName(tampered, 'anchorDigestAndMetadataBinding').evidenceRefs,
    })
    const absent = await verifyPassportEvidence({ anchors: [{ lockingScript: ANCHOR.lockingScript }] }, subject, { checkedAt: CHECKED_AT })
    expect(byName(absent, 'anchorDigestAndMetadataBinding')).toMatchObject({ status: 'unknown', reasonCode: 'secured-bytes-absent' })
    expect(byName(absent, 'evidenceAvailability')).toMatchObject({ status: 'unknown', reasonCode: 'referenced-artefact-unavailable' })
  })

  it('compares the complete signed representation when a decoded claim and exact bytes are both supplied', async () => {
    const battery = JSON.parse(readFileSync(new URL('../../../fixtures/battery-lifecycle-v1.json', import.meta.url), 'utf8')).states[0].claim
    const subject = { passportId: ANCHOR.claim.passportId, source: 'request-context' as const }
    const report = async (securedBytes: number[]) => verifyPassportEvidence({
      nativeClaims: [ANCHOR.claim],
      anchors: [{ lockingScript: ANCHOR.lockingScript, securedBytes }],
    }, subject, { checkedAt: CHECKED_AT })

    const aligned = await report(lifecycleClaimBytes(ANCHOR.claim))
    expect(byName(aligned, 'anchorDigestAndMetadataBinding').status).toBe('pass')
    const other = await report(lifecycleClaimBytes(battery))
    expect(byName(other, 'nativeAttestationSignature').status).toBe('pass')
    expect(byName(other, 'anchorDigestAndMetadataBinding')).toMatchObject({
      status: 'fail', reasonCode: 'digest-mismatch',
      evidenceRefs: expect.arrayContaining([`sha256:${ANCHOR.digest}`, `sha256:${lifecycleClaimDigest(battery)}`]),
    })
  })

  it('compares the native registry identifier with the verified signed claim digest', () => {
    const digest = lifecycleClaimDigest(ANCHOR.claim)
    const content = ANCHOR.anchor
    expect(nativeAnchorMetadataMismatches(content, ANCHOR.claim, digest)).toEqual([])
    // The digest label used in report evidence references belongs to a different identifier scheme.
    expect(nativeAnchorMetadataMismatches({ ...content, attestationId: `sha256:${digest}` }, ANCHOR.claim, digest)).toEqual(['attestationId'])
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

  it('requires verified subject and issuer information before affirming an external credential binding', async () => {
    const checked = { status: 'pass' as const }
    const expected = { ...asked, expectedIssuer: 'did:web:maker.example' }
    const evidence = { externalCredentials: [{ representation: 'fixture', bytes: 'issued bytes' }] }
    const read = async (subjects?: string[], issuer?: string, proof: 'pass' | 'fail' = 'pass') => {
      const report = await verifyPassportEvidence(evidence, expected, {
        credentialVerifier: async () => ({ subjects, issuer, proof: { status: proof }, schema: checked, time: checked, status: checked, authority: checked }),
      })
      return byName(report, 'subjectBinding')
    }
    expect(await read([passportId], expected.expectedIssuer)).toMatchObject({ status: 'pass' })
    expect(await read([passportId], 'did:web:other.example')).toMatchObject({ status: 'fail', reasonCode: 'issuer-mismatch' })
    expect(await read(['urn:other'], expected.expectedIssuer)).toMatchObject({ status: 'fail', reasonCode: 'subject-mismatch' })
    expect(await read(undefined, expected.expectedIssuer)).toMatchObject({ status: 'unknown', reasonCode: 'no-evidence' })
    expect(await read([passportId], undefined)).toMatchObject({ status: 'unknown', reasonCode: 'no-evidence' })
    expect(await read([passportId], expected.expectedIssuer, 'fail')).toMatchObject({ status: 'unknown' })
    const unavailable = await verifyPassportEvidence({ ...evidence, nativeClaims: [ANCHOR.claim] }, { ...asked, expectedIssuer: ANCHOR.claim.issuer }, { checkedAt: CHECKED_AT })
    expect(byName(unavailable, 'nativeAttestationSignature')).toMatchObject({ status: 'pass' })
    expect(byName(unavailable, 'externalCredentialProof')).toMatchObject({ status: 'unknown', reasonCode: 'verifier-not-supplied' })
    expect(byName(unavailable, 'subjectBinding')).toMatchObject({ status: 'unknown', reasonCode: 'no-evidence' })
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

  it('judges a credential anchored once per subject on what concerns the passport being read', async () => {
    const others = ['https://id.example.test/products/second', 'https://id.example.test/products/third']
    const subjects = [ANCHOR.anchor.subject, ...others]
    const bytes = JSON.stringify({ stub: 'credential', products: subjects })
    const digest = Utils.toHex(Hash.sha256(Utils.toArray(bytes, 'utf8')))
    const wallet = new ProtoWallet(PrivateKey.fromHex(ANCHOR.anchoringPrivateKey))
    const anchorFor = async (subject: string) => ({ lockingScript: await buildAttestationAnchor({ ...ANCHOR.anchor, subject, digest, attestationId: 'urn:uuid:stub', issuer: 'did:web:issuer.example', attestationType: 'VSC-SEAL', representation: 'vsc-seal-json-v1', mediaType: 'application/vc+ld+json' }, wallet) })
    const anchors = await Promise.all(subjects.map(anchorFor))
    const verifier = (named: string[], proof: 'pass' | 'fail' = 'pass') => async () => ({
      id: 'urn:uuid:stub', issuer: 'did:web:issuer.example', subjects: named, attestationType: 'VSC-SEAL',
      proof: { status: proof, ...(proof === 'fail' ? { reasonCode: 'signature-invalid' } : {}) }, schema: { status: 'pass' }, time: { status: 'pass' }, status: { status: 'pass' }, authority: { status: 'pass' },
    } as const)
    const read = async (supplied: typeof anchors, passportId: string, credentialVerifier = verifier(subjects)) =>
      await verifyPassportEvidence({ anchors: supplied, externalCredentials: [{ representation: 'vsc-seal-json-v1', bytes }] }, { passportId, source: 'request-context' }, { checkedAt: CHECKED_AT, credentialVerifier })

    // Every anchor of the credential supplied, read from each subject in turn: the anchors for the other subjects are no mismatch.
    for (const passportId of subjects) {
      const report = await read(anchors, passportId)
      expect(byName(report, 'anchorDigestAndMetadataBinding').status, passportId).toBe('pass')
      expect(byName(report, 'subjectBinding'), passportId).toMatchObject({ status: 'pass', detail: { otherSubjects: subjects.filter((s) => s !== passportId) } })
    }
    // Only the anchor for the passport being read: a pass with nothing set aside.
    expect(byName(await read(anchors.slice(0, 1), ANCHOR.anchor.subject), 'subjectBinding')).not.toHaveProperty('detail')
    // An anchor that names a subject the credential does not name stays a mismatch.
    const stray = await anchorFor('https://id.example.test/products/unnamed')
    expect(byName(await read([...anchors, stray], ANCHOR.anchor.subject), 'subjectBinding')).toMatchObject({ status: 'fail', reasonCode: 'subject-mismatch', detail: [{ reasonCode: 'subject-mismatch', detail: expect.stringContaining('products/unnamed') }] })
    // An anchor that names the passport being read while the credential does not name it: the anchor disagrees with the credential, and both checks fail.
    const disagreeing = await read(anchors, ANCHOR.anchor.subject, verifier(others))
    expect(byName(disagreeing, 'anchorDigestAndMetadataBinding')).toMatchObject({ status: 'fail', reasonCode: 'metadata-mismatch' })
    expect(byName(disagreeing, 'subjectBinding')).toMatchObject({ status: 'fail', reasonCode: 'subject-mismatch' })
    // A credential none of whose subjects is the passport being read, with only its own anchors.
    expect(byName(await read(anchors.slice(1), ANCHOR.anchor.subject, verifier(others)), 'subjectBinding')).toMatchObject({ status: 'fail', reasonCode: 'subject-mismatch' })
    // A credential whose proof does not hold names nothing that could excuse an anchor.
    expect(byName(await read(anchors, ANCHOR.anchor.subject, verifier(subjects, 'fail')), 'subjectBinding')).toMatchObject({ status: 'fail', reasonCode: 'subject-mismatch' })
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

describe('the schema check over token payloads (spec/verification.md §4, spec/profiles.md §3)', () => {
  const asked: ExpectedSubject = { passportId: 'https://dpp.bsvb.net/01/09521000000018/21/SCHEMA-0001', source: 'request-context' }
  const declared = JSON.stringify({ profile: 'general', profile_version: 2, name: 'Chair' })
  async function lineage(payloadPublic: string): Promise<Transaction[]> {
    const s0 = await signedState(makeData({ passportId: asked.passportId, payloadPublic }))
    return [stateTx(s0, serverPriv.toPublicKey())]
  }

  it('hands each state that declares a profile to the policy validator and reports its answer', async () => {
    const seen: Array<{ profile: string; profileVersion: number; stateIndex: number }> = []
    const chain = await lineage(declared)
    const report = await verifyPassportEvidence({ tokenHistory: chain }, asked, {
      checkedAt: CHECKED_AT, chainTracker: 'scripts only',
      payloadValidator: async (p) => { seen.push({ profile: p.profile, profileVersion: p.profileVersion, stateIndex: p.stateIndex }); return { status: 'fail', reasonCode: 'schema-invalid', detail: ['the payload is missing the required field `category`.'] } },
    })
    expect(seen).toEqual([{ profile: 'general', profileVersion: 2, stateIndex: 0 }])
    const schema = report.checks.find((c) => c.name === 'schema')!
    expect(schema.status).toBe('fail')
    expect(schema.reasonCode).toBe('schema-invalid')
    expect(schema.evidenceRefs).toEqual([`${chain[0].id('hex')}:0`])
  })

  // A second state that spends the first, so the validator is asked about a
  // genesis and about a state that follows one.
  async function lineageOfTwo(first: { passportId: string; payloadPublic: string }, second: { passportId: string; payloadPublic: string }): Promise<Transaction[]> {
    const s0 = await signedState(makeData(first))
    const tx0 = stateTx(s0, serverPriv.toPublicKey())
    const s1 = await signedState(makeData({ ...second, op: 'SOLD', timestamp: '2026-06-12T09:30:00Z', previousTxid: tx0.id('hex') }))
    return [tx0, stateTx(s1, serverPriv.toPublicKey(), { tx: tx0, outputIndex: 0 })]
  }

  it('hands the validator the passportId of the decoded state, for the genesis and for a later state', async () => {
    const seen: Array<{ stateIndex: number; passportId: string }> = []
    const chain = await lineageOfTwo({ passportId: asked.passportId, payloadPublic: declared }, { passportId: asked.passportId, payloadPublic: declared })
    const report = await verifyPassportEvidence({ tokenHistory: chain }, asked, {
      checkedAt: CHECKED_AT, chainTracker: 'scripts only',
      payloadValidator: async (p) => { seen.push({ stateIndex: p.stateIndex, passportId: p.passportId }); return { status: 'pass' } },
    })
    expect(seen).toEqual([{ stateIndex: 0, passportId: asked.passportId }, { stateIndex: 1, passportId: asked.passportId }])
    expect(statuses(report).linkage).toBe('pass')
    expect(statuses(report).schema).toBe('pass')
  })

  it('takes the passportId from each decoded state, never from the payload, the question asked or the outpoint', async () => {
    // Four different identifiers, so each wrong source gives a different wrong
    // answer: the genesis names one passport, its payload claims another, the
    // second state names a third and the caller asks about a fourth.
    const inGenesis = 'https://dpp.bsvb.net/01/09521000000018/21/STATE-0'
    const inPayload = 'https://dpp.bsvb.net/01/09521000000018/21/PAYLOAD'
    const inSecondState = 'https://dpp.bsvb.net/01/09521000000018/21/STATE-1'
    const question: ExpectedSubject = { passportId: 'https://dpp.bsvb.net/01/09521000000018/21/ASKED', source: 'request-context' }
    const decoy = JSON.stringify({ profile: 'general', profile_version: 2, name: 'Chair', passportId: inPayload, passport_id: inPayload })
    const chain = await lineageOfTwo({ passportId: inGenesis, payloadPublic: decoy }, { passportId: inSecondState, payloadPublic: decoy })
    const seen: Array<{ stateIndex: number; passportId: string; ref: string }> = []
    const report = await verifyPassportEvidence({ tokenHistory: chain }, question, {
      checkedAt: CHECKED_AT, chainTracker: 'scripts only',
      payloadValidator: async (p) => { seen.push({ stateIndex: p.stateIndex, passportId: p.passportId, ref: p.ref }); return { status: 'pass' } },
    })
    expect(seen.map((s) => s.passportId)).toEqual([inGenesis, inSecondState])
    expect(seen.map((s) => s.ref)).toEqual([`${chain[0].id('hex')}:0`, `${chain[1].id('hex')}:0`])
    // The second state is examined although it does not continue the first,
    // and the report says so on its own checks: the validator's input never
    // stands in for linkage or subject binding.
    expect(statuses(report).linkage).toMatch(/^fail:/)
    expect(statuses(report).subjectBinding).toMatch(/^fail:/)
  })

  it('reports the same for a validator that reads only the profile and the payload', async () => {
    const chain = await lineage(declared)
    const policy = { checkedAt: CHECKED_AT, chainTracker: 'scripts only' as const }
    // The shape a validator written before passportId existed takes.
    const older = async (p: { profile: string; profileVersion: number; payloadPublic: string }): Promise<{ status: 'pass' | 'fail' }> =>
      p.profile === 'general' && p.profileVersion === 2 && p.payloadPublic === declared ? { status: 'pass' } : { status: 'fail' }
    const report = await verifyPassportEvidence({ tokenHistory: chain }, asked, { ...policy, payloadValidator: older })
    expect(statuses(report).schema).toBe('pass')
    expect(report).toEqual(await verifyPassportEvidence({ tokenHistory: chain }, asked, { ...policy, payloadValidator: async () => ({ status: 'pass' }) }))
  })

  it('passes when the validator passes, and reads schema-unavailable without one', async () => {
    const chain = await lineage(declared)
    const passed = await verifyPassportEvidence({ tokenHistory: chain }, asked, { checkedAt: CHECKED_AT, chainTracker: 'scripts only', payloadValidator: async () => ({ status: 'pass' }) })
    expect(statuses(passed).schema).toBe('pass')
    const without = await verifyPassportEvidence({ tokenHistory: chain }, asked, { checkedAt: CHECKED_AT, chainTracker: 'scripts only' })
    expect(statuses(without).schema).toBe('unknown:schema-unavailable')
  })

  it('reads profile-undeclared for a payload without the stamps, and never calls the validator for it', async () => {
    let calls = 0
    const chain = await lineage(JSON.stringify({ name: 'Chair' }))
    const report = await verifyPassportEvidence({ tokenHistory: chain }, asked, { checkedAt: CHECKED_AT, chainTracker: 'scripts only', payloadValidator: async () => { calls += 1; return { status: 'pass' } } })
    expect(calls).toBe(0)
    expect(statuses(report).schema).toBe('unknown:profile-undeclared')
    expect(report.limits).toContain('schema was not established: profile-undeclared.')
  })
})
