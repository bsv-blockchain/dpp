import { beforeEach, describe, expect, it } from 'vitest'
import { LockingScript, PrivateKey, ProtoWallet } from '@bsv/sdk'
import { didKeyFromIdentityKey, uoraAnchorFields } from '../src/uoraAnchor.js'
import { UoraAnchorLookupService, UORA_SERVICE, UORA_TOPIC } from '../src/lsUoraDpp.js'
import { InMemoryUoraAnchorStorage, MAX_ANCHOR_RESULTS } from '../src/anchorStorage.js'
import { writeUoraAnchor } from './writeAnchor.js'
import { ANCHOR_V3_FIXTURE as F } from './anchor-v3-fixture.js'

/**
 * `ls_uora_dpp`: the DID-keyed lookup.
 *
 * The question that justifies the format is the first `describe`: given a
 * party's `did:key` and nothing else, what has that party attested. No index
 * over v1 anchors can answer it, because a v1 anchor names no issuer.
 */

const servicePriv = PrivateKey.fromHex('77'.repeat(32))
const SERVICE_KEY = servicePriv.toPublicKey().toString()
const serviceWallet = new ProtoWallet(servicePriv)

const MAKER = didKeyFromIdentityKey(PrivateKey.fromHex('88'.repeat(32)).toPublicKey().toString())
const RECYCLER = didKeyFromIdentityKey(PrivateKey.fromHex('89'.repeat(32)).toPublicKey().toString())

const CELL = 'https://id.gs1.org/01/09506000134352/21/CELL-1'
const JACKET = 'https://id.gs1.org/01/09506000134352/21/JACKET-1'

interface Written {
  attestationId: string
  issuer: string
  subject: string
  uoraType: string
  digest: string
  anchoredBy: string
}

async function admit(
  service: UoraAnchorLookupService,
  written: Written,
  txid = written.attestationId.padStart(64, '0')
): Promise<void> {
  const lockingScript: LockingScript = await writeUoraAnchor(
    serviceWallet,
    uoraAnchorFields(written),
    written.attestationId
  )
  await service.outputAdmittedByTopic({
    mode: 'locking-script',
    topic: UORA_TOPIC,
    txid,
    outputIndex: 0,
    satoshis: 1,
    lockingScript,
  })
}

function claim(overrides: Partial<Written> = {}): Written {
  return {
    attestationId: 'att-1',
    issuer: MAKER,
    subject: CELL,
    uoraType: 'Origin',
    digest: 'a'.repeat(64),
    anchoredBy: SERVICE_KEY,
    ...overrides,
  }
}

let storage: InMemoryUoraAnchorStorage
let service: UoraAnchorLookupService

beforeEach(async () => {
  storage = new InMemoryUoraAnchorStorage()
  service = new UoraAnchorLookupService(storage)
  await admit(service, claim({ attestationId: 'att-1', issuer: MAKER, subject: CELL, uoraType: 'Origin' }))
  await admit(service, claim({ attestationId: 'att-2', issuer: MAKER, subject: JACKET, uoraType: 'Origin' }))
  await admit(service, claim({ attestationId: 'att-3', issuer: RECYCLER, subject: CELL, uoraType: 'Recycling' }))
})

const ask = async (query: unknown): Promise<string[]> => {
  const formula = await service.lookup({ service: UORA_SERVICE, query })
  return (formula as Array<{ txid: string }>).map((entry) => entry.txid)
}

describe('keyed on the issuer DID', () => {
  it('answers what one party has attested, across subjects', async () => {
    const answers = await ask({ issuer: MAKER })
    expect(answers).toHaveLength(2)
    expect(answers).toEqual([
      'att-1'.padStart(64, '0'),
      'att-2'.padStart(64, '0'),
    ])
  })

  it('answers the same question keyed on the raw identity key', async () => {
    // A caller holding a chain key rather than a DID should not have to encode
    // one to ask, and the two must not diverge.
    const key = PrivateKey.fromHex('89'.repeat(32)).toPublicKey().toString()
    expect(await ask({ issuerKey: key })).toEqual(await ask({ issuer: RECYCLER }))
  })

  it('does not confuse two parties', async () => {
    expect(await ask({ issuer: RECYCLER })).toEqual(['att-3'.padStart(64, '0')])
  })
})

describe('the other selectors', () => {
  it('finds every claim about one passport, whoever made it', async () => {
    expect(await ask({ subject: CELL })).toHaveLength(2)
  })

  it('finds the anchor for one known attestation', async () => {
    expect(await ask({ attestationId: 'att-2' })).toEqual(['att-2'.padStart(64, '0')])
  })

  it('answers "has anyone anchored exactly this" from a digest in hand', async () => {
    await admit(service, claim({ attestationId: 'att-4', digest: 'b'.repeat(64) }), 'd'.repeat(64))
    expect(await ask({ digest: 'b'.repeat(64) })).toEqual(['d'.repeat(64)])
  })

  it('narrows by type but refuses to select on it', async () => {
    expect(await ask({ subject: CELL, uoraType: 'Recycling' })).toEqual([
      'att-3'.padStart(64, '0'),
    ])
    // Every anchor of a common type is a table scan wearing a query.
    await expect(service.lookup({ service: UORA_SERVICE, query: { uoraType: 'Origin' } })).rejects.toThrow(
      /issuer, issuerKey, subject, attestationId, digest or anchoredBy/
    )
  })

  it('refuses an empty query and a missing one', async () => {
    await expect(service.lookup({ service: UORA_SERVICE, query: {} })).rejects.toThrow()
    await expect(
      service.lookup({ service: UORA_SERVICE, query: undefined as unknown as object })
    ).rejects.toThrow()
  })

  it('refuses an operator-shaped selector instead of widening the answer', async () => {
    // The storage layer drops a non-string field, so before this guard a
    // query like this one answered as a capped scan of every anchor.
    await expect(
      service.lookup({ service: UORA_SERVICE, query: { issuer: { $ne: '' } } as unknown as object })
    ).rejects.toThrow(/issuer must be a string/)
    // A string selector beside it does not rescue the query: the caller asked
    // a narrower question than the one the store would have answered.
    await expect(
      service.lookup({
        service: UORA_SERVICE,
        query: { issuer: { $ne: '' }, subject: CELL } as unknown as object,
      })
    ).rejects.toThrow(/issuer must be a string/)
  })

  it('refuses a question addressed to another service', async () => {
    await expect(
      service.lookup({ service: 'ls_dpp', query: { issuer: MAKER } })
    ).rejects.toThrow(/Unsupported service/)
  })

  it('returns nothing for a party who has attested nothing', async () => {
    const nobody = didKeyFromIdentityKey(
      PrivateKey.fromHex('90'.repeat(32)).toPublicKey().toString()
    )
    expect(await ask({ issuer: nobody })).toEqual([])
  })
})

describe('bounds', () => {
  it('caps the answer whatever the caller asks for', async () => {
    for (let n = 0; n < 12; n++) {
      await admit(
        service,
        claim({ attestationId: `bulk-${n}`, issuer: RECYCLER }),
        `${n}`.padStart(64, 'f')
      )
    }
    expect(await ask({ issuer: RECYCLER, limit: 5 })).toHaveLength(5)
    expect(await ask({ issuer: RECYCLER, limit: 100_000 })).toHaveLength(13)
    expect(MAX_ANCHOR_RESULTS).toBeLessThanOrEqual(1000)
  })
})

describe('the index tracks the chain', () => {
  it('indexes nothing from a topic it does not serve', async () => {
    const other = new UoraAnchorLookupService(new InMemoryUoraAnchorStorage())
    const lockingScript = await writeUoraAnchor(serviceWallet, uoraAnchorFields(claim()), 'att-1')
    await other.outputAdmittedByTopic({
      mode: 'locking-script',
      topic: 'tm_dpp',
      txid: 'a'.repeat(64),
      outputIndex: 0,
      satoshis: 1,
      lockingScript,
    })
    await expect(
      other.lookup({ service: UORA_SERVICE, query: { issuer: MAKER } })
    ).resolves.toEqual([])
  })

  it('drops an evicted output', async () => {
    await service.outputEvicted('att-1'.padStart(64, '0'), 0)
    expect(await ask({ issuer: MAKER })).toEqual(['att-2'.padStart(64, '0')])
  })

  it('keeps an anchor that gets spent, because the claim is unaffected', async () => {
    // An anchor is a leaf and should never be spent. If one is, the digest
    // still sat at that point in the chain's order, so the record stays.
    await service.outputSpent({
      mode: 'txid',
      topic: UORA_TOPIC,
      txid: 'att-1'.padStart(64, '0'),
      outputIndex: 0,
      spendingTxid: 'c'.repeat(64),
    })
    expect(await ask({ issuer: MAKER })).toHaveLength(2)
  })
})

describe('the boundary between the subject and the type', () => {
  /*
   * The index is keyed on the subject, so a re-cut anchor is the one forgery
   * that would do real damage here: it would file a genuine digest under a
   * subject nobody signed, and every later query on that subject would return
   * it as though it were a claim about that product.
   *
   * The topic manager refuses these before they arrive, and this service checks
   * again rather than trusting that, because an index that half-reads an output
   * is worse than one that skips it.
   */
  let clean: UoraAnchorLookupService

  beforeEach(() => {
    clean = new UoraAnchorLookupService(new InMemoryUoraAnchorStorage())
  })

  const admitRaw = async (target: UoraAnchorLookupService, hex: string, txid: string) => {
    await target.outputAdmittedByTopic({
      mode: 'locking-script',
      topic: UORA_TOPIC,
      txid,
      outputIndex: 0,
      satoshis: 1,
      lockingScript: LockingScript.fromHex(hex),
    })
  }

  it('indexes none of them', async () => {
    expect(F.boundaryShifted.length).toBeGreaterThan(0)
    for (const [n, hex] of F.boundaryShifted.entries()) {
      await admitRaw(clean, hex, `${n}`.padStart(64, 'e'))
    }
    await expect(
      clean.lookup({ service: UORA_SERVICE, query: { subject: F.subject } })
    ).resolves.toEqual([])
    await expect(
      clean.lookup({ service: UORA_SERVICE, query: { digest: F.digest } })
    ).resolves.toEqual([])
  })

  it('indexes the genuine anchor, so the check is not simply refusing everything', async () => {
    const txid = 'a'.repeat(64)
    await admitRaw(clean, F.lockingScript, txid)
    await expect(
      clean.lookup({ service: UORA_SERVICE, query: { subject: F.subject } })
    ).resolves.toEqual([{ txid, outputIndex: 0 }])
  })
})

describe('what the service tells the network about itself', () => {
  it('names itself and the key it is indexed on', async () => {
    expect(await service.getMetaData()).toMatchObject({ name: UORA_SERVICE })
    const docs = await service.getDocumentation()
    expect(docs).toContain('did:key')
    expect(docs).toContain('issuer')
  })

  it('says what the indexed fields are worth, rather than leaving it implied', async () => {
    // A consumer reading this over the wire is deciding whether to trust the
    // subject it queried on. The answer is that the anchoring service signed it
    // at the boundary it is read at, which is a narrower claim than "signed"
    // and the one v2 could not make.
    const docs = await service.getDocumentation()
    expect(docs).toContain('behind its length')
    expect(docs).toContain('uora-anchor-v2')
  })
})
