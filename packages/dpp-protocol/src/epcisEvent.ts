import { BigNumber, CachedKeyDeriver, Hash, PublicKey, Signature, Utils, type WalletProtocol } from '@bsv/sdk'
import { compareCodePoints } from './canonicalJson.js'
import { identityKeyFromDidKey } from './did.js'
import type { ExternalCredentialVerification, ExternalCredentialVerifier, PartialCheck } from './evidence.js'
import type { DataSigner } from './signatures.js'

/**
 * The directly signed EPCIS event, `epcis-event-vc@1`
 * (`spec/epcis-event-profile.md`): a W3C Verifiable Credential 2.0 whose
 * subject is one EPCIS 2.0 event, whose `id` is the event's CBV 2.0 Event Hash
 * ID, secured as a compact JWS under ES256K by the party that observed or
 * performed the step, and committed by the generic anchor over the exact JWS
 * bytes. No custody model and no mapping sit between the event and its proof.
 *
 * Three things live here. The Event Hash ID (CBV 2.0 §8.9.2) with the scope an
 * implementation of `@1` must cover and what it answers when it cannot; the
 * credential, its signing and its verification with `@bsv/sdk` alone; and the
 * anchor fields a registry derives from a verified credential. Status and DID
 * document resolution are caller-supplied, as they are for every other
 * representation the report takes.
 */

export const EPCIS_EVENT_REPRESENTATION = 'epcis-event-vc@1' as const
export const EPCIS_EVENT_MEDIA_TYPE = 'application/vc+jwt' as const
/** The BRC-42 protocol the party's one published credential key derives under (profile §5). */
export const EPCIS_EVENT_CREDENTIAL_PROTOCOL: WalletProtocol = [1, 'dpp epcis event v1']
export const EPCIS_EVENT_CREDENTIAL_KEY_ID = 'credential' as const
/** The version string of the hash algorithm a hash ID names (CBV 2.0 §8.9.2 rule 23). */
export const EPCIS_EVENT_HASH_VERSION = 'CBV2.0' as const
export const VC_V2_CONTEXT = 'https://www.w3.org/ns/credentials/v2' as const
/** The pinned EPCIS 2.0.1 context, named by its versioned IRI. */
export const EPCIS_CONTEXT_IRI = 'https://ref.gs1.org/standards/epcis/2.0.1/epcis-context.jsonld' as const
/** The unversioned name the EPCIS context is also known by; accepted as a name for the same pinned bytes, never fetched. */
export const EPCIS_CONTEXT_ALIAS = 'https://ref.gs1.org/epcis/' as const
export const EPCIS_EVENT_CREDENTIAL_TYPES = ['DigitalTraceabilityEvent', 'VerifiableCredential'] as const
export const EPCIS_EVENT_TYPES = ['ObjectEvent', 'AggregationEvent', 'TransformationEvent', 'TransactionEvent', 'AssociationEvent'] as const
export type EpcisEventType = (typeof EPCIS_EVENT_TYPES)[number]
export const JWS_ALG_ES256K = 'ES256K' as const
export const JWS_TYP_VC = 'vc+jwt' as const
export const JWS_CTY_VC = 'vc' as const

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

const CBV_WEB = 'https://ref.gs1.org/cbv/'
/** The GS1 Web Vocabulary namespace a bare sensor measurement type expands to (CBV 2.0 §8.9.2 rule 15 as the reference generator applies it). */
const GS1_VOC = 'https://gs1.org/voc/'
const CBV_URN = 'urn:epcglobal:cbv:'

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

const isObject = (value: unknown): value is JsonObject => value != null && typeof value === 'object' && !Array.isArray(value)
const sortStrings = (values: string[]): string[] => [...values].sort(compareCodePoints)
const unsupported = (path: string, detail: string): never => { throw new EpcisEventHashError('event-hash-unsupported', path, detail) }
const invalid = (path: string, detail: string): never => { throw new EpcisEventHashError('schema-invalid', path, detail) }

// ---------------------------------------------------------------------------
// Values: rules 5 to 9 and 14 to 17
// ---------------------------------------------------------------------------

/** Rule 5: whitespace at either end of a value is removed. */
function text(value: Json, path: string): string {
  if (typeof value !== 'string') return invalid(path, 'expected a string')
  const trimmed = value.trim()
  if (trimmed.length === 0) return invalid(path, 'expected a nonempty string')
  return trimmed
}

/** Rules 6 and 7: a number in its shortest decimal form, no trailing zeros, no quotes. */
function number(value: Json, path: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return invalid(path, 'expected a finite number')
  const out = String(value)
  if (/e/i.test(out)) return unsupported(path, 'a number outside plain decimal notation has no agreed pre-hash form under @1')
  return out === '-0' ? '0' : out
}

const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/

/** Rules 8 and 9: UTC, `Z`, millisecond precision, zero-filled. */
function timestamp(value: Json, path: string): string {
  const raw = text(value, path)
  const match = TIMESTAMP.exec(raw)
  if (match == null) return invalid(path, 'expected an ISO 8601 date-time with a timezone')
  const [, year, month, day, hour, minute, second, fraction, zone] = match
  const millis = Number(((fraction ?? '') + '000').slice(0, 3))
  let offsetMinutes = 0
  if (zone !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1
    offsetMinutes = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)))
  }
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate()
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > daysInMonth || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return invalid(path, 'invalid date-time field')
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), millis) - offsetMinutes * 60_000
  if (!Number.isFinite(utc)) return invalid(path, 'invalid date')
  return new Date(utc).toISOString()
}

/**
 * Rules 14 and 15: a CBV vocabulary value in bare or URN spelling expands to
 * its GS1 Web URI; a Web URI is kept; a compact IRI is refused, because the
 * reference generators disagree on it.
 */
function vocabulary(value: Json, path: string, webPrefix: string, urnPrefix: string): string {
  const raw = text(value, path)
  if (raw.startsWith('https://') || raw.startsWith('http://')) return raw
  if (raw.startsWith(CBV_URN)) {
    const rest = raw.slice(CBV_URN.length)
    if (!rest.startsWith(urnPrefix + ':')) return unsupported(path, `${raw} is not a ${urnPrefix} URN`)
    return `${webPrefix}${rest.slice(urnPrefix.length + 1)}`
  }
  if (raw.includes(':') || raw.includes('/')) return unsupported(path, `${raw} is neither a bare vocabulary term nor a Web URI`)
  return `${webPrefix}${raw}`
}

/** A bare GS1 Web Vocabulary term (sensor measurement types and alarm types) or a Web URI. */
function gs1Vocabulary(value: Json, path: string): string {
  const raw = text(value, path)
  if (raw.startsWith('https://') || raw.startsWith('http://')) return raw
  if (raw.includes(':') || raw.includes('/')) return unsupported(path, `${raw} is neither a bare vocabulary term nor a Web URI`)
  return `${GS1_VOC}${raw}`
}

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

function identifier(value: Json, path: string): string {
  return canonicalEpcisIdentifier(text(value, path), path)
}

// ---------------------------------------------------------------------------
// The pre-hash string: rules 1 to 4, 10 to 13 and 18 to 20 over the canonical order
// ---------------------------------------------------------------------------

interface HashContext {
  namespaces: Map<string, string>
  /** Event-level user extension strings, appended sorted after the ordered fields (rules 19 and 20). */
  extensions: string[]
}

/** The members the canonical order names, and the ones the algorithm ignores. */
const ORDERED_MEMBERS = new Set(['type', 'eventTime', 'eventTimeZoneOffset', 'certificationInfo', 'epcList', 'parentID', 'inputEPCList', 'childEPCs', 'quantityList', 'childQuantityList', 'inputQuantityList', 'outputEPCList', 'outputQuantityList', 'action', 'transformationID', 'bizStep', 'disposition', 'persistentDisposition', 'readPoint', 'bizLocation', 'bizTransactionList', 'sourceList', 'destinationList', 'sensorElementList', 'ilmd'])
const IGNORED_MEMBERS = new Set(['eventID', 'recordTime'])

function namespacesFrom(context: unknown, path: string): Map<string, string> {
  const namespaces = new Map(Object.entries(EPCIS_CONTEXT_PREFIXES))
  const entries = Array.isArray(context) ? context : context == null ? [] : [context]
  entries.forEach((entry, index) => {
    if (typeof entry === 'string') {
      if (entry !== EPCIS_CONTEXT_IRI && entry !== EPCIS_CONTEXT_ALIAS && entry !== VC_V2_CONTEXT) unsupported(`${path}[${index}]`, `the context ${entry} is not pinned; only inline prefix declarations are accepted beside the pinned EPCIS context`)
      return
    }
    if (!isObject(entry)) return unsupported(`${path}[${index}]`, 'a context entry is a pinned IRI or an inline object')
    for (const [prefix, iri] of Object.entries(entry)) {
      if (prefix.startsWith('@') || typeof iri !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(prefix) || !/^[a-z][a-z0-9+.-]*:/.test(iri)) {
        return unsupported(`${path}[${index}].${prefix}`, 'an inline context declares prefixes only: a name mapped to a namespace IRI')
      }
      namespaces.set(prefix, iri)
    }
  })
  return namespaces
}

/** Rules 18 and 19: a prefixed member name as `{namespace}localName`. */
function extensionName(key: string, path: string, ctx: HashContext): string {
  const colon = key.indexOf(':')
  if (colon <= 0 || key.startsWith('@')) return unsupported(path, `the member ${key} has no namespace prefix`)
  const prefix = key.slice(0, colon)
  const local = key.slice(colon + 1)
  const iri = ctx.namespaces.get(prefix)
  if (iri == null) return unsupported(path, `the prefix ${prefix} of ${key} is declared by no context the credential carries`)
  if (local.length === 0 || local.includes(':') || local.includes('/')) return unsupported(path, `the member ${key} is not a prefixed name`)
  return `{${iri}}${local}`
}

function extensionValue(name: string, value: Json, path: string, ctx: HashContext): string {
  if (isObject(value)) return `${name}${extensionChildren(value, path, ctx)}`
  if (Array.isArray(value)) {
    return sortStrings(value.map((item, index) => isObject(item) ? `${name}${extensionChildren(item, `${path}[${index}]`, ctx)}` : `${name}=${scalar(item, `${path}[${index}]`)}`)).join('')
  }
  return `${name}=${scalar(value, path)}`
}

function extensionChildren(value: JsonObject, path: string, ctx: HashContext): string {
  return sortStrings(Object.entries(value).map(([key, child]) => extensionValue(extensionName(key, `${path}.${key}`, ctx), child, `${path}.${key}`, ctx))).join('')
}

function scalar(value: Json, path: string): string {
  if (typeof value === 'string') return canonicalEpcisIdentifier(text(value, path), path)
  if (typeof value === 'number') return number(value, path)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return unsupported(path, 'a null value has no pre-hash form')
}

/** Rule 20: an extension inside readPoint or bizLocation, prefixed with the field name and appended with the event-level extensions. */
function fieldExtensions(field: string, value: JsonObject, path: string, ctx: HashContext, known: string[]): void {
  for (const [key, child] of Object.entries(value)) {
    if (known.includes(key)) continue
    ctx.extensions.push(`${field}${extensionValue(extensionName(key, `${path}.${key}`, ctx), child, `${path}.${key}`, ctx)}`)
  }
}

function epcs(value: Json, path: string): string {
  if (!Array.isArray(value)) return invalid(path, 'expected a list')
  if (value.length === 0) return ''
  return sortStrings(value.map((epc, index) => `epc=${identifier(epc, `${path}[${index}]`)}`)).join('')
}

function quantityList(value: Json, path: string, ctx: HashContext): string {
  if (!Array.isArray(value)) return invalid(path, 'expected a list')
  if (value.length === 0) return ''
  return sortStrings(value.map((element, index) => {
    const p = `${path}[${index}]`
    if (!isObject(element)) return invalid(p, 'expected a quantity element')
    noExtensions(element, p, ['epcClass', 'quantity', 'uom'], ctx)
    let out = 'quantityElement'
    if (element.epcClass != null) out += `epcClass=${identifier(element.epcClass, `${p}.epcClass`)}`
    if (element.quantity != null) out += `quantity=${number(element.quantity, `${p}.quantity`)}`
    if (element.uom != null) out += `uom=${text(element.uom, `${p}.uom`)}`
    return out
  })).join('')
}

/** An extension inside a member rule 20 names no extension point for, or inside the sensor elements, has no agreed form under @1. */
function noExtensions(value: JsonObject, path: string, known: string[], _ctx: HashContext): void {
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) unsupported(`${path}.${key}`, `an extension member inside ${path.replace(/\[\d+\]$/, '')} has no agreed pre-hash form under @1`)
  }
}

function typedList(value: Json, path: string, valueName: 'bizTransaction' | 'source' | 'destination', webPrefix: string, urnPrefix: string, ctx: HashContext): string {
  if (!Array.isArray(value)) return invalid(path, 'expected a list')
  if (value.length === 0) return ''
  return sortStrings(value.map((element, index) => {
    const p = `${path}[${index}]`
    if (!isObject(element)) return invalid(p, `expected a ${valueName} element`)
    noExtensions(element, p, ['type', valueName], ctx)
    let out = ''
    if (element.type != null) out += `type=${vocabulary(element.type, `${p}.type`, webPrefix, urnPrefix)}`
    if (element[valueName] == null) return invalid(p, `expected ${valueName}`)
    out += `${valueName}=${identifier(element[valueName], `${p}.${valueName}`)}`
    return out
  })).join('')
}

const SENSOR_METADATA_ORDER = ['time', 'startTime', 'endTime', 'deviceID', 'deviceMetadata', 'rawData', 'dataProcessingMethod', 'bizRules'] as const
const SENSOR_REPORT_ORDER = ['type', 'exception', 'deviceID', 'deviceMetadata', 'rawData', 'dataProcessingMethod', 'time', 'microorganism', 'chemicalSubstance', 'value', 'component', 'stringValue', 'booleanValue', 'hexBinaryValue', 'uriValue', 'minValue', 'maxValue', 'meanValue', 'sDev', 'percRank', 'percValue', 'uom', 'coordinateReferenceSystem'] as const
const SENSOR_TIMES = new Set(['time', 'startTime', 'endTime'])
const SENSOR_NUMBERS = new Set(['value', 'minValue', 'maxValue', 'meanValue', 'sDev', 'percRank', 'percValue'])
const SENSOR_IDENTIFIERS = new Set(['deviceID', 'deviceMetadata', 'rawData', 'dataProcessingMethod', 'bizRules', 'uriValue', 'microorganism', 'chemicalSubstance'])

function sensorFields(value: JsonObject, path: string, order: readonly string[], ctx: HashContext): string {
  noExtensions(value, path, [...order], ctx)
  let out = ''
  for (const field of order) {
    const v = value[field]
    if (v == null) continue
    const p = `${path}.${field}`
    if (SENSOR_TIMES.has(field)) out += `${field}=${timestamp(v, p)}`
    else if (SENSOR_NUMBERS.has(field)) out += `${field}=${number(v, p)}`
    else if (field === 'booleanValue') out += `${field}=${typeof v === 'boolean' ? String(v) : invalid(p, 'expected a boolean')}`
    else if (field === 'type' || field === 'exception') out += `${field}=${gs1Vocabulary(v, p)}`
    else if (field === 'component') out += `${field}=${vocabulary(v, p, `${CBV_WEB}Comp-`, 'comp')}`
    else if (SENSOR_IDENTIFIERS.has(field)) out += `${field}=${identifier(v, p)}`
    else out += `${field}=${text(v, p)}`
  }
  return out
}

function sensorElements(value: Json, path: string, ctx: HashContext): string {
  if (!Array.isArray(value)) return invalid(path, 'expected a list')
  if (value.length === 0) return ''
  return sortStrings(value.map((element, index) => {
    const p = `${path}[${index}]`
    if (!isObject(element)) return invalid(p, 'expected a sensor element')
    noExtensions(element, p, ['sensorMetadata', 'sensorReport'], ctx)
    let out = 'sensorElement'
    if (element.sensorMetadata != null) {
      if (!isObject(element.sensorMetadata)) return invalid(`${p}.sensorMetadata`, 'expected an object')
      out += `sensorMetadata${sensorFields(element.sensorMetadata, `${p}.sensorMetadata`, SENSOR_METADATA_ORDER, ctx)}`
    }
    if (element.sensorReport != null) {
      if (!Array.isArray(element.sensorReport)) return invalid(`${p}.sensorReport`, 'expected a list')
      out += sortStrings(element.sensorReport.map((report, i) => {
        if (!isObject(report)) return invalid(`${p}.sensorReport[${i}]`, 'expected a sensor report')
        return `sensorReport${sensorFields(report, `${p}.sensorReport[${i}]`, SENSOR_REPORT_ORDER, ctx)}`
      })).join('')
    }
    return out
  })).join('')
}

function persistentDisposition(value: Json, path: string, ctx: HashContext): string {
  if (!isObject(value)) return invalid(path, 'expected an object')
  noExtensions(value, path, ['set', 'unset'], ctx)
  const part = (name: 'set' | 'unset'): string => {
    const list = value[name]
    if (list == null) return ''
    if (!Array.isArray(list)) return invalid(`${path}.${name}`, 'expected a list')
    return sortStrings(list.map((d, i) => `${name}=${vocabulary(d, `${path}.${name}[${i}]`, `${CBV_WEB}Disp-`, 'disp')}`)).join('')
  }
  return `persistentDisposition${part('set')}${part('unset')}`
}

function location(field: 'readPoint' | 'bizLocation', value: Json, path: string, ctx: HashContext): string {
  if (!isObject(value)) return invalid(path, 'expected an object')
  if (value.id == null) return invalid(`${path}.id`, 'expected an identifier')
  fieldExtensions(field, value, path, ctx, ['id'])
  return `${field}id=${identifier(value.id, `${path}.id`)}`
}

/**
 * The pre-hash string of one EPCIS 2.0 event under CBV 2.0 §8.9.2, with the
 * `@1` scope rules of the profile: the canonical property order with
 * `certificationInfo` after the time zone offset as the reference generators
 * place it, identifiers canonicalised within the subset, vocabulary expanded
 * from bare and URN spellings, extensions from inline prefix declarations, and
 * a refusal by name wherever the text and the generators leave two answers.
 *
 * `context` is the `@context` the event travels under: the pinned EPCIS
 * context by either of its names and inline prefix objects. Nothing is fetched.
 */
export function epcisEventPreHash(event: unknown, context?: unknown): string {
  if (!isObject(event)) return invalid('event', 'expected an object')
  if (event.errorDeclaration !== undefined) throw new EpcisEventHashError('error-declaration-unsupported', 'event.errorDeclaration', 'an error declaration computes no hash ID of its own (CBV 2.0 §8.9.2) and is not signable under @1')
  if (event['@context'] !== undefined) unsupported('event.@context', 'an event-level context is carried by the credential, not the subject')
  const ctx: HashContext = { namespaces: namespacesFrom(context, 'context'), extensions: [] }
  const type = text(event.type, 'event.type')
  if (!(EPCIS_EVENT_TYPES as readonly string[]).includes(type)) return unsupported('event.type', `${type} is not one of the five EPCIS 2.0 event types`)
  if (event.eventTime == null) return invalid('event.eventTime', 'required')
  if (event.eventTimeZoneOffset == null) return invalid('event.eventTimeZoneOffset', 'required')
  let out = `eventType=${type}`
  out += `eventTime=${timestamp(event.eventTime, 'event.eventTime')}`
  const offset = text(event.eventTimeZoneOffset, 'event.eventTimeZoneOffset')
  if (!/^[+-]\d{2}:\d{2}$/.test(offset)) invalid('event.eventTimeZoneOffset', 'expected +hh:mm or -hh:mm')
  out += `eventTimeZoneOffset=${offset}`
  if (event.certificationInfo != null) {
    if (Array.isArray(event.certificationInfo)) unsupported('event.certificationInfo', 'a list of certifications has no agreed pre-hash form under @1')
    out += `certificationInfo=${text(event.certificationInfo, 'event.certificationInfo')}`
  }
  if (event.epcList != null) out += prefixed('epcList', epcs(event.epcList, 'event.epcList'))
  if (event.parentID != null) out += `parentID=${identifier(event.parentID, 'event.parentID')}`
  if (event.inputEPCList != null) out += prefixed('inputEPCList', epcs(event.inputEPCList, 'event.inputEPCList'))
  if (event.childEPCs != null) out += prefixed('childEPCs', epcs(event.childEPCs, 'event.childEPCs'))
  if (event.quantityList != null) out += prefixed('quantityList', quantityList(event.quantityList, 'event.quantityList', ctx))
  if (event.childQuantityList != null) out += prefixed('childQuantityList', quantityList(event.childQuantityList, 'event.childQuantityList', ctx))
  if (event.inputQuantityList != null) out += prefixed('inputQuantityList', quantityList(event.inputQuantityList, 'event.inputQuantityList', ctx))
  if (event.outputEPCList != null) out += prefixed('outputEPCList', epcs(event.outputEPCList, 'event.outputEPCList'))
  if (event.outputQuantityList != null) out += prefixed('outputQuantityList', quantityList(event.outputQuantityList, 'event.outputQuantityList', ctx))
  if (event.action != null) {
    const action = text(event.action, 'event.action')
    if (!['ADD', 'OBSERVE', 'DELETE'].includes(action)) invalid('event.action', 'expected ADD, OBSERVE or DELETE')
    out += `action=${action}`
  }
  if (event.transformationID != null) out += `transformationID=${text(event.transformationID, 'event.transformationID')}`
  if (event.bizStep != null) out += `bizStep=${vocabulary(event.bizStep, 'event.bizStep', `${CBV_WEB}BizStep-`, 'bizstep')}`
  if (event.disposition != null) out += `disposition=${vocabulary(event.disposition, 'event.disposition', `${CBV_WEB}Disp-`, 'disp')}`
  if (event.persistentDisposition != null) out += persistentDisposition(event.persistentDisposition, 'event.persistentDisposition', ctx)
  if (event.readPoint != null) out += location('readPoint', event.readPoint, 'event.readPoint', ctx)
  if (event.bizLocation != null) out += location('bizLocation', event.bizLocation, 'event.bizLocation', ctx)
  if (event.bizTransactionList != null) out += prefixed('bizTransactionList', typedList(event.bizTransactionList, 'event.bizTransactionList', 'bizTransaction', `${CBV_WEB}BTT-`, 'btt', ctx))
  if (event.sourceList != null) out += prefixed('sourceList', typedList(event.sourceList, 'event.sourceList', 'source', `${CBV_WEB}SDT-`, 'sdt', ctx))
  if (event.destinationList != null) out += prefixed('destinationList', typedList(event.destinationList, 'event.destinationList', 'destination', `${CBV_WEB}SDT-`, 'sdt', ctx))
  if (event.sensorElementList != null) out += prefixed('sensorElementList', sensorElements(event.sensorElementList, 'event.sensorElementList', ctx))
  if (event.ilmd != null) {
    if (!isObject(event.ilmd)) invalid('event.ilmd', 'expected an object')
    out += `ilmd${extensionChildren(event.ilmd as JsonObject, 'event.ilmd', ctx)}`
  }
  for (const [key, value] of Object.entries(event)) {
    if (ORDERED_MEMBERS.has(key) || IGNORED_MEMBERS.has(key)) continue
    ctx.extensions.push(extensionValue(extensionName(key, `event.${key}`, ctx), value, `event.${key}`, ctx))
  }
  return out + sortStrings(ctx.extensions).join('')
}

/** Rule 4: an empty list adds nothing, not even its name. */
const prefixed = (name: string, body: string): string => (body.length === 0 ? '' : `${name}${body}`)

/** The Event Hash ID (rules 21 to 23): `ni:///sha-256;<hex>?ver=CBV2.0` over the UTF-8 pre-hash string. */
export function epcisEventHashId(event: unknown, context?: unknown): { hashId: string; preHash: string } {
  const preHash = epcisEventPreHash(event, context)
  return { hashId: `ni:///sha-256;${Utils.toHex(Hash.sha256(Utils.toArray(preHash, 'utf8')))}?ver=${EPCIS_EVENT_HASH_VERSION}`, preHash }
}

/** Every object identifier an event names, canonical, sorted; the anchor's `subject` is the first (profile §6). */
export function epcisEventSubjects(event: unknown): string[] {
  if (!isObject(event)) return []
  const out = new Set<string>()
  const take = (value: Json | undefined, path: string): void => {
    if (value == null) return
    if (Array.isArray(value)) value.forEach((v, i) => { if (typeof v === 'string') out.add(canonicalEpcisIdentifier(v.trim(), `${path}[${i}]`)) })
    else if (typeof value === 'string') out.add(canonicalEpcisIdentifier(value.trim(), path))
  }
  take(event.parentID, 'event.parentID')
  for (const list of ['epcList', 'childEPCs', 'inputEPCList', 'outputEPCList'] as const) take(event[list], `event.${list}`)
  for (const list of ['quantityList', 'childQuantityList', 'inputQuantityList', 'outputQuantityList'] as const) {
    const q = event[list]
    if (Array.isArray(q)) q.forEach((e, i) => { if (isObject(e)) take(e.epcClass, `event.${list}[${i}].epcClass`) })
  }
  return sortStrings([...out])
}

// ---------------------------------------------------------------------------
// Strict JSON and base64url
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

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function base64UrlEncode(bytes: number[]): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += B64URL[a >> 2] + B64URL[((a & 3) << 4) | ((b ?? 0) >> 4)]
    if (b != null) out += B64URL[((b & 15) << 2) | ((c ?? 0) >> 6)]
    if (c != null) out += B64URL[c & 63]
  }
  return out
}

/** Strict: the base64url alphabet only, no padding, and no length a byte string cannot produce. */
export function base64UrlDecode(encoded: string): number[] {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded) || encoded.length % 4 === 1) throw new Error('not base64url')
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (const ch of encoded) {
    buffer = (buffer << 6) | B64URL.indexOf(ch)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
    }
  }
  if ((buffer & ((1 << bits) - 1)) !== 0) throw new Error('not canonical base64url')
  return out
}

// ---------------------------------------------------------------------------
// The credential (profile §2)
// ---------------------------------------------------------------------------

export interface EpcisEventCredential {
  '@context': [typeof VC_V2_CONTEXT, typeof EPCIS_CONTEXT_IRI, ...Record<string, string>[]]
  type: [typeof EPCIS_EVENT_CREDENTIAL_TYPES[0], typeof EPCIS_EVENT_CREDENTIAL_TYPES[1]]
  /** The Event Hash ID. */
  id: string
  issuer: string
  validFrom: string
  validUntil?: string
  credentialStatus?: Record<string, unknown>
  /** The EPCIS event, exactly as the party holds it. */
  credentialSubject: Record<string, unknown>
}

export interface BuildEpcisEventCredentialInput {
  event: unknown
  /** Inline prefix declarations the event's extension members need, carried after the pinned EPCIS context. */
  extensionContexts?: Record<string, string>[]
  issuer: string
  validFrom: string
  validUntil?: string
  credentialStatus?: Record<string, unknown>
}

const DID = /^did:[a-z0-9]+:(?:[A-Za-z0-9._:-]|%[0-9A-Fa-f]{2})*(?:[A-Za-z0-9._-]|%[0-9A-Fa-f]{2})$/

/**
 * The credential before enveloping: the pinned contexts, the two types, the
 * Event Hash ID as `id`, the party as `issuer`, and the event as the subject.
 * The hash is computed here, so an event the profile cannot hash is refused
 * before anything is signed, and an `eventID` that is itself a hash ID must be
 * this one.
 */
export function buildEpcisEventCredential(input: BuildEpcisEventCredentialInput): EpcisEventCredential {
  const extensionContexts = input.extensionContexts ?? []
  const { hashId } = epcisEventHashId(input.event, [EPCIS_CONTEXT_IRI, ...extensionContexts])
  const event = input.event as Record<string, unknown>
  if (typeof event.eventID === 'string' && event.eventID.startsWith('ni:///') && event.eventID !== hashId) {
    throw new EpcisEventHashError('schema-invalid', 'event.eventID', `the event names the hash ID ${event.eventID} and hashes to ${hashId}`)
  }
  if (!DID.test(input.issuer)) throw new Error('issuer must be a DID without a path, query or fragment')
  if (!TIMESTAMP.test(input.validFrom)) throw new Error('validFrom must be an ISO 8601 date-time with a timezone')
  if (input.validUntil != null && !TIMESTAMP.test(input.validUntil)) throw new Error('validUntil must be an ISO 8601 date-time with a timezone')
  return {
    '@context': [VC_V2_CONTEXT, EPCIS_CONTEXT_IRI, ...extensionContexts],
    type: [EPCIS_EVENT_CREDENTIAL_TYPES[0], EPCIS_EVENT_CREDENTIAL_TYPES[1]],
    id: hashId,
    issuer: input.issuer,
    validFrom: input.validFrom,
    ...(input.validUntil == null ? {} : { validUntil: input.validUntil }),
    ...(input.credentialStatus == null ? {} : { credentialStatus: input.credentialStatus }),
    credentialSubject: event,
  }
}

/** The party's one published credential key: the BRC-42 child of its identity key under the profile's protocol (profile §5). */
export function epcisEventCredentialKey(identityKey: string): string {
  return new CachedKeyDeriver('anyone').derivePublicKey(EPCIS_EVENT_CREDENTIAL_PROTOCOL, EPCIS_EVENT_CREDENTIAL_KEY_ID, identityKey).toString()
}

/** A DER ECDSA signature as the 64 fixed-width octets `r || s` JOSE requires (RFC 8812 §3.2). */
export function derToJoseSignature(der: number[]): number[] {
  const signature = Signature.fromDER(der)
  return [...signature.r.toArray('be', 32), ...signature.s.toArray('be', 32)]
}

export function joseToDerSignature(raw: number[]): Signature {
  if (raw.length !== 64) throw new Error('an ES256K signature is 64 octets')
  return new Signature(new BigNumber(raw.slice(0, 32)), new BigNumber(raw.slice(32)))
}

/**
 * Sign a credential as a compact JWS under ES256K (VC-JOSE-COSE): header
 * `alg`, `typ` `vc+jwt`, `cty` `vc` and `kid`, the credential as the whole
 * payload, the signature over the ASCII signing input. The signer is a wallet
 * or a `ProtoWallet` whose `createSignature` hashes the signing input once and
 * signs with the party's credential key; no private key is handled here. The
 * returned string's bytes are the committed representation.
 */
export async function signEpcisEventCredential(credential: EpcisEventCredential, options: { kid: string; signer: DataSigner }): Promise<string> {
  if (!options.kid.startsWith(`${credential.issuer}#`)) throw new Error('kid must name a verification method of the issuer')
  return signEpcisEventJws(JSON.stringify(credential), options)
}

/**
 * The enveloping step alone, over a payload the caller has already
 * serialised: the bytes given are the bytes signed and committed. Used by the
 * credential signer above and by vectors that pin a re-serialised copy.
 */
export async function signEpcisEventJws(payload: string, options: { kid: string; signer: DataSigner }): Promise<string> {
  if (!/^did:[a-z0-9]+:[^#\s]+#[^#\s]+$/.test(options.kid)) throw new Error('kid must be a DID URL naming a verification method')
  const header = base64UrlEncode(Utils.toArray(JSON.stringify({ alg: JWS_ALG_ES256K, typ: JWS_TYP_VC, cty: JWS_CTY_VC, kid: options.kid }), 'utf8'))
  const signingInput = `${header}.${base64UrlEncode(Utils.toArray(payload, 'utf8'))}`
  const { signature } = await options.signer.createSignature({
    data: Utils.toArray(signingInput, 'utf8'),
    protocolID: EPCIS_EVENT_CREDENTIAL_PROTOCOL,
    keyID: EPCIS_EVENT_CREDENTIAL_KEY_ID,
    counterparty: 'anyone',
  })
  return `${signingInput}.${base64UrlEncode(derToJoseSignature(signature))}`
}

// ---------------------------------------------------------------------------
// Verification (profile §7)
// ---------------------------------------------------------------------------

export interface EpcisEventVerificationOptions {
  /** The evaluation time; the credential's validity interval is judged against it. */
  checkedAt?: string
  /**
   * The compressed secp256k1 key a `kid` names, as hex, or `undefined` when
   * the resolver does not know it. A `did:key` kid resolves without this.
   */
  resolveKey?: (kid: string, issuer: string) => Promise<string | undefined> | string | undefined
  /** The status check for a credential that carries `credentialStatus`; absent, status is `unknown`. */
  statusVerifier?: (entry: Record<string, unknown>, credential: EpcisEventCredential, checkedAt: string) => Promise<PartialCheck> | PartialCheck
  /** The pinned EPCIS 2.0.1 schema check of the subject; absent, the schema check is `unknown` once the shape held. */
  eventSchemaValidator?: (event: Record<string, unknown>) => Promise<PartialCheck> | PartialCheck
  /** The issuer authority policy; absent, `authority-not-required`. */
  authorityVerifier?: (issuer: string, credential: EpcisEventCredential, checkedAt: string) => Promise<PartialCheck> | PartialCheck
  /** The byte bound of the compact JWS; the profile's default is 2 MiB. */
  maxBytes?: number
}

export interface EpcisEventVerification extends ExternalCredentialVerification {
  representation: typeof EPCIS_EVENT_REPRESENTATION
  mediaType: typeof EPCIS_EVENT_MEDIA_TYPE
  /** SHA-256 of the exact JWS bytes: the anchor's digest. */
  digest: string
  /** Present once the JWS and the credential decoded; the verified signature says nothing more than `proof` does. */
  credential?: EpcisEventCredential
  header?: { alg: string; typ: string; cty: string; kid: string }
  hashId?: string
  preHash?: string
  /** The compressed key the signature was checked against. */
  verificationKey?: string
}

const pass = (detail?: unknown): PartialCheck => ({ status: 'pass', ...(detail == null ? {} : { detail }) })
const fail = (reasonCode: string, detail?: unknown): PartialCheck => ({ status: 'fail', reasonCode, ...(detail == null ? {} : { detail }) })
const unknown = (reasonCode: string, detail?: unknown): PartialCheck => ({ status: 'unknown', reasonCode, ...(detail == null ? {} : { detail }) })

function asciiBytes(value: string | number[]): number[] {
  const bytes = typeof value === 'string' ? Utils.toArray(value, 'utf8') : value
  for (const b of bytes) if (b < 0x21 || b > 0x7e) throw new Error('a compact JWS is printable ASCII')
  return bytes
}

/** The credential members `@1` admits, so a member the profile does not define is a shape failure rather than a silent pass. */
const CREDENTIAL_MEMBERS = new Set(['@context', 'type', 'id', 'issuer', 'validFrom', 'validUntil', 'credentialStatus', 'credentialSubject'])

function credentialShape(value: unknown): EpcisEventCredential {
  if (!isObject(value)) throw new Error('the payload is not an object')
  for (const key of Object.keys(value)) if (!CREDENTIAL_MEMBERS.has(key)) throw new Error(`the member ${key} is not part of the profile`)
  const context = value['@context']
  if (!Array.isArray(context) || context.length < 2 || context[0] !== VC_V2_CONTEXT || (context[1] !== EPCIS_CONTEXT_IRI && context[1] !== EPCIS_CONTEXT_ALIAS)) {
    throw new Error('@context must open with the VC 2.0 context and the pinned EPCIS context')
  }
  for (const entry of context.slice(2)) if (!isObject(entry)) throw new Error('every context after the two pinned ones is an inline prefix object')
  const types = value.type
  if (!Array.isArray(types) || types.length !== 2 || !types.includes(EPCIS_EVENT_CREDENTIAL_TYPES[0]) || !types.includes(EPCIS_EVENT_CREDENTIAL_TYPES[1])) {
    throw new Error('type must be DigitalTraceabilityEvent and VerifiableCredential')
  }
  if (typeof value.id !== 'string' || !/^ni:\/\/\/sha-256;[0-9a-f]{64}\?ver=CBV2\.0$/.test(value.id)) throw new Error('id must be an Event Hash ID under CBV2.0')
  if (typeof value.issuer !== 'string' || !DID.test(value.issuer)) throw new Error('issuer must be a DID')
  if (typeof value.validFrom !== 'string' || !TIMESTAMP.test(value.validFrom)) throw new Error('validFrom must be an ISO 8601 date-time with a timezone')
  if (value.validUntil !== undefined && (typeof value.validUntil !== 'string' || !TIMESTAMP.test(value.validUntil))) throw new Error('validUntil must be an ISO 8601 date-time with a timezone')
  if (value.credentialStatus !== undefined && !isObject(value.credentialStatus)) throw new Error('credentialStatus must be an object')
  if (!isObject(value.credentialSubject)) throw new Error('credentialSubject must be one EPCIS event')
  return value as unknown as EpcisEventCredential
}

/**
 * Verify a compact JWS under the profile and report every finding separately:
 * the JWS and credential shape (`schema`), the hash ID and the signature
 * (`proof`), the validity interval (`time`), the status entry through the
 * supplied verifier (`status`) and the issuer policy (`authority`). Nothing is
 * fetched: a `did:key` kid resolves from its own bytes, any other kid through
 * `resolveKey`, and a kid that resolves to nothing leaves the proof `unknown`.
 */
export async function verifyEpcisEventCredential(jws: string | number[], options: EpcisEventVerificationOptions = {}): Promise<EpcisEventVerification> {
  const checkedAt = options.checkedAt ?? new Date().toISOString()
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024
  let bytes: number[]
  try {
    bytes = asciiBytes(jws)
    if (bytes.length > maxBytes) throw new Error(`the JWS exceeds ${maxBytes} bytes`)
  } catch (cause) {
    bytes = typeof jws === 'string' ? Utils.toArray(jws, 'utf8') : jws
    return refused(bytes, 'schema-invalid', cause)
  }
  const result: EpcisEventVerification = {
    representation: EPCIS_EVENT_REPRESENTATION, mediaType: EPCIS_EVENT_MEDIA_TYPE,
    digest: Utils.toHex(Hash.sha256(bytes)), attestationType: undefined,
    proof: unknown('verifier-not-supplied'), schema: unknown('verifier-not-supplied'), time: unknown('verifier-not-supplied'),
    status: unknown('verifier-not-supplied'), authority: unknown('verifier-not-supplied'),
  }
  const compact = Utils.toUTF8(bytes)
  const parts = compact.split('.')
  let header: EpcisEventVerification['header']
  let credential: EpcisEventCredential
  let signature: number[]
  try {
    if (parts.length !== 3 || parts.some((p) => p.length === 0)) throw new Error('a compact JWS has three nonempty parts')
    const h = parseStrictJson(base64UrlDecode(parts[0]), { maxBytes: 4096, maxDepth: 2 })
    if (!isObject(h)) throw new Error('the header is not an object')
    for (const key of Object.keys(h)) if (!['alg', 'typ', 'cty', 'kid'].includes(key)) throw new Error(`the header member ${key} is not part of the profile`)
    if (h.alg !== JWS_ALG_ES256K) throw new EpcisEventHashError('schema-invalid', 'header.alg', `${String(h.alg)} is not ES256K`)
    if (h.typ !== JWS_TYP_VC || h.cty !== JWS_CTY_VC) throw new Error('typ must be vc+jwt and cty must be vc')
    if (typeof h.kid !== 'string' || !/^did:[a-z0-9]+:[^#\s]+#[^#\s]+$/.test(h.kid)) throw new Error('kid must be a DID URL naming a verification method')
    header = { alg: h.alg, typ: h.typ, cty: h.cty, kid: h.kid }
    credential = credentialShape(parseStrictJson(base64UrlDecode(parts[1]), { maxBytes, maxDepth: 64 }))
    signature = base64UrlDecode(parts[2])
    if (signature.length !== 64) throw new Error('an ES256K signature is 64 octets')
  } catch (cause) {
    const code = cause instanceof EpcisEventHashError && cause.path === 'header.alg' ? 'suite-unsupported' : 'schema-invalid'
    result.schema = fail(code, message(cause))
    result.proof = fail(code, message(cause))
    result.time = unknown('schema-invalid')
    result.status = unknown('schema-invalid')
    result.authority = unknown('schema-invalid')
    return result
  }
  result.header = header
  result.credential = credential
  result.id = credential.id
  result.issuer = credential.issuer
  const event = credential.credentialSubject
  result.attestationType = typeof event.type === 'string' ? event.type : undefined

  // The hash ID, recomputed from the subject under the contexts the credential carries.
  let hashFinding: PartialCheck
  try {
    const { hashId, preHash } = epcisEventHashId(event, credential['@context'])
    result.hashId = hashId
    result.preHash = preHash
    result.subjects = epcisEventSubjects(event)
    if (hashId !== credential.id) hashFinding = fail('event-hash-mismatch', `the subject hashes to ${hashId}`)
    else if (typeof event.eventID === 'string' && event.eventID.startsWith('ni:///') && event.eventID !== hashId) hashFinding = fail('event-hash-mismatch', `the subject's eventID ${event.eventID} is not its hash ID`)
    else hashFinding = pass()
  } catch (cause) {
    hashFinding = cause instanceof EpcisEventHashError ? fail(cause.code === 'schema-invalid' ? 'schema-invalid' : cause.code, cause.message) : fail('schema-invalid', message(cause))
  }

  // The signature, against the key the kid names.
  let signatureFinding: PartialCheck
  try {
    if (!header.kid.startsWith(`${credential.issuer}#`)) throw new Error('kid does not name a verification method of the issuer')
    const key = await resolveVerificationKey(header.kid, credential.issuer, options.resolveKey)
    if (key == null) {
      signatureFinding = unknown('referenced-artefact-unavailable', `no key is known for ${header.kid}`)
    } else {
      result.verificationKey = key
      const ok = PublicKey.fromString(key).verify(Utils.toArray(`${parts[0]}.${parts[1]}`, 'utf8'), joseToDerSignature(signature))
      signatureFinding = ok ? pass() : fail('signature-invalid', `the signature does not verify under ${header.kid}`)
    }
  } catch (cause) {
    signatureFinding = fail('signature-invalid', message(cause))
  }
  result.proof = worst([hashFinding, signatureFinding])

  // Shape held; the EPCIS schema of the subject is the caller's pinned check.
  if (hashFinding.status === 'fail' && hashFinding.reasonCode === 'schema-invalid') result.schema = hashFinding
  else if (options.eventSchemaValidator != null) {
    try { result.schema = await options.eventSchemaValidator(event) } catch (cause) { result.schema = unknown('verifier-not-supplied', message(cause)) }
  } else result.schema = unknown('verifier-not-supplied', 'the credential shape held; the EPCIS 2.0.1 schema of the subject was not checked')

  // Validity interval at the evaluation time.
  const from = Date.parse(credential.validFrom)
  const at = Date.parse(checkedAt)
  if (!Number.isFinite(at)) result.time = unknown('x-checked-at-invalid')
  else if (from > at) result.time = fail('not-yet-valid', credential.validFrom)
  else if (credential.validUntil != null && Date.parse(credential.validUntil) < at) result.time = fail('expired', credential.validUntil)
  else result.time = pass()

  // Status through the supplied verifier; authority through the supplied policy.
  if (credential.credentialStatus == null) result.status = { status: 'not-applicable', reasonCode: 'status-unset', detail: 'the credential carries no status entry' }
  else if (options.statusVerifier == null) result.status = unknown('verifier-not-supplied')
  else {
    try { result.status = await options.statusVerifier(credential.credentialStatus, credential, checkedAt) } catch (cause) { result.status = unknown('verifier-not-supplied', message(cause)) }
  }
  if (options.authorityVerifier == null) result.authority = { status: 'not-applicable', reasonCode: 'authority-not-required', detail: 'no issuer authority policy was supplied' }
  else {
    try { result.authority = await options.authorityVerifier(credential.issuer, credential, checkedAt) } catch (cause) { result.authority = unknown('policy-missing', message(cause)) }
  }
  return result
}

async function resolveVerificationKey(kid: string, issuer: string, resolve: EpcisEventVerificationOptions['resolveKey']): Promise<string | undefined> {
  if (issuer.startsWith('did:key:')) {
    const fragment = kid.slice(issuer.length + 1)
    if (fragment !== issuer.slice('did:key:'.length)) throw new Error('a did:key verification method is the key itself')
    return identityKeyFromDidKey(issuer)
  }
  return resolve == null ? undefined : await resolve(kid, issuer)
}

const ORDER: Record<string, number> = { fail: 0, unknown: 1, 'not-applicable': 2, pass: 3 }
function worst(parts: PartialCheck[]): PartialCheck {
  const sorted = [...parts].sort((a, b) => ORDER[a.status] - ORDER[b.status])
  const first = sorted[0]
  const details = parts.map((p) => p.detail).filter((d) => d != null)
  return { ...first, ...(details.length > 1 ? { detail: details } : {}) }
}

const message = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

function refused(bytes: number[], reasonCode: string, cause: unknown): EpcisEventVerification {
  const finding = fail(reasonCode, message(cause))
  return {
    representation: EPCIS_EVENT_REPRESENTATION, mediaType: EPCIS_EVENT_MEDIA_TYPE, digest: Utils.toHex(Hash.sha256(bytes)),
    proof: finding, schema: finding, time: unknown(reasonCode), status: unknown(reasonCode), authority: unknown(reasonCode),
  }
}

/**
 * The anchor fields a registry writes for a credential whose shape and hash
 * held (profile §6): the digest of the exact JWS bytes, the hash ID, the
 * issuer, the lexically first object identifier, the event type and the
 * representation. `anchoredBy` is the anchoring service's own.
 */
export function epcisEventAnchorMetadata(verification: EpcisEventVerification): { digest: string; attestationId: string; issuer: string; subject: string; attestationType: string; representation: typeof EPCIS_EVENT_REPRESENTATION; mediaType: typeof EPCIS_EVENT_MEDIA_TYPE } {
  if (verification.credential == null || verification.hashId == null || verification.hashId !== verification.credential.id) throw new Error('anchor fields are derived from a credential whose hash ID held')
  if (verification.proof.status !== 'pass') throw new Error('anchor fields are derived from a credential whose proof held; a registry anchors nothing it did not verify')
  const subject = verification.subjects?.[0]
  if (subject == null) throw new Error('the event names no object identifier to anchor under')
  if (verification.attestationType == null) throw new Error('the event declares no type')
  return {
    digest: verification.digest, attestationId: verification.hashId, issuer: verification.credential.issuer, subject,
    attestationType: verification.attestationType, representation: EPCIS_EVENT_REPRESENTATION, mediaType: EPCIS_EVENT_MEDIA_TYPE,
  }
}

/** The verifier `verifyPassportEvidence` takes as `credentialVerifier` for this representation; any other representation is `representation-unsupported`. */
export function epcisEventCredentialVerifierFor(options: Omit<EpcisEventVerificationOptions, 'checkedAt'> = {}): ExternalCredentialVerifier {
  return async (input) => {
    if (input.representation !== EPCIS_EVENT_REPRESENTATION) {
      const u = unknown('representation-unsupported', input.representation)
      return { proof: u, schema: u, time: u, status: u, authority: u }
    }
    return verifyEpcisEventCredential(input.bytes, { ...options, checkedAt: input.checkedAt })
  }
}
