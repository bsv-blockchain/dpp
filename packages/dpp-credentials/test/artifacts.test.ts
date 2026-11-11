import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { expect, it } from 'vitest';

// The parked vsc-draft-compat/0.1.0 profile's code left this package in 0.2.0-beta.6. Its owned context and
// schemas stay as published, so the parked manifests that pin them stay verifiable from the installed package.
it('carries the parked profile artefacts at the digests its manifest and the parked profile manifests pin', () => {
  const read = (name: string) => readFileSync(new URL(`../artifacts/${name}`, import.meta.url));
  const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const manifest = JSON.parse(read('profile-0.1.0.json').toString()) as { artifactDigests: Record<string, string> };
  expect(Object.keys(manifest.artifactDigests).sort()).toEqual(['context-0.1.0.jsonld', 'disclosure-0.1.0.schema.json', 'seal-0.1.0.schema.json']);
  for (const [name, hash] of Object.entries(manifest.artifactDigests)) expect(sha256(read(name)), name).toBe(hash);
  const profiles = join(import.meta.dirname, '..', '..', 'dpp-profiles', 'manifests');
  const owned = { 'owned-context': 'context-0.1.0.jsonld', 'owned-seal-schema': 'seal-0.1.0.schema.json', 'owned-disclosure-schema': 'disclosure-0.1.0.schema.json' } as const;
  for (const file of ['exchange/vsc-draft-compat@0.1.0.json', 'interoperability/epcis-vsc@1.json', 'interoperability/epcis-vsc@2.json']) {
    const parked = JSON.parse(readFileSync(join(profiles, file), 'utf8')) as { status: string; artefacts: Array<{ id: string; digest?: string }> };
    expect(parked.status, file).toBe('parked');
    const pins = parked.artefacts.filter((a) => a.id in owned);
    expect(pins.length, file).toBeGreaterThan(0);
    for (const a of pins) expect(a.digest, `${file} ${a.id}`).toBe(manifest.artifactDigests[owned[a.id as keyof typeof owned]]);
  }
});
