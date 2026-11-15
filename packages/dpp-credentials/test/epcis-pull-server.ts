/**
 * A fixture server for the pull tests: a small, deliberately adjustable
 * stand-in for the standard events query. It listens on 127.0.0.1 only, on a
 * port the system picks, and every test that starts one stops it.
 *
 * It is not an EPCIS repository and implements no more of the query
 * interface than the tests ask of it. Every identifier is synthetic, under
 * the GS1 demonstration prefix 952.
 */
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { EPCIS_CONTEXT_IRI } from '../src/epcis-source.js';
import type { JsonObject } from '../src/types.js';

export interface FixtureRequest {
  path: string;
  /** The query parameters, decoded. A parameter sent more than once is here with its last value. */
  query: Record<string, string>;
  /** Every value of every query parameter, in the order sent. */
  queryAll: Record<string, string[]>;
  headers: IncomingHttpHeaders;
}

export interface FixtureBehaviour {
  /** Answer 401 unless the request carries exactly this Authorization header. */
  requireAuthorization?: string;
  /** Answer 403 to every request. */
  forbid?: boolean;
  /** How the relation of the next link is written. */
  linkRelation: 'quoted' | 'unquoted';
  /** Whether the next link is an absolute address or relative to the page. */
  linkTarget: 'absolute' | 'relative';
  /** `opaque`: a token that means nothing to a client. `numeric`: the bare offset of the next page. */
  tokenStyle: 'opaque' | 'numeric';
  /** Send GS1-Next-Page-Token-Expires this many seconds after `clock()`. */
  tokenTtlSeconds?: number;
  /** Answer this status to a token for which the predicate holds. */
  rejectToken?: (token: string) => number | undefined;
  /** The version headers. `null` leaves one out. */
  epcisVersion: string | null;
  cbvVersion: string | null;
  mediaType: string;
  /** `changing` puts a new creationDate in every answer, as a live repository does, so a page read twice differs in its bytes. */
  creationDate: 'fixed' | 'changing';
  /**
   * How the source reads a list-valued parameter. `pipe`: one parameter whose
   * values are separated by `|`, as the interface description declares.
   * `repeated`: one parameter per value. Such a source takes a value with a
   * `|` in it for a single value it cannot read, and answers a server error.
   */
  listParameters: 'pipe' | 'repeated';
  /** When the last page is full, name one more page, which is then empty. */
  emptyTailPage: boolean;
  /** The clock expiry is stated against. */
  clock: () => number;
  /** Called for every request before it is answered. */
  onRequest?: (request: FixtureRequest) => void | Promise<void>;
  /** Answer a request by hand. Return true when it was answered. */
  intercept?: (request: FixtureRequest, response: ServerResponse, incoming: IncomingMessage) => boolean | Promise<boolean>;
  /** Change the headers of an ordinary page before it is sent. */
  pageHeaders?: (headers: Record<string, string>, request: FixtureRequest) => void;
  /** Change the body of an ordinary page before it is sent. */
  pageDocument?: (document: JsonObject, request: FixtureRequest) => JsonObject;
  /**
   * Write the body of an ordinary page another way than a serialiser would:
   * it is handed the page as compact JSON and answers the text to send. A
   * test uses it to send spacing, line endings and an order of members that
   * parsing and writing out again would not give back.
   */
  pageText?: (json: string, request: FixtureRequest) => string;
  /** Send each ordinary page compressed with gzip, under a Content-Encoding header. What is recorded as sent is the body before compression. */
  gzip?: boolean;
}

/** One ordinary page as the fixture wrote it: the request it answered and the exact bytes of the body, before any content encoding. */
export interface FixturePageSent {
  request: FixtureRequest;
  body: Uint8Array;
}

export interface FixtureServer {
  origin: string;
  /** The base address of the events query. */
  baseUrl: string;
  /** The events the query answers from. Tests add to it between runs. */
  events: JsonObject[];
  behaviour: FixtureBehaviour;
  /** Every request received, in order. */
  requests: FixtureRequest[];
  /** The page requests among them: those for `/epcis/events`. */
  pageRequests(): FixtureRequest[];
  /** Every ordinary page answered, in order, with the bytes that were written for it. */
  pagesSent: FixturePageSent[];
  /** Stop listening and drop every open connection, keeping everything else: a later request is refused by the system until `listen` is called. */
  stop(): Promise<void>;
  /** Listen again on the same port, after `stop`. */
  listen(): Promise<void>;
  close(): Promise<void>;
}

/* --------------------------------- events -------------------------------- */

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
export const pullEventId = (n: number): string => `urn:uuid:00000000-0000-4000-8000-0000000001${pad(n)}`;
export const pullItem = (n: number): string => `urn:epc:id:sgtin:9521234.012345.PULL-${n}`;
/** Minute `n` of a fixed hour, so events sort by their number. */
export const pullTime = (n: number, hour = 9): string => `2026-03-02T${pad(hour)}:${pad(n)}:00.000Z`;

/** One synthetic observation of one synthetic item. Event `n` was recorded at minute `n`. */
export function pullEvent(n: number, fields: JsonObject = {}): JsonObject {
  return { type: 'ObjectEvent', eventID: pullEventId(n), eventTime: pullTime(n, 8), eventTimeZoneOffset: '+00:00', recordTime: pullTime(n), epcList: [pullItem(n)], action: 'OBSERVE', bizStep: 'inspecting', disposition: 'active', ...fields };
}

export const pullEvents = (count: number, from = 1): JsonObject[] => Array.from({ length: count }, (_, index) => pullEvent(from + index));

/* --------------------------------- server -------------------------------- */

const LISTS = ['epcList', 'childEPCs', 'inputEPCList', 'outputEPCList'];
const LIST_PARAMETERS = ['MATCH_anyEPC', 'eventType', 'EQ_eventID'];

function matches(event: JsonObject, request: FixtureRequest, lists: 'pipe' | 'repeated'): boolean {
  const { query } = request;
  const any = (name: string): string[] | undefined => (query[name] == null ? undefined : lists === 'repeated' ? request.queryAll[name] : query[name]!.split('|'));
  const epcs = any('MATCH_anyEPC');
  if (epcs != null) {
    const named = [...LISTS.flatMap((list) => (Array.isArray(event[list]) ? (event[list] as unknown[]) : [])), event.parentID];
    if (!epcs.some((epc) => named.includes(epc))) return false;
  }
  const types = any('eventType');
  if (types != null && !types.includes(String(event.type))) return false;
  const ids = any('EQ_eventID');
  if (ids != null && !ids.includes(String(event.eventID))) return false;
  const time = (value: unknown): number => Date.parse(String(value));
  if (query.GE_eventTime != null && !(time(event.eventTime) >= time(query.GE_eventTime))) return false;
  if (query.LT_eventTime != null && !(time(event.eventTime) < time(query.LT_eventTime))) return false;
  if (query.GE_recordTime != null && !(time(event.recordTime) >= time(query.GE_recordTime))) return false;
  return true;
}

export async function startEpcisFixtureServer(events: JsonObject[] = [], behaviour: Partial<FixtureBehaviour> = {}): Promise<FixtureServer> {
  const settings: FixtureBehaviour = { linkRelation: 'quoted', linkTarget: 'absolute', tokenStyle: 'opaque', epcisVersion: '2.0.0', cbvVersion: '2.0.0', mediaType: 'application/ld+json', creationDate: 'fixed', listParameters: 'pipe', emptyTailPage: false, clock: () => Date.now(), ...behaviour };
  const requests: FixtureRequest[] = [];
  const tokens = new Map<string, number>();
  let answers = 0;
  let origin = '';
  const pagesSent: FixturePageSent[] = [];
  const fixture: FixtureServer = { origin: '', baseUrl: '', events: [...events], behaviour: settings, requests, pageRequests: () => requests.filter((request) => request.path === '/epcis/events'), pagesSent, stop: async () => undefined, listen: async () => undefined, close: async () => undefined };

  const page = (request: FixtureRequest, response: ServerResponse): void => {
    const { query } = request;
    let offset = 0;
    if (query.nextPageToken != null) {
      const status = settings.rejectToken?.(query.nextPageToken);
      const known = settings.tokenStyle === 'numeric' ? Number(query.nextPageToken) : tokens.get(query.nextPageToken);
      if (status != null || known == null || Number.isNaN(known)) { response.writeHead(status ?? 410, { 'content-type': 'application/problem+json' }).end('{"title":"the page token is not known"}'); return; }
      offset = known;
    }
    // A source that reads lists as repeated parameters has no way to read a pipe-delimited one, and fails on it.
    if (settings.listParameters === 'repeated' && LIST_PARAMETERS.some((name) => (request.queryAll[name] ?? []).some((value) => value.includes('|')))) {
      response.writeHead(500, { 'content-type': 'application/problem+json' }).end('{"title":"the query could not be read"}');
      return;
    }
    const perPage = Math.max(1, Number(query.perPage ?? '30'));
    const matched = fixture.events.filter((event) => matches(event, request, settings.listParameters));
    const slice = matched.slice(offset, offset + perPage);
    const more = offset + perPage < matched.length || (settings.emptyTailPage && slice.length === perPage && offset + perPage === matched.length);
    answers += 1;
    const headers: Record<string, string> = { 'content-type': settings.mediaType };
    if (settings.epcisVersion != null) headers['GS1-EPCIS-Version'] = settings.epcisVersion;
    if (settings.cbvVersion != null) headers['GS1-CBV-Version'] = settings.cbvVersion;
    if (more) {
      const next = offset + perPage;
      const token = settings.tokenStyle === 'numeric' ? String(next) : `t${Buffer.from(`after-${next}`).toString('base64url')}`;
      tokens.set(token, next);
      // The next link carries the query as it was asked, repeats included.
      const parameters = new URLSearchParams(Object.entries(request.queryAll).flatMap(([name, values]) => values.map((value) => [name, value])));
      parameters.set('nextPageToken', token);
      const target = settings.linkTarget === 'absolute' ? `${origin}/epcis/events?${parameters.toString()}` : `events?${parameters.toString()}`;
      headers.Link = settings.linkRelation === 'quoted' ? `<${target}>; rel="next"` : `<${target}>; rel=next`;
      if (settings.tokenTtlSeconds != null) headers['GS1-Next-Page-Token-Expires'] = new Date(settings.clock() + settings.tokenTtlSeconds * 1000).toISOString();
    }
    let document: JsonObject = {
      '@context': [EPCIS_CONTEXT_IRI],
      type: 'EPCISQueryDocument',
      schemaVersion: '2.0',
      creationDate: settings.creationDate === 'fixed' ? '2026-03-03T07:00:00.000Z' : new Date(Date.parse('2026-03-03T07:00:00.000Z') + answers * 1000).toISOString(),
      epcisBody: { queryResults: { queryName: 'SimpleEventQuery', resultsBody: { eventList: slice } } },
    };
    settings.pageHeaders?.(headers, request);
    if (settings.pageDocument != null) document = settings.pageDocument(document, request);
    const json = JSON.stringify(document);
    const body = Buffer.from(settings.pageText == null ? json : settings.pageText(json, request), 'utf8');
    pagesSent.push({ request, body: new Uint8Array(body) });
    if (settings.gzip === true) { response.writeHead(200, { ...headers, 'content-encoding': 'gzip' }).end(gzipSync(body)); return; }
    response.writeHead(200, headers).end(body);
  };

  const server: Server = createServer((incoming, response) => {
    void (async () => {
      const url = new URL(incoming.url ?? '/', origin);
      const queryAll: Record<string, string[]> = {};
      for (const [name, value] of url.searchParams) (queryAll[name] ??= []).push(value);
      const request: FixtureRequest = { path: url.pathname, query: Object.fromEntries(url.searchParams), queryAll, headers: incoming.headers };
      requests.push(request);
      await settings.onRequest?.(request);
      if (settings.intercept != null && (await settings.intercept(request, response, incoming))) return;
      if (settings.forbid === true) { response.writeHead(403).end(); return; }
      if (settings.requireAuthorization != null && incoming.headers.authorization !== settings.requireAuthorization) { response.writeHead(401, { 'www-authenticate': 'Bearer' }).end(); return; }
      if (url.pathname !== '/epcis/events') { response.writeHead(404).end(); return; }
      page(request, response);
    })().catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;
  fixture.origin = origin;
  fixture.baseUrl = `${origin}/epcis`;
  const stop = (): Promise<void> => new Promise<void>((resolve) => { if (!server.listening) { resolve(); return; } server.closeAllConnections(); server.close(() => resolve()); });
  fixture.stop = stop;
  fixture.listen = () => new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  fixture.close = stop;
  return fixture;
}
