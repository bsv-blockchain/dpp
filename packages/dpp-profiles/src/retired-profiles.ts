/**
 * Retired profiles (`spec/profiles.md` §4).
 *
 * The sector profiles this package first published as manifests were
 * replaced by profiles held by a binding. Retiring one changes what the
 * software does with it and never what it says: the manifest, its generated
 * schemas and its consumer document stay in the package at their frozen
 * digests, and the identity is never given to another definition.
 *
 * Two rules follow, and this module is where both start. Nothing is issued,
 * prepared or validated for writing under a retired profile: every such
 * helper refuses with `profile-retired`. A record that declares one is
 * reported as unsupported: a validator answers `unknown` with the cause
 * `profile-retired`, which is neither a pass nor a failure, because its
 * rules were not applied.
 *
 * The cutover is clean. No function converts a payload from a retired
 * profile to its replacement, and none reads one under the old rules.
 */

/** The retired identities, as `id@version`. The one list every refusal and every unsupported answer is decided from. */
export const RETIRED_PROFILE_IDS = ['battery@2', 'battery@3', 'battery@4', 'textile@1', 'textile@2', 'textile@3', 'textile@4'] as const
export type RetiredProfileId = (typeof RETIRED_PROFILE_IDS)[number]

/** The code of every refusal a retired profile causes, and the cause of every `unknown` answer about one. */
export const PROFILE_RETIRED = 'profile-retired' as const

/**
 * The profile that replaces each retired one. A replacement is another data
 * model under its own identity, not a later version: nothing maps one onto
 * the other.
 */
export const RETIRED_PROFILE_REPLACEMENTS: Readonly<Record<RetiredProfileId, string>> = {
  'battery@2': 'eu-battery@1',
  'battery@3': 'eu-battery@1',
  'battery@4': 'eu-battery@1',
  'textile@1': 'eu-textile@1',
  'textile@2': 'eu-textile@1',
  'textile@3': 'eu-textile@1',
  'textile@4': 'eu-textile@1',
}

/** Whether `id@version` names a retired profile. Decided on the identity alone, so no registration and no option changes the answer. */
export function isRetiredProfile(profile: string): profile is RetiredProfileId {
  return (RETIRED_PROFILE_IDS as readonly string[]).includes(profile)
}

/** One sentence for a person: that the profile is retired, and what replaces it. */
export function describeRetiredProfile(profile: RetiredProfileId): string {
  return `${profile} is retired: nothing is issued or validated under it, and a record that declares it is reported as unsupported. ${RETIRED_PROFILE_REPLACEMENTS[profile]} replaces it, and there is no converter.`
}

/** The refusal a helper throws when it is asked to build or check a payload under a retired profile. */
export class ProfileRetiredError extends Error {
  readonly code = PROFILE_RETIRED
  /** The profile that replaces the retired one. */
  readonly replacedBy: string

  constructor(readonly profile: RetiredProfileId) {
    super(describeRetiredProfile(profile))
    this.name = 'ProfileRetiredError'
    this.replacedBy = RETIRED_PROFILE_REPLACEMENTS[profile]
  }
}

/** Throws `ProfileRetiredError` for a retired profile and returns for every other identifier. */
export function assertProfileNotRetired(profile: string): void {
  if (isRetiredProfile(profile)) throw new ProfileRetiredError(profile)
}
