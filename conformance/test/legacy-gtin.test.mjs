/**
 * GS1's documentation example GTIN, 09506000134352, is a real, registered
 * trade item number, so nothing new may carry it: a demonstration, an example
 * or a test takes a GTIN under prefix 952 (spec/record-model.md §3,
 * fixtures/README.md). It survives only where bytes are frozen, where a test
 * or reader is about those frozen or historical records, and in notes that
 * label it as legacy, each named below with its reason. A file not named here,
 * a named page that uses the number outside its labelled section, or a named
 * test that uses it in an identifier its entry does not name, fails.
 * Run by `node --test conformance/test/*.test.mjs`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The number in its GTIN-13 and GTIN-14 spellings, never as part of a longer run of digits. */
const LEGACY_GTIN = /(?<![0-9])0?9506000134352(?![0-9])/

const frozen = 'a frozen version 1 fixture, or one derived from it, whose bytes change only with the format version'
const frozenTest = 'builds or reads the frozen fixtures, so it keeps their identifiers'
const historical = 'the historical anchor rail, whose fixture and hosted records carry identifiers under this GTIN'

/**
 * The identifiers the frozen fixtures carry: JERSEY-001 in the version 1
 * record and chain, JERSEY-002 as the subject the evidence fixture's
 * substitution case asks for, and B59E82284DEE in the historical anchor
 * fixture. A test of those fixtures may carry these and no other identifier
 * under the number.
 */
const FROZEN_IDENTIFIERS = /https:\/\/id\.gs1\.org\/01\/09506000134352\/21\/(?:JERSEY-00[12]|B59E82284DEE)(?![A-Za-z0-9-])/

/**
 * Every file allowed to carry the number, with its reason. A `section` limits
 * a Markdown page to the part under that heading, so a page can keep a
 * labelled legacy note without the number spreading to the rest of it. An
 * `only` pattern limits a file to the uses it matches, so a test of the frozen
 * fixtures cannot also mint a new identifier under the number.
 */
const ALLOWED = new Map([
  ['packages/dpp-profiles/src/identifiers.ts', { reason: 'the GS1_EXAMPLE_GTIN_14 constant, which names the number so code can recognise it' }],
  ['packages/dpp-profiles/test/identifiers.test.ts', { reason: 'tests of that constant, of the check digit on GS1\'s documented example number, and of parsing a legacy identifier under id.gs1.org' }],
  ['fixtures/record-v1.json', { reason: frozen }],
  ['fixtures/chain-v1.json', { reason: frozen }],
  ['fixtures/evidence-v1.json', { reason: frozen }],
  ['fixtures/vectors/dpp/record/v1.json', { reason: frozen }],
  ['fixtures/vectors/dpp/chain/v1.json', { reason: frozen }],
  ['fixtures/chain-v2.json', { reason: 'the upgrade case, which continues the frozen version 1 chain under its identifier' }],
  ['fixtures/vectors/dpp/chain/v2.json', { reason: 'the upgrade case, which continues the frozen version 1 chain under its identifier' }],
  ['fixtures/evidence-v2.json', { reason: 'the upgrade cases, which continue the frozen version 1 chain under its identifier' }],
  ['fixtures/attestation-anchor-v1.json', { reason: 'a claim about the frozen version 1 chain, under its identifier' }],
  ['fixtures/vectors/dpp/attestation-anchor/v1.json', { reason: 'a claim about the frozen version 1 chain, under its identifier' }],
  ['fixtures/anchor-v3.json', { reason: 'the frozen historical anchor fixture' }],
  ['fixtures/vectors/dpp/anchor/v3.json', { reason: 'the frozen historical anchor fixture' }],
  ['fixtures/README.md', { reason: 'the fixture policy, which explains why the frozen fixtures keep the number' }],
  ['packages/dpp-protocol/test/helpers.ts', { reason: frozenTest, only: FROZEN_IDENTIFIERS }],
  ['packages/dpp-protocol/test/record-v1-fixture.ts', { reason: frozenTest, only: FROZEN_IDENTIFIERS }],
  ['packages/dpp-protocol/test/chain-v1-fixture.ts', { reason: frozenTest, only: FROZEN_IDENTIFIERS }],
  ['packages/dpp-protocol/test/evidence-v1-fixture.ts', { reason: frozenTest, only: FROZEN_IDENTIFIERS }],
  ['packages/dpp-protocol/test/evidence.test.ts', { reason: frozenTest, only: FROZEN_IDENTIFIERS }],
  ['packages/dpp-protocol/test/canonical.test.ts', { reason: 'canonical bytes of the historical claim format and of the frozen historical anchor fixture', only: FROZEN_IDENTIFIERS }],
  ['packages/dpp-overlay/test/anchor-v3-fixture.ts', { reason: 'the frozen historical anchor fixture', only: FROZEN_IDENTIFIERS }],
  ['packages/dpp-overlay/test/tmUoraDpp.test.ts', { reason: historical, only: FROZEN_IDENTIFIERS }],
  ['packages/dpp-overlay/test/lsUoraDpp.test.ts', { reason: historical }],
  ['packages/dpp-overlay/test/uoraAnchor.test.ts', { reason: historical }],
  ['packages/dpp-overlay/test/uoraRail.test.ts', { reason: historical }],
  ['packages/create-dpp-app/template/apps/api/test/lifecycle.test.ts', { reason: 'a refusal test: the starter refuses a legacy identifier as outside its prefix and host' }],
  ['docs/deployment.md', { reason: 'the labelled note on the hosted index\'s legacy passports', section: 'Legacy identifiers' }],
  ['CHANGELOG.md', { reason: 'the repository history' }],
  ['conformance/test/legacy-gtin.test.mjs', { reason: 'this check' }],
])

/** The heading text each line of a Markdown page sits under, outermost first; a `#` line inside a fenced block is not a heading. */
function headingsByLine(text) {
  const stack = []
  let fenced = false
  return text.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    const heading = fenced ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading != null) {
      const level = heading[1].length
      while (stack.length > 0 && stack.at(-1).level >= level) stack.pop()
      stack.push({ level, text: heading[2] })
    }
    return stack.map((h) => h.text)
  })
}

/** One sentence per file, or line of a sectioned or limited file, that carries the number where the allow-list does not allow it. */
function unexpectedUses(files, read, allowed = ALLOWED) {
  const problems = []
  for (const path of files) {
    const text = read(path)
    if (text == null || !LEGACY_GTIN.test(text)) continue
    const entry = allowed.get(path)
    if (entry == null) {
      const line = text.split('\n').findIndex((l) => LEGACY_GTIN.test(l)) + 1
      problems.push(`${path}:${line} carries GS1's example GTIN 09506000134352; use a GTIN under prefix 952, or name the file in ALLOWED with its reason.`)
      continue
    }
    if (entry.only != null) {
      const allowedUse = new RegExp(entry.only.source, 'g')
      text.split('\n').forEach((l, i) => {
        if (LEGACY_GTIN.test(l.replace(allowedUse, ''))) problems.push(`${path}:${i + 1} carries GS1's example GTIN in a use its allow-list entry does not name.`)
      })
    }
    if (entry.section == null) continue
    const under = headingsByLine(text)
    text.split('\n').forEach((l, i) => {
      if (LEGACY_GTIN.test(l) && !under[i].includes(entry.section)) problems.push(`${path}:${i + 1} carries GS1's example GTIN outside its "${entry.section}" section.`)
    })
  }
  return problems
}

/** Tracked files and new ones not yet ignored, as the working tree holds them. */
function repositoryFiles() {
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
  return listed.split('\0').filter((path) => path !== '')
}

const readFile = (path) => {
  try {
    return readFileSync(join(root, path), 'latin1')
  } catch {
    return null
  }
}

test('GS1\'s example GTIN appears only where the allow-list says, each with its reason', () => {
  const files = repositoryFiles()
  assert.ok(files.length > 100, 'the repository file list is read from git')
  assert.deepEqual(unexpectedUses(files, readFile), [])
})

test('every allow-listed file still carries the number, so the list never outlives its reason', () => {
  const stale = [...ALLOWED.keys()].filter((path) => !LEGACY_GTIN.test(readFile(path) ?? ''))
  assert.deepEqual(stale, [])
})

test('a new use is refused, in either spelling, a labelled page keeps it to its section, and a limited file to the uses it names', () => {
  const pages = {
    'docs/new.md': 'Try https://id.gs1.org/01/09506000134352/21/X.\n',
    'examples/new.mjs': "const gtin = '9506000134352'\n",
    'docs/other.md': 'A 952 number: 09521234000013, and 109506000134352 is not the GTIN.\n',
    'docs/labelled.md': '# Page\n\n## Legacy identifiers\n\n`https://id.gs1.org/01/09506000134352/21/A`\n\n## Next\n\n`https://id.gs1.org/01/09506000134352/21/B`\n',
    'test/frozen.test.ts': "const id = 'https://id.gs1.org/01/09506000134352/21/JERSEY-001'\nconst other = 'https://id.gs1.org/01/09506000134352/21/JERSEY-0011'\nconst both = ['https://id.gs1.org/01/09506000134352/21/B59E82284DEE', 'https://dpp.bsvb.net/01/09506000134352/21/X']\n",
  }
  const allowed = new Map([['docs/labelled.md', { reason: 'test', section: 'Legacy identifiers' }], ['test/frozen.test.ts', { reason: 'test', only: FROZEN_IDENTIFIERS }]])
  assert.deepEqual(unexpectedUses(Object.keys(pages), (path) => pages[path], allowed), [
    'docs/new.md:1 carries GS1\'s example GTIN 09506000134352; use a GTIN under prefix 952, or name the file in ALLOWED with its reason.',
    'examples/new.mjs:1 carries GS1\'s example GTIN 09506000134352; use a GTIN under prefix 952, or name the file in ALLOWED with its reason.',
    'docs/labelled.md:9 carries GS1\'s example GTIN outside its "Legacy identifiers" section.',
    'test/frozen.test.ts:2 carries GS1\'s example GTIN in a use its allow-list entry does not name.',
    'test/frozen.test.ts:3 carries GS1\'s example GTIN in a use its allow-list entry does not name.',
  ])
})
