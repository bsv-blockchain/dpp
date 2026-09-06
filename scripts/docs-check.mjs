#!/usr/bin/env node
/**
 * The documentation check: the site under docs/ as GitBook will read it.
 *
 *   node scripts/docs-check.mjs
 *
 * One sentence per finding, exit 1 when any does not hold. It checks that
 * every page SUMMARY.md names exists and every page under docs/ is named
 * (or is deliberately unlisted), that every relative link and fragment in
 * every page resolves inside the documentation root (a link that leaves the
 * root is a defect, because GitBook serves docs/ alone), that every pinned
 * repository link names a file that exists at that path, that every example
 * command a page shows names an example that exists, that the release set,
 * package versions, contract versions and baseline a page names are the
 * current set's, that no page contains a private planning path, and that
 * the two generated pages match their sources.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const docs = join(root, 'docs')
const REPO = 'https://github.com/bsv-blockchain/dpp/blob/main/'
let failures = 0
const say = (ok, sentence) => { if (!ok) failures += 1; console.log(`${ok ? 'ok' : 'FAIL'}: ${sentence}`) }

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name)
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') ? [p] : []
})
const pages = walk(docs).map((p) => relative(docs, p)).sort()

// 1. Navigation.
const summary = readFileSync(join(docs, 'SUMMARY.md'), 'utf8')
const listed = [...summary.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1])
for (const l of listed) say(existsSync(join(docs, l)), `SUMMARY.md names ${l}, which exists.`)
const unlisted = pages.filter((p) => p !== 'SUMMARY.md' && !listed.includes(p))
say(unlisted.length === 0, `every page under docs/ is in the navigation${unlisted.length ? `: unlisted ${unlisted.join(', ')}` : ''}.`)
const duplicates = listed.filter((l, i) => listed.indexOf(l) !== i)
say(duplicates.length === 0, `no page is listed twice${duplicates.length ? `: ${duplicates.join(', ')}` : ''}.`)

// 2. Links, fragments, pinned repository links, example commands, private paths.
const headings = (text) => [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1].trim().toLowerCase().replace(/[`*_]/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-'))
const exampleFiles = readdirSync(join(root, 'examples'))
const releaseSets = readdirSync(join(root, 'release')).filter((f) => /^dpp-release-.*\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(root, 'release', f), 'utf8')))
const current = releaseSets.filter((s) => s.status !== 'superseded').sort((a, b) => a.releaseSet.localeCompare(b.releaseSet)).at(-1)
const superseded = releaseSets.filter((s) => s.status === 'superseded').map((s) => s.releaseSet)
const overlayVersion = /^\s*version:\s*(\S+)/m.exec(readFileSync(join(root, 'contracts/overlay.yaml'), 'utf8'))[1]
const registryVersion = /^\s*version:\s*(\S+)/m.exec(readFileSync(join(root, 'contracts/registry.yaml'), 'utf8'))[1]
let linkFailures = 0, links = 0, pinned = 0, commands = 0
for (const page of pages) {
  const text = readFileSync(join(docs, page), 'utf8')
  const own = headings(text)
  for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1]
    if (/^(https?:|mailto:)/.test(target)) {
      if (target.startsWith(REPO)) {
        pinned += 1
        const path = decodeURIComponent(target.slice(REPO.length)).split('#')[0]
        if (!existsSync(join(root, path))) { linkFailures += 1; say(false, `${page} pins ${path}, which does not exist in the repository.`) }
      }
      continue
    }
    links += 1
    const [file, fragment] = target.split('#')
    const resolved = file === '' ? join(docs, page) : resolve(dirname(join(docs, page)), file)
    if (!resolved.startsWith(docs + '/') && resolved !== docs) { linkFailures += 1; say(false, `${page} links ${target}, which leaves the documentation root; use the pinned repository URL.`); continue }
    if (!existsSync(resolved)) { linkFailures += 1; say(false, `${page} links ${target}, which does not exist.`); continue }
    if (fragment != null && resolved.endsWith('.md')) {
      const targetHeadings = file === '' ? own : headings(readFileSync(resolved, 'utf8'))
      if (!targetHeadings.includes(fragment.toLowerCase())) { linkFailures += 1; say(false, `${page} links ${target}, whose fragment names no heading.`) }
    }
  }
  for (const m of text.matchAll(/node examples\/([a-z0-9-]+\.mjs)/g)) {
    commands += 1
    if (!exampleFiles.includes(m[1])) { linkFailures += 1; say(false, `${page} runs examples/${m[1]}, which does not exist.`) }
  }
  for (const s of superseded) {
    const mentions = [...text.matchAll(new RegExp(`${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!-)`, 'g'))].length
    const explained = /superseded|history|earlier|second candidate set|first candidate set|first set|second set/.test(text)
    if (mentions > 0 && !explained) { linkFailures += 1; say(false, `${page} names the superseded set ${s} without saying it is superseded.`) }
  }
  if (/planning\/|AGENTS\.md/.test(text)) { linkFailures += 1; say(false, `${page} names a private planning path.`) }
  for (const m of text.matchAll(/`@bsv\/(dpp-core|dpp-overlay-topics|dpp-profiles|vsc)`\s+(\d+\.\d+\.\d+)/g)) {
    const pkg = current.packages.find((p) => p.name === `@bsv/${m[1]}`)
    if (pkg.version !== m[2]) { linkFailures += 1; say(false, `${page} names @bsv/${m[1]} ${m[2]}; the current set names ${pkg.version}.`) }
  }
  for (const m of text.matchAll(/overlay(?: contract)?[^.|\n]{0,40}?`?(\d+\.\d+\.\d+-draft)`?/gi)) {
    if (m[1] !== overlayVersion && m[1] !== '0.1.0-draft') { /* historical sets are named in release-sets.md */ if (!/release-sets|migration/.test(page)) { linkFailures += 1; say(false, `${page} names overlay contract ${m[1]}; contracts/overlay.yaml is ${overlayVersion}.`) } }
  }
  if (/registry contract[^.|\n]{0,30}`?0\.\d\.\d`?/i.test(text)) {
    for (const m of text.matchAll(/registry contract[^.|\n]{0,30}?`?(0\.\d\.\d)`?/gi)) if (m[1] !== registryVersion) { linkFailures += 1; say(false, `${page} names registry contract ${m[1]}; contracts/registry.yaml is ${registryVersion}.`) }
  }
}
say(linkFailures === 0, `${links} relative links, ${pinned} pinned repository links and ${commands} example commands across ${pages.length} pages resolve, and every version a page names is the current set's.`)

// 3. The generated pages.
for (const script of ['scripts/render-support-table.mjs', 'scripts/render-requirements-matrix.mjs']) {
  try { execFileSync('node', [join(root, script), '--check'], { stdio: 'pipe' }); say(true, `${script} --check holds.`) } catch (e) { say(false, `${script} --check: ${String(e.stderr ?? e.message).trim()}`) }
}

// 4. GitBook configuration.
const gitbook = readFileSync(join(root, '.gitbook.yaml'), 'utf8')
say(/^root:\s*\.\/docs\/$/m.test(gitbook) && /readme:\s*README\.md/.test(gitbook) && /summary:\s*SUMMARY\.md/.test(gitbook), '.gitbook.yaml roots the site at docs/ with README.md and SUMMARY.md.')

console.log(failures === 0 ? 'Every sentence above holds.' : 'At least one sentence above does not hold.')
process.exit(failures === 0 ? 0 : 1)
