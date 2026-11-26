// The shape of an export of this application, shared by the export and the
// restore. An export is one `dpp-evidence-package@1` in a folder: a signed
// manifest, `manifest.json`, over every other file, each listed once in the
// manifest's inventory under one of the format's nine categories. Nothing
// here is a second export format. The parts are the ones the packages
// already define, placed side by side:
//
//   manifest.json                             the manifest this application signs
//   application/application-export.json       the descriptor: what the export covers and what it leaves out
//   application/brands/<n>.json               each brand record                              (authorised only)
//   application/offers/<n>.json               each hand-on offer                             (authorised only)
//   application/claims/<n>.json               each lifecycle claim this application holds    (authorised only)
//   application/lifecycle-claims/<n>.json     each EPCIS lifecycle claim's exact signed bytes (authorised only)
//   passports/<n>/index/...                   the index's own signed evidence for the passport, as it exported it
//   passports/<n>/journal.json                this application's journal of the passport     (authorised only)
//   passports/<n>/authority/<c>.json          each acceptance record a hand-on commits to    (authorised only)
//   passports/<n>/reading.json                how the passport verified when it was exported
//   profiles/...                              the profile bundle of @bsv/dpp-profiles
//   epcis/...                                 the snapshot of @bsv/dpp-credentials/epcis-exchange
//
// `<n>` is the SHA-256 of the record's identifier, so no identifier becomes
// part of a file name.
//
// Two access paths, never mixed. An authorised export is a recovery backup
// for the operator of this deployment: its manifest says `all-tiers` and
// `recoveryBackup: true`. A public export carries what anyone may hold: the
// index's evidence, the profile files, the readings and the public form of
// the EPCIS exchange. Its manifest says `public`, and a restore refuses it.
// Neither carries a key, a wallet file or a credential.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { ACCEPTANCE_RECORD_REPRESENTATIONS, EVIDENCE_PACKAGE_MANIFEST_PATH, canonicalJson, inspectManagedAcceptance, pathProblem, type InventoryCategory, type InventoryEntry, type ManagedAcceptanceRecord } from '@bsv/dpp-protocol'

export const APPLICATION_EXPORT_FORMAT = 'dpp-application-export'
export const APPLICATION_EXPORT_VERSION = '1'
/** The descriptor's path in the package. */
export const APPLICATION_EXPORT_DESCRIPTOR = 'application/application-export.json'
/** What the manifest's `passportId` begins with when a package carries an export and not one passport (spec/portable-evidence.md section 2). */
export const EXPORT_SCOPE_PREFIX = 'urn:bsv:dpp:evidence-export:sha256:'
/** The folder the profile bundle sits in, and the folder the EPCIS snapshot sits in: the defaults of the two modules. */
export const PROFILES_ROOT = 'profiles'
export const EPCIS_ROOT = 'epcis'

/** What an inventory entry's `representation` says for each kind of file this application adds. The bundle's and the snapshot's files keep the ones their modules give. */
export const APPLICATION_REPRESENTATIONS = {
  descriptor: 'dpp-application-export@1',
  /** The manifest of the package the index signed for one passport, carried whole. */
  indexManifest: 'dpp-evidence-package@1',
  /** The original authority entry is read under the enclosed index manifest. */
  nestedAuthority: 'dpp-nested-authority@1',
  /** The signed coverage record of one part of the index's complete export. */
  indexCoverage: 'dpp-evidence-export-coverage@1',
  journal: 'dpp-application-passport-journal@1',
  reading: 'dpp-application-passport-reading@1',
  brand: 'dpp-application-brand@1',
  offer: 'dpp-application-offer@1',
  claim: 'dpp-application-claim@1',
} as const

/** Check an acceptance under the representation and commitment the nested exporter signed. */
export function readNestedAcceptance(entry: InventoryEntry, bytes: Uint8Array, passportId: string, custodian: string): ManagedAcceptanceRecord | undefined {
  if (!ACCEPTANCE_RECORD_REPRESENTATIONS.some(format => format === entry.representation)) return undefined
  let record: ManagedAcceptanceRecord
  try {
    record = JSON.parse(Buffer.from(bytes).toString('utf8')) as ManagedAcceptanceRecord
  } catch {
    throw new PortabilityRefused('index-evidence-refused', 'A signed index acceptance is not JSON.', { passportId, path: entry.path })
  }
  const checked = inspectManagedAcceptance(record, { custodians: [custodian] })
  if (entry.category !== 'authority' || checked.signatureValid !== true || checked.failures.length || checked.commitment == null ||
      record.acceptanceFormat !== entry.representation || record.passportId !== passportId ||
      (entry.represents != null && entry.represents !== `sha256:${checked.commitment}`)) {
    throw new PortabilityRefused('index-evidence-refused', 'A signed index acceptance does not verify for this custodian, passport and inventory entry.', { passportId, path: entry.path })
  }
  return record
}

/** What no export of this application carries or establishes, in fixed words. Every descriptor carries exactly these. */
export const APPLICATION_EXPORT_LIMITS = {
  /** The wallet's root key and file, and the secrets brand and recipient keys are derived from. They travel by the wallet's own recovery and the operator's own secret handling. */
  keys: 'never-carried',
  /** The index's tokens, the registry's, the validator's and every EPCIS source's credential. The destination's operator provisions them. */
  credentials: 'never-carried',
  /** Sign-in accounts, sessions and memberships. */
  signIn: 'never-carried',
  /** The files GS1 publishes. They are named by address and digest, and the destination obtains them. */
  gs1Files: 'named-by-address-and-digest',
  /** The index's own records of each passport and the EPCIS associations are rebuilt at the destination from what is carried. */
  derivedIndexes: 'rebuilt-at-destination',
  /** A passing profile validation says a document satisfies its profile. It never says that disclosed data is what a state's payload_owner_hash commits to. */
  ownerCommitment: 'not-established-by-profile-validity',
} as const

export type ApplicationExportAccess = 'authorised-recovery' | 'public-evidence'

/** How the index's evidence for one passport is carried. */
export type IndexEvidenceForm =
  /** The index's bounded package, complete for its snapshot. */
  | 'package'
  /** The parts of the index's complete export, which tile one snapshot. */
  | 'export-parts'
  /** The bounded package of a lineage longer than its bound: the oldest states are declared absent. */
  | 'bounded-package'
  /** The index gave nothing: it holds no state of the passport, signs no package or could not be reached. `reason` says which. */
  | 'none'

export interface ExportedPassport {
  passportId: string
  /** The folder of the passport's files: `passports/<sha256 of the identifier>`. */
  folder: string
  /** `id@version`, as the journal records it. */
  profile: string
  /** The binding digest the newest state declares, under a profile held by a binding. */
  bindingDigest?: string
  status: 'active' | 'retired'
  states: number
  /** The first and the newest state's transaction. */
  genesis: string
  tip: string
  index: { form: IndexEvidenceForm; exporter?: string; snapshotId?: string; parts?: number; states?: number; reason?: string }
  acceptanceRecords: number
  claims: number
}

/** One thing the export leaves out, and why. */
export interface ApplicationExportOmission {
  what: string
  /** `never-carried`: no export holds it. `not-public`: a public export may not. `provisioned-by-destination`: named, and obtained there. `rebuilt-at-destination`: derived. `excluded`: left out of this export. `not-held`: this deployment has none. */
  reason: 'never-carried' | 'not-public' | 'provisioned-by-destination' | 'rebuilt-at-destination' | 'excluded' | 'not-held'
  detail?: string
}

/** The descriptor: what `application/application-export.json` holds. */
export interface ApplicationExportDescriptor {
  format: typeof APPLICATION_EXPORT_FORMAT
  version: typeof APPLICATION_EXPORT_VERSION
  access: ApplicationExportAccess
  /** The manifest's `passportId`: the name of this export, made from the passports it covers. */
  exportId: string
  exportedAt: string
  selection: 'all-passports' | 'listed-passports'
  application: { network: string; identifiers: { host: string; prefix: string }; publisherKey: string }
  passports: ExportedPassport[]
  /** The profiles the passports declare: those carried in the bundle, and those a manifest of the profiles package defines, which are named and not carried. */
  profiles: { root?: string; carried: string[]; named: string[] }
  /** The EPCIS exchange: the snapshot's folder, its identity and the scopes it covers, or why there is none. An authorised export also says how each source was configured, without its credential. */
  epcis: {
    root?: string
    access?: ApplicationExportAccess
    snapshotId?: string
    scopes: string[]
    cursors?: 'excluded' | 'included'
    reason?: string
    sources?: Array<{ sourceId: string; baseUrl: string; permittedOrigins: string[]; localTest: boolean; repeatListParameters: boolean; credentialConfigured: boolean; credentialScheme?: string }>
  }
  records: { brands: number; offers: number; claims: number }
  omitted: ApplicationExportOmission[]
  limits: typeof APPLICATION_EXPORT_LIMITS
}

/** What a reading of one passport came to, in the terms the export and the restore compare. It holds no restricted value: it is the public view. */
export interface ExportedReading {
  passportId: string
  /** What the reading could check inclusion against. `scripts only` checks no inclusion, and a reading under it is no proof that a state is in a block. */
  chainTracker: 'header-source' | 'scripts only'
  lineage: Array<{ op: string; txid: string }>
  checks: Array<{ name: string; status: string; reasonCode?: string }>
  payloadChecks: Array<{
    txid: string
    stateIndex: number
    profile: string
    status: string
    cause?: string
    steps: Array<{ step: string; status: string; cause?: string }>
    findings: Array<{ step: string; severity: string; constraint: string; path?: string; message?: string }>
    withheld: unknown[]
  }>
}

export const sha256Hex = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
/**
 * A value as JSON in one spelling: every object's members in the order of
 * their names, no white space, and a member that is undefined left out. A
 * record of this application may hold a null or a number that the protocol's
 * canonical form does not admit, so its records are written with this, and
 * the same record is the same bytes wherever it is exported.
 */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry === undefined ? null : entry)).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const members = Object.entries(value as Record<string, unknown>)
      .filter(([, member]) => member !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${members.map(([name, member]) => `${JSON.stringify(name)}:${stableJson(member)}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** A record as the bytes an export carries. */
export const recordBytes = (value: unknown): Uint8Array => utf8(stableJson(value))
export const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength))

/** The name of an export: the SHA-256 of the canonical list of the passport identifiers it covers, sorted. The same selection has the same name. */
export function exportScopeId(passportIds: readonly string[]): string {
  return `${EXPORT_SCOPE_PREFIX}${sha256Hex(canonicalJson([...new Set(passportIds)].sort()))}`
}

export const passportFolder = (passportId: string): string => `passports/${sha256Hex(passportId)}`

/** One inventory entry for bytes about to be packaged, with the length and digest computed here and never typed. */
export function entryOf(path: string, category: InventoryCategory, mediaType: string, bytes: Uint8Array, extra: Pick<InventoryEntry, 'encrypted' | 'represents' | 'representation'> = {}): InventoryEntry {
  return { path, category, mediaType, byteLength: bytes.byteLength, sha256: sha256Hex(bytes), ...extra }
}

/** A refusal of an export or a restore: a code to act on and one or more sentences for a person. It never repeats a credential. */
export class PortabilityRefused extends Error {
  constructor(
    readonly code: string,
    detail: string,
    /** What the refusal is about, where it is about particular things: a file, a profile, the module's own refusal. */
    readonly data: Record<string, unknown> = {}
  ) {
    super(detail)
    this.name = 'PortabilityRefused'
  }
}

/* --------------------------------- folders ------------------------------- */

/** Write a package into a folder that holds nothing yet. A folder with anything in it is refused, so nothing is ever overwritten. */
export function writePackageFolder(folder: string, manifest: unknown, files: ReadonlyMap<string, Uint8Array>): void {
  if (existsSync(folder) && readdirSync(folder).length > 0) throw new PortabilityRefused('destination-not-empty', `The folder ${folder} already holds files. An export is written into an empty folder and never over anything.`)
  mkdirSync(folder, { recursive: true })
  for (const [path, bytes] of files) {
    const problem = pathProblem(path)
    if (problem != null) throw new PortabilityRefused('path-invalid', `The file name ${JSON.stringify(path)} is ${problem}.`, { path })
    const target = join(folder, ...path.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    // Readable by the account that runs the application only: an authorised export holds restricted records.
    writeFileSync(target, bytes, { mode: 0o600 })
  }
  writeFileSync(join(folder, EVIDENCE_PACKAGE_MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
}

/** Every file under a folder, by its path in the package, the manifest left out. Nothing outside the folder is read: a link is not followed. */
export function readPackageFolder(folder: string): { manifestText?: string; files: Map<string, Uint8Array> } {
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new PortabilityRefused('package-missing', `There is no folder at ${folder}.`)
  const files = new Map<string, Uint8Array>()
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(join(dir, entry.name), path)
      else if (entry.isFile()) files.set(path, new Uint8Array(readFileSync(join(dir, entry.name))))
      // Anything else, a link among them, is not a file of a package. It is listed so that the inventory check names it.
      else files.set(path, new Uint8Array(0))
    }
  }
  walk(folder, '')
  const manifestBytes = files.get(EVIDENCE_PACKAGE_MANIFEST_PATH)
  files.delete(EVIDENCE_PACKAGE_MANIFEST_PATH)
  return { ...(manifestBytes == null ? {} : { manifestText: new TextDecoder().decode(manifestBytes) }), files }
}

/** The files of a package as the protocol package's inspection takes them. */
export const asNumberArrays = (files: ReadonlyMap<string, Uint8Array>): Map<string, number[]> => new Map([...files].map(([path, bytes]) => [path, Array.from(bytes)]))

/** A path of the package as a path of this machine, under a folder. */
export const inFolder = (folder: string, path: string): string => join(folder, ...path.split('/')).split(sep).join(sep)
