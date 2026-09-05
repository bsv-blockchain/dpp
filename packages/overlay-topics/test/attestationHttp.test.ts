import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { Engine } from '@bsv/overlay'
import { LockingScript, MerklePath, Transaction, UnlockingScript } from '@bsv/sdk'
import { AttestationTopicManager } from '../src/tmAttestation.js'
import { AttestationLookupService } from '../src/lsAttestation.js'
import { InMemoryAttestationStorage } from '../src/attestationStorage.js'
import { UoraAnchorTopicManager } from '../src/tmUoraDpp.js'
import { UoraAnchorLookupService } from '../src/lsUoraDpp.js'
import { InMemoryUoraAnchorStorage } from '../src/anchorStorage.js'
import { InMemoryOverlayStorage } from '../src/engineStorage.js'
import { startOverlayService } from '../src/index.js'

it('round-trips current anchors through real Engine HTTP, cursor queries and separate legacy topics', async () => {
  const fixture = JSON.parse(readFileSync(new URL('../../../fixtures/attestation-anchor-v1.json', import.meta.url), 'utf8'))
  const funding = new Transaction()
  funding.addOutput({ satoshis: 10000, lockingScript: LockingScript.fromHex('51') })
  // Synthetic funding proof; this test exercises scripts and HTTP, not SPV.
  funding.merklePath = MerklePath.fromCoinbaseTxidAndHeight(funding.id('hex'), 800000)
  const transaction = new Transaction()
  transaction.addInput({ sourceTransaction: funding, sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
  transaction.addOutput({ satoshis: 1, lockingScript: LockingScript.fromHex(fixture.lockingScript) })
  transaction.addOutput({ satoshis: 9000, lockingScript: LockingScript.fromHex('51') })
  const engine = new Engine(
    { tm_attestation: new AttestationTopicManager(), tm_uora_dpp: new UoraAnchorTopicManager() },
    { ls_attestation: new AttestationLookupService(new InMemoryAttestationStorage()), ls_uora_dpp: new UoraAnchorLookupService(new InMemoryUoraAnchorStorage()) },
    new InMemoryOverlayStorage(), 'scripts only', undefined, undefined, undefined, undefined, undefined,
    { tm_attestation: false, tm_uora_dpp: false },
  )
  const service = await startOverlayService(engine, { port: 0, host: '127.0.0.1' })
  const base = `http://127.0.0.1:${service.port}`
  try {
    const submitted = await fetch(base + '/submit', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Topics': '["tm_attestation","tm_uora_dpp"]' }, body: new Uint8Array(transaction.toBEEF()) })
    expect(submitted.status).toBe(200)
    const steak = await submitted.json() as Record<string, { outputsToAdmit: number[] }>
    expect(steak.tm_attestation.outputsToAdmit).toEqual([0])
    expect(steak.tm_uora_dpp.outputsToAdmit).toEqual([])
    const lookup = async (query: object, name = 'ls_attestation') => await fetch(base + '/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: name, query }) })
    const first = await lookup({ subject: fixture.anchor.subject, limit: 1 })
    expect(first.status).toBe(200)
    const answer = await first.json() as { outputs: Array<{ beef: number[]; outputIndex: number }> }
    expect(answer.outputs).toHaveLength(1)
    expect(Transaction.fromBEEF(answer.outputs[0].beef).id('hex')).toBe(transaction.id('hex'))
    const next = await lookup({ subject: fixture.anchor.subject, after: { txid: transaction.id('hex'), outputIndex: 0 } })
    expect(next.status).toBe(200)
    expect((await next.json() as { outputs: unknown[] }).outputs).toEqual([])
    const legacy = await lookup({ subject: fixture.anchor.subject }, 'ls_uora_dpp')
    expect((await legacy.json() as { outputs: unknown[] }).outputs).toEqual([])
    const documentation = await fetch(base + '/getDocumentationForTopicManager?manager=tm_attestation')
    expect(documentation.status).toBe(200)
    expect(await documentation.text()).toContain('bsv-attestation-anchor-v1')
  } finally { await service.close() }
})
