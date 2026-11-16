/**
 * The limits the documentation publishes, held to the constants the code
 * enforces. A limit that is changed in one place and not the other fails
 * here, with the name of the limit and of the page.
 *
 * The pages are read as they are written for a person: the table of limits
 * and ceilings, the sentence of the specification that states the defaults,
 * and the statement of what the tests ran at. A page that is reworded must
 * still say each number, in a form this file reads.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EPCIS_DEFAULT_LIMITS, type EpcisLimits } from '../src/epcis-source.js';
import {
  EPCIS_MAX_RECORDED_FINDINGS,
  EPCIS_PULL_LIMIT_CEILINGS,
  EPCIS_PULL_MAX_REDIRECTS,
  EPCIS_PULL_MAX_REPLAYS_PER_RUN,
  EPCIS_RECORD_KINDS,
  createMemoryEpcisStorage,
  importEpcisSource,
} from '../src/epcis-exchange.js';
import { epcisDocument, fiveEventList } from './epcis-fixture.js';

const repo = join(import.meta.dirname, '..', '..', '..');
const page = (path: string): string => readFileSync(join(repo, path), 'utf8');
const GUIDE = 'docs/interoperability/epcis.md';
const SPECIFICATION = 'spec/epcis-interoperability.md';
const PACKAGE_PAGE = 'docs/packages/dpp-credentials.md';

const MIB = 1024 * 1024;
const LIMITS = Object.keys(EPCIS_DEFAULT_LIMITS) as Array<keyof EpcisLimits>;

/** A quantity as a page writes it, in the unit the limit of that name is held in. A unit the limit is not held in is an error, never a guess. */
function quantity(name: string, text: string): number {
  const match = /^(\d[\d,]*)(?:\s*(MiB|KiB|seconds?|ms))?$/.exec(text.trim());
  if (match == null) throw new Error(`${name} is written as "${text}", which is not a whole number with an optional unit`);
  const value = Number(match[1]!.replaceAll(',', ''));
  const unit = match[2];
  if (name.endsWith('Bytes')) {
    if (unit === 'MiB') return value * MIB;
    if (unit === 'KiB') return value * 1024;
    if (unit == null) return value;
  } else if (name.endsWith('Ms')) {
    if (unit === 'ms') return value;
    if (unit?.startsWith('second')) return value * 1000;
  } else if (name.endsWith('Seconds')) {
    if (unit == null || unit.startsWith('second')) return value;
  } else if (unit == null) {
    return value;
  }
  throw new Error(`${name} is written as "${text}", in a unit that limit is not held in`);
}

/** The rows of the first table after a heading, as trimmed cells, without the header and the rule under it. */
function tableAfter(markdown: string, heading: string, lead?: string): string[][] {
  const lines = markdown.split('\n');
  let from = lines.indexOf(heading);
  if (from < 0) throw new Error(`the page has no heading "${heading}"`);
  if (lead != null) {
    from = lines.findIndex((line, index) => index > from && line.startsWith(lead));
    if (from < 0) throw new Error(`the page has no line starting "${lead}" under "${heading}"`);
  }
  const start = lines.findIndex((line, index) => index > from && line.startsWith('|'));
  const next = lines.findIndex((line, index) => index > from && line.startsWith('#'));
  if (start < 0 || (next >= 0 && start > next)) throw new Error(`there is no table under "${lead ?? heading}"`);
  const rows: string[][] = [];
  for (let at = start; at < lines.length && lines[at]!.startsWith('|'); at += 1) rows.push(lines[at]!.split('|').slice(1, -1).map((cell) => cell.trim()));
  return rows.slice(2);
}

/** The first name written as code in a cell. */
const codeIn = (cell: string): string | undefined => /`([^`]+)`/.exec(cell)?.[1];

describe('the limits the documentation publishes', () => {
  it('states every limit in the table of limits and ceilings, each default and each ceiling as the code holds it', () => {
    const rows = tableAfter(page(GUIDE), '### Limits and overrides');
    const documented = new Map(rows.map((row) => [codeIn(row[0]!), row] as const));
    // Every limit once, and no row for a limit the code does not have.
    expect(rows.map((row) => codeIn(row[0]!)).sort()).toEqual([...LIMITS].sort());
    for (const limit of LIMITS) {
      const [, defaultText, ceilingText] = documented.get(limit)!;
      expect(quantity(limit, defaultText!), `${GUIDE}: the default of ${limit}`).toBe(EPCIS_DEFAULT_LIMITS[limit]);
      expect(quantity(limit, ceilingText!), `${GUIDE}: the ceiling of ${limit}`).toBe(EPCIS_PULL_LIMIT_CEILINGS[limit]);
    }
  });

  it('reads a quantity only in a unit its limit is held in, so the comparison above cannot pass by misreading one', () => {
    expect(quantity('maxDocumentBytes', '2 MiB')).toBe(2 * MIB);
    expect(quantity('fetchTimeoutMs', '10 seconds')).toBe(10_000);
    expect(quantity('maxPullSeconds', '60')).toBe(60);
    expect(quantity('maxEventsPerPage', '1,000')).toBe(1000);
    expect(() => quantity('maxPullPages', '10 MiB')).toThrow(/in a unit that limit is not held in/);
    expect(() => quantity('maxDocumentBytes', '2 seconds')).toThrow(/in a unit that limit is not held in/);
    expect(() => quantity('maxPullPages', 'ten')).toThrow(/not a whole number/);
    expect(() => tableAfter(page(GUIDE), '### No such heading')).toThrow(/no heading/);
  });

  it('states the defaults in the specification and on the package page as the code holds them', () => {
    const d = EPCIS_DEFAULT_LIMITS;
    // Each default is a whole number of the unit the pages write it in, or the sentences below would not say what the code does.
    for (const bytes of [d.maxDocumentBytes, d.maxContextBytes, d.maxPullBytes]) expect(bytes % MIB).toBe(0);
    expect(d.fetchTimeoutMs % 1000).toBe(0);
    const specification = `${d.maxDocumentBytes / MIB} MiB per document or query page, ${d.maxEventsPerPage} events per document or page, JSON depth ${d.maxJsonDepth}, ${d.maxContextDocuments} context documents totalling at most ${d.maxContextBytes / MIB} MiB, a ${d.fetchTimeoutMs / 1000} second fetch timeout, and a pull run of at most ${d.maxPullPages} pages, ${d.maxPullBytes / MIB} MiB and ${d.maxPullSeconds} seconds`;
    expect(page(SPECIFICATION), `${SPECIFICATION}, section 1`).toContain(specification);
    const packagePage = `${d.maxDocumentBytes / MIB} MiB and ${d.maxEventsPerPage} events a page, depth ${d.maxJsonDepth}, ${d.maxContextDocuments} contexts totalling ${d.maxContextBytes / MIB} MiB, a ${d.fetchTimeoutMs / 1000} second fetch timeout, and ${d.maxPullPages} pages, ${d.maxPullBytes / MIB} MiB and ${d.maxPullSeconds} seconds a run`;
    expect(page(PACKAGE_PAGE), PACKAGE_PAGE).toContain(packagePage);
  });

  it('states the bounds that are not settings: the findings a record keeps, the redirects, the replays and the attempts at a contended write', async () => {
    const rows = tableAfter(page(GUIDE), '### Limits and overrides', 'Four bounds are not settings');
    expect(rows).toHaveLength(4);
    const named = new Map(rows.filter((row) => codeIn(row[0]!)?.startsWith('EPCIS_') === true).map((row) => [codeIn(row[0]!), Number(row[1])] as const));
    expect(Object.fromEntries(named)).toEqual({ EPCIS_MAX_RECORDED_FINDINGS, EPCIS_PULL_MAX_REDIRECTS, EPCIS_PULL_MAX_REPLAYS_PER_RUN });

    // The findings cap is also stated where a retained failure is described, and in the specification.
    expect(page(GUIDE)).toContain(`A record keeps at most ${EPCIS_MAX_RECORDED_FINDINGS} findings.`);
    expect(page(SPECIFICATION), `${SPECIFICATION}, section 1`).toContain(`keeps at most ${EPCIS_MAX_RECORDED_FINDINGS.toLocaleString('en-US')} findings`);

    // The attempts are counted, not read from a constant: an import whose event results always lose is tried this many times.
    const attemptsRow = rows.find((row) => row[0]!.includes('storage-contention'))!;
    const storage = createMemoryEpcisStorage();
    const commit = storage.commit.bind(storage);
    let lost = 0;
    storage.commit = async (writes) => {
      const observation = writes.find((write) => write.kind === EPCIS_RECORD_KINDS.observation);
      if (observation == null) return commit(writes);
      lost += 1;
      return { committed: false, failed: { kind: observation.kind, key: observation.key, expected: 'absent', found: 1 } };
    };
    const bytes = new TextEncoder().encode(JSON.stringify(epcisDocument(fiveEventList())));
    await expect(importEpcisSource({ storage, sourceId: 'source-a', requestId: 'request-1', bytes, mediaType: 'application/ld+json', receivedAt: '2026-03-10T00:00:00.000Z', provenance: { kind: 'file' }, policy: { policyId: 'test-policy@1' } })).rejects.toMatchObject({ code: 'storage-contention' });
    expect(Number(attemptsRow[1]), `${GUIDE}: the attempts at a contended write`).toBe(lost);
    expect(page(GUIDE)).toContain(`the module tries it ${['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][lost]} times and then throws \`EpcisExchangeError\` with the code \`storage-contention\``);

    // A write that expects one writer is tried once: here the clearing of an import's journal entry, which always loses.
    const single = createMemoryEpcisStorage();
    const singleCommit = single.commit.bind(single);
    let clears = 0;
    single.commit = async (writes) => {
      const clear = writes.find((write) => write.kind === EPCIS_RECORD_KINDS.journal && write.op === 'delete');
      if (clear == null) return singleCommit(writes);
      clears += 1;
      return { committed: false, failed: { kind: clear.kind, key: clear.key, expected: 1, found: 2 } };
    };
    await expect(importEpcisSource({ storage: single, sourceId: 'source-a', requestId: 'request-1', bytes, mediaType: 'application/ld+json', receivedAt: '2026-03-10T00:00:00.000Z', provenance: { kind: 'file' }, policy: { policyId: 'test-policy@1' } })).rejects.toMatchObject({ code: 'storage-contention' });
    expect(clears, 'a journal entry that is not cleared is not tried again').toBe(1);
    expect(page(GUIDE)).toContain('The first time one of those is lost, the module throws `storage-contention` at once');
  });

  it('states which ceilings a test runs at and which are only accepted, in the numbers the code holds', () => {
    const c = EPCIS_PULL_LIMIT_CEILINGS;
    const guide = page(GUIDE);
    // packages/dpp-credentials/test/epcis-pull.test.ts runs these two.
    expect(guide).toContain(`At a ceiling they run one page of ${c.maxEventsPerPage} events and one run of ${c.maxPullPages} pages.`);
    expect(guide).toContain(`No test reads a ${c.maxDocumentBytes / MIB} MiB page, a run of ${c.maxPullBytes / MIB} MiB or a run of ${c.maxPullSeconds} seconds`);
    // A file import has no ceiling, and the page says so. packages/dpp-credentials/test/epcis-exchange.test.ts holds the code to the same statement.
    expect(guide).toContain('The ceilings bound a pull. `importEpcisSource` applies none');
    expect(page(SPECIFICATION)).toContain('its file import is read under the limits of the policy it is handed and applies no ceiling of its own');
  });
});
