import { describe, expect, it } from 'vitest'
import {
  EXCHANGE_PROFILE_IDS,
  INTEROPERABILITY_PROFILE_IDS,
  OPERATOR_PROFILE_IDS,
  PROFILE_IDS,
  readConsumerDocument,
  readExchangeProfile,
  readInteroperabilityProfile,
  readManifest,
  readOperatorProfile,
  readPublicPayloadSchema,
  readRestrictedPayloadSchema,
} from '../src/index.js'

// A reader that labels a record by the profile the record declares passes a
// string it did not choose; every reader checks it against its own list.
const readers: Array<[string, (profile: string) => unknown, readonly string[]]> = [
  ['readManifest', (p) => readManifest(p as never), PROFILE_IDS],
  ['readPublicPayloadSchema', (p) => readPublicPayloadSchema(p as never), PROFILE_IDS],
  ['readRestrictedPayloadSchema', (p) => readRestrictedPayloadSchema(p as never), PROFILE_IDS],
  ['readConsumerDocument', (p) => readConsumerDocument(p as never), PROFILE_IDS],
  ['readExchangeProfile', (p) => readExchangeProfile(p as never), EXCHANGE_PROFILE_IDS],
  ['readOperatorProfile', (p) => readOperatorProfile(p as never), OPERATOR_PROFILE_IDS],
  ['readInteroperabilityProfile', (p) => readInteroperabilityProfile(p as never), INTEROPERABILITY_PROFILE_IDS],
]

describe('every profile reader refuses an identifier the package does not publish', () => {
  it.each(readers)('%s refuses a path and an unknown identifier before reading anything', (_name, read) => {
    for (const profile of ['../package', '../../package', '../../../../package', 'battery@9', 'Battery@2', '']) {
      expect(() => read(profile)).toThrow(/is not a published .* profile/)
    }
  })

  it.each(readers)('%s still reads every identifier it publishes', (_name, read, ids) => {
    for (const profile of ids) {
      expect(read(profile)).toBeTypeOf('object')
    }
  })
})
