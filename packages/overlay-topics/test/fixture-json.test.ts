import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ANCHOR_V3_FIXTURE } from './anchor-v3-fixture.js'

/**
 * fixtures/anchor-v3.json is served to implementations that cannot import
 * this package, and its contract is that it is this module, verbatim. This
 * test is the enforcement: regenerating the module without regenerating the
 * JSON (or editing the JSON by hand) goes red with a diff.
 */
describe('the published fixture file', () => {
  it('is anchor-v3-fixture.ts, verbatim', () => {
    const published = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '..', '..', '..', 'fixtures', 'anchor-v3.json'),
        'utf8'
      )
    )
    expect(published).toEqual(JSON.parse(JSON.stringify(ANCHOR_V3_FIXTURE)))
  })
})
