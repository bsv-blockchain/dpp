// The EPCIS tests validate against the EPCIS files GS1 publishes, and this
// project does not contain them: GS1 publishes them under its own terms. This
// set-up obtains the three pinned files once, into a cache folder, and checks
// every byte against its pinned digest. The tests then read them offline.
//
// A run that cannot obtain a file fails here, before any test, and says which
// file and why. It never skips: a skipped validation test would read as a
// pass.
import { join } from 'node:path'
import { GS1_ARTEFACTS_DIR_ENV, provisionGs1Artefacts } from '@bsv/dpp-credentials'

/** The folder the tests read the GS1 files from: the one DPP_GS1_ARTEFACTS_DIR names, or a cache folder under this project's node_modules. */
export function gs1TestDir(): string {
  const named = process.env[GS1_ARTEFACTS_DIR_ENV]
  return named != null && named !== '' ? named : join(import.meta.dirname, '..', '..', '..', 'node_modules', '.cache', 'dpp-gs1')
}

export default async function setup(): Promise<void> {
  const dir = gs1TestDir()
  const report = await provisionGs1Artefacts({ dir })
  if (report.ok) return
  const failed = report.files.filter((file) => file.outcome === 'failed').map((file) => `  ${file.fileName}: ${file.reason}: ${file.detail}`)
  const error = new Error(
    [
      `The EPCIS tests need the pinned GS1 files in ${dir} and ${failed.length} could not be provisioned:`,
      ...failed,
      `Run the tests with network access to https://ref.gs1.org/, or place the files GS1 publishes in that folder under these names, or point ${GS1_ARTEFACTS_DIR_ENV} at a folder that holds them. No test is skipped for want of them.`,
    ].join('\n')
  )
  // The message is the whole report. A stack through the test runner adds nothing and can hide it.
  error.stack = `${error.name}: ${error.message}`
  throw error
}
