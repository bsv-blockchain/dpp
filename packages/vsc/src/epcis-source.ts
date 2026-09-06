/**
 * EPCIS source exchange (`spec/epcis-interoperability.md`, the epcis-json@1
 * interoperability profile): the shared, dependency-light half of importing
 * an EPCIS 2.0.1 JSON or JSON-LD document.
 *
 * What lives here is everything a registry, an application service and an
 * offline reader must agree on byte for byte: the strict parse with its
 * disclosed limits, the pinned-schema validation that never mutates, the
 * event pointers, the canonical event-body digest a duplicate or a conflict is
 * decided by, the local identity of an event that carries no eventID, and the
 * signed source-reference extension a mapped credential carries. Durable
 * retention, idempotency keys, checkpoints and the pull client are the
 * application service's, because they need a store and a network.
 *
 * Nothing here strips, coerces, reorders or rewrites a source. A safely
 * parsed document that fails EPCIS validation is returned with its findings
 * so it can be retained as evidence; a transport that is unsafe to parse
 * (malformed UTF-8, a duplicate key, a depth or size past the limit, a number
 * a double cannot carry) is refused before anything is produced.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { canonicalizeJcs } from './jcs.js';
import type { JsonObject, Seal } from './types.js';

/* ------------------------------ artefacts ------------------------------- */

/** The pinned GS1 artefacts this module validates against (artifacts/epcis/NOTICE.md). */
export const EPCIS_ARTEFACTS = [
  { id: 'epcis-json-schema', kind: 'json-schema', version: '2.0.1', path: 'artifacts/epcis/epcis-json-schema-2.0.1.json', uri: 'https://ref.gs1.org/standards/epcis/2.0.1/epcis-json-schema.json', sha256: '0f46ff694efffd8d8ce840a33dfde84228add11b516b8b258f3200740ae210af', byteLength: 55680, carried: true },
  { id: 'epcis-context', kind: 'jsonld-context', version: '2.0.1', path: 'artifacts/epcis/epcis-context-2.0.1.jsonld', uri: 'https://ref.gs1.org/standards/epcis/2.0.1/epcis-context.jsonld', sha256: '5056c65f991425b1d3a35e35edf4f7d0c7ff56cf688c2912b930f93494713737', byteLength: 20690, carried: true },
  { id: 'epcis-query-schema', kind: 'json-schema', version: '2.0.1', path: 'artifacts/epcis/query-schema-2.0.1.json', uri: 'https://ref.gs1.org/standards/epcis/2.0.1/query-schema.json', sha256: '4b5583c9a0a715324594617f3cf6744f4f930568484f7df8fb7aa81819355341', byteLength: 27229, carried: true },
  { id: 'epcis-openapi', kind: 'openapi', version: '2.0.1', path: null, uri: 'https://ref.gs1.org/standards/epcis/2.0.1/openapi.json', sha256: '3d33792c520d7a7a1d080382d956730bb07021c7dd1cc17229fce27b784d66fc', byteLength: 351201, carried: false },
] as const;

export const EPCIS_VERSION = '2.0.1';
export const CBV_VERSION = '2.0.0';
export const EPCIS_CONTEXT_IRI = 'https://ref.gs1.org/standards/epcis/2.0.1/epcis-context.jsonld';
export const EPCIS_CONTEXT_DIGEST = EPCIS_ARTEFACTS[1].sha256;
/** The five event types the profile recognises; anything else is an extension event this profile does not interpret. */
export const EPCIS_EVENT_TYPES = ['ObjectEvent', 'AggregationEvent', 'TransformationEvent', 'TransactionEvent', 'AssociationEvent'] as const;
export type EpcisEventType = (typeof EPCIS_EVENT_TYPES)[number];
/** The signed source-reference vocabulary a mapped credential carries beside the round-trip event. */
export const EPCIS_SOURCE_VOCABULARY = 'urn:bsv:dpp:epcis-source:1';
export const EPCIS_MAPPING_PROFILE = 'epcis-vsc@1';
export const EPCIS_SOURCE_PROFILE = 'epcis-json@1';
export const EPCIS_MEDIA_TYPES = ['application/json', 'application/ld+json'] as const;

/* -------------------------------- limits -------------------------------- */

export interface EpcisLimits {
  maxDocumentBytes: number;
  maxEventsPerPage: number;
  maxJsonDepth: number;
  maxContextDocuments: number;
  maxContextBytes: number;
  fetchTimeoutMs: number;
  maxPullPages: number;
  maxPullBytes: number;
  maxPullSeconds: number;
}

/** The disclosed defaults of epcis-json@1; an operator lowers them or explicitly configures bounded higher values. */
export const EPCIS_DEFAULT_LIMITS: EpcisLimits = {
  maxDocumentBytes: 2 * 1024 * 1024,
  maxEventsPerPage: 100,
  maxJsonDepth: 64,
  maxContextDocuments: 16,
  maxContextBytes: 1024 * 1024,
  fetchTimeoutMs: 10_000,
  maxPullPages: 10,
  maxPullBytes: 20 * 1024 * 1024,
  maxPullSeconds: 60,
};

export function resolveEpcisLimits(overrides: Partial<EpcisLimits> = {}): EpcisLimits {
  const limits = { ...EPCIS_DEFAULT_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`EPCIS limit ${name} must be a positive integer`);
  }
  return limits;
}

/* ------------------------------ strict parse ---------------------------- */

export type EpcisRefusal =
  | 'unsupported-media-type'
  | 'oversized'
  | 'malformed-utf8'
  | 'malformed-json'
  | 'duplicate-key'
  | 'depth'
  | 'unsafe-number'
  | 'too-many-events'
  | 'not-an-object';

export interface EpcisFinding {
  code: string;
  path: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface EpcisEventPointer {
  /** RFC 6901 pointer to the event within the parsed document. */
  pointer: string;
  index: number;
  type: string;
  /** The event's own eventID, when it carries one. */
  eventId?: string;
  /** A local ingestion identity for an event without an eventID, labelled as such and never inserted into the source. */
  localIdentity?: string;
  identityKind: 'event-id' | 'local';
}

export interface EpcisEnvelope {
  type: 'EPCISDocument' | 'EPCISQueryDocument';
  schemaVersion?: string;
  creationDate?: string;
  hasHeader: boolean;
  hasMasterData: boolean;
  queryName?: string;
}

export interface EpcisContextDeclarations {
  /** The document's `@context`, exactly as present, or undefined when absent. */
  document?: unknown;
  /** Event-level `@context` declarations, by pointer, exactly as present. */
  events: Array<{ pointer: string; context: unknown }>;
}

export type EpcisParseResult =
  | { ok: false; reason: EpcisRefusal; detail: string }
  | {
      ok: true;
      retained: true;
      sha256: string;
      byteLength: number;
      mediaType: string;
      document: JsonObject;
      envelope?: EpcisEnvelope;
      context: EpcisContextDeclarations;
      events: EpcisEventPointer[];
      findings: EpcisFinding[];
    };

export interface EpcisParseOptions {
  mediaType: string;
  limits?: Partial<EpcisLimits>;
  /**
   * Accept a bare event as the whole source only when the caller supplies
   * the envelope facts the event travelled with; a bare event with no such
   * facts is an unrecognised envelope.
   */
  singleEvent?: { envelopeType: 'EPCISDocument' | 'EPCISQueryDocument'; contextDeclarations: unknown };
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** The digits and decimal exponent of a JSON number literal, with leading and trailing zeros removed, so two spellings of one value compare equal. */
function normalisedDecimal(text: string): { negative: boolean; digits: string; exponent: number } {
  const match = /^(-)?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (match == null) throw new Error(`not a number literal: ${text}`);
  const integer = match[2] ?? '';
  const fraction = match[3] ?? '';
  let exponent = Number(match[4] ?? '0') - fraction.length;
  let digits = (integer + fraction).replace(/^0+/, '');
  if (digits === '') return { negative: false, digits: '0', exponent: 0 };
  const trailing = digits.length - digits.replace(/0+$/, '').length;
  digits = digits.slice(0, digits.length - trailing);
  exponent += trailing;
  return { negative: match[1] === '-', digits, exponent };
}

/** Whether a number literal survives a parse into a double and the shortest round-trip serialisation with the same decimal digits. */
export function numberLiteralIsExact(text: string): boolean {
  const value = Number(text);
  if (!Number.isFinite(value)) return false;
  const literal = normalisedDecimal(text);
  if (literal.digits === '0') return true;
  const roundTrip = normalisedDecimal(String(value));
  return literal.digits === roundTrip.digits && literal.exponent === roundTrip.exponent && literal.negative === roundTrip.negative;
}

/**
 * Validate the transport of an already syntactically valid JSON text: no
 * duplicate member names, no container nested past the depth limit, and no
 * number a double cannot carry exactly. Returns the refusal, or undefined.
 */
function inspectTransport(text: string, maxDepth: number): { reason: EpcisRefusal; detail: string } | undefined {
  let index = 0;
  const whitespace = () => { while (index < text.length && /\s/.test(text[index] as string)) index++; };
  const string = (): string => {
    const start = index++;
    while (index < text.length) {
      if (text[index] === '\\') index += 2;
      else if (text[index++] === '"') return JSON.parse(text.slice(start, index)) as string;
    }
    throw new Error('unterminated string');
  };
  let refusal: { reason: EpcisRefusal; detail: string } | undefined;
  const visit = (depth: number, path: string): void => {
    if (refusal != null) return;
    whitespace();
    const char = text[index];
    if (char === '{') {
      if (depth > maxDepth) { refusal = { reason: 'depth', detail: `an object at ${path || '/'} is nested deeper than ${maxDepth}` }; return; }
      index++; whitespace();
      const keys = new Set<string>();
      while (text[index] !== '}') {
        const key = string();
        if (keys.has(key)) { refusal = { reason: 'duplicate-key', detail: `member ${JSON.stringify(key)} appears twice at ${path || '/'}` }; return; }
        keys.add(key);
        whitespace(); index++;
        visit(depth + 1, `${path}/${key}`);
        if (refusal != null) return;
        whitespace();
        if (text[index] !== ',') break;
        index++; whitespace();
      }
      index++;
    } else if (char === '[') {
      if (depth > maxDepth) { refusal = { reason: 'depth', detail: `an array at ${path || '/'} is nested deeper than ${maxDepth}` }; return; }
      index++; whitespace();
      let position = 0;
      while (text[index] !== ']') {
        visit(depth + 1, `${path}/${position++}`);
        if (refusal != null) return;
        whitespace();
        if (text[index] !== ',') break;
        index++;
      }
      index++;
    } else if (char === '"') {
      string();
    } else if (char === '-' || (char != null && char >= '0' && char <= '9')) {
      NUMBER.lastIndex = index;
      const match = NUMBER.exec(text);
      if (match == null) throw new Error('unreadable number');
      index += match[0].length;
      if (!numberLiteralIsExact(match[0])) refusal = { reason: 'unsafe-number', detail: `the number ${match[0]} at ${path || '/'} cannot be carried exactly; it would be silently changed by any parser` };
    } else {
      while (index < text.length && !/[\s,\]}]/.test(text[index] as string)) index++;
    }
  };
  visit(1, '');
  return refusal;
}

const sha256Hex = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

function mediaTypeBase(value: string): string {
  return value.split(';')[0]?.trim().toLowerCase() ?? '';
}

const EVENT_LIST_POINTERS = {
  EPCISDocument: '/epcisBody/eventList',
  EPCISQueryDocument: '/epcisBody/queryResults/resultsBody/eventList',
} as const;

function readPointer(root: unknown, pointer: string): unknown {
  let value = root;
  for (const part of pointer.split('/').slice(1)) {
    if (value == null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return value;
}

/**
 * Parse an EPCIS source strictly under the profile's limits, without
 * changing a byte of it. The document, when the transport is safe, is the
 * exact JSON value; the events are pointers into it; the findings say what
 * the envelope lacks without deciding what the caller does about it.
 */
export function parseEpcisSource(bytes: Uint8Array, options: EpcisParseOptions): EpcisParseResult {
  const limits = resolveEpcisLimits(options.limits);
  const mediaType = mediaTypeBase(options.mediaType);
  if (!(EPCIS_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
    return { ok: false, reason: 'unsupported-media-type', detail: `${options.mediaType} is not one of ${EPCIS_MEDIA_TYPES.join(', ')}` };
  }
  if (bytes.byteLength > limits.maxDocumentBytes) {
    return { ok: false, reason: 'oversized', detail: `${bytes.byteLength} bytes exceeds the ${limits.maxDocumentBytes} byte limit` };
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: 'malformed-utf8', detail: 'the bytes are not well-formed UTF-8' };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    return { ok: false, reason: 'malformed-json', detail: cause instanceof Error ? cause.message : String(cause) };
  }
  const transport = inspectTransport(text, limits.maxJsonDepth);
  if (transport != null) return { ok: false, ...transport };
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'not-an-object', detail: 'an EPCIS source is a JSON object' };
  }
  const document = value as JsonObject;
  const findings: EpcisFinding[] = [];
  const digest = sha256Hex(bytes);
  const context: EpcisContextDeclarations = { events: [] };
  if (document['@context'] !== undefined) context.document = document['@context'];

  let envelope: EpcisEnvelope | undefined;
  let eventList: unknown;
  let listPointer: string | undefined;
  const type = document.type;
  if (type === 'EPCISDocument' || type === 'EPCISQueryDocument') {
    const body = document.epcisBody;
    const header = document.epcisHeader;
    envelope = {
      type,
      ...(typeof document.schemaVersion === 'string' ? { schemaVersion: document.schemaVersion } : {}),
      ...(typeof document.creationDate === 'string' ? { creationDate: document.creationDate } : {}),
      hasHeader: header != null && typeof header === 'object',
      hasMasterData: header != null && typeof header === 'object' && (header as JsonObject).epcisMasterData != null,
    };
    if (type === 'EPCISQueryDocument') {
      const queryName = readPointer(document, '/epcisBody/queryResults/queryName');
      if (typeof queryName === 'string') envelope.queryName = queryName;
    }
    if (document['@context'] === undefined) findings.push({ code: 'context-missing', path: '/@context', message: 'an EPCIS envelope declares its JSON-LD context', severity: 'error' });
    if (typeof document.schemaVersion !== 'string') findings.push({ code: 'schema-version-missing', path: '/schemaVersion', message: 'the envelope names no schemaVersion', severity: type === 'EPCISDocument' ? 'error' : 'warning' });
    else if (!/^2(\.\d+)*$/.test(document.schemaVersion)) findings.push({ code: 'schema-version-unsupported', path: '/schemaVersion', message: `schemaVersion ${document.schemaVersion} is not EPCIS 2; this profile reads 2.0.1`, severity: 'error' });
    if (body == null || typeof body !== 'object') {
      findings.push({ code: 'body-missing', path: '/epcisBody', message: 'the envelope carries no epcisBody', severity: 'error' });
    } else {
      listPointer = EVENT_LIST_POINTERS[type];
      eventList = readPointer(document, listPointer);
      if (!Array.isArray(eventList)) {
        findings.push({ code: 'event-list-missing', path: listPointer, message: 'no eventList array at the position the envelope type defines', severity: 'error' });
        eventList = undefined;
      }
    }
  } else if (options.singleEvent != null && typeof type === 'string' && (EPCIS_EVENT_TYPES as readonly string[]).includes(type)) {
    envelope = { type: options.singleEvent.envelopeType, hasHeader: false, hasMasterData: false };
    context.document = options.singleEvent.contextDeclarations;
    eventList = [document];
    listPointer = '';
    findings.push({ code: 'single-event', path: '', message: 'a bare event accepted under caller-supplied envelope facts; the source is the event alone', severity: 'info' });
  } else {
    findings.push({ code: 'envelope-unrecognised', path: '/type', message: `type ${JSON.stringify(type)} is neither EPCISDocument nor EPCISQueryDocument`, severity: 'error' });
  }

  const events: EpcisEventPointer[] = [];
  if (Array.isArray(eventList)) {
    if (eventList.length > limits.maxEventsPerPage) {
      return { ok: false, reason: 'too-many-events', detail: `${eventList.length} events exceeds the ${limits.maxEventsPerPage} events per document or page limit; a larger source is split or the limit is explicitly raised` };
    }
    eventList.forEach((event, index) => {
      const pointer = listPointer === '' ? '' : `${listPointer}/${index}`;
      if (event == null || typeof event !== 'object' || Array.isArray(event)) {
        findings.push({ code: 'event-not-object', path: pointer, message: 'an event is a JSON object', severity: 'error' });
        return;
      }
      const record = event as JsonObject;
      const eventType = typeof record.type === 'string' ? record.type : '';
      if (eventType === '') findings.push({ code: 'event-type-missing', path: `${pointer}/type`, message: 'an event names its type', severity: 'error' });
      else if (!(EPCIS_EVENT_TYPES as readonly string[]).includes(eventType)) findings.push({ code: 'event-type-unsupported', path: `${pointer}/type`, message: `${eventType} is an extension event type this profile retains without interpreting`, severity: 'warning' });
      if (record['@context'] !== undefined) context.events.push({ pointer, context: record['@context'] });
      const eventId = typeof record.eventID === 'string' && record.eventID !== '' ? record.eventID : undefined;
      events.push(
        eventId != null
          ? { pointer, index, type: eventType, eventId, identityKind: 'event-id' }
          : { pointer, index, type: eventType, localIdentity: localEventIdentity(digest, pointer), identityKind: 'local' }
      );
    });
  }
  const seen = new Map<string, string>();
  for (const event of events) {
    if (event.eventId == null) continue;
    const earlier = seen.get(event.eventId);
    if (earlier != null) findings.push({ code: 'event-id-repeated', path: event.pointer, message: `eventID ${event.eventId} also appears at ${earlier}; the two bodies are compared by digest, never merged`, severity: 'warning' });
    else seen.set(event.eventId, event.pointer);
  }
  return { ok: true, retained: true, sha256: digest, byteLength: bytes.byteLength, mediaType, document, ...(envelope == null ? {} : { envelope }), context, events, findings };
}

/* ------------------------------ identities ------------------------------ */

/** The local ingestion identity of an event that carries no eventID: derived from the source digest and the event's pointer, labelled local, never written into the source. */
export function localEventIdentity(sourceSha256: string, pointer: string): string {
  if (!/^[0-9a-f]{64}$/.test(sourceSha256)) throw new Error('a source digest is 64 lower-case hex characters');
  return `urn:bsv:dpp:epcis:local-event:sha256:${sha256Hex(`${sourceSha256}#${pointer}`)}`;
}

/**
 * The canonical event-body digest a duplicate or a conflict is decided by:
 * RFC 8785 over the event without its repository `recordTime` and its
 * `errorDeclaration`, beside the sorted digests of the contexts it was read
 * under, then SHA-256. Two formattings of one event digest the same; two
 * JSON-LD spellings of one meaning do not, and are not promised to.
 */
export function epcisEventBodyDigest(event: JsonObject, contextDigests: readonly string[]): string {
  const { recordTime: _recordTime, errorDeclaration: _errorDeclaration, ...body } = event;
  for (const digest of contextDigests) if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('a context digest is 64 lower-case hex characters');
  return sha256Hex(canonicalizeJcs({ event: body, contexts: [...contextDigests].sort() }));
}

/** The digest of a context declaration: a pinned IRI's known digest, or the JCS digest of an inline object. */
export interface ContextReference {
  kind: 'iri' | 'inline';
  value: string;
  /** The pinned digest for a known IRI, or the JCS digest of an inline object; absent for an IRI this profile has not pinned. */
  digest?: string;
  pinned: boolean;
}

const PINNED_CONTEXTS: ReadonlyMap<string, string> = new Map([[EPCIS_CONTEXT_IRI, EPCIS_CONTEXT_DIGEST]]);

export function contextReferences(declaration: unknown): ContextReference[] {
  const entries = declaration === undefined ? [] : Array.isArray(declaration) ? declaration : [declaration];
  return entries.map((entry) => {
    if (typeof entry === 'string') {
      const digest = PINNED_CONTEXTS.get(entry);
      return digest == null ? { kind: 'iri', value: entry, pinned: false } : { kind: 'iri', value: entry, digest, pinned: true };
    }
    const digest = sha256Hex(canonicalizeJcs(entry));
    return { kind: 'inline', value: `urn:bsv:dpp:epcis:inline-context:sha256:${digest}`, digest, pinned: true };
  });
}

/** The digests of every pinned context in a declaration; an unpinned IRI contributes nothing and is reported by the caller as a gap. */
export function pinnedContextDigests(declaration: unknown): { digests: string[]; unpinned: string[] } {
  const refs = contextReferences(declaration);
  return { digests: refs.flatMap((r) => (r.digest == null ? [] : [r.digest])), unpinned: refs.filter((r) => !r.pinned).map((r) => r.value) };
}

/* ---------------------------- source reference -------------------------- */

export interface EpcisSourceReference extends JsonObject {
  vocabularyUrn: typeof EPCIS_SOURCE_VOCABULARY;
  sourceDigest: string;
  mediaType: string;
  eventPointer: string;
  eventId?: string;
  contextDigests: string[];
  mappingProfile: string;
}

export function epcisSourceReference(input: { sourceSha256: string; mediaType: string; pointer: string; eventId?: string; contextDigests: readonly string[]; mappingProfile?: string }): EpcisSourceReference {
  if (!/^[0-9a-f]{64}$/.test(input.sourceSha256)) throw new Error('a source digest is 64 lower-case hex characters');
  if (!(EPCIS_MEDIA_TYPES as readonly string[]).includes(mediaTypeBase(input.mediaType))) throw new Error('the source media type is one the profile accepts');
  return {
    vocabularyUrn: EPCIS_SOURCE_VOCABULARY,
    sourceDigest: input.sourceSha256,
    mediaType: mediaTypeBase(input.mediaType),
    eventPointer: input.pointer,
    ...(input.eventId == null ? {} : { eventId: input.eventId }),
    contextDigests: [...input.contextDigests].sort(),
    mappingProfile: input.mappingProfile ?? EPCIS_MAPPING_PROFILE,
  };
}

/** The source reference a mapped SEAL carries, or undefined when it carries none. Reading it does not verify the credential. */
export function readEpcisSourceReference(seal: Seal): EpcisSourceReference | undefined {
  const value = seal.extensions?.['+Dn']?.[EPCIS_SOURCE_VOCABULARY];
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const ref = value as JsonObject;
  if (ref.vocabularyUrn !== EPCIS_SOURCE_VOCABULARY || typeof ref.sourceDigest !== 'string' || typeof ref.eventPointer !== 'string' || !Array.isArray(ref.contextDigests)) return undefined;
  return ref as EpcisSourceReference;
}

/* ------------------------------- validation ----------------------------- */

export type IdentifierScheme = 'gs1-sgtin' | 'gs1-lgtin' | 'gs1-sgtin-pattern' | 'gs1-digital-link' | 'epc-other' | 'other';

export interface EpcisIdentifierFinding {
  path: string;
  value: string;
  scheme: IdentifierScheme;
  /** For a GS1 trade item: the fourteen-digit GTIN the identifier resolves to. */
  gtin?: string;
  serial?: string;
  lot?: string;
  /** For a Digital Link URI: whether the check digit holds. A URN form computes its own, so it is always valid when well-formed. */
  checkDigitValid?: boolean;
  problem?: string;
}

export interface EpcisEventValidation {
  pointer: string;
  type: string;
  identifiers: EpcisIdentifierFinding[];
  preservedExtensions: string[];
  errorDeclaration?: { declarationTime?: string; reason?: string; correctiveEventIDs: string[] };
}

export interface EpcisValidationFindings {
  schema: 'pass' | 'fail';
  findings: EpcisFinding[];
  events: EpcisEventValidation[];
  /** Document-level members the schema does not name, retained and listed. */
  preservedExtensions: string[];
}

const URI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/;

function checkDigit(digits: string): number {
  let sum = 0;
  let weight = 3;
  for (let i = digits.length - 1; i >= 0; i--) { sum += Number(digits[i]) * weight; weight = weight === 3 ? 1 : 3; }
  return (10 - (sum % 10)) % 10;
}

/** A GTIN-14 from an SGTIN or LGTIN URN's company prefix and item reference (indicator digit first), with the check digit computed. */
function gtinFromUrn(companyPrefix: string, itemReference: string): string | undefined {
  if (!/^\d{6,12}$/.test(companyPrefix) || !/^\d+$/.test(itemReference) || companyPrefix.length + itemReference.length !== 13) return undefined;
  const indicator = itemReference[0] as string;
  const thirteen = indicator + companyPrefix + itemReference.slice(1);
  return thirteen + String(checkDigit(thirteen));
}

/** Classify one identifier without rewriting it; a claimed GS1 identifier is checked against the grammar, anything else keeps its declared scheme. */
export function classifyEpcisIdentifier(path: string, value: unknown): EpcisIdentifierFinding {
  if (typeof value !== 'string' || !URI.test(value)) return { path, value: String(value), scheme: 'other', problem: 'not a URI' };
  const sgtin = /^urn:epc:id:sgtin:(\d+)\.(\d+)\.(.+)$/.exec(value);
  if (sgtin != null) {
    const gtin = gtinFromUrn(sgtin[1] as string, sgtin[2] as string);
    return gtin == null ? { path, value, scheme: 'gs1-sgtin', problem: 'company prefix and item reference do not total thirteen digits' } : { path, value, scheme: 'gs1-sgtin', gtin, serial: sgtin[3] as string, checkDigitValid: true };
  }
  const lgtin = /^urn:epc:class:lgtin:(\d+)\.(\d+)\.(.+)$/.exec(value);
  if (lgtin != null) {
    const gtin = gtinFromUrn(lgtin[1] as string, lgtin[2] as string);
    return gtin == null ? { path, value, scheme: 'gs1-lgtin', problem: 'company prefix and item reference do not total thirteen digits' } : { path, value, scheme: 'gs1-lgtin', gtin, lot: lgtin[3] as string, checkDigitValid: true };
  }
  const pattern = /^urn:epc:idpat:sgtin:(\d+)\.(\d+)\.\*$/.exec(value);
  if (pattern != null) {
    const gtin = gtinFromUrn(pattern[1] as string, pattern[2] as string);
    return gtin == null ? { path, value, scheme: 'gs1-sgtin-pattern', problem: 'company prefix and item reference do not total thirteen digits' } : { path, value, scheme: 'gs1-sgtin-pattern', gtin, checkDigitValid: true };
  }
  if (/^urn:epc:/.test(value)) return { path, value, scheme: 'epc-other' };
  const link = /^https?:\/\/[^/]+(?:\/[^/?#]+)*?\/01\/([^/?#]+)((?:\/[^/?#]+\/[^/?#]+)*)/.exec(value);
  if (link != null) {
    const gtinRaw = link[1] as string;
    if (!/^(\d{8}|\d{12,14})$/.test(gtinRaw)) return { path, value, scheme: 'gs1-digital-link', problem: 'application identifier 01 carries 8, 12, 13 or 14 digits' };
    const finding: EpcisIdentifierFinding = { path, value, scheme: 'gs1-digital-link', gtin: gtinRaw.padStart(14, '0'), checkDigitValid: checkDigit(gtinRaw.slice(0, -1)) === Number(gtinRaw.at(-1)) };
    const qualifiers = (link[2] ?? '').split('/').filter((s) => s !== '');
    for (let i = 0; i + 1 < qualifiers.length; i += 2) {
      const ai = qualifiers[i];
      const qualifier = decodeURIComponent(qualifiers[i + 1] as string);
      if (ai === '21') finding.serial = qualifier;
      else if (ai === '10') finding.lot = qualifier;
    }
    if (!finding.checkDigitValid) finding.problem = 'the GTIN check digit does not hold';
    return finding;
  }
  return { path, value, scheme: 'other' };
}

const COMMON_EVENT_KEYS = ['@context', 'type', 'eventTime', 'recordTime', 'eventTimeZoneOffset', 'eventID', 'certificationInfo', 'errorDeclaration'];
const EVENT_KEYS: Record<string, string[]> = {
  ObjectEvent: ['action', 'epcList', 'quantityList', 'bizStep', 'disposition', 'persistentDisposition', 'readPoint', 'bizLocation', 'bizTransactionList', 'sourceList', 'destinationList', 'sensorElementList', 'ilmd'],
  AggregationEvent: ['parentID', 'childEPCs', 'childQuantityList', 'action', 'bizStep', 'disposition', 'persistentDisposition', 'readPoint', 'bizLocation', 'bizTransactionList', 'sourceList', 'destinationList', 'sensorElementList'],
  TransactionEvent: ['bizTransactionList', 'parentID', 'epcList', 'quantityList', 'action', 'bizStep', 'disposition', 'persistentDisposition', 'readPoint', 'bizLocation', 'sourceList', 'destinationList', 'sensorElementList'],
  TransformationEvent: ['inputEPCList', 'inputQuantityList', 'outputEPCList', 'outputQuantityList', 'transformationID', 'bizStep', 'disposition', 'persistentDisposition', 'readPoint', 'bizLocation', 'bizTransactionList', 'sourceList', 'destinationList', 'sensorElementList', 'ilmd'],
  AssociationEvent: ['parentID', 'childEPCs', 'childQuantityList', 'action', 'bizStep', 'disposition', 'persistentDisposition', 'readPoint', 'bizLocation', 'bizTransactionList', 'sourceList', 'destinationList', 'sensorElementList'],
};
const DOCUMENT_KEYS = ['@context', 'id', 'type', 'schemaVersion', 'creationDate', 'instanceIdentifier', 'sender', 'receiver', 'epcisHeader', 'epcisBody'];

/** The members of an event the schema does not name for its type: retained as given, never interpreted here. */
export function preservedEventExtensions(event: JsonObject): string[] {
  const known = new Set([...COMMON_EVENT_KEYS, ...(EVENT_KEYS[String(event.type)] ?? [])]);
  return Object.keys(event).filter((key) => !known.has(key));
}

const ID_LIST_KEYS = ['epcList', 'childEPCs', 'inputEPCList', 'outputEPCList'];
const QUANTITY_LIST_KEYS = ['quantityList', 'childQuantityList', 'inputQuantityList', 'outputQuantityList'];

/** Every identifier an event names, classified in place. */
export function eventIdentifiers(event: JsonObject, pointer = ''): EpcisIdentifierFinding[] {
  const found: EpcisIdentifierFinding[] = [];
  for (const key of ID_LIST_KEYS) {
    const list = event[key];
    if (Array.isArray(list)) list.forEach((value, i) => found.push(classifyEpcisIdentifier(`${pointer}/${key}/${i}`, value)));
  }
  if (event.parentID !== undefined) found.push(classifyEpcisIdentifier(`${pointer}/parentID`, event.parentID));
  for (const key of QUANTITY_LIST_KEYS) {
    const list = event[key];
    if (Array.isArray(list)) list.forEach((element, i) => { if (element != null && typeof element === 'object') found.push(classifyEpcisIdentifier(`${pointer}/${key}/${i}/epcClass`, (element as JsonObject).epcClass)); });
  }
  return found;
}

let compiledSchema: ((value: unknown) => boolean) & { errors?: Array<{ instancePath: string; keyword: string; message?: string; schemaPath: string }> | null } | undefined;

function schemaValidator(): NonNullable<typeof compiledSchema> {
  if (compiledSchema == null) {
    const schema = JSON.parse(readFileSync(new URL('../artifacts/epcis/epcis-json-schema-2.0.1.json', import.meta.url), 'utf8')) as object;
    const ajv = new Ajv({ allErrors: true, strict: false });
    (addFormats as unknown as (a: Ajv) => void)(ajv);
    compiledSchema = ajv.compile(schema) as unknown as NonNullable<typeof compiledSchema>;
  }
  return compiledSchema;
}

/**
 * Validate a safely parsed document against the pinned EPCIS 2.0.1 schema
 * and the profile's identifier rules. Every finding names its path; nothing
 * is repaired. `schema` says whether the pinned schema accepted the whole
 * document; the identifier findings are independent of it, so a document
 * the schema rejects still has its identifiers read.
 */
export function validateEpcisDocument(document: JsonObject, options: { events?: EpcisEventPointer[] } = {}): EpcisValidationFindings {
  const validate = schemaValidator();
  const findings: EpcisFinding[] = [];
  const passed = validate(document);
  for (const error of validate.errors ?? []) {
    findings.push({ code: `schema:${error.keyword}`, path: error.instancePath || '/', message: `${error.message ?? 'invalid'} (${error.schemaPath})`, severity: 'error' });
  }
  const type = document.type;
  const events: EpcisEventValidation[] = [];
  const pointers = options.events ?? (type === 'EPCISDocument' || type === 'EPCISQueryDocument'
    ? ((readPointer(document, EVENT_LIST_POINTERS[type]) as unknown[] | undefined) ?? []).map((_, index) => ({ pointer: `${EVENT_LIST_POINTERS[type]}/${index}` }))
    : []);
  for (const { pointer } of pointers) {
    const event = readPointer(document, pointer);
    if (event == null || typeof event !== 'object' || Array.isArray(event)) continue;
    const record = event as JsonObject;
    const identifiers = eventIdentifiers(record, pointer);
    for (const id of identifiers) {
      if (id.problem != null) findings.push({ code: 'identifier', path: id.path, message: `${id.value}: ${id.problem}`, severity: id.problem === 'not a URI' ? 'error' : 'warning' });
    }
    const declaration = record.errorDeclaration;
    const entry: EpcisEventValidation = { pointer, type: String(record.type ?? ''), identifiers, preservedExtensions: preservedEventExtensions(record) };
    if (declaration != null && typeof declaration === 'object') {
      const d = declaration as JsonObject;
      entry.errorDeclaration = {
        ...(typeof d.declarationTime === 'string' ? { declarationTime: d.declarationTime } : {}),
        ...(typeof d.reason === 'string' ? { reason: d.reason } : {}),
        correctiveEventIDs: Array.isArray(d.correctiveEventIDs) ? d.correctiveEventIDs.filter((v): v is string => typeof v === 'string') : [],
      };
    }
    events.push(entry);
  }
  const preservedExtensions = type === 'EPCISDocument' || type === 'EPCISQueryDocument' ? Object.keys(document).filter((key) => !DOCUMENT_KEYS.includes(key)) : [];
  return { schema: passed ? 'pass' : 'fail', findings, events, preservedExtensions };
}

/* ------------------------------ arrival rules --------------------------- */

export interface EventObservation {
  /** The scoped identity: the eventID, or the local identity for an event without one. */
  identity: string;
  bodyDigest: string;
  recordTime?: string;
  errorDeclaration?: unknown;
}

export type EventArrival = 'duplicate' | 'conflict' | 'new-observation';

/**
 * How a newly arrived event relates to one already held under the same
 * scoped identity. Equal bodies with equal repository observations are a
 * duplicate; equal bodies with a changed recordTime or error declaration
 * are a further observation of the same event, never permission to
 * overwrite it; different bodies are a conflict that stays visible until it
 * is explicitly resolved.
 */
export function classifyEventArrival(existing: EventObservation, incoming: EventObservation): EventArrival {
  if (existing.identity !== incoming.identity) throw new Error('arrival is classified within one scoped event identity');
  if (existing.bodyDigest !== incoming.bodyDigest) return 'conflict';
  const sameRecordTime = (existing.recordTime ?? null) === (incoming.recordTime ?? null);
  const sameDeclaration = canonicalizeJcs(existing.errorDeclaration ?? null) === canonicalizeJcs(incoming.errorDeclaration ?? null);
  return sameRecordTime && sameDeclaration ? 'duplicate' : 'new-observation';
}

/** The corrective event references an error declaration names that the supplied set of held identities does not contain: unresolved, never silently resolved. */
export function unresolvedCorrections(validation: EpcisValidationFindings, heldIdentities: ReadonlySet<string>): Array<{ pointer: string; missing: string[] }> {
  const out: Array<{ pointer: string; missing: string[] }> = [];
  for (const event of validation.events) {
    if (event.errorDeclaration == null) continue;
    const missing = event.errorDeclaration.correctiveEventIDs.filter((id) => !heldIdentities.has(id));
    if (event.errorDeclaration.correctiveEventIDs.length === 0 || missing.length > 0) out.push({ pointer: event.pointer, missing });
  }
  return out;
}
