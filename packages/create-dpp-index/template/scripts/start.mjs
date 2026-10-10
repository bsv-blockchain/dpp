import { loadEnvironment, requireConfiguration } from './config.mjs'

try {
  requireConfiguration(loadEnvironment())
  const { runFromEnvironment } = await import('@bsv/dpp-overlay-topics/server')
  await runFromEnvironment()
} catch (error) {
  console.error(`Index startup failed: ${error instanceof Error ? error.message : 'unknown error'}`)
  // Startup errors after opening MongoDB must not leave a half-started process.
  process.exit(1)
}
