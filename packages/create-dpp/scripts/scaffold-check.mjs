#!/usr/bin/env node
// What CI runs: scaffold the template into a temporary directory with the
// built CLI, install, build, typecheck and run the template's tests. A
// release of this package is only as good as this passing.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'dist', 'index.js')
if (!existsSync(cli)) throw new Error('build the CLI first: npm run build')

const scratch = mkdtempSync(join(tmpdir(), 'create-dpp-'))
const target = join(scratch, 'my-dpp')
const run = (command, args, cwd) => {
  console.log(`$ ${command} ${args.join(' ')}`)
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}
try {
  run(process.execPath, [cli, target, '--no-install'], scratch)
  const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
  if (manifest.name !== 'my-dpp') throw new Error(`the scaffolded manifest is named ${manifest.name}, not my-dpp`)
  for (const file of ['.gitignore', '.env.example', '.prettierrc', 'apps/api/package.json', 'apps/web/package.json', 'deploy/compose.yml', 'Dockerfile']) {
    if (!existsSync(join(target, file))) throw new Error(`${file} was not scaffolded`)
  }
  run('npm', ['install', '--no-audit', '--no-fund'], target)
  run('npm', ['run', 'typecheck'], target)
  run('npm', ['run', 'build'], target)
  run('npm', ['test'], target)
  console.log('The scaffolded application installs, builds, typechecks and passes its tests.')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
