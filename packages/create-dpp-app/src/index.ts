#!/usr/bin/env node
/**
 * create-dpp-app: copy the bundled template into a new directory and name it.
 *
 *   npm create @bsv/dpp-app@0.1.0-beta.2 my-app
 *   npx @bsv/create-dpp-app my-app [--no-install] [--yes]
 *
 * The template ships inside this package, so scaffolding needs no network;
 * installing the dependencies does. Every version the template pins comes
 * from one DPP release set, named in this package's manifest under "dpp".
 */
import { randomBytes } from 'node:crypto'
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

usage: npm create @bsv/dpp-app@0.1.0-beta.2 <directory> [--no-install] [--yes]

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

// Secrets exist from the first run: .env is written from .env.example with
// fresh values, so nothing is copied from an example file and the API's
// placeholder check never fires on a scaffolded project. The wallet root key
// stays empty: the first go-live generates it. The default index is the
// hosted testnet one, which go-live registers with.
const envPath = join(target, '.env')
if (existsSync(envPath)) {
  console.error(`${envPath} already exists; it was not touched.`)
} else {
  const example = readFileSync(join(target, '.env.example'), 'utf8')
  const generated: Record<string, string> = {
    AUTH_SECRET: randomBytes(32).toString('hex'),
    BRAND_ROOT_SECRET: randomBytes(32).toString('hex'),
    MANAGED_IDENTITY_SECRET: randomBytes(32).toString('hex'),
    NETWORK: 'test',
    INDEX_URL: 'https://dpp-overlay-testnet.bsvb.net',
  }
  const env = example
    .split('\n')
    .map((line) => {
      const match = /^([A-Z_]+)=/.exec(line)
      return match != null && generated[match[1]] != null ? `${match[1]}=${generated[match[1]]}` : line
    })
    .join('\n')
  writeFileSync(envPath, env, { mode: 0o600 })
}

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
  npm run dev         # web on http://localhost:5173, API on http://localhost:3000, an index in this process
  npm run go-live     # register with the testnet index, check wallet, funds and admission, then publish for real

.env holds fresh secrets and points at the default testnet index; go-live makes the wallet key and stores the tokens.
An index is the service your app announces passports to and readers look them up in. The default one is hosted;
npm run connect-index takes another provider's, or your own run from the DPP operator preset.
Read README.md for what go-live checks and for mainnet.`)
