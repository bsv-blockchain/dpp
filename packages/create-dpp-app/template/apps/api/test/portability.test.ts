// The export and the restore, on the parts the exit exercise does not reach:
// a passport that was handed on, with its acceptance record, its offer, an
// EPCIS lifecycle claim that binds it and a second passport, and a
// historical native claim; the index's complete export in place of its bounded
// package; a deployment that already holds something else under an identity
// the package carries; and an export that would have carried a secret.
//
// Everything runs in this process with no services: the records are in
// memory, the wallet is the test wallet, and each platform has an index of
// its own with in-memory storage and its header checks off. The second
// platform holding the same keys as the first stands in for the wallet's own
// recovery. No reading here is a statement about inclusion in a block.
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MerklePath, PrivateKey, Transaction, Utils } from '@bsv/sdk'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { acceptanceCommitment, acceptanceRecordsInPackage, findDppOutputs, verifyOwnerBlob, evidencePackageSigner, evidencePackageSigningKey, inspectEvidencePackage, signEvidenceManifest, signLifecycleClaim, type EvidencePackageManifest } from '@bsv/dpp-protocol'
import { createMemoryEpcisStorage } from '@bsv/dpp-credentials/epcis-exchange'
import { loadConfig } from '../src/config.js'
import { managedParties } from '../src/parties.js'
import { mintPassportId } from '../src/identifiers.js'
import { eventSchemaCheck, readPassportClaims } from '../src/lifecycle.js'
import { openPlatform, type Platform } from '../src/platform.js'
import { exportApplication, type ExportedApplication } from '../src/portability/export.js'
import { EXPORT_SCOPE_PREFIX, PortabilityRefused, asNumberArrays, exportScopeId, passportFolder, readPackageFolder, stableJson, writePackageFolder } from '../src/portability/package.js'
import { restoreApplication, verifyApplicationPackage, type RestoreReport } from '../src/portability/restore.js'
import { samplePayload } from '../src/profiles.js'
import type { EpcisLifecycleClaimRecord } from '../src/store.js'
import { runDuties } from '../src/worker.js'
import { OWNER_DATA_PROTOCOL } from '../src/writer.js'
import { gs1Dir } from './epcis-fixtures.js'

const settings = { NETWORK: 'main', PASSPORT_HOST: 'passports.example.com', GS1_PREFIX: '952', LIVE_PUBLISHING: 'false' }
const config = loadConfig(settings)
const policy = { host: config.passportHost, prefix: config.gs1Prefix }
const brandId = 'brand-portable-1'
const scratch = mkdtempSync(join(tmpdir(), 'dpp-portability-'))

let first: Platform
let second: Platform
let passportId: string
let otherId: string
let claimCode: string
let exported: ExportedApplication
let lifecycleClaim: EpcisLifecycleClaimRecord
const exchange = () => ({ storage: createMemoryEpcisStorage(), sources: [] })

const refusal = async (attempt: Promise<unknown>): Promise<PortabilityRefused> => {
  try {
    await attempt
  } catch (cause) {
    if (cause instanceof PortabilityRefused) return cause
    throw cause
  }
  throw new Error('nothing was refused')
}
const trust = (platform: Platform) => ({ exporterKey: platform.wallet.identityKey, trustedBindingDigests: [] })

beforeAll(async () => {
  const inspectorKey = managedParties(config).member('inspector-7')
  first = await openPlatform({ config, mode: 'test', log: () => {}, lifecyclePolicy: { authorityResolver: (q) => ({
    status: q.issuer === inspectorKey.did && q.issuerKey === inspectorKey.identityKey && [passportId, otherId].includes(q.passportId) && q.purpose === 'claim' && q.eventTime === '2026-03-02T08:00:00.000Z' && q.role === 'observer' ? 'supported' : 'unsupported',
  }) } })
  second = await openPlatform({ config, mode: 'test', log: () => {} })
  const brand = first.parties.brand(brandId)
  await first.store.saveBrand({ id: brandId, name: 'Portable brand', identityKey: brand.identityKey, did: brand.did, createdAt: '2026-03-01T00:00:00.000Z' })
  passportId = mintPassportId(policy, '100000201', 'PORT-0001')
  otherId = mintPassportId(policy, '100000202', 'PORT-0002')
  const payload = samplePayload('general@2', true)
  await first.writer.issue({ brandId, brand, passportId, profile: 'general@2', payload, ownerFields: { serviceNotes: 'first revision' } })
  await first.writer.update({ record: (await first.store.getPassport(passportId))!, actor: brand, payload: { ...payload, careNote: 'revised' }, ownerFields: { serviceNotes: 'second revision' } })
  // The hand-on: an offer, its acceptance by claim code, and a TRANSFER that commits to the acceptance record.
  const offered = await first.custody.offer({ record: (await first.store.getPassport(passportId))!, holder: brand, terms: { word: 'Passed on' } })
  claimCode = offered.claimCode!
  await first.custody.accept({ requestId: offered.offer.requestId, claimCode })
  await first.writer.issue({ brandId, brand, passportId: otherId, profile: 'general@2', payload, ownerFields: {} })
  // A historical native claim, as this application kept one before it moved to EPCIS lifecycle claims.
  const inspector = first.parties.member('inspector-7')
  const tip = (await first.store.getPassport(passportId))!.states.at(-1)!
  const historical = await signLifecycleClaim({ claimFormat: 'dpp-lifecycle-v1', passportId, recordId: `${tip.txid}:${tip.outputIndex}`, eventType: 'Disposition', timestamp: '2026-03-01T00:00:00Z', issuer: inspector.did, issuerKeyId: 'inspector-7', profile: 'general', profile_version: 2 }, inspector.wallet)
  await first.store.saveClaim({ id: 'claim-historical-portable', passportId, issuer: historical.issuer, issuedBy: inspector.name, claim: historical, createdAt: historical.timestamp })
  // An EPCIS lifecycle claim that binds both passports: carried once, as its exact bytes.
  const event = { type: 'ObjectEvent', eventID: 'urn:uuid:6c000000-0000-4000-8000-00000000e001', eventTime: '2026-03-02T08:00:00.000Z', eventTimeZoneOffset: '+00:00', epcList: [passportId, otherId], action: 'OBSERVE', bizStep: 'inspecting', disposition: 'conformant' }
  lifecycleClaim = await first.claims.issue({ event, issuer: inspector, assertedRole: 'observer', expectedPassport: passportId, schemaCheck: eventSchemaCheck(gs1Dir()) })
})

afterAll(async () => {
  await first.close()
  await second.close()
  rmSync(scratch, { recursive: true, force: true })
})

describe('the export of an application', () => {
  it('carries a handed-on passport whole, under one signed manifest, with the index\'s complete export in place of its bounded package', async () => {
    exported = await exportApplication({ platform: first, epcis: exchange(), access: 'authorised-recovery', indexRoute: 'complete' })
    const { manifest, descriptor, files } = exported
    expect(manifest.passportId).toBe(exportScopeId([passportId, otherId]))
    expect(manifest.passportId.startsWith(EXPORT_SCOPE_PREFIX)).toBe(true)
    expect(manifest.signature.signer).toBe(evidencePackageSigner(first.wallet.identityKey, manifest.passportId))
    // It inspects as any evidence package does: its structure, its inventory against the files and the exporter's signature.
    expect(inspectEvidencePackage(manifest, asNumberArrays(files), { expectedSigner: exported.exporter.signer })).toMatchObject({ structureValid: true, inventoryVerified: true, signatureValid: true, failures: [], recoveryBackup: true })
    expect(descriptor).toMatchObject({ access: 'authorised-recovery', selection: 'all-passports', profiles: { carried: [], named: ['general@2'] }, epcis: { scopes: [], reason: 'the exchange holds no source scope' }, records: { brands: 1, offers: 1, claims: 2 } })
    expect(manifest.completeness.withheld).toContain('profile general@2 defined-by-the-profiles-package')
    const handedOn = descriptor.passports.find((passport) => passport.passportId === passportId)!
    expect(handedOn).toMatchObject({ profile: 'general@2', states: 3, acceptanceRecords: 1, claims: 2, index: { form: 'export-parts', parts: 1, states: 3 } })
    expect(descriptor.passports.find((passport) => passport.passportId === otherId)!).toMatchObject({ claims: 1, index: { form: 'export-parts', states: 1 } })
    // The EPCIS lifecycle claim binds both passports and is carried once: its record, and its exact signed bytes beside it.
    const claimFiles = manifest.inventory.filter((entry) => entry.path.startsWith('application/lifecycle-claims/'))
    expect(claimFiles).toEqual([expect.objectContaining({ category: 'native-claims', mediaType: 'application/json', representation: 'dpp-epcis-lifecycle-json@1', represents: lifecycleClaim.attestationId })])
    expect(new TextDecoder().decode(files.get(claimFiles[0]!.path)!)).toBe(lifecycleClaim.bytes)
    expect(manifest.inventory.filter((entry) => entry.path.startsWith('application/claims/'))).toHaveLength(2)

    // The acceptance record is an authority entry, in the form a reader of any evidence package finds it.
    const record = (await first.store.getPassport(passportId))!
    const commitment = acceptanceCommitment(record.acceptanceRecords[0]!)
    const carried = acceptanceRecordsInPackage(manifest, asNumberArrays(files))
    expect(carried).toHaveLength(1)
    expect(carried[0]).toMatchObject({ path: `${passportFolder(passportId)}/authority/${commitment}.json`, represents: `sha256:${commitment}` })
    expect(carried[0]!.failure).toBeUndefined()
    // The index's own signature on each part is carried and still verifies under the index's exporter key.
    const coverage = JSON.parse(new TextDecoder().decode(files.get(`${passportFolder(passportId)}/index/part-1/coverage.json`)!)) as { final: boolean; nextCursor?: unknown; signature: { signer: string } }
    expect(coverage.final).toBe(true)
    expect(coverage).not.toHaveProperty('nextCursor')
    expect(coverage.signature.signer).toBe(evidencePackageSigner(first.devIndex!.exporterIdentityKey, passportId))
    // No key, and no claim code: only the digest the offer was accepted against.
    const everything = Buffer.concat([...files.values()].map((bytes) => Buffer.from(bytes)))
    expect(everything.includes(Buffer.from(claimCode))).toBe(false)
    expect(everything.includes(Buffer.from('11'.repeat(32)))).toBe(false)
    expect(everything.includes(Buffer.from(config.brandRootSecret))).toBe(false)
  })

  it('carries the bounded package by default, and a selection of passports under a name of its own', async () => {
    const one = await exportApplication({ platform: first, epcis: exchange(), access: 'authorised-recovery', passportIds: [otherId] })
    // The second passport has no offer of its own, and the EPCIS lifecycle claim that binds it travels with it.
    expect(one.descriptor).toMatchObject({ selection: 'listed-passports', records: { brands: 1, offers: 0, claims: 1 } })
    expect(one.descriptor.passports).toHaveLength(1)
    expect(one.descriptor.passports[0]!.index).toMatchObject({ form: 'package', states: 1, exporter: first.devIndex!.exporterIdentityKey })
    expect(one.manifest.passportId).toBe(exportScopeId([otherId]))
    expect(one.manifest.passportId).not.toBe(exported.manifest.passportId)
    // A signature made for one selection does not verify as the signature of another.
    expect(inspectEvidencePackage({ ...one.manifest, passportId: exported.manifest.passportId }, asNumberArrays(one.files)).signatureValid).toBe(false)
    const unknown = await refusal(exportApplication({ platform: first, epcis: exchange(), access: 'authorised-recovery', passportIds: ['https://passports.example.com/01/09521000002039/21/NOT-HELD'] }))
    expect(unknown.code).toBe('passport-unknown')
  })

  it('gives a public form with no journal, no offer, no claim and nothing of the exchange unless a source is named', async () => {
    const open = await exportApplication({ platform: first, epcis: exchange(), access: 'public-evidence' })
    expect(open.manifest.disclosure).toEqual({ scope: 'public', recoveryBackup: false })
    expect(open.descriptor).toMatchObject({ access: 'public-evidence', records: { brands: 0, offers: 0, claims: 0 }, epcis: { scopes: [], reason: 'no source scope was named as one a public export may carry' } })
    // The index's own evidence carries its publisher policy under authority, which is public. This application's acceptance records sit beside the journal, and are not here.
    expect([...open.files.keys()].filter((path) => path.endsWith('/journal.json') || /^passports\/[0-9a-f]{64}\/authority\//.test(path) || path.startsWith('application/offers/') || path.startsWith('application/claims/') || path.startsWith('application/brands/'))).toEqual([])
    expect(open.manifest.completeness.withheld).toEqual(expect.arrayContaining(['application passport-journals not-public', 'application brands-offers-claims not-public', 'epcis-exchange every-source-scope not-public']))
    // The sealed owner tiers are in no file of it, in the journal's form or as bytes.
    const everything = Buffer.concat([...open.files.values()].map((bytes) => Buffer.from(bytes)))
    for (const state of (await first.store.getPassport(passportId))!.states) {
      expect(everything.includes(Buffer.from(state.ownerTier!.ciphertext))).toBe(false)
      expect(everything.includes(Buffer.from(state.ownerTier!.ciphertext, 'base64'))).toBe(false)
    }
    // A restore refuses it by name.
    expect((await refusal(verifyApplicationPackage({ manifestText: JSON.stringify(open.manifest), files: open.files }, trust(first)))).code).toBe('not-a-recovery-package')
  })

  it('accounts for two completed handovers and keeps a signed, unexecuted offer recoverable', async () => {
    const source = await openPlatform({ config, mode: 'test', log: () => {} })
    try {
      const id = mintPassportId(policy, '100000204', 'PORT-HANDOVERS')
      const brand = source.parties.brand(brandId)
      await source.writer.issue({ brandId, brand, passportId: id, profile: 'general@2', payload: samplePayload('general@2', true) })
      async function offer() {
        const record = (await source.store.getPassport(id))!
        const created = await source.custody.offer({ record, holder: source.custody.holderOf(record), terms: { word: 'Handed on' } })
        return { requestId: created.offer.requestId, claimCode: created.claimCode! }
      }
      const firstTransfer = await source.custody.accept(await offer())
      const secondTransfer = await source.custody.accept(await offer())
      const completed = [firstTransfer.record, secondTransfer.record]
      const pending = await offer()
      vi.spyOn(source.writer, 'transfer').mockRejectedValueOnce(new Error('wallet offline'))
      await expect(source.custody.accept(pending)).rejects.toThrow('wallet offline')
      const pendingOffer = (await source.store.getOffer(pending.requestId))!
      const signed = pendingOffer.record!

      const recovery = await exportApplication({ platform: source, epcis: exchange(), access: 'authorised-recovery' })
      const verified = await verifyApplicationPackage({ manifestText: JSON.stringify(recovery.manifest), files: recovery.files }, trust(source))
      expect(verified.offers.find(item => item.requestId === pending.requestId)).toMatchObject({ status: 'accepted', record: signed })
      const replacement = await openPlatform({ config, mode: 'test', log: () => {} })
      try {
        await restoreApplication({ verified, platform: replacement, epcis: exchange(), rebuildIndex: true })
        const retried = await replacement.custody.accept(pending)
        expect(retried.record).toEqual(signed)
        expect((await replacement.store.getPassport(id))!.acceptanceRecords).toEqual([...completed, signed])
      } finally {
        await replacement.close()
      }
      const authority = acceptanceRecordsInPackage(recovery.manifest, asNumberArrays(recovery.files))
      expect(authority).toHaveLength(completed.length)
      for (const record of completed) {
        expect(authority.filter(item => item.represents === `sha256:${acceptanceCommitment(record)}`)).toEqual([
          { path: `${passportFolder(id)}/authority/${acceptanceCommitment(record)}.json`, represents: `sha256:${acceptanceCommitment(record)}`, record },
        ])
      }
      const open = await exportApplication({ platform: source, epcis: exchange(), access: 'public-evidence' })
      expect(acceptanceRecordsInPackage(open.manifest, asNumberArrays(open.files))).toEqual([])
      for (const record of completed) {
        const reference = `acceptance:sha256:${acceptanceCommitment(record)}`
        expect(recovery.manifest.completeness.absent).not.toContain(reference)
        expect(open.manifest.completeness.absent).not.toContain(reference)
        expect(open.manifest.completeness.withheld).toContain(`${reference} not-public`)
      }
      const publicBytes = Buffer.concat([Buffer.from(JSON.stringify(open.manifest)), ...Array.from(open.files.values(), bytes => Buffer.from(bytes))])
      for (const secret of [pending.requestId, pending.claimCode, acceptanceCommitment(signed), ...[...completed, signed].map(record => record.signature)]) {
        expect(publicBytes.includes(Buffer.from(secret))).toBe(false)
      }

      // The package signature covers the exporting store's bytes. The acceptance must separately verify for its offer.
      for (const change of [{ record: firstTransfer.record }, { record: { ...signed, signature: '00' } }, { terms: { word: 'Different terms' } }]) {
        await source.store.saveOffer({ ...pendingOffer, ...change })
        const damaged = await exportApplication({ platform: source, epcis: exchange(), access: 'authorised-recovery' })
        const result = await refusal(verifyApplicationPackage({ manifestText: JSON.stringify(damaged.manifest), files: damaged.files }, trust(source)))
        expect(result).toMatchObject({ code: 'records-inconsistent', data: { requestId: pending.requestId } })
      }
      await source.store.saveOffer(pendingOffer)

      // A partial store holds only the first acceptance in its offer and has lost the second altogether.
      const journal = (await source.store.getPassport(id))!
      await source.store.savePassport({ ...journal, acceptanceRecords: [] })
      const { record: lost, ...secondOffer } = (await source.store.getOffer(secondTransfer.record.requestId))!
      await source.store.saveOffer(secondOffer)
      const partial = await exportApplication({ platform: source, epcis: exchange(), access: 'public-evidence' })
      const retained = `acceptance:sha256:${acceptanceCommitment(firstTransfer.record)}`
      const missing = `acceptance:sha256:${acceptanceCommitment(lost!)}`
      expect(partial.manifest.completeness.withheld).toContain(`${retained} not-public`)
      expect(partial.manifest.completeness.absent).not.toContain(retained)
      expect(partial.manifest.completeness.absent).toContain(missing)
      expect(partial.manifest.completeness.withheld).not.toContain(`${missing} not-public`)
    } finally {
      await source.close()
    }
  })

  it('requires a public index package without custody records before using it in a public export', async () => {
    const result = await first.index.evidencePackage(passportId)
    if (!('envelope' in result)) throw new Error('the index gave no package')
    const original = result.envelope.manifest as EvidencePackageManifest
    const key = PrivateKey.fromRandom()
    const id = key.toPublicKey().toString()
    const signingKey = evidencePackageSigningKey(key, passportId)
    const signing = { sign: (preimage: number[]) => signingKey.sign(preimage).toDER() as number[] }
    const identity = vi.spyOn(first.index, 'exporterIdentityKey').mockResolvedValue(id)
    const fetchPackage = vi.spyOn(first.index, 'evidencePackage')
    try {
      const record = (await first.store.getPassport(passportId))!.acceptanceRecords[0]!
      const bytes = Buffer.from(JSON.stringify(record))
      const path = 'authority/acceptance.json'
      const entry = { path, category: 'authority' as const, mediaType: 'application/json', byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), represents: `sha256:${acceptanceCommitment(record)}`, representation: record.acceptanceFormat }
      for (const includeRecord of [false, true]) {
        const manifest = await signEvidenceManifest({
          ...original,
          exporter: { ...original.exporter, id },
          disclosure: includeRecord ? original.disclosure : { scope: 'all-tiers', recoveryBackup: true },
          inventory: includeRecord ? [...original.inventory, entry] : original.inventory,
          signature: { suite: 'bsv-ecdsa-der', signer: signingKey.toPublicKey().toString() },
        }, signing)
        const files = includeRecord ? { ...result.envelope.files, [path]: bytes.toString('base64') } : result.envelope.files
        fetchPackage.mockResolvedValue({ envelope: { manifest, files } })
        const problem = await refusal(exportApplication({ platform: first, epcis: exchange(), access: 'public-evidence', passportIds: [passportId] }))
        expect(problem.code).toBe('index-evidence-refused')
      }
    } finally {
      fetchPackage.mockRestore()
      identity.mockRestore()
    }
  })

  it('refuses to hand over an export that holds a secret this deployment was configured with', async () => {
    const secret = 'REGISTRY-TOKEN-CANARY-71D0E4B2'
    const leaky = await openPlatform({ config: loadConfig({ ...settings, REGISTRY_URL: 'https://registry.example', REGISTRY_TOKEN: secret }), mode: 'test', log: () => {} })
    try {
      const brand = leaky.parties.brand(brandId)
      // The secret reached a record: here, a brand somebody named after it.
      await leaky.store.saveBrand({ id: brandId, name: `Brand ${secret}`, identityKey: brand.identityKey, did: brand.did, createdAt: '2026-03-01T00:00:00.000Z' })
      await leaky.writer.issue({ brandId, brand, passportId: mintPassportId(policy, '100000203', 'PORT-LEAK-1'), profile: 'general@2', payload: samplePayload('general@2', true), ownerFields: {} })
      const refused = await refusal(exportApplication({ platform: leaky, epcis: exchange(), access: 'authorised-recovery' }))
      expect(refused.code).toBe('secret-in-export')
      expect(refused.message).toMatch(/application\/brands\/[0-9a-f]{64}\.json holds a secret/)
      expect(refused.message).not.toContain(secret)
    } finally {
      await leaky.close()
    }
  })
})

describe('the restore of an application', () => {
  let folder: string
  let report: RestoreReport

  it('rebuilds delivery receipts at a replacement index and retries a retained proof without the source wallet', async () => {
    const source = await openPlatform({ config, mode: 'test', log: () => {} })
    const destination = await openPlatform({ config, mode: 'test', log: () => {} })
    try {
      const id = mintPassportId(policy, '100000205', 'PORT-PROOF')
      const brand = source.parties.brand(brandId)
      const issued = await source.writer.issue({ brandId, brand, passportId: id, profile: 'general@2', payload: samplePayload('general@2', true) })
      const { txid } = issued.entry
      await source.writer.prove(issued.record, txid)
      const proven = (await source.store.getPassport(id))!
      const state = proven.states[0]!
      expect(state).toMatchObject({ index: 'admitted', proofPushed: true, sentBeef: issued.entry.beef })
      const packageData = await exportApplication({ platform: source, epcis: exchange(), access: 'authorised-recovery' })
      const verified = await verifyApplicationPackage({ manifestText: JSON.stringify(packageData.manifest), files: packageData.files }, trust(source))
      const restore = (rebuildIndex: boolean) => restoreApplication({ verified, platform: destination, epcis: exchange(), rebuildIndex })
      await restore(false)
      const waiting = (await destination.store.getPassport(id))!.states[0]!
      expect(waiting).toMatchObject({ index: 'not-asked', proof: state.proof, sentBeef: state.sentBeef })
      expect(waiting.proofPushed).not.toBe(true)
      expect(verified.journals[0]!.states[0]!.proofPushed).toBe(true)

      // A repeat can encounter receipts copied by an older restore, even on a fresh index.
      await destination.store.savePassport(proven)
      const walletProof = vi.spyOn(destination.wallet.adapter, 'merklePathFor')
      const send = vi.spyOn(destination.wallet.adapter, 'send')
      const push = vi.spyOn(destination.index, 'pushProof').mockResolvedValueOnce({ ok: false, detail: 'callback unavailable' })
      const tried = await restore(true)
      expect(tried.index).toMatchObject({ proofsApplied: 0, proofsNotApplied: [{ passportId: id, txid, detail: 'callback unavailable' }] })
      expect(tried.attention).toEqual(expect.arrayContaining([expect.stringContaining('callback unavailable')]))
      expect(push.mock.calls.map(([id]) => id)).toEqual([txid])
      expect((await destination.store.getPassport(id))!.states[0]!.proofPushed).not.toBe(true)
      expect((await destination.index.lineage(id))[0]!.merklePath).toBeUndefined()

      await runDuties({ store: destination.store, writer: destination.writer, index: destination.index })
      expect((await destination.index.lineage(id))[0]!.merklePath?.toHex()).toBe(state.proof!.merklePath)
      expect((await destination.store.getPassport(id))!.states[0]!.proofPushed).toBe(true)
      expect((await restore(true)).index).toMatchObject({ duplicate: 1, proofsApplied: 1, proofsNotApplied: [] })
      expect(push.mock.calls.map(([id, path]) => [id, path.toHex()])).toEqual(Array(3).fill([txid, state.proof!.merklePath]))
      expect(walletProof).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()

      const fresh = await openPlatform({ config, mode: 'test', log: () => {} })
      try {
        const rebuilt = await restoreApplication({ verified, platform: fresh, epcis: exchange(), rebuildIndex: true })
        expect(rebuilt.index).toMatchObject({ admitted: 1, proofsApplied: 1, proofsNotApplied: [] })
        expect((await fresh.index.lineage(id))[0]!.merklePath?.toHex()).toBe(state.proof!.merklePath)
      } finally {
        await fresh.close()
      }
    } finally {
      await source.close()
      await destination.close()
    }
  })

  it('reads a package back from its folder and restores it: every state is given to the index, and the passports read as they did', async () => {
    folder = join(scratch, 'export')
    writePackageFolder(folder, exported.manifest, exported.files)
    // An export is never written over anything.
    expect(() => writePackageFolder(folder, exported.manifest, exported.files)).toThrow(/already holds files/)
    const verified = await verifyApplicationPackage(readPackageFolder(folder), trust(first))
    expect(verified.journals.map((record) => record.passportId).sort()).toEqual([passportId, otherId].sort())
    expect(verified.offers).toHaveLength(1)
    expect(verified.claims).toHaveLength(2)
    expect(await second.store.listPassports()).toEqual([])

    report = await restoreApplication({ verified, platform: second, epcis: exchange(), rebuildIndex: true })
    expect(report).toMatchObject({
      outcome: 'restored',
      passports: { unchanged: [] },
      records: { brands: { written: 1, unchanged: 0 }, offers: { written: 1, unchanged: 0 }, claims: { written: 2, unchanged: 0 } },
      profiles: { resolver: 'package', filesWritten: 0, registered: [], notRegistered: [] },
      index: { rebuilt: true, announced: 4, admitted: 4, duplicate: 0, notAnnounced: [] },
      readings: { compared: 2, same: 2, different: [], notCompared: [] },
    })
    expect(report.epcis).toBeUndefined()
    expect(stableJson(await second.store.getPassport(passportId))).toBe(stableJson(await first.store.getPassport(passportId)))
    expect((await second.index.lineage(passportId)).map((tx) => tx.id('hex'))).toEqual((await first.index.lineage(passportId)).map((tx) => tx.id('hex')))
    expect((await second.read(passportId)).lineage.map((state) => state.op)).toEqual(['ISSUE', 'UPDATE', 'TRANSFER'])

    // The restored deployment holds the claims as they were and verifies them itself: the EPCIS claim from its exact bytes, binding both passports, and the historical one under its own rules.
    for (const id of [passportId, otherId]) {
      const reading = await readPassportClaims(id, { store: second.store, index: second.index, schemaCheck: eventSchemaCheck(gs1Dir()), ...second.lifecyclePolicy })
      expect(reading.lifecycle[0]?.findings).toMatchObject({ signature: { status: 'pass' }, authority: { status: 'unavailable' } })
      const [claim] = reading.lifecycle
      expect(claim, id).toMatchObject({ attestationId: lifecycleClaim.attestationId, held: true, participation: 'item', foundBy: ['this-application'] })
      expect([claim!.findings!.signature.status, claim!.findings!.eventStructure.status, claim!.findings!.productBinding.status]).toEqual(['pass', 'pass', 'pass'])
    }
    expect((await readPassportClaims(passportId, { store: second.store, index: second.index })).historical).toEqual([expect.objectContaining({ id: 'claim-historical-portable', historical: true, signature: 'verified' })])
  })

  it('L08: a restore without the original managed keys preserves signed claims and gives the replacement account no physical role', async () => {
    const destination = await openPlatform({ config: { ...config, brandRootSecret: 'another-brand-secret-for-the-restore', managedIdentitySecret: 'another-member-secret-for-the-restore' }, mode: 'test', log: () => {} })
    try {
      const verified = await verifyApplicationPackage(readPackageFolder(folder), trust(first))
      await restoreApplication({ verified, platform: destination, epcis: exchange(), rebuildIndex: false })
      const otherInspector = destination.parties.member('inspector-7')
      expect(otherInspector.did).not.toBe(lifecycleClaim.issuer)
      expect(await destination.store.getBrand(brandId)).toMatchObject({ id: brandId })
      const reading = await readPassportClaims(passportId, { store: destination.store, index: destination.index, ...destination.lifecyclePolicy, schemaCheck: eventSchemaCheck(gs1Dir()) })
      expect(reading.lifecycle.find((v) => v.attestationId === lifecycleClaim.attestationId)?.findings).toMatchObject({ signature: { status: 'pass' }, authority: { status: 'unavailable' }, ownership: { status: 'not-asserted' }, possession: { status: 'not-asserted' } })
      const sign = vi.spyOn(otherInspector.wallet, 'createSignature')
      const save = vi.spyOn(destination.store, 'saveClaim')
      try {
        const { event } = JSON.parse(lifecycleClaim.bytes)
        await expect(destination.claims.issue({ event, issuer: otherInspector, assertedRole: 'observer', expectedPassport: passportId, schemaCheck: eventSchemaCheck(gs1Dir()) })).rejects.toMatchObject({ code: 'authority-unavailable' })
        expect(sign).not.toHaveBeenCalled()
        expect(save).not.toHaveBeenCalled()
      } finally {
        sign.mockRestore()
        save.mockRestore()
      }
    } finally {
      await destination.close()
    }
  })

  it('changes nothing the second time, and lets the recipient carry on with the claim code they accepted with', async () => {
    const again = await restoreApplication({ verified: await verifyApplicationPackage(readPackageFolder(folder), trust(first)), platform: second, epcis: exchange(), rebuildIndex: true })
    expect(again).toMatchObject({ outcome: 'unchanged', passports: { written: [] }, records: { brands: { written: 0, unchanged: 1 }, offers: { written: 0, unchanged: 1 }, claims: { written: 0, unchanged: 2 } }, index: { announced: 4, admitted: 0, duplicate: 4 }, readings: { compared: 2, same: 2 } })

    // The offer's claim code was never stored and is not in the package. Its digest is, so the recipient's code is recognised here.
    const offer = (await second.store.listOffers({ passportId }))[0]!
    expect(offer.claimCodeHash).toBe(createHash('sha256').update(claimCode).digest('hex'))
    // The recipient's key is derived from a secret this deployment was given by its operator, not from the package. With it the holder retires the passport here.
    const record = (await second.store.getPassport(passportId))!
    const holder = second.custody.holderOf(record)
    const transferTier = record.states.at(-1)!.ownerTier!
    const transfer = (await second.index.lineage(passportId)).at(-1)!
    const ciphertext = Utils.toArray(transferTier.ciphertext, 'base64')
    expect(verifyOwnerBlob(ciphertext, findDppOutputs(transfer)[0].state.payloadOwnerHash)).toBe(true)
    expect(transferTier.senderIdentityKey).toBe(second.parties.brand(brandId).identityKey)
    const { plaintext } = await holder.wallet.decrypt({ ciphertext, protocolID: OWNER_DATA_PROTOCOL, keyID: passportId, counterparty: transferTier.senderIdentityKey! })
    expect(JSON.parse(Utils.toUTF8(plaintext))).toEqual({ serviceNotes: 'second revision' })
    const updated = await second.writer.update({ record, actor: holder, payload: JSON.parse(record.states.at(-1)!.payloadPublic) })
    expect(updated.entry.ownerTier).toEqual(transferTier)
    const retired = await second.writer.retire({ record: updated.record, actor: holder, reason: 'recycled' })
    expect(retired.entry).toMatchObject({ op: 'RETIRE', index: 'admitted', ownerTier: transferTier })
    expect((await second.read(passportId)).lineage.map((state) => state.op)).toEqual(['ISSUE', 'UPDATE', 'TRANSFER', 'UPDATE', 'RETIRE'])
  })

  it('refuses a recovery export that retained an incomplete ciphertext for its signed state', async () => {
    const original = (await first.store.getPassport(passportId))!
    const damaged = structuredClone(original)
    damaged.states.at(-1)!.ownerTier!.ciphertext = Buffer.from('truncated by the source store').toString('base64')
    await first.store.savePassport(damaged)
    try {
      const recovery = await exportApplication({ platform: first, epcis: exchange(), access: 'authorised-recovery', passportIds: [passportId] })
      const folder = join(scratch, 'incomplete-ciphertext')
      writePackageFolder(folder, recovery.manifest, recovery.files)
      const problem = await refusal(verifyApplicationPackage(readPackageFolder(folder), trust(first)))
      expect(problem).toMatchObject({ code: 'records-inconsistent', data: { passportId, txid: original.states.at(-1)!.txid } })
    } finally {
      await first.store.savePassport(original)
    }
  })

  it('refuses a signed journal that would replay another transaction or its proof', async () => {
    const original = (await first.store.getPassport(passportId))!
    const other = (await first.store.getPassport(otherId))!.states[0]!
    const path = MerklePath.fromCoinbaseTxidAndHeight(other.txid, 800_011)
    const tx = Transaction.fromHex(original.states[0]!.rawTx)
    tx.merklePath = MerklePath.fromCoinbaseTxidAndHeight(tx.id('hex'), 800_012)
    const anotherHeight = MerklePath.fromCoinbaseTxidAndHeight(tx.id('hex'), 800_013)
    try {
      for (const patch of [
        { sentBeef: other.beef },
        { proof: { merklePath: path.toHex(), blockHeight: path.blockHeight } },
        { beef: Utils.toBase64(tx.toAtomicBEEF()), proof: { merklePath: anotherHeight.toHex(), blockHeight: anotherHeight.blockHeight } },
      ]) {
        const damaged = structuredClone(original)
        Object.assign(damaged.states[0]!, patch)
        await first.store.savePassport(damaged)
        const recovery = await exportApplication({ platform: first, epcis: exchange(), access: 'authorised-recovery', passportIds: [passportId] })
        const refused = await refusal(verifyApplicationPackage({ manifestText: JSON.stringify(recovery.manifest), files: recovery.files }, trust(first)))
        expect(refused.code).toBe('records-inconsistent')
      }
    } finally {
      await first.store.savePassport(original)
    }
  })

  it('never overwrites: a deployment that now holds another journal under the same identifier is left as it is', async () => {
    const before = stableJson(await second.store.listPassports())
    const refused = await refusal(restoreApplication({ verified: await verifyApplicationPackage(readPackageFolder(folder), trust(first)), platform: second, epcis: exchange(), rebuildIndex: true }))
    expect(refused.code).toBe('reconciliation-required')
    expect(refused.data.collisions).toEqual([{ kind: 'passport', identity: passportId }])
    expect(refused.message).toContain('Nothing was written.')
    expect(stableJson(await second.store.listPassports())).toBe(before)
  })

  it('refuses index evidence that was changed, a manifest that names another export, and a folder that is not a package', async () => {
    const resign = async (name: string, change: (dir: string, manifest: EvidencePackageManifest) => void): Promise<string> => {
      const dir = join(scratch, name)
      writePackageFolder(dir, exported.manifest, exported.files)
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as EvidencePackageManifest
      change(dir, manifest)
      manifest.inventory = manifest.inventory.filter((entry) => existsSync(join(dir, entry.path))).map((entry) => {
        const bytes = readFileSync(join(dir, entry.path))
        return { ...entry, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
      })
      const key = evidencePackageSigningKey(PrivateKey.fromHex('11'.repeat(32)), manifest.passportId)
      // Signed as the exporter signs: by the key its identity derives for the name the manifest now carries.
      const signature = { suite: manifest.signature.suite, signer: key.toPublicKey().toString() }
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(await signEvidenceManifest({ ...manifest, signature }, { sign: (preimage) => key.sign(preimage).toDER() as number[] })))
      return dir
    }
    // A transaction of the index's evidence is changed, and the outer manifest is signed again for the changed bytes. The index's own signature no longer covers them.
    const part = `${passportFolder(passportId)}/index/part-1`
    const transaction = [...exported.files.keys()].find((path) => path.startsWith(`${part}/transactions/`))!
    const tampered = await resign('tampered', (dir) => {
      const bytes = readFileSync(join(dir, transaction))
      bytes[10] = bytes[10]! ^ 1
      writeFileSync(join(dir, transaction), bytes)
    })
    const evidence = await refusal(verifyApplicationPackage(readPackageFolder(tampered), trust(first)))
    expect(evidence.code).toBe('index-evidence-refused')
    expect(evidence.data.passportId).toBe(passportId)

    // An EPCIS lifecycle claim whose carried bytes were changed, with the manifest signed again for them: the bytes no longer verify as the claim the record names.
    const claimPath = [...exported.files.keys()].find((path) => path.startsWith('application/lifecycle-claims/'))!
    const alteredClaim = await resign('altered-claim', (dir) => {
      writeFileSync(join(dir, claimPath), readFileSync(join(dir, claimPath), 'utf8').replace('"conformant"', '"non_conformant"'))
    })
    const claimRefusal = await refusal(verifyApplicationPackage(readPackageFolder(alteredClaim), trust(first)))
    expect(claimRefusal.code).toBe('claim-invalid')

    // Readers find acceptance records by category and format. The bytes alone cannot supply a mislabelled entry.
    for (const change of [{ category: 'reports' as const }, { representation: 'dpp-managed-acceptance@1' }]) {
      const altered = await resign(`mislabelled-acceptance-${Object.keys(change)[0]}`, (_dir, manifest) => {
        Object.assign(manifest.inventory.find(entry => entry.representation === 'dpp-managed-acceptance@2')!, change)
      })
      expect((await refusal(verifyApplicationPackage(readPackageFolder(altered), trust(first)))).code).toBe('records-inconsistent')
    }

    // A manifest signed, correctly, under the name of another selection than the passports the package carries.
    const scope = await resign('scope', (_dir, manifest) => {
      manifest.passportId = exportScopeId([passportId])
    })
    expect((await refusal(verifyApplicationPackage(readPackageFolder(scope), trust(first)))).code).toBe('export-scope-mismatch')

    // A package about one passport, as an index exports it, is not an export of an application.
    const single = await first.index.evidencePackage(passportId)
    if (!('envelope' in single)) throw new Error('the index gave no package')
    expect((await refusal(verifyApplicationPackage({ manifestText: JSON.stringify(single.envelope.manifest), files: new Map() }, trust(first)))).code).toBe('not-an-application-export')
    expect((await refusal(verifyApplicationPackage({ files: new Map() }, trust(first)))).code).toBe('manifest-missing')
    expect(() => readPackageFolder(join(scratch, 'not-there'))).toThrow(/There is no folder/)
  })
})
