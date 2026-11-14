import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The pinned GS1 files are provisioned once, before any test, and never skipped. The set-up is shared with the credentials package.
    globalSetup: ['../dpp-credentials/test/gs1-global-setup.ts'],
    setupFiles: ['../dpp-credentials/test/gs1-test-env.ts'],
  },
})
