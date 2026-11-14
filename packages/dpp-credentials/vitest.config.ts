import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The pinned GS1 files are provisioned once, before any test, and never skipped.
    globalSetup: ['./test/gs1-global-setup.ts'],
    setupFiles: ['./test/gs1-test-env.ts'],
  },
});
