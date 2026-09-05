import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { PROFILE_CONTEXT } from '../src/context.js';
import { sealSchema } from '../src/schema.js';
import { disclosureSchema } from '../src/validation.js';
it('ships versioned artefacts identical to runtime validation and pinned by the manifest', () => {
  const path = (name: string) => new URL(`../artifacts/${name}`, import.meta.url);
  const read = (name: string) => readFileSync(path(name));
  expect(JSON.parse(read('context-0.1.0.jsonld').toString())).toEqual(PROFILE_CONTEXT);
  expect(JSON.parse(read('seal-0.1.0.schema.json').toString())).toEqual(sealSchema);
  expect(JSON.parse(read('disclosure-0.1.0.schema.json').toString())).toEqual(disclosureSchema);
  const manifest = JSON.parse(read('profile-0.1.0.json').toString());
  for (const [name, hash] of Object.entries(manifest.artifactDigests)) expect(createHash('sha256').update(read(name)).digest('hex')).toBe(hash);
});
