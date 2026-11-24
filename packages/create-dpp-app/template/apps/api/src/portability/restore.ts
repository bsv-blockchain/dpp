// Restoring an authorised export of this application into a deployment.
//
// A restore is two steps, kept apart on purpose. `verifyApplicationPackage`
// reads a package and checks all of it, against what this deployment trusts,
// and writes nothing: the manifest and its signature, every file against the
// inventory, the descriptor, each passport's journal and the index's signed
// evidence for it, the profile bundle against this deployment's own trusted
// binding digests, and the EPCIS snapshot by the module's own checks.
// `restoreApplication` takes what was verified, compares it with what the
// deployment already holds, and only then writes.
//
// Nothing is trusted because it was carried, and nothing because it was
// signed. The exporter's signature says who assembled the bytes. Whether a
// profile may be used here is decided by this deployment's trusted digests,
// so a correctly signed package that carries another definition under a
// profile's name is refused. Whether a record may be written here is decided
// by what is already here: an equal record is left alone, which is what makes
// a restore safe to run twice, and a different one stops the restore before
// anything is written.
//
// A restore is a data operation. It builds no state, signs nothing and moves
// no custody. The one thing it sends anywhere is each state's own bytes, as
// they were journalled, to this deployment's index, which rebuilds its
// records from them. Keys and credentials are not restored, because none are
// carried: continuing to write needs the wallet's keys, which travel by the
// wallet's own recovery, and each source's credential, which the operator
// configures again.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Transaction, Utils } from '@bsv/sdk'
import {
  acceptanceCommitment,
  evidencePackageSigner,
  findDppOutputs,
  inspectEvidencePackage,
  verifyChain,
  verifyOwnerBlob,
  type EvidencePackageManifest,
  type InventoryEntry,
  type ManagedAcceptanceRecord,
} from '@bsv/dpp-protocol'
import {
  EPCIS_LIFECYCLE_REPRESENTATION,
  verifyEpcisLifecycleClaim,
} from '@bsv/dpp-credentials/epcis-lifecycle'
import { BUNDLED_BINDINGS, BUNDLED_BINDING_DIGESTS, createProfileRegistry, isRetiredProfile, openProfileBundle, profileBundleFiles, registerProfileBundle } from '@bsv/dpp-profiles'
import { verifyGs1Artefacts } from '@bsv/dpp-credentials'
import { epcisRecoveryFiles, restoreEpcisRecovery, verifyEpcisRecovery, type EpcisExchangeStorage, type EpcisRestoreCounts, type VerifiedEpcisRecovery } from '@bsv/dpp-credentials/epcis-exchange'
import type { EpcisSourceConfig } from '../epcis/sources.js'
import type { Platform } from '../platform.js'
import { isProfileId } from '../profiles.js'
import { isEpcisLifecycleRecord, isInterrupted, type BrandRecord, type ClaimRecord, type OfferRecord, type PassportRecord, type StateEntry } from '../store.js'
import { declaredBindingDigest, summariseReading } from './export.js'
import {
  APPLICATION_EXPORT_DESCRIPTOR,
  APPLICATION_EXPORT_FORMAT,
  APPLICATION_EXPORT_LIMITS,
  APPLICATION_EXPORT_VERSION,
  APPLICATION_REPRESENTATIONS,
  EXPORT_SCOPE_PREFIX,
  PortabilityRefused,
  asNumberArrays,
  exportScopeId,
  passportFolder,
  recordBytes,
  sameBytes,
  sha256Hex,
  stableJson,
  type ApplicationExportDescriptor,
  type ExportedReading,
} from './package.js'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

/** What this deployment trusts, which decides what a package may bring. None of it is read from the package. */
export interface RestoreTrust {
  /** The identity key the export must be signed under: the publisher key of the deployment that made it. */
  exporterKey: string
  /** The binding digests this deployment reviewed and chose to trust, beside the ones its installed profiles package publishes. */
  trustedBindingDigests: readonly string[]
  /** The exporter identity key of the index whose evidence is carried, when this deployment was told it. Without it, each carried package is held to the key its own manifest names, which the export's signature covers. */
  indexExporterKey?: string
}

/** A package that was read and checked. Nothing has been written anywhere. */
export interface VerifiedApplicationPackage {
  manifest: EvidencePackageManifest
  descriptor: ApplicationExportDescriptor
  files: Map<string, Uint8Array>
  journals: PassportRecord[]
  brands: BrandRecord[]
  offers: OfferRecord[]
  claims: ClaimRecord[]
  readings: Map<string, ExportedReading>
  /** The profiles the bundle carries, each with the binding digest that registered under this deployment's trust. */
  profiles: Array<{ profile: string; bindingDigest: string }>
  epcis?: VerifiedEpcisRecovery
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const decoder = new TextDecoder('utf-8', { fatal: true })

/* ---------------------------------- verify ------------------------------- */

/**
 * Read a package and check all of it. A refusal is thrown as
 * `PortabilityRefused`, with a code that names what was wrong, and nothing is
 * written here whatever the answer.
 */
export async function verifyApplicationPackage(pkg: { manifestText?: string; files: Map<string, Uint8Array> }, trust: RestoreTrust): Promise<VerifiedApplicationPackage> {
  const { files } = pkg
  const refuse = (code: string, detail: string, data: Record<string, unknown> = {}): never => {
    throw new PortabilityRefused(code, `${detail} Nothing was written.`, data)
  }

  /* ---- the manifest, its signature and its inventory ---- */

  if (pkg.manifestText == null) refuse('manifest-missing', 'The folder holds no manifest.json, so it is not an evidence package.')
  let manifest: EvidencePackageManifest
  try {
    manifest = JSON.parse(pkg.manifestText as string) as EvidencePackageManifest
  } catch {
    return refuse('manifest-invalid', 'manifest.json is not JSON.')
  }
  if (!isObject(manifest) || typeof manifest.passportId !== 'string' || !manifest.passportId.startsWith(EXPORT_SCOPE_PREFIX)) {
    refuse('not-an-application-export', 'The package is not an export of an application: its manifest does not name an export. A package about one passport is restored into an index, by the index\'s own procedure.')
  }
  if (!/^0[23][0-9a-f]{64}$/.test(trust.exporterKey)) throw new TypeError('exporterKey must be a compressed public key')
  const expectedSigner = evidencePackageSigner(trust.exporterKey, manifest.passportId)
  const inspection = inspectEvidencePackage(manifest, asNumberArrays(files), { expectedSigner })
  const failed = (reason: string): Array<{ path?: string; detail: string }> => inspection.failures.filter((failure) => failure.reason === reason)
  if (!inspection.structureValid) refuse('manifest-invalid', `The manifest does not have the structure of dpp-evidence-package@1: ${inspection.failures.map((failure) => failure.detail).join('; ')}.`)
  if (manifest.exporter?.id !== trust.exporterKey || failed('signer-unexpected').length > 0) {
    refuse('exporter-unexpected', `The package says it was exported by ${String(manifest.exporter?.id)} and is signed by ${String(manifest.signature?.signer)}. This restore expects the exporter ${trust.exporterKey}.`, { exporter: manifest.exporter?.id })
  }
  if (inspection.signatureValid !== true) refuse('signature-invalid', 'The manifest\'s signature does not verify under the exporter\'s key, so nothing says who assembled these bytes.')
  const missing = failed('file-missing')
  if (missing.length > 0) refuse('package-incomplete', `The package is incomplete: ${missing.length === 1 ? 'a file its manifest lists is' : `${missing.length} files its manifest lists are`} not in the folder: ${missing.map((failure) => failure.path).join(', ')}.`, { missing: missing.map((failure) => failure.path) })
  const altered = [...failed('digest-mismatch'), ...failed('length-mismatch')]
  if (altered.length > 0) refuse('file-altered', `A file is not the bytes the signed manifest lists: ${[...new Set(altered.map((failure) => failure.path))].join(', ')}.`, { altered: [...new Set(altered.map((failure) => failure.path))] })
  const unlisted = failed('file-unlisted')
  if (unlisted.length > 0) refuse('file-unlisted', `The folder holds ${unlisted.length === 1 ? 'a file' : 'files'} the signed manifest does not list: ${unlisted.map((failure) => failure.path).join(', ')}. Nothing the exporter did not vouch for is restored.`, { unlisted: unlisted.map((failure) => failure.path) })
  if (!inspection.inventoryVerified || inspection.failures.length > 0) refuse('manifest-invalid', `The package does not inspect: ${inspection.failures.map((failure) => failure.detail).join('; ')}.`)

  if (manifest.disclosure.scope !== 'all-tiers' || manifest.disclosure.recoveryBackup !== true) {
    refuse('not-a-recovery-package', `The package was assembled under the ${manifest.disclosure.scope} disclosure and is not a recovery backup. A public export carries no journal and no operational record, and restores nothing.`)
  }

  const listed = new Map<string, InventoryEntry>(manifest.inventory.map((entry) => [entry.path, entry]))
  /** A file the package must hold, by the name of what it is. A missing one makes the package incomplete, by that name. */
  const need = (path: string, what: string): Uint8Array => {
    const bytes = listed.has(path) ? files.get(path) : undefined
    if (bytes == null) return refuse('package-incomplete', `The package is incomplete: it does not carry ${what} (${path}).`, { missing: [path] })
    return bytes
  }
  const json = <T>(path: string, what: string): T => {
    const bytes = need(path, what)
    try {
      return JSON.parse(decoder.decode(bytes)) as T
    } catch {
      return refuse('record-invalid', `${what} (${path}) is not JSON.`, { path })
    }
  }

  /* ---- the descriptor ---- */

  const descriptor = json<ApplicationExportDescriptor>(APPLICATION_EXPORT_DESCRIPTOR, 'the descriptor of the export')
  if (!isObject(descriptor) || descriptor.format !== APPLICATION_EXPORT_FORMAT || descriptor.version !== APPLICATION_EXPORT_VERSION) refuse('descriptor-invalid', `The descriptor is not ${APPLICATION_EXPORT_FORMAT} version ${APPLICATION_EXPORT_VERSION}, which is the one this application reads.`)
  if (descriptor.access !== 'authorised-recovery') refuse('not-a-recovery-package', 'The descriptor says the export is the public form. It restores nothing.')
  if (!Array.isArray(descriptor.passports) || !isObject(descriptor.profiles) || !isObject(descriptor.epcis) || !isObject(descriptor.records) || !isObject(descriptor.application)) refuse('descriptor-invalid', 'The descriptor lacks a member the format requires.')
  if (stableJson(descriptor.limits) !== stableJson(APPLICATION_EXPORT_LIMITS)) refuse('descriptor-invalid', 'The descriptor does not state the limits every export states.')
  if (descriptor.exportId !== manifest.passportId || exportScopeId(descriptor.passports.map((passport) => passport.passportId)) !== manifest.passportId) {
    refuse('export-scope-mismatch', 'The name of the export is not the one its passports give. The manifest was signed for another selection of passports than the descriptor lists.')
  }
  if (descriptor.application.publisherKey !== trust.exporterKey) refuse('descriptor-invalid', 'The descriptor names another publisher key than the one the package is signed under.')

  /* ---- each passport: the journal, the index's evidence and the reading ---- */

  const journals: PassportRecord[] = []
  const readings = new Map<string, ExportedReading>()
  const declaredDigests = new Map<string, string>()
  const accounted = new Set<string>([APPLICATION_EXPORT_DESCRIPTOR])
  for (const passport of descriptor.passports) {
    const { passportId } = passport
    const folder = passportFolder(passportId)
    if (passport.folder !== folder) refuse('descriptor-invalid', `The descriptor places ${passportId} in ${String(passport.folder)}, and a passport's folder is named by the digest of its identifier.`)
    const record = json<PassportRecord>(`${folder}/journal.json`, `the journal of ${passportId}`)
    accounted.add(`${folder}/journal.json`)
    if (!isObject(record) || record.passportId !== passportId || !Array.isArray(record.states) || record.states.length === 0 || !Array.isArray(record.acceptanceRecords)) refuse('record-invalid', `The journal of ${passportId} is not a journal of that passport.`, { passportId })
    if (record.states.length !== passport.states || record.states[0]!.txid !== passport.genesis || record.states.at(-1)!.txid !== passport.tip || record.profile !== passport.profile) {
      refuse('records-inconsistent', `The journal of ${passportId} is not the one the descriptor describes: its states, its first and newest transaction or its profile differ.`, { passportId })
    }
    // Every state is the transaction it says it is, about this passport, and its BEEF carries that transaction.
    const lineage: Transaction[] = []
    for (const state of record.states) {
      let tx: Transaction
      let carried: Transaction
      try {
        tx = Transaction.fromHex(state.rawTx)
        carried = Transaction.fromAtomicBEEF(Utils.toArray(state.beef, 'base64') as number[])
      } catch {
        return refuse('record-invalid', `A state of ${passportId} does not hold a transaction that parses.`, { passportId, txid: state.txid })
      }
      const held = findDppOutputs(tx).find((output) => output.outputIndex === state.outputIndex)?.state
      if (tx.id('hex') !== state.txid || carried.id('hex') !== state.txid || held == null || held.passportId !== passportId || held.payloadPublic !== state.payloadPublic) {
        refuse('records-inconsistent', `The state ${state.txid} of ${passportId} is not the transaction its journal entry describes.`, { passportId, txid: state.txid })
      }
      const tier = state.ownerTier
      if (tier != null && (typeof tier.ciphertext !== 'string' || tier.hash !== held!.payloadOwnerHash || !verifyOwnerBlob(Utils.toArray(tier.ciphertext, 'base64'), held!.payloadOwnerHash))) {
        refuse('records-inconsistent', `The retained owner tier of ${state.txid} differs from its signed commitment.`, { passportId, txid: state.txid })
      }
      lineage.push(tx)
      const digest = declaredBindingDigest(state.payloadPublic)
      if (digest != null) {
        const before = declaredDigests.get(record.profile)
        if (before != null && before !== digest) refuse('records-inconsistent', `The states of the carried passports declare ${record.profile} under two binding digests, ${before} and ${digest}. A profile version has one binding.`, { profile: record.profile })
        declaredDigests.set(record.profile, digest)
      }
    }
    // The writer's own check, on the lineage as carried: every link, every signature and the publisher's countersignature. No inclusion is checked here.
    const chain = await verifyChain(lineage, { chainTracker: 'scripts only', serverIdentityKey: trust.exporterKey, managedAcceptance: true })
    if (!chain.valid) refuse('journal-invalid', `The lineage the journal of ${passportId} carries does not verify: ${chain.error ?? 'no reason given'}.`, { passportId })

    // Each acceptance record a hand-on commits to is carried once more as the authority entry a reader of the package finds, and the two agree.
    const commitments = new Set<string>()
    for (const acceptance of record.acceptanceRecords as ManagedAcceptanceRecord[]) {
      const commitment = acceptanceCommitment(acceptance)
      const path = `${folder}/authority/${commitment}.json`
      const bytes = need(path, `the acceptance record ${commitment} of ${passportId}`)
      if (!sameBytes(bytes, recordBytes(acceptance)) || listed.get(path)!.represents !== `sha256:${commitment}`) refuse('records-inconsistent', `The acceptance record ${commitment} of ${passportId} differs between the journal and the authority entry.`, { passportId })
      commitments.add(commitment)
      accounted.add(path)
    }
    if (record.acceptanceRecords.length !== passport.acceptanceRecords) refuse('records-inconsistent', `The descriptor counts ${passport.acceptanceRecords} acceptance records for ${passportId} and its journal holds ${record.acceptanceRecords.length}.`, { passportId })

    await verifyIndexEvidence({ passportId, folder, form: passport.index?.form, manifest, files, listed, trust, journal: record, accounted, refuse })

    if (listed.has(`${folder}/reading.json`)) {
      readings.set(passportId, json<ExportedReading>(`${folder}/reading.json`, `the reading of ${passportId}`))
      accounted.add(`${folder}/reading.json`)
    }
    journals.push(record)
  }

  /* ---- this application's other records ---- */

  const recordsUnder = <T>(prefix: string, representation: string, what: string): T[] => {
    const out: T[] = []
    for (const entry of manifest.inventory) {
      if (!entry.path.startsWith(prefix)) continue
      if (entry.representation !== representation) refuse('record-invalid', `${entry.path} is listed as ${String(entry.representation)}, and a file there is ${what}.`, { path: entry.path })
      out.push(json<T>(entry.path, what))
      accounted.add(entry.path)
    }
    return out
  }
  const brands = recordsUnder<BrandRecord>('application/brands/', APPLICATION_REPRESENTATIONS.brand, 'a brand record')
  const offers = recordsUnder<OfferRecord>('application/offers/', APPLICATION_REPRESENTATIONS.offer, 'a hand-on offer')
  const claims = recordsUnder<ClaimRecord>('application/claims/', APPLICATION_REPRESENTATIONS.claim, 'a lifecycle claim')
  if (brands.length !== descriptor.records.brands || offers.length !== descriptor.records.offers || claims.length !== descriptor.records.claims) {
    refuse('package-incomplete', `The package is incomplete: the descriptor counts ${descriptor.records.brands} brands, ${descriptor.records.offers} offers and ${descriptor.records.claims} claims, and the package carries ${brands.length}, ${offers.length} and ${claims.length}.`)
  }
  for (const record of journals) {
    // A brand the exporting deployment held no record of is said to be absent, by name. One that is neither carried nor declared was left out.
    const declaredAbsent = manifest.completeness.absent.some((line) => line.startsWith(`brand:${record.brandId} `))
    if (!brands.some((brand) => brand.id === record.brandId) && !declaredAbsent) refuse('package-incomplete', `The package is incomplete: it does not carry the brand record of ${record.brandId}, which holds ${record.passportId}.`, { brandId: record.brandId })
  }
  for (const offer of offers) if (!journals.some((record) => record.passportId === offer.passportId)) refuse('records-inconsistent', `The offer ${offer.requestId} is about a passport the package does not carry.`)
  for (const claim of claims) {
    const about = isEpcisLifecycleRecord(claim) ? claim.boundPassports : [claim.passportId]
    if (!journals.some((record) => about.includes(record.passportId))) refuse('records-inconsistent', `The claim ${claim.id} is about a passport the package does not carry.`)
    if (!isEpcisLifecycleRecord(claim)) continue
    // An EPCIS lifecycle claim travels as its exact signed bytes, and is restored only when those bytes verify as the claim the record names.
    const path = `application/lifecycle-claims/${sha256Hex(claim.id)}.json`
    if (listed.get(path)?.representation !== EPCIS_LIFECYCLE_REPRESENTATION) refuse('package-incomplete', `The package is incomplete: it does not carry the signed bytes of the claim ${claim.id} (${path}).`, { missing: [path] })
    const carried = decoder.decode(need(path, `the signed bytes of the claim ${claim.id}`))
    accounted.add(path)
    const verified = await verifyEpcisLifecycleClaim(carried)
    if (carried !== claim.bytes || verified.attestationId !== claim.attestationId || verified.findings.signature.status !== 'pass' || verified.findings.eventStructure.status === 'fail') {
      refuse('claim-invalid', `The claim ${claim.id} does not verify from the bytes the package carries: ${carried !== claim.bytes ? 'the record and the signed bytes differ' : verified.findings.signature.status !== 'pass' ? 'its signature does not hold' : verified.attestationId !== claim.attestationId ? 'the bytes are not the claim the record names' : 'its event is refused'}.`, { claim: claim.id })
    }
  }
  for (const entry of manifest.inventory) {
    if (entry.path.startsWith('application/lifecycle-claims/') && !accounted.has(entry.path)) refuse('records-inconsistent', `${entry.path} carries the bytes of a claim no record of the package names.`, { path: entry.path })
  }

  /* ---- the profiles, under this deployment's trust ---- */

  const profiles: VerifiedApplicationPackage['profiles'] = []
  const carried = Array.isArray(descriptor.profiles.carried) ? descriptor.profiles.carried : []
  for (const record of journals) {
    const declares = declaredDigests.has(record.profile)
    if (declares && !carried.includes(record.profile)) refuse('package-incomplete', `The package is incomplete: ${record.passportId} declares ${record.profile} under a binding, and the package does not carry that profile.`, { profile: record.profile })
    if (!declares && !carried.includes(record.profile) && !isProfileId(record.profile) && !isRetiredProfile(record.profile)) refuse('profile-not-available', `${record.passportId} is under ${record.profile}, which the package does not carry and this deployment's profiles package does not define.`, { profile: record.profile })
  }
  if (carried.length > 0) {
    const root = descriptor.profiles.root ?? 'profiles'
    const opened = await openProfileBundle(profileBundleFiles(files), { root })
    if (!opened.ok) return refuse('profile-refused', `The profile bundle is refused (${opened.code}): ${opened.detail}`, { code: opened.code })
    const missingFromBundle = carried.filter((profile) => !opened.bundle.profiles.includes(profile))
    if (missingFromBundle.length > 0) refuse('package-incomplete', `The package is incomplete: its bundle does not cover ${missingFromBundle.join(', ')}, which its records declare.`, { profiles: missingFromBundle })
    // What this deployment expects each name to be: the digest its installed profiles package publishes for a sector profile, and the digest the carried states declare.
    const expected = new Map<string, string>(BUNDLED_BINDINGS.map((entry) => [entry.profile, entry.bindingDigest]))
    for (const [profile, digest] of declaredDigests) {
      const known = expected.get(profile)
      if (known != null && known !== digest) refuse('profile-binding-conflict', `The carried states declare ${profile} under binding ${digest}, and this deployment's profiles package knows ${profile} under ${known}. They are different definitions under one name.`, { profile })
      expected.set(profile, digest)
    }
    // A registry of its own, with this deployment's trusted digests, so that the answer is the one start-up will give and nothing is registered yet.
    const registry = createProfileRegistry({ trustedBindingDigests: [...BUNDLED_BINDING_DIGESTS, ...trust.trustedBindingDigests] })
    const results = await registerProfileBundle(registry, opened.bundle, { profiles: opened.bundle.profiles, expected: [...expected].map(([profile, bindingDigest]) => ({ profile, bindingDigest })) })
    for (const result of results) {
      if (!result.ok) {
        return refuse('profile-refused', `The profile ${result.profile ?? ''} in the package is refused (${result.code}): ${result.detail}`, { code: result.code, ...(result.profile == null ? {} : { profile: result.profile }), ...(result.bindingDigest == null ? {} : { bindingDigest: result.bindingDigest }) })
      }
      profiles.push({ profile: result.profile.profile, bindingDigest: result.profile.bindingDigest })
    }
    for (const entry of manifest.inventory) if (entry.path.startsWith(`${root}/`)) accounted.add(entry.path)
  }

  /* ---- the EPCIS exchange, by the module's own checks ---- */

  let epcis: VerifiedEpcisRecovery | undefined
  if (descriptor.epcis.root != null) {
    const root = descriptor.epcis.root
    const verified = await verifyEpcisRecovery(epcisRecoveryFiles(files), { inventory: manifest.inventory, root })
    if (!verified.ok) return refuse('epcis-refused', `The EPCIS snapshot is refused (${verified.code}): ${verified.detail}`, { code: verified.code, ...(verified.path == null ? {} : { path: verified.path }), ...(verified.breaches == null ? {} : { breaches: verified.breaches }) })
    if (verified.descriptor.snapshot.snapshotId !== descriptor.epcis.snapshotId) refuse('records-inconsistent', 'The EPCIS snapshot in the package is not the one the descriptor names.')
    epcis = verified
    for (const entry of manifest.inventory) if (entry.path.startsWith(`${root}/`)) accounted.add(entry.path)
  }

  // Every file is part of something this restore understands. One that is not is never carried along unread.
  const stray = manifest.inventory.map((entry) => entry.path).filter((path) => !accounted.has(path))
  if (stray.length > 0) refuse('file-unaccounted', `The package lists ${stray.length === 1 ? 'a file' : 'files'} that belong to no part of an export this application reads: ${stray.slice(0, 8).join(', ')}${stray.length > 8 ? ` and ${stray.length - 8} more` : ''}.`, { paths: stray })

  return { manifest, descriptor, files, journals, brands, offers, claims, readings, profiles, ...(epcis == null ? {} : { epcis }) }
}

/** The index's signed evidence for one passport: inspected under the index's exporter key, and held against the journal. */
async function verifyIndexEvidence(args: {
  passportId: string
  folder: string
  form: string | undefined
  manifest: EvidencePackageManifest
  files: Map<string, Uint8Array>
  listed: Map<string, InventoryEntry>
  trust: RestoreTrust
  journal: PassportRecord
  accounted: Set<string>
  refuse: (code: string, detail: string, data?: Record<string, unknown>) => never
}): Promise<void> {
  const { passportId, folder, form, files, listed, trust, journal, accounted, refuse } = args
  const base = `${folder}/index/`
  const under = [...listed.keys()].filter((path) => path.startsWith(base))
  if (form === 'none') {
    if (under.length > 0) refuse('records-inconsistent', `The descriptor says no index evidence is carried for ${passportId}, and the package holds some.`, { passportId })
    return
  }
  if (form !== 'package' && form !== 'bounded-package' && form !== 'export-parts') refuse('descriptor-invalid', `The descriptor does not say how the index's evidence for ${passportId} is carried.`)
  for (const path of under) accounted.add(path)

  const signerFor = (nested: EvidencePackageManifest): string => {
    const key = trust.indexExporterKey ?? nested.exporter?.id
    // An index on an earlier release signed with its raw export key and names it as both.
    return nested.exporter?.id === key && nested.signature?.signer === key ? key : evidencePackageSigner(String(key), passportId)
  }
  const read = (at: string): { nested: EvidencePackageManifest; nestedFiles: Map<string, Uint8Array> } => {
    const bytes = listed.has(`${at}manifest.json`) ? files.get(`${at}manifest.json`) : undefined
    if (bytes == null) return refuse('package-incomplete', `The package is incomplete: it does not carry the manifest of the index's evidence for ${passportId} (${at}manifest.json).`, { missing: [`${at}manifest.json`] })
    let nested: EvidencePackageManifest
    try {
      nested = JSON.parse(decoder.decode(bytes)) as EvidencePackageManifest
    } catch {
      return refuse('index-evidence-refused', `The manifest of the index's evidence for ${passportId} is not JSON.`, { passportId })
    }
    const nestedFiles = new Map<string, Uint8Array>()
    for (const entry of Array.isArray(nested?.inventory) ? nested.inventory : []) {
      const held = listed.has(`${at}${entry.path}`) ? files.get(`${at}${entry.path}`) : undefined
      if (held != null) nestedFiles.set(entry.path, held)
    }
    return { nested, nestedFiles }
  }
  const transactions = new Map<string, Uint8Array>()
  const collect = (nested: EvidencePackageManifest, nestedFiles: Map<string, Uint8Array>): void => {
    for (const entry of nested.inventory) if (entry.category === 'transactions' && entry.path.endsWith('.tx')) transactions.set(entry.path.slice(entry.path.lastIndexOf('/') + 1, -3), nestedFiles.get(entry.path)!)
  }

  if (form === 'export-parts') {
    const { joinEvidenceExport } = await import('@bsv/dpp-overlay')
    const parts: Array<Record<string, unknown>> = []
    for (let at = 1; listed.has(`${base}part-${at}/manifest.json`); at += 1) {
      const { nested, nestedFiles } = read(`${base}part-${at}/`)
      const coverageBytes = files.get(`${base}part-${at}/coverage.json`)
      if (coverageBytes == null) return refuse('package-incomplete', `The package is incomplete: part ${at} of the index's evidence for ${passportId} has no coverage record.`, { passportId })
      const coverage = JSON.parse(decoder.decode(coverageBytes)) as Record<string, unknown>
      // The cursor is not part of what the index signed and was not carried. It only has to agree with the signed final flag.
      parts.push({ ...coverage, nextCursor: coverage.final === true ? null : 'not-carried', package: { manifest: nested, files: Object.fromEntries([...nestedFiles].map(([path, bytes]) => [path, Buffer.from(bytes).toString('base64')])) } })
      collect(nested, nestedFiles)
    }
    if (parts.length === 0) refuse('package-incomplete', `The package is incomplete: it carries no part of the index's evidence for ${passportId}.`, { passportId })
    const first = (parts[0] as { package: { manifest: EvidencePackageManifest } }).package.manifest
    const joined = joinEvidenceExport(parts as never, { expectedPassportId: passportId, expectedSigner: signerFor(first) })
    if (!joined.complete) refuse('index-evidence-refused', `The index's evidence for ${passportId} is refused: ${joined.problems.join('; ')}.`, { passportId, problems: joined.problems })
  } else {
    const { nested, nestedFiles } = read(base)
    const inspection = inspectEvidencePackage(nested, asNumberArrays(nestedFiles), { expectedPassportId: passportId, expectedSigner: signerFor(nested) })
    if (!inspection.structureValid || !inspection.inventoryVerified || inspection.signatureValid !== true || inspection.failures.length > 0) {
      refuse('index-evidence-refused', `The index's evidence for ${passportId} is refused: ${inspection.failures.map((failure) => failure.detail).join('; ')}.`, { passportId, failures: inspection.failures.map((failure) => failure.reason) })
    }
    if (form === 'package' && !nested.completeness.snapshots.every((snapshot) => snapshot.completeForSnapshot)) refuse('records-inconsistent', `The descriptor says the index's package for ${passportId} is complete for its snapshot, and the package does not say so.`, { passportId })
    collect(nested, nestedFiles)
    // A file under the folder that the index's own manifest does not list was not vouched for by the index.
    const extra = under.filter((path) => path !== `${base}manifest.json` && !nested.inventory.some((entry) => `${base}${entry.path}` === path))
    if (extra.length > 0) refuse('index-evidence-refused', `The folder of the index's evidence for ${passportId} holds files its manifest does not list: ${extra.join(', ')}.`, { passportId })
  }
  // The index and the journal describe one lineage: a transaction the index holds for the passport is a state of the journal, in the same bytes.
  for (const [txid, raw] of transactions) {
    const state = journal.states.find((candidate) => candidate.txid === txid)
    if (state == null || state.rawTx !== Buffer.from(raw).toString('hex')) refuse('records-inconsistent', `The index's evidence for ${passportId} holds the transaction ${txid}, which the journal does not hold in those bytes.`, { passportId, txid })
  }
}

/* --------------------------------- restore ------------------------------- */

export interface RestoreApplicationInput {
  verified: VerifiedApplicationPackage
  platform: Platform
  /** The exchange's store at this deployment, whichever adapter the configuration chose, the sources it is configured with, and the folder its GS1 files are read from, as the configuration names it. */
  epcis: { storage: EpcisExchangeStorage; sources: EpcisSourceConfig[]; artefactsDir?: string }
  /**
   * Whether each state is announced to this deployment's index again. True
   * for an index that persists. An index that runs inside a development
   * process forgets everything when that process ends, so a command line
   * that is about to exit passes false and says so.
   */
  rebuildIndex: boolean
  now?: () => string
  log?: (line: string) => void
}

export interface RestoreReport {
  /** `restored`: something was written. `unchanged`: this deployment already held all of it, and nothing was written. */
  outcome: 'restored' | 'unchanged'
  exportId: string
  exportedAt: string
  exporter: string
  passports: { written: string[]; unchanged: string[] }
  records: { brands: { written: number; unchanged: number }; offers: { written: number; unchanged: number }; claims: { written: number; unchanged: number } }
  profiles: {
    /** Where this deployment resolves bound profiles from. */
    resolver: 'package' | 'bundle'
    /** The folder the bundle was installed into, for the bundle resolver. */
    folder?: string
    filesWritten: number
    filesUnchanged: number
    /** Each carried profile as this deployment now holds it. */
    registered: Array<{ profile: string; bindingDigest: string }>
    /** Carried profiles this deployment does not hold after the restore, by name. */
    notRegistered: string[]
  }
  epcis?: { outcome: 'restored' | 'resumed' | 'unchanged'; snapshotId: string; sourceIds: string[]; written: EpcisRestoreCounts; unchanged: EpcisRestoreCounts; relocations: number; associationsRebuilt?: number }
  /** What became of the index's records of each passport. */
  index: { rebuilt: boolean; reason?: string; announced: number; admitted: number; duplicate: number; notAnnounced: Array<{ passportId: string; txid: string; answer: string; detail?: string }> }
  /** Each passport read again here, as any reader reads it, and held against how it read where it was exported. */
  readings: { compared: number; same: number; different: Array<{ passportId: string; differences: string[] }>; notCompared: Array<{ passportId: string; reason: string }> }
  /** What no export carries, and so what the operator provides at this deployment before it carries on. */
  provisionSeparately: string[]
  /** What needs a person's attention. Empty when the restore left nothing open. */
  attention: string[]
}

/** A journal without the answers its states got from the index it was written under: those belong to that index, and are the one part a restore may set again. */
const withoutIndexAnswers = (record: PassportRecord): unknown => ({ ...record, states: record.states.map(({ index: _index, refusal: _refusal, proofPushed: _pushed, ...state }: StateEntry) => state) })

/** Where two readings differ, as short sentences. Empty when they are the same reading. */
function readingDifferences(exported: ExportedReading, here: ExportedReading): string[] {
  const differences: string[] = []
  if (JSON.stringify(exported.lineage) !== JSON.stringify(here.lineage)) differences.push('the lineage differs')
  const names = new Set([...exported.checks, ...here.checks].map((check) => check.name))
  for (const name of names) {
    const a = exported.checks.find((check) => check.name === name)
    const b = here.checks.find((check) => check.name === name)
    if (a?.status !== b?.status || a?.reasonCode !== b?.reasonCode) differences.push(`${name}: ${a == null ? 'absent' : `${a.status}${a.reasonCode == null ? '' : ` (${a.reasonCode})`}`} where it was exported, ${b == null ? 'absent' : `${b.status}${b.reasonCode == null ? '' : ` (${b.reasonCode})`}`} here`)
  }
  if (exported.payloadChecks.length !== here.payloadChecks.length) differences.push(`${exported.payloadChecks.length} payload checks where it was exported, ${here.payloadChecks.length} here`)
  exported.payloadChecks.forEach((check, at) => {
    const other = here.payloadChecks[at]
    if (other != null && sha256Hex(recordBytes(check)) !== sha256Hex(recordBytes(other))) differences.push(`the payload check of state ${check.stateIndex} under ${check.profile}: ${check.status}${check.cause == null ? '' : ` (${check.cause})`} where it was exported, ${other.status}${other.cause == null ? '' : ` (${other.cause})`} here, or its steps or findings differ`)
  })
  if (exported.chainTracker !== here.chainTracker) differences.push(`inclusion was read against ${exported.chainTracker} where it was exported and ${here.chainTracker} here`)
  return differences
}

export async function restoreApplication(input: RestoreApplicationInput): Promise<RestoreReport> {
  const { verified, platform } = input
  const { manifest, descriptor, files } = verified
  const { store, index, profiles, config } = platform
  const log = input.log ?? (() => {})
  const refuse = (code: string, detail: string, data: Record<string, unknown> = {}): never => {
    throw new PortabilityRefused(code, detail, data)
  }

  /* ---- compare with what is here, before anything is written ---- */

  const collisions: Array<{ kind: string; identity: string }> = []
  const plan = { passports: [] as PassportRecord[], passportsUnchanged: [] as string[], brands: [] as BrandRecord[], brandsUnchanged: 0, offers: [] as OfferRecord[], offersUnchanged: 0, claims: [] as ClaimRecord[], claimsUnchanged: 0 }
  const same = (a: unknown, b: unknown): boolean => sha256Hex(recordBytes(a)) === sha256Hex(recordBytes(b))
  for (const record of verified.journals) {
    const held = await store.getPassport(record.passportId)
    if (held == null) plan.passports.push(record)
    else if (same(withoutIndexAnswers(held), withoutIndexAnswers(record))) plan.passportsUnchanged.push(record.passportId)
    else collisions.push({ kind: 'passport', identity: record.passportId })
  }
  for (const brand of verified.brands) {
    const held = await store.getBrand(brand.id)
    if (held == null) plan.brands.push(brand)
    else if (same(held, brand)) plan.brandsUnchanged += 1
    else collisions.push({ kind: 'brand', identity: brand.id })
  }
  for (const offer of verified.offers) {
    const held = await store.getOffer(offer.requestId)
    if (held == null) plan.offers.push(offer)
    else if (same(held, offer)) plan.offersUnchanged += 1
    else collisions.push({ kind: 'offer', identity: offer.requestId })
  }
  for (const claim of verified.claims) {
    const held = (await store.listClaims({ passportId: claim.passportId })).find((candidate) => candidate.id === claim.id)
    if (held == null) plan.claims.push(claim)
    else if (same(held, claim)) plan.claimsUnchanged += 1
    else collisions.push({ kind: 'claim', identity: claim.id })
  }

  // The bundle folder holds one bundle. An empty one takes this bundle; one that holds exactly this bundle is left; any other is not written over.
  const bundleRoot = descriptor.profiles.root
  const bundleFiles = bundleRoot == null ? [] : [...files].filter(([path]) => path.startsWith(`${bundleRoot}/`))
  const bundleDir = config.profileBundleDir == null ? undefined : isAbsolute(config.profileBundleDir) ? config.profileBundleDir : resolve(PROJECT_ROOT, config.profileBundleDir)
  const toInstall: Array<[string, Uint8Array]> = []
  let bundleUnchanged = 0
  if (bundleDir != null && bundleFiles.length > 0) {
    const target = (path: string): string => join(bundleDir, ...path.split('/'))
    for (const [path, bytes] of bundleFiles) {
      if (!existsSync(target(path))) toInstall.push([path, bytes])
      else if (sameBytes(new Uint8Array(readFileSync(target(path))), bytes)) bundleUnchanged += 1
      else collisions.push({ kind: 'profile-bundle-file', identity: path })
    }
    const occupied = existsSync(join(bundleDir, ...String(bundleRoot).split('/'))) && bundleUnchanged === 0 && readdirSync(join(bundleDir, ...String(bundleRoot).split('/'))).length > 0
    if (occupied) collisions.push({ kind: 'profile-bundle', identity: `${bundleDir} already holds another bundle` })
  }
  if (collisions.length > 0) {
    refuse('reconciliation-required', `This deployment already holds ${collisions.length === 1 ? 'a record' : `${collisions.length} records`} that differ from the package's under the same identity: ${collisions.slice(0, 8).map((collision) => `${collision.kind} ${collision.identity}`).join('; ')}${collisions.length > 8 ? ` and ${collisions.length - 8} more` : ''}. Nothing was written. A restore never overwrites: decide which stands, by hand.`, { collisions })
  }

  /* ---- write ---- */

  // The exchange first. The module compares its destination before it writes, so a refusal here has still written nothing anywhere.
  let epcis: RestoreReport['epcis']
  if (verified.epcis != null) {
    const restored = await restoreEpcisRecovery({ storage: input.epcis.storage, source: epcisRecoveryFiles(files), inventory: manifest.inventory, root: verified.epcis.root, ...(input.now == null ? {} : { now: input.now }) })
    if (!restored.ok) {
      // Two of the module's refusals come after it began to write. Every other one is made before anything is written, here or anywhere else.
      const begun = restored.code === 'destination-original-unverified' || restored.code === 'destination-inconsistent'
      return refuse('epcis-refused', `The EPCIS snapshot was not restored (${restored.code}): ${restored.detail} ${begun ? 'The exchange\'s store holds part of the snapshot and says its restore is unfinished. No passport, brand, offer, claim or profile was written.' : 'Nothing was written.'}`, { code: restored.code, ...(restored.collisions == null ? {} : { collisions: restored.collisions }), ...(restored.breaches == null ? {} : { breaches: restored.breaches }) })
    }
    epcis = { outcome: restored.outcome, snapshotId: restored.snapshotId, sourceIds: restored.sourceIds, written: restored.written, unchanged: restored.unchanged, relocations: restored.relocations.length, ...(restored.associations == null ? {} : { associationsRebuilt: restored.associations.associationsWritten }) }
    log(`EPCIS exchange: ${restored.outcome}; ${restored.written.imports} imports and ${restored.written.originals} originals written.`)
  }

  // The profiles next, where this deployment resolves them from a bundle of its own. They are registered again from the folder, under this deployment's trust.
  if (bundleDir != null && toInstall.length > 0) {
    for (const [path, bytes] of toInstall) {
      const target = join(bundleDir, ...path.split('/'))
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, bytes)
    }
    await profiles.reload()
    log(`Profiles: ${toInstall.length} files of the bundle installed into ${bundleDir}.`)
  }
  const registered: RestoreReport['profiles']['registered'] = []
  const notRegistered: string[] = []
  for (const carried of verified.profiles) {
    const held = profiles.get(carried.profile)
    if (held != null && held.bindingDigest === carried.bindingDigest) registered.push({ profile: carried.profile, bindingDigest: held.bindingDigest })
    else notRegistered.push(carried.profile)
  }

  for (const brand of plan.brands) await store.saveBrand(brand)
  for (const record of plan.passports) await store.changePassport(record.passportId, (held) => {
    if (held == null) return record
    if (same(withoutIndexAnswers(held), withoutIndexAnswers(record))) return held
    refuse('reconciliation-required', 'the destination journal changed during restore', { passportId: record.passportId })
  })
  for (const offer of plan.offers) await store.saveOffer(offer)
  for (const claim of plan.claims) await store.saveClaim(claim)

  /* ---- rebuild what is derived: this deployment's index is given each state again ---- */

  const indexReport: RestoreReport['index'] = { rebuilt: input.rebuildIndex, announced: 0, admitted: 0, duplicate: 0, notAnnounced: [] }
  if (!input.rebuildIndex) {
    indexReport.reason = 'this deployment has not joined an index that persists, so no state was announced. Connect one, then run the restore again: it changes no record and announces each state.'
  } else {
    for (const exported of verified.journals) {
      const record = (await store.getPassport(exported.passportId))!
      for (const state of record.states) {
        // A state whose send was never answered for is the operator's to resolve. It is not announced as if it had been written.
        if (isInterrupted(state)) {
          indexReport.notAnnounced.push({ passportId: record.passportId, txid: state.txid, answer: 'not-announced', detail: `its journal entry says the network answer is ${state.network}` })
          continue
        }
        const answer = await index.announce(Utils.toArray(state.sentBeef ?? state.beef, 'base64') as number[])
        indexReport.announced += 1
        const refusal = index.lastRefusal
        const admitted = answer === 'admitted' || answer === 'duplicate'
        await store.changePassport(record.passportId, (latest) => {
          const entry = latest?.states.find((item) => item.txid === state.txid)
          if (entry != null && entry.index === state.index && entry.refusal === state.refusal) {
            if (!admitted || (entry.index !== 'admitted' && entry.index !== 'duplicate')) Object.assign(entry, { index: answer, refusal: admitted ? undefined : refusal })
          }
          return latest
        })
        if (admitted) {
          if (answer === 'admitted') indexReport.admitted += 1
          else indexReport.duplicate += 1
        } else {
          indexReport.notAnnounced.push({ passportId: record.passportId, txid: state.txid, answer, ...(refusal == null ? {} : { detail: refusal }) })
          break
        }
      }
    }
  }

  /* ---- read each passport here, and hold it against how it read where it was exported ---- */

  const readings: RestoreReport['readings'] = { compared: 0, same: 0, different: [], notCompared: [] }
  for (const record of verified.journals) {
    const exported = verified.readings.get(record.passportId)
    if (exported == null) {
      readings.notCompared.push({ passportId: record.passportId, reason: 'the package carries no reading of it' })
      continue
    }
    if (!input.rebuildIndex) {
      readings.notCompared.push({ passportId: record.passportId, reason: 'this deployment\'s index was not given its states' })
      continue
    }
    let here: ExportedReading
    try {
      here = summariseReading(await platform.read(record.passportId), platform.chainTracker)
    } catch (cause) {
      readings.notCompared.push({ passportId: record.passportId, reason: cause instanceof Error ? cause.message : String(cause) })
      continue
    }
    readings.compared += 1
    const differences = readingDifferences(exported, here)
    if (differences.length === 0) readings.same += 1
    else readings.different.push({ passportId: record.passportId, differences })
  }

  /* ---- what is the operator's to provide, and what needs attention ---- */

  const gs1 = verifyGs1Artefacts(input.epcis.artefactsDir == null ? {} : { dir: isAbsolute(input.epcis.artefactsDir) ? input.epcis.artefactsDir : resolve(PROJECT_ROOT, input.epcis.artefactsDir) })
  const provisionSeparately = [
    'The wallet\'s root key and file, by the wallet\'s own recovery, and BRAND_ROOT_SECRET and MANAGED_IDENTITY_SECRET as they were: without them this deployment reads every passport and can write none of them.',
    'The index: its address and this application\'s tokens (npm run connect-index or go-live), and the index must admit this application\'s publisher key.',
    'Sign-in accounts and the membership of each brand.',
    ...(descriptor.epcis.sources ?? []).map((source) => {
      const configured = input.epcis.sources.find((candidate) => candidate.sourceId === source.sourceId)
      const credential = !source.credentialConfigured ? 'It had no credential.' : configured?.credentials != null ? 'Its credential is configured here.' : `Its ${source.credentialScheme ?? ''} credential is not configured here: set it before a pull.`
      return `The EPCIS source ${source.sourceId}: ${configured == null ? `it is not configured here. It was reached at ${source.baseUrl}.` : configured.baseUrl === source.baseUrl ? 'it is configured here at the address it had.' : `it is configured here at another address than ${source.baseUrl}: declare the move (npm run epcis-remap -- --source ${source.sourceId}) before a pull.`} ${credential}`
    }),
    gs1.ok ? `The GS1 files for EPCIS validation are present in ${gs1.dir}.` : `The GS1 files for EPCIS validation are not in ${gs1.dir}: this deployment obtains them from GS1 at start, or the operator places them. Until then every import and pull is refused.`,
  ]
  const attention: string[] = []
  if (notRegistered.length > 0) attention.push(`This deployment does not hold ${notRegistered.join(', ')} under the binding the records declare. ${bundleDir == null ? 'It resolves profiles from the installed package and its own folders: set PROFILE_BUNDLE_DIR to resolve them from the package\'s bundle, or add the profile\'s folder and trust its digest.' : 'Its trusted digests do not admit the bundle\'s binding.'} Until then those passports read as "not checked" and cannot be written.`)
  for (const entry of indexReport.notAnnounced) attention.push(`The state ${entry.txid} of ${entry.passportId} was not taken by this deployment's index: ${entry.answer}${entry.detail == null ? '' : ` (${entry.detail})`}.`)
  for (const entry of readings.different) attention.push(`${entry.passportId} reads differently here: ${entry.differences.join('; ')}.`)
  if (!gs1.ok) attention.push('The GS1 files are not provisioned here yet.')

  const wrote = plan.passports.length + plan.brands.length + plan.offers.length + plan.claims.length + toInstall.length > 0 || (epcis != null && epcis.outcome !== 'unchanged')
  return {
    outcome: wrote ? 'restored' : 'unchanged',
    exportId: descriptor.exportId,
    exportedAt: descriptor.exportedAt,
    exporter: manifest.exporter.id,
    passports: { written: plan.passports.map((record) => record.passportId), unchanged: plan.passportsUnchanged },
    records: { brands: { written: plan.brands.length, unchanged: plan.brandsUnchanged }, offers: { written: plan.offers.length, unchanged: plan.offersUnchanged }, claims: { written: plan.claims.length, unchanged: plan.claimsUnchanged } },
    profiles: { resolver: profiles.source, ...(bundleDir == null ? {} : { folder: bundleDir }), filesWritten: toInstall.length, filesUnchanged: bundleUnchanged, registered, notRegistered },
    ...(epcis == null ? {} : { epcis }),
    index: indexReport,
    readings,
    provisionSeparately,
    attention,
  }
}
