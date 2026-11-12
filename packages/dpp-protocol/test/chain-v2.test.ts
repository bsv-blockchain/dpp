import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CachedKeyDeriver, ProtoWallet, PublicKey, Transaction, Utils } from '@bsv/sdk'
import {
  ACCEPTANCE_COMMITMENT_REFUSAL,
  CONTROL_REFUSALS,
  acceptanceCommitment,
  checkGenesisState,
  checkTransition,
  completeState,
  inspectChain,
  verifyChain,
  verifyOwnerLinkage,
  verifyPassportEvidence,
  type DppState,
  type DppStateDataV2,
} from '../src/index.js'
import { authorityPriv, custodianPriv, idKey, issuerPriv, recipientPriv, stateTxV2, strangerPriv } from './helpers-v2.js'
import { CHAIN_V1_FIXTURE } from './chain-v1-fixture.js'

/**
 * The UPDATE the parked holder instruction rule refused: the recipient's
 * UPDATE after the committed TRANSFER, by linkage from the recipient's managed
 * identity, with an empty authorisation_commitment. It was a refusal of the
 * chain fixture until the instruction record was parked on 12 November 2026
 * (docs/reference/parked/managed-instruction/), and is held here to be a valid
 * chain under the acceptance rule, which is what the profile now says.
 */
const PARKED_INSTRUCTION_UPDATE = {
  name: 'updateAfterTransferWithoutInstruction',
  description:
    "The recipient's UPDATE after the committed TRANSFER, by linkage from the recipient's managed identity, with an empty authorisation_commitment: valid under the record model and the acceptance rule, refused when the profile's instruction rule is selected.",
  appendAfter: 2,
  rawTx:
    '0100000001b7a84fd74d3183bd8bb5e5eba376736192ee07002d3d5e46399481b77dc89a080100000000ffffffff010100000000000000fd84022102466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27ac0364707001323168747470733a2f2f6470702e627376622e6e65742f30312f30393532313030303030303031382f32312f56322d303030310655504441544514323032362d31302d30315430383a33303a30305a21033712c6cba3efdeb5ebbd3bcfd11826eb1a358148d2a305ba97b5a353f49b181f21023c72addb4fdf09af94f0c94d7fe92a386a7e70cf8a1d85916386bb2535c7b1b111726563697069656e74206163636f756e74357b226576656e7454797065223a225472616e73666f726d6174696f6e222c226e6f7465223a2263656c6c2062616c616e636564227d4c5a7b226e616d65223a2243656c6c207061636b203430222c226368656d6973747279223a224c4650222c226461746143617272696572223a2256322d5549442d30303031222c2272656379636c6564436f6e74656e74223a31327d20c0708a9a0bc30dd1c4218e90d3ec97303bcef25172c30aa5a8c37392e6e4727b24a39a87ffca417b00b37db34de4a221edbda928def1356c9db29dd78241749d270000000024089ac87db7819439465e3d2d0007ee92617376a3ebe5b58bbd83314dd74fa8b700000001203fcfde23c63c7f9f2b89aa80b333d973f0857ef07e55510ea80900dff9a9a3df00473045022100b2d4053e44b86b8ed65a3a965077aafb315f4d0ac2968d6422bae942b86cfbcc02200112d5a1f3ca9f0088ef7383191370cfc84ecabfbf2a650f81c9691e05b0bea9463044022066efd5e2e90b11e5b4f6e35df2f5e9659ae141a301291193b8ec398a2ef0b321022041d329d74298f02ea67baec7139556fde52da66ffc8253884c8158c65d423e396d6d6d6d6d6d6d6d7500000000',
}

/**
 * The chain-v2 fixture is the wire contract for the version 2 chain
 * invariants, control, retirement, the managed-custody profile and the
 * upgrade. These tests read the published JSON the way an external reader
 * does: every valid transaction is rebuilt from `states[].data` and the test
 * keys, and every refusal is refused from raw hex alone, under the option the
 * vector names, and accepted where the fixture says it is.
 */
const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures')
const F = JSON.parse(readFileSync(join(FIXTURES, 'chain-v2.json'), 'utf8'))
const raw: string[] = F.states.map((s: { rawTx: string }) => s.rawTx)
const fromHex = (hexes: string[]) => hexes.map((h) => Transaction.fromHex(h))
const prefixPlus = (r: { appendAfter: number; rawTx: string }) => [...raw.slice(0, r.appendAfter + 1), r.rawTx]
const refusal = (name: string) => {
  const r = F.refusals.find((x: { name: string }) => x.name === name)
  if (r == null) throw new Error(`no refusal ${name}`)
  return r as { name: string; appendAfter: number; rawTx: string; error: string; managedAcceptance?: true; acceptedUnder?: { authorities: string[] } }
}

describe('chain-v2 fixture: the writer reproduces every byte', () => {
  it('pins the cast, the controller keys and the linkage scalars', () => {
    expect(idKey(issuerPriv)).toBe(F.issuerKey)
    expect(idKey(custodianPriv)).toBe(F.custodianKey)
    expect(idKey(recipientPriv)).toBe(F.recipientKey)
    expect(idKey(strangerPriv)).toBe(F.strangerKey)
    expect(idKey(authorityPriv)).toBe(F.authorityKey)
    expect(verifyOwnerLinkage(F.issuerKey, F.issuerControllerKey, F.issuerControlLinkage)).toBe(true)
    expect(verifyOwnerLinkage(F.recipientKey, F.recipientControllerKey, F.recipientControlLinkage)).toBe(true)
    expect(F.states[0].data.ownerIdentityKey).toBe(F.issuerControllerKey)
    expect(F.states[2].data.ownerIdentityKey).toBe(F.recipientControllerKey)
  })

  it('rebuilds every state, signature, script, transaction and identifier from the data and the keys', async () => {
    const wallets: Record<string, ProtoWallet> = {
      issuer: new ProtoWallet(issuerPriv),
      recipient: new ProtoWallet(recipientPriv),
      'recipient-controller': new ProtoWallet(new CachedKeyDeriver(recipientPriv).derivePrivateKey(F.ownerProtocol, F.states[0].data.passportId, 'self')),
    }
    const custodian = new ProtoWallet(custodianPriv)
    const txs: Transaction[] = []
    for (const [i, s] of F.states.entries()) {
      const state = await completeState(s.data as DppStateDataV2, wallets[s.actor], custodian)
      expect(Utils.toHex(state.userSignature)).toBe(s.actorSignature)
      expect(Utils.toHex(state.serverSignature)).toBe(s.publisherSignature)
      const prev = i === 0 ? undefined : { tx: txs[i - 1], outputIndex: F.states[i - 1].outputIndex }
      const tx = stateTxV2(state, PublicKey.fromString(s.lockingKey), prev, s.outputIndex === 1)
      expect(tx.outputs[s.outputIndex].lockingScript.toHex()).toBe(s.lockingScript)
      expect(tx.toHex()).toBe(s.rawTx)
      expect(tx.id('hex')).toBe(s.txid)
      txs.push(tx)
    }
    expect(F.states.map((s: { data: { op: string } }) => s.data.op)).toEqual(['ISSUE', 'UPDATE', 'TRANSFER', 'UPDATE', 'RETIRE'])
    expect(F.states.map((s: { outputIndex: number }) => s.outputIndex)).toEqual([0, 0, 1, 0, 0])
  })

  it('the TRANSFER commits to the pinned acceptance record', () => {
    expect(F.states[2].data.authorisationCommitment).toBe(acceptanceCommitment(F.acceptance))
    expect(F.acceptance.acceptance.destinationKey).toBe(F.states[2].data.ownerIdentityKey)
    expect(F.acceptance.expectedPredecessor).toEqual({ txid: F.states[1].txid, outputIndex: 0 })
  })
})

describe('chain-v2 fixture: the reader accepts the lineage and verifies it', () => {
  it('verifies from raw hex alone, control proven on every non-genesis state', async () => {
    const inspection = await inspectChain(fromHex(raw), { chainTracker: 'scripts only' })
    expect(inspection.failure).toBeUndefined()
    expect(inspection.complete).toBe(true)
    expect(inspection.states.map((s) => s.version)).toEqual(['2', '2', '2', '2', '2'])
    expect(inspection.states.map((s) => s.controlValid)).toEqual([null, true, true, true, true])
  })

  it('verifies every publisher signature against the custodian key, under the managed-custody profile', async () => {
    const result = await verifyChain(fromHex(raw), { chainTracker: 'scripts only', serverIdentityKey: F.custodianKey, managedAcceptance: true })
    expect(result.error).toBeUndefined()
    expect(result.valid).toBe(true)
    expect(result.states.every((s) => s.serverSignatureValid === true)).toBe(true)
    expect(result.states.map((s) => s.op)).toEqual(['ISSUE', 'UPDATE', 'TRANSFER', 'UPDATE', 'RETIRE'])
  })

  it('accepts the boundary control state, whose re-split twin is refused', async () => {
    const control = await verifyChain(fromHex([...raw.slice(0, 2), F.boundaryControl.rawTx]), { chainTracker: 'scripts only' })
    expect(control.valid).toBe(true)
    const substituted = await verifyChain(fromHex(prefixPlus(refusal('boundarySubstitution'))), { chainTracker: 'scripts only' })
    expect(substituted.valid).toBe(false)
    expect(substituted.error).toContain('user_signature invalid')
  })
})

describe('chain-v2 fixture: the reader refuses every broken link', () => {
  it.each(F.refusals.map((r: { name: string }) => [r.name, r] as const))('refuses %s', async (_name, r: ReturnType<typeof refusal>) => {
    const chain = fromHex(prefixPlus(r))
    const result = await verifyChain(chain, { chainTracker: 'scripts only', managedAcceptance: r.managedAcceptance === true })
    expect(result.valid).toBe(false)
    expect(result.error).toContain(r.error)
    if (r.managedAcceptance) {
      const off = await verifyChain(chain, { chainTracker: 'scripts only' })
      expect(off.error).toBeUndefined()
      expect(off.valid).toBe(true)
    }
    if (r.acceptedUnder != null) {
      const accepted = await verifyChain(chain, { chainTracker: 'scripts only', controlAuthorities: r.acceptedUnder.authorities })
      expect(accepted.error).toBeUndefined()
      expect(accepted.valid).toBe(true)
    }
  })

  it('names the refusals the plan asked for', () => {
    const names = F.refusals.map((r: { name: string }) => r.name)
    for (const wanted of ['boundarySubstitution', 'actorSignatureFromVersion1Preimage', 'publisherSignatureInActorSlot', 'passportIdChanged', 'previousOutpointWrongTxid', 'previousOutpointWrongIndex', 'controllerChangedOnUpdate', 'controlNotProven', 'updateAfterRetire', 'transferAfterRetire', 'transferWithoutCommitment', 'recoveryWithoutAuthority']) {
      expect(names).toContain(wanted)
    }
    expect(F.refusals.filter((r: { managedAcceptance?: true }) => r.managedAcceptance).map((r: { name: string }) => r.name)).toEqual(['transferWithoutCommitment'])
    expect(F.refusals.filter((r: { acceptedUnder?: unknown }) => r.acceptedUnder != null).map((r: { name: string }) => r.name)).toEqual(['recoveryWithoutAuthority'])
    expect(refusal('controlNotProven').error).toBe(CONTROL_REFUSALS.notProven)
    expect(refusal('transferWithoutCommitment').error).toBe(ACCEPTANCE_COMMITMENT_REFUSAL)
  })

  it('control: every refusal is one rule, and no two vectors are the same bytes', () => {
    const raws = F.refusals.map((r: { rawTx: string }) => r.rawTx)
    expect(new Set(raws).size).toBe(raws.length)
    for (const r of raws) expect(raw).not.toContain(r)
  })
})

describe('chain-v2 fixture: the upgrade from version 1', () => {
  const v1 = CHAIN_V1_FIXTURE.states.map((s) => s.rawTx)

  it('accepts the six version 1 states followed by the version 2 UPDATE, keeping identifier, genesis and history', async () => {
    const inspection = await inspectChain(fromHex([...v1, F.upgrade.rawTx]), { chainTracker: 'scripts only', serverIdentityKey: CHAIN_V1_FIXTURE.serverKey })
    expect(inspection.failure).toBeUndefined()
    expect(inspection.states.map((s) => s.version)).toEqual(['1', '1', '1', '1', '1', '1', '2'])
    const upgraded = inspection.states[6]
    expect(upgraded.controlValid).toBe(true)
    expect(upgraded.state.passportId).toBe(CHAIN_V1_FIXTURE.states[0].data.passportId)
    if (upgraded.state.version !== '2') throw new Error('not version 2')
    expect(upgraded.state.lineageGenesis).toEqual({ txid: CHAIN_V1_FIXTURE.states[0].txid, outputIndex: 0 })
    expect(upgraded.state.ownerIdentityKey).toBe(CHAIN_V1_FIXTURE.states[5].data.ownerIdentityKey)
  })

  it('rebuilds the upgrade state from its data and the first owner key', async () => {
    const { owner1Wallet, serverWallet } = await import('./helpers.js')
    const state = await completeState(F.upgrade.data as DppStateDataV2, owner1Wallet, serverWallet)
    expect(Utils.toHex(state.userSignature)).toBe(F.upgrade.actorSignature)
    expect(Utils.toHex(state.serverSignature)).toBe(F.upgrade.publisherSignature)
    const tx = stateTxV2(state, PublicKey.fromString(F.upgrade.lockingKey), { tx: Transaction.fromHex(v1[5]), outputIndex: CHAIN_V1_FIXTURE.states[5].outputIndex })
    expect(tx.toHex()).toBe(F.upgrade.rawTx)
    expect(tx.id('hex')).toBe(F.upgrade.txid)
  })

  it.each(F.upgrade.refusals.map((r: { name: string }) => [r.name, r] as const))('refuses %s', async (_name, r: { rawTx: string; error: string }) => {
    const result = await verifyChain(fromHex([...v1, r.rawTx]), { chainTracker: 'scripts only' })
    expect(result.valid).toBe(false)
    expect(result.error).toContain(r.error)
  })

  it('the version 1 chain alone still verifies exactly as before, with no control rule on its states', async () => {
    const inspection = await inspectChain(fromHex(v1), { chainTracker: 'scripts only' })
    expect(inspection.failure).toBeUndefined()
    expect(inspection.states.map((s) => s.controlValid)).toEqual([null, null, null, null, null, null])
  })
})

describe('version 2 transition rules, directly', () => {
  const genesis = { txid: F.states[0].txid, outputIndex: 0 }
  const s = (i: number): DppState => ({ ...F.states[i].data, protocolMarker: 'dpp', userSignature: [48, 1, 2], serverSignature: [48, 3, 4] })

  it('checks a genesis by the version 2 rules', () => {
    expect(checkGenesisState(s(0))).toBeNull()
    expect(checkGenesisState({ ...s(0), op: 'UPDATE' } as DppState)).toContain('ISSUE')
  })

  it('needs the chain genesis, or a version 2 predecessor that names it, to check lineage', () => {
    expect(checkTransition(s(0), s(1), F.states[0].txid, { prevOutputIndex: 0 })).toBeNull()
    expect(checkTransition(s(0), s(1), F.states[0].txid, { prevOutputIndex: 0, lineageGenesis: genesis })).toBeNull()
    expect(checkTransition(s(1), s(2), F.states[1].txid, { prevOutputIndex: 0 })).toBeNull()
    expect(checkTransition(s(1), s(2), F.states[1].txid, { prevOutputIndex: 0, lineageGenesis: { txid: F.states[1].txid, outputIndex: 0 } })).toContain('lineage_genesis')
    const v1Prev: DppState = { ...CHAIN_V1_FIXTURE.states[5].data, protocolMarker: 'dpp', version: '1', userSignature: [48, 1, 2], serverSignature: [48, 3, 4] }
    const upgrade: DppState = { ...F.upgrade.data, protocolMarker: 'dpp', userSignature: [48, 1, 2], serverSignature: [48, 3, 4] }
    expect(checkTransition(v1Prev, upgrade, CHAIN_V1_FIXTURE.states[5].txid, { prevOutputIndex: 0 })).toContain('cannot be checked without the chain genesis')
    expect(checkTransition(v1Prev, upgrade, CHAIN_V1_FIXTURE.states[5].txid, { prevOutputIndex: 0, lineageGenesis: { txid: CHAIN_V1_FIXTURE.states[0].txid, outputIndex: 0 } })).toBeNull()
  })

  it('refuses a version 1 successor of a version 2 state and anything after RETIRE', () => {
    const v1Next: DppState = { ...CHAIN_V1_FIXTURE.states[1].data, passportId: F.states[0].data.passportId, previousTxid: F.states[1].txid, protocolMarker: 'dpp', version: '1', userSignature: [48, 1, 2], serverSignature: [48, 3, 4] }
    expect(checkTransition(s(1), v1Next, F.states[1].txid, { prevOutputIndex: 0 })).toContain('version 1 state cannot follow')
    expect(checkTransition(s(4), { ...s(3), previousTxid: F.states[4].txid } as DppState, F.states[4].txid, { prevOutputIndex: 0, lineageGenesis: genesis })).toContain('retired')
  })
})

describe('after a committed TRANSFER, under managed-custody@2', () => {
  const acceptance = JSON.parse(readFileSync(join(FIXTURES, 'managed-acceptance-v2.json'), 'utf8'))
  const asked = { passportId: F.states[0].data.passportId, source: 'request-context' as const }
  const policy = { chainTracker: 'scripts only' as const, publisherKeys: [F.custodianKey], managedAcceptance: { required: true }, checkedAt: '2027-06-01T12:00:00Z' }

  it('says in the limits that a state written for the holder depends on custody, and needs no commitment on it', async () => {
    const report = await verifyPassportEvidence({ tokenHistory: fromHex(raw), acceptanceRecords: [acceptance.record] }, asked, policy)
    expect(report.checks.find((c) => c.name === 'linkage')?.status).toBe('pass')
    expect(report.checks.find((c) => c.name === 'evidenceAvailability')?.status).toBe('pass')
    expect(report.limits).toContain('After a committed TRANSFER, an UPDATE or RETIRE the custodian writes for a managed holder depends on custody: the chain shows that the custodian acted, not that the holder asked.')
    const before = await verifyPassportEvidence({ tokenHistory: fromHex(raw.slice(0, 3)), acceptanceRecords: [acceptance.record] }, asked, policy)
    expect(before.limits.some((l) => l.includes('not that the holder asked'))).toBe(false)
  })

  it('reports a commitment on an UPDATE as an artefact no profile defines, never as an invalid state', async () => {
    const t = F.states[2]
    const data = {
      ...F.states[3].data,
      timestamp: '2026-10-01T08:30:00Z',
      previousTxid: t.txid,
      previousOutputIndex: t.outputIndex,
      authorisationCommitment: 'ab'.repeat(32),
    } as DppStateDataV2
    const state = await completeState(data, new ProtoWallet(recipientPriv), new ProtoWallet(custodianPriv))
    const tx = stateTxV2(state, custodianPriv.toPublicKey(), { tx: Transaction.fromHex(t.rawTx), outputIndex: t.outputIndex })
    const report = await verifyPassportEvidence({ tokenHistory: [...fromHex(raw.slice(0, 3)), tx], acceptanceRecords: [acceptance.record] }, asked, policy)
    expect(report.checks.find((c) => c.name === 'linkage')?.status).toBe('pass')
    const availability = report.checks.find((c) => c.name === 'evidenceAvailability')
    expect(availability).toMatchObject({ status: 'unknown', reasonCode: 'referenced-artefact-unavailable' })
    expect(JSON.stringify(availability?.detail)).toContain('no profile this verifier implements defines the record the UPDATE')
  })

  it('reports a commitment on an ISSUE the same way, because the record model accepts one on any operation', async () => {
    const data = { ...F.states[0].data, authorisationCommitment: 'ab'.repeat(32) } as DppStateDataV2
    const state = await completeState(data, new ProtoWallet(issuerPriv), new ProtoWallet(custodianPriv))
    const report = await verifyPassportEvidence({ tokenHistory: [stateTxV2(state, custodianPriv.toPublicKey())] }, asked, policy)
    expect(report.checks.find((c) => c.name === 'linkage')?.status).toBe('pass')
    const availability = report.checks.find((c) => c.name === 'evidenceAvailability')
    expect(availability).toMatchObject({ status: 'unknown', reasonCode: 'referenced-artefact-unavailable' })
    expect(JSON.stringify(availability?.detail)).toContain('no profile this verifier implements defines the record the ISSUE')
    // The control: the pinned ISSUE, with field 15 empty, references nothing.
    const plain = await verifyPassportEvidence({ tokenHistory: fromHex(raw.slice(0, 1)) }, asked, policy)
    expect(plain.checks.find((c) => c.name === 'evidenceAvailability')?.status).toBe('pass')
  })

  it('holds the UPDATE the parked instruction rule refused to be a valid chain under the acceptance rule', async () => {
    const result = await verifyChain(fromHex(prefixPlus(PARKED_INSTRUCTION_UPDATE)), { chainTracker: 'scripts only', managedAcceptance: true })
    expect(result.error).toBeUndefined()
    expect(result.valid).toBe(true)
  })
})
