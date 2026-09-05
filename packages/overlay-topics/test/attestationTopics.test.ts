import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { LockingScript, Transaction, UnlockingScript } from '@bsv/sdk'
import { AttestationTopicManager } from '../src/tmAttestation.js'
import { AttestationLookupService, ATTESTATION_SERVICE } from '../src/lsAttestation.js'
import { ATTESTATION_TOPIC } from '../src/tmAttestation.js'
import { InMemoryAttestationStorage, MongoAttestationStorage, type AttestationRecord } from '../src/attestationStorage.js'
import type { Db } from 'mongodb'

const f = JSON.parse(readFileSync(new URL('../../../fixtures/attestation-anchor-v1.json', import.meta.url), 'utf8'))
const outpoint = (index: number) => ({ txid: Math.floor(index / 3).toString(16).padStart(64, '0'), outputIndex: index % 3 })
const record = (index: number): AttestationRecord => ({ ...f.anchor, ...outpoint(index), lockingKey: f.lockingKey, createdAt: new Date('2026-09-05T00:00:00Z') })

describe('generic attestation topic and lookup', () => {
  it('admits batches, applies service policy and refuses historical layouts', async () => {
    const transaction = new Transaction()
    transaction.addOutput({ satoshis: 1, lockingScript: LockingScript.fromHex(f.lockingScript) })
    expect(await new AttestationTopicManager().identifyAdmissibleOutputs(transaction.toBEEF(true))).toEqual({ outputsToAdmit: [], coinsToRetain: [] })
    const source = new Transaction()
    source.addOutput({ satoshis: 3, lockingScript: LockingScript.fromASM('OP_TRUE') })
    transaction.addInput({ sourceTransaction: source, sourceOutputIndex: 0, unlockingScript: UnlockingScript.fromASM('OP_TRUE') })
    transaction.addOutput({ satoshis: 1, lockingScript: LockingScript.fromASM('OP_TRUE') })
    transaction.addOutput({ satoshis: 1, lockingScript: LockingScript.fromHex(f.lockingScript) })
    expect(await new AttestationTopicManager([f.anchor.anchoredBy]).identifyAdmissibleOutputs(transaction.toBEEF(true))).toEqual({ outputsToAdmit: [0, 2], coinsToRetain: [] })
    expect(await new AttestationTopicManager(['unknown-service']).identifyAdmissibleOutputs(transaction.toBEEF(true))).toEqual({ outputsToAdmit: [], coinsToRetain: [] })
    expect(await new AttestationTopicManager().identifyAdmissibleOutputs([1, 2, 3])).toEqual({ outputsToAdmit: [], coinsToRetain: [] })
  })

  it('indexes only the current topic and retains a spent commitment', async () => {
    const store = new InMemoryAttestationStorage()
    const service = new AttestationLookupService(store)
    const payload = { mode: 'locking-script' as const, topic: ATTESTATION_TOPIC, ...outpoint(1), lockingScript: LockingScript.fromHex(f.lockingScript), satoshis: 1 }
    await service.outputAdmittedByTopic({ ...payload, topic: 'tm_uora_dpp' })
    expect(await service.lookup({ service: ATTESTATION_SERVICE, query: { digest: f.anchor.digest } })).toEqual([])
    await service.outputAdmittedByTopic(payload)
    await service.outputAdmittedByTopic(payload)
    await service.outputSpent({ mode: 'txid', ...outpoint(1), topic: ATTESTATION_TOPIC, spendingTXID: 'f'.repeat(64) })
    expect(await service.lookup({ service: ATTESTATION_SERVICE, query: { digest: f.anchor.digest } })).toEqual([outpoint(1)])
    await service.outputEvicted(payload.txid, payload.outputIndex)
    expect(await service.lookup({ service: ATTESTATION_SERVICE, query: { digest: f.anchor.digest } })).toEqual([])
  })

  it('retrieves more than 500 outputs without gaps, duplicates or timestamp ordering', async () => {
    const store = new InMemoryAttestationStorage()
    for (let index = 1002; index >= 0; index--) await store.insert(record(index))
    const service = new AttestationLookupService(store)
    const found: Array<{ txid: string; outputIndex: number }> = []
    let after: { txid: string; outputIndex: number } | undefined
    for (;;) {
      const page = await service.lookup({ service: ATTESTATION_SERVICE, query: { issuer: f.anchor.issuer, limit: 137, ...(after ? { after } : {}) } })
      expect(Array.isArray(page)).toBe(true)
      if (page.length === 0) break
      found.push(...page)
      after = page.at(-1)!
    }
    expect(found).toEqual(Array.from({ length: 1003 }, (_, index) => outpoint(index)))
  })

  it.each([
    {}, { attestationType: 'Origin' }, { issuer: { $ne: '' } },
    { issuer: 'x', surprise: 'ignored' }, { issuer: 'x', limit: 0 },
    { issuer: 'x', limit: 501 }, { issuer: 'x', limit: 1.5 },
    { issuer: 'x', after: { txid: 'bad', outputIndex: 0 } },
    { issuer: 'x', after: { ...outpoint(0), outputIndex: -1 } },
  ])('rejects ambiguous or unsafe queries %j', async query => {
    const service = new AttestationLookupService(new InMemoryAttestationStorage())
    await expect(service.lookup({ service: ATTESTATION_SERVICE, query })).rejects.toThrow()
  })

  it('awaits Mongo indexes and can retry a failed initialisation', async () => {
    const createIndex = vi.fn().mockRejectedValueOnce(new Error('index unavailable')).mockResolvedValue('index')
    const updateOne = vi.fn().mockResolvedValue({})
    const store = new MongoAttestationStorage({ collection: () => ({ createIndex, updateOne }) } as unknown as Db)
    await expect(store.insert(record(1))).rejects.toThrow('index unavailable')
    expect(updateOne).not.toHaveBeenCalled()
    await store.insert(record(1))
    expect(updateOne).toHaveBeenCalledWith(outpoint(1), { $setOnInsert: record(1) }, { upsert: true })
  })
})
