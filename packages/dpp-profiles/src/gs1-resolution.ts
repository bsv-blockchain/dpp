/**
 * GS1 resolution and discovery, pure (`spec/gs1-discovery.md`): the
 * uncompressed Digital Link grammar for primary key 01, decompression of the
 * EPC binary form, key-tuple equivalence, resolution records and the linksets
 * a GS1-Conformant Resolver 1.2.1 builds from them, the selection a
 * discovery client makes over a linkset, and the resolver description file.
 * Nothing here touches the network, a store or a request object; the hosted
 * resolver route and the discovery client are the callers, and every rule of
 * theirs that can be stated without I/O is stated here so two hosts agree.
 *
 * Two boundaries hold throughout. A key tuple names an identified entity and
 * nothing more: equivalence between two spellings of one key is not
 * authority to bind a signed credential to a passport, and a link inherited
 * from the model level does not become an item fact by being served under a
 * serialised request. And the legacy parser in identifiers.ts is untouched:
 * it answers historical records exactly as it always has, and this module is
 * the current grammar beside it, never a reinterpretation of it.
 */
import { gs1CheckDigit, gtin14, isDemonstrationGtin, isValidGtin } from './identifiers.js'
import { GS1_CHARACTER_SET_82, decodeEpcCompressionString, type EpcBinaryRefusalReason, type SgtinDecoding } from './gs1-epc-binary.js'

/* ------------------------------------------------------------------------ */
/* Vocabulary                                                               */
/* ------------------------------------------------------------------------ */

/**
 * The GS1 Web vocabulary namespace the resolver standard expands `gs1:` to
 * (GS1-Conformant Resolver 1.2.1 §2.14). The published linkset context maps
 * the same prefix to `http://gs1.org/voc/`; `normaliseLinkType` treats the
 * three spellings as one so a linkset from another resolver is read
 * correctly and this module always writes the standard's own.
 */
export const GS1_VOCABULARY = 'https://ref.gs1.org/voc/'
const GS1_VOCABULARY_ALIASES = ['https://ref.gs1.org/voc/', 'https://gs1.org/voc/', 'http://gs1.org/voc/']

/** The GS1 link types this profile uses, as full IRIs; a linkset key is always the full IRI. */
export const GS1_LINK_TYPES = {
  defaultLink: `${GS1_VOCABULARY}defaultLink`,
  defaultLinkMulti: `${GS1_VOCABULARY}defaultLinkMulti`,
  pip: `${GS1_VOCABULARY}pip`,
  sustainabilityInfo: `${GS1_VOCABULARY}sustainabilityInfo`,
  certificationInfo: `${GS1_VOCABULARY}certificationInfo`,
  epcis: `${GS1_VOCABULARY}epcis`,
  traceability: `${GS1_VOCABULARY}traceability`,
  recallStatus: `${GS1_VOCABULARY}recallStatus`,
  handledBy: `${GS1_VOCABULARY}handledBy`,
} as const

/**
 * The namespace of the link types this standard owns, and the one relation it
 * defines: a link to a passport's portable evidence package
 * (`spec/portable-evidence.md`), for which the GS1 vocabulary has no term.
 * The pinned linkset schema admits a link relation key only as a bare
 * lower-case token or as an `http(s)` IRI of letters, digits, dots and
 * slashes, so the relation is spelled without a hyphen under the programme's
 * public host and versioned in its path; the standard's usual
 * `bsv-blockchain.github.io` base cannot be a link relation under that schema.
 */
export const DPP_LINK_NAMESPACE = 'https://dpp.bsvb.net/link/'
export const DPP_EVIDENCE_PACKAGE_LINK_TYPE = `${DPP_LINK_NAMESPACE}evidencePackage/1`

/** The media types and relations of the resolver standard §2.9 and §2.10. */
export const LINKSET_MEDIA_TYPE = 'application/linkset+json'
export const LINKSET_CONTEXT_URI = 'https://ref.gs1.org/standards/resolver/1.2.1/linkset-context'
export const JSON_LD_CONTEXT_RELATION = 'http://www.w3.org/ns/json-ld#context'

/** The one primary key this profile hosts, and its three key qualifiers in the order the URI syntax fixes. */
export const SUPPORTED_PRIMARY_KEY = '01'
export const GTIN_QUALIFIER_ORDER = ['22', '10', '21'] as const
export type GtinQualifierAi = (typeof GTIN_QUALIFIER_ORDER)[number]

/** Primary key AIs the URI syntax defines; every one but 01 is refused as unsupported rather than misread. */
const PRIMARY_KEY_AIS = new Set(['00', '01', '253', '255', '401', '402', '414', '415', '417', '8003', '8004', '8006', '8010', '8013', '8017', '8018'])
/** The third-party serialised extension: a GTIN qualifier this profile does not host. */
const TPX_AI = '235'
/** The regex the pinned linkset schema applies to an IRI link relation key. */
const SCHEMA_IRI_KEY = /^https?:\/\/[a-zA-z0-9./]+$/
const CHARACTER_SET_39 = /^[#\-/0-9A-Z]+$/
const MEDIA_TYPE = /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

/* ------------------------------------------------------------------------ */
/* The URI grammar                                                          */
/* ------------------------------------------------------------------------ */

export interface AiValue {
  ai: string
  value: string
}

export interface DataAttribute extends AiValue {
  /** True when this module knows the AI's format and the value met it; false when the AI is unknown here and only the character set was checked. */
  validated: boolean
}

export interface LinkTypeRequest {
  /** The query parameter as written. */
  raw: string
  /** The full IRI, when the value was a full IRI or a `gs1:` CURIE. */
  iri?: string
  /** True for `linkset` (and its common alias `all`): the client wants the list, not a redirect. */
  linkset?: boolean
}

export interface Gs1Key {
  ai: '01'
  /** Fourteen digits. */
  value: string
  qualifiers: AiValue[]
}

export interface ParsedUncompressedUri {
  kind: 'uncompressed'
  origin: string
  host: string
  /** The path before `/01`, without a trailing slash; empty for a root resolver. */
  pathStem: string
  primaryKey: { ai: '01'; value: string; checkDigitValid: boolean; demonstration: boolean }
  /** In the order the syntax fixes: 22, then 10, then 21. */
  qualifiers: AiValue[]
  dataAttributes: DataAttribute[]
  linkType?: LinkTypeRequest
  /** Query parameters that are neither AIs nor linkType, preserved for forwarding. */
  otherQuery: Array<[string, string]>
}

export interface ParsedCompressedUri {
  kind: 'compressed'
  origin: string
  host: string
  pathStem: string
  prefix: 'eh' | 'ex'
  /** The whole compression string, prefix included. */
  compressionString: string
  /** The query string as given, so it can be carried to the uncompressed form. */
  query: string
}

export type UriRefusalReason =
  | 'not-a-url'
  | 'scheme'
  | 'percent-encoding'
  | 'no-primary-key'
  | 'unsupported-primary-key'
  | 'primary-key-not-a-gtin'
  | 'trailing-segment'
  | 'qualifier-order'
  | 'qualifier-repeated'
  | 'qualifier-unsupported'
  | 'qualifier-value'
  | 'key-in-query'
  | 'attribute-ai'
  | 'attribute-value'

export interface InvalidUri {
  kind: 'invalid'
  reason: UriRefusalReason
  detail: string
}

export type ParsedGs1Uri = ParsedUncompressedUri | ParsedCompressedUri | InvalidUri

const invalid = (reason: UriRefusalReason, detail: string): InvalidUri => ({ kind: 'invalid', reason, detail })

/**
 * What this module knows of the data attributes a GTIN URI may carry in its
 * query, with certainty: the six-digit dates, the fixed six-digit measures of
 * AIs 31nn to 36nn, the variable counts, the internal and company-internal
 * text AIs, and the thirteen-digit location numbers with their check digit.
 * An AI outside this table is carried with `validated: false`, never
 * refused for being unknown, because new AIs are introduced faster than a
 * library is revised (GS1-Conformant Resolver 1.2.1 §2.4).
 */
function knownAttributeProblem(ai: string, value: string): string | undefined | false {
  const date = (): string | undefined => {
    if (!/^\d{6}$/.test(value)) return 'six digits YYMMDD'
    const month = Number(value.slice(2, 4))
    const day = Number(value.slice(4, 6))
    if (month < 1 || month > 12 || day > 31) return 'a real month and day (day 00 permitted)'
    return undefined
  }
  if (['11', '13', '15', '16', '17'].includes(ai)) return date()
  if (/^3[1-6]\d{2}$/.test(ai)) return /^\d{6}$/.test(value) ? undefined : 'six digits'
  if (ai === '30' || ai === '37') return /^\d{1,8}$/.test(value) ? undefined : 'up to eight digits'
  if (ai === '8005') return /^\d{6}$/.test(value) ? undefined : 'six digits'
  if (ai === '90') return value.length <= 30 ? undefined : 'up to thirty characters'
  if (/^9[1-9]$/.test(ai)) return value.length <= 90 ? undefined : 'up to ninety characters'
  if (/^41[0-7]$/.test(ai)) return /^\d{13}$/.test(value) && gs1CheckDigit(value.slice(0, 12)) === Number(value[12]) ? undefined : 'thirteen digits with a valid check digit'
  return false
}

function parseLinkType(raw: string): LinkTypeRequest {
  if (raw === 'linkset' || raw === 'all') return { raw, linkset: true }
  const curie = /^gs1:([A-Za-z][A-Za-z0-9]*)$/.exec(raw)
  if (curie != null) return { raw, iri: `${GS1_VOCABULARY}${curie[1]}` }
  if (/^https?:\/\//.test(raw)) return { raw, iri: normaliseLinkType(raw) }
  return { raw }
}

/**
 * Read a GS1 Digital Link URI in the grammar this profile hosts: primary key
 * 01, its key qualifiers 22, 10 and 21 in that order, data attributes in the
 * query, `linkType` beside them, and the special compressed form of the EPC
 * binary standard. Refusals are answers, not exceptions, each with the
 * standard's reason: a resolver turns them into 400 and a client into a
 * finding. One trailing slash is tolerated (resolver standard §2.13).
 *
 * A URI this reads is syntactically a GS1 Digital Link URI and nothing more:
 * the check digit is reported, not enforced, because a historical record may
 * carry a GTIN that fails it, and allocation authority is never inferred.
 */
export function parseGs1DigitalLinkUri(uri: string): ParsedGs1Uri {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return invalid('not-a-url', 'the value does not parse as a URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return invalid('scheme', 'a Digital Link URI uses http or https')
  const rawSegments = url.pathname.replace(/\/$/, '').split('/').slice(1)
  const segments: string[] = []
  for (const raw of rawSegments) {
    try {
      segments.push(decodeURIComponent(raw))
    } catch {
      return invalid('percent-encoding', `the path segment ${raw} is not valid percent-encoding`)
    }
  }
  const at = segments.findIndex((segment) => /^\d{2,4}$/.test(segment))
  if (at === -1) {
    const last = segments.at(-1) ?? ''
    if (/^(eh|ex)[A-Za-z0-9_-]*$/.test(last)) {
      return {
        kind: 'compressed',
        origin: url.origin,
        host: url.host,
        pathStem: segments.slice(0, -1).map(encodeURIComponent).join('/'),
        prefix: last.slice(0, 2) as 'eh' | 'ex',
        compressionString: last,
        query: url.search,
      }
    }
    return invalid('no-primary-key', 'no path segment is a GS1 application identifier; the general compressed form is not decoded')
  }
  const primaryAi = segments[at]
  if (primaryAi !== SUPPORTED_PRIMARY_KEY) {
    return PRIMARY_KEY_AIS.has(primaryAi)
      ? invalid('unsupported-primary-key', `primary key ${primaryAi} is not hosted; this profile resolves 01 only`)
      : invalid('no-primary-key', `${primaryAi} is not a primary key application identifier`)
  }
  const gtinRaw = segments[at + 1]
  if (gtinRaw == null || !/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtinRaw)) return invalid('primary-key-not-a-gtin', 'application identifier 01 carries 8, 12, 13 or 14 digits')
  const gtin = gtin14(gtinRaw)
  const rest = segments.slice(at + 2)
  if (rest.length % 2 !== 0) return invalid('trailing-segment', 'a path segment follows the last application identifier without a value')
  const qualifiers: AiValue[] = []
  let lastRank = -1
  for (let index = 0; index < rest.length; index += 2) {
    const ai = rest[index]
    const value = rest[index + 1]
    const rank = (GTIN_QUALIFIER_ORDER as readonly string[]).indexOf(ai)
    if (rank === -1) {
      return ai === TPX_AI
        ? invalid('qualifier-unsupported', 'application identifier 235 (third-party serialised extension) is not hosted by this profile')
        : invalid('qualifier-unsupported', `${ai} is not a key qualifier of a GTIN`)
    }
    if (rank === lastRank) return invalid('qualifier-repeated', `application identifier ${ai} appears twice`)
    if (rank < lastRank) return invalid('qualifier-order', `application identifier ${ai} must precede ${rest[index - 2]}: the order is 22, 10, 21`)
    if (value.length === 0 || value.length > 20 || !GS1_CHARACTER_SET_82.test(value)) return invalid('qualifier-value', `application identifier ${ai} carries 1 to 20 characters of the GS1 encodable set 82`)
    qualifiers.push({ ai, value })
    lastRank = rank
  }
  const dataAttributes: DataAttribute[] = []
  const otherQuery: Array<[string, string]> = []
  let linkType: LinkTypeRequest | undefined
  for (const [key, value] of url.searchParams) {
    if (key === 'linkType') {
      linkType = parseLinkType(value)
      continue
    }
    if (/^\d{2,4}$/.test(key)) {
      if (key === SUPPORTED_PRIMARY_KEY || (GTIN_QUALIFIER_ORDER as readonly string[]).includes(key) || key === TPX_AI || PRIMARY_KEY_AIS.has(key)) {
        return invalid('key-in-query', `application identifier ${key} is a key or key qualifier and belongs in the path`)
      }
      if (value.length === 0 || !(GS1_CHARACTER_SET_82.test(value) || CHARACTER_SET_39.test(value))) return invalid('attribute-value', `application identifier ${key} carries a value outside the GS1 character sets`)
      const problem = knownAttributeProblem(key, value)
      if (typeof problem === 'string') return invalid('attribute-value', `application identifier ${key} requires ${problem}`)
      dataAttributes.push({ ai: key, value, validated: problem === undefined })
      continue
    }
    otherQuery.push([key, value])
  }
  return {
    kind: 'uncompressed',
    origin: url.origin,
    host: url.host,
    pathStem: segments.slice(0, at).map(encodeURIComponent).join('/'),
    primaryKey: { ai: '01', value: gtin, checkDigitValid: isValidGtin(gtinRaw), demonstration: isDemonstrationGtin(gtin) },
    qualifiers,
    dataAttributes,
    ...(linkType == null ? {} : { linkType }),
    otherQuery,
  }
}

export interface Decompressed {
  ok: true
  /** The fully uncompressed URI under the stem the compressed form carried. */
  uri: string
  key: Gs1Key
  epc: SgtinDecoding
}

export type DecompressionResult = Decompressed | { ok: false; reason: 'not-compressed' | EpcBinaryRefusalReason; detail: string; header?: string }

/**
 * Turn a special compressed GS1 Digital Link URI into its uncompressed form
 * (compression standard §4.2.1 and §4.2.2): the stem up to the compression
 * string is kept, the EPC binary string after `eh` or `ex` is decoded under
 * the Tag Data Standard, and the result is `${stem}/01/{gtin}/21/{serial}`.
 * A query string is carried across unchanged. An uncompressed URI is refused
 * as `not-compressed` rather than echoed, so a caller never mistakes a
 * pass-through for a decoding.
 */
export function decompressGs1DigitalLink(uri: string): DecompressionResult {
  const parsed = parseGs1DigitalLinkUri(uri)
  if (parsed.kind !== 'compressed') return { ok: false, reason: 'not-compressed', detail: parsed.kind === 'invalid' ? parsed.detail : 'the URI is already uncompressed' }
  const decoded = decodeEpcCompressionString(parsed.compressionString)
  if (!decoded.ok) return { ok: false, reason: decoded.reason, detail: decoded.detail, ...(decoded.header == null ? {} : { header: decoded.header }) }
  const key: Gs1Key = { ai: '01', value: decoded.gtin, qualifiers: [{ ai: '21', value: decoded.serial }] }
  return { ok: true, uri: `${uncompressedUri(`${parsed.origin}${parsed.pathStem === '' ? '' : `/${parsed.pathStem}`}`, key)}${parsed.query}`, key, epc: decoded }
}

/* ------------------------------------------------------------------------ */
/* Keys                                                                     */
/* ------------------------------------------------------------------------ */

/** The key an uncompressed parse names, or one built from its parts with the qualifiers put in canonical order. */
export function gs1KeyOf(source: ParsedUncompressedUri | { gtin: string; qualifiers?: AiValue[] }): Gs1Key {
  if ('kind' in source) return { ai: '01', value: source.primaryKey.value, qualifiers: [...source.qualifiers] }
  const qualifiers = [...(source.qualifiers ?? [])].sort((a, b) => (GTIN_QUALIFIER_ORDER as readonly string[]).indexOf(a.ai) - (GTIN_QUALIFIER_ORDER as readonly string[]).indexOf(b.ai))
  return { ai: '01', value: gtin14(source.gtin), qualifiers }
}

/**
 * The canonical spelling of a key tuple, `01:{gtin14}` followed by each
 * qualifier as `ai:value` in the syntax's order, joined by `|`. Two Digital
 * Link URIs under different hosts with the same tuple name the same entity;
 * the same serial under a different GTIN does not. Equivalence is a statement
 * about identifiers only: it is not authority to bind a signed credential to
 * a passport, which needs the binding evidence `spec/gs1-discovery.md` §2
 * names.
 */
export function gs1KeyTuple(key: Gs1Key | ParsedUncompressedUri): string {
  const resolved = 'kind' in key ? gs1KeyOf(key) : key
  return [`01:${resolved.value}`, ...resolved.qualifiers.map((q) => `${q.ai}:${q.value}`)].join('|')
}

export function sameGs1Key(a: Gs1Key | ParsedUncompressedUri, b: Gs1Key | ParsedUncompressedUri): boolean {
  return gs1KeyTuple(a) === gs1KeyTuple(b)
}

/** The granularity a key tuple names, by its most specific qualifier. */
export type KeyGranularity = 'model' | 'variant' | 'lot' | 'item'

export function granularityOf(qualifiers: readonly AiValue[]): KeyGranularity {
  if (qualifiers.some((q) => q.ai === '21')) return 'item'
  if (qualifiers.some((q) => q.ai === '10')) return 'lot'
  if (qualifiers.some((q) => q.ai === '22')) return 'variant'
  return 'model'
}

/** The uncompressed Digital Link URI of a key under a resolver root (origin plus optional stem, no trailing slash). */
export function uncompressedUri(resolverRoot: string, key: Gs1Key): string {
  const root = resolverRoot.replace(/\/+$/, '')
  return `${root}/01/${key.value}${key.qualifiers.map((q) => `/${q.ai}/${encodeURIComponent(q.value)}`).join('')}`
}

/** The path of the legacy evidence JSON answered at the API origin, and its alias, for an item key; undefined for any other granularity. */
export function legacyEvidencePaths(key: Gs1Key): { legacy: string; alias: string } | undefined {
  const serial = key.qualifiers.find((q) => q.ai === '21')
  if (serial == null || key.qualifiers.length !== 1) return undefined
  const tail = `/01/${key.value}/21/${encodeURIComponent(serial.value)}`
  return { legacy: tail, alias: `/resolve/gs1${tail}` }
}

/* ------------------------------------------------------------------------ */
/* Resolution records                                                       */
/* ------------------------------------------------------------------------ */

export type Disclosure = 'public' | 'restricted'

export interface ResolutionLink {
  /** The descriptive link relation type, as a full IRI. */
  rel: string
  href: string
  title: string
  /** An IANA media type, when declared. */
  type?: string
  /** BCP 47 language tags, when declared. */
  hreflang?: string[]
  context?: string[]
  /** `single`: the entity's one default link (no optional attributes); `multi`: a default refined by request headers. */
  default?: 'single' | 'multi'
  /** Whether public discovery may return the link; a restricted link is only ever returned to an authorised audience, and access is enforced again at its target. */
  disclosure: Disclosure
  /** Whether the resolver forwards the request's query string on redirect; the standard's default is to forward everything (§2.12). */
  forwardQuery?: boolean
}

export interface ResolutionRecord {
  key: { ai: '01'; value: string }
  /** The qualifiers this record is registered at, in the syntax's order; a record with 21 carries neither 22 nor 10 (resolver standard §2.5.10). */
  qualifiers: AiValue[]
  /** The exact signed passport identifier bound to this entity, where the binding is established; never inferred from the key. */
  passportId?: string
  /** A reference to the evidence or policy establishing that binding. */
  bindingRef?: string
  links: ResolutionLink[]
  /** The revision of the configuration the record was written under. */
  configurationRevision: string
  description?: string
}

/**
 * Every rule a record must meet before it is stored, so the resolver validates
 * at ingestion and not at every request (resolver standard §2.4): a GTIN
 * whose check digit holds, qualifiers in order with no repeat and no TPX, a
 * serial never registered beside a variant or a lot, at most one single
 * default link with no optional attributes, and every link with an `https`
 * target, a title, a relation the linkset schema can carry, and declared
 * disclosure. An empty list means the record is admissible.
 */
export function resolutionRecordProblems(record: ResolutionRecord): string[] {
  const problems: string[] = []
  if (record.key.ai !== '01') problems.push(`primary key ${String(record.key.ai)} is not hosted`)
  if (!/^\d{14}$/.test(record.key.value) || !isValidGtin(record.key.value)) problems.push('the GTIN must be fourteen digits with a valid check digit')
  let lastRank = -1
  const ais = new Set<string>()
  for (const q of record.qualifiers) {
    const rank = (GTIN_QUALIFIER_ORDER as readonly string[]).indexOf(q.ai)
    if (rank === -1) problems.push(`${q.ai} is not a hosted key qualifier`)
    else if (rank <= lastRank) problems.push(`qualifier ${q.ai} is out of order or repeated`)
    lastRank = Math.max(lastRank, rank)
    ais.add(q.ai)
    if (q.value.length === 0 || q.value.length > 20 || !GS1_CHARACTER_SET_82.test(q.value)) problems.push(`qualifier ${q.ai} carries 1 to 20 characters of the GS1 encodable set 82`)
  }
  if (ais.has('21') && (ais.has('22') || ais.has('10'))) problems.push('a link registered at the serial level carries neither a variant nor a lot (resolver standard section 2.5.10)')
  if (record.configurationRevision === '') problems.push('a configuration revision is required')
  const defaults = record.links.filter((l) => l.default === 'single')
  if (defaults.length > 1) problems.push('at most one default link per identified entity')
  for (const [index, link] of record.links.entries()) {
    const where = `link ${index} (${link.rel})`
    if (!/^https:\/\/\S+$/.test(link.href)) problems.push(`${where}: the target must be an https URL`)
    if (typeof link.title !== 'string' || link.title.trim() === '') problems.push(`${where}: a title is required`)
    if (!SCHEMA_IRI_KEY.test(link.rel)) problems.push(`${where}: the relation must be an http(s) IRI of letters, digits, dots and slashes so the linkset schema can carry it`)
    if (link.rel === GS1_LINK_TYPES.defaultLink || link.rel === GS1_LINK_TYPES.defaultLinkMulti) problems.push(`${where}: a default is flagged with default, and its relation is the descriptive type`)
    if (link.default === 'single' && (link.type != null || link.hreflang != null || link.context != null)) problems.push(`${where}: the default link carries no optional attributes`)
    if (link.type != null && !MEDIA_TYPE.test(link.type)) problems.push(`${where}: ${link.type} is not a media type`)
    for (const tag of link.hreflang ?? []) if (!LANGUAGE_TAG.test(tag)) problems.push(`${where}: ${tag} is not a language tag`)
    if (link.hreflang != null && link.hreflang.length === 0) problems.push(`${where}: hreflang is an array of at least one tag`)
    if (link.context != null && link.context.length === 0) problems.push(`${where}: context is an array of at least one value`)
    if (link.disclosure !== 'public' && link.disclosure !== 'restricted') problems.push(`${where}: disclosure must be public or restricted`)
  }
  return problems
}

/* ------------------------------------------------------------------------ */
/* Requests and matching                                                    */
/* ------------------------------------------------------------------------ */

export interface ResolutionRequest {
  key: Gs1Key
  /** Public discovery never sees a restricted link; an authorised audience sees it flagged. */
  audience: 'public' | 'authorised'
  /** The requested link type as a full IRI, `linkset` for the list, or absent for the default. */
  linkType?: string | 'linkset'
  /** Acceptable media types, most preferred first (`parseAcceptHeader`). */
  accept?: string[]
  /** Preferred languages, most preferred first (`parseAcceptLanguage`). */
  acceptLanguage?: string[]
  context?: string[]
  /** The origin and stem the linkset anchors are written under. */
  resolverRoot: string
}

export interface ResolvedLink extends ResolutionLink {
  /** The uncompressed URI of the record the link was registered at, never the request's. */
  anchor: string
  /** The granularity of that record: a model-level link answering an item request is still model information. */
  granularity: KeyGranularity
  record: ResolutionRecord
}

export interface MatchedRecord {
  record: ResolutionRecord
  anchor: string
  granularity: KeyGranularity
}

export type ResolutionOutcome =
  | { outcome: 'no-records'; matched: [] }
  | { outcome: 'linkset'; matched: MatchedRecord[]; links: ResolvedLink[] }
  | { outcome: 'redirect'; matched: MatchedRecord[]; link: ResolvedLink; links: ResolvedLink[] }
  | { outcome: 'multiple-choices'; matched: MatchedRecord[]; candidates: ResolvedLink[]; links: ResolvedLink[] }
  | { outcome: 'not-found'; matched: MatchedRecord[]; requested: string; links: ResolvedLink[] }

/** `text/html;q=0.9, application/json` to `['application/json', 'text/html']`: q-values honoured, zero excluded. */
export function parseAcceptHeader(header: string | undefined): string[] {
  return parseWeighted(header).map(([value]) => value.toLowerCase())
}

/** `fr-CH, fr;q=0.9, en;q=0.8` to `['fr-CH', 'fr', 'en']`. */
export function parseAcceptLanguage(header: string | undefined): string[] {
  return parseWeighted(header).map(([value]) => value)
}

function parseWeighted(header: string | undefined): Array<[string, number]> {
  if (header == null || header.trim() === '') return []
  const entries: Array<[string, number, number]> = []
  header.split(',').forEach((part, index) => {
    const [value, ...params] = part.trim().split(';').map((p) => p.trim())
    if (value === '') return
    let q = 1
    for (const param of params) {
      const match = /^q=([01](?:\.\d{0,3})?)$/i.exec(param)
      if (match != null) q = Number(match[1])
    }
    if (q > 0) entries.push([value, q, index])
  })
  return entries.sort((a, b) => b[1] - a[1] || a[2] - b[2]).map(([value, q]) => [value, q])
}

/** Which of the six registration levels of §2.5.10 a request selects, most specific first. */
function levelsFor(key: Gs1Key): Array<Array<AiValue>> {
  const by = new Map(key.qualifiers.map((q) => [q.ai, q]))
  const levels: Array<Array<AiValue>> = []
  const serial = by.get('21')
  const variant = by.get('22')
  const lot = by.get('10')
  if (serial != null) levels.push([serial])
  if (variant != null && lot != null) levels.push([variant, lot])
  if (lot != null) levels.push([lot])
  if (variant != null) levels.push([variant])
  levels.push([])
  return levels
}

function sameQualifiers(a: readonly AiValue[], b: readonly AiValue[]): boolean {
  return a.length === b.length && a.every((q, i) => q.ai === b[i].ai && q.value === b[i].value)
}

/**
 * The records a request selects: the union the resolver standard §2.5.10
 * fixes, most specific level first, so a link registered at the lot level is
 * found under a serialised request and a link at the model level under every
 * request. Each match keeps its own anchor and granularity.
 */
export function matchRecords(records: readonly ResolutionRecord[], key: Gs1Key, resolverRoot: string): MatchedRecord[] {
  const matched: MatchedRecord[] = []
  for (const level of levelsFor(key)) {
    for (const record of records) {
      if (record.key.value !== key.value || !sameQualifiers(record.qualifiers, level)) continue
      const recordKey: Gs1Key = { ai: '01', value: record.key.value, qualifiers: record.qualifiers }
      matched.push({ record, anchor: uncompressedUri(resolverRoot, recordKey), granularity: granularityOf(record.qualifiers) })
    }
  }
  return matched
}

/**
 * Media type against the client's ordered acceptable types: 3 for an exact
 * type, 2 for a `type/*` range, 1 when the link declares no type or the
 * client accepts anything, 0 for a mismatch; then the negated index of the
 * earliest acceptable type the link satisfies, so the client's preference
 * order decides between two exact matches.
 */
function rankMediaType(link: ResolutionLink, accept: string[] | undefined): [number, number] {
  if (link.type == null || accept == null || accept.length === 0) return [1, 0]
  const type = link.type.toLowerCase()
  const exact = accept.indexOf(type)
  if (exact !== -1) return [3, -exact]
  const range = accept.indexOf(`${type.split('/')[0]}/*`)
  if (range !== -1) return [2, -range]
  if (accept.includes('*/*')) return [1, 0]
  return [0, 0]
}

/**
 * Language against the client's ordered preferences: the earliest preference
 * a link satisfies decides, an exact tag beating a primary-subtag match only
 * within that one preference. Three numbers: 2 match, 1 neutral (no
 * hreflang, or no preference), 0 mismatch; then the negated preference index;
 * then 1 for an exact tag and 0 for a primary-subtag match.
 */
function rankLanguage(link: ResolutionLink, languages: string[] | undefined): [number, number, number] {
  if (link.hreflang == null || languages == null || languages.length === 0) return [1, 0, 0]
  const tags = link.hreflang.map((t) => t.toLowerCase())
  for (const [index, wanted] of languages.entries()) {
    const lower = wanted.toLowerCase()
    if (lower === '*') return [1, 0, 0]
    if (tags.includes(lower)) return [2, -index, 1]
    if (tags.some((t) => t.split('-')[0] === lower.split('-')[0])) return [2, -index, 0]
  }
  return [0, 0, 0]
}

function rankContext(link: ResolutionLink, context: string[] | undefined): number {
  if (link.context == null || context == null || context.length === 0) return 1
  return link.context.some((c) => context.includes(c)) ? 3 : 0
}

/** The comparable rank of a link: media type, then language (three numbers), then context; a link that makes no claim outranks one that contradicts the request. */
interface Rank {
  mediaType: number
  language: number
  context: number
  order: number[]
}

function rank(link: ResolutionLink, request: Pick<ResolutionRequest, 'accept' | 'acceptLanguage' | 'context'>): Rank {
  const [mediaType, mediaPreference] = rankMediaType(link, request.accept)
  const [language, preference, exact] = rankLanguage(link, request.acceptLanguage)
  const context = rankContext(link, request.context)
  return { mediaType, language, context, order: [mediaType, mediaPreference, language, preference, exact, context] }
}

function compareRanks(a: Rank, b: Rank): number {
  for (let i = 0; i < a.order.length; i++) if (a.order[i] !== b.order[i]) return b.order[i] - a.order[i]
  return 0
}

/**
 * The best match among candidates of one link type (resolver standard §2.6.3,
 * media type before language before context): the unique best, or every
 * candidate when the best is not unique, so the resolver answers 300 rather
 * than choosing.
 */
export function bestMatch<L extends ResolutionLink>(candidates: readonly L[], request: Pick<ResolutionRequest, 'accept' | 'acceptLanguage' | 'context'>): { unique: L } | { tie: L[] } | undefined {
  if (candidates.length === 0) return undefined
  const ranked = candidates.map((link) => ({ link, rank: rank(link, request) })).sort((a, b) => compareRanks(a.rank, b.rank))
  const top = ranked[0]
  const tied = ranked.filter((r) => compareRanks(r.rank, top.rank) === 0)
  return tied.length === 1 ? { unique: top.link } : { tie: tied.map((r) => r.link) }
}

/**
 * Resolve a request against the records this resolver holds, exactly as the
 * standard's flow chart does and without any I/O: which records the key
 * selects, which links the audience may see, then the default, the requested
 * type, the list, or the refusal. A restricted link is never returned to a
 * public audience. The redirect target is the link's own `href`; forwarding
 * the request's query string onto it (§2.12) is the route's step, because
 * the query is the route's to read.
 */
export function resolveLinks(records: readonly ResolutionRecord[], request: ResolutionRequest): ResolutionOutcome {
  const matched = matchRecords(records, request.key, request.resolverRoot)
  if (matched.length === 0) return { outcome: 'no-records', matched: [] }
  const links: ResolvedLink[] = []
  for (const m of matched) {
    for (const link of m.record.links) {
      if (link.disclosure === 'restricted' && request.audience !== 'authorised') continue
      links.push({ ...link, anchor: m.anchor, granularity: m.granularity, record: m.record })
    }
  }
  if (request.linkType === 'linkset') return { outcome: 'linkset', matched, links }
  if (request.linkType == null) {
    // The most specific level that registered a default answers, with its
    // header-refined defaults tried first (§2.5.8, §2.6.1). A tie between
    // refined defaults falls back to the single default, because the default
    // exists so the resolver can always give a definite answer.
    const single = links.find((l) => l.default === 'single')
    if (single == null) return { outcome: 'not-found', matched, requested: GS1_LINK_TYPES.defaultLink, links }
    const multi = links.filter((l) => l.default === 'multi' && l.anchor === single.anchor)
    const refined = bestMatch(multi, request)
    if (refined != null && 'unique' in refined) {
      const own = rank(refined.unique, request)
      const matchesSomething = own.mediaType >= 2 || own.language >= 2 || own.context >= 2
      if (matchesSomething) return { outcome: 'redirect', matched, link: refined.unique, links }
    }
    return { outcome: 'redirect', matched, link: single, links }
  }
  const wanted = normaliseLinkType(request.linkType)
  const candidates = links.filter((l) => normaliseLinkType(l.rel) === wanted)
  const chosen = bestMatch(candidates, request)
  if (chosen == null) return { outcome: 'not-found', matched, requested: wanted, links }
  if ('unique' in chosen) return { outcome: 'redirect', matched, link: chosen.unique, links }
  return { outcome: 'multiple-choices', matched, candidates: chosen.tie, links }
}

/* ------------------------------------------------------------------------ */
/* Linksets                                                                 */
/* ------------------------------------------------------------------------ */

export interface LinksetLink {
  href: string
  title: string
  type?: string
  hreflang?: string[]
  context?: string[]
  fwqs?: boolean
  public?: boolean
}

/** One link context object of RFC 9264 as the GS1 schema shapes it: the anchor, an optional description and the links keyed by relation. */
export type LinksetEntry = { anchor: string; description?: string } & Record<string, unknown>

export interface LinksetDocument {
  linkset: LinksetEntry[]
}

/** One relation IRI for the three spellings of the GS1 vocabulary; anything else is returned as given. */
export function normaliseLinkType(iri: string): string {
  for (const alias of GS1_VOCABULARY_ALIASES) {
    if (iri.startsWith(alias)) return `${GS1_VOCABULARY}${iri.slice(alias.length)}`
  }
  return iri
}

function linksetLink(link: ResolvedLink): LinksetLink {
  return {
    href: link.href,
    title: link.title,
    ...(link.type == null ? {} : { type: link.type }),
    ...(link.hreflang == null ? {} : { hreflang: [...link.hreflang] }),
    ...(link.context == null ? {} : { context: [...link.context] }),
    ...(link.forwardQuery === false ? { fwqs: false } : {}),
    ...(link.disclosure === 'restricted' ? { public: false } : {}),
  }
}

/**
 * The linkset a resolver returns for a request (resolver standard §2.9 and
 * §2.10): one link context object per matched record, most specific first,
 * its anchor the uncompressed URI of that record's own identifier, every link
 * under its descriptive relation and a default additionally under
 * `gs1:defaultLink` or `gs1:defaultLinkMulti`. Links a public audience may
 * not see are absent, not blanked; a restricted link shown to an authorised
 * audience says `public: false`. The document validates against the pinned
 * linkset schema.
 */
export function linksetDocument(records: readonly ResolutionRecord[], request: Omit<ResolutionRequest, 'linkType'>): LinksetDocument | undefined {
  const resolved = resolveLinks(records, { ...request, linkType: 'linkset' })
  if (resolved.outcome !== 'linkset') return undefined
  const entries: LinksetEntry[] = []
  for (const m of resolved.matched) {
    const entry: LinksetEntry = { anchor: m.anchor, ...(m.record.description == null ? {} : { description: m.record.description }) }
    const push = (rel: string, link: LinksetLink): void => {
      const list = (entry[rel] as LinksetLink[] | undefined) ?? []
      list.push(link)
      entry[rel] = list
    }
    for (const link of resolved.links) {
      if (link.record !== m.record) continue
      const shaped = linksetLink(link)
      push(link.rel, shaped)
      if (link.default === 'single') push(GS1_LINK_TYPES.defaultLink, shaped)
      if (link.default === 'multi') push(GS1_LINK_TYPES.defaultLinkMulti, shaped)
    }
    entries.push(entry)
  }
  return { linkset: entries }
}

export interface LinkSelection {
  rel: string
  mediaType?: string
  language?: string
  context?: string
}

export type SelectedLink =
  | { outcome: 'selected'; link: LinksetLink; anchor: string; scope: { key?: Gs1Key; granularity: KeyGranularity | 'unknown' } }
  | { outcome: 'ambiguous'; candidates: Array<{ link: LinksetLink; anchor: string }> }
  | { outcome: 'not-found'; available: string[] }

/**
 * A discovery client's choice over a linkset another resolver returned: the
 * links under the requested relation (a full IRI or a `gs1:` CURIE) across
 * every link context object, the best match by media type, language and
 * context, and the anchor's own scope beside the result, so a link found at
 * the model level under an item request is handed back as model
 * information. An anchor that is not a Digital Link URI this module reads
 * has scope `unknown`; it is not guessed.
 */
export function selectLink(linkset: LinksetDocument, selection: LinkSelection): SelectedLink {
  const wanted = normaliseLinkType(parseLinkType(selection.rel).iri ?? selection.rel)
  const candidates: Array<{ link: LinksetLink; anchor: string }> = []
  const available = new Set<string>()
  for (const entry of linkset.linkset ?? []) {
    if (typeof entry?.anchor !== 'string') continue
    for (const [rel, value] of Object.entries(entry)) {
      if (rel === 'anchor' || rel === 'description' || rel === 'itemDescription' || !Array.isArray(value)) continue
      available.add(normaliseLinkType(rel))
      if (normaliseLinkType(rel) !== wanted) continue
      for (const link of value as LinksetLink[]) {
        if (typeof link?.href !== 'string') continue
        candidates.push({ link, anchor: entry.anchor })
      }
    }
  }
  if (candidates.length === 0) return { outcome: 'not-found', available: [...available].sort() }
  const request = {
    accept: selection.mediaType == null ? undefined : [selection.mediaType.toLowerCase()],
    acceptLanguage: selection.language == null ? undefined : [selection.language],
    context: selection.context == null ? undefined : [selection.context],
  }
  const ranked = candidates
    .map((c) => ({ ...c, rank: rank({ rel: wanted, href: c.link.href, title: c.link.title, type: c.link.type, hreflang: c.link.hreflang, context: c.link.context, disclosure: 'public' }, request) }))
    .sort((a, b) => compareRanks(a.rank, b.rank))
  const tied = ranked.filter((r) => compareRanks(r.rank, ranked[0].rank) === 0)
  if (tied.length > 1) return { outcome: 'ambiguous', candidates: tied.map(({ link, anchor }) => ({ link, anchor })) }
  const best = tied[0]
  const parsed = parseGs1DigitalLinkUri(best.anchor)
  const scope = parsed.kind === 'uncompressed' ? { key: gs1KeyOf(parsed), granularity: granularityOf(parsed.qualifiers) } : { granularity: 'unknown' as const }
  return { outcome: 'selected', link: best.link, anchor: best.anchor, scope }
}

/* ------------------------------------------------------------------------ */
/* The resolver description file                                            */
/* ------------------------------------------------------------------------ */

export interface ResolverDescriptionConfig {
  /** The origin, with an optional stem, the resolver answers at; no trailing slash. */
  resolverRoot: string
  name?: string
  contact?: { fn?: string; hasAddress?: { streetAddress?: string; locality?: string; region?: string; 'postal-code'?: string }; hasTelephone?: string }
  supportedContextValuesEnumerated?: string[]
  extensionProfile?: string
}

export interface ResolverDescription {
  name?: string
  resolverRoot: string
  supportedPrimaryKeys: ['01']
  supportedLinkType: Array<{ namespace: string; prefix: string }>
  linkTypeDefaultCanBeLinkset: false
  supportedContextValuesEnumerated?: string[]
  contact?: ResolverDescriptionConfig['contact']
  extensionProfile?: string
  jsonLdContextLocation: string
}

/**
 * The `/.well-known/gs1resolver` document (resolver standard §3) for the one
 * scope this profile hosts: primary key 01 with every qualifier, the GS1
 * vocabulary and this standard's own link namespace, `linkset` never the
 * default, and the pinned GS1 context for JSON linksets. It is published only
 * by an origin that actually provides the resolver contract; the legacy API
 * origin does not describe itself as one.
 */
export function describeResolver(config: ResolverDescriptionConfig): ResolverDescription {
  let root: URL
  try {
    root = new URL(config.resolverRoot)
  } catch {
    throw new Error('resolverRoot must be an absolute URL')
  }
  if (root.protocol !== 'https:') throw new Error('a resolver root is served over TLS')
  if (root.search !== '' || root.hash !== '') throw new Error('a resolver root carries no query or fragment')
  return {
    ...(config.name == null ? {} : { name: config.name }),
    resolverRoot: config.resolverRoot.replace(/\/+$/, ''),
    supportedPrimaryKeys: ['01'],
    supportedLinkType: [
      { namespace: GS1_VOCABULARY, prefix: 'gs1:' },
      { namespace: DPP_LINK_NAMESPACE, prefix: 'dpp:' },
    ],
    linkTypeDefaultCanBeLinkset: false,
    ...(config.supportedContextValuesEnumerated == null ? {} : { supportedContextValuesEnumerated: [...config.supportedContextValuesEnumerated] }),
    ...(config.contact == null ? {} : { contact: structuredClone(config.contact) }),
    ...(config.extensionProfile == null ? {} : { extensionProfile: config.extensionProfile }),
    jsonLdContextLocation: LINKSET_CONTEXT_URI,
  }
}
