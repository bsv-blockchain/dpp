import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EPCIS_GS1_ARTEFACTS,
  GS1_ARTEFACTS_DIR_ENV,
  Gs1ArtefactUnavailableError,
  gs1ArtefactsDir,
  provisionGs1Artefacts,
  readGs1Artefact,
  verifyGs1Artefacts,
  type Gs1Artefact,
} from '../src/gs1-artefacts.js';
import { runGs1ArtefactsCommand } from '../src/gs1-artefacts-command.js';

/**
 * Hermetic: a synthetic table and an injected fetch. Nothing here reaches
 * the network or reads a real GS1 file, so these tests say what the
 * provisioner does with any bytes, not what GS1 serves today.
 */
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

const ALPHA = bytesOf('{"alpha":true}\n');
const BETA = bytesOf('{"beta":[1,2,3]}\n');
const entry = (id: string, bytes: Uint8Array): Gs1Artefact => ({ id, standard: 'Synthetic', version: '1.0.0', fileName: `${id}-1.0.0.json`, uri: `https://ref.gs1.org/standards/synthetic/1.0.0/${id}`, sha256: sha256(bytes), byteLength: bytes.byteLength });
const TABLE: readonly Gs1Artefact[] = [entry('alpha', ALPHA), entry('beta', BETA)];

type Served = Record<string, () => Response>;
/** A fetch that serves only the listed addresses and records every address it was asked for. */
function fakeFetch(served: Served): { fetch: typeof globalThis.fetch; calls: string[] } {
  const calls: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const respond = served[url];
    if (respond == null) return new Response('not found', { status: 404 });
    return respond();
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}
const ok = (bytes: Uint8Array) => () => new Response(bytes, { status: 200 });
const genuine: Served = { [TABLE[0].uri]: ok(ALPHA), [TABLE[1].uri]: ok(BETA) };

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dpp-gs1-test-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('gs1ArtefactsDir', () => {
  const saved = { dir: process.env[GS1_ARTEFACTS_DIR_ENV], xdg: process.env.XDG_CACHE_HOME };
  afterEach(() => {
    for (const [name, value] of [[GS1_ARTEFACTS_DIR_ENV, saved.dir], ['XDG_CACHE_HOME', saved.xdg]] as const) {
      if (value == null) delete process.env[name]; else process.env[name] = value;
    }
  });

  it('prefers the explicit folder, then the environment variable, then the per-user cache folder', () => {
    process.env[GS1_ARTEFACTS_DIR_ENV] = '/srv/from-env';
    process.env.XDG_CACHE_HOME = '/srv/xdg';
    expect(gs1ArtefactsDir('/srv/explicit')).toBe('/srv/explicit');
    expect(gs1ArtefactsDir()).toBe('/srv/from-env');
    delete process.env[GS1_ARTEFACTS_DIR_ENV];
    expect(gs1ArtefactsDir()).toBe(join('/srv/xdg', 'dpp', 'gs1'));
    delete process.env.XDG_CACHE_HOME;
    expect(gs1ArtefactsDir()).toBe(join(homedir(), '.cache', 'dpp', 'gs1'));
  });
});

describe('provisionGs1Artefacts', () => {
  it('fetches a missing file, checks it and stores it under its pinned name', async () => {
    const { fetch, calls } = fakeFetch(genuine);
    const report = await provisionGs1Artefacts({ dir, artefacts: TABLE, fetch });
    expect(report.ok).toBe(true);
    expect(report.dir).toBe(dir);
    expect(report.files.map((f) => [f.id, f.outcome])).toEqual([['alpha', 'fetched'], ['beta', 'fetched']]);
    expect(calls).toEqual([TABLE[0].uri, TABLE[1].uri]);
    expect(readFileSync(join(dir, TABLE[0].fileName)).equals(Buffer.from(ALPHA))).toBe(true);
    expect(readdirSync(dir).sort()).toEqual([TABLE[0].fileName, TABLE[1].fileName]);
    expect(verifyGs1Artefacts({ dir, artefacts: TABLE }).ok).toBe(true);
  });

  it('creates the folder when it does not exist yet', async () => {
    const nested = join(dir, 'a', 'b');
    const report = await provisionGs1Artefacts({ dir: nested, artefacts: TABLE, fetch: fakeFetch(genuine).fetch });
    expect(report.ok).toBe(true);
    expect(readdirSync(nested).sort()).toEqual([TABLE[0].fileName, TABLE[1].fileName]);
  });

  it('reuses a file already present with the pinned digest and fetches nothing for it', async () => {
    writeFileSync(join(dir, TABLE[0].fileName), ALPHA);
    const { fetch, calls } = fakeFetch(genuine);
    const report = await provisionGs1Artefacts({ dir, artefacts: TABLE, fetch });
    expect(report.files.map((f) => f.outcome)).toEqual(['present', 'fetched']);
    expect(calls).toEqual([TABLE[1].uri]);
  });

  it('replaces an altered file with the fetched bytes once they match', async () => {
    writeFileSync(join(dir, TABLE[0].fileName), bytesOf('altered'));
    const report = await provisionGs1Artefacts({ dir, artefacts: [TABLE[0]], fetch: fakeFetch(genuine).fetch });
    expect(report.files[0].outcome).toBe('fetched');
    expect(readFileSync(join(dir, TABLE[0].fileName)).equals(Buffer.from(ALPHA))).toBe(true);
  });

  it('refuses fetched bytes with the wrong digest and keeps no file', async () => {
    const sameLength = bytesOf('{"alphx":true}\n');
    expect(sameLength.byteLength).toBe(ALPHA.byteLength);
    const report = await provisionGs1Artefacts({ dir, artefacts: [TABLE[0]], fetch: fakeFetch({ [TABLE[0].uri]: ok(sameLength) }).fetch });
    expect(report.ok).toBe(false);
    expect(report.files[0]).toMatchObject({ id: 'alpha', outcome: 'failed', reason: 'digest-mismatch' });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('refuses fetched bytes of the wrong length, shorter or longer, and keeps no file', async () => {
    for (const body of [ALPHA.slice(0, ALPHA.byteLength - 1), bytesOf('{"alpha":true}\n\n')]) {
      const report = await provisionGs1Artefacts({ dir, artefacts: [TABLE[0]], fetch: fakeFetch({ [TABLE[0].uri]: ok(body) }).fetch });
      expect(report.ok).toBe(false);
      expect(report.files[0]).toMatchObject({ outcome: 'failed', reason: 'length-mismatch' });
      expect(readdirSync(dir)).toEqual([]);
    }
  });

  it('stops reading a body that runs past the pinned length', async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({ pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(1024)); } });
    const report = await provisionGs1Artefacts({ dir, artefacts: [TABLE[0]], fetch: fakeFetch({ [TABLE[0].uri]: () => new Response(endless, { status: 200 }) }).fetch });
    expect(report.files[0]).toMatchObject({ outcome: 'failed', reason: 'length-mismatch' });
    expect(pulled).toBeLessThan(8);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('refuses an address outside https://ref.gs1.org/ without fetching it', async () => {
    const refused = ['https://example.org/standards/x', 'http://ref.gs1.org/standards/x', 'https://ref.gs1.org.example.org/x', 'https://user@ref.gs1.org/x', 'https://ref.gs1.org:8443/x', 'not a url'];
    for (const uri of refused) {
      const { fetch, calls } = fakeFetch({ [uri]: ok(ALPHA) });
      const report = await provisionGs1Artefacts({ dir, artefacts: [{ ...TABLE[0], uri }], fetch });
      expect(report.ok, uri).toBe(false);
      expect(report.files[0], uri).toMatchObject({ outcome: 'failed', reason: 'address-refused' });
      expect(calls, uri).toEqual([]);
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  it('refuses a redirect that leaves the GS1 origin and never follows it', async () => {
    const away = 'https://mirror.example.org/alpha';
    const { fetch, calls } = fakeFetch({
      [TABLE[0].uri]: () => new Response(null, { status: 302, headers: { location: away } }),
      [away]: ok(ALPHA),
    });
    const report = await provisionGs1Artefacts({ dir, artefacts: [TABLE[0]], fetch });
    expect(report.ok).toBe(false);
    expect(report.files[0]).toMatchObject({ outcome: 'failed', reason: 'redirect-refused' });
    expect(calls).toEqual([TABLE[0].uri]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('follows a redirect that stays on the GS1 origin, and gives up on a loop', async () => {
    const moved = 'https://ref.gs1.org/standards/synthetic/1.0.0/alpha.json';
    const followed = fakeFetch({
      [TABLE[0].uri]: () => new Response(null, { status: 301, headers: { location: '/standards/synthetic/1.0.0/alpha.json' } }),
      [moved]: ok(ALPHA),
    });
    expect((await provisionGs1Artefacts({ dir, artefacts: [TABLE[0]], fetch: followed.fetch })).files[0].outcome).toBe('fetched');
    expect(followed.calls).toEqual([TABLE[0].uri, moved]);

    const loop = fakeFetch({ [TABLE[1].uri]: () => new Response(null, { status: 302, headers: { location: TABLE[1].uri } }) });
    const report = await provisionGs1Artefacts({ dir, artefacts: [TABLE[1]], fetch: loop.fetch });
    expect(report.files[0]).toMatchObject({ outcome: 'failed', reason: 'redirect-refused' });
    expect(loop.calls.length).toBeLessThanOrEqual(6);
  });

  it('refuses a response a fetch followed off the GS1 origin by itself', async () => {
    const wandering = (async () => {
      const response = new Response(ALPHA, { status: 200 });
      Object.defineProperty(response, 'url', { value: 'https://mirror.example.org/alpha' });
      return response;
    }) as typeof globalThis.fetch;
    const report = await provisionGs1Artefacts({ dir, artefacts: [TABLE[0]], fetch: wandering });
    expect(report.files[0]).toMatchObject({ outcome: 'failed', reason: 'redirect-refused' });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('reports a status other than 200 as a failure', async () => {
    const report = await provisionGs1Artefacts({ dir, artefacts: [TABLE[0]], fetch: fakeFetch({}).fetch });
    expect(report.files[0]).toMatchObject({ outcome: 'failed', reason: 'http-status' });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('never fetches when offline: a correct file is used and a missing or altered one fails', async () => {
    writeFileSync(join(dir, TABLE[0].fileName), ALPHA);
    const { fetch, calls } = fakeFetch(genuine);
    const report = await provisionGs1Artefacts({ dir, artefacts: TABLE, fetch, offline: true });
    expect(calls).toEqual([]);
    expect(report.ok).toBe(false);
    expect(report.files[0]).toMatchObject({ id: 'alpha', outcome: 'present' });
    expect(report.files[1]).toMatchObject({ id: 'beta', outcome: 'failed', reason: 'offline' });
    expect(readdirSync(dir)).toEqual([TABLE[0].fileName]);

    writeFileSync(join(dir, TABLE[1].fileName), bytesOf('altered'));
    const second = await provisionGs1Artefacts({ dir, artefacts: TABLE, fetch, offline: true });
    expect(calls).toEqual([]);
    expect(second.files[1]).toMatchObject({ outcome: 'failed', reason: 'offline' });
  });

  it('leaves no file under the final name, and no temporary file, when a download breaks part-way', async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(ALPHA.slice(0, 4)); },
      pull(controller) { controller.error(new Error('connection reset')); },
    });
    const report = await provisionGs1Artefacts({ dir, artefacts: [TABLE[0]], fetch: fakeFetch({ [TABLE[0].uri]: () => new Response(broken, { status: 200 }) }).fetch });
    expect(report.ok).toBe(false);
    expect(report.files[0]).toMatchObject({ outcome: 'failed', reason: 'network' });
    expect(existsSync(join(dir, TABLE[0].fileName))).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('leaves no file under the final name, and no temporary file, when the write itself fails', async () => {
    // A directory already holds the final name, so the rename cannot succeed.
    mkdirSync(join(dir, TABLE[0].fileName));
    writeFileSync(join(dir, TABLE[0].fileName, 'occupied'), 'x');
    const report = await provisionGs1Artefacts({ dir, artefacts: [TABLE[0]], fetch: fakeFetch(genuine).fetch });
    expect(report.ok).toBe(false);
    expect(report.files[0]).toMatchObject({ outcome: 'failed', reason: 'write-failed' });
    expect(readdirSync(dir)).toEqual([TABLE[0].fileName]);
    expect(readdirSync(join(dir, TABLE[0].fileName))).toEqual(['occupied']);
  });

  it('reports a folder that cannot be created as a failed write', async () => {
    writeFileSync(join(dir, 'a-file'), 'x');
    const report = await provisionGs1Artefacts({ dir: join(dir, 'a-file', 'below'), artefacts: [TABLE[0]], fetch: fakeFetch(genuine).fetch });
    expect(report.ok).toBe(false);
    expect(report.files[0]).toMatchObject({ outcome: 'failed', reason: 'write-failed' });
  });

  it('gives up on an address that does not answer within the timeout', async () => {
    const silent = ((_input: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as typeof globalThis.fetch;
    const report = await provisionGs1Artefacts({ dir, artefacts: [TABLE[0]], fetch: silent, timeoutMs: 20 });
    expect(report.files[0]).toMatchObject({ outcome: 'failed', reason: 'timeout' });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('refuses a table entry whose file name would leave the folder', async () => {
    for (const fileName of ['../escape.json', 'nested/file.json', '..', '']) {
      const { fetch, calls } = fakeFetch(genuine);
      const report = await provisionGs1Artefacts({ dir, artefacts: [{ ...TABLE[0], fileName }], fetch });
      expect(report.files[0], fileName).toMatchObject({ outcome: 'failed', reason: 'entry-refused' });
      expect(calls, fileName).toEqual([]);
    }
  });

  it('defaults to the three EPCIS 2.0.1 files', async () => {
    const { fetch, calls } = fakeFetch({});
    const report = await provisionGs1Artefacts({ dir, fetch });
    expect(report.files.map((f) => f.id)).toEqual(['epcis-json-schema', 'epcis-context', 'epcis-query-schema']);
    expect(calls).toEqual(EPCIS_GS1_ARTEFACTS.map((a) => a.uri));
    expect(report.ok).toBe(false);
  });
});

describe('verifyGs1Artefacts', () => {
  it('names each file as ok, missing or mismatch', () => {
    writeFileSync(join(dir, TABLE[0].fileName), ALPHA);
    expect(verifyGs1Artefacts({ dir, artefacts: TABLE })).toMatchObject({ ok: false, dir, files: [{ id: 'alpha', status: 'ok' }, { id: 'beta', status: 'missing' }] });
    writeFileSync(join(dir, TABLE[1].fileName), bytesOf('{"beta":[1,2,4]}\n'));
    expect(verifyGs1Artefacts({ dir, artefacts: TABLE }).files.map((f) => f.status)).toEqual(['ok', 'mismatch']);
    writeFileSync(join(dir, TABLE[1].fileName), BETA);
    expect(verifyGs1Artefacts({ dir, artefacts: TABLE })).toMatchObject({ ok: true });
  });
});

describe('readGs1Artefact', () => {
  it('returns the verified bytes of a provisioned file', () => {
    writeFileSync(join(dir, TABLE[0].fileName), ALPHA);
    expect(Buffer.from(readGs1Artefact(TABLE[0], { dir })).equals(Buffer.from(ALPHA))).toBe(true);
  });

  it('throws the named error when the file is absent', () => {
    let thrown: unknown;
    try { readGs1Artefact(TABLE[0], { dir }); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(Gs1ArtefactUnavailableError);
    const error = thrown as Gs1ArtefactUnavailableError;
    expect(error.code).toBe('gs1-artefact-unavailable');
    expect(error.artefactId).toBe('alpha');
    expect(error.dir).toBe(dir);
    expect(error.status).toBe('missing');
    expect(error.remedy).toContain('dpp-gs1-artefacts fetch');
    expect(error.remedy).toContain('provisionGs1Artefacts');
    expect(error.message).toContain(error.remedy);
    expect(error.message).toContain(TABLE[0].fileName);
  });

  it('throws the named error when the file has been altered, at the same length or another', () => {
    for (const altered of [bytesOf('{"alphx":true}\n'), bytesOf('{}')]) {
      writeFileSync(join(dir, TABLE[0].fileName), altered);
      let thrown: unknown;
      try { readGs1Artefact(TABLE[0], { dir }); } catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(Gs1ArtefactUnavailableError);
      expect((thrown as Gs1ArtefactUnavailableError).status).toBe('mismatch');
    }
  });
});

describe('the dpp-gs1-artefacts command', () => {
  const run = async (argv: string[], served: Served = genuine, env: Record<string, string | undefined> = {}) => {
    const out: string[] = [];
    const err: string[] = [];
    const { fetch, calls } = fakeFetch(served);
    const code = await runGs1ArtefactsCommand(argv, { artefacts: TABLE, fetch, env, stdout: (line) => out.push(line), stderr: (line) => err.push(line) });
    return { code, out, err, calls };
  };

  it('path prints the folder it would use', async () => {
    expect(await run(['path', '--dir', dir])).toMatchObject({ code: 0, out: [dir] });
    expect(await run(['path'], genuine, { [GS1_ARTEFACTS_DIR_ENV]: '/srv/from-env' })).toMatchObject({ code: 0, out: ['/srv/from-env'] });
  });

  it('fetch provisions the folder and exits zero, then verify agrees', async () => {
    const fetched = await run(['fetch', '--dir', dir]);
    expect(fetched.code).toBe(0);
    expect(fetched.out.join('\n')).toContain('alpha-1.0.0.json');
    expect(readdirSync(dir).sort()).toEqual([TABLE[0].fileName, TABLE[1].fileName]);
    const verified = await run(['verify', '--dir', dir]);
    expect(verified.code).toBe(0);
    expect(verified.calls).toEqual([]);
  });

  it('fetch exits non-zero when a file cannot be obtained', async () => {
    const result = await run(['fetch', '--dir', dir], { [TABLE[0].uri]: ok(ALPHA) });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('beta');
  });

  it('fetch --offline never fetches and exits non-zero when a file is absent', async () => {
    const result = await run(['fetch', '--offline', '--dir', dir]);
    expect(result.code).toBe(1);
    expect(result.calls).toEqual([]);
  });

  it('verify exits non-zero when a file is missing or altered, and never fetches', async () => {
    const missing = await run(['verify', '--dir', dir]);
    expect(missing.code).toBe(1);
    expect(missing.calls).toEqual([]);
    writeFileSync(join(dir, TABLE[0].fileName), ALPHA);
    writeFileSync(join(dir, TABLE[1].fileName), bytesOf('altered'));
    const altered = await run(['verify', '--dir', dir]);
    expect(altered.code).toBe(1);
    expect(altered.err.join('\n')).toContain('beta');
  });

  it('refuses an unknown command with a usage error', async () => {
    expect((await run(['explode'])).code).toBe(2);
    expect((await run([])).code).toBe(2);
  });
});
