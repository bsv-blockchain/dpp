import { describe, expect, it } from 'vitest'
import { assembleProduct, splitProductByAccess, type ProductAssembly } from '../src/index.js'
import { SYNTHETIC_CONTEXT_URI, SYNTHETIC_PUBLIC, syntheticAccessBinding, syntheticBinding } from './binding-fixture.js'

// The cut between the public payload and the restricted part, and the rejoin,
// on a binding built in the test. The cut is by top-level property and
// nothing else, so these tests need no engine and no profile's files.
const GTIN = '09523000000012'
const ID = `https://id.example/01/${GTIN}/21/LAMP-0001`
const binding = syntheticAccessBinding()
const product = (): Record<string, unknown> => ({
  '@context': SYNTHETIC_CONTEXT_URI,
  id: ID,
  lumens: 800,
  name: 'Desk lamp',
  batch: `https://id.example/01/${GTIN}/10/LOT-7`,
  gtin: GTIN,
  wiring: { live: 'brown', neutral: 'blue', parts: [{ name: 'Fuse', rating: '3A' }] },
  serialNumber: 'LAMP-0001',
})
const refusal = (result: ProductAssembly) => { if (result.ok) throw new Error('expected a refusal'); return result }

describe('splitProductByAccess', () => {
  it('puts the listed properties in the public part, in the document\'s order', () => {
    const { publicProduct } = splitProductByAccess({ binding, product: product() })
    expect(Object.keys(publicProduct)).toEqual(['@context', 'id', 'name', 'gtin', 'serialNumber'])
    for (const name of Object.keys(publicProduct)) expect(SYNTHETIC_PUBLIC).toContain(name)
    expect(publicProduct).toEqual({ '@context': SYNTHETIC_CONTEXT_URI, id: ID, name: 'Desk lamp', gtin: GTIN, serialNumber: 'LAMP-0001' })
  })

  it('puts every other property in the restricted part, behind the product\'s identifier', () => {
    const { restrictedProduct } = splitProductByAccess({ binding, product: product() })
    expect(Object.keys(restrictedProduct!)).toEqual(['id', 'lumens', 'batch', 'wiring'])
    expect(restrictedProduct).toEqual({ id: ID, lumens: 800, batch: product().batch, wiring: product().wiring })
  })

  it('restricts a property the binding has never heard of', () => {
    const { publicProduct, restrictedProduct } = splitProductByAccess({ binding, product: { ...product(), supplierPrice: '4.20', 'https://elsewhere.example/margin': 0.4 } })
    expect(Object.keys(publicProduct)).not.toContain('supplierPrice')
    expect(restrictedProduct).toMatchObject({ supplierPrice: '4.20', 'https://elsewhere.example/margin': 0.4 })
  })

  it('never splits inside a property: a nested object goes whole to one part', () => {
    const { publicProduct, restrictedProduct } = splitProductByAccess({ binding, product: product() })
    expect(restrictedProduct!.wiring).toEqual(product().wiring)
    expect(JSON.stringify(publicProduct)).not.toContain('brown')
    // A public name used inside a restricted property stays where its parent is.
    expect(JSON.stringify(publicProduct)).not.toContain('Fuse')
  })

  it('does not change its input, and shares no object with it', () => {
    const input = product()
    const before = JSON.stringify(input)
    const { restrictedProduct } = splitProductByAccess({ binding, product: input })
    expect(JSON.stringify(input)).toBe(before)
    ;(restrictedProduct!.wiring as { live: string }).live = 'red'
    expect(JSON.stringify(input)).toBe(before)
  })

  it('yields no restricted part for a product with no restricted property', () => {
    const { lumens: _lumens, batch: _batch, wiring: _wiring, ...open } = product()
    const result = splitProductByAccess({ binding, product: open })
    expect(result).toEqual({ publicProduct: open })
    expect(Object.hasOwn(result, 'restrictedProduct')).toBe(false)
  })

  it('treats a binding with no access member as one tier: the whole product is public', () => {
    const result = splitProductByAccess({ binding: syntheticBinding(), product: product() })
    expect(result).toEqual({ publicProduct: product() })
  })

  it('carries the identifier under whichever name the document wrote it', () => {
    const { id: _id, ...rest } = product()
    const { publicProduct, restrictedProduct } = splitProductByAccess({ binding, product: { '@id': ID, ...rest } })
    expect(publicProduct['@id']).toBe(ID)
    expect(Object.keys(restrictedProduct!)[0]).toBe('@id')
    expect(restrictedProduct!['@id']).toBe(ID)
  })

  it('keeps a property named __proto__ as data, in the restricted part', () => {
    const odd = JSON.parse(`{"id":${JSON.stringify(ID)},"__proto__":{"polluted":true}}`) as Record<string, unknown>
    const { publicProduct, restrictedProduct } = splitProductByAccess({ binding, product: odd })
    expect(Object.keys(restrictedProduct!)).toEqual(['id', '__proto__'])
    expect(Object.getPrototypeOf(restrictedProduct)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(publicProduct)).toBe(Object.prototype)
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  })

  it('throws for a product that is not an object, and for one whose restricted part could not be rejoined', () => {
    expect(() => splitProductByAccess({ binding, product: [product()] as never })).toThrow(TypeError)
    expect(() => splitProductByAccess({ binding, product: null as never })).toThrow(TypeError)
    const { id: _id, ...unnamed } = product()
    expect(() => splitProductByAccess({ binding, product: unnamed })).toThrow(/states no identifier/)
  })
})

describe('assembleProduct', () => {
  const parts = () => splitProductByAccess({ binding, product: product() })

  it('rejoins what the split made: the same document as data', () => {
    const { publicProduct, restrictedProduct } = parts()
    const result = assembleProduct({ binding, publicProduct, restrictedProduct })
    expect(result).toEqual({ ok: true, product: product() })
  })

  it('writes the public properties first, then the restricted ones, with the identifier once', () => {
    const { publicProduct, restrictedProduct } = parts()
    const result = assembleProduct({ binding, publicProduct, restrictedProduct })
    if (!result.ok) throw new Error(result.detail)
    expect(Object.keys(result.product)).toEqual(['@context', 'id', 'name', 'gtin', 'serialNumber', 'lumens', 'batch', 'wiring'])
  })

  it('gives byte-identical JSON for the same parts, whatever order the caller built them in', () => {
    const { publicProduct, restrictedProduct } = parts()
    const first = assembleProduct({ binding, publicProduct, restrictedProduct })
    const again = assembleProduct({ binding, publicProduct: structuredClone(publicProduct), restrictedProduct: structuredClone(restrictedProduct) })
    expect(JSON.stringify(again)).toBe(JSON.stringify(first))
    // The parts decide the order, so two splits of one document rejoin to one text.
    const second = splitProductByAccess({ binding, product: product() })
    expect(JSON.stringify(assembleProduct({ binding, ...second }))).toBe(JSON.stringify(first))
  })

  it('does not change either part, and shares no object with them', () => {
    const { publicProduct, restrictedProduct } = parts()
    const before = JSON.stringify([publicProduct, restrictedProduct])
    const result = assembleProduct({ binding, publicProduct, restrictedProduct })
    if (!result.ok) throw new Error(result.detail)
    ;(result.product.wiring as { live: string }).live = 'red'
    expect(JSON.stringify([publicProduct, restrictedProduct])).toBe(before)
  })

  it('takes the public part alone as the whole document when there is no restricted part', () => {
    const { publicProduct } = parts()
    expect(assembleProduct({ binding, publicProduct })).toEqual({ ok: true, product: publicProduct })
  })

  it('refuses a restricted part that names another product', () => {
    const { publicProduct, restrictedProduct } = parts()
    const result = refusal(assembleProduct({ binding, publicProduct, restrictedProduct: { ...restrictedProduct, id: `https://id.example/01/${GTIN}/21/LAMP-0002` } }))
    expect(result).toMatchObject({ code: 'restricted-part-names-another-product', properties: ['id'] })
    // Another host is another text. The parts of one split carry the same identifier, character for character.
    expect(refusal(assembleProduct({ binding, publicProduct, restrictedProduct: { ...restrictedProduct, id: ID.replace('id.example', 'other.example') } })).code).toBe('restricted-part-names-another-product')
  })

  it('refuses a restricted part that writes the identifier under a name the public part does not use', () => {
    const { publicProduct, restrictedProduct } = parts()
    const { id: _id, ...rest } = restrictedProduct!
    expect(refusal(assembleProduct({ binding, publicProduct, restrictedProduct: { '@id': ID, ...rest } })).code).toBe('restricted-part-names-another-product')
  })

  it('refuses a part with no identifier, and says which', () => {
    const { publicProduct, restrictedProduct } = parts()
    const { id: _a, ...unnamedRestricted } = restrictedProduct!
    expect(refusal(assembleProduct({ binding, publicProduct, restrictedProduct: unnamedRestricted }))).toMatchObject({ code: 'join-key-missing', part: 'restricted' })
    const { id: _b, ...unnamedPublic } = publicProduct
    expect(refusal(assembleProduct({ binding, publicProduct: unnamedPublic, restrictedProduct }))).toMatchObject({ code: 'join-key-missing', part: 'public' })
  })

  it('refuses a property that sits in both parts, equal or not', () => {
    const { publicProduct, restrictedProduct } = parts()
    expect(refusal(assembleProduct({ binding, publicProduct, restrictedProduct: { ...restrictedProduct, name: 'Desk lamp' } }))).toMatchObject({ code: 'property-in-both-parts', properties: ['name'] })
    expect(refusal(assembleProduct({ binding, publicProduct: { ...publicProduct, lumens: 800 }, restrictedProduct }))).toMatchObject({ code: 'property-in-both-parts', properties: ['lumens'] })
  })

  it('refuses a restricted-tier property in the public part', () => {
    const { publicProduct, restrictedProduct } = parts()
    const { lumens, ...rest } = restrictedProduct!
    expect(refusal(assembleProduct({ binding, publicProduct: { ...publicProduct, lumens }, restrictedProduct: rest }))).toMatchObject({ code: 'restricted-property-in-public-part', properties: ['lumens'] })
    // With no restricted part as well: a public payload is held to the public list on its own.
    expect(refusal(assembleProduct({ binding, publicProduct: { ...publicProduct, lumens } }))).toMatchObject({ code: 'restricted-property-in-public-part', properties: ['lumens'] })
    expect(refusal(assembleProduct({ binding, publicProduct: { ...publicProduct, supplierPrice: '4.20' } })).code).toBe('restricted-property-in-public-part')
  })

  it('refuses a public-tier property in the restricted part', () => {
    const { publicProduct, restrictedProduct } = parts()
    const { name, ...rest } = publicProduct
    expect(refusal(assembleProduct({ binding, publicProduct: rest, restrictedProduct: { ...restrictedProduct, name } }))).toMatchObject({ code: 'public-property-in-restricted-part', properties: ['name'] })
  })

  it('refuses a part that is not an object, and says which', () => {
    const { publicProduct, restrictedProduct } = parts()
    for (const bad of ['{}', [publicProduct], null, 7]) {
      expect(refusal(assembleProduct({ binding, publicProduct: bad, restrictedProduct }))).toMatchObject({ code: 'part-not-an-object', part: 'public' })
    }
    for (const bad of ['{}', [restrictedProduct], null, 7]) {
      expect(refusal(assembleProduct({ binding, publicProduct, restrictedProduct: bad }))).toMatchObject({ code: 'part-not-an-object', part: 'restricted' })
    }
  })

  it('refuses any restricted property under a binding that has one tier', () => {
    const oneTier = syntheticBinding()
    expect(assembleProduct({ binding: oneTier, publicProduct: product() })).toEqual({ ok: true, product: product() })
    expect(refusal(assembleProduct({ binding: oneTier, publicProduct: { id: ID, name: 'Desk lamp' }, restrictedProduct: { id: ID, lumens: 800 } }))).toMatchObject({ code: 'public-property-in-restricted-part', properties: ['lumens'] })
  })

  it('names properties in a refusal and never quotes a value', () => {
    const { publicProduct, restrictedProduct } = parts()
    const refusals = [
      assembleProduct({ binding, publicProduct, restrictedProduct: { ...restrictedProduct, id: 'https://id.example/01/09523000000029/21/SECRET-SERIAL' } }),
      assembleProduct({ binding, publicProduct: { ...publicProduct, lumens: 31337 }, restrictedProduct }),
      assembleProduct({ binding, publicProduct: { ...publicProduct, supplierPrice: 'SECRET-PRICE' } }),
      assembleProduct({ binding, publicProduct, restrictedProduct: { ...restrictedProduct, name: 'SECRET-NAME' } }),
    ]
    for (const result of refusals) {
      expect(result.ok).toBe(false)
      expect(JSON.stringify(result)).not.toMatch(/SECRET|31337|brown/)
      expect(refusal(result).detail).toMatch(/\.$/)
    }
  })
})
