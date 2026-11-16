#!/usr/bin/env node
import { runValidatorCommand } from './validator-command.js'

try {
  process.exitCode = await runValidatorCommand(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : 'dpp-validator could not run')
  process.exitCode = 1
}
