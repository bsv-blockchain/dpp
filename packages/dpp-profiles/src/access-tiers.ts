/**
 * The access split (`spec/profiles.md` §7). A passport state has a public
 * payload, written on a public chain and readable by anyone for good, and a
 * restricted part held off chain for authorised readers. A binding with an
 * `access` member says which top-level properties of the product document
 * are public. This module cuts a document along that line and rejoins the
 * two parts.
 *
 * Four rules hold throughout:
 *
 *   - the cut is by top-level property. A property is wholly public or wholly
 *     restricted, and nothing is split inside a nested object or a list;
 *   - a property the binding does not list as public is restricted, one the
 *     binding has never heard of included;
 *   - the restricted part repeats the product's identifier, so a rejoin can
 *     tell that the two parts describe one product;
 *   - a rejoin is for validation and display. It says nothing about what was
 *     signed, and nothing about whether the restricted part is the one a
 *     record commits to. Matching the off-chain blob to its on-chain hash is
 *     the protocol's check (`spec/record-model.md` §7), and this module does
 *     not make it.
 */
import canonicalize from 'canonicalize'
import type { ProfileBinding } from './profile-binding.js'

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)

/** The members of a binding the split reads. */
export type AccessBinding = Pick<ProfileBinding, 'access' | 'identity'>

/** The top-level property of the product document a pointer under `/product` passes through. */
export function topLevelProperty(pointer: string): string {
  return (pointer.split('/')[2] ?? '').replace(/~1/g, '/').replace(/~0/g, '~')
}

/** The top-level properties that hold the product's own identifier: what the restricted part repeats. */
export function joinKeyProperties(binding: AccessBinding): string[] {
  return [...new Set(binding.identity.subject.pointers.map(topLevelProperty))]
}

/** Whether a top-level property is public under the binding. Without an `access` member every property is. */
export function isPublicProperty(binding: AccessBinding, property: string): boolean {
  return binding.access == null || binding.access.public.includes(property)
}

/** Built from entries, so a property named `__proto__` is kept as data. */
const fromEntries = (entries: Array<[string, unknown]>): Json => Object.fromEntries(entries.map(([name, value]) => [name, structuredClone(value)]))
const same = (a: unknown, b: unknown): boolean => canonicalize(a) === canonicalize(b)

export interface SplitProduct {
  /** The public top-level properties, in the document's order. This is what goes in the public payload. */
  publicProduct: Json
  /** The product's identifier, then every other property in the document's order. Absent when the document has no restricted property. */
  restrictedProduct?: Json
}

/**
 * A product document cut into its public and restricted parts. The input is
 * not changed, and neither part shares an object with it.
 *
 * The caller validates the whole document first: this function checks
 * nothing about the document beyond what it needs to cut it. It throws a
 * `TypeError` for a product that is not an object, and for one that has
 * restricted properties and no identifier, because a restricted part with no
 * identifier could never be rejoined.
 */
export function splitProductByAccess(input: { binding: AccessBinding; product: Json }): SplitProduct {
  const { binding, product } = input
  if (!isObject(product)) throw new TypeError('product must be one JSON object: the product document')
  const entries = Object.entries(product)
  const open = entries.filter(([name]) => isPublicProperty(binding, name))
  const closed = entries.filter(([name]) => !isPublicProperty(binding, name))
  if (closed.length === 0) return { publicProduct: fromEntries(open) }
  const names = joinKeyProperties(binding)
  const joinKey = entries.filter(([name]) => names.includes(name))
  if (joinKey.length === 0) throw new TypeError(`the product document has restricted properties and states no identifier at ${binding.identity.subject.pointers.join(' or ')}, so its restricted part could not be rejoined`)
  // The identifier first, and once: a binding that left it out of the public list has it among the closed entries already.
  return { publicProduct: fromEntries(open), restrictedProduct: fromEntries([...joinKey, ...closed.filter(([name]) => !names.includes(name))]) }
}

/** Why two parts were not rejoined. One code per cause. */
export type ProductAssemblyRefusalCode =
  /** A part is not one JSON object. `part` says which. */
  | 'part-not-an-object'
  /** A part does not carry the product's identifier, so nothing ties the two together. `part` says which. */
  | 'join-key-missing'
  /** The restricted part carries another product's identifier. */
  | 'restricted-part-names-another-product'
  /** A property other than the identifier sits in both parts. */
  | 'property-in-both-parts'
  /** The public part carries a property the binding does not list as public. */
  | 'restricted-property-in-public-part'
  /** The restricted part carries a property the binding lists as public. */
  | 'public-property-in-restricted-part'

export interface ProductAssemblyRefusal {
  ok: false
  code: ProductAssemblyRefusalCode
  /** One sentence for a person. It names properties and never quotes a value. */
  detail: string
  /** The part the refusal is about, for `part-not-an-object` and `join-key-missing`. */
  part?: 'public' | 'restricted'
  /** The properties the refusal is about, for the three property codes. */
  properties?: string[]
}

export type ProductAssembly = { ok: true; product: Json } | ProductAssemblyRefusal

/**
 * The two parts rejoined into one product document, or the reason they were
 * not. The public properties come first, in the public part's order, then
 * the restricted properties in the restricted part's order, so the same
 * parts always give the same JSON text. Omit `restrictedProduct` for a state
 * that has no restricted part: the public part is then the whole document.
 *
 * The result is for validation and display. It is not what was signed, and a
 * successful rejoin is no evidence that the restricted part is the one a
 * record commits to.
 */
export function assembleProduct(input: { binding: AccessBinding; publicProduct: unknown; restrictedProduct?: unknown }): ProductAssembly {
  const { binding, publicProduct, restrictedProduct } = input
  const refuse = (code: ProductAssemblyRefusalCode, detail: string, extra: Pick<ProductAssemblyRefusal, 'part' | 'properties'> = {}): ProductAssemblyRefusal => ({ ok: false, code, detail, ...extra })
  const listed = (properties: string[]): string => properties.map((name) => `\`${name}\``).join(', ')

  if (!isObject(publicProduct)) return refuse('part-not-an-object', 'The public part is not one JSON object.', { part: 'public' })
  if (restrictedProduct !== undefined && !isObject(restrictedProduct)) return refuse('part-not-an-object', 'The restricted part is not one JSON object.', { part: 'restricted' })

  const names = joinKeyProperties(binding)
  const closedIn = (part: Json): string[] => Object.keys(part).filter((name) => !isPublicProperty(binding, name) && !names.includes(name))
  if (restrictedProduct === undefined) {
    const stray = closedIn(publicProduct)
    if (stray.length > 0) return refuse('restricted-property-in-public-part', `The public part carries ${stray.length === 1 ? 'a property' : 'properties'} the binding does not list as public: ${listed(stray)}.`, { properties: stray })
    return { ok: true, product: fromEntries(Object.entries(publicProduct)) }
  }

  // The identifier decides whether these are two parts of one product, so it is read before anything else.
  if (!names.some((name) => Object.hasOwn(publicProduct, name))) return refuse('join-key-missing', `The public part states no product identifier at ${listed(names)}.`, { part: 'public' })
  const carried = names.filter((name) => Object.hasOwn(restrictedProduct, name))
  if (carried.length === 0) return refuse('join-key-missing', `The restricted part states no product identifier at ${listed(names)}, so nothing ties it to the public part.`, { part: 'restricted' })
  const other = carried.filter((name) => !Object.hasOwn(publicProduct, name) || !same(publicProduct[name], restrictedProduct[name]))
  if (other.length > 0) return refuse('restricted-part-names-another-product', `The restricted part's product identifier at ${listed(other)} is not the public part's.`, { properties: other })

  const rest = Object.entries(restrictedProduct).filter(([name]) => !names.includes(name))
  const twice = rest.map(([name]) => name).filter((name) => Object.hasOwn(publicProduct, name))
  if (twice.length > 0) return refuse('property-in-both-parts', `${twice.length === 1 ? 'A property sits' : 'Properties sit'} in both parts: ${listed(twice)}.`, { properties: twice })
  const stray = closedIn(publicProduct)
  if (stray.length > 0) return refuse('restricted-property-in-public-part', `The public part carries ${stray.length === 1 ? 'a property' : 'properties'} the binding does not list as public: ${listed(stray)}.`, { properties: stray })
  const open = rest.map(([name]) => name).filter((name) => isPublicProperty(binding, name))
  if (open.length > 0) return refuse('public-property-in-restricted-part', `The restricted part carries ${open.length === 1 ? 'a property' : 'properties'} the binding lists as public: ${listed(open)}.`, { properties: open })

  return { ok: true, product: fromEntries([...Object.entries(publicProduct), ...rest]) }
}
