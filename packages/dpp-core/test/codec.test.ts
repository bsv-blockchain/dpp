import { describe, expect, it } from 'vitest'
import {
  LockingScript,
  OP,
  PublicKey,
  PushDrop,
  Utils,
  type ScriptChunk,
} from '@bsv/sdk'
import {
  FIELD_COUNT,
  buildLockingScript,
  dataFields,
  parseDppOutput,
  stateToFields,
  tryParseDppOutput,
  type DppState,
} from '../src/index.js'
import { makeData, makerPriv } from './helpers.js'

const lockKey = makerPriv.toPublicKey()

function dummyState(overrides: Partial<DppState> = {}): DppState {
  return {
    ...makeData(),
    protocolMarker: 'dpp',
    version: '1',
    userSignature: [48, 68, 2, 32, 7],
    serverSignature: [48, 69, 2, 33, 9],
    ...overrides,
  }
}

/** Hand-rolled DPP-shaped script builder for malformed-input tests. */
function rawScript(fields: number[][], pub: PublicKey = lockKey): LockingScript {
  const pubBytes = pub.encode(true) as number[]
  const chunks: ScriptChunk[] = [
    { op: pubBytes.length, data: pubBytes },
    { op: OP.OP_CHECKSIG },
    ...fields.map(
      (f): ScriptChunk =>
        f.length === 0
          ? { op: 0 }
          : f.length <= 75
            ? { op: f.length, data: f }
            : { op: 0x4c, data: f } // OP_PUSHDATA1 for long fields (payload_public is ~94 bytes)
    ),
  ]
  let undropped = fields.length
  while (undropped > 1) {
    chunks.push({ op: OP.OP_2DROP })
    undropped -= 2
  }
  if (undropped !== 0) chunks.push({ op: OP.OP_DROP })
  return new LockingScript(chunks)
}

const utf8 = (s: string): number[] => Utils.toArray(s, 'utf8')

describe('codec round-trip', () => {
  it('round-trips a genesis state with empty event_data and previous_txid', () => {
    const state = dummyState()
    const { state: decoded, lockingPublicKey } = parseDppOutput(
      buildLockingScript(state, lockKey)
    )
    expect(decoded).toEqual(state)
    expect(lockingPublicKey.toString()).toBe(lockKey.toString())
  })

  it('round-trips a state with every field populated', () => {
    const state = dummyState({
      op: 'SOLD',
      eventData: '{"channel":"club store"}',
      previousTxid: 'cd'.repeat(32),
    })
    expect(parseDppOutput(buildLockingScript(state, lockKey)).state).toEqual(state)
  })

  it('round-trips an empty payload_owner_hash (passport without owner tier)', () => {
    const state = dummyState({ payloadOwnerHash: '' })
    expect(parseDppOutput(buildLockingScript(state, lockKey)).state).toEqual(state)
  })

  it('produces the PushDrop shape: key, OP_CHECKSIG, 14 pushes, 7 OP_2DROP', () => {
    const script = buildLockingScript(dummyState(), lockKey)
    expect(script.chunks).toHaveLength(2 + FIELD_COUNT + 7)
    expect(script.chunks[0].data).toHaveLength(33)
    expect(script.chunks[1].op).toBe(OP.OP_CHECKSIG)
    for (const chunk of script.chunks.slice(2 + FIELD_COUNT)) {
      expect(chunk.op).toBe(OP.OP_2DROP)
    }
  })

  it('is decodable by the stock @bsv/sdk PushDrop when no field is empty', () => {
    const state = dummyState({
      op: 'SOLD',
      eventData: '{"k":1}',
      previousTxid: 'cd'.repeat(32),
    })
    const script = buildLockingScript(state, lockKey)
    const sdkDecoded = PushDrop.decode(script)
    expect(sdkDecoded.fields).toEqual(stateToFields(state))
    expect(sdkDecoded.lockingPublicKey.toString()).toBe(lockKey.toString())
  })
})

describe('codec validation', () => {
  const valid = (): number[][] => stateToFields(dummyState())

  it('parses the unmutated baseline (control: the negative table must not go vacuous)', () => {
    expect(tryParseDppOutput(rawScript(valid()))).not.toBeNull()
  })

  it.each([
    ['wrong protocol marker', (f: number[][]) => { f[0] = utf8('nft') }],
    ['unsupported version', (f: number[][]) => { f[1] = utf8('2') }],
    ['empty passport_id', (f: number[][]) => { f[2] = [] }],
    ['unknown op', (f: number[][]) => { f[3] = utf8('BURNED') }],
    ['non-ISO timestamp', (f: number[][]) => { f[4] = utf8('last tuesday') }],
    ['rolled-over timestamp (30 February)', (f: number[][]) => { f[4] = utf8('2026-02-30T00:00:00Z') }],
    ['rolled-over timestamp (31 April)', (f: number[][]) => { f[4] = utf8('2026-04-31T12:00:00Z') }],
    ['29 February outside a leap year', (f: number[][]) => { f[4] = utf8('2025-02-29T00:00:00Z') }],
    ['legacy 24:00 spelling of midnight', (f: number[][]) => { f[4] = utf8('2026-01-01T24:00:00Z') }],
    ['invalid UTF-8 in passport_id', (f: number[][]) => { f[2] = [...f[2], 0xff] }],
    ['invalid UTF-8 in actor_keyID', (f: number[][]) => { f[7] = [0x80] }],
    // "�" is itself valid JSON string content, so the lossy decode used
    // to slip mangled payloads past the JSON check.
    ['invalid UTF-8 in payload_public', (f: number[][]) => { f[9] = [0x22, 0xff, 0x22] }],
    ['invalid UTF-8 in event_data on an event op', (f: number[][]) => {
      f[3] = utf8('SOLD')
      f[8] = [0x22, 0xc3, 0x28, 0x22]
    }],
    ['single 0x00 byte as passport_id', (f: number[][]) => { f[2] = [0x00] }],
    ['single 0x00 byte as user_signature', (f: number[][]) => { f[12] = [0x00] }],
    ['short owner key', (f: number[][]) => { f[5] = f[5].slice(0, 32) }],
    ['non-canonical actor key (x >= p)', (f: number[][]) => { f[6] = [2, ...new Array(32).fill(255)] }],
    ['empty actor_keyID', (f: number[][]) => { f[7] = [] }],
    ['event_data set on ACTIVATE', (f: number[][]) => { f[8] = utf8('{"x":1}') }],
    ['event_data set on EDIT', (f: number[][]) => {
      f[3] = utf8('EDIT')
      f[8] = utf8('{"x":1}')
      f[11] = new Array(32).fill(0xcd)
    }],
    ['empty payload_public', (f: number[][]) => { f[9] = [] }],
    ['payload_public not JSON', (f: number[][]) => { f[9] = utf8('not json') }],
    ['owner hash wrong length', (f: number[][]) => { f[10] = [1, 2, 3] }],
    ['previous_txid wrong length', (f: number[][]) => { f[11] = [1, 2, 3, 4] }],
    ['empty user_signature', (f: number[][]) => { f[12] = [] }],
    ['empty server_signature', (f: number[][]) => { f[13] = [] }],
  ])('rejects %s', (_name, mutate) => {
    const fields = valid()
    mutate(fields)
    expect(tryParseDppOutput(rawScript(fields))).toBeNull()
  })

  it('refuses a zero-length PUSHDATA: OP_0 is the only encoding of the empty field', () => {
    const script = rawScript(valid())
    const chunks = [...script.chunks]
    // Field 9 (event_data) is empty on ACTIVATE and sits at chunk index 10.
    expect(chunks[10].op).toBe(0)
    chunks[10] = { op: 0x4c, data: [] }
    expect(tryParseDppOutput(new LockingScript(chunks))).toBeNull()
  })

  it('accepts NUL inside a longer value: the 0x00 refusal is the single byte only', () => {
    const fields = valid()
    fields[7] = [...utf8('key'), 0x00, ...utf8('id')]
    expect(tryParseDppOutput(rawScript(fields))).not.toBeNull()
  })

  it('refuses a lone-NUL passport_id from the writing side too: it minimal-encodes as OP_0, which reads back empty', () => {
    const state = dummyState({ passportId: '\0' })
    expect(tryParseDppOutput(buildLockingScript(state, lockKey))).toBeNull()
  })

  it('round-trips multi-byte UTF-8, non-BMP included', () => {
    const state = dummyState({
      actorKeyId: 'atelier Zürich 🧵',
      payloadPublic: JSON.stringify({ name: 'Trikot “Größe M” 2026' }),
    })
    expect(parseDppOutput(buildLockingScript(state, lockKey)).state).toEqual(state)
  })

  it('rejects non-JSON event_data on event ops', () => {
    const fields = stateToFields(
      dummyState({ op: 'SOLD', previousTxid: 'cd'.repeat(32), eventData: 'plain text' })
    )
    expect(tryParseDppOutput(rawScript(fields))).toBeNull()
  })

  it('rejects 13 and 15 field layouts', () => {
    expect(tryParseDppOutput(rawScript(valid().slice(0, 13)))).toBeNull()
    expect(tryParseDppOutput(rawScript([...valid(), utf8('extra')]))).toBeNull()
  })

  it('rejects non-DPP scripts without throwing', () => {
    expect(tryParseDppOutput(new LockingScript([{ op: 0 }, { op: OP.OP_RETURN }]))).toBeNull()
    expect(tryParseDppOutput(new LockingScript([]))).toBeNull()
  })

  it('encodes identity keys as raw 33 bytes and txids as raw 32 bytes', () => {
    const data = makeData({ previousTxid: 'cd'.repeat(32) })
    const fields = dataFields(data)
    expect(fields[5]).toEqual(Utils.toArray(data.ownerIdentityKey, 'hex'))
    expect(fields[5]).toHaveLength(33)
    expect(fields[11]).toEqual(Utils.toArray('cd'.repeat(32), 'hex'))
    expect(fields[8]).toHaveLength(0)
  })
})
