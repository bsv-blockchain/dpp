import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // The pinned GS1 files the EPCIS tests validate against are provisioned once, before any test, and never skipped.
    globalSetup: ['./test/gs1-global-setup.ts'],
    setupFiles: ['./test/gs1-test-env.ts'],
  },
})
