#!/usr/bin/env node
import { compareProfiles } from '../dist/index.js'

const args = process.argv.slice(2)
if (args.length !== 2) {
  console.error('Usage: npm run changes -w @bsv/dpp-profiles -- <industry@from> <industry@to>')
  process.exitCode = 1
} else {
  try {
    console.log(JSON.stringify(compareProfiles(args[0], args[1]), null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
