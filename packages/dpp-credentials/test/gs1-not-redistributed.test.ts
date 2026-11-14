import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EPCIS_GS1_ARTEFACTS, gs1ArtefactsDir } from '../src/gs1-artefacts.js';
import { GS1_RESOLVER_ARTEFACTS } from '../../dpp-profiles/src/gs1-artefacts.js';

/**
 * GS1 publishes these files under its own terms, and this repository and its
 * packages do not redistribute them. This test fails if one comes back: as a
 * file anywhere in the tree, as a notice in either folder that used to hold
 * them, or in what npm would pack for this package.
 */
const root = join(import.meta.dirname, '..');
const repo = join(root, '..', '..');
const GS1_FILE_NAMES = new Set<string>([...EPCIS_GS1_ARTEFACTS, ...GS1_RESOLVER_ARTEFACTS].map((a) => a.fileName));
const FORMER_FOLDERS = ['packages/dpp-credentials/artifacts/epcis', 'packages/dpp-profiles/schemas/gs1'];
const offends = (path: string): boolean => GS1_FILE_NAMES.has(path.split('/').at(-1)!) || FORMER_FOLDERS.some((folder) => path === `${folder}/NOTICE.md`);

/** Every file under the repository, as a POSIX path. Installed dependencies and the provisioned folder itself are outside what the repository contains. */
function tree(): string[] {
  const provisioned = resolve(gs1ArtefactsDir());
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || resolve(path) === provisioned) continue;
        walk(path);
      } else out.push(relative(repo, path).split(sep).join('/'));
    }
  };
  walk(repo);
  return out;
}

describe('the GS1 files are not redistributed', () => {
  it('pins exactly six files', () => {
    expect([...GS1_FILE_NAMES].sort()).toEqual([
      'epcis-context-2.0.1.jsonld',
      'epcis-json-schema-2.0.1.json',
      'query-schema-2.0.1.json',
      'resolver-description-file-schema-1.2.0.json',
      'resolver-linkset-context-1.2.1.jsonld',
      'resolver-linkset-schema-1.2.1.json',
    ]);
  });

  it('none of them, and no notice for them, is anywhere in the tree', () => {
    const files = tree();
    expect(files).toContain('packages/dpp-credentials/src/gs1-artefacts.ts');
    expect(files.filter(offends)).toEqual([]);
  });

  it('none of them is in what npm would pack for this package', () => {
    // Scripts are off so listing the package does not copy the repository notices into it.
    const [packed] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as Array<{ files: Array<{ path: string }> }>;
    const paths = packed.files.map((f) => f.path);
    expect(paths).toContain('artifacts/w3c/credentials-v2.jsonld');
    expect(paths.filter((path) => path.startsWith('artifacts/epcis/') || GS1_FILE_NAMES.has(path.split('/').at(-1)!))).toEqual([]);
  });
});
