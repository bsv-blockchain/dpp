/**
 * The bindings this package ships (`spec/profiles.md` §7), under `bindings/`
 * beside `dist/`: one folder per profile, holding `binding.json`, every
 * artefact the binding names and a `NOTICE.md` that accounts for each file.
 *
 * Two things here, and they are kept apart on purpose. `BUNDLED_BINDINGS` is
 * the list of digests the package publishes for its own bindings: a registry
 * trusts the bundled bindings by being given that list, and only then.
 * `registerBundledBindings` reads the folders and registers them. Shipping a
 * binding does not make it trusted, and importing the package reads no file.
 *
 * The digests are written out here, not computed from the folder. A binding
 * file that has changed on disk is then not a bundled binding at all, and
 * the binding in turn records the length and SHA-256 of every artefact, so
 * one constant in this module holds the whole folder to its published bytes.
 */
import { readFileSync } from 'node:fs'
import { profileBindingDigest } from './profile-binding.js'
import type { ProfileRegistry, RegistrationResult } from './profile-registry.js'

/** Every binding the package ships, with the SHA-256 of its `binding.json`. */
export const BUNDLED_BINDINGS = [
  { profile: 'eu-battery@1', bindingDigest: '89c5687f441926e8af37696a8f703342364e060f71d817badf3e1366043010b4' },
  { profile: 'eu-textile@1', bindingDigest: '8bccb7952d24180327a318772a2462141c4b84a37f1b16f0b9eee131e362d994' },
] as const

export type BundledBindingId = (typeof BUNDLED_BINDINGS)[number]['profile']

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
  /** Which bundled profiles to register. Default: all of them, in the order of `BUNDLED_BINDINGS`. */
  profiles?: readonly BundledBindingId[]
  /**
   * The folder that holds one folder per profile, as a `file:` URL. Default:
   * the package's own `bindings/`. A deployment whose bundler moved the data
   * files names where they went. The files are held to the same digests
   * wherever they are read from.
   */
  directory?: URL
}

const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

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
    const entry = BUNDLED_BINDINGS.find((candidate) => candidate.profile === profile)
    if (entry == null) throw new TypeError(`${JSON.stringify(profile)} is not a bundled binding; expected one of ${BUNDLED_BINDINGS.map((candidate) => candidate.profile).join(', ')}`)
    return entry
  })
  const given = options.directory
  // A path given as text would be read as a relative URL and land somewhere else, so it is refused by name.
  if (given != null && !(given instanceof URL && given.protocol === 'file:')) throw new TypeError('directory must be a file: URL, such as pathToFileURL(folder)')
  // A base without a trailing slash would resolve each profile beside the folder, not inside it.
  const directory = given == null ? new URL('../bindings/', import.meta.url) : new URL(given.href.endsWith('/') ? given.href : `${given.href}/`)

  const results: Array<RegistrationResult | BundledBindingRefusal> = []
  for (const { profile, bindingDigest } of entries) {
    const folder = new URL(`${profile}/`, directory)
    let bindingBytes: Uint8Array
    try {
      bindingBytes = new Uint8Array(readFileSync(new URL('binding.json', folder)))
    } catch (cause) {
      results.push({ ok: false, code: 'bundled-binding-unavailable', profile, detail: `The bundled binding ${profile} could not be read from ${new URL('binding.json', folder).href}: ${reasonOf(cause)}.` })
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
