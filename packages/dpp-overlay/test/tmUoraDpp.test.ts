import { describe, expect, it, vi } from 'vitest'
import { LockingScript, PrivateKey, ProtoWallet, PushDrop, Transaction, Utils } from '@bsv/sdk'
import {
  didKeyFromIdentityKey,
  uoraAnchorFields,
  UORA_ANCHOR_PROTOCOL,
} from '../src/uoraAnchor.js'
import { UoraAnchorTopicManager } from '../src/tmUoraDpp.js'
import { writeUoraAnchor } from './writeAnchor.js'
import { ANCHOR_V3_FIXTURE as F } from './anchor-v3-fixture.js'

/**
 * `tm_uora_dpp` admission.
 *
 * The rules the format itself enforces are covered in `uoraAnchor.test.ts`;
 * what is under test here is the policy on top of them, which is the part a
 * deployment gets to choose: whose anchors this instance carries. The one
 * exception is `the superseded v2 layout`, which is a policy question and not a
 * format one, because a v2 anchor is well-formed under v2's own rules and this
 * topic refuses it anyway.
 */

const servicePriv = PrivateKey.fromHex('77'.repeat(32))
const SERVICE_KEY = servicePriv.toPublicKey().toString()
const serviceWallet = new ProtoWallet(servicePriv)

const strangerPriv = PrivateKey.fromHex('66'.repeat(32))
const STRANGER_KEY = strangerPriv.toPublicKey().toString()
const strangerWallet = new ProtoWallet(strangerPriv)

const ISSUER_DID = didKeyFromIdentityKey(
  PrivateKey.fromHex('88'.repeat(32)).toPublicKey().toString()
)
const SUBJECT = 'https://id.gs1.org/01/09506000134352/21/B59E82284DEE'

/**
 * The v2 output this topic used to admit, kept as a literal now that its
 * fixture is gone. Written by the fixture treasury and correctly signed under
 * v2's rules, so refusing it is a decision rather than a parse failure.
 */
const SUPERSEDED_V2_SCRIPT =
  '21029def2a5ef74efdaf33064367fceaeed5043ddaef4c4813d1d73aeaf1a7196f32ac0e756f72612d616e63686f722d763240653466363633623765383761343062363031373136653837336132646563336133376236613435626430633835353763623235333130616234653733366431313c68747470733a2f2f69642e6773312e6f72672f30312f30393530363030303133343335322f32312f4235394538323238344445452f73746174652d31396469643a6b65793a7a513373684e75326f465462657165785965756e4433366d793361514e71455771386d57443241435271514c456970637a3468747470733a2f2f69642e6773312e6f72672f30312f30393530363030303133343335322f32312f423539453832323834444545064f726967696e4230333739363264343562333865386263663832666138656661383433326130316632306339613533653234633764336631316466313937636238653730393236646146304402203aacc206ccc456e14e39a6850e4087af0d68ac19ec88f20a8998fb22f1212d0d02204e05fd4937c9489d8aca6b9542bc31606d54843a5257d89f255dc428cfedc2736d6d6d6d'

async function anchorScript(
  attestationId: string,
  wallet = serviceWallet,
  overrides: {
    digest?: string
    issuer?: string
    subject?: string
    uoraType?: string
    anchoredBy?: string
  } = {}
): Promise<LockingScript> {
  const fields = uoraAnchorFields({
    digest: overrides.digest ?? 'a'.repeat(64),
    attestationId,
    issuer: overrides.issuer ?? ISSUER_DID,
    subject: overrides.subject ?? SUBJECT,
    uoraType: overrides.uoraType ?? 'Origin',
    // Field 6 names whoever is about to lock this, because the reader checks
    // that the locking key derives from it.
    anchoredBy: overrides.anchoredBy ?? (wallet === serviceWallet ? SERVICE_KEY : STRANGER_KEY),
  })
  return await writeUoraAnchor(wallet, fields, attestationId)
}

function txWith(...scripts: LockingScript[]): number[] {
  const tx = new Transaction()
  for (const lockingScript of scripts) tx.addOutput({ satoshis: 1, lockingScript })
  return tx.toBEEF(true)
}

/** A plain output that is not an anchor, to sit beside one. */
function change(): LockingScript {
  return LockingScript.fromASM('OP_DUP OP_HASH160 ' + '11'.repeat(20) + ' OP_EQUALVERIFY OP_CHECKSIG')
}

describe('admission with named anchoring services', () => {
  const manager = new UoraAnchorTopicManager([SERVICE_KEY])

  it('admits an anchor written by a named service', async () => {
    const result = await manager.identifyAdmissibleOutputs(txWith(await anchorScript('att-1')))
    expect(result).toEqual({ outputsToAdmit: [0], coinsToRetain: [] })
  })

  it('refuses a well-formed anchor written by somebody else', async () => {
    // The check v1 could not perform. The output below is structurally
    // perfect: it parses, its seven fields are sealed by the key that locks it,
    // and it names a real issuer. It is simply not ours, and this instance can
    // say so because counterparty `anyone` makes the derivation reproducible.
    const script = await anchorScript('att-1', strangerWallet)
    const result = await manager.identifyAdmissibleOutputs(txWith(script))
    expect(result).toEqual({ outputsToAdmit: [], coinsToRetain: [] })
  })

  it('admits either of two named services', async () => {
    const both = new UoraAnchorTopicManager([SERVICE_KEY, STRANGER_KEY])
    expect(
      await both.identifyAdmissibleOutputs(txWith(await anchorScript('att-1', strangerWallet)))
    ).toEqual({ outputsToAdmit: [0], coinsToRetain: [] })
  })

  it('refuses an anchor whose key id is not the attestation id it carries', async () => {
    // Locked correctly, by us, but under a different key id, so the derivation
    // a verifier runs from the attestation id in field 2 lands elsewhere. An
    // anchor nobody can attribute from its own contents is not admissible.
    const fields = uoraAnchorFields({
      digest: 'a'.repeat(64),
      attestationId: 'att-1',
      issuer: ISSUER_DID,
      subject: SUBJECT,
      uoraType: 'Origin',
      anchoredBy: SERVICE_KEY,
    })
    const script = await writeUoraAnchor(serviceWallet, fields, 'att-somethingelse')
    expect(await manager.identifyAdmissibleOutputs(txWith(script))).toEqual({
      outputsToAdmit: [],
      coinsToRetain: [],
    })
  })

  it('survives an unreadable configured key without losing a good one', async () => {
    const messy = new UoraAnchorTopicManager(['not-a-public-key', SERVICE_KEY])
    expect(await messy.identifyAdmissibleOutputs(txWith(await anchorScript('att-1')))).toEqual({
      outputsToAdmit: [0],
      coinsToRetain: [],
    })
  })
})

describe('admission with no named service', () => {
  const open = new UoraAnchorTopicManager()

  it('admits any well-formed anchor, which is why the node warns about it', async () => {
    expect(
      await open.identifyAdmissibleOutputs(txWith(await anchorScript('att-1', strangerWallet)))
    ).toEqual({ outputsToAdmit: [0], coinsToRetain: [] })
  })

  it('still refuses something that is not the format', async () => {
    const v1 = await writeUoraAnchor(
      serviceWallet,
      [
        Utils.toArray('uora-anchor-v1', 'utf8'),
        Utils.toArray('a'.repeat(64), 'utf8'),
        Utils.toArray('att-1', 'utf8'),
      ],
      'att-1'
    )
    expect(await open.identifyAdmissibleOutputs(txWith(v1))).toEqual({
      outputsToAdmit: [],
      coinsToRetain: [],
    })
  })
})

describe('the superseded v2 layout', () => {
  /*
   * v2 is refused, and by an instance configured to carry the very treasury
   * that wrote it. That is the shape of the decision: not "we do not know this
   * output" but "we know exactly what this is and will not index it", because a
   * v2 signature leaves the boundary between the subject and the type unsigned
   * and any holder can re-cut it.
   *
   * `outputsToAdmit: []` is all a `TopicManager` can say back, so the refusal
   * is also written to the node's console. A submitter that cares whether its
   * anchor landed still has to read the admitted list, since the HTTP status of
   * a submission says only that the node parsed the BEEF.
   */
  it('is refused even by the instance that carries its treasury', async () => {
    const manager = new UoraAnchorTopicManager([F.anchoredBy])
    const beef = txWith(LockingScript.fromHex(SUPERSEDED_V2_SCRIPT))
    expect(await manager.identifyAdmissibleOutputs(beef)).toEqual({
      outputsToAdmit: [],
      coinsToRetain: [],
    })
  })

  it('is refused out loud, so an empty list is not the only sign of it', async () => {
    // The point of the warning. A treasury still writing v2 gets a 200 and an
    // empty admitted list, which is byte for byte what it gets for a
    // transaction carrying no anchors at all. The console is the only place
    // this topic can say which of the two happened.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const manager = new UoraAnchorTopicManager([F.anchoredBy])
      await manager.identifyAdmissibleOutputs(
        txWith(change(), LockingScript.fromHex(SUPERSEDED_V2_SCRIPT))
      )
      expect(warn).toHaveBeenCalledTimes(1)
      const said = warn.mock.calls[0][0] as string
      expect(said).toContain('refused output 1')
      expect(said).toContain('uora-anchor-v2')
      expect(said).toContain('uora-anchor-v3')
    } finally {
      warn.mockRestore()
    }
  })

  it('says nothing about an output that was never an anchor', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const manager = new UoraAnchorTopicManager([F.anchoredBy])
      await manager.identifyAdmissibleOutputs(
        txWith(change(), LockingScript.fromHex(F.lockingScript))
      )
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('is refused by an instance that narrows to nobody in particular', async () => {
    const open = new UoraAnchorTopicManager()
    const beef = txWith(LockingScript.fromHex(SUPERSEDED_V2_SCRIPT))
    expect(await open.identifyAdmissibleOutputs(beef)).toEqual({
      outputsToAdmit: [],
      coinsToRetain: [],
    })
  })

  it('does not take a v3 anchor down with it when the two share a transaction', async () => {
    // The failure mode worth ruling out: a batch carrying one superseded anchor
    // must lose that one and keep the rest, not be dropped whole.
    const manager = new UoraAnchorTopicManager([F.anchoredBy])
    const beef = txWith(
      LockingScript.fromHex(SUPERSEDED_V2_SCRIPT),
      LockingScript.fromHex(F.lockingScript)
    )
    expect(await manager.identifyAdmissibleOutputs(beef)).toEqual({
      outputsToAdmit: [1],
      coinsToRetain: [],
    })
  })

  it('signs the v2 way and is refused under the v3 prefix too', async () => {
    // Not the old prefix, this time: seven correct v3 fields, correct protocol,
    // correct counterparty, and `PushDrop.lock`'s own signature over the fields
    // run together. The prefix is not what is being checked here, the preimage
    // is.
    const script = await new PushDrop(serviceWallet).lock(
      uoraAnchorFields({
        digest: 'a'.repeat(64),
        attestationId: 'att-1',
        issuer: ISSUER_DID,
        subject: SUBJECT,
        uoraType: 'Origin',
        anchoredBy: SERVICE_KEY,
      }),
      UORA_ANCHOR_PROTOCOL,
      'att-1',
      'anyone',
      true
    )
    const manager = new UoraAnchorTopicManager([SERVICE_KEY])
    expect(await manager.identifyAdmissibleOutputs(txWith(script))).toEqual({
      outputsToAdmit: [],
      coinsToRetain: [],
    })
  })
})

describe('shape of the answer', () => {
  const manager = new UoraAnchorTopicManager([SERVICE_KEY])

  it('admits every anchor in a transaction, so anchors can be batched', async () => {
    // Unlike tm_dpp, which insists on exactly one output because a second
    // passport state would make the tip ambiguous. Anchors are leaves and have
    // no such relation, and one transaction per attestation does not scale to a
    // fleet.
    const beef = txWith(
      await anchorScript('att-1'),
      await anchorScript('att-2'),
      await anchorScript('att-3')
    )
    expect(await manager.identifyAdmissibleOutputs(beef)).toEqual({
      outputsToAdmit: [0, 1, 2],
      coinsToRetain: [],
    })
  })

  it('picks the anchors out from among ordinary outputs', async () => {
    const beef = txWith(change(), await anchorScript('att-1'), change(), await anchorScript('att-2'))
    expect(await manager.identifyAdmissibleOutputs(beef)).toEqual({
      outputsToAdmit: [1, 3],
      coinsToRetain: [],
    })
  })

  it('never retains, because an anchor is never spent', async () => {
    const result = await manager.identifyAdmissibleOutputs(txWith(await anchorScript('att-1')))
    expect(result.coinsToRetain).toEqual([])
  })

  it('admits nothing from bytes that are not a transaction', async () => {
    expect(await manager.identifyAdmissibleOutputs([1, 2, 3])).toEqual({
      outputsToAdmit: [],
      coinsToRetain: [],
    })
  })
})

describe('an anchor the resolver actually wrote', () => {
  it('is admitted, naming the resolver as the anchoring service', async () => {
    // End to end across the two repositories, without either importing the
    // other: the anchoring service writes this hex and asserts it in its own suite, and
    // this instance admits it because the locking key derives from the service
    // key it was configured with. That pair of assertions is the rail.
    const manager = new UoraAnchorTopicManager([F.anchoredBy])
    const beef = txWith(LockingScript.fromHex(F.lockingScript))
    expect(await manager.identifyAdmissibleOutputs(beef)).toEqual({
      outputsToAdmit: [0],
      coinsToRetain: [],
    })
  })

  it('is refused by an instance that carries somebody else', async () => {
    const manager = new UoraAnchorTopicManager([STRANGER_KEY])
    const beef = txWith(LockingScript.fromHex(F.lockingScript))
    expect(await manager.identifyAdmissibleOutputs(beef)).toEqual({
      outputsToAdmit: [],
      coinsToRetain: [],
    })
  })
})

describe('the boundary between the subject and the type', () => {
  /*
   * The same forgeries `uoraAnchor.test.ts` refuses, asked of the topic rather
   * than the parser, because the topic is what a stranger can reach. Each entry
   * is the pinned output with that one boundary re-cut and the signature copied
   * across untouched, and the instance below is configured to carry the exact
   * treasury the output names, so nothing but the preimage stands between these
   * bytes and the index.
   */
  const manager = new UoraAnchorTopicManager([F.anchoredBy])

  it('admits none of them', async () => {
    expect(F.boundaryShifted.length).toBeGreaterThan(0)
    for (const hex of F.boundaryShifted) {
      const beef = txWith(LockingScript.fromHex(hex))
      expect(await manager.identifyAdmissibleOutputs(beef)).toEqual({
        outputsToAdmit: [],
        coinsToRetain: [],
      })
    }
  })

  it('admits none of them even when they sit beside a genuine anchor', async () => {
    const beef = txWith(
      LockingScript.fromHex(F.boundaryShifted[0]),
      LockingScript.fromHex(F.lockingScript),
      LockingScript.fromHex(F.boundaryShifted[1])
    )
    expect(await manager.identifyAdmissibleOutputs(beef)).toEqual({
      outputsToAdmit: [1],
      coinsToRetain: [],
    })
  })

  it('still admits the genuine anchor, so the check is not simply refusing everything', async () => {
    const beef = txWith(LockingScript.fromHex(F.lockingScript))
    expect(await manager.identifyAdmissibleOutputs(beef)).toEqual({
      outputsToAdmit: [0],
      coinsToRetain: [],
    })
  })
})

describe('what the topic tells the network about itself', () => {
  it('names itself and its format', async () => {
    const manager = new UoraAnchorTopicManager([SERVICE_KEY])
    expect(await manager.getMetaData()).toMatchObject({ name: 'tm_uora_dpp' })
    const docs = await manager.getDocumentation()
    expect(docs).toContain('uora-anchor-v3')
    expect(docs).toContain('did:key')
  })

  it('says what the signature covers, and says v2 is not admitted', async () => {
    // The documentation goes over the wire to consumers who cannot read this
    // package, so it has to be exact about what a passing signature means: the
    // fields at the boundaries they are read at, not merely the bytes.
    const docs = await new UoraAnchorTopicManager().getDocumentation()
    expect(docs).toContain('length')
    expect(docs).toMatch(/uora-anchor-v2 is superseded and is not admitted/)
  })
})
