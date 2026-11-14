/**
 * The profile bundle (`spec/profiles.md` §7, `spec/portable-evidence.md`
 * §2): the files that define the profiles held by bindings, laid out so an
 * evidence package can carry them and another deployment can register the
 * same profiles from the package alone, with the hosts that first published
 * them out of reach.
 *
 * A bundle is not a second export format. It is a set of files with one
 * inventory entry each, in the `schemas` category of `dpp-evidence-package@1`,
 * and the exporter that assembles a package lists them in its own manifest
 * and signs that. Under the bundle's folder there is one folder per profile,
 * laid out as a binding folder is: `binding.json` in its exact bytes, every
 * artefact the binding lists and the notices that travel with them. Beside
 * those folders sit the licence texts and a descriptor, `profile-bundle.json`,
 * which says which profiles the bundle covers, what it leaves out and what it
 * does not establish.
 *
 * Three rules shape the module.
 *
 * Carrying a binding does not make it trusted. `registerProfileBundle` hands
 * every binding to the destination's own registry, which accepts a digest
 * only from the list its operator configured and holds every artefact to the
 * length and digest the binding records. A package can be signed correctly by
 * its exporter and still carry a binding the destination never trusted: the
 * signature says who assembled the bytes, and nothing about who may define a
 * profile.
 *
 * Some files are never carried. A file its publisher's terms do not let
 * others pass on is named by address and digest, and the destination obtains
 * it for itself. GS1's own files are always treated so, whatever the caller
 * asks.
 *
 * Nothing here reads a payload. Validating a payload, or a disclosed part of
 * one, under a restored profile says whether it satisfies the profile. It
 * never says that a restricted part is the one a record commits to in
 * `payload_owner_hash`, and the descriptor states that limit in every bundle.
 */
import { readFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GS1_RESOLVER_ARTEFACTS } from './gs1-artefacts.js'
import { describeArtefact, profileBindingDigest, type BindingArtefact } from './profile-binding.js'
import type { ArtefactResolver, BindingProfile, ProfileRegistry, RegistrationRefusal } from './profile-registry.js'
import { parseStrictJson } from './strict-json.js'

export const PROFILE_BUNDLE_FORMAT = 'dpp-profile-bundle'
export const PROFILE_BUNDLE_VERSION = '1'
/** The folder a bundle sits in, inside a package, unless the exporter chooses another. */
export const PROFILE_BUNDLE_ROOT = 'profiles'
/** The descriptor's file name, directly under the bundle's folder. */
export const PROFILE_BUNDLE_DESCRIPTOR = 'profile-bundle.json'
/** The folder the licence texts sit in, under the bundle's folder. No profile folder can have this name, because every one carries an `@`. */
export const PROFILE_BUNDLE_LICENCES = 'licences'
/** The inventory category every file of a bundle is listed under. */
export const PROFILE_BUNDLE_CATEGORY = 'schemas'

/** What an inventory entry's `representation` says for each kind of file a bundle holds. */
export const PROFILE_BUNDLE_REPRESENTATIONS = {
  descriptor: 'dpp-profile-bundle@1',
  binding: 'dpp-profile-binding@1',
  artefact: 'dpp-profile-artefact@1',
  notice: 'dpp-profile-notice@1',
  licence: 'dpp-profile-licence-text@1',
} as const

/** What a bundle does not establish, in fixed words. Every bundle carries exactly these, so none can claim more. */
export const PROFILE_BUNDLE_LIMITS = {
  /** Only profiles held by a binding are carried. A manifest-format profile ships with the package that publishes it. */
  profiles: 'bindings-only',
  /** Whether a carried binding may be used is decided by the destination's own trusted digests, never by the bundle or by whoever signed the package around it. */
  trust: 'destination-trusted-digests',
  /** Validation under a carried profile, of a whole payload or of a disclosed part, is no statement about `payload_owner_hash`. */
  ownerCommitment: 'not-established',
} as const

/** A file that is named and not carried: where its publisher publishes it, and the exact bytes expected. `Gs1Artefact` has this shape. */
export interface ProvisionedArtefact {
  readonly uri: string
  readonly sha256: string
  readonly byteLength: number
}

/** One file the bundle names and does not carry. */
export interface ProfileBundleOmission {
  /** The address its publisher publishes it at. */
  uri: string
  sha256: string
  byteLength: number
  /** Why it is not carried. Format 1 has one reason: the destination obtains the file for itself and checks it against this digest. */
  reason: 'provisioned-by-destination'
  /** The binding artefacts that are this file, by profile and by the path the binding gives. Absent when no carried binding lists it and the exporter names it for the deployment's other checks. */
  requiredBy?: Array<{ profile: string; path: string }>
}

/** The descriptor: what `profile-bundle.json` holds. Every path in it is relative to the folder the descriptor is in. */
export interface ProfileBundleDescriptor {
  format: typeof PROFILE_BUNDLE_FORMAT
  version: typeof PROFILE_BUNDLE_VERSION
  /** The profiles covered. Each has a folder named `id@version`, holding `binding.json` and the files the binding lists. */
  profiles: Array<{
    /** `id@version`. */
    profile: string
    /** The SHA-256 of the carried `binding.json`. It says which bytes the bundle carries, and gives them no authority. */
    bindingDigest: string
    /** The notices carried for this profile, by the paths the binding's `source.notices` gives. */
    notices: string[]
  }>
  /** Every licence a carried file is under, as its binding names it, with the path of the licence text where the bundle carries one. */
  licences: Array<{ licence: string; path?: string }>
  /** Every file named and not carried. */
  omitted: ProfileBundleOmission[]
  limits: typeof PROFILE_BUNDLE_LIMITS
}

/** One inventory entry of a bundle. It has the members of an inventory entry of `dpp-evidence-package@1`, so an exporter adds it to its manifest unchanged. */
export interface ProfileBundleInventoryEntry {
  path: string
  category: typeof PROFILE_BUNDLE_CATEGORY
  mediaType: string
  byteLength: number
  sha256: string
  /** What the file is: the profile, the profile and the file's path in its binding, or the licence. */
  represents: string
  representation: (typeof PROFILE_BUNDLE_REPRESENTATIONS)[keyof typeof PROFILE_BUNDLE_REPRESENTATIONS]
}

type MaybePromise<T> = T | Promise<T>
type Json = Record<string, unknown>

const PROFILE = /^[a-z][a-z0-9-]*@[1-9][0-9]*$/u
const PATH = /^[A-Za-z0-9_@-][A-Za-z0-9._@-]*(\/[A-Za-z0-9_@-][A-Za-z0-9._@-]*)*$/u
const SEGMENT = /^[A-Za-z0-9_@-][A-Za-z0-9._@-]*$/u
const URI = /^[a-z][a-z0-9+.-]*:[^\s]+$/u
const SHA256 = /^[0-9a-f]{64}$/u
const BINDING_FILE = 'binding.json'

const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)
const isPath = (value: unknown): value is string => typeof value === 'string' && value.length <= 512 && PATH.test(value)
const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

/** Whether an address is one GS1 publishes at. A file from there is never carried, whatever the binding says of its licence. */
function isGs1Address(uri: string): boolean {
  try {
    const host = new URL(uri).hostname.toLowerCase()
    return host === 'gs1.org' || host.endsWith('.gs1.org')
  } catch {
    return false
  }
}

/** The bundle's folder as given, or the default. A folder is a relative path with no empty, dot or dot-dot segment. */
function rootOf(root: string | undefined): string {
  const chosen = root ?? PROFILE_BUNDLE_ROOT
  if (!isPath(chosen)) throw new TypeError(`root must be a relative folder with no empty, dot or dot-dot segment; got ${JSON.stringify(chosen)}`)
  return chosen
}

/**
 * The problems that make a value not a format 1 descriptor, one sentence
 * each, naming the member. Empty means the value has the descriptor's
 * structure. It is the hand-written twin of
 * `schemas/profile-bundle-v1.schema.json` and accepts and refuses what the
 * schema does. Rules that relate one member to another are
 * `profileBundleInconsistencies`.
 */
export function profileBundleProblems(value: unknown): string[] {
  const problems: string[] = []
  const say = (sentence: string): void => { problems.push(sentence) }
  const name = (at: string): string => (at === '' ? 'the descriptor' : `\`${at}\``)
  const join = (at: string, key: string | number): string => (at === '' ? String(key) : `${at}.${key}`)
  const members = (candidate: unknown, at: string, required: readonly string[], optional: readonly string[] = []): Json | undefined => {
    if (!isObject(candidate)) { say(`${name(at)} must be an object.`); return undefined }
    for (const key of required) if (!Object.hasOwn(candidate, key)) say(`${name(at)} is missing the required member \`${key}\`.`)
    for (const key of Object.keys(candidate)) if (!required.includes(key) && !optional.includes(key)) say(`${name(at)} has a member the format does not define: \`${key}\`.`)
    return candidate
  }
  const has = (object: Json, key: string): boolean => Object.hasOwn(object, key)
  const constant = (object: Json, key: string, at: string, expected: string): void => {
    if (has(object, key) && object[key] !== expected) say(`${name(join(at, key))} must be ${JSON.stringify(expected)}.`)
  }
  const text = (object: Json, key: string, at: string, pattern: RegExp | undefined, what: string): void => {
    if (!has(object, key)) return
    const v = object[key]
    if (typeof v !== 'string' || v.length === 0 || (pattern != null && !pattern.test(v))) say(`${name(join(at, key))} must be ${what}.`)
  }
  const path = (object: Json, key: string, at: string): void => {
    if (has(object, key) && !isPath(object[key])) say(`${name(join(at, key))} must be a relative file name of at most 512 characters with no empty, dot or dot-dot segment.`)
  }
  const list = (object: Json, key: string, at: string, min: number, item: (entry: unknown, at: string) => void): void => {
    if (!has(object, key)) return
    const v = object[key]
    const where = join(at, key)
    if (!Array.isArray(v)) { say(`${name(where)} must be a list.`); return }
    if (v.length < min) say(`${name(where)} must list at least ${min} ${min === 1 ? 'entry' : 'entries'}.`)
    v.forEach((entry, index) => item(entry, join(where, index)))
  }
  const profileText = 'an identifier of the form id@version'
  const digestText = 'sixty-four lower-case hexadecimal characters'

  const descriptor = members(value, '', ['format', 'version', 'profiles', 'licences', 'omitted', 'limits'])
  if (descriptor == null) return problems
  constant(descriptor, 'format', '', PROFILE_BUNDLE_FORMAT)
  constant(descriptor, 'version', '', PROFILE_BUNDLE_VERSION)

  list(descriptor, 'profiles', '', 1, (entry, at) => {
    const profile = members(entry, at, ['profile', 'bindingDigest', 'notices'])
    if (profile == null) return
    text(profile, 'profile', at, PROFILE, profileText)
    text(profile, 'bindingDigest', at, SHA256, digestText)
    list(profile, 'notices', at, 0, (notice, where) => { if (!isPath(notice)) say(`${name(where)} must be a relative file name of at most 512 characters with no empty, dot or dot-dot segment.`) })
  })

  list(descriptor, 'licences', '', 0, (entry, at) => {
    const licence = members(entry, at, ['licence'], ['path'])
    if (licence == null) return
    text(licence, 'licence', at, undefined, 'text of at least one character')
    path(licence, 'path', at)
  })

  list(descriptor, 'omitted', '', 0, (entry, at) => {
    const omitted = members(entry, at, ['uri', 'sha256', 'byteLength', 'reason'], ['requiredBy'])
    if (omitted == null) return
    text(omitted, 'uri', at, URI, 'a URI')
    text(omitted, 'sha256', at, SHA256, digestText)
    if (has(omitted, 'byteLength') && !(typeof omitted.byteLength === 'number' && Number.isInteger(omitted.byteLength) && omitted.byteLength >= 1)) say(`${name(join(at, 'byteLength'))} must be a whole number of at least 1.`)
    constant(omitted, 'reason', at, 'provisioned-by-destination')
    list(omitted, 'requiredBy', at, 1, (use, where) => {
      const requiredBy = members(use, where, ['profile', 'path'])
      if (requiredBy == null) return
      text(requiredBy, 'profile', where, PROFILE, profileText)
      path(requiredBy, 'path', where)
    })
  })

  if (has(descriptor, 'limits')) {
    const limits = members(descriptor.limits, 'limits', Object.keys(PROFILE_BUNDLE_LIMITS))
    if (limits != null) for (const [key, expected] of Object.entries(PROFILE_BUNDLE_LIMITS)) constant(limits, key, 'limits', expected)
  }
  return problems
}

/**
 * The ways a structurally valid descriptor contradicts itself, one sentence
 * each: a profile or a licence listed twice, or a file said to be needed by
 * a profile the bundle does not cover. A descriptor with any of them is
 * refused when a bundle is opened.
 */
export function profileBundleInconsistencies(descriptor: ProfileBundleDescriptor): string[] {
  const problems: string[] = []
  const profiles = descriptor.profiles.map((entry) => entry.profile)
  for (const profile of new Set(profiles.filter((p, i) => profiles.indexOf(p) !== i))) problems.push(`the profile ${profile} is listed twice.`)
  const licences = descriptor.licences.map((entry) => entry.licence)
  for (const licence of new Set(licences.filter((l, i) => licences.indexOf(l) !== i))) problems.push(`the licence ${licence} is listed twice.`)
  for (const omitted of descriptor.omitted) {
    for (const use of omitted.requiredBy ?? []) if (!profiles.includes(use.profile)) problems.push(`${omitted.uri} is said to be needed by ${use.profile}, which the bundle does not cover.`)
  }
  return problems
}

export type ProfileBundleExportRefusalCode =
  /** No profile was named and the registry holds none by a binding, so there is nothing to carry. */
  | 'no-profile'
  /** A named profile is not `id@version`, or the registry holds nothing under it. A retired profile is among these: it does not resolve. */
  | 'profile-not-registered'
  /** A named profile is defined by a manifest. It has no binding and ships with the package that publishes it. */
  | 'profile-not-bound'
  /** A notice a binding lists could not be read. The files it accounts for are not exported without it. */
  | 'notice-unavailable'
  /** A binding lists an artefact under the name `binding.json`, which in a profile's folder is the binding file itself. */
  | 'artefact-path-collision'

export interface ProfileBundleExportRefusal {
  ok: false
  code: ProfileBundleExportRefusalCode
  /** One or more sentences for a person. */
  detail: string
  /** `id@version`, where the refusal is about one profile. */
  profile?: string
  /** The notice's path in its binding, for `notice-unavailable`. */
  notice?: string
}

export interface ProfileBundleExportInput {
  /** The registry the profiles are registered in. Only what it holds is exported, so every binding and artefact has already been held to its digest. */
  registry: ProfileRegistry
  /** The profiles to carry, each as `id@version`. Default: every profile the registry holds by a binding, in the order registered. */
  profiles?: readonly string[]
  /**
   * The bytes of a notice a binding lists in `source.notices`, by the path
   * the binding gives. The registry does not hold notices, because nothing
   * validates against them, so the exporter reads them from wherever it read
   * the binding. A notice that cannot be read refuses the export.
   */
  readNotice?: (profile: BindingProfile, path: string) => MaybePromise<Uint8Array | undefined>
  /** Licence texts to carry, each under the name bindings give the licence. `fileName` is needed only when that name is not usable as a file name. */
  licenceTexts?: ReadonlyArray<{ licence: string; bytes: Uint8Array; mediaType?: string; fileName?: string }>
  /**
   * Files this deployment obtains for itself and never passes on, such as
   * the pinned GS1 tables. Each is named in the descriptor by address and
   * digest. A binding artefact with the same digest is named there too and
   * its bytes are left out.
   */
  provisioned?: readonly ProvisionedArtefact[]
  /** The folder the bundle sits in, inside the package. Default `profiles`. */
  root?: string
}

export interface ExportedProfileBundle {
  ok: true
  /** The folder the bundle sits in. */
  root: string
  descriptor: ProfileBundleDescriptor
  /** Every file by its path in the package, the descriptor included, each in its exact bytes. */
  files: Map<string, Uint8Array>
  /** One entry per file, in the order of `files`, for the manifest of the package that carries the bundle. */
  inventory: ProfileBundleInventoryEntry[]
  /**
   * What the carrying manifest says beside its inventory: the profiles, for
   * its `profiles` member, and one line per file named and not carried, for
   * `completeness.withheld`.
   */
  manifest: { profiles: string[]; withheld: string[] }
}

/** The media type a notice is listed under, read from its file name. */
function noticeMediaType(path: string): string {
  if (/\.md$/iu.test(path)) return 'text/markdown'
  if (/\.html?$/iu.test(path)) return 'text/html'
  return 'text/plain'
}

/** One line of `completeness.withheld` for a file named and not carried. */
export function describeProfileBundleOmission(omitted: Pick<ProfileBundleOmission, 'uri' | 'sha256' | 'byteLength'>): string {
  return `provisioned-by-destination ${omitted.uri} sha256:${omitted.sha256} bytes:${omitted.byteLength}`
}

/**
 * The files and inventory entries that carry profiles out of a deployment.
 * A refusal is returned, never thrown.
 *
 * Everything exported is read back from the registry: the binding's exact
 * bytes and each artefact as it was held to its digest at registration. The
 * same registry and the same input give the same bytes, the descriptor
 * included, so two exports can be compared by digest.
 */
export async function exportProfileBundle(input: ProfileBundleExportInput): Promise<ExportedProfileBundle | ProfileBundleExportRefusal> {
  const { registry } = input
  const root = rootOf(input.root)
  const refuse = (code: ProfileBundleExportRefusalCode, detail: string, extra: { profile?: string; notice?: string } = {}): ProfileBundleExportRefusal => ({ ok: false, code, detail, ...extra })

  for (const entry of input.provisioned ?? []) {
    if (!isObject(entry) || typeof entry.uri !== 'string' || !URI.test(entry.uri) || typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256) || !(Number.isInteger(entry.byteLength) && entry.byteLength >= 1)) {
      throw new TypeError(`a provisioned file is named by a URI, a SHA-256 of 64 lower-case hexadecimal characters and a byte length; got ${JSON.stringify(entry)}`)
    }
  }
  const licenceTexts = new Map<string, { bytes: Uint8Array; mediaType: string; fileName: string }>()
  for (const entry of input.licenceTexts ?? []) {
    if (typeof entry.licence !== 'string' || entry.licence.length === 0 || !(entry.bytes instanceof Uint8Array)) throw new TypeError('a licence text is given as { licence, bytes }, with the name bindings give the licence and the text as bytes')
    const fileName = entry.fileName ?? `${entry.licence}.txt`
    if (!SEGMENT.test(fileName)) throw new TypeError(`the licence ${JSON.stringify(entry.licence)} needs a fileName: ${JSON.stringify(fileName)} is not usable as a file name`)
    if (licenceTexts.has(entry.licence)) throw new TypeError(`the licence ${JSON.stringify(entry.licence)} was given two texts`)
    if ([...licenceTexts.values()].some((held) => held.fileName === fileName)) throw new TypeError(`two licence texts were given the file name ${JSON.stringify(fileName)}`)
    licenceTexts.set(entry.licence, { bytes: Uint8Array.from(entry.bytes), mediaType: entry.mediaType ?? 'text/plain', fileName })
  }

  let selected: BindingProfile[]
  if (input.profiles == null) {
    selected = registry.list().filter((profile): profile is BindingProfile => profile.format === 'binding')
    if (selected.length === 0) return refuse('no-profile', 'The registry holds no profile by a binding, so there is nothing to carry.')
  } else {
    selected = []
    for (const name of input.profiles) {
      const parts = typeof name === 'string' && PROFILE.test(name) ? name.split('@') : undefined
      const registered = parts == null ? undefined : registry.resolve(parts[0]!, Number(parts[1]))
      if (registered == null) return refuse('profile-not-registered', `${JSON.stringify(name)} is not registered here, so there is nothing to carry for it.`, typeof name === 'string' ? { profile: name } : {})
      if (registered.format !== 'binding') return refuse('profile-not-bound', `${registered.profile} is defined by a manifest. It ships with the package that publishes it and is not carried in a bundle.`, { profile: registered.profile })
      if (!selected.includes(registered)) selected.push(registered)
    }
    if (selected.length === 0) return refuse('no-profile', 'No profile was named, so there is nothing to carry.')
  }

  const files = new Map<string, Uint8Array>()
  const inventory: ProfileBundleInventoryEntry[] = []
  const add = (path: string, mediaType: string, bytes: Uint8Array, represents: string, representation: ProfileBundleInventoryEntry['representation']): void => {
    const copy = Uint8Array.from(bytes)
    files.set(path, copy)
    inventory.push({ path, category: PROFILE_BUNDLE_CATEGORY, mediaType, ...describeArtefact(copy), represents, representation })
  }

  // A file is left out when its digest is one this deployment provisions, or when it is published at a GS1 address.
  // The package's own table of GS1 files is always among the first, so no caller has to remember it.
  const pinned: ProvisionedArtefact[] = [...(input.provisioned ?? []), ...GS1_RESOLVER_ARTEFACTS]
  const addressOf = (artefact: BindingArtefact): string | undefined => pinned.find((entry) => entry.sha256 === artefact.sha256)?.uri ?? (artefact.uri != null && isGs1Address(artefact.uri) ? artefact.uri : undefined)
  const omitted: ProfileBundleOmission[] = []
  const omit = (file: ProvisionedArtefact, use?: { profile: string; path: string }): void => {
    let entry = omitted.find((held) => held.uri === file.uri && held.sha256 === file.sha256)
    if (entry == null) {
      entry = { uri: file.uri, sha256: file.sha256, byteLength: file.byteLength, reason: 'provisioned-by-destination' }
      omitted.push(entry)
    }
    if (use != null) (entry.requiredBy ??= []).push(use)
  }

  const profiles: ProfileBundleDescriptor['profiles'] = []
  const licences: string[] = []
  const names = (licence: string): void => { if (!licences.includes(licence)) licences.push(licence) }
  for (const profile of selected) {
    const folder = `${root}/${profile.profile}`
    add(`${folder}/${BINDING_FILE}`, 'application/json', profile.bindingBytes, profile.profile, PROFILE_BUNDLE_REPRESENTATIONS.binding)
    names(profile.binding.source.licence)
    const carried = new Set<string>([BINDING_FILE])
    for (const { artefact, bytes } of profile.artefacts) {
      // One folder holds the binding and its artefacts, and a folder holds one file under one name.
      if (artefact.path === BINDING_FILE) return refuse('artefact-path-collision', `${profile.profile} lists an artefact named ${BINDING_FILE}, which is the name the binding file has in the profile's folder, so the two cannot be carried side by side.`, { profile: profile.profile })
      carried.add(artefact.path)
      const address = addressOf(artefact)
      if (address != null) {
        omit({ uri: address, sha256: artefact.sha256, byteLength: artefact.byteLength }, { profile: profile.profile, path: artefact.path })
        continue
      }
      add(`${folder}/${artefact.path}`, artefact.mediaType, bytes, `${profile.profile}#${artefact.path}`, PROFILE_BUNDLE_REPRESENTATIONS.artefact)
      names(artefact.licence)
    }
    const notices: string[] = []
    for (const path of profile.binding.source.notices) {
      // A notice that is also the binding or an artefact is that file, already dealt with above.
      if (carried.has(path)) continue
      carried.add(path)
      let bytes: unknown
      try {
        bytes = await input.readNotice?.(profile, path)
      } catch (cause) {
        return refuse('notice-unavailable', `The notice ${path} of ${profile.profile} could not be read: ${reasonOf(cause)}. The files it accounts for are not exported without it.`, { profile: profile.profile, notice: path })
      }
      if (!(bytes instanceof Uint8Array)) return refuse('notice-unavailable', `The notice ${path} of ${profile.profile} was not supplied. The files it accounts for are not exported without it.`, { profile: profile.profile, notice: path })
      add(`${folder}/${path}`, noticeMediaType(path), bytes, `${profile.profile}#${path}`, PROFILE_BUNDLE_REPRESENTATIONS.notice)
      notices.push(path)
    }
    profiles.push({ profile: profile.profile, bindingDigest: profile.bindingDigest, notices })
  }

  // The files the caller names for the deployment's other checks, after those a binding needs.
  for (const entry of input.provisioned ?? []) omit(entry)

  const descriptor: ProfileBundleDescriptor = {
    format: PROFILE_BUNDLE_FORMAT,
    version: PROFILE_BUNDLE_VERSION,
    profiles,
    licences: licences.map((licence) => {
      const held = licenceTexts.get(licence)
      if (held == null) return { licence }
      const path = `${PROFILE_BUNDLE_LICENCES}/${held.fileName}`
      add(`${root}/${path}`, held.mediaType, held.bytes, licence, PROFILE_BUNDLE_REPRESENTATIONS.licence)
      return { licence, path }
    }),
    omitted,
    limits: { ...PROFILE_BUNDLE_LIMITS },
  }
  add(`${root}/${PROFILE_BUNDLE_DESCRIPTOR}`, 'application/json', utf8(`${JSON.stringify(descriptor, null, 2)}\n`), `profile bundle: ${profiles.map((entry) => entry.profile).join(', ')}`, PROFILE_BUNDLE_REPRESENTATIONS.descriptor)

  return { ok: true, root, descriptor, files, inventory, manifest: { profiles: profiles.map((entry) => entry.profile), withheld: omitted.map(describeProfileBundleOmission) } }
}

/** Where a bundle is read from: the bytes of one file by its path in the package, or `undefined` when the file is not there. */
export type ProfileBundleSource = (path: string) => MaybePromise<Uint8Array | undefined>

/**
 * A bundle held in memory, as the files of a package by path. Bytes may be a
 * `Uint8Array` or the array of numbers the protocol package uses for package
 * files, so the map an evidence package was inspected with can be passed as
 * it is.
 */
export function profileBundleFiles(files: ReadonlyMap<string, Uint8Array | readonly number[]>): ProfileBundleSource {
  return (path) => {
    const bytes = files.get(path)
    return bytes == null ? undefined : Uint8Array.from(bytes)
  }
}

/**
 * A bundle on disk: the folder a package was unpacked into, as a path or a
 * `file:` URL. Nothing is read until a file is asked for. A file that is not
 * there is `undefined`, any other failure to read is thrown, and a path that
 * would leave the folder is never opened.
 */
export function profileBundleDirectory(directory: string | URL): ProfileBundleSource {
  if (directory instanceof URL && directory.protocol !== 'file:') throw new TypeError('directory must be a path or a file: URL, such as pathToFileURL(folder)')
  if (!(directory instanceof URL) && (typeof directory !== 'string' || directory.length === 0)) throw new TypeError('directory must be a path or a file: URL')
  const base = resolve(directory instanceof URL ? fileURLToPath(directory) : directory)
  return (path) => {
    if (!isPath(path)) return undefined
    const target = resolve(base, ...path.split('/'))
    const inside = relative(base, target)
    if (inside === '' || inside.startsWith('..') || inside.split(sep).includes('..')) return undefined
    try {
      return new Uint8Array(readFileSync(target))
    } catch (cause) {
      const code = (cause as { code?: string } | null)?.code
      if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return undefined
      throw cause
    }
  }
}

export type ProfileBundleRefusalCode =
  /** The folder holds no descriptor, so it is not a bundle that can be read. */
  | 'bundle-descriptor-missing'
  /** The descriptor is not strict JSON, does not have the format's structure, or contradicts itself. */
  | 'bundle-descriptor-invalid'
  /** The bundle does not cover a profile that was asked for. */
  | 'bundle-profile-absent'
  /** The bundle lists the profile and does not hold its binding file. */
  | 'bundle-binding-missing'
  /** The binding file is not the one the descriptor names by digest, so the bundle contradicts itself. */
  | 'bundle-binding-mismatch'
  /** The destination already holds or pins this profile under another binding digest: the bundle carries a different definition under the same name. */
  | 'bundle-binding-substituted'
  /** The binding's digest is not on the destination's trusted list. No signature on the package changes that. */
  | 'bundle-binding-untrusted'
  /** The binding is trusted and defines another profile than the one the bundle lists it as. */
  | 'bundle-binding-misfiled'
  /** The bundle lacks an artefact the binding lists and does not say it left it out. The bundle is incomplete. */
  | 'bundle-artefact-missing'
  /** The bundle names the artefact as one the destination provisions, and the destination did not supply it. */
  | 'bundle-artefact-not-provisioned'
  /** An artefact is not the file the trusted binding records: its length or its SHA-256 differs. */
  | 'bundle-artefact-altered'
  /** The registry refused for a reason no bundle causes, such as a binding it cannot read. `registration` holds its answer. */
  | 'bundle-registration-refused'

export interface ProfileBundleRefusal {
  ok: false
  code: ProfileBundleRefusalCode
  /** One or more sentences for a person. */
  detail: string
  /** `id@version`, as the bundle lists it or as it was asked for. */
  profile?: string
  /** The digest of the binding file the bundle carries, once it was read. */
  bindingDigest?: string
  /** The artefact's path in its binding, for the three artefact codes. */
  artefact?: string
  /** The registry's own refusal, where the registry was the one to refuse. */
  registration?: RegistrationRefusal
  /** For `bundle-binding-misfiled`: the profile the binding defines, which the registry now holds. */
  registered?: BindingProfile
}

export interface ProfileBundleRegistered {
  ok: true
  profile: BindingProfile
  /** True when these exact bytes were registered before, so this call changed nothing. */
  alreadyRegistered: boolean
}

/** A bundle whose descriptor has been read and checked. Nothing in it is trusted yet: trust is the registry's decision, made per binding. */
export interface OpenedProfileBundle {
  /** The folder the bundle sits in. */
  root: string
  descriptor: ProfileBundleDescriptor
  /** The profiles the bundle covers, each as `id@version`, in the descriptor's order. */
  profiles: string[]
  /** The exact bytes of a profile's binding file, or `undefined` when the bundle does not hold it. */
  bindingBytes(profile: string): Promise<Uint8Array | undefined>
  /** The bytes of a notice the bundle carries for a profile, by the path the binding lists it under, or `undefined`. It has the shape `exportProfileBundle` takes as `readNotice`, once given the profile's name. */
  noticeBytes(profile: string, path: string): Promise<Uint8Array | undefined>
  /** The licence texts the bundle carries, in the form `exportProfileBundle` takes as `licenceTexts`, so a restored deployment can pass the same texts on. */
  licenceTexts(): Promise<Array<{ licence: string; bytes: Uint8Array; fileName: string }>>
  /**
   * The resolver a registry is given for one profile's artefacts: the
   * profile resolver of a deployment restored from this bundle. It answers
   * from the bundle, and for a file the bundle does not hold from
   * `provisioned`, where the destination keeps the files it obtained for
   * itself. Whatever either returns, the registry holds it to the length and
   * digest the binding records.
   */
  resolverFor(profile: string, options?: { provisioned?: ArtefactResolver }): ArtefactResolver
}

/**
 * Opens a bundle: reads its descriptor, strictly, and checks it. A refusal
 * is returned, never thrown. No binding is read here and nothing is
 * registered.
 */
export async function openProfileBundle(source: ProfileBundleSource, options: { root?: string } = {}): Promise<{ ok: true; bundle: OpenedProfileBundle } | ProfileBundleRefusal> {
  const root = rootOf(options.root)
  const refuse = (code: ProfileBundleRefusalCode, detail: string): ProfileBundleRefusal => ({ ok: false, code, detail })
  const at = `${root}/${PROFILE_BUNDLE_DESCRIPTOR}`
  let bytes: unknown
  try {
    bytes = await source(at)
  } catch (cause) {
    return refuse('bundle-descriptor-missing', `The descriptor ${at} could not be read: ${reasonOf(cause)}.`)
  }
  if (!(bytes instanceof Uint8Array)) return refuse('bundle-descriptor-missing', `There is no descriptor at ${at}, so there is no profile bundle to read.`)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return refuse('bundle-descriptor-invalid', `The descriptor ${at} is not UTF-8.`)
  }
  const parsed = parseStrictJson(text)
  if (!parsed.ok) return refuse('bundle-descriptor-invalid', `The descriptor ${at} is refused: ${parsed.detail}.`)
  const problems = profileBundleProblems(parsed.value)
  if (problems.length > 0) return refuse('bundle-descriptor-invalid', `The descriptor ${at} is not a format ${PROFILE_BUNDLE_VERSION} descriptor: ${problems.join(' ')}`)
  const descriptor = parsed.value as ProfileBundleDescriptor
  const inconsistencies = profileBundleInconsistencies(descriptor)
  if (inconsistencies.length > 0) return refuse('bundle-descriptor-invalid', `The descriptor ${at} contradicts itself: ${inconsistencies.join(' ')}`)

  const profiles = descriptor.profiles.map((entry) => entry.profile)
  // A profile name is checked before it becomes part of a path, so a name the descriptor does not list reads nothing.
  const folderOf = (profile: string): string | undefined => (profiles.includes(profile) ? `${root}/${profile}` : undefined)
  const bundle: OpenedProfileBundle = {
    root,
    descriptor,
    profiles,
    bindingBytes: async (profile) => {
      const folder = folderOf(profile)
      if (folder == null) return undefined
      const found = await source(`${folder}/${BINDING_FILE}`)
      return found instanceof Uint8Array ? found : undefined
    },
    noticeBytes: async (profile, path) => {
      const folder = folderOf(profile)
      // Only a notice the descriptor lists is read, so the name of any other file in the folder reads nothing.
      if (folder == null || descriptor.profiles.find((entry) => entry.profile === profile)?.notices.includes(path) !== true) return undefined
      const found = await source(`${folder}/${path}`)
      return found instanceof Uint8Array ? found : undefined
    },
    licenceTexts: async () => {
      const texts: Array<{ licence: string; bytes: Uint8Array; fileName: string }> = []
      for (const entry of descriptor.licences) {
        if (entry.path == null) continue
        const found = await source(`${root}/${entry.path}`)
        if (found instanceof Uint8Array) texts.push({ licence: entry.licence, bytes: found, fileName: entry.path.slice(entry.path.lastIndexOf('/') + 1) })
      }
      return texts
    },
    resolverFor: (profile, resolverOptions = {}) => async (artefact) => {
      const folder = folderOf(profile)
      const found = folder == null || !isPath(artefact.path) ? undefined : await source(`${folder}/${artefact.path}`)
      if (found instanceof Uint8Array) return found
      return resolverOptions.provisioned == null ? undefined : await resolverOptions.provisioned(artefact)
    },
  }
  return { ok: true, bundle }
}

export interface RegisterProfileBundleOptions {
  /** Which of the bundle's profiles to register, each as `id@version`. Default: all of them, in the descriptor's order. */
  profiles?: readonly string[]
  /**
   * The binding digest the destination expects for a profile, where it has
   * one: from its own configuration, from the list a package publishes, such
   * as `BUNDLED_BINDINGS`, or from the `profile_binding_sha256` its records
   * declare. A bundle that carries another binding under that name is
   * refused as substituted before the registry is asked. This narrows what
   * is accepted and never widens it: the registry's trusted list still
   * decides.
   */
  expected?: Iterable<{ profile: string; bindingDigest: string }>
  /** Where the destination keeps the files it obtained for itself, for the artefacts the bundle names and does not carry. */
  provisioned?: ArtefactResolver
}

/**
 * Registers a bundle's profiles into the destination's registry. One result
 * per profile, in order, and nothing is thrown for a refusal. A profile that
 * was refused stays unknown to the registry, so a payload under it answers
 * `unknown` and never `pass`.
 *
 * The registry applies the rules it applies to any binding, and this adds
 * none that widen them: the digest must be on the registry's trusted list,
 * every artefact must be the length and SHA-256 the binding records, and a
 * second definition of an identifier and version is refused. What this adds
 * is the bundle's side of each refusal, so an operator can tell a bundle
 * that is incomplete from one that carries something it should not.
 */
export async function registerProfileBundle(registry: ProfileRegistry, bundle: OpenedProfileBundle, options: RegisterProfileBundleOptions = {}): Promise<Array<ProfileBundleRegistered | ProfileBundleRefusal>> {
  const expected = new Map<string, string>()
  for (const entry of options.expected ?? []) {
    if (!isObject(entry) || typeof entry.profile !== 'string' || !PROFILE.test(entry.profile) || typeof entry.bindingDigest !== 'string' || !SHA256.test(entry.bindingDigest)) throw new TypeError(`an expected binding is given as { profile, bindingDigest }; got ${JSON.stringify(entry)}`)
    const held = expected.get(entry.profile)
    if (held != null && held !== entry.bindingDigest) throw new TypeError(`two binding digests are expected for ${entry.profile}; a profile has one`)
    expected.set(entry.profile, entry.bindingDigest)
  }

  const results: Array<ProfileBundleRegistered | ProfileBundleRefusal> = []
  for (const profile of options.profiles ?? bundle.profiles) {
    const refuse = (code: ProfileBundleRefusalCode, detail: string, extra: Partial<ProfileBundleRefusal> = {}): void => { results.push({ ok: false, code, detail, profile, ...extra }) }
    const listed = bundle.descriptor.profiles.find((entry) => entry.profile === profile)
    if (listed == null) { refuse('bundle-profile-absent', `The bundle does not cover ${JSON.stringify(profile)}. It covers ${bundle.profiles.join(', ')}.`); continue }

    let bindingBytes: Uint8Array | undefined
    try {
      bindingBytes = await bundle.bindingBytes(profile)
    } catch (cause) {
      refuse('bundle-binding-missing', `The binding file of ${profile} could not be read from the bundle: ${reasonOf(cause)}.`)
      continue
    }
    if (bindingBytes == null) { refuse('bundle-binding-missing', `The bundle lists ${profile} and does not hold ${bundle.root}/${profile}/${BINDING_FILE}.`); continue }
    const bindingDigest = profileBindingDigest(bindingBytes)
    if (bindingDigest !== listed.bindingDigest) { refuse('bundle-binding-mismatch', `The binding file of ${profile} has digest ${bindingDigest}; the bundle's descriptor names ${listed.bindingDigest}.`, { bindingDigest }); continue }

    // What the destination already knows this profile to be, where it knows: a digest it was told to expect, else the binding it holds.
    const [id, version] = profile.split('@') as [string, string]
    const held = registry.resolve(id, Number(version))
    const known = expected.get(profile) ?? (held?.format === 'binding' ? held.bindingDigest : undefined)
    if (known != null && known !== bindingDigest) {
      refuse('bundle-binding-substituted', `The bundle carries a binding for ${profile} with digest ${bindingDigest}. This deployment knows ${profile} by binding ${known}, so the bundle holds a different definition under the same name. Whoever signed the package, it is not registered.`, { bindingDigest })
      continue
    }

    const omitted = (path: string): boolean => bundle.descriptor.omitted.some((entry) => (entry.requiredBy ?? []).some((use) => use.profile === profile && use.path === path))
    const result = await registry.register({ bindingBytes, resolveArtefact: bundle.resolverFor(profile, options.provisioned == null ? {} : { provisioned: options.provisioned }) })
    if (result.ok) {
      if (result.profile.profile !== profile) refuse('bundle-binding-misfiled', `The bundle lists binding ${bindingDigest} as ${profile}, and it defines ${result.profile.profile}. The registry holds it as ${result.profile.profile}; ${profile} is not registered.`, { bindingDigest, registered: result.profile })
      else results.push({ ok: true, profile: result.profile, alreadyRegistered: result.alreadyRegistered })
      continue
    }
    const extra = { bindingDigest, registration: result, ...(result.artefact == null ? {} : { artefact: result.artefact }) }
    if (result.code === 'binding-untrusted') {
      refuse('bundle-binding-untrusted', `The bundle carries a binding for ${profile} with digest ${bindingDigest}, which is not on this registry's trusted list. A package's signature says who assembled it and gives a binding no authority. Review the binding and every file it names before trusting that digest.`, extra)
    } else if (result.code === 'artefact-unavailable') {
      if (omitted(result.artefact!)) refuse('bundle-artefact-not-provisioned', `The bundle names ${result.artefact} of ${profile} by address and digest and does not carry it, and this deployment did not supply it. Obtain the file from its publisher and provision it, then register again. ${result.detail}`, extra)
      else refuse('bundle-artefact-missing', `The bundle is incomplete: it does not hold ${result.artefact}, which the binding of ${profile} lists. ${result.detail}`, extra)
    } else if (result.code === 'artefact-length-mismatch' || result.code === 'artefact-digest-mismatch') {
      refuse('bundle-artefact-altered', `The bundle's copy of ${result.artefact} is not the file the binding of ${profile} records. ${result.detail}`, extra)
    } else {
      refuse('bundle-registration-refused', `The registry refused the binding of ${profile} (${result.code}). ${result.detail}`, extra)
    }
  }
  return results
}
