import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RECORD_V1_FIXTURE } from './record-v1-fixture.js'
import { CHAIN_V1_FIXTURE } from './chain-v1-fixture.js'

/**
 * fixtures/record-v1.json is served to implementations that cannot import
 * this package, and its contract is that it is this module, verbatim. This
 * test is the enforcement: regenerating the module without regenerating the
 * JSON (or editing the JSON by hand) goes red with a diff.
 */
describe('the published fixture files', () => {
  it('record-v1.json is record-v1-fixture.ts, verbatim', () => {
    const published = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '..', '..', '..', 'fixtures', 'record-v1.json'),
        'utf8'
      )
    )
    expect(published).toEqual(JSON.parse(JSON.stringify(RECORD_V1_FIXTURE)))
  })

  it('chain-v1.json is chain-v1-fixture.ts, verbatim', () => {
    const published = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '..', '..', '..', 'fixtures', 'chain-v1.json'),
        'utf8'
      )
    )
    expect(published).toEqual(JSON.parse(JSON.stringify(CHAIN_V1_FIXTURE)))
  })
})
