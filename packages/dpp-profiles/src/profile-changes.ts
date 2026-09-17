import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import canonicalize from 'canonicalize'
import { readManifestAny, type AnyProfileField } from './manifest-v2.js'

export interface ProfileFieldChange {
  key: string
  kind: 'added' | 'changed' | 'removed'
  /** Every changed field property, including access, applicability and evidence metadata. */
  properties: string[]
  before?: AnyProfileField
  after?: AnyProfileField
}

export interface ProfileChangeReport {
  reportVersion: 1
  from: { profile: string; status: string; sha256: string }
  to: { profile: string; status: string; sha256: string }
  /** Top-level changes outside fields and generated schema digests. */
  profileChanges: Array<{ property: string; before?: unknown; after?: unknown }>
  fields: ProfileFieldChange[]
  requiresConsumerReview: boolean
  /** A report never activates a profile, transforms data or establishes compatibility. */
  activation: 'explicit-consumer-selection'
}

const same = (a: unknown, b: unknown): boolean => a === undefined || b === undefined ? a === b : canonicalize(a) === canonicalize(b)
const changedKeys = (a: object, b: object): string[] => {
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().filter(key => !same(left[key], right[key]))
}

/**
 * A deterministic impact report for two explicit versions of one industry.
 * Rename intent remains in succession metadata; no values are migrated and
 * no semantic-version compatibility is inferred from a structural diff.
 */
export function compareProfiles(from: string, to: string): ProfileChangeReport {
  // Validate identifiers through the existing reader before using them as paths.
  const before = readManifestAny(from)
  const after = readManifestAny(to)
  if (before.id !== after.id) throw new Error('profile comparison requires the same industry')
  const snapshot = (profile: string, status: string) => ({ profile, status,
    sha256: createHash('sha256').update(readFileSync(new URL(`../manifests/${profile}.json`, import.meta.url))).digest('hex') })
  const left = new Map(before.fields.map(f => [f.key, f]))
  const right = new Map(after.fields.map(f => [f.key, f]))
  const fields: ProfileFieldChange[] = []
  for (const key of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const oldField = left.get(key)
    const newField = right.get(key)
    if (oldField == null) fields.push({ key, kind: 'added', properties: Object.keys(newField!).sort(), after: newField })
    else if (newField == null) fields.push({ key, kind: 'removed', properties: Object.keys(oldField).sort(), before: oldField })
    else {
      const properties = changedKeys(oldField, newField)
      if (properties.length > 0) fields.push({ key, kind: 'changed', properties, before: oldField, after: newField })
    }
  }
  const ignored = new Set(['fields', 'schemaDigest', 'restrictedSchemaDigest'])
  const profileChanges = changedKeys(before, after).filter(key => !ignored.has(key)).map(property => ({ property,
    before: (before as unknown as Record<string, unknown>)[property],
    after: (after as unknown as Record<string, unknown>)[property] }))
  return { reportVersion: 1, from: snapshot(from, before.status), to: snapshot(to, after.status),
    profileChanges, fields, requiresConsumerReview: fields.length > 0 || profileChanges.length > 0,
    activation: 'explicit-consumer-selection' }
}
