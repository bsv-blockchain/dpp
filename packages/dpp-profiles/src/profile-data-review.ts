import { assertProfileNotRetired } from './retired-profiles.js'

export interface ProfileDataFinding {
  field: string
  outcome: 'invalid' | 'needs-review'
  reason: string
}

/**
 * Cross-field findings for a profile's data, beyond what its generated
 * schema can say. An empty list is not a readiness result: source evidence,
 * applicability, access and lifecycle completeness remain separate
 * assessments.
 *
 * No supported profile defines such rules today. The only profiles that did
 * were the drafts `battery@4` and `textile@4`, which are retired, so a call
 * for either throws `ProfileRetiredError` and a call for any other profile
 * throws as it always did. The function stays so that a caller of the
 * retired review is told why by name.
 */
export function reviewProfileData(profile: string, _payload: Record<string, unknown>): ProfileDataFinding[] {
  assertProfileNotRetired(profile)
  throw new Error(`data review is not implemented for ${profile}; select its declared profile rules explicitly`)
}
