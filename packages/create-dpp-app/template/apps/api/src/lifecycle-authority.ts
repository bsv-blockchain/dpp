// Only the operator supplies these grants. Each names one identity key, product, purpose,
// role and interval of EPCIS event times. The file is read once when the platform starts.
import { readFileSync } from 'node:fs'
import { didKeyFromIdentityKey } from '@bsv/dpp-protocol'
import { EPCIS_LIFECYCLE_ROLES, parseStrictJcsJson, type EpcisLifecycleAuthorityQuestion, type EpcisLifecycleVerificationOptions } from '@bsv/dpp-credentials/epcis-lifecycle'

export type LifecycleAuthorityResolver = NonNullable<EpcisLifecycleVerificationOptions['authorityResolver']>

type Grant = Pick<EpcisLifecycleAuthorityQuestion, 'issuer' | 'issuerKey' | 'passportId' | 'purpose' | 'role'> & { from: number; until: number }
const fields = ['issuer', 'issuerKey', 'passportId', 'purpose', 'role', 'validFrom', 'validUntil'] as const
const object = (x: unknown): x is Record<string, unknown> => x != null && typeof x === 'object' && !Array.isArray(x)

function utcInstant(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return NaN
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value.slice(0, 19) ? time : NaN
}

function readGrant(value: unknown, index: number): Grant {
  const error = (field: string): never => { throw new Error('LIFECYCLE_AUTHORITY_GRANTS_FILE: invalid ' + field + ' in grant ' + (index + 1)) }
  if (!object(value) || Object.keys(value).length !== fields.length || !fields.every((k) => typeof value[k] === 'string' && value[k] !== '')) return error('fields')
  const { issuer, issuerKey, passportId, purpose, role, validFrom, validUntil } = value as Record<(typeof fields)[number], string>
  if (!/^did:[a-z0-9]+:(?:[a-zA-Z0-9._:-]|%[a-fA-F0-9]{2})*(?:[a-zA-Z0-9._-]|%[a-fA-F0-9]{2})$/.test(issuer) || issuer.length > 512) return error('issuer')
  if (!/^0[23][a-f0-9]{64}$/.test(issuerKey)) return error('issuerKey')
  let keyDid: string
  try { keyDid = didKeyFromIdentityKey(issuerKey) } catch { return error('issuerKey') }
  if (issuer.startsWith('did:key:') && issuer !== keyDid) return error('issuer/issuerKey')
  if (!/^(?:https?:\/\/|urn:)[^\s*]+$/.test(passportId) || passportId.length > 512 || !URL.canParse(passportId)) return error('passportId')
  if (purpose !== 'claim' && purpose !== 'error-declaration') return error('purpose')
  if (!(EPCIS_LIFECYCLE_ROLES as readonly string[]).includes(role)) return error('role')
  const from = utcInstant(validFrom)
  const until = utcInstant(validUntil)
  if (!(from < until)) return error('validFrom/validUntil')
  return { issuer, issuerKey, passportId, purpose, role: role as Grant['role'], from, until }
}

export function openLifecycleAuthority(path: string): LifecycleAuthorityResolver {
  const document = parseStrictJcsJson(Array.from(readFileSync(path)))
  if (!object(document) || Object.keys(document).length !== 1 || !Array.isArray(document.grants)) {
    throw new Error('LIFECYCLE_AUTHORITY_GRANTS_FILE must contain an object with a grants array')
  }
  const grants = document.grants.map(readGrant)
  return (question) => {
    const eventTime = Date.parse(question.eventTime)
    const found = grants.some((g) => g.issuer === question.issuer && g.issuerKey === question.issuerKey && g.passportId === question.passportId &&
      g.role === question.role && g.purpose === question.purpose && g.from <= eventTime && eventTime < g.until)
    return { status: found ? 'supported' : 'unsupported' }
  }
}
