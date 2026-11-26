import { createMemoryEpcisStorage } from '@bsv/dpp-credentials/epcis-exchange'
import { acceptanceCommitment, evidencePackageSigner, EVIDENCE_PACKAGE_PROTOCOL, signEvidenceManifest, type EvidencePackageManifest, type InventoryEntry, type ManagedAcceptanceRecord } from '@bsv/dpp-protocol'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config.js'
import { mintPassportId } from '../src/identifiers.js'
import { openPlatform, type Platform } from '../src/platform.js'
import { exportApplication, type ExportedApplication } from '../src/portability/export.js'
import { APPLICATION_EXPORT_DESCRIPTOR, passportFolder, recordBytes, sha256Hex } from '../src/portability/package.js'
import { restoreApplication, verifyApplicationPackage } from '../src/portability/restore.js'
import { samplePayload } from '../src/profiles.js'

const profile = 'managed-custody@3' as const
const config = loadConfig({ NETWORK: 'main', PASSPORT_HOST: 'passports.example.com', GS1_PREFIX: '952', LIVE_PUBLISHING: 'false' })
const id = mintPassportId({ host: config.passportHost, prefix: config.gs1Prefix }, '100000206', 'RECOVERY')
const folder = passportFolder(id)
let platform: Platform
let base: ExportedApplication
let completed: ManagedAcceptanceRecord
let pending: ManagedAcceptanceRecord

beforeAll(async () => {
  platform = await openPlatform({ config, mode: 'test', log: () => {} })
  const brandId = 'recovery-brand'
  const brand = platform.parties.brand(brandId)
  await platform.writer.issue({ brandId, brand, passportId: id, profile: 'general@2', payload: samplePayload('general@2', true) })
  async function offer() {
    const record = (await platform.store.getPassport(id))!
    const created = await platform.custody.offer({ record, holder: platform.custody.holderOf(record), terms: { word: 'Handed on' } })
    return { requestId: created.offer.requestId, claimCode: created.claimCode! }
  }
  completed = (await platform.custody.accept(await offer())).record
  const awaiting = await offer()
  vi.spyOn(platform.writer, 'transfer').mockRejectedValueOnce(new Error('wallet offline'))
  await expect(platform.custody.accept(awaiting)).rejects.toThrow('wallet offline')
  pending = (await platform.store.getOffer(awaiting.requestId))!.record!
  base = await exportApplication({ platform, epcis: { storage: createMemoryEpcisStorage(), sources: [] }, access: 'authorised-recovery' })
})

afterAll(async () => { await platform?.close() })

type PackageCopy = { manifest: EvidencePackageManifest; files: Map<string, Uint8Array> }
const authorityPath = (record: ManagedAcceptanceRecord) => `${folder}/authority/${acceptanceCommitment(record)}.json`
const reference = (record: ManagedAcceptanceRecord) => `acceptance:sha256:${acceptanceCommitment(record)}`

/** Build a valid exporter signature over each altered set of recovery records. */
async function signedCopy(change: (copy: PackageCopy) => void | Promise<void>) {
  const manifest = structuredClone(base.manifest)
  manifest.profiles = [...new Set([...(manifest.profiles ?? []), profile])]
  const files = new Map(base.files)
  await change({ manifest, files })
  manifest.inventory = manifest.inventory.filter(entry => files.has(entry.path)).map(entry => {
    const bytes = files.get(entry.path)!
    return { ...entry, sha256: sha256Hex(bytes), byteLength: bytes.length }
  })
  const signed = await signEvidenceManifest(manifest, { sign: async data => (await platform.wallet.custodian.createSignature({
    data, protocolID: EVIDENCE_PACKAGE_PROTOCOL, keyID: manifest.passportId, counterparty: 'anyone',
  })).signature })
  return { manifestText: JSON.stringify(signed), files }
}

const trust = () => ({ exporterKey: platform.wallet.identityKey, trustedBindingDigests: [] })

function removeAuthority(copy: PackageCopy) {
  copy.files.delete(authorityPath(completed))
  const descriptor = structuredClone(base.descriptor)
  descriptor.passports[0]!.acceptanceRecords = 0
  copy.files.set(APPLICATION_EXPORT_DESCRIPTOR, recordBytes(descriptor))
  const path = `${folder}/journal.json`
  const record = JSON.parse(new TextDecoder().decode(copy.files.get(path)!))
  copy.files.set(path, recordBytes({ ...record, acceptanceRecords: [] }))
}

describe('managed custody recovery profile selection and carriage', () => {
  it('reads an earlier signed package and refuses an operation requiring its successor', async () => {
    const historical = await signedCopy(({ manifest }) => { manifest.profiles = manifest.profiles!.filter(value => value !== profile) })
    expect((await verifyApplicationPackage(historical, trust())).journals).toHaveLength(1)
    await expect(verifyApplicationPackage(historical, { ...trust(), requiredCustodyProfile: profile })).rejects.toMatchObject({ code: 'not-selected' })
  })

  it('refuses a signed profile list that is a string or has a non-string member', async () => {
    for (const malformed of [`earlier-${profile}`, [profile, 3]]) {
      const pkg = await signedCopy(({ manifest }) => { Object.assign(manifest, { profiles: malformed }) })
      await expect(verifyApplicationPackage(pkg, { ...trust(), requiredCustodyProfile: profile })).rejects.toMatchObject({ code: 'manifest-invalid' })
    }
  })

  it('checks a nested authority entry against the signed index inventory and the completed transfer', async () => {
    const nestedRoot = `${folder}/index/`
    const path = 'authority/acceptance.json'
    const indexManifest = `${nestedRoot}manifest.json`
    async function addNested(copy: PackageCopy, record: ManagedAcceptanceRecord, outer: Partial<InventoryEntry> = {}) {
      const nested = JSON.parse(new TextDecoder().decode(copy.files.get(indexManifest)!)) as EvidencePackageManifest
      const bytes = recordBytes(record)
      const entry: InventoryEntry = { path, category: 'authority', mediaType: 'application/json', representation: record.acceptanceFormat, sha256: sha256Hex(bytes), byteLength: bytes.length }
      const key = platform.wallet.identityKey
      const signed = await signEvidenceManifest({
        ...nested, exporter: { ...nested.exporter, id: key }, profiles: [], inventory: [...nested.inventory, entry],
        signature: { suite: 'bsv-ecdsa-der', signer: evidencePackageSigner(key, id) },
      }, { sign: async data => (await platform.wallet.custodian.createSignature({ data, protocolID: EVIDENCE_PACKAGE_PROTOCOL, keyID: id, counterparty: 'anyone' })).signature })
      copy.files.set(indexManifest, recordBytes(signed))
      copy.files.set(nestedRoot + path, bytes)
      copy.manifest.inventory.push({ ...entry, path: nestedRoot + path, representation: 'dpp-nested-authority@1', ...outer })
    }
    const valid = await signedCopy(pkg => addNested(pkg, completed))
    expect((await verifyApplicationPackage(valid, trust())).journals[0]!.acceptanceRecords).toEqual([completed])
    for (const outer of [{ representation: completed.acceptanceFormat }, { represents: 'sha256:' + '00'.repeat(32) }, { category: 'reports' as const }]) {
      const changed = await signedCopy(pkg => addNested(pkg, completed, outer))
      await expect(verifyApplicationPackage(changed, trust())).rejects.toMatchObject({ code: 'index-evidence-refused' })
    }
    const unmatched = await signedCopy(pkg => addNested(pkg, pending))
    await expect(verifyApplicationPackage(unmatched, trust())).rejects.toMatchObject({ code: 'index-evidence-refused' })
    const hidden = await signedCopy(async pkg => {
      await addNested(pkg, completed)
      removeAuthority(pkg)
      const offerPath = `application/offers/${sha256Hex(completed.requestId)}.json`
      const offer = JSON.parse(new TextDecoder().decode(pkg.files.get(offerPath)!))
      delete offer.record
      pkg.files.set(offerPath, recordBytes(offer))
      pkg.manifest.completeness.absent.push(reference(completed))
    })
    await expect(verifyApplicationPackage(hidden, trust())).rejects.toMatchObject({ code: 'records-inconsistent' })
  })

  it('refuses a missing authority copy even if the exporter declared an acceptance it still carries in the offer absent', async () => {
    const copy = await signedCopy(pkg => { removeAuthority(pkg); pkg.manifest.completeness.absent.push(reference(completed)) })
    await expect(verifyApplicationPackage(copy, trust())).rejects.toMatchObject({ code: 'records-inconsistent' })
  })

  it('requires one absent declaration for a lost completed record and accepts its retained transfer', async () => {
    const lost = (pkg: PackageCopy) => {
      removeAuthority(pkg)
      const path = `application/offers/${sha256Hex(completed.requestId)}.json`
      const offer = JSON.parse(new TextDecoder().decode(pkg.files.get(path)!))
      delete offer.record
      pkg.files.set(path, recordBytes(offer))
    }
    const declared = await signedCopy(pkg => { lost(pkg); pkg.manifest.completeness.absent.push(reference(completed)) })
    const verified = await verifyApplicationPackage(declared, trust())
    expect(verified.journals[0]!.acceptanceRecords).toEqual([])
    expect(verified.offers.find(offer => offer.requestId === completed.requestId)).toMatchObject({ status: 'transferred' })
    const destination = await openPlatform({ config, mode: 'test', log: () => {} })
    try {
      const report = await restoreApplication({ verified, platform: destination, epcis: { storage: createMemoryEpcisStorage(), sources: [] }, rebuildIndex: true })
      expect(report.attention).toContainEqual(expect.stringContaining(reference(completed)))
    } finally {
      await destination.close()
    }
    await expect(verifyApplicationPackage(await signedCopy(lost), trust())).rejects.toMatchObject({ code: 'records-inconsistent' })
  })

  it('uses the recorded send outcome when an index already holds an interrupted transfer', async () => {
    function interrupt(pkg: PackageCopy) {
      removeAuthority(pkg)
      const path = `${folder}/journal.json`
      const journal = JSON.parse(new TextDecoder().decode(pkg.files.get(path)!))
      const draft = journal.states.at(-1)
      Object.assign(draft, { network: 'unanswered', acceptance: completed })
      pkg.files.set(path, recordBytes(journal))
      const offerPath = `application/offers/${sha256Hex(completed.requestId)}.json`
      const offer = JSON.parse(new TextDecoder().decode(pkg.files.get(offerPath)!))
      delete offer.transferTxid
      pkg.files.set(offerPath, recordBytes({ ...offer, status: 'accepted' }))
    }
    const verified = await verifyApplicationPackage(await signedCopy(interrupt), trust())
    expect(verified.journals[0]!.acceptanceRecords).toEqual([])
    expect(verified.offers.find(offer => offer.requestId === completed.requestId)?.record).toEqual(completed)
    const missingOffer = await signedCopy(pkg => {
      interrupt(pkg)
      const path = `${folder}/journal.json`
      const journal = JSON.parse(new TextDecoder().decode(pkg.files.get(path)!))
      delete journal.states.at(-1).acceptance
      pkg.files.set(path, recordBytes(journal))
      pkg.files.delete(`application/offers/${sha256Hex(completed.requestId)}.json`)
      const descriptor = JSON.parse(new TextDecoder().decode(pkg.files.get(APPLICATION_EXPORT_DESCRIPTOR)!))
      descriptor.records.offers -= 1
      pkg.files.set(APPLICATION_EXPORT_DESCRIPTOR, recordBytes(descriptor))
    })
    await expect(verifyApplicationPackage(missingOffer, trust())).rejects.toMatchObject({ code: 'records-inconsistent' })
    const falseLoss = await signedCopy(pkg => {
      interrupt(pkg)
      pkg.manifest.completeness.absent.push(reference(completed))
    })
    await expect(verifyApplicationPackage(falseLoss, trust())).rejects.toMatchObject({ code: 'records-inconsistent' })
  })

  it('refuses a declaration of loss when a completed journal state still carries its signed acceptance', async () => {
    const copy = await signedCopy(pkg => {
      removeAuthority(pkg)
      const path = `${folder}/journal.json`
      const journal = JSON.parse(new TextDecoder().decode(pkg.files.get(path)!))
      journal.states.at(-1).acceptance = completed
      pkg.files.set(path, recordBytes(journal))
      const offerPath = `application/offers/${sha256Hex(completed.requestId)}.json`
      const offer = JSON.parse(new TextDecoder().decode(pkg.files.get(offerPath)!))
      delete offer.record
      pkg.files.set(offerPath, recordBytes(offer))
      pkg.manifest.completeness.absent.push(reference(completed))
    })
    await expect(verifyApplicationPackage(copy, trust())).rejects.toMatchObject({ code: 'records-inconsistent' })
  })

  it('refuses a retained authority entry that names a pending acceptance and has no completed transfer', async () => {
    const copy = await signedCopy(({ manifest, files }) => {
      const path = authorityPath(pending)
      const source = manifest.inventory.find(entry => entry.path === authorityPath(completed))!
      manifest.inventory.push({ ...source, path, represents: `sha256:${acceptanceCommitment(pending)}` })
      files.set(path, recordBytes(pending))
      const journalPath = `${folder}/journal.json`
      const record = JSON.parse(new TextDecoder().decode(files.get(journalPath)!))
      files.set(journalPath, recordBytes({ ...record, acceptanceRecords: [completed, pending] }))
      const descriptor = structuredClone(base.descriptor)
      descriptor.passports[0]!.acceptanceRecords = 2
      files.set(APPLICATION_EXPORT_DESCRIPTOR, recordBytes(descriptor))
    })
    await expect(verifyApplicationPackage(copy, trust())).rejects.toMatchObject({ code: 'records-inconsistent' })
  })

  it('refuses an acceptance declared absent alongside its authority copy or withheld from recovery', async () => {
    for (const category of ['absent', 'withheld'] as const) {
      const copy = await signedCopy(({ manifest }) => manifest.completeness[category].push(reference(completed) + (category === 'withheld' ? ' not-public' : '')))
      await expect(verifyApplicationPackage(copy, trust())).rejects.toMatchObject({ code: 'records-inconsistent' })
    }
  })
})
