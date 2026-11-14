/**
 * The GS1 files this package validates against, and how a deployment obtains
 * them.
 *
 * GS1 publishes these files under its own terms. This repository and its
 * packages do not redistribute them. Each deployment obtains them from GS1,
 * or its operator places them in a folder, and every byte is checked against
 * a pinned digest before anything reads it.
 *
 * What the package holds is a table of facts about each file: its address at
 * GS1, its SHA-256 and its length. Nothing here runs when the module loads
 * or when the package installs. A caller provisions explicitly, once, and
 * validation reads from the folder offline afterwards. A file that is absent
 * or does not match is a named error, never a pass and never a skip.
 *
 * This module imports only Node built-ins, so a test or a tool in another
 * package can use it without this package's dependencies.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

/* --------------------------------- facts -------------------------------- */

/** One pinned GS1 file: where GS1 publishes it and the exact bytes expected. */
export interface Gs1Artefact {
  readonly id: string;
  /** The GS1 standard the file belongs to. */
  readonly standard: string;
  readonly version: string;
  /** The name the file has in the artefacts folder. A bare name, never a path. */
  readonly fileName: string;
  /** The address GS1 publishes it at, under https://ref.gs1.org/. */
  readonly uri: string;
  readonly sha256: string;
  readonly byteLength: number;
}

/** The only origin a file is ever fetched from. */
export const GS1_ARTEFACT_ORIGIN = 'https://ref.gs1.org';
/** The environment variable that names the artefacts folder when the caller passes none. */
export const GS1_ARTEFACTS_DIR_ENV = 'DPP_GS1_ARTEFACTS_DIR';
/** No pinned file is larger than this, so no response is read past it. */
export const GS1_ARTEFACT_MAX_BYTES = 4 * 1024 * 1024;
/** How long one file may take to arrive, redirects and body included. */
export const GS1_FETCH_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

/** The three EPCIS 2.0.1 files, as retrieved unchanged from ref.gs1.org on 6 September 2026. A changed upstream file is a new pinned version, never an edit of these facts. */
export const EPCIS_GS1_ARTEFACTS = [
  { id: 'epcis-json-schema', standard: 'GS1 EPCIS', version: '2.0.1', fileName: 'epcis-json-schema-2.0.1.json', uri: 'https://ref.gs1.org/standards/epcis/2.0.1/epcis-json-schema.json', sha256: '0f46ff694efffd8d8ce840a33dfde84228add11b516b8b258f3200740ae210af', byteLength: 55680 },
  { id: 'epcis-context', standard: 'GS1 EPCIS', version: '2.0.1', fileName: 'epcis-context-2.0.1.jsonld', uri: 'https://ref.gs1.org/standards/epcis/2.0.1/epcis-context.jsonld', sha256: '5056c65f991425b1d3a35e35edf4f7d0c7ff56cf688c2912b930f93494713737', byteLength: 20690 },
  { id: 'epcis-query-schema', standard: 'GS1 EPCIS', version: '2.0.1', fileName: 'query-schema-2.0.1.json', uri: 'https://ref.gs1.org/standards/epcis/2.0.1/query-schema.json', sha256: '4b5583c9a0a715324594617f3cf6744f4f930568484f7df8fb7aa81819355341', byteLength: 27229 },
] as const satisfies readonly Gs1Artefact[];

/* --------------------------------- folder ------------------------------- */

/**
 * The folder the files are read from and provisioned into: the explicit
 * argument, else DPP_GS1_ARTEFACTS_DIR, else a per-user cache folder
 * ($XDG_CACHE_HOME/dpp/gs1, or ~/.cache/dpp/gs1).
 */
export function gs1ArtefactsDir(explicit?: string): string {
  if (explicit != null && explicit !== '') return explicit;
  const fromEnvironment = process.env[GS1_ARTEFACTS_DIR_ENV];
  if (fromEnvironment != null && fromEnvironment !== '') return fromEnvironment;
  const cache = process.env.XDG_CACHE_HOME;
  return cache != null && cache !== '' ? join(cache, 'dpp', 'gs1') : join(homedir(), '.cache', 'dpp', 'gs1');
}

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** A table is caller-supplied, so a file name is held to a bare name before it touches the file system. */
function safeFileName(artefact: Gs1Artefact): boolean {
  const name = artefact.fileName;
  return typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && basename(name) === name && !/[\\/\0]/.test(name);
}

type Held = { status: 'ok'; bytes: Buffer } | { status: 'missing' | 'mismatch' };

function readHeld(dir: string, artefact: Gs1Artefact): Held {
  if (!safeFileName(artefact)) return { status: 'missing' };
  let bytes: Buffer;
  try { bytes = readFileSync(join(dir, artefact.fileName)); } catch { return { status: 'missing' }; }
  if (bytes.byteLength !== artefact.byteLength || sha256Hex(bytes) !== artefact.sha256) return { status: 'mismatch' };
  return { status: 'ok', bytes };
}

/* --------------------------------- verify ------------------------------- */

export type Gs1ArtefactStatus = 'ok' | 'missing' | 'mismatch';

export interface Gs1ArtefactCheck {
  id: string;
  fileName: string;
  path: string;
  status: Gs1ArtefactStatus;
}

export interface Gs1VerifyReport {
  /** True only when every file is present and matches its pinned digest and length. */
  ok: boolean;
  dir: string;
  files: Gs1ArtefactCheck[];
}

export interface Gs1ArtefactsOptions {
  dir?: string;
  artefacts?: readonly Gs1Artefact[];
}

/** Check the folder against the table without touching the network. */
export function verifyGs1Artefacts(options: Gs1ArtefactsOptions = {}): Gs1VerifyReport {
  const dir = gs1ArtefactsDir(options.dir);
  const files = (options.artefacts ?? EPCIS_GS1_ARTEFACTS).map((artefact) => ({ id: artefact.id, fileName: artefact.fileName, path: join(dir, String(artefact.fileName)), status: readHeld(dir, artefact).status }));
  return { ok: files.every((f) => f.status === 'ok'), dir, files };
}

/* ---------------------------------- read -------------------------------- */

const REMEDY = (dir: string): string => `Run "dpp-gs1-artefacts fetch --dir ${dir}" or call provisionGs1Artefacts({ dir }) once to obtain it from GS1, or place the file GS1 publishes in that folder.`;

/** A pinned GS1 file is absent from the artefacts folder or does not match its digest. Validation that needs the file refuses with this error. */
export class Gs1ArtefactUnavailableError extends Error {
  readonly code = 'gs1-artefact-unavailable' as const;
  readonly artefactId: string;
  readonly dir: string;
  readonly status: 'missing' | 'mismatch';
  /** One sentence saying how to provision the folder. */
  readonly remedy: string;

  constructor(artefact: Gs1Artefact, dir: string, status: 'missing' | 'mismatch') {
    const remedy = REMEDY(dir);
    super(`The GS1 artefact ${artefact.id} (${artefact.fileName}) ${status === 'missing' ? 'is not in' : 'does not match its pinned digest in'} ${dir}. ${remedy}`);
    this.name = 'Gs1ArtefactUnavailableError';
    this.artefactId = artefact.id;
    this.dir = dir;
    this.status = status;
    this.remedy = remedy;
  }
}

/** The verified bytes of one provisioned file. Throws Gs1ArtefactUnavailableError when the file is absent or altered; it never returns unverified bytes. */
export function readGs1Artefact(artefact: Gs1Artefact, options: { dir?: string } = {}): Buffer {
  const dir = gs1ArtefactsDir(options.dir);
  const held = readHeld(dir, artefact);
  if (held.status !== 'ok') throw new Gs1ArtefactUnavailableError(artefact, dir, held.status);
  return held.bytes;
}

/* -------------------------------- provision ----------------------------- */

export type Gs1ProvisionFailure =
  | 'offline'
  | 'entry-refused'
  | 'address-refused'
  | 'redirect-refused'
  | 'http-status'
  | 'length-mismatch'
  | 'digest-mismatch'
  | 'timeout'
  | 'network'
  | 'write-failed';

export interface Gs1ProvisionEntry {
  id: string;
  fileName: string;
  path: string;
  /** present: already in the folder and correct. fetched: obtained from GS1, checked and stored. failed: not available; `reason` says why. */
  outcome: 'present' | 'fetched' | 'failed';
  reason?: Gs1ProvisionFailure;
  detail?: string;
}

export interface Gs1ProvisionReport {
  /** True only when every file is now in the folder and matches its pinned digest and length. */
  ok: boolean;
  dir: string;
  files: Gs1ProvisionEntry[];
}

export interface Gs1ProvisionOptions extends Gs1ArtefactsOptions {
  /** The fetch to use; the platform's by default. Injectable so a test never needs the network. */
  fetch?: typeof globalThis.fetch;
  /** Never fetch: report what the folder holds and fail what it lacks. */
  offline?: boolean;
  /** Per file, redirects and body included. */
  timeoutMs?: number;
}

class Refusal extends Error {
  constructor(readonly reason: Gs1ProvisionFailure, detail: string) { super(detail); }
}

/** Only https://ref.gs1.org/ on its default port, with no credentials. */
function gs1Address(candidate: string, base?: URL): URL | undefined {
  let url: URL;
  try { url = new URL(candidate, base); } catch { return undefined; }
  if (url.origin !== GS1_ARTEFACT_ORIGIN || url.username !== '' || url.password !== '') return undefined;
  return url;
}

/** Read at most `limit` bytes. One byte more than the pinned length is already a mismatch, so nothing past it is read. */
async function readCapped(response: Response, limit: number): Promise<Uint8Array> {
  if (response.body == null) {
    const all = new Uint8Array(await response.arrayBuffer());
    if (all.byteLength > limit) throw new Refusal('length-mismatch', `the response is longer than the pinned ${limit} bytes`);
    return all;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Refusal('length-mismatch', `the response is longer than the pinned ${limit} bytes`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

/** Fetch one file's bytes. Redirects are followed by hand so each hop is held to the GS1 origin before it is requested. */
async function fetchBytes(artefact: Gs1Artefact, fetcher: typeof globalThis.fetch, timeoutMs: number): Promise<Uint8Array> {
  const start = gs1Address(artefact.uri);
  if (start == null) throw new Refusal('address-refused', `${artefact.uri} is not an address under ${GS1_ARTEFACT_ORIGIN}/`);
  let url: URL = start;
  if (!Number.isInteger(artefact.byteLength) || artefact.byteLength < 0 || artefact.byteLength > GS1_ARTEFACT_MAX_BYTES) throw new Refusal('entry-refused', `the pinned length ${artefact.byteLength} is outside 0 to ${GS1_ARTEFACT_MAX_BYTES} bytes`);
  const abort = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort.abort(); }, timeoutMs);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await fetcher(url.href, { redirect: 'manual', signal: abort.signal, headers: { accept: '*/*' } });
      // A fetch that follows redirects despite the request says where it ended up; that must still be GS1.
      if (response.url != null && response.url !== '' && gs1Address(response.url) == null) throw new Refusal('redirect-refused', `the response came from ${response.url}, outside ${GS1_ARTEFACT_ORIGIN}/`);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        const next: URL | undefined = location == null ? undefined : gs1Address(location, url);
        await response.body?.cancel().catch(() => undefined);
        if (next == null) throw new Refusal('redirect-refused', `a redirect to ${location ?? 'nowhere'} leaves ${GS1_ARTEFACT_ORIGIN}/`);
        url = next;
        continue;
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        throw new Refusal('http-status', `${url.href} answered ${response.status}`);
      }
      return await readCapped(response, artefact.byteLength);
    }
    throw new Refusal('redirect-refused', `more than ${MAX_REDIRECTS} redirects`);
  } catch (error) {
    if (timedOut) throw new Refusal('timeout', `no complete answer within ${timeoutMs} ms`);
    if (error instanceof Refusal) throw error;
    throw new Refusal('network', error instanceof Error ? error.message : 'the request failed');
  } finally {
    clearTimeout(timer);
  }
}

/** Write under a temporary name and rename, so the final name only ever holds complete, verified bytes. */
function storeAtomically(dir: string, fileName: string, bytes: Uint8Array): void {
  const temporary = join(dir, `.${fileName}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(temporary, bytes, { flag: 'wx' });
    renameSync(temporary, join(dir, fileName));
  } catch (error) {
    // Best effort: when the folder itself is unusable there is no temporary file to remove.
    try { rmSync(temporary, { force: true }); } catch { /* nothing was written */ }
    throw new Refusal('write-failed', error instanceof Error ? error.message : 'the file could not be written');
  }
}

/**
 * Make the folder hold every file in the table. A file already present with
 * the pinned digest is used as it is. Any other is fetched from its GS1
 * address, checked for length and SHA-256, and only then written. Fetched
 * bytes are hashed and stored; they are never parsed or run here. A file that
 * fails any check is not kept.
 */
export async function provisionGs1Artefacts(options: Gs1ProvisionOptions = {}): Promise<Gs1ProvisionReport> {
  const dir = gs1ArtefactsDir(options.dir);
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? GS1_FETCH_TIMEOUT_MS;
  const files: Gs1ProvisionEntry[] = [];
  for (const artefact of options.artefacts ?? EPCIS_GS1_ARTEFACTS) {
    const entry = { id: artefact.id, fileName: artefact.fileName, path: join(dir, String(artefact.fileName)) };
    try {
      if (!safeFileName(artefact)) throw new Refusal('entry-refused', `the file name ${JSON.stringify(artefact.fileName)} is not a bare file name`);
      if (readHeld(dir, artefact).status === 'ok') { files.push({ ...entry, outcome: 'present' }); continue; }
      if (options.offline === true) throw new Refusal('offline', 'the file is absent or altered and fetching is switched off');
      const bytes = await fetchBytes(artefact, fetcher, timeoutMs);
      if (bytes.byteLength !== artefact.byteLength) throw new Refusal('length-mismatch', `received ${bytes.byteLength} bytes where ${artefact.byteLength} are pinned`);
      const digest = sha256Hex(bytes);
      if (digest !== artefact.sha256) throw new Refusal('digest-mismatch', `received SHA-256 ${digest} where ${artefact.sha256} is pinned`);
      storeAtomically(dir, artefact.fileName, bytes);
      files.push({ ...entry, outcome: 'fetched' });
    } catch (error) {
      const refusal = error instanceof Refusal ? error : new Refusal('network', error instanceof Error ? error.message : 'the request failed');
      files.push({ ...entry, outcome: 'failed', reason: refusal.reason, detail: refusal.message });
    }
  }
  return { ok: files.every((f) => f.outcome !== 'failed'), dir, files };
}
