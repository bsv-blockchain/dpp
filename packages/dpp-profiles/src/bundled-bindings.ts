/**
 * The bindings this package ships (`spec/profiles.md` §7), under `bindings/`
 * beside `dist/`. Each sector folder holds its binding files, the artefacts
 * they name and the upstream notice that accounts for each file.
 *
 * Each sector keeps one copy of its upstream artefacts and notice. Both
 * versions name those bytes. The original binding.json identifies historical
 * records. New passports select binding.v2.json and its required subject class.
 *
 * The digests are written out here, not computed from the folder. A binding
 * file that has changed on disk is then not a bundled binding at all, and
 * the binding in turn records the length and SHA-256 of every artefact, so
 * one constant in this module holds the whole folder to its published bytes.
 */
import { readFileSync } from 'node:fs'
import { profileBindingDigest } from './profile-binding.js'
import type { BindingProfile, ProfileRegistry, RegistrationResult } from './profile-registry.js'

/** Original editions retained for reads and maintenance of existing passports. */
export const HISTORICAL_SECTOR_BINDINGS = [
  { profile: 'eu-battery@1', bindingDigest: '89c5687f441926e8af37696a8f703342364e060f71d817badf3e1366043010b4' },
  { profile: 'eu-textile@1', bindingDigest: '8bccb7952d24180327a318772a2462141c4b84a37f1b16f0b9eee131e362d994' },
] as const

/** Immutable editions selected for new sector passports. */
export const CURRENT_SECTOR_BINDINGS = [
  { profile: 'eu-battery@2', bindingDigest: '084cd32380744fcb767488440a88a7f0eef674b036038a33ecdc02cd85a22c67', artefactDirectory: 'eu-battery@1' },
  { profile: 'eu-textile@2', bindingDigest: '6f6b3a477d8718fa9e857387e3a11d1bf34a101708c2fb3ed911eb8cd2f7bc35', artefactDirectory: 'eu-textile@1' },
] as const

/** All distributed editions, in registration order. Select CURRENT_SECTOR_BINDINGS for new issuance. */
export const BUNDLED_BINDINGS = [...HISTORICAL_SECTOR_BINDINGS, ...CURRENT_SECTOR_BINDINGS] as const

const packagedBindings = [
  ...HISTORICAL_SECTOR_BINDINGS.map((entry) => ({ ...entry, artefactDirectory: entry.profile, file: 'binding.json' })),
  ...CURRENT_SECTOR_BINDINGS.map((entry) => ({ ...entry, file: 'binding.v2.json' })),
]

export type BundledBindingId = (typeof packagedBindings)[number]['profile']

/** The trusted digest list for the bundled bindings: what `createProfileRegistry` is given to trust them, alone or beside an operator's own. */
export const BUNDLED_BINDING_DIGESTS: readonly string[] = BUNDLED_BINDINGS.map((entry) => entry.bindingDigest)

/** A refusal made here, before the registry is asked: the package folder does not hold the binding this module pins. */
export interface BundledBindingRefusal {
  ok: false
  /** `bundled-binding-unavailable`: the binding file could not be read. `bundled-binding-altered`: it is not the file the package pins. */
  code: 'bundled-binding-unavailable' | 'bundled-binding-altered'
  detail: string
  profile: BundledBindingId
  /** The digest of the file that was found, for `bundled-binding-altered`. */
  bindingDigest?: string
}

export interface RegisterBundledBindingsOptions {
  /** Which bundled profiles to register. The default selection is `BUNDLED_BINDINGS`. */
  profiles?: readonly BundledBindingId[]
  /**
   * The folder that holds one folder per sector, as a `file:` URL. Default:
   * the package's own `bindings/`. A deployment whose bundler moved the data
   * files names where they went. The files are held to the same digests
   * wherever they are read from.
   */
  directory?: URL
}

const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

/** The folder that holds the bundled sector folders: the one given, or the package's own `bindings/`. */
function bindingsDirectory(given: URL | undefined): URL {
  // A path given as text would be read as a relative URL and land somewhere else, so it is refused by name.
  if (given != null && !(given instanceof URL && given.protocol === 'file:')) throw new TypeError('directory must be a file: URL, such as pathToFileURL(folder)')
  // A base without a trailing slash would resolve each profile beside the folder, not inside it.
  return given == null ? new URL('../bindings/', import.meta.url) : new URL(given.href.endsWith('/') ? given.href : `${given.href}/`)
}

/**
 * Registers the bundled bindings into a registry, reading each from the
 * package folder. One result per profile, in order, in the registry's own
 * terms: nothing is thrown for a refusal, and a profile that was refused
 * stays unknown to the registry, so a payload under it answers `unknown`.
 *
 * The registry decides trust, as for any binding: build it with
 * `BUNDLED_BINDING_DIGESTS` among its trusted digests. The binding file is
 * also held to the digest this module pins before the registry sees it, so a
 * changed file is refused here even by a registry that would trust it.
 */
export async function registerBundledBindings(registry: ProfileRegistry, options: RegisterBundledBindingsOptions = {}): Promise<Array<RegistrationResult | BundledBindingRefusal>> {
  const selected = options.profiles ?? BUNDLED_BINDINGS.map((entry) => entry.profile)
  const entries = selected.map((profile) => {
    const entry = packagedBindings.find((candidate) => candidate.profile === profile)
    if (entry == null) throw new TypeError(`${JSON.stringify(profile)} is not a bundled binding; expected one of ${packagedBindings.map((candidate) => candidate.profile).join(', ')}`)
    return entry
  })
  const directory = bindingsDirectory(options.directory)

  const results: Array<RegistrationResult | BundledBindingRefusal> = []
  for (const { profile, bindingDigest, artefactDirectory, file } of entries) {
    const folder = new URL(`${artefactDirectory}/`, directory)
    let bindingBytes: Uint8Array
    try {
      bindingBytes = new Uint8Array(readFileSync(new URL(file, folder)))
    } catch (cause) {
      results.push({ ok: false, code: 'bundled-binding-unavailable', profile, detail: `The bundled binding ${profile} could not be read from ${new URL(file, folder).href}: ${reasonOf(cause)}.` })
      continue
    }
    const found = profileBindingDigest(bindingBytes)
    if (found !== bindingDigest) {
      results.push({ ok: false, code: 'bundled-binding-altered', profile, bindingDigest: found, detail: `The binding file for ${profile} has digest ${found}; this package pins ${bindingDigest}.` })
      continue
    }
    // A path in a binding is a relative file name with no dot or dot-dot segment, so it resolves inside the folder.
    // A file that is missing throws, and the registry reports it as unavailable and names it.
    results.push(await registry.register({ bindingBytes, resolveArtefact: (artefact) => new Uint8Array(readFileSync(new URL(artefact.path, folder))) }))
  }
  return results
}

/** The name the bundled bindings give the licence their files are under. */
export const BUNDLED_BINDING_LICENCE = 'Apache-2.0'

/**
 * What `exportProfileBundle` takes as `readNotice` for the bundled bindings:
 * a notice read from the package folder, by the path the binding lists it
 * under. It answers `undefined` for a profile the package does not bundle, a
 * bundled name registered from other bytes included, so an exporter with
 * profiles of its own asks this first and its own folders next. A notice
 * that is missing from the folder is `undefined` too, and the export is then
 * refused, because the bundled files are not passed on without the notice
 * that accounts for them.
 */
export function bundledBindingNotices(options: { directory?: URL } = {}): (profile: Pick<BindingProfile, 'profile' | 'bindingDigest'>, path: string) => Uint8Array | undefined {
  const directory = bindingsDirectory(options.directory)
  return (profile, path) => {
    const entry = packagedBindings.find((candidate) => candidate.profile === profile.profile && candidate.bindingDigest === profile.bindingDigest)
    // A notice path is a relative file name with no dot or dot-dot segment, as the binding format requires, and it is checked again here because it becomes part of a file name.
    if (entry == null || !/^[A-Za-z0-9_@-][A-Za-z0-9._@-]*(\/[A-Za-z0-9_@-][A-Za-z0-9._@-]*)*$/u.test(path)) return undefined
    try {
      return new Uint8Array(readFileSync(new URL(path, new URL(`${entry.artefactDirectory}/`, directory))))
    } catch {
      return undefined
    }
  }
}

/**
 * What `exportProfileBundle` takes as `licenceTexts` for the bundled
 * bindings: the licence text their notices point to, which is the `LICENSE`
 * file at the root of this package. Inside the package that file travels
 * beside the bindings. A bundle leaves the package, so it carries the text
 * itself. Empty when the file is not where the package keeps it, as after a
 * bundler moved the code, and the bundle then names the licence without
 * carrying its text.
 */
export function bundledBindingLicenceTexts(): Array<{ licence: string; bytes: Uint8Array; mediaType: string; fileName: string }> {
  try {
    return [{ licence: BUNDLED_BINDING_LICENCE, bytes: new Uint8Array(readFileSync(new URL('../LICENSE', import.meta.url))), mediaType: 'text/plain', fileName: `${BUNDLED_BINDING_LICENCE}.txt` }]
  } catch {
    return []
  }
}
