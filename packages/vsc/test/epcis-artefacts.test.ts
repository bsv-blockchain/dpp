import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { EPCIS_ARTEFACTS, EPCIS_CONTEXT_DIGEST, EPCIS_DEFAULT_LIMITS } from '../src/epcis-source.js';
import { epcisInteroperabilityVectors } from './epcis-fixture.js';

const root = join(import.meta.dirname, '..');
const repo = join(root, '..', '..');
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

describe('the pinned EPCIS artefacts', () => {
  it('carries each pinned file at the digest and length the constant and the notice record', () => {
    const notice = readFileSync(join(root, 'artifacts/epcis/NOTICE.md'), 'utf8');
    for (const artefact of EPCIS_ARTEFACTS) {
      if (!artefact.carried) continue;
      expect(notice, artefact.id).toContain(artefact.sha256);
      const bytes = readFileSync(join(root, artefact.path));
      expect(sha256(bytes), artefact.path).toBe(artefact.sha256);
      expect(bytes.byteLength, artefact.path).toBe(artefact.byteLength);
      expect(notice).toContain(artefact.uri);
    }
    expect(EPCIS_ARTEFACTS.find((a) => a.id === 'epcis-context')?.sha256).toBe(EPCIS_CONTEXT_DIGEST);
  });

  it('validates the two interoperability manifests against their schema and holds them to the constants', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
    addFormats(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync(join(repo, 'packages/dpp-profiles/schemas/interoperability-profile.schema.json'), 'utf8')));
    for (const id of ['epcis-json@1', 'epcis-vsc@1']) {
      const manifest = JSON.parse(readFileSync(join(repo, `packages/dpp-profiles/manifests/interoperability/${id}.json`), 'utf8')) as { profile: string; artefacts: Array<{ id: string; retrieval: string; digest?: string; carried?: string; byteLength?: number }>; limits: Record<string, number>; dependencies: Array<{ name: string; version: string }> };
      expect(validate(manifest), `${id}: ${JSON.stringify(validate.errors)}`).toBe(true);
      expect(manifest.profile).toBe(id);
      for (const artefact of manifest.artefacts) {
        const pinned = EPCIS_ARTEFACTS.find((a) => a.id === artefact.id);
        if (pinned == null) continue;
        expect(artefact.retrieval).toBe('pinned');
        expect(artefact.digest).toBe(pinned.sha256);
        expect(artefact.byteLength).toBe(pinned.byteLength);
        if (pinned.carried) expect(artefact.carried).toBe(`packages/vsc/${pinned.path}`);
        else expect(artefact.carried).toBeUndefined();
      }
    }
    const source = JSON.parse(readFileSync(join(repo, 'packages/dpp-profiles/manifests/interoperability/epcis-json@1.json'), 'utf8')) as { limits: Record<string, number>; dependencies: Array<{ name: string; version: string }> };
    expect(source.limits).toEqual(EPCIS_DEFAULT_LIMITS);
    const ajvVersion = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }).dependencies.ajv;
    expect(source.dependencies.find((d) => d.name === 'ajv')?.version).toBe(ajvVersion);
  });

  it('publishes fixtures/vectors/dpp/interoperability/epcis/v1.json as the generator produces it, in the stack shape', () => {
    const generated = JSON.parse(JSON.stringify(epcisInteroperabilityVectors())) as { id: string; vectors: Array<{ id: string; tags: string[] }> };
    const path = join(repo, 'fixtures/vectors/dpp/interoperability/epcis/v1.json');
    if (process.env.REGENERATE_FIXTURES === '1') writeFileSync(path, JSON.stringify(generated, null, 2) + '\n');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(generated);
    for (const key of ['id', 'name', 'version', 'reference_impl', 'parity_class', 'vectors']) expect(generated).toHaveProperty(key);
    expect(generated.id).toBe('dpp.interoperability.epcis.v1');
    const ids = generated.vectors.map((v) => v.id);
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
    for (const v of generated.vectors) {
      for (const key of ['id', 'description', 'input', 'expected', 'tags']) expect(v).toHaveProperty(key);
      expect(v.id).toMatch(/^[a-z0-9-]+$/);
      walk(v, v.id);
    }
    const text = readFileSync(path, 'utf8');
    // Every host in the file is a documentation host and every GTIN is under the demonstration prefix: nothing real, nobody's name.
    expect(text).not.toContain('gs1.org/01/0950');
    for (const host of new Set([...text.matchAll(/https?:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]))) expect(host, host).toMatch(/(^|\.)(example\.org|issuer\.example|gs1\.org|w3\.org|w3id\.org|githubusercontent\.com)$/);
    for (const gtin of new Set([...text.matchAll(/urn:epc:(?:id|class|idpat):[a-z]+:(\d+)\./g)].map((m) => m[1]))) expect(gtin, gtin).toMatch(/^952/);
  });
});
