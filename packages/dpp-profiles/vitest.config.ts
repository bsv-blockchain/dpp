import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The pinned GS1 files are provisioned once, before any test, and never skipped. The set-up is shared with the credentials package.
    globalSetup: ['../dpp-credentials/test/gs1-global-setup.ts'],
    setupFiles: ['../dpp-credentials/test/gs1-test-env.ts'],
    // The engine tests expand and validate whole product documents, in threads and in processes of their own. On a small shared runner
    // one of them can take longer than the five seconds a test is given by default, so the limit is set well above what any takes.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
