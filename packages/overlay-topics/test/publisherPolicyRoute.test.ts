import { afterEach, describe, expect, it } from 'vitest'
import { verifyPolicyChain } from '@bsv/dpp-core'
import { startOverlayService, type RunningService } from '../src/index.js'
import { newNode } from './helpers.js'
import { OPERATORS, policyChain } from './policy-fixture.js'

/**
 * GET /publisher-policy: the signed chain an index admits under, so a reader
 * checks the index's publisher keys and their windows itself, against
 * operator keys it got from the operator, instead of taking the flat list in
 * GET /capabilities on the index's word.
 */

const HOST = '127.0.0.1'
let running: RunningService | undefined
afterEach(async () => {
  await running?.close()
  running = undefined
})

describe('GET /publisher-policy', () => {
  it('serves the chain the index verified at boot, which a reader verifies against the operator keys it holds', async () => {
    const chain = policyChain()
    const node = newNode(undefined, {}, { quiet: true, publisherPolicy: { chain, operators: OPERATORS, versions: [1, 2], source: 'test' } })
    running = await startOverlayService(node.engine, { port: 0, host: HOST, components: node.components })
    const response = await fetch(`http://${HOST}:${running.port}/publisher-policy`)
    expect(response.status).toBe(200)
    const served = await response.json()
    expect(served).toEqual(JSON.parse(JSON.stringify(chain)))
    expect(verifyPolicyChain(served, OPERATORS).ok).toBe(true)
    // Against a key that is not the operator's, the same chain does not verify.
    expect(verifyPolicyChain(served, { [Object.keys(OPERATORS)[0]]: '02' + 'ab'.repeat(32) }).ok).toBe(false)
  })

  it('answers 404 with no-publisher-policy on an index that admits under one identity key', async () => {
    const node = newNode(undefined, {}, { quiet: true })
    running = await startOverlayService(node.engine, { port: 0, host: HOST, components: node.components })
    const response = await fetch(`http://${HOST}:${running.port}/publisher-policy`)
    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('no-publisher-policy')
  })
})
