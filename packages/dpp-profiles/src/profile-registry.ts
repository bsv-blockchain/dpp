/**
 * The profile registry (`spec/profiles.md` §7): the one place a caller asks
 * for a profile by identifier and version. Two formats answer through it. The
 * manifest-format profiles this package publishes are always there. A profile
 * defined outside the package is added by registering its binding, and is
 * usable only after three things hold: the binding's digest is on the list
 * the operator trusts, no other binding already answers for that identifier
 * and version, and every file the binding names has been read and found to
 * be the file it names, byte for byte.
 *
 * A retired profile (`RETIRED_PROFILE_IDS`) is in neither group. It does not
 * resolve, no binding may claim its identity, and `status` reports it as
 * retired, which is a different answer from unknown: the registry knows the
 * identity and knows that nothing is to be done under it.
 *
 * Where the files come from is the caller's business. The registry asks the
 * caller's resolver for each one and checks what comes back, so a deployment
 * may bundle them, read them from disk or fetch them, and the registry reads
 * nothing itself.
 */
import { SUPPORTED_PROFILE_IDS, readPublicPayloadSchema, type SupportedProfileId } from './index.js'
import { readManifestAny, type AnyProfileManifest } from './manifest-v2.js'
import { describeArtefact, profileBindingDigest, readProfileBinding, type BindingArtefact, type ProfileBinding } from './profile-binding.js'
import { PROFILE_RETIRED, RETIRED_PROFILE_REPLACEMENTS, describeRetiredProfile, isRetiredProfile } from './retired-profiles.js'

/** The caller's side of registration: the bytes of one artefact, or `undefined` when the caller does not hold it. */
export type ArtefactResolver = (artefact: BindingArtefact) => Uint8Array | undefined | Promise<Uint8Array | undefined>

/** A supported profile this package publishes as a manifest (`SUPPORTED_PROFILE_IDS`). Its files are read when asked for. */
export interface ManifestProfile {
  format: 'manifest'
  id: string
  version: number
  profile: string
  readManifest(): AnyProfileManifest
  readPublicPayloadSchema(): Record<string, unknown>
}

/** A profile held by a registered binding, with every artefact the binding names, already checked. */
export interface BindingProfile {
  format: 'binding'
  id: string
  version: number
  profile: string
  /** The SHA-256 of the binding file's exact bytes: what a payload under this profile must declare. */
  bindingDigest: string
  /** The binding file's exact bytes, as registered: the bytes `bindingDigest` is taken over, and what an export carries. */
  bindingBytes: Uint8Array
  binding: ProfileBinding
  artefacts: ReadonlyArray<{ artefact: BindingArtefact; bytes: Uint8Array }>
}

export type RegisteredProfile = ManifestProfile | BindingProfile

/**
 * What a registry knows about an identifier and version. `retired` and
 * `unknown` both mean no rules are applied, and they are told apart so a
 * reader can say which: a retired profile was published and withdrawn from
 * use, and an unknown one was never registered here.
 */
export type ProfileStatus =
  | { state: 'registered'; profile: RegisteredProfile }
  | { state: 'retired'; /** `id@version`. */ profile: string; /** The profile that replaces it. */ replacedBy: string }
  | { state: 'unknown'; /** `id@version`, as asked. */ profile: string }

/** Why a registration was refused. One code per cause, so a caller branches on the code and shows the detail. */
export type RegistrationRefusalCode =
  /** The binding's digest is not on the trusted list. Nothing else about the bytes was read. */
  | 'binding-untrusted'
  /** The bytes are not UTF-8, not JSON, or carry a member name twice. */
  | 'binding-not-json'
  /** The file does not have the structure of a format 1 binding. */
  | 'binding-invalid'
  /** The binding's members contradict one another. */
  | 'binding-inconsistent'
  /** Another binding, with a different digest, already answers for this identifier and version. */
  | 'binding-conflict'
  /** A manifest this package publishes already defines this identifier and version. */
  | 'profile-held-by-manifest'
  /** The binding claims the identity of a retired profile, which is never given another definition. */
  | 'profile-retired'
  /** The resolver did not return the bytes of an artefact. */
  | 'artefact-unavailable'
  /** An artefact is not the length the binding records. */
  | 'artefact-length-mismatch'
  /** An artefact is the recorded length and not the recorded SHA-256. */
  | 'artefact-digest-mismatch'

export interface RegistrationRefusal {
  ok: false
  code: RegistrationRefusalCode
  /** One or more sentences for a person. */
  detail: string
  bindingDigest: string
  /** `id@version`, once the binding could be read. */
  profile?: string
  /** The path of the artefact the refusal is about, for the three artefact codes. */
  artefact?: string
}

export interface RegistrationAccepted {
  ok: true
  profile: BindingProfile
  /** True when these exact bytes were registered before, so this call changed nothing. */
  alreadyRegistered: boolean
}

export type RegistrationResult = RegistrationAccepted | RegistrationRefusal

export interface ProfileRegistry {
  /** Add the profile a binding file defines. `bindingBytes` are the file's exact bytes; the digest is taken over them. */
  register(input: { bindingBytes: Uint8Array; resolveArtefact: ArtefactResolver }): Promise<RegistrationResult>
  /** The profile that answers for an identifier and version, whichever format defines it, or `undefined`. A retired profile does not resolve. */
  resolve(id: string, version: number): RegisteredProfile | undefined
  /** Whether an identifier and version is registered, retired or unknown here. */
  status(id: string, version: number): ProfileStatus
  /** Every profile that resolves: the manifest-format profiles first, in the package's order, then bindings in the order registered. No retired profile is listed. */
  list(): RegisteredProfile[]
}

const SHA256 = /^[0-9a-f]{64}$/

function manifestProfile(profile: SupportedProfileId): ManifestProfile {
  const [id, version] = profile.split('@') as [string, string]
  return {
    format: 'manifest',
    id,
    version: Number(version),
    profile,
    readManifest: () => readManifestAny(profile),
    readPublicPayloadSchema: () => readPublicPayloadSchema(profile),
  }
}

/**
 * A registry that trusts the bindings whose digests it is given, and no
 * others. The list is copied, so it is fixed for the registry's life: adding
 * trust is making a new registry, which keeps "which bindings may this
 * process use" a question with one answer.
 */
export function createProfileRegistry(options: { trustedBindingDigests: Iterable<string> }): ProfileRegistry {
  const trusted = new Set<string>()
  for (const digest of options.trustedBindingDigests) {
    if (typeof digest !== 'string' || !SHA256.test(digest)) throw new TypeError(`a trusted binding digest is 64 lower-case hexadecimal characters; got ${JSON.stringify(digest)}`)
    trusted.add(digest)
  }
  const manifests = new Map<string, ManifestProfile>(SUPPORTED_PROFILE_IDS.map((profile) => [profile, manifestProfile(profile)]))
  const bindings = new Map<string, BindingProfile>()

  const register: ProfileRegistry['register'] = async ({ bindingBytes, resolveArtefact }) => {
    // A private copy first, so the bytes digested are the bytes read, whatever the caller does with its buffer meanwhile.
    const bytes = Uint8Array.from(bindingBytes)
    const bindingDigest = profileBindingDigest(bytes)
    const refuse = (code: RegistrationRefusalCode, detail: string, extra: { profile?: string; artefact?: string } = {}): RegistrationRefusal => ({ ok: false, code, detail, bindingDigest, ...extra })

    // Trust is decided on the digest alone, before a byte of the file is interpreted.
    if (!trusted.has(bindingDigest)) return refuse('binding-untrusted', `The binding with digest ${bindingDigest} is not on this registry's trusted list.`)

    const read = readProfileBinding(bytes)
    if (!read.ok) return refuse(read.code, read.detail.join(' '))
    const { binding } = read
    const profile = binding.profile

    // A retired identity keeps the one meaning its frozen manifest gave it, so nothing else may answer to it.
    if (isRetiredProfile(profile)) return refuse(PROFILE_RETIRED, `${describeRetiredProfile(profile)} A retired identity is never registered again.`, { profile })
    if (manifests.has(profile)) return refuse('profile-held-by-manifest', `${profile} is defined by a manifest this package publishes, so no binding can answer for it.`, { profile })
    const conflict = (held: BindingProfile): RegistrationRefusal => refuse('binding-conflict', `${profile} is already registered with binding digest ${held.bindingDigest}. A changed binding is a new version.`, { profile })
    const held = bindings.get(profile)
    if (held != null) return held.bindingDigest === bindingDigest ? { ok: true, profile: held, alreadyRegistered: true } : conflict(held)

    const artefacts: Array<{ artefact: BindingArtefact; bytes: Uint8Array }> = []
    for (const artefact of binding.artefacts) {
      let supplied: unknown
      try {
        supplied = await resolveArtefact(artefact)
      } catch (cause) {
        return refuse('artefact-unavailable', `The artefact ${artefact.path} could not be read: ${cause instanceof Error ? cause.message : String(cause)}.`, { profile, artefact: artefact.path })
      }
      if (!(supplied instanceof Uint8Array)) return refuse('artefact-unavailable', `The artefact ${artefact.path} was not supplied as bytes.`, { profile, artefact: artefact.path })
      const copy = Uint8Array.from(supplied)
      const actual = describeArtefact(copy)
      if (actual.byteLength !== artefact.byteLength) return refuse('artefact-length-mismatch', `The artefact ${artefact.path} is ${actual.byteLength} bytes; the binding records ${artefact.byteLength}.`, { profile, artefact: artefact.path })
      if (actual.sha256 !== artefact.sha256) return refuse('artefact-digest-mismatch', `The artefact ${artefact.path} has SHA-256 ${actual.sha256}; the binding records ${artefact.sha256}.`, { profile, artefact: artefact.path })
      artefacts.push({ artefact, bytes: copy })
    }

    // Reading the artefacts may have waited, and another registration may have finished meanwhile.
    const arrived = bindings.get(profile)
    if (arrived != null) return arrived.bindingDigest === bindingDigest ? { ok: true, profile: arrived, alreadyRegistered: true } : conflict(arrived)

    const registered: BindingProfile = { format: 'binding', id: binding.id, version: binding.version, profile, bindingDigest, bindingBytes: bytes, binding, artefacts }
    bindings.set(profile, registered)
    return { ok: true, profile: registered, alreadyRegistered: false }
  }

  const resolve: ProfileRegistry['resolve'] = (id, version) => {
    // The key is built only from a whole, positive version, so `1.5` or a version already written into `id` finds nothing.
    if (typeof id !== 'string' || !Number.isSafeInteger(version) || version < 1) return undefined
    const profile = `${id}@${version}`
    return manifests.get(profile) ?? bindings.get(profile)
  }

  const status: ProfileRegistry['status'] = (id, version) => {
    const profile = `${String(id)}@${String(version)}`
    if (isRetiredProfile(profile)) return { state: 'retired', profile, replacedBy: RETIRED_PROFILE_REPLACEMENTS[profile] }
    const registered = resolve(id, version)
    return registered == null ? { state: 'unknown', profile } : { state: 'registered', profile: registered }
  }

  return { register, resolve, status, list: () => [...manifests.values(), ...bindings.values()] }
}
