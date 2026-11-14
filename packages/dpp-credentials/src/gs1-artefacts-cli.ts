#!/usr/bin/env node
import { runGs1ArtefactsCommand } from './gs1-artefacts-command.js';

try {
  process.exitCode = await runGs1ArtefactsCommand(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'dpp-gs1-artefacts could not run');
  process.exitCode = 1;
}
