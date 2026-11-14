import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkProductIdentity, isDemonstrationGtin, parseGs1DigitalLinkUri, type BindingIdentity } from '../src/index.js'

// The product-to-passport identity rules (spec/profiles.md section 7). A
// product document can satisfy every rule of its own profile and still be a
// document about another product, or about itself under two numbers. These
// rules are what ties the document to the passport that carries it.
interface Case { name: string; rules: number[]; want: 'pass' | 'fail' | 'unknown'; code: string; passportId?: string; product: Record<string, unknown> }
const fixture = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'product-identity-cases.json'), 'utf8')) as { identity: BindingIdentity; cases: Case[] }
const identity = fixture.identity
const check = (product: unknown, passportId?: string | null) => checkProductIdentity({ payload: { product }, identity, passportId })

const HEATER = '09523000000012'
const OTHER = '09523000000029'
const own = `https://passports.example/01/${HEATER}/21/HT10-2026-000001`
const base = (): Record<string, unknown> => ({ id: `https://id.example/01/${HEATER}/21/HT10-2026-000001`, name: 'Heater', gtin: HEATER, serialNumber: 'HT10-2026-000001', granularity: 'item', model: `https://id.example/01/${HEATER}` })
const vary = (change: (d: Record<string, unknown>) => void): Record<string, unknown> => { const copy = base(); change(copy); return copy }

describe('the thirty-three identity cases', () => {
  it('holds thirty-three cases, every GTIN under the demonstration prefix', () => {
    expect(fixture.cases).toHaveLength(33)
    expect(fixture.cases.filter((c) => c.want === 'pass')).toHaveLength(10)
    expect(fixture.cases.filter((c) => c.want === 'fail')).toHaveLength(20)
    expect(fixture.cases.filter((c) => c.want === 'unknown')).toHaveLength(3)
    const gtins = JSON.stringify(fixture).match(/\b\d{13,14}\b/g) ?? []
    expect(gtins.length).toBeGreaterThan(60)
    // The one deliberately broken number differs from a demonstration GTIN in its check digit only.
    for (const gtin of gtins) expect(isDemonstrationGtin(gtin), gtin).toBe(true)
  })

  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const result = check(c.product, c.passportId)
    expect({ status: result.status, code: result.code }, result.detail).toEqual({ status: c.want, code: c.code })
    expect(result.detail).toMatch(/\.$/)
  })
})

describe('rule 1: the expected identity is the supplied passport identifier and nothing else', () => {
  it('answers unknown, never pass, when none is supplied', () => {
    for (const missing of [undefined, null, '']) expect(check(base(), missing)).toMatchObject({ status: 'unknown', code: 'passport-identifier-missing' })
  })

  it('never takes the expected identity from the document', () => {
    // The document is self-consistent, and it is somebody else's.
    const result = check(base(), `https://passports.example/01/${OTHER}/21/HT10-2026-000001`)
    expect(result).toMatchObject({ status: 'fail', code: 'subject-mismatch' })
  })

  it('fails a passport identifier whose GTIN has a wrong check digit, and cannot read one in another form', () => {
    expect(check(base(), 'https://passports.example/01/09523000000013/21/HT10-2026-000001')).toMatchObject({ status: 'fail', code: 'passport-identifier-invalid' })
    expect(check(base(), 'urn:uuid:5b1d0c4e-0000-4000-8000-000000000002')).toMatchObject({ status: 'unknown', code: 'passport-identifier-unsupported' })
    expect(check(base(), 'not a uri')).toMatchObject({ status: 'unknown', code: 'passport-identifier-unsupported' })
  })
})

describe('rules 2 and 3: the subject is an item link with the passport\'s key, at any host', () => {
  it('does not compare the host, the scheme or a path before the key', () => {
    for (const id of [`https://id.example/01/${HEATER}/21/HT10-2026-000001`, `http://another.example/01/${HEATER}/21/HT10-2026-000001`, `https://resolver.example/some/stem/01/${HEATER}/21/HT10-2026-000001`]) {
      expect(check(vary((d) => { d.id = id })), id).toMatchObject({ status: 'unknown' })
      expect(check(vary((d) => { d.id = id }), own), id).toMatchObject({ status: 'pass', code: 'identity-match' })
    }
  })

  it('answers unknown for a document that states no identifier or one that is not text', () => {
    expect(check(vary((d) => { delete d.id }), own)).toMatchObject({ status: 'unknown', code: 'subject-missing' })
    for (const id of [42, null, ['a'], { id: 'x' }]) expect(check(vary((d) => { d.id = id }), own)).toMatchObject({ status: 'unknown', code: 'subject-unsupported' })
  })

  it('answers unknown for a payload with no product document', () => {
    expect(checkProductIdentity({ payload: {}, identity, passportId: own })).toMatchObject({ status: 'unknown', code: 'subject-missing' })
    expect(checkProductIdentity({ payload: 'text', identity, passportId: own })).toMatchObject({ status: 'unknown', code: 'subject-missing' })
  })
})

describe('rule 4: GTIN widths are equivalent after padding, and a wrong check digit fails', () => {
  // The demonstration prefix is defined for the thirteen-digit number. The
  // eight- and twelve-digit numbers here start with the same three digits, so
  // no fixture borrows a number a company holds.
  const widths: Array<[string, string]> = [
    ['95212340', '00000095212340'],
    ['952123456786', '00952123456786'],
    ['9523000000012', '09523000000012'],
    ['09523000000012', '09523000000012'],
  ]
  it.each(widths)('reads %s as %s', (written, fourteen) => {
    const product = { id: `https://id.example/01/${fourteen}/21/W1`, gtin: written }
    expect(check(product, `https://passports.example/01/${fourteen}/21/W1`)).toMatchObject({ status: 'pass' })
    // The same number written short in the identifier itself.
    expect(check({ id: `https://id.example/01/${written}/21/W1` }, `https://passports.example/01/${fourteen}/21/W1`)).toMatchObject({ status: 'pass' })
  })

  it('fails a subject whose GTIN has a wrong check digit, even when the passport repeats the mistake', () => {
    const wrong = '09523000000013'
    expect(check({ id: `https://id.example/01/${wrong}/21/A` }, own)).toMatchObject({ status: 'fail', code: 'subject-invalid' })
    expect(check({ id: `https://id.example/01/${wrong}/21/A` }, `https://passports.example/01/${wrong}/21/A`)).toMatchObject({ status: 'fail' })
  })

  it('fails a GTIN member that is not 8, 12, 13 or 14 digits', () => {
    for (const gtin of ['952300000001', '0952300000001X', '', '9523000000012 ', '095230000000120']) {
      expect(check(vary((d) => { d.gtin = gtin }), own), JSON.stringify(gtin)).toMatchObject({ status: 'fail', code: 'stated-gtin-invalid' })
    }
  })
})

describe('rule 5: the serial is percent-decoded once, then compared code point for code point', () => {
  const passport = (serial: string): string => `https://passports.example/01/${HEATER}/21/${serial}`
  const subject = (serial: string): Record<string, unknown> => ({ id: `https://id.example/01/${HEATER}/21/${serial}` })

  it('reads an escaped character as the character', () => {
    expect(check(subject('AB%2FC'), passport('AB%2FC'))).toMatchObject({ status: 'pass' })
    expect(check({ ...subject('AB%2FC'), serialNumber: 'AB/C' }, passport('AB%2FC'))).toMatchObject({ status: 'pass' })
    expect(check(subject('%41BC'), passport('ABC'))).toMatchObject({ status: 'pass' })
  })

  it('decodes once: an escaped percent sign stays a percent sign', () => {
    // %2541 is the three characters %41, not the letter A.
    expect(check(subject('%2541'), passport('A'))).toMatchObject({ status: 'fail', code: 'subject-mismatch' })
    expect(check({ ...subject('%2541'), serialNumber: '%41' }, passport('%2541'))).toMatchObject({ status: 'pass' })
    expect(check({ ...subject('%2541'), serialNumber: 'A' }, passport('%2541'))).toMatchObject({ status: 'fail', code: 'stated-serial-mismatch' })
  })

  it('does not fold case', () => {
    expect(check(subject('abc'), passport('ABC'))).toMatchObject({ status: 'fail', code: 'subject-mismatch' })
    expect(check({ ...subject('ABC'), serialNumber: 'abc' }, passport('ABC'))).toMatchObject({ status: 'fail', code: 'stated-serial-mismatch' })
  })

  it('does not trim a stated serial or normalise its characters', () => {
    for (const serial of [' ABC', 'ABC ', 'ABC\n', 'ABC​', 'ＡＢＣ']) {
      expect(check({ ...subject('ABC'), serialNumber: serial }, passport('ABC')), JSON.stringify(serial)).toMatchObject({ status: 'fail', code: 'stated-serial-mismatch' })
    }
  })

  it('never passes an identifier written with surrounding or embedded white space', () => {
    // A URL parser strips these silently, which would be trimming by another name.
    for (const id of [`https://id.example/01/${HEATER}/21/ABC `, ` https://id.example/01/${HEATER}/21/ABC`, `https://id.example/01/${HEATER}/21/A\tBC`, `https://id.example/01/${HEATER}/21/ABC\n`]) {
      expect(check({ id }, passport('ABC')), JSON.stringify(id)).toMatchObject({ status: 'unknown', code: 'subject-unsupported' })
      expect(check(subject('ABC'), id.replace('id.example', 'passports.example')), JSON.stringify(id)).toMatchObject({ status: 'unknown', code: 'passport-identifier-unsupported' })
    }
  })
})

describe('rule 6: every stated GTIN and serial equals the subject\'s', () => {
  it('compares each value of a member that lists several', () => {
    expect(check(vary((d) => { d.gtin = [HEATER, HEATER.slice(1)] }), own)).toMatchObject({ status: 'pass' })
    expect(check(vary((d) => { d.gtin = [HEATER, OTHER] }), own)).toMatchObject({ status: 'fail', code: 'stated-gtin-mismatch' })
    expect(check(vary((d) => { d.serialNumber = ['HT10-2026-000001', 'HT10-2026-000002'] }), own)).toMatchObject({ status: 'fail', code: 'stated-serial-mismatch' })
  })

  it('answers unknown for a stated value it cannot read as text', () => {
    expect(check(vary((d) => { d.gtin = 9523000000012 }), own)).toMatchObject({ status: 'unknown', code: 'stated-value-unsupported' })
    expect(check(vary((d) => { d.serialNumber = { '@value': 'HT10-2026-000001' } }), own)).toMatchObject({ status: 'unknown', code: 'stated-value-unsupported' })
  })

  it('reads a member whose name needs escaping in a pointer', () => {
    const escaped: BindingIdentity = { ...identity, mustEqual: [{ pointer: '/product/gs1~1gtin', part: 'gtin' }, { pointer: '/product/serial~0number', part: 'serial' }] }
    const product = { id: base().id, 'gs1/gtin': OTHER, 'serial~number': 'HT10-2026-000001' }
    expect(checkProductIdentity({ payload: { product }, identity: escaped, passportId: own })).toMatchObject({ status: 'fail', code: 'stated-gtin-mismatch', findings: [{ pointer: '/product/gs1~1gtin' }] })
  })
})

describe('rule 7: a product identifier may be coarser than the item and must not name another product', () => {
  it('accepts the model link, a batch link and the item link of the same product', () => {
    for (const model of [`https://id.example/01/${HEATER}`, `https://id.example/01/${HEATER.slice(1)}`, `https://id.example/01/${HEATER}/10/LOT1`, `https://id.example/01/${HEATER}/21/HT10-2026-000001`, { id: `https://id.example/01/${HEATER}` }, { '@id': `https://id.example/01/${HEATER}` }]) {
      expect(check(vary((d) => { d.model = model }), own), JSON.stringify(model)).toMatchObject({ status: 'pass' })
    }
  })

  it('fails another GTIN, and the same GTIN under another serial', () => {
    expect(check(vary((d) => { d.model = `https://id.example/01/${OTHER}` }), own)).toMatchObject({ status: 'fail', code: 'product-identifier-mismatch' })
    expect(check(vary((d) => { d.model = `https://id.example/01/${HEATER}/21/HT10-2026-000002` }), own)).toMatchObject({ status: 'fail', code: 'product-identifier-mismatch' })
    expect(check(vary((d) => { d.model = 'https://id.example/01/09523000000013' }), own)).toMatchObject({ status: 'fail', code: 'product-identifier-invalid' })
  })

  it('answers unknown for a product identifier in a form it does not read', () => {
    expect(check(vary((d) => { d.model = 'urn:example:model:heater-10' }), own)).toMatchObject({ status: 'unknown', code: 'product-identifier-unsupported' })
    expect(check(vary((d) => { d.model = 12 }), own)).toMatchObject({ status: 'unknown', code: 'product-identifier-unsupported' })
  })
})

describe('rule 8: the subject\'s own link decides the granularity', () => {
  it('fails a model, a variant and a batch as the subject', () => {
    for (const [id, word] of [[`https://id.example/01/${HEATER}`, 'model'], [`https://id.example/01/${HEATER}/22/V2`, 'variant'], [`https://id.example/01/${HEATER}/10/LOT1`, 'batch']] as const) {
      const result = check(vary((d) => { d.id = id }), own)
      expect(result).toMatchObject({ status: 'fail', code: 'subject-not-an-item' })
      expect(result.detail).toContain(word)
    }
  })

  it('accepts a document that declares no granularity, and fails any declared value other than item', () => {
    expect(check(vary((d) => { delete d.granularity }), own)).toMatchObject({ status: 'pass' })
    for (const declared of ['model', 'batch', 'Item', 'item ', 1, null, ['item']]) expect(check(vary((d) => { d.granularity = declared }), own), JSON.stringify(declared)).toMatchObject({ status: 'fail', code: 'granularity-mismatch' })
  })
})

describe('rule 9: a related identifier is never compared as the subject', () => {
  it('ignores the batch member, whatever it names', () => {
    for (const batch of [`https://id.example/01/${HEATER}/10/LOT1`, `https://id.example/01/${OTHER}/10/LOT1`, 'LOT1', 7]) expect(check(vary((d) => { d.batch = batch }), own)).toMatchObject({ status: 'pass' })
  })

  it('does not treat two items of one model as the same product', () => {
    const sibling = vary((d) => { d.id = `https://id.example/01/${HEATER}/21/HT10-2026-000002`; d.serialNumber = 'HT10-2026-000002' })
    expect(check(sibling, own)).toMatchObject({ status: 'fail', code: 'subject-mismatch' })
  })
})

describe('rule 10: a form the rules do not read is unknown, never a pass', () => {
  it('answers unknown for a compressed link, another primary key and a link it cannot parse', () => {
    const compressed = 'https://id.example/ehCQF9G4X0CcHRZ2AQEB'
    expect(parseGs1DigitalLinkUri(compressed).kind).toBe('compressed')
    for (const id of [compressed, 'https://id.example/00/095230000000000017', `https://id.example/01/${HEATER}/21/A/235/B`, `https://id.example/01/${HEATER}/21/A?10=LOT`, `ftp://id.example/01/${HEATER}/21/A`, `https://id.example/01/${HEATER}/21/${'9'.repeat(21)}`]) {
      expect(check(vary((d) => { d.id = id }), own), id).toMatchObject({ status: 'unknown', code: 'subject-unsupported' })
      expect(check(base(), id), id).toMatchObject({ status: 'unknown', code: 'passport-identifier-unsupported' })
    }
  })

  it('lets a failure outrank an unknown', () => {
    const result = check(vary((d) => { d.model = 'urn:example:model:heater-10'; d.granularity = 'model' }), own)
    expect(result).toMatchObject({ status: 'fail', code: 'granularity-mismatch' })
    expect(result.findings.map((f) => f.code)).toEqual(['product-identifier-unsupported', 'granularity-mismatch'])
  })
})

describe('rule 11: nothing is rewritten', () => {
  it('leaves the payload exactly as it was given', () => {
    const freeze = (value: unknown): unknown => { if (value !== null && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
    const payload = { product: vary((d) => { d.gtin = HEATER.slice(1); d.id = `https://ID.example/01/${HEATER.slice(1)}/21/HT10-2026-000001/` }) }
    const before = JSON.stringify(payload)
    freeze(payload)
    expect(checkProductIdentity({ payload, identity, passportId: own })).toMatchObject({ status: 'pass' })
    expect(JSON.stringify(payload)).toBe(before)
  })
})
