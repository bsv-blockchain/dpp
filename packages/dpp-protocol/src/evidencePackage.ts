/**
 * The evidence package (`spec/portable-evidence.md` §2,
 * `contracts/evidence-package.schema.json`): a signed manifest over a
 * content-addressed inventory. The signature says who assembled which bytes;
 * `inspectEvidencePackage` therefore answers three separate questions, the
 * manifest's structure, the inventory against the files, and the signature,
 * and never folds them into one Boolean. A reader verifies every transaction,
 * proof and claim inside independently of who signed the package.
 */
import { Hash, PublicKey, Signature, Utils } from '@bsv/sdk'
import { canonicalJson, CanonicalJsonError } from './canonicalJson.js'

export const EVIDENCE_PACKAGE_FORMAT = 'dpp-evidence-package'
export const EVIDENCE_PACKAGE_VERSION = '1'
export const EVIDENCE_PACKAGE_MANIFEST_PATH = 'manifest.json'

export type InventoryCategory = 'transactions' | 'proofs' | 'native-claims' | 'external-credentials' | 'evidence' | 'schemas' | 'authority' | 'status' | 'reports'
export const INVENTORY_CATEGORIES: readonly InventoryCategory[] = ['transactions', 'proofs', 'native-claims', 'external-credentials', 'evidence', 'schemas', 'authority', 'status', 'reports']
export type DisclosureScope = 'public' | 'public-and-owner' | 'public-and-legitimate' | 'public-and-authority' | 'all-tiers'

export interface InventoryEntry {
  path: string
  category: InventoryCategory
  mediaType: string
  byteLength: number
  sha256: string
  encrypted?: boolean
  represents?: string
  representation?: string
}

export interface SourceObservation {
  id: string
  kind: 'overlay-lookup' | 'spend-status' | 'header-source' | 'registry' | 'other'
  observedAt: string
  result: 'unspent' | 'spent' | 'not-found' | 'unavailable' | 'conflicting'
  height?: number
  blockHash?: string
}

export interface EvidencePackageManifest {
  format: typeof EVIDENCE_PACKAGE_FORMAT
  version: typeof EVIDENCE_PACKAGE_VERSION
  passportId: string
  genesis?: { txid: string; outputIndex: number }
  selectedTip?: { txid: string; outputIndex: number }
  exportedAt: string
  exporter: { id: string; role: 'registry' | 'overlay' | 'writer' | 'reader' | 'other'; software?: string }
  profiles?: string[]
  policyId?: string
  disclosure: { scope: DisclosureScope; recipient?: string; recoveryBackup: boolean }
  completeness: {
    snapshots: Array<{ source: string; snapshotId: string; completeForSnapshot: boolean; scope?: string }>
    withheld: string[]
    absent: string[]
  }
  sources: SourceObservation[]
  inventory: InventoryEntry[]
  signature: { suite: 'bsv-ecdsa-der'; signer: string; value: string }
}

export type UnsignedEvidenceManifest = Omit<EvidencePackageManifest, 'signature'> & { signature: { suite: 'bsv-ecdsa-der'; signer: string } }

export interface PackageSigner {
  /** DER-encoded ECDSA signature over the preimage; the key must be the manifest's `signature.signer`. */
  sign(preimage: number[]): Promise<number[]> | number[]
}

const KEY = /^0[23][0-9a-f]{64}$/
const HEX64 = /^[0-9a-f]{64}$/
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

export const sha256Hex = (bytes: number[]): string => Utils.toHex(Hash.sha256(bytes))

/** An inventory entry for bytes about to be packaged, with the length and digest computed, never typed. */
export function inventoryEntry(path: string, category: InventoryCategory, mediaType: string, bytes: number[], extra: Pick<InventoryEntry, 'encrypted' | 'represents' | 'representation'> = {}): InventoryEntry {
  return { path, category, mediaType, byteLength: bytes.length, sha256: sha256Hex(bytes), ...extra }
}

/** Why a path is refused, or undefined when it is a plain relative path. */
export function pathProblem(path: string): string | undefined {
  if (typeof path !== 'string' || path.length === 0) return 'empty'
  if (path.includes('\u0000')) return 'contains NUL'
  if (path.includes('\\')) return 'contains a backslash'
  if (path.startsWith('/')) return 'absolute'
  if (/^[A-Za-z]:/.test(path)) return 'drive-qualified'
  const segments = path.split('/')
  if (segments.some((s) => s.length === 0)) return 'empty segment'
  if (segments.some((s) => s === '..')) return 'traverses upwards'
  if (segments.some((s) => s === '.')) return 'contains a current-directory segment'
  if (path === EVIDENCE_PACKAGE_MANIFEST_PATH) return 'names the manifest itself'
  return undefined
}

/** The bytes the exporter signs: the manifest without `signature.value`, in canonical JSON, UTF-8. */
export function manifestSigningPreimage(manifest: UnsignedEvidenceManifest | EvidencePackageManifest): number[] {
  const { value: _value, ...signature } = manifest.signature as EvidencePackageManifest['signature']
  return Utils.toArray(canonicalJson({ ...manifest, signature }), 'utf8')
}

export async function signEvidenceManifest(unsigned: UnsignedEvidenceManifest, signer: PackageSigner): Promise<EvidencePackageManifest> {
  const der = await signer.sign(manifestSigningPreimage(unsigned))
  return { ...unsigned, signature: { ...unsigned.signature, value: Utils.toHex(der) } }
}

export type PackageFailureReason =
  | 'format'
  | 'path-invalid'
  | 'path-duplicate'
  | 'file-missing'
  | 'file-unlisted'
  | 'length-mismatch'
  | 'digest-mismatch'
  | 'signature-invalid'
  | 'signer-unexpected'
  | 'disclosure-contradiction'
  | 'passport-mismatch'

export interface PackageFailure { reason: PackageFailureReason; path?: string; detail: string }

export interface PackageInspection {
  /** The manifest has the declared shape and its declarations do not contradict each other. */
  structureValid: boolean
  /** Every listed file is present with its length and digest, and no file is unlisted. Independent of the signature. */
  inventoryVerified: boolean
  /** The exporter's signature over the manifest, or null when the manifest could not be canonicalised. Says who assembled the bytes, not that they are true or complete. */
  signatureValid: boolean | null
  failures: PackageFailure[]
  declaredWithheld: string[]
  declaredAbsent: string[]
  recoveryBackup: boolean
}

function structure(manifest: EvidencePackageManifest, failures: PackageFailure[], expectedPassportId?: string): void {
  const fail = (reason: PackageFailureReason, detail: string, path?: string) => failures.push({ reason, detail, ...(path == null ? {} : { path }) })
  if (manifest.format !== EVIDENCE_PACKAGE_FORMAT || manifest.version !== EVIDENCE_PACKAGE_VERSION) fail('format', `format ${String(manifest.format)} version ${String(manifest.version)} is not ${EVIDENCE_PACKAGE_FORMAT}@${EVIDENCE_PACKAGE_VERSION}`)
  if (typeof manifest.passportId !== 'string' || manifest.passportId.length === 0 || manifest.passportId.length > 512) fail('format', 'passportId must be a string of at most 512 characters')
  else if (expectedPassportId != null && manifest.passportId !== expectedPassportId) fail('passport-mismatch', `the package is about ${manifest.passportId}, not ${expectedPassportId}`)
  if (typeof manifest.exportedAt !== 'string' || !TIME.test(manifest.exportedAt)) fail('format', 'exportedAt must be a date-time')
  for (const [name, outpoint] of [['genesis', manifest.genesis], ['selectedTip', manifest.selectedTip]] as const) {
    if (outpoint != null && (!HEX64.test(outpoint.txid ?? '') || !Number.isInteger(outpoint.outputIndex) || outpoint.outputIndex < 0)) fail('format', `${name} is not an outpoint`)
  }
  if (manifest.exporter == null || typeof manifest.exporter.id !== 'string' || manifest.exporter.id.length === 0) fail('format', 'exporter.id is required')
  if (manifest.disclosure == null || typeof manifest.disclosure.recoveryBackup !== 'boolean') fail('format', 'disclosure.recoveryBackup must be declared')
  else if (manifest.disclosure.recoveryBackup && manifest.disclosure.scope !== 'all-tiers') fail('disclosure-contradiction', `a ${manifest.disclosure.scope} package cannot be a recovery backup`)
  if (manifest.completeness == null || !Array.isArray(manifest.completeness.snapshots) || !Array.isArray(manifest.completeness.withheld) || !Array.isArray(manifest.completeness.absent)) fail('format', 'completeness must declare snapshots, withheld and absent')
  if (!Array.isArray(manifest.sources)) fail('format', 'sources must be an array')
  if (manifest.signature == null || manifest.signature.suite !== 'bsv-ecdsa-der' || !KEY.test(manifest.signature.signer ?? '') || typeof manifest.signature.value !== 'string') fail('format', 'signature needs the bsv-ecdsa-der suite, a compressed signer key and a value')
  if (!Array.isArray(manifest.inventory) || manifest.inventory.length === 0) {
    fail('format', 'inventory must list at least one file')
    return
  }
  const seen = new Set<string>()
  for (const entry of manifest.inventory) {
    const problem = pathProblem(entry.path)
    if (problem != null) fail('path-invalid', `path ${JSON.stringify(entry.path)} is ${problem}`, typeof entry.path === 'string' ? entry.path : undefined)
    if (seen.has(entry.path)) fail('path-duplicate', `path ${entry.path} is listed twice`, entry.path)
    seen.add(entry.path)
    if (!INVENTORY_CATEGORIES.includes(entry.category)) fail('format', `category ${String(entry.category)} is not one of the nine`, entry.path)
    if (typeof entry.mediaType !== 'string' || entry.mediaType.length === 0) fail('format', 'mediaType is required', entry.path)
    if (!Number.isInteger(entry.byteLength) || entry.byteLength < 0) fail('format', 'byteLength must be a non-negative integer', entry.path)
    if (!HEX64.test(entry.sha256 ?? '')) fail('format', 'sha256 must be 64 lowercase hex characters', entry.path)
  }
}

/**
 * Inspect a package: the manifest, the files by their inventory path (the
 * manifest itself is not among them), and what the reader expects. The
 * returned answers are separate on purpose; a caller that wants one word
 * chooses it knowingly.
 */
export function inspectEvidencePackage(manifest: EvidencePackageManifest, files: Map<string, number[]>, options: { expectedPassportId?: string; expectedSigner?: string } = {}): PackageInspection {
  const failures: PackageFailure[] = []
  structure(manifest, failures, options.expectedPassportId)
  const structureValid = failures.length === 0

  let inventoryVerified = false
  if (Array.isArray(manifest.inventory)) {
    const before = failures.length
    const listed = new Set<string>()
    for (const entry of manifest.inventory) {
      if (typeof entry.path !== 'string') continue
      listed.add(entry.path)
      const bytes = files.get(entry.path)
      if (bytes == null) {
        failures.push({ reason: 'file-missing', path: entry.path, detail: `${entry.path} is listed and not present` })
        continue
      }
      if (bytes.length !== entry.byteLength) failures.push({ reason: 'length-mismatch', path: entry.path, detail: `${entry.path} has ${bytes.length} bytes, not ${entry.byteLength}` })
      if (sha256Hex(bytes) !== entry.sha256) failures.push({ reason: 'digest-mismatch', path: entry.path, detail: `${entry.path} does not hash to its inventory digest` })
    }
    for (const path of files.keys()) {
      if (!listed.has(path) && path !== EVIDENCE_PACKAGE_MANIFEST_PATH) failures.push({ reason: 'file-unlisted', path, detail: `${path} is present and not in the inventory` })
    }
    inventoryVerified = failures.length === before && manifest.inventory.length > 0 && manifest.inventory.every((e) => pathProblem(e.path) == null)
  }

  let signatureValid: boolean | null = null
  if (manifest.signature != null && typeof manifest.signature.value === 'string' && KEY.test(manifest.signature.signer ?? '')) {
    try {
      const preimage = manifestSigningPreimage(manifest)
      signatureValid = PublicKey.fromString(manifest.signature.signer).verify(preimage, Signature.fromDER(Utils.toArray(manifest.signature.value, 'hex')))
    } catch (error) {
      signatureValid = error instanceof CanonicalJsonError ? null : false
      if (signatureValid === null) failures.push({ reason: 'format', detail: error instanceof Error ? error.message : 'the manifest has no canonical form' })
    }
    if (signatureValid === false) failures.push({ reason: 'signature-invalid', detail: `the manifest signature does not verify under ${manifest.signature.signer}` })
    if (options.expectedSigner != null && manifest.signature.signer !== options.expectedSigner) failures.push({ reason: 'signer-unexpected', detail: `signed by ${manifest.signature.signer}, not the expected ${options.expectedSigner}` })
  }

  return {
    structureValid,
    inventoryVerified,
    signatureValid,
    failures,
    declaredWithheld: Array.isArray(manifest.completeness?.withheld) ? [...manifest.completeness.withheld] : [],
    declaredAbsent: Array.isArray(manifest.completeness?.absent) ? [...manifest.completeness.absent] : [],
    recoveryBackup: manifest.disclosure?.recoveryBackup === true,
  }
}
