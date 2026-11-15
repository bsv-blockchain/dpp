import { Utils } from '@bsv/sdk'

/**
 * The EPCIS helpers two modules share: the parked directly signed event
 * (`epcisEvent.ts`, `spec/epcis-event-profile.md`) and the EPCIS lifecycle
 * claim (`lifecycleEvent.ts`, `spec/epcis-lifecycle-claim.md`). They moved
 * here from the parked module unchanged, which re-exports every one of them
 * under its old name, so its behaviour, tests and vectors are untouched. This
 * module is not exported from the package root.
 */

/** The pinned EPCIS 2.0.1 context, named by its versioned IRI. */
export const EPCIS_CONTEXT_IRI = 'https://ref.gs1.org/standards/epcis/2.0.1/epcis-context.jsonld' as const
export const EPCIS_EVENT_TYPES = ['ObjectEvent', 'AggregationEvent', 'TransformationEvent', 'TransactionEvent', 'AssociationEvent'] as const
export type EpcisEventType = (typeof EPCIS_EVENT_TYPES)[number]

/**
 * The prefixes the pinned EPCIS 2.0.1 context declares, which an event's
 * extension members may use without an inline context. Held equal to the
 * pinned context by a test.
 */
export const EPCIS_CONTEXT_PREFIXES: Readonly<Record<string, string>> = {
  epcis: 'https://ref.gs1.org/epcis/',
  cbv: 'https://ref.gs1.org/cbv/',
  cbvmda: 'urn:epcglobal:cbv:mda:',
  gs1: 'https://ref.gs1.org/voc/',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  dcterms: 'http://purl.org/dc/terms/',
}

export type EpcisEventHashCode = 'event-hash-unsupported' | 'error-declaration-unsupported' | 'schema-invalid'

/** A refusal to compute a hash ID, by name: the clause and the member it stops at. */
export class EpcisEventHashError extends Error {
  constructor(readonly code: EpcisEventHashCode, readonly path: string, detail: string) {
    super(`${code}: ${path}: ${detail}`)
    this.name = 'EpcisEventHashError'
  }
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
type JsonObject = { [key: string]: Json }

const unsupported = (path: string, detail: string): never => { throw new EpcisEventHashError('event-hash-unsupported', path, detail) }

// ---------------------------------------------------------------------------
// Identifiers: rules 16 and 17 with the @1 scope (profile §3)
// ---------------------------------------------------------------------------

/** The GS1 modulo-10 check digit of a digit string. */
export function gs1CheckDigit(digits: string): string {
  let sum = 0
  let weight = 3
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * weight
    weight = weight === 3 ? 1 : 3
  }
  return String((10 - (sum % 10)) % 10)
}

const SERIAL = /^[A-Za-z0-9._-]+$/
const DL_HOST = 'https://id.gs1.org'
/** The key and qualifier pairs rule 17 keeps, by primary key: the qualifiers in fine-to-coarse order. */
const DL_KEYS: Readonly<Record<string, { value: RegExp; qualifiers: string[] }>> = {
  '00': { value: /^\d{18}$/, qualifiers: [] },
  '01': { value: /^\d{14}$/, qualifiers: ['21', '235', '10'] },
  '253': { value: /^\d{13}[A-Za-z0-9._-]{0,17}$/, qualifiers: [] },
  '255': { value: /^\d{13}\d{0,12}$/, qualifiers: [] },
  '401': { value: /^[A-Za-z0-9._-]{1,30}$/, qualifiers: [] },
  '402': { value: /^\d{17}$/, qualifiers: [] },
  '414': { value: /^\d{13}$/, qualifiers: ['254'] },
  '417': { value: /^\d{13}$/, qualifiers: [] },
  '8003': { value: /^\d{14}[A-Za-z0-9._-]{0,16}$/, qualifiers: [] },
  '8004': { value: /^[A-Za-z0-9._-]{1,30}$/, qualifiers: [] },
  '8006': { value: /^\d{18}$/, qualifiers: ['21', '10'] },
  '8010': { value: /^[A-Z0-9#\-/.]{1,30}$/, qualifiers: ['8011'] },
  '8017': { value: /^\d{18}$/, qualifiers: [] },
  '8018': { value: /^\d{18}$/, qualifiers: [] },
}
/** Qualifiers a Digital Link URI may carry that rule 17 drops without refusing: the consumer product variant. */
const DL_DROPPED_QUALIFIERS = new Set(['22'])

function serialComponent(value: string, path: string, what: string): string {
  if (!SERIAL.test(value)) return unsupported(path, `the ${what} ${value} uses characters outside the @1 subset`)
  return value
}

/**
 * An EPC URI of the `@1` subset as its canonical GS1 Digital Link URI (rule
 * 16), or a refusal naming the scheme: `sgtin`, `lgtin` (class), the `sgtin`
 * pattern, `sscc`, `sgln`, `pgln`, `grai`, `giai`, `gsrn`, `gdti` and `cpi`.
 */
export function epcUriToDigitalLink(uri: string, path = 'identifier'): string {
  let m: RegExpExecArray | null
  const gtin = (prefix: string, itemRef: string): string => {
    if (prefix.length + itemRef.length !== 13) return unsupported(path, `${uri}: company prefix and item reference must total 13 digits`)
    const raw = itemRef[0] + prefix + itemRef.slice(1)
    return raw + gs1CheckDigit(raw)
  }
  const thirteen = (prefix: string, ref: string, what: string): string => {
    if (prefix.length + ref.length !== 12) return unsupported(path, `${uri}: company prefix and ${what} must total 12 digits`)
    return prefix + ref + gs1CheckDigit(prefix + ref)
  }
  if ((m = /^urn:epc:id:sgtin:(\d{6,12})\.(\d+)\.(.+)$/.exec(uri)) != null) {
    return `${DL_HOST}/01/${gtin(m[1], m[2])}/21/${serialComponent(m[3], path, 'serial')}`
  }
  if ((m = /^urn:epc:class:lgtin:(\d{6,12})\.(\d+)\.(.+)$/.exec(uri)) != null) {
    return `${DL_HOST}/01/${gtin(m[1], m[2])}/10/${serialComponent(m[3], path, 'lot')}`
  }
  if ((m = /^urn:epc:idpat:sgtin:(\d{6,12})\.(\d+)\.\*$/.exec(uri)) != null) {
    return `${DL_HOST}/01/${gtin(m[1], m[2])}`
  }
  if ((m = /^urn:epc:id:sscc:(\d{6,12})\.(\d+)$/.exec(uri)) != null) {
    if (m[1].length + m[2].length !== 17) return unsupported(path, `${uri}: company prefix and serial reference must total 17 digits`)
    const raw = m[2][0] + m[1] + m[2].slice(1)
    return `${DL_HOST}/00/${raw}${gs1CheckDigit(raw)}`
  }
  if ((m = /^urn:epc:id:sgln:(\d{6,12})\.(\d*)\.(.+)$/.exec(uri)) != null) {
    const gln = thirteen(m[1], m[2], 'location reference')
    if (m[3] === '0') return `${DL_HOST}/414/${gln}`
    return `${DL_HOST}/414/${gln}/254/${serialComponent(m[3], path, 'extension')}`
  }
  if ((m = /^urn:epc:id:pgln:(\d{6,12})\.(\d*)$/.exec(uri)) != null) {
    return `${DL_HOST}/417/${thirteen(m[1], m[2], 'party reference')}`
  }
  if ((m = /^urn:epc:id:grai:(\d{6,12})\.(\d*)\.(.+)$/.exec(uri)) != null) {
    if (m[1].length + m[2].length !== 12) return unsupported(path, `${uri}: company prefix and asset type must total 12 digits`)
    const raw = `0${m[1]}${m[2]}`
    return `${DL_HOST}/8003/${raw}${gs1CheckDigit(raw)}${serialComponent(m[3], path, 'serial')}`
  }
  if ((m = /^urn:epc:id:giai:(\d{6,12})\.(.+)$/.exec(uri)) != null) {
    return `${DL_HOST}/8004/${m[1]}${serialComponent(m[2], path, 'asset reference')}`
  }
  if ((m = /^urn:epc:id:gsrn:(\d{6,12})\.(\d+)$/.exec(uri)) != null) {
    if (m[1].length + m[2].length !== 17) return unsupported(path, `${uri}: company prefix and service reference must total 17 digits`)
    return `${DL_HOST}/8018/${m[1]}${m[2]}${gs1CheckDigit(m[1] + m[2])}`
  }
  if ((m = /^urn:epc:id:gdti:(\d{6,12})\.(\d*)\.(.+)$/.exec(uri)) != null) {
    return `${DL_HOST}/253/${thirteen(m[1], m[2], 'document type')}${serialComponent(m[3], path, 'serial')}`
  }
  if ((m = /^urn:epc:id:cpi:(\d{6,12})\.([A-Z0-9#\-/.]+)\.(\d+)$/.exec(uri)) != null) {
    return `${DL_HOST}/8010/${m[1]}${m[2]}/8011/${m[3]}`
  }
  return unsupported(path, `${uri}: EPC scheme outside the @1 subset`)
}

/**
 * A GS1 Digital Link URI in constrained canonical form (rule 17): the host
 * replaced by `id.gs1.org`, query and fragment dropped, and only the most
 * fine-grained key and qualifier pair kept. A URL whose path carries no GS1
 * key is not a Digital Link and is returned as it came.
 */
export function constrainedCanonicalDigitalLink(url: string, path = 'identifier'): string {
  const match = /^https?:\/\/[^/?#]+(\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/.exec(url)
  if (match == null) return url
  const segments = (match[1] ?? '').split('/').filter((s) => s.length > 0)
  const keyIndex = segments.findIndex((s) => DL_KEYS[s] != null)
  if (keyIndex === -1) {
    if (segments.some((s) => /^(gtin|itip|cpid|gln|party|gsrnp|gsrn|gcn|sscc|gdti|ginc|gsin|grai|giai|cpv|lot|ser)$/.test(s))) {
      return unsupported(path, `${url}: Digital Link short names are outside the @1 subset`)
    }
    return url
  }
  const key = segments[keyIndex]
  const rule = DL_KEYS[key]
  const value = segments[keyIndex + 1]
  if (value == null || !rule.value.test(value)) return unsupported(path, `${url}: the ${key} value is not in canonical form`)
  const qualifiers = new Map<string, string>()
  for (let i = keyIndex + 2; i < segments.length; i += 2) {
    const q = segments[i]
    const v = segments[i + 1]
    if (v == null || !(rule.qualifiers.includes(q) || DL_DROPPED_QUALIFIERS.has(q)) || !SERIAL.test(v)) {
      return unsupported(path, `${url}: ${q} is not a qualifier rule 17 keeps for ${key}`)
    }
    qualifiers.set(q, v)
  }
  const kept = rule.qualifiers.find((q) => qualifiers.has(q))
  return kept == null ? `${DL_HOST}/${key}/${value}` : `${DL_HOST}/${key}/${value}/${kept}/${qualifiers.get(kept)}`
}

/** An identifier as the pre-hash string carries it: EPC URIs converted, Digital Links constrained, anything else verbatim. */
export function canonicalEpcisIdentifier(value: string, path = 'identifier'): string {
  if (value.startsWith('urn:epc:')) return epcUriToDigitalLink(value, path)
  if (value.startsWith('https://') || value.startsWith('http://')) return constrainedCanonicalDigitalLink(value, path)
  return value
}

// ---------------------------------------------------------------------------
// Strict JSON
// ---------------------------------------------------------------------------

export interface StrictJsonLimits { maxBytes?: number; maxDepth?: number }

/**
 * A strict JSON parse for the credential and the JWS header: UTF-8 with
 * malformed sequences refused, duplicate member names refused, nesting bounded,
 * and a number literal refused when a double cannot carry its digits exactly,
 * so the value a verifier hashes is the value the signer wrote.
 */
export function parseStrictJson(input: string | number[], limits: StrictJsonLimits = {}): unknown {
  const maxBytes = limits.maxBytes ?? 2 * 1024 * 1024
  const maxDepth = limits.maxDepth ?? 64
  let text: string
  if (typeof input === 'string') {
    text = input
    if (Utils.toArray(text, 'utf8').length > maxBytes) throw new Error(`input exceeds ${maxBytes} bytes`)
  } else {
    if (input.length > maxBytes) throw new Error(`input exceeds ${maxBytes} bytes`)
    text = Utils.toUTF8(input)
    if (Utils.toHex(Utils.toArray(text, 'utf8')) !== Utils.toHex(input)) throw new Error('input is not well-formed UTF-8')
  }
  let at = 0
  const fail = (detail: string): never => { throw new Error(`invalid JSON at offset ${at}: ${detail}`) }
  const ws = (): void => { while (at < text.length && ' \t\n\r'.includes(text[at])) at++ }
  const str = (): string => {
    if (text[at] !== '"') return fail('expected a string')
    let out = ''
    at++
    for (;;) {
      if (at >= text.length) return fail('unterminated string')
      const c = text[at++]
      if (c === '"') return out
      if (c === '\\') {
        const e = text[at++]
        if (e === 'u') {
          const hex = text.slice(at, at + 4)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return fail('bad unicode escape')
          out += String.fromCharCode(parseInt(hex, 16))
          at += 4
        } else {
          const map: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
          if (map[e] == null) return fail('bad escape')
          out += map[e]
        }
      } else if (c.charCodeAt(0) < 0x20) {
        return fail('control character in string')
      } else {
        out += c
      }
    }
  }
  const value = (depth: number): Json => {
    if (depth > maxDepth) return fail(`nesting deeper than ${maxDepth}`)
    ws()
    const c = text[at]
    if (c === '{') {
      at++
      const obj: JsonObject = {}
      ws()
      if (text[at] === '}') { at++; return obj }
      for (;;) {
        ws()
        const key = str()
        if (Object.prototype.hasOwnProperty.call(obj, key)) return fail(`duplicate member ${key}`)
        ws()
        if (text[at++] !== ':') return fail('expected a colon')
        obj[key] = value(depth + 1)
        ws()
        const n = text[at++]
        if (n === '}') return obj
        if (n !== ',') return fail('expected a comma or a closing brace')
      }
    }
    if (c === '[') {
      at++
      const arr: Json[] = []
      ws()
      if (text[at] === ']') { at++; return arr }
      for (;;) {
        arr.push(value(depth + 1))
        ws()
        const n = text[at++]
        if (n === ']') return arr
        if (n !== ',') return fail('expected a comma or a closing bracket')
      }
    }
    if (c === '"') return str()
    if (text.startsWith('true', at)) { at += 4; return true }
    if (text.startsWith('false', at)) { at += 5; return false }
    if (text.startsWith('null', at)) { at += 4; return null }
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at))
    if (m == null) return fail('unexpected token')
    at += m[0].length
    const n = Number(m[0])
    if (!Number.isFinite(n) || decimalForm(m[0]) !== decimalForm(String(n))) return fail(`the number ${m[0]} cannot be carried exactly`)
    return n
  }
  const result = value(0)
  ws()
  if (at !== text.length) fail('trailing content')
  return result
}

/** The exact decimal a literal denotes, as sign, digits without trailing zeros and a decimal exponent, so two spellings of one value compare equal. */
function decimalForm(literal: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(literal)
  if (m == null) return literal
  let digits = m[2] + (m[3] ?? '')
  let exponent = Number(m[4] ?? '0') - (m[3]?.length ?? 0)
  digits = digits.replace(/^0+(?=\d)/, '')
  while (digits.length > 1 && digits.endsWith('0')) { digits = digits.slice(0, -1); exponent++ }
  if (digits === '0') return '0'
  return `${m[1]}${digits}e${exponent}`
}
