import type { Check, Credential } from './types.js';

/** The VC Data Model 2.0 validity interval at one evaluation time: validFrom must not be later, and a validUntil must be later than both. */
export function verifyTemporal(credential: Credential, evaluationTime: string): Check {
  const fail = (code: string, message: string): Check => ({ outcome: 'invalid', issues: [{ code, path: '', message }] });
  const now = Date.parse(evaluationTime), start = Date.parse(credential.validFrom);
  if (!Number.isFinite(now) || !Number.isFinite(start)) return fail('invalid_time', 'A valid evaluation time and credential validFrom are required');
  if (start > now) return fail('not_yet_valid', 'Credential is not valid at the evaluation time');
  if (credential.validUntil !== undefined && (!Number.isFinite(Date.parse(credential.validUntil)) || Date.parse(credential.validUntil) <= now || Date.parse(credential.validUntil) <= start)) return fail('expired', 'Credential validity interval excludes the evaluation time');
  return { outcome: 'verified', issues: [], evidence: undefined };
}
