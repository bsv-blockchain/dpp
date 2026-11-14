import { join } from 'node:path';
import { EPCIS_GS1_ARTEFACTS, GS1_ARTEFACTS_DIR_ENV, provisionGs1Artefacts } from '../src/gs1-artefacts.js';
import { GS1_RESOLVER_ARTEFACTS } from '../../dpp-profiles/src/gs1-artefacts.js';

/**
 * The tests that hold this repository's output to GS1's published schemas
 * need the real files, and the repository does not contain them. This set-up
 * obtains them once into a cache folder and checks every byte, so the tests
 * themselves run offline. The credentials, profiles and protocol packages
 * share it.
 *
 * A run that cannot obtain a file fails here, before any test, and says
 * which file and why. It never skips: a skipped schema test would read as a
 * pass.
 */
export function gs1TestArtefactsDir(): string {
  const named = process.env[GS1_ARTEFACTS_DIR_ENV];
  return named != null && named !== '' ? named : join(import.meta.dirname, '..', '..', '..', 'node_modules', '.cache', 'dpp-gs1');
}

export default async function setup(): Promise<void> {
  const dir = gs1TestArtefactsDir();
  const report = await provisionGs1Artefacts({ dir, artefacts: [...EPCIS_GS1_ARTEFACTS, ...GS1_RESOLVER_ARTEFACTS] });
  if (report.ok) return;
  const failed = report.files.filter((f) => f.outcome === 'failed').map((f) => `  ${f.fileName}: ${f.reason}: ${f.detail}`);
  const error = new Error([
    `The tests need the pinned GS1 files in ${dir} and ${failed.length} could not be provisioned:`,
    ...failed,
    `Fetch them with network access to https://ref.gs1.org/, or place the files GS1 publishes in that folder under these names, or point ${GS1_ARTEFACTS_DIR_ENV} at a folder that holds them. No test is skipped for want of them.`,
  ].join('\n'));
  // The message is the whole report. A stack through the test runner adds nothing and can hide it.
  error.stack = `${error.name}: ${error.message}`;
  throw error;
}
