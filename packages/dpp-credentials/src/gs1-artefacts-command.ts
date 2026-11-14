/**
 * The dpp-gs1-artefacts command: fetch, verify and path. It is the operator's
 * and the build pipeline's way to do what provisionGs1Artefacts does in code.
 * Everything it needs is passed in, so a test runs it without a process or a
 * network.
 */
import { parseArgs } from 'node:util';
import { EPCIS_GS1_ARTEFACTS, GS1_ARTEFACTS_DIR_ENV, gs1ArtefactsDir, provisionGs1Artefacts, verifyGs1Artefacts, type Gs1Artefact } from './gs1-artefacts.js';

export const GS1_ARTEFACTS_USAGE = `dpp-gs1-artefacts: obtain and check the GS1 files this package validates against.

Usage: dpp-gs1-artefacts fetch [--dir <folder>] [--offline]
       dpp-gs1-artefacts verify [--dir <folder>]
       dpp-gs1-artefacts path [--dir <folder>]

fetch   Use each file already in the folder that matches its pinned digest.
        Fetch any other from https://ref.gs1.org/, check its length and
        SHA-256, and store it. With --offline nothing is fetched.
verify  Check the folder against the pinned digests. Never uses the network.
path    Print the folder.

The folder is --dir, else DPP_GS1_ARTEFACTS_DIR, else $XDG_CACHE_HOME/dpp/gs1
or ~/.cache/dpp/gs1. fetch and verify exit 1 when a file is missing or does
not match.

GS1 publishes these files under its own terms. This package does not
redistribute them. To provision without network access, download each file
from the address verify prints, place it in the folder under the name verify
prints, then run verify again.`;

export interface Gs1ArtefactsCommandContext {
  artefacts?: readonly Gs1Artefact[];
  fetch?: typeof globalThis.fetch;
  env?: Record<string, string | undefined>;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

/** Run one command and return its exit code: 0 when every file is in place, 1 when one is missing or wrong, 2 for a usage error. */
export async function runGs1ArtefactsCommand(argv: readonly string[], context: Gs1ArtefactsCommandContext = {}): Promise<number> {
  const out = context.stdout ?? ((line: string) => console.log(line));
  const err = context.stderr ?? ((line: string) => console.error(line));
  const artefacts = context.artefacts ?? EPCIS_GS1_ARTEFACTS;
  let parsed: { values: { dir?: string; offline?: boolean; help?: boolean }; positionals: string[] };
  try {
    parsed = parseArgs({ args: [...argv], allowPositionals: true, options: { dir: { type: 'string' }, offline: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  } catch (error) {
    err(error instanceof Error ? error.message : 'the arguments could not be read');
    err(GS1_ARTEFACTS_USAGE);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help === true) { out(GS1_ARTEFACTS_USAGE); return 0; }
  const [command, ...extra] = positionals;
  if (command == null || extra.length > 0 || !['fetch', 'verify', 'path'].includes(command)) {
    err(command == null ? 'a command is needed: fetch, verify or path' : `unknown command ${positionals.join(' ')}`);
    err(GS1_ARTEFACTS_USAGE);
    return 2;
  }
  const dir = gs1ArtefactsDir(values.dir ?? context.env?.[GS1_ARTEFACTS_DIR_ENV]);

  if (command === 'path') { out(dir); return 0; }

  if (command === 'verify') {
    const report = verifyGs1Artefacts({ dir, artefacts });
    for (const [index, file] of report.files.entries()) {
      if (file.status === 'ok') out(`ok: ${file.fileName} (${file.id})`);
      // The address is printed so an operator without network access knows what to download elsewhere.
      else err(`${file.status}: ${file.fileName} (${file.id}), published at ${artefacts[index]?.uri}`);
    }
    if (!report.ok) err(`${dir} does not hold every pinned file. Run "dpp-gs1-artefacts fetch --dir ${dir}", or place the missing files there and verify again.`);
    return report.ok ? 0 : 1;
  }

  const report = await provisionGs1Artefacts({ dir, artefacts, fetch: context.fetch, offline: values.offline === true });
  for (const file of report.files) {
    if (file.outcome === 'failed') err(`failed: ${file.fileName} (${file.id}): ${file.reason}: ${file.detail}`);
    else out(`${file.outcome}: ${file.fileName} (${file.id})`);
  }
  if (!report.ok) err(`${dir} does not hold every pinned file. Nothing that failed a check was kept.`);
  return report.ok ? 0 : 1;
}
