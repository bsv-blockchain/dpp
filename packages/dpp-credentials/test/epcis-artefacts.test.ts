import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { EPCIS_ARTEFACTS, EPCIS_CONTEXT_DIGEST, EPCIS_DEFAULT_LIMITS } from '../src/epcis-source.js';
import { EPCIS_GS1_ARTEFACTS, readGs1Artefact, verifyGs1Artefacts } from '../src/gs1-artefacts.js';
import { epcisSourceVectors } from './epcis-fixture.js';

const root = join(import.meta.dirname, '..');
const repo = join(root, '..', '..');
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

describe('the pinned EPCIS artefacts', () => {
  it('pins each provisioned file at the SHA-256 and length GS1 serves, and carries none of them', () => {
    const provisioned = EPCIS_ARTEFACTS.filter((a) => a.provisioned);
    expect(provisioned.map((a) => a.id)).toEqual(EPCIS_GS1_ARTEFACTS.map((a) => a.id));
    for (const artefact of EPCIS_GS1_ARTEFACTS) {
      // readGs1Artefact refuses bytes that do not match; the digest and length are recomputed here so the test does not lean on it.
      const bytes = readGs1Artefact(artefact);
      expect(sha256(bytes), artefact.fileName).toBe(artefact.sha256);
      expect(bytes.byteLength, artefact.fileName).toBe(artefact.byteLength);
      expect(artefact.uri.startsWith('https://ref.gs1.org/standards/epcis/2.0.1/'), artefact.uri).toBe(true);
      expect(EPCIS_ARTEFACTS.find((a) => a.id === artefact.id)).toMatchObject(artefact);
    }
    expect(verifyGs1Artefacts().ok).toBe(true);
    const binding = EPCIS_ARTEFACTS.find((a) => a.id === 'epcis-openapi');
    expect(binding).toMatchObject({ provisioned: false, fileName: null });
    expect(EPCIS_ARTEFACTS.find((a) => a.id === 'epcis-context')?.sha256).toBe(EPCIS_CONTEXT_DIGEST);
  });

  it('validates the three EPCIS interoperability manifests against their schema and holds them to the constants', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
    addFormats(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync(join(repo, 'packages/dpp-profiles/schemas/interoperability-profile.schema.json'), 'utf8')));
    for (const id of ['epcis-json@1', 'epcis-vsc@1', 'epcis-vsc@2']) {
      const manifest = JSON.parse(readFileSync(join(repo, `packages/dpp-profiles/manifests/interoperability/${id}.json`), 'utf8')) as { profile: string; artefacts: Array<{ id: string; retrieval: string; digest?: string; carried?: string; byteLength?: number }>; limits: Record<string, number>; dependencies: Array<{ name: string; version: string }> };
      expect(validate(manifest), `${id}: ${JSON.stringify(validate.errors)}`).toBe(true);
      expect(manifest.profile).toBe(id);
      for (const artefact of manifest.artefacts) {
        const pinned = EPCIS_ARTEFACTS.find((a) => a.id === artefact.id);
        if (pinned == null) continue;
        expect(artefact.retrieval).toBe('pinned');
        expect(artefact.digest).toBe(pinned.sha256);
        expect(artefact.byteLength).toBe(pinned.byteLength);
        // GS1's files are pinned and never carried, so no manifest names a path for one.
        expect(artefact.carried, `${id} ${artefact.id}`).toBeUndefined();
      }
    }
    for (const id of ['epcis-vsc@1', 'epcis-vsc@2']) {
      const manifest = JSON.parse(readFileSync(join(repo, `packages/dpp-profiles/manifests/interoperability/${id}.json`), 'utf8')) as { artefacts: Array<{ id: string; digest?: string; carried?: string }> };
      for (const artefact of manifest.artefacts.filter((a) => a.carried?.startsWith('packages/dpp-credentials/'))) {
        expect(sha256(readFileSync(join(repo, artefact.carried!))), `${id} ${artefact.id}`).toBe(artefact.digest);
      }
    }
    const source = JSON.parse(readFileSync(join(repo, 'packages/dpp-profiles/manifests/interoperability/epcis-json@1.json'), 'utf8')) as { limits: Record<string, number>; dependencies: Array<{ name: string; version: string }> };
    expect(source.limits).toEqual(EPCIS_DEFAULT_LIMITS);
    const ajvVersion = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }).dependencies.ajv;
    expect(source.dependencies.find((d) => d.name === 'ajv')?.version).toBe(ajvVersion);
  });

  // The epcis-vsc@1 and epcis-vsc@2 mappings left this package in 0.2.0-beta.6; their vectors stay as published, held here by digest.
  const PARKED_V1 = { ids: ['mapping-outcomes', 'evidence-only-and-attribution'], sha256: '827c8e9177f886444ed11349125f287c03200d67e894131ce6aabd496e2ddeff' };
  const PARKED_V2_SHA256 = 'd87221c67f7da1b7b48d444236bf1e3614b7ea77ded32fc8672ce33e6c1b8c29';
  const vectorPath = (file: string): string => join(repo, `fixtures/vectors/dpp/interoperability/epcis/${file}`);

  it('publishes the source exchange vectors of v1.json as the generator produces them, and keeps its two parked mapping vectors as published', () => {
    const path = vectorPath('v1.json');
    const published = JSON.parse(readFileSync(path, 'utf8')) as { id: string; vectors: Array<{ id: string; tags: string[] }> };
    const generated = JSON.parse(JSON.stringify(epcisSourceVectors())) as Array<{ id: string; tags: string[] }>;
    const parked = published.vectors.filter((v) => v.tags.includes('vsc-mapping'));
    if (process.env.REGENERATE_FIXTURES === '1') writeFileSync(path, JSON.stringify({ ...published, vectors: [...generated, ...parked] }, null, 2) + '\n');
    expect(published.id).toBe('dpp.interoperability.epcis.v1');
    expect(published.vectors.filter((v) => !v.tags.includes('vsc-mapping'))).toEqual(generated);
    expect(parked.map((v) => v.id)).toEqual(PARKED_V1.ids);
    expect(sha256(Buffer.from(JSON.stringify(parked))), 'the parked mapping vectors of v1.json').toBe(PARKED_V1.sha256);
  });

  it('keeps v2.json, the parked epcis-vsc@2 vectors, byte for byte as published', () => {
    const bytes = readFileSync(vectorPath('v2.json'));
    expect(sha256(bytes)).toBe(PARKED_V2_SHA256);
    const published = JSON.parse(bytes.toString('utf8')) as { id: string; vectors: Array<{ tags: string[] }> };
    expect(published.id).toBe('dpp.interoperability.epcis.v2');
    for (const v of published.vectors) expect(v.tags).toContain('vsc-mapping');
  });

  for (const file of ['v1.json', 'v2.json']) it(`holds fixtures/vectors/dpp/interoperability/epcis/${file} to the stack shape, documentation hosts and the demonstration prefix`, () => {
    const text = readFileSync(vectorPath(file), 'utf8');
    const published = JSON.parse(text) as { vectors: Array<{ id: string }> };
    for (const key of ['id', 'name', 'version', 'reference_impl', 'parity_class', 'vectors']) expect(published).toHaveProperty(key);
    const ids = published.vectors.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    const hexOnly = (value: unknown, where: string): void => {
      if (typeof value === 'string') expect(value, where).toMatch(/^[0-9a-f]*$/);
      else if (Array.isArray(value)) value.forEach((v, i) => hexOnly(v, `${where}[${i}]`));
      else expect.fail(`${where} is neither a hex string nor a list of them`);
    };
    const walk = (value: unknown, where: string): void => {
      if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${where}[${i}]`));
      if (value == null || typeof value !== 'object') return;
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) (k.endsWith('_hex') ? hexOnly : walk)(v, `${where}.${k}`);
    };
    for (const v of published.vectors) {
      for (const key of ['id', 'description', 'input', 'expected', 'tags']) expect(v).toHaveProperty(key);
      expect(v.id).toMatch(/^[a-z0-9-]+$/);
      walk(v, v.id);
    }
    // Every host in the file is a documentation host and every GTIN is under the demonstration prefix: nothing real, nobody's name.
    expect(text).not.toContain('gs1.org/01/0950');
    for (const host of new Set([...text.matchAll(/https?:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]))) expect(host, host).toMatch(/(^|\.)(example\.org|issuer\.example|gs1\.org|w3\.org|w3id\.org|githubusercontent\.com)$/);
    for (const gtin of new Set([...text.matchAll(/urn:epc:(?:id|class|idpat):[a-z]+:(\d+)\./g)].map((m) => m[1]))) expect(gtin, gtin).toMatch(/^952/);
  });
});
