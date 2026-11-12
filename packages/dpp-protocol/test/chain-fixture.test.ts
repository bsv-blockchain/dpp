import { describe, expect, it } from 'vitest'
import { ProtoWallet, PublicKey, Spend, Transaction, Utils } from '@bsv/sdk'
import {
  completeState,
  ownerKeyFromDeriver,
  ownerLinkageFromDeriver,
  verifyChain,
  verifyOwnerLinkage,
  type DppStateData,
} from '../src/index.js'
import {
  PASSPORT_ID,
  makerPriv,
  owner1Deriver,
  owner1Priv,
  owner2Priv,
  owner3Deriver,
  owner3Priv,
  serverPriv,
  spendAsOwner,
  stateTx,
} from './helpers.js'
import { CHAIN_V1_FIXTURE as F } from './chain-v1-fixture.js'

/**
 * The seven refusals of the owner-signed transfer (`owner-consent@1`), as the
 * chain fixture carried them until the option was removed from the standard
 * on 12 November 2026. Each extends a prefix of the valid chain, and each is
 * held here to be a valid chain under the record model alone, which is what a
 * reader now finds.
 */
const REMOVED_OWNER_CONSENT_REFUSALS: Array<{ name: string; description: string; appendAfter: number; rawTx: string; error: string; acceptedUnder?: { authorities: string[] } }> = [
  {
    name: "transferByStranger",
    description:
      "A TRANSFER spending state 5 (owner: owner 3's derived key) made by owner 2, who no longer owns it, with empty event_data. Under the owner-signed transfer neither equality nor linkage holds; without the option the state is a valid TRANSFER, which is the whole reason the option exists.",
    appendAfter: 4,
    rawTx:
      "0100000001cca7ef4ee428b2940f5415ba8bf7aca8f7ecf3d583020fd8055d886adecd4fe20000000000ffffffff010100000000000000fd030221034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aaac0364707001313268747470733a2f2f69642e6773312e6f72672f30312f30393530363030303133343335322f32312f4a45525345592d303031085452414e5346455214323032372d31302d30315430383a30303a30305a21032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e66868099121032c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e6686809910c6f776e65723220616761696e004c5e7b226e616d65223a22436c7562204a65727365792032303236222c22666962726573223a7b22706f6c796573746572223a38322c22636f74746f6e223a31387d2c226461746143617272696572223a224558542d5549442d30303031227d2063d987d1c6d69751c17297f410f5b3547a65d096a8993b35bcb4f9cad054f17620e24fcdde6a885d05d80f0283d5f3ecf7a8acf78bba15540f94b228e44eefa7cc463044022069012ffd4d56bd79dd04902c88788527fb29efc206de6835f503886736da31ef022002e0f4ade1cebf1cd215821c3e20efb65e815828cf29ee559c74dc48edf378a9463044022025de3ff6069a40f7326fcdbf84f0fc4b9c9496509f28096078b37fe40a0e97f40220305752b0dcabd2545d57a5435c4e8f6745403c7bd4b30f3523ab7dbc1f5192226d6d6d6d6d6d6d00000000",
    error: "TRANSFER actor is not the previous owner and event_data carries no owner_linkage",
  },
  {
    name: "transferByFormerOwner",
    description:
      "A TRANSFER spending state 4 (owner: owner 2's identity key) made by owner 1, the previous owner, with no linkage. The equality form compares against the previous state's owner, never an earlier one.",
    appendAfter: 3,
    rawTx:
      "0100000001460bee716d3cb569d498e84ba5349173682206a9aeaf853832c9f54def901ba30000000000ffffffff010100000000000000fd040221034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aaac0364707001313268747470733a2f2f69642e6773312e6f72672f30312f30393530363030303133343335322f32312f4a45525345592d303031085452414e5346455214323032372d30362d30325430383a30303a30305a21023c72addb4fdf09af94f0c94d7fe92a386a7e70cf8a1d85916386bb2535c7b1b121023c72addb4fdf09af94f0c94d7fe92a386a7e70cf8a1d85916386bb2535c7b1b10c6f776e65723120616761696e004c5e7b226e616d65223a22436c7562204a65727365792032303236222c22666962726573223a7b22706f6c796573746572223a38322c22636f74746f6e223a31387d2c226461746143617272696572223a224558542d5549442d30303031227d2063d987d1c6d69751c17297f410f5b3547a65d096a8993b35bcb4f9cad054f17620a31b90ef4df5c9323885afaea9062268739134a54be898d469b53c6d71ee0b464730450221008a9bbe382fe0d3509ad5a2200ed559d4959cde57b9c249bbaffab426a14eee2902205b71d9d84e7d9118f71fedcabfa07b6acdf4fd1f3c45432880aba18d9d7b8f574630440220099b4d0a40922a0502301c7137d323b4d9784c7037b179597d498a79af87b41602206795abe685c247daa0c2c8f25283dc2b965657226319205aa52da49e97a1dd466d6d6d6d6d6d6d00000000",
    error: "TRANSFER actor is not the previous owner and event_data carries no owner_linkage",
  },
  {
    name: "wrongOwnerLinkage",
    description:
      "Owner 3 acting under the right root, but event_data carries owner 2's scalar for this passport: well-formed, and reaching a different key. Refused at the point addition.",
    appendAfter: 4,
    rawTx:
      "0100000001cca7ef4ee428b2940f5415ba8bf7aca8f7ecf3d583020fd8055d886adecd4fe20000000000ffffffff010100000000000000fd5e0221034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aaac0364707001313268747470733a2f2f69642e6773312e6f72672f30312f30393530363030303133343335322f32312f4a45525345592d303031085452414e5346455214323032372d31302d30325430383a30303a30305a2103f391b2c124cb417a201a2134907cfae2a77d425e463a9a74ca9939d9506f906e21029ac20335eb38768d2052be1dbbc3c8f6178407458e51e6b4ad22f1d91758895b106f776e6572207472616e7366657220334c547b226f776e65725f6c696e6b616765223a2232316165343336666231306164373234353462646233656538343861303530373530373532663232646264343335663436306232313166653462363634613139227d4c5e7b226e616d65223a22436c7562204a65727365792032303236222c22666962726573223a7b22706f6c796573746572223a38322c22636f74746f6e223a31387d2c226461746143617272696572223a224558542d5549442d30303031227d2063d987d1c6d69751c17297f410f5b3547a65d096a8993b35bcb4f9cad054f17620e24fcdde6a885d05d80f0283d5f3ecf7a8acf78bba15540f94b228e44eefa7cc473045022100b9be9f986b5d8a29ed9749dd5b8405e27273b4dbb72290189754f90270ec94d402205ba0daec1f8cc2f5907ae5468035b063101f4895dcb9cdd867a284a25e587884473045022100facf39f5cdd1e107b60c3b938988c5e49e1609c1f9b81acd98564776c3be46db0220710bea4721cffaaa6ca5c73cfcab8eadb0695475d1af3fd69f7db4b3daac1b8f6d6d6d6d6d6d6d00000000",
    error: "owner_linkage does not link actor_identity_key to the previous owner_identity_key",
  },
  {
    name: "ownerLinkageUpperCase",
    description:
      "The correct scalar spelled in upper-case hex. One value has one spelling; refused before any arithmetic.",
    appendAfter: 4,
    rawTx:
      "0100000001cca7ef4ee428b2940f5415ba8bf7aca8f7ecf3d583020fd8055d886adecd4fe20000000000ffffffff010100000000000000fd5d0221034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aaac0364707001313268747470733a2f2f69642e6773312e6f72672f30312f30393530363030303133343335322f32312f4a45525345592d303031085452414e5346455214323032372d31302d30335430383a30303a30305a2103f391b2c124cb417a201a2134907cfae2a77d425e463a9a74ca9939d9506f906e21029ac20335eb38768d2052be1dbbc3c8f6178407458e51e6b4ad22f1d91758895b106f776e6572207472616e7366657220334c547b226f776e65725f6c696e6b616765223a2242303533394131464435313931423734333835334446443045353331463143334546393434433634363432384437313035323939444243363844423743354338227d4c5e7b226e616d65223a22436c7562204a65727365792032303236222c22666962726573223a7b22706f6c796573746572223a38322c22636f74746f6e223a31387d2c226461746143617272696572223a224558542d5549442d30303031227d2063d987d1c6d69751c17297f410f5b3547a65d096a8993b35bcb4f9cad054f17620e24fcdde6a885d05d80f0283d5f3ecf7a8acf78bba15540f94b228e44eefa7cc4730450221008561a475b559b684b6a2fb8dd752307b63e720307e4f7aba6c57b69bb82ce1700220774d6232e9f4fdda4540cc3537eec7b2ee5cf341e4ca3cb81a2464d63529295246304402201062c70811bf2f96a6f03487e1b9f874ca6a974d1cc26b17620615e94e8651e60220546d0288a682219cb1d8334f9c6968a3813ab78933d92310c487633730dd47c86d6d6d6d6d6d6d00000000",
    error: "owner_linkage must be 64 lower-case hex characters",
  },
  {
    name: "ownerLinkageShort",
    description:
      "The correct scalar missing its last character: 63 hex characters. Refused as malformed, not tried as a number.",
    appendAfter: 4,
    rawTx:
      "0100000001cca7ef4ee428b2940f5415ba8bf7aca8f7ecf3d583020fd8055d886adecd4fe20000000000ffffffff010100000000000000fd5d0221034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aaac0364707001313268747470733a2f2f69642e6773312e6f72672f30312f30393530363030303133343335322f32312f4a45525345592d303031085452414e5346455214323032372d31302d30345430383a30303a30305a2103f391b2c124cb417a201a2134907cfae2a77d425e463a9a74ca9939d9506f906e21029ac20335eb38768d2052be1dbbc3c8f6178407458e51e6b4ad22f1d91758895b106f776e6572207472616e7366657220334c537b226f776e65725f6c696e6b616765223a22623035333961316664353139316237343338353364666430653533316631633365663934346336343634323864373130353239396462633638646237633563227d4c5e7b226e616d65223a22436c7562204a65727365792032303236222c22666962726573223a7b22706f6c796573746572223a38322c22636f74746f6e223a31387d2c226461746143617272696572223a224558542d5549442d30303031227d2063d987d1c6d69751c17297f410f5b3547a65d096a8993b35bcb4f9cad054f17620e24fcdde6a885d05d80f0283d5f3ecf7a8acf78bba15540f94b228e44eefa7cc4730450221008204ed3dcacf64df9b89143ef7c8c460af7ee12ee96a49f40c1e3de58b41e8e702205467e82c4d1ce68a2a2bd3d5c8e5e7f0cab26194ad67d11eb9b4a75c61953630473045022100bc453b8bff50570d349169dde25acd69c008deec9e07b38f703e48bd629ffb76022021c65eb6534fb0c9f26c1e2d4f5580cf5824c309092a0f4e3e8e2f69a68e0a8a6d6d6d6d6d6d6d00000000",
    error: "owner_linkage must be 64 lower-case hex characters",
  },
  {
    name: "ownerLinkageNotObject",
    description:
      "event_data is a JSON array holding the correct scalar. Valid JSON, not an object, so there is no owner_linkage property to read.",
    appendAfter: 4,
    rawTx:
      "0100000001cca7ef4ee428b2940f5415ba8bf7aca8f7ecf3d583020fd8055d886adecd4fe20000000000ffffffff010100000000000000fd4b0221034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aaac0364707001313268747470733a2f2f69642e6773312e6f72672f30312f30393530363030303133343335322f32312f4a45525345592d303031085452414e5346455214323032372d31302d30355430383a30303a30305a2103f391b2c124cb417a201a2134907cfae2a77d425e463a9a74ca9939d9506f906e21029ac20335eb38768d2052be1dbbc3c8f6178407458e51e6b4ad22f1d91758895b106f776e6572207472616e736665722033445b2262303533396131666435313931623734333835336466643065353331663163336566393434633634363432386437313035323939646263363864623763356338225d4c5e7b226e616d65223a22436c7562204a65727365792032303236222c22666962726573223a7b22706f6c796573746572223a38322c22636f74746f6e223a31387d2c226461746143617272696572223a224558542d5549442d30303031227d2063d987d1c6d69751c17297f410f5b3547a65d096a8993b35bcb4f9cad054f17620e24fcdde6a885d05d80f0283d5f3ecf7a8acf78bba15540f94b228e44eefa7cc46304402204c2fa6a1cee11c8fba8d92bdf90f3c7498eae0771fe062c24b6b5d563fdf53cc0220164ab5d6451504c3820a844116076a1ed6d5b2b86e526aec1dae0ec9a805d7024630440220601a19963765e15332ca026bc26ba59e59e986d13c7be470bacda6d19454d5fd022022da9f95b247a424eba336fd2d1466bae913118f37402fc63a4bfa8df440103f6d6d6d6d6d6d6d00000000",
    error: "TRANSFER actor is not the previous owner and event_data carries no owner_linkage",
  },
  {
    name: "recoveryWithoutAuthority",
    description:
      "A TRANSFER spending state 6 made by the maker, with a stated reason and no proof of consent. Refused under the option alone; accepted when the maker is a configured transfer authority (acceptedUnder), which is what a recovery looks like.",
    appendAfter: 5,
    rawTx:
      "010000000199217be6170ee3feb5f1d55479a3429a71a9d791f00807979d20493e535727a50000000000ffffffff010100000000000000fd1d0221034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aaac0364707001313268747470733a2f2f69642e6773312e6f72672f30312f30393530363030303133343335322f32312f4a45525345592d303031085452414e5346455214323032382d30312d31305430383a30303a30305a21023c72addb4fdf09af94f0c94d7fe92a386a7e70cf8a1d85916386bb2535c7b1b121034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa106d616b6572207265636f766572792031157b22726561736f6e223a227265636f76657279227d4c5e7b226e616d65223a22436c7562204a65727365792032303236222c22666962726573223a7b22706f6c796573746572223a38322c22636f74746f6e223a31387d2c226461746143617272696572223a224558542d5549442d30303031227d2063d987d1c6d69751c17297f410f5b3547a65d096a8993b35bcb4f9cad054f17620a52757533e49209d970708f091d7a9719a42a37954d5f1b5fee30e17e67b219946304402206c0fc3afc348bfd17a87e91ca180cc0baf5129b8477d404cbca56a31d5e082a7022061556e1da98a28b95cb87df7565cbf272936232ab6f6420066c0e969f972c61a473045022100c37221bbe772571273bb53a699b62968f232bd13ddfb5a8a769be04ea9ea3ad202207bea66b2584650226805a5453656751654946607c0403b467f721b55699b58396d6d6d6d6d6d6d00000000",
    error: "TRANSFER actor is not the previous owner and event_data carries no owner_linkage",
    acceptedUnder: { authorities: ["034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa"] },
  },
]

/**
 * The chain fixture is the wire contract for the chain invariants, the way
 * `record-v1` is for one output, and since the fifth and sixth states also for
 * the possession convention of `spec/custody.md` §3. These tests rebuild every
 * pinned byte of the valid chain from `states[].data` and the test keys,
 * including the sixth state's unlocking script, which an owner's wallet
 * produces with one derivation, then prove each refusal vector refuses for the
 * pinned reason when read from raw hex alone.
 */
const wallets = {
  maker: new ProtoWallet(makerPriv),
  owner1: new ProtoWallet(owner1Priv),
  owner2: new ProtoWallet(owner2Priv),
  owner3: new ProtoWallet(owner3Priv),
} as const
type Actor = keyof typeof wallets
const server = new ProtoWallet(serverPriv)

async function rebuild(): Promise<Transaction[]> {
  const txs: Transaction[] = []
  for (const [i, s] of F.states.entries()) {
    const state = await completeState(s.data as DppStateData, wallets[s.actor as Actor], server)
    expect(Utils.toHex(state.userSignature)).toBe(s.userSignature)
    expect(Utils.toHex(state.serverSignature)).toBe(s.serverSignature)
    const prev = i === 0 ? undefined : { tx: txs[i - 1], outputIndex: F.states[i - 1].outputIndex }
    const tx = stateTx(state, PublicKey.fromString(s.lockingKey), prev, s.outputIndex === 1)
    if (s.unlock === 'owner') await spendAsOwner(tx, 0, wallets[s.actor as Actor])
    expect(tx.outputs[s.outputIndex].lockingScript.toHex()).toBe(s.lockingScript)
    expect(tx.toHex()).toBe(s.rawTx)
    expect(tx.id('hex')).toBe(s.txid)
    txs.push(tx)
  }
  return txs
}

describe('chain-v1 fixture: the writer reproduces every byte', () => {
  it('pins the five test keys, the derived owner keys and the linkage scalar', () => {
    expect(makerPriv.toPublicKey().toString()).toBe(F.makerKey)
    expect(serverPriv.toPublicKey().toString()).toBe(F.serverKey)
    expect(owner1Priv.toPublicKey().toString()).toBe(F.owner1Key)
    expect(owner2Priv.toPublicKey().toString()).toBe(F.owner2Key)
    expect(owner3Priv.toPublicKey().toString()).toBe(F.owner3Key)
    expect(F.lockingKey).toBe(F.makerKey)
    expect(F.ownerProtocol).toEqual([1, 'dpp owner v1'])
    expect(ownerKeyFromDeriver(PASSPORT_ID, owner3Deriver)).toBe(F.owner3OwnerKey)
    expect(ownerKeyFromDeriver(PASSPORT_ID, owner1Deriver)).toBe(F.owner1OwnerKey)
    expect(ownerLinkageFromDeriver(PASSPORT_ID, owner3Deriver)).toBe(F.owner3OwnerLinkage)
    expect(verifyOwnerLinkage(F.owner3Key, F.owner3OwnerKey, F.owner3OwnerLinkage)).toBe(true)
  })

  it('locks the first four states to the maker and the last two to their own field 6', () => {
    for (const s of F.states.slice(0, 4)) expect(s.lockingKey).toBe(F.makerKey)
    for (const s of F.states.slice(4)) expect(s.lockingKey).toBe(s.data.ownerIdentityKey)
    expect(F.states.map((s) => s.unlock)).toEqual(['none', 'none', 'none', 'none', 'none', 'owner'])
  })

  it('rebuilds all six transactions, signatures, scripts, txids and the owner spend', async () => {
    const txs = await rebuild()
    expect(txs).toHaveLength(6)
    expect(F.states.map((s) => s.data.op)).toEqual([
      'ACTIVATE', 'SOLD', 'TRANSFER', 'REPAIRED', 'TRANSFER', 'TRANSFER',
    ])
    expect(F.states.map((s) => s.outputIndex)).toEqual([0, 1, 0, 0, 0, 0])
    for (const tx of txs.slice(1, 5)) expect(tx.inputs[0].unlockingScript?.toHex()).toBe('')
    expect(txs[5].inputs[0].unlockingScript?.toHex()).not.toBe('')
  })

  it("the owner's wallet spent the tip: the sixth input is a valid spend of the fifth output", () => {
    const tx4 = Transaction.fromHex(F.states[4].rawTx)
    const tx5 = Transaction.fromHex(F.states[5].rawTx)
    const input = tx5.inputs[0]
    expect(input.sourceTXID).toBe(F.states[4].txid)
    // Exactly what Transaction.verify builds per input; not tx.verify itself,
    // which walks every ancestor and the earlier inputs are deliberately unsigned.
    const spend = new Spend({
      sourceTXID: F.states[4].txid,
      sourceOutputIndex: input.sourceOutputIndex,
      lockingScript: tx4.outputs[0].lockingScript,
      sourceSatoshis: tx4.outputs[0].satoshis ?? 0,
      transactionVersion: tx5.version,
      otherInputs: [],
      unlockingScript: input.unlockingScript!,
      inputSequence: input.sequence ?? 0xffffffff,
      inputIndex: 0,
      outputs: tx5.outputs,
      lockTime: tx5.lockTime,
    })
    expect(spend.validate()).toBe(true)
  })
})

describe('chain-v1 fixture: the reader accepts the chain and verifies it', () => {
  const fromHex = () => F.states.map((s) => Transaction.fromHex(s.rawTx))

  it('verifies from raw hex alone, with no source transactions hydrated', async () => {
    const result = await verifyChain(fromHex(), { chainTracker: 'scripts only' })
    expect(result.error).toBeUndefined()
    expect(result.valid).toBe(true)
    expect(result.spv).toBe('pending')
    expect(result.states.every((s) => s.userSignatureValid && s.linkageValid)).toBe(true)
  })

  it('verifies every server signature against the pinned service key', async () => {
    const result = await verifyChain(fromHex(), { chainTracker: 'scripts only', serverIdentityKey: F.serverKey })
    expect(result.valid).toBe(true)
    expect(result.states.every((s) => s.serverSignatureValid === true)).toBe(true)
  })
})

describe('chain-v1 fixture: the reader refuses every broken link', () => {
  it.each(F.refusals.map((r) => [r.name, r] as const))('refuses %s', async (_name, r) => {
    const prefix = F.states.slice(0, r.appendAfter + 1).map((s) => Transaction.fromHex(s.rawTx))
    const chain = [...prefix, Transaction.fromHex(r.rawTx)]
    const result = await verifyChain(chain, { chainTracker: 'scripts only' })
    expect(result.valid).toBe(false)
    expect(result.error).toContain(r.error)
  })

  it('control: every refusal is one rule, and no two vectors are the same bytes', () => {
    const raws = F.refusals.map((r) => r.rawTx)
    expect(new Set(raws).size).toBe(raws.length)
    for (const raw of raws) expect(F.states.map((s) => s.rawTx)).not.toContain(raw)
    expect(F.refusals).toHaveLength(9)
  })
})

describe('chain-v1: the refusals of the removed owner-signed transfer', () => {
  it.each(REMOVED_OWNER_CONSENT_REFUSALS.map((r) => [r.name, r] as const))('%s is a valid chain under the record model alone', async (_name, r) => {
    const prefix = F.states.slice(0, r.appendAfter + 1).map((s) => Transaction.fromHex(s.rawTx))
    const result = await verifyChain([...prefix, Transaction.fromHex(r.rawTx)], { chainTracker: 'scripts only' })
    expect(result.error).toBeUndefined()
    expect(result.valid).toBe(true)
  })
})
