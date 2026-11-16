/**
 * One page of a pull: where a request may go, what it carries, and how much
 * of the answer is read (`spec/epcis-interoperability.md` section 3).
 *
 * Nothing here opens a connection. The transport is handed in, and this
 * module decides what it is asked for:
 *
 * - every address is checked against the permitted origins before it is
 *   requested: the first, each redirect, and the next page a source names;
 * - redirects are followed by hand, so that check is made at every hop;
 * - a credential goes to the origin it was configured for and to no other;
 * - a body is counted as it arrives and abandoned at the limit, so a large
 *   or compressed answer is never held whole before it is refused;
 * - what a source sends back is searched for the credential it was sent, so
 *   an echo is refused and never recorded.
 *
 * It retains nothing and interprets no event. A page is bytes and a media
 * type until the import path parses it.
 */
import { CBV_VERSION, EPCIS_VERSION } from '../epcis-source.js';
import type { EpcisPullCursor, EpcisPullLeniency, EpcisPullReason, EpcisPullServerVersions, EpcisSourceOutcome } from './records.js';

/* ---------------------------------- shape -------------------------------- */

/** What the transport answers. The standard Response has this shape. */
export interface EpcisFetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(reason?: unknown): Promise<void>; releaseLock(): void } } | null;
}

/** The transport a pull is handed. The standard `fetch` function has this shape. It must not follow redirects itself: `redirect` is always `manual`. */
export type EpcisFetch = (url: string, init: { method: 'GET'; headers: Record<string, string>; redirect: 'manual'; signal: AbortSignal }) => Promise<EpcisFetchResponse>;

/** A credential for one source. It is obtained when a run begins and is held in memory only. */
export type EpcisSourceCredential =
  | { scheme: 'bearer'; token: string }
  | { scheme: 'basic'; username: string; password: string }
  | { scheme: 'header'; name: string; value: string };

/**
 * The versions sent in GS1-EPCIS-Version and GS1-CBV-Version unless a source
 * is configured otherwise: the EPCIS and CBV versions this package pins.
 * GS1's interface description gives a three-part version, and the files a
 * page is validated against are those of EPCIS 2.0.1, so that is what a
 * request names.
 */
export const EPCIS_WIRE_VERSION = EPCIS_VERSION;
export const CBV_WIRE_VERSION = CBV_VERSION;
/** A source is followed through at most this many redirects for one page. */
export const EPCIS_PULL_MAX_REDIRECTS = 3;
/** The shortest secret that can be told from ordinary text when an answer is searched for it. */
export const EPCIS_MIN_SECRET_LENGTH = 8;

const MAX_LINK_HEADER = 8192;
const MAX_TARGET = 8192;
const MAX_TOKEN = 2048;
const EPCIS_MEDIA = ['application/json', 'application/ld+json'];
const CONTROL = /[\u0000-\u001f\u007f]/;

export interface EpcisTargetPolicy {
  permittedOrigins: readonly string[];
  /** Permits plain http and private addresses. For local tests only. */
  localTest: boolean;
  /** The addresses a host name resolves to, when the caller can say. Each is held to the same rule as a literal address. */
  resolveHost?: (hostname: string) => Promise<string[]>;
}

export interface EpcisPullLogEntry {
  event: 'run-start' | 'request' | 'redirect' | 'page' | 'refusal' | 'replay' | 'checkpoint' | 'run-end';
  at?: string;
  [member: string]: unknown;
}

/* ------------------------------- credentials ----------------------------- */

/** The request headers a credential becomes, and every form of it an answer is searched for. */
export interface EpcisCredentialGuard {
  headers: Record<string, string>;
  carries(text: string): boolean;
  carriesBytes(bytes: Uint8Array): boolean;
  redact(text: string): string;
}

const RESERVED_HEADERS = ['accept', 'gs1-epcis-version', 'gs1-cbv-version', 'host', 'content-length', 'transfer-encoding', 'connection'];

/** Why a credential cannot be used, in words that never include it. */
export function credentialProblem(credential: unknown): string | undefined {
  if (credential == null || typeof credential !== 'object') return 'a credential is an object with a scheme';
  const secret = (value: unknown, what: string): string | undefined => (typeof value !== 'string' || value.length < EPCIS_MIN_SECRET_LENGTH || value.length > 8192 || CONTROL.test(value)
    ? `${what} is ${EPCIS_MIN_SECRET_LENGTH} to 8192 characters without control characters; a shorter secret cannot be told from ordinary text when an answer is searched for it`
    : undefined);
  const c = credential as Record<string, unknown>;
  if (c.scheme === 'bearer') return secret(c.token, 'a bearer token');
  if (c.scheme === 'basic') {
    if (typeof c.username !== 'string' || c.username.length < 1 || c.username.length > 256 || CONTROL.test(c.username) || c.username.includes(':')) return 'a basic user name is 1 to 256 characters without a colon or control characters';
    return secret(c.password, 'a basic password');
  }
  if (c.scheme === 'header') {
    if (typeof c.name !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(c.name) || RESERVED_HEADERS.includes(c.name.toLowerCase())) return 'a credential header has a name of letters, digits and hyphens that is not one of the headers every request sets';
    return secret(c.value, 'a credential header value');
  }
  return 'a credential scheme is bearer, basic or header';
}

/** Build the guard for a credential that passed `credentialProblem`. Without a credential there is nothing to send and nothing to search for. */
export function credentialGuard(credential: EpcisSourceCredential | undefined): EpcisCredentialGuard {
  if (credential == null) return { headers: {}, carries: () => false, carriesBytes: () => false, redact: (text) => text };
  const secrets: string[] = [];
  let headers: Record<string, string>;
  if (credential.scheme === 'bearer') {
    secrets.push(credential.token);
    headers = { authorization: `Bearer ${credential.token}` };
  } else if (credential.scheme === 'basic') {
    const encoded = Buffer.from(`${credential.username}:${credential.password}`, 'utf8').toString('base64');
    secrets.push(credential.password, encoded);
    headers = { authorization: `Basic ${encoded}` };
  } else {
    secrets.push(credential.value);
    headers = { [credential.name.toLowerCase()]: credential.value };
  }
  // A source that echoes a secret may echo it as it travelled, percent-encoded as in an address, or as a form value.
  const forms = [...new Set(secrets.flatMap((secret) => [secret, encodeURIComponent(secret), new URLSearchParams({ v: secret }).toString().slice(2)]))].sort((a, b) => b.length - a.length);
  const needles = forms.map((form) => Buffer.from(form, 'utf8'));
  // An address can spell any character as a percent escape, so text that may be one is searched as written and as it decodes.
  const decoded = (text: string): string => { try { return decodeURIComponent(text.replace(/\+/g, ' ')); } catch { return text; } };
  return {
    headers,
    carries: (text) => forms.some((form) => text.includes(form)) || secrets.some((secret) => decoded(text).includes(secret)),
    carriesBytes: (bytes) => { const hay = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength); return needles.some((needle) => hay.includes(needle)); },
    redact: (text) => forms.reduce((out, form) => out.split(form).join('[credential removed]'), text),
  };
}

/* ---------------------------------- targets ------------------------------ */

function isPrivateV4(a: number, b: number, c: number, d: number): boolean {
  if (a > 255 || b > 255 || c > 255 || d > 255) return true;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

/** The eight groups of an IPv6 literal, with an IPv4 tail folded in. Undefined when it does not parse. */
function ipv6Groups(host: string): number[] | undefined {
  let text = host;
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (tail != null) {
    const octets = tail.slice(1, 5).map(Number);
    if (octets.some((octet) => octet > 255)) return undefined;
    text = `${text.slice(0, tail.index)}${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] === '' ? [] : halves[0]!.split(':');
  const rest = halves.length === 2 ? (halves[1] === '' ? [] : halves[1]!.split(':')) : undefined;
  if (rest != null && head.length + rest.length > 7) return undefined;
  const parts = rest == null ? head : [...head, ...new Array<string>(8 - head.length - rest.length).fill('0'), ...rest];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return undefined;
  return parts.map((part) => parseInt(part, 16));
}

function isPrivateV6(g: number[]): boolean {
  const zeroTo = (n: number): boolean => g.slice(0, n).every((group) => group === 0);
  if (zeroTo(7) && (g[7] === 0 || g[7] === 1)) return true;
  if ((g[0]! & 0xfe00) === 0xfc00 || (g[0]! & 0xffc0) === 0xfe80) return true;
  // An IPv4 address carried inside an IPv6 one is held to the IPv4 rule.
  const mapped = zeroTo(5) && g[5] === 0xffff;
  const compatible = zeroTo(6);
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((group) => group === 0);
  if (mapped || compatible || nat64) return isPrivateV4(g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8, g[7]! & 0xff);
  return false;
}

/** Whether a host is a private, loopback, link-local or otherwise non-public address, by literal or by reserved name. */
export function isPrivateHost(rawHost: string): boolean {
  const host = rawHost.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4 != null) return isPrivateV4(Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4]));
  if (host.includes(':')) { const groups = ipv6Groups(host); return groups == null ? true : isPrivateV6(groups); }
  return false;
}

/** Why an address may not be requested, or undefined when it may. Made before every request, whatever named the address. */
export async function targetRefusal(raw: string, policy: EpcisTargetPolicy): Promise<string | undefined> {
  let url: URL;
  try { url = new URL(raw); } catch { return 'the address does not parse'; }
  if (url.username !== '' || url.password !== '') return 'the address carries user information, which is never sent';
  if (url.protocol !== 'https:' && !(policy.localTest && url.protocol === 'http:')) return `the scheme ${url.protocol.replace(':', '')} is refused: a source is reached over https, and over http only under the local-test option`;
  if (!policy.permittedOrigins.includes(url.origin)) return `the origin ${url.origin} is not one this source permits`;
  if (policy.localTest) return undefined;
  if (isPrivateHost(url.hostname)) return `the host ${url.hostname} is a private or local address, which is refused outside the local-test option`;
  if (policy.resolveHost != null && !/^[\d.]+$|:/.test(url.hostname)) {
    let addresses: string[];
    try { addresses = await policy.resolveHost(url.hostname); } catch { return `the host ${url.hostname} could not be resolved`; }
    if (addresses.length === 0 || addresses.some((address) => isPrivateHost(address))) return `the host ${url.hostname} resolves to a private or local address, which is refused outside the local-test option`;
  }
  return undefined;
}

/* ------------------------------- the next link --------------------------- */

export type EpcisNextLink =
  | { kind: 'none' }
  | { kind: 'next'; target: string; unquoted: boolean }
  | { kind: 'malformed'; detail: string };

/**
 * The target of the `next` relation of a Link header (RFC 8288), resolved
 * against the page that carried it. A relation written without quotes is
 * read the same as a quoted one. Two different targets, a target that does
 * not parse and a header past the length limit are malformed, never guessed.
 */
export function parseNextLink(header: string | null, pageUrl: string): EpcisNextLink {
  if (header == null || header.trim() === '') return { kind: 'none' };
  if (header.length > MAX_LINK_HEADER) return { kind: 'malformed', detail: `the Link header is longer than ${MAX_LINK_HEADER} characters` };
  const found: Array<{ target: string; unquoted: boolean }> = [];
  let at = 0;
  while (at < header.length) {
    const open = header.indexOf('<', at);
    if (open === -1) break;
    const close = header.indexOf('>', open + 1);
    if (close === -1) return { kind: 'malformed', detail: 'a link target is not closed' };
    const reference = header.slice(open + 1, close);
    // The parameters run to the next comma that is outside a quoted string.
    let end = close + 1;
    let quoted = false;
    while (end < header.length && (quoted || header[end] !== ',')) {
      if (header[end] === '\\' && quoted) end += 1;
      else if (header[end] === '"') quoted = !quoted;
      end += 1;
    }
    const parameters = header.slice(close + 1, end);
    const relation = /;\s*rel\s*=\s*(?:"([^"]*)"|([^;,\s"]+))/i.exec(parameters);
    if (relation != null && (relation[1] ?? relation[2] ?? '').toLowerCase().split(/\s+/).includes('next')) {
      let target: string;
      try { target = new URL(reference.trim(), pageUrl).toString(); } catch { return { kind: 'malformed', detail: 'the next link target does not parse as an address' }; }
      found.push({ target, unquoted: relation[1] === undefined });
    }
    at = end + 1;
  }
  if (found.length === 0) return { kind: 'none' };
  if (new Set(found.map((link) => link.target)).size > 1) return { kind: 'malformed', detail: 'the Link header names more than one next page' };
  return { kind: 'next', target: found[0]!.target, unquoted: found.some((link) => link.unquoted) };
}

/* --------------------------------- one page ------------------------------ */

export interface EpcisPageRequest {
  /** The address to ask: the query's first page, or the page a cursor names. */
  url: string;
  /** True when the address came from a cursor, so a refusal of it can be told from a refusal of the query. */
  usesCursor: boolean;
  /** The one origin the credential is sent to. */
  credentialOrigin: string;
  policy: EpcisTargetPolicy;
  guard: EpcisCredentialGuard;
  wireVersions: { epcis: string; cbv: string };
  /** The largest page accepted. */
  maxPageBytes: number;
  /** What is left of the run's byte limit. */
  bytesLeft: number;
  /** How long this page may take, redirects and body included. */
  timeoutMs: number;
  /** What is left of the run's time. */
  runMsLeft: number;
  /** Addresses already asked in this traversal: a source that names one of them again is looping. */
  asked: ReadonlySet<string>;
  fetch: EpcisFetch;
  log: (entry: EpcisPullLogEntry) => void;
}

export type EpcisPageAnswer =
  | {
      ok: true;
      /** The address that answered, after any redirects. */
      url: string;
      bytes: Uint8Array;
      mediaType: string;
      next?: Omit<EpcisPullCursor, 'afterPage'>;
      /** True when the source named no further page. */
      last: boolean;
      nextProblem?: { reason: 'pagination-malformed' | 'pagination-target-refused'; detail: string };
      server: EpcisPullServerVersions;
      leniencies: EpcisPullLeniency[];
    }
  | { ok: false; outcome: EpcisSourceOutcome; reason: EpcisPullReason; detail: string; status?: number; cursorRejected?: boolean };

type Failure = Extract<EpcisPageAnswer, { ok: false }>;

const baseMediaType = (value: string | null): string | undefined => { const base = value?.split(';')[0]?.trim().toLowerCase(); return base == null || base === '' ? undefined : base; };
const compatibleVersion = (value: string): boolean => /^2\.0(\.\d{1,4})?$/.test(value);

/** Whether bytes sent under a JSON media type are an HTML document, which is what a sign-in or error page is. */
function looksLikeHtml(bytes: Uint8Array): boolean {
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 512)).replace(/^﻿/, '').trimStart().toLowerCase();
  return ['<!doctype html', '<html', '<head', '<body'].some((start) => head.startsWith(start));
}

/**
 * Ask for one page and read it within its bounds. Every failure is named.
 * A page that is answered is returned as bytes: nothing has been parsed and
 * nothing is retained.
 */
export async function fetchEpcisPage(request: EpcisPageRequest): Promise<EpcisPageAnswer> {
  const { guard, policy, log } = request;
  const send = request.fetch;
  const fail = (outcome: EpcisSourceOutcome, reason: EpcisPullReason, detail: string, extra: { status?: number; cursorRejected?: boolean } = {}): Failure => {
    const failure: Failure = { ok: false, outcome, reason, detail: guard.redact(detail), ...extra };
    log({ event: 'refusal', outcome, reason, detail: failure.detail, ...(extra.status == null ? {} : { status: extra.status }) });
    return failure;
  };

  // One clock for the whole page: the redirects and the body share it. Whichever bound is nearer names the failure.
  const byRun = request.runMsLeft < request.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(request.timeoutMs, request.runMsLeft)));
  let cancelWait: () => void = () => undefined;
  // A transport that ignores the signal must not hold a run past its bounds, so every wait also ends when the signal fires.
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => reject(new Error('aborted'));
    controller.signal.addEventListener('abort', onAbort, { once: true });
    cancelWait = () => controller.signal.removeEventListener('abort', onAbort);
  });
  aborted.catch(() => undefined);
  const within = <T>(work: Promise<T>): Promise<T> => Promise.race([work, aborted]);
  const lateness = (): Failure => (byRun
    ? fail('partial-history', 'time-limit', 'the run reached its time limit while a page was being read')
    : fail('source-unavailable', 'timeout', `the source did not answer a page within ${request.timeoutMs} ms`));
  const discard = (response: EpcisFetchResponse): void => { void response.body?.getReader().cancel().catch(() => undefined); };

  try {
    let current = request.url;
    for (let hop = 0; hop <= EPCIS_PULL_MAX_REDIRECTS; hop += 1) {
      const refusal = await targetRefusal(current, policy);
      if (refusal != null) {
        if (hop > 0) return fail('source-unavailable', 'redirect-refused', `the source redirected to an address that is refused: ${refusal}`);
        return request.usesCursor ? fail('partial-history', 'pagination-target-refused', `the next page's address is refused: ${refusal}`) : fail('source-unavailable', 'target-refused', refusal);
      }
      const credentialSent = Object.keys(guard.headers).length > 0 && new URL(current).origin === request.credentialOrigin;
      const headers: Record<string, string> = { accept: 'application/ld+json, application/json', 'gs1-epcis-version': request.wireVersions.epcis, 'gs1-cbv-version': request.wireVersions.cbv, ...(credentialSent ? guard.headers : {}) };
      log({ event: hop === 0 ? 'request' : 'redirect', url: guard.redact(current), credentialSent });

      let response: EpcisFetchResponse;
      try {
        response = await within(send(current, { method: 'GET', headers, redirect: 'manual', signal: controller.signal }));
      } catch (error) {
        if (controller.signal.aborted) return lateness();
        return fail('source-unavailable', 'network-error', `the source could not be reached: ${error instanceof Error ? error.message : 'the transport failed'}`);
      }
      const header = (name: string): string | null => response.headers.get(name);
      const status = response.status;

      if ([301, 302, 303, 307, 308].includes(status)) {
        discard(response);
        const location = header('location');
        if (location == null || location === '') return fail('source-unavailable', 'redirect-malformed', `the source answered ${status} without a location`, { status });
        if (guard.carries(location)) return fail('invalid-source', 'credential-echoed', 'the source put the credential it was sent into a redirect', { status });
        try { current = new URL(location, current).toString(); } catch { return fail('source-unavailable', 'redirect-malformed', `the source answered ${status} with a location that does not parse`, { status }); }
        continue;
      }
      if (status === 401) { discard(response); return fail('source-authentication-required', 'http-401', 'the source demanded credentials, or refused the ones it was sent', { status }); }
      if (status === 403) { discard(response); return fail('source-forbidden', 'http-403', 'the source refused this caller', { status }); }
      if (request.usesCursor && (status === 400 || status === 404 || status === 410)) {
        discard(response);
        return fail('partial-history', 'cursor-unusable', `the source answered ${status} to the next page's address: it no longer accepts the cursor`, { status, cursorRejected: true });
      }
      if (status !== 200) { discard(response); return fail('source-unavailable', 'http-error', `the source answered ${status}`, { status }); }

      const mediaType = baseMediaType(header('content-type'));
      if (mediaType == null || !EPCIS_MEDIA.includes(mediaType)) {
        discard(response);
        return fail('unexpected-media-type', 'media-type', `the source answered ${mediaType == null ? 'no media type' : JSON.stringify(mediaType.slice(0, 80))} with status 200, which is not an EPCIS document`, { status });
      }

      // The body is counted as it arrives. A transport that decompresses hands over decompressed chunks, so this bounds what a compressed answer expands to as well.
      const cap = Math.min(request.maxPageBytes, request.bytesLeft);
      const overCap = (): Failure => (request.maxPageBytes <= request.bytesLeft
        ? fail('invalid-source', 'page-oversized', `the page is larger than the ${request.maxPageBytes} byte page limit; it was abandoned while it was being read`, { status })
        : fail('partial-history', 'byte-limit', 'the page would take the run past its byte limit; it was abandoned while it was being read', { status }));
      const declared = header('content-length');
      // A declared length is the length on the wire, so it can refuse a page early and can never admit one.
      if (declared != null && /^\d+$/.test(declared) && header('content-encoding') == null && Number(declared) > cap) { discard(response); return overCap(); }
      const chunks: Uint8Array[] = [];
      let total = 0;
      if (response.body != null) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            const { done, value } = await within(reader.read());
            if (done) break;
            if (value == null) continue;
            total += value.byteLength;
            if (total > cap) { void reader.cancel().catch(() => undefined); return overCap(); }
            chunks.push(value);
          }
        } catch (error) {
          void reader.cancel().catch(() => undefined);
          if (controller.signal.aborted) return lateness();
          return fail('source-unavailable', 'network-error', `the page stopped arriving: ${error instanceof Error ? error.message : 'the transport failed'}`, { status });
        }
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }

      if (looksLikeHtml(bytes)) return fail('unexpected-media-type', 'html-body', 'the source answered an HTML document under a JSON media type, which is a sign-in or error page and not an EPCIS document', { status });
      if (guard.carriesBytes(bytes)) return fail('invalid-source', 'credential-echoed', 'the page carries the credential the source was sent; nothing of it is kept', { status });

      const leniencies: EpcisPullLeniency[] = [];
      const epcis = header('gs1-epcis-version')?.trim();
      const cbv = header('gs1-cbv-version')?.trim();
      if (epcis == null || epcis === '') return fail('invalid-source', 'wire-version-missing', 'the source sent no GS1-EPCIS-Version header, so it did not say which version of the interface answered; the document is not read for it', { status });
      if (!compatibleVersion(epcis)) return fail('invalid-source', 'wire-version-unsupported', 'the source answered under an EPCIS version other than 2.0, which this profile does not read', { status });
      if (cbv == null || cbv === '') leniencies.push('cbv-version-header-absent');
      else if (!compatibleVersion(cbv)) return fail('invalid-source', 'wire-version-unsupported', 'the source answered under a CBV version other than 2.0, which this profile does not read', { status });
      const server: EpcisPullServerVersions = { epcis, ...(cbv == null || cbv === '' ? {} : { cbv }) };

      const linkHeader = header('link');
      if (linkHeader != null && guard.carries(linkHeader)) return fail('invalid-source', 'credential-echoed', 'the source put the credential it was sent into the next page link; nothing of the page is kept', { status });
      const link = parseNextLink(linkHeader, current);
      const page = { ok: true as const, url: current, bytes, mediaType, server, leniencies };
      if (link.kind === 'none') { log({ event: 'page', url: guard.redact(current), bytes: total, last: true }); return { ...page, last: true }; }
      const problem = (reason: 'pagination-malformed' | 'pagination-target-refused', detail: string): EpcisPageAnswer => {
        log({ event: 'page', url: guard.redact(current), bytes: total, last: false, nextProblem: reason });
        return { ...page, last: false, nextProblem: { reason, detail } };
      };
      if (link.kind === 'malformed') return problem('pagination-malformed', link.detail);
      if (link.target.length > MAX_TARGET) return problem('pagination-malformed', `the next page's address is longer than ${MAX_TARGET} characters`);
      if (link.target === request.url || link.target === current || request.asked.has(link.target)) return problem('pagination-malformed', 'the source named a page that was already read as the next page');
      const refused = await targetRefusal(link.target, policy);
      if (refused != null) return problem('pagination-target-refused', `the source named a next page that is refused: ${refused}`);
      const token = new URL(link.target).searchParams.get('nextPageToken') ?? undefined;
      if (token != null && (token.length > MAX_TOKEN || CONTROL.test(token))) return problem('pagination-malformed', `the next page token is longer than ${MAX_TOKEN} characters or carries control characters`);
      if (link.unquoted) leniencies.push('link-relation-unquoted');
      if (token != null && /^\d+$/.test(token)) leniencies.push('next-page-token-numeric');
      let expiresAt: string | undefined;
      const expires = header('gs1-next-page-token-expires')?.trim();
      if (expires != null && expires !== '') {
        const time = /^\d+$/.test(expires) ? Number.NaN : Date.parse(expires);
        if (Number.isNaN(time)) leniencies.push('cursor-expiry-unreadable');
        else expiresAt = new Date(time).toISOString();
      }
      log({ event: 'page', url: guard.redact(current), bytes: total, last: false });
      return { ...page, last: false, next: { target: link.target, ...(token == null ? {} : { token }), ...(expiresAt == null ? {} : { expiresAt }) } };
    }
    return fail('source-unavailable', 'redirect-limit', `the source redirected more than ${EPCIS_PULL_MAX_REDIRECTS} times`);
  } finally {
    clearTimeout(timer);
    cancelWait();
  }
}
