// How a reader's page shows a product document: as the structure it has.
// A measurement is a value with its unit, text keeps its language, a coded
// value is shown as a code, a list stays a list and a nested object stays
// nested. Nothing is left out: a property the page has no label for is
// shown under the name the document gives it.
import { isObject, type Json } from './form-model'
import { unitName } from './units'

export type Shown =
  | { kind: 'empty' }
  | { kind: 'text'; text: string }
  | { kind: 'link'; href: string }
  | { kind: 'date'; text: string }
  | { kind: 'number'; text: string }
  | { kind: 'boolean'; value: boolean }
  /** Text in a language. */
  | { kind: 'langText'; text: string; language: string }
  /** A literal with a data type written beside it. `type` is as the document writes it. */
  | { kind: 'typed'; text: string; type: string }
  /** A measurement: the value exactly as written, the unit code and its name. */
  | { kind: 'quantity'; value: string; unitCode: string; unitName: string }
  /** A coded value or a link to another thing, by its identifier. */
  | { kind: 'reference'; id: string; label: string }
  | { kind: 'list'; items: Shown[] }
  | { kind: 'object'; type?: string; id?: string; entries: Array<{ key: string; label: string; value: Shown }> }

const hasOnly = (value: Json, names: string[]): boolean => Object.keys(value).every((name) => names.includes(name))

/** `eubat:hasBatteryState` becomes `Battery state`; `gs1:TargetConsumerGenderCode-UNISEX` becomes `Unisex`. */
export function humaniseName(name: string): string {
  const local = name.slice(name.lastIndexOf(':') + 1)
  const tail = local.includes('-') ? local.slice(local.lastIndexOf('-') + 1) : local
  const words = tail
    .replace(/^(has|is)(?=[A-Z])/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
  if (words === '') return name
  const lower = /^[A-Z0-9 ]+$/.test(words) && local.includes('-') ? words.toLowerCase() : words.replace(/\b([A-Z])([a-z])/g, (_, first: string, rest: string) => first.toLowerCase() + rest)
  return lower[0].toUpperCase() + lower.slice(1)
}

/** One value of a product document, as the structure the page draws. `labels` gives a property its label where the form knows one. */
export function describeValue(value: unknown, labels: Map<string, string> = new Map()): Shown {
  if (value === null || value === undefined || value === '') return { kind: 'empty' }
  if (typeof value === 'boolean') return { kind: 'boolean', value }
  if (typeof value === 'number') return { kind: 'number', text: String(value) }
  if (typeof value === 'string') {
    if (/^https?:\/\//.test(value)) return { kind: 'link', href: value }
    if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.test(value)) return { kind: 'date', text: value }
    return { kind: 'text', text: value }
  }
  if (Array.isArray(value)) return { kind: 'list', items: value.map((item) => describeValue(item, labels)) }
  if (!isObject(value)) return { kind: 'text', text: String(value) }

  if (Object.hasOwn(value, '@value')) {
    const text = String(value['@value'])
    if (typeof value['@language'] === 'string' && hasOnly(value, ['@value', '@language'])) return { kind: 'langText', text, language: value['@language'] }
    if (typeof value['@type'] === 'string' && hasOnly(value, ['@value', '@type'])) return { kind: 'typed', text, type: value['@type'] }
  }
  const id = [value['@id'], value.id].find((candidate): candidate is string => typeof candidate === 'string')
  if (id != null && Object.keys(value).length === 1) return /^https?:\/\//.test(id) ? { kind: 'link', href: id } : { kind: 'reference', id, label: humaniseName(id) }
  const unit = value['gs1:unitCode']
  const amount = value['gs1:value']
  if (typeof unit === 'string' && (typeof amount === 'string' || typeof amount === 'number') && hasOnly(value, ['type', '@type', 'gs1:value', 'gs1:unitCode'])) {
    return { kind: 'quantity', value: String(amount), unitCode: unit, unitName: unitName(unit) }
  }
  const type = [value.type, value['@type']].find((candidate) => typeof candidate === 'string' || Array.isArray(candidate))
  return {
    kind: 'object',
    ...(type == null ? {} : { type: Array.isArray(type) ? type.join(', ') : (type as string) }),
    ...(id == null ? {} : { id }),
    entries: Object.entries(value)
      .filter(([key]) => !['type', '@type', 'id', '@id'].includes(key))
      .map(([key, member]) => ({ key, label: labels.get(key) ?? humaniseName(key), value: describeValue(member, labels) })),
  }
}

/** Labels for the members every product document has, whatever its profile. */
const COMMON_LABELS: Record<string, string> = {
  '@context': 'Contexts',
  id: 'Identifier',
  '@id': 'Identifier',
  type: 'Type',
  '@type': 'Type',
  'gs1:gtin': 'GTIN',
  'gs1:hasSerialNumber': 'Serial',
  'schema:serialNumber': 'Serial',
  'oec:granularityLevel': 'Granularity',
}
const labelFor = (labels: Map<string, string>, key: string): string => COMMON_LABELS[key] ?? labels.get(key) ?? humaniseName(key)

export interface ShownProperty {
  key: string
  label: string
  /** Where the property was read from: the public payload on chain, or the restricted part the holder opened. */
  tier: 'public' | 'restricted'
  /** The property is in the public payload although the binding does not list it as public. The validation reports the same as a disclosure. */
  disclosed?: boolean
  value: Shown
}

/**
 * The top-level properties of a product document for a reader's page, each
 * with its tier. A property read from the public payload is public, because
 * it is on chain for anyone. A property read from the restricted part is
 * restricted. Every property of both parts is listed.
 */
export function describeProduct(parts: { publicProduct: Json; restrictedProduct?: Json; access?: { public: string[] } }, labels: Map<string, string> = new Map()): ShownProperty[] {
  const shown: ShownProperty[] = []
  for (const [key, value] of Object.entries(parts.publicProduct)) {
    const disclosed = parts.access != null && !parts.access.public.includes(key)
    shown.push({ key, label: labelFor(labels, key), tier: 'public', ...(disclosed ? { disclosed } : {}), value: describeValue(value, labels) })
  }
  for (const [key, value] of Object.entries(parts.restrictedProduct ?? {})) {
    // The restricted part repeats the product's identifier so the two can be rejoined; it is already shown.
    if (Object.hasOwn(parts.publicProduct, key)) continue
    shown.push({ key, label: labelFor(labels, key), tier: 'restricted', value: describeValue(value, labels) })
  }
  return shown
}
