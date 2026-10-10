#!/usr/bin/env node
/**
 * create-dpp-app: copy the bundled template into a new directory and name it.
 *
 *   npm create @bsv/dpp-app@0.1.0 my-app
 *   npx @bsv/create-dpp-app my-app [--no-install] [--yes]
 *
 * The template ships inside this package, so scaffolding needs no network;
 * installing the dependencies does. Every version the template pins comes
 * from one DPP release set, named in this package's manifest under "dpp".
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
  version: string
  dpp: { releaseSet: string; packages: Record<string, string> }
}

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const positional = args.filter((a) => !a.startsWith('--'))

if (flags.has('--help') || flags.has('-h')) {
  console.log(`create-dpp-app ${manifest.version}: scaffold a Digital Product Passport application on BSV.

usage: npm create @bsv/dpp-app@0.1.0 <directory> [--no-install] [--yes]

  <directory>    where to create the application; must be empty or hold only .git
  --no-install   do not run npm install afterwards
  --yes          create without the confirmation line (for scripts)

The template pins the DPP packages of ${manifest.dpp.releaseSet}:
${Object.entries(manifest.dpp.packages)
  .map(([name, version]) => `  ${name}@${version}`)
  .join('\n')}`)
  process.exit(0)
}
if (flags.has('--version') || flags.has('-v')) {
  console.log(manifest.version)
  process.exit(0)
}

const target = resolve(positional[0] ?? 'my-dpp')
const projectName = basename(target)
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'my-dpp'

if (existsSync(target)) {
  const entries = readdirSync(target).filter((name) => name !== '.git')
  if (entries.length > 0) {
    console.error(`${target} is not empty (${entries.slice(0, 5).join(', ')}${entries.length > 5 ? ', ...' : ''}). Choose an empty directory.`)
    process.exit(2)
  }
}

console.log(`Creating ${projectName} in ${target} from the ${manifest.dpp.releaseSet} template.`)
mkdirSync(target, { recursive: true })
// Development artefacts never travel: a template checkout may hold them.
const skipped = new Set(['node_modules', 'dist', 'local', '.env', 'package-lock.json', '.DS_Store'])
cpSync(join(packageRoot, 'template'), target, {
  recursive: true,
  errorOnExist: false,
  filter: (source) => !skipped.has(basename(source)),
})

// Files that npm strips or that tooling treats specially are shipped with a
// leading underscore and renamed here: _gitignore -> .gitignore and so on.
function restoreDotfiles(dir: string): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) restoreDotfiles(path)
    if (/^_[a-z]/i.test(name)) renameSync(path, join(dir, `.${name.slice(1)}`))
  }
}
restoreDotfiles(target)

const rootManifestPath = join(target, 'package.json')
const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8')) as Record<string, unknown>
rootManifest.name = projectName
writeFileSync(rootManifestPath, `${JSON.stringify(rootManifest, null, 2)}\n`)

const install = !flags.has('--no-install')
if (install) {
  console.log('Installing dependencies with npm. The wallet toolbox brings a native SQLite driver; npm 11 may ask you to approve its install script.')
  const result = spawnSync('npm', ['install'], { cwd: target, stdio: 'inherit' })
  if (result.status !== 0) {
    console.error('npm install did not finish. Run it again inside the directory; if npm reports a held install script, run: npm install-scripts approve better-sqlite3')
  }
}

console.log(`
Done. Next:

  cd ${positional[0] ?? 'my-dpp'}${install ? '' : '\n  npm install'}
  npm test            # the offline dry run: issue, update, hand on, retire, claim; no wallet, funds or Docker
  cp .env.example .env
  npm run dev         # web on http://localhost:5173, API on http://localhost:3000, a local index in-process

For deployment, connect to an existing index or create a separate @bsv/create-dpp-index project.
The app's Compose file starts only its database. No separate overlay installation is needed.
Read README.md for the live route: a funded wallet, index access, and the identifier you will write under.`)
