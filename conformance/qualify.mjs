#!/usr/bin/env node
/**
 * The selected-claim qualification (spec/conformance.md section 6).
 *
 *   node conformance/qualify.mjs conformance/selections/<selection>.json
 *   node conformance/qualify.mjs <selection> --ledger <path> --root <dir>
 *
 * A selection names the claims one release or one declaration requires,
 * each required or withheld with its kind and, for a required system or
 * product claim, every row of its profile either required or excluded with
 * a reason. This command reads the selection with exactly the assessment
 * check.mjs makes (assess.mjs), one sentence per claim, row, exclusion and
 * withheld claim, and exits 1 when the selection is invalid or any required
 * claim cannot be made: a row unassessed or below the claim's minimum, a
 * source whose artefact changed, a row not in the ledger, a not-applicable
 * row without its reasoning, an assessment resting on an unavailable source,
 * or a row of a required full scope that is neither required nor excluded.
 *
 * The diagnostic checker stays green with a blocked future claim, because the
 * ledger exists to say so; this command does not, because it is the gate a
 * release names. Its answer is what the ledger's evidence supports. It is not
 * a conformity certificate, and it says nothing about product compliance,
 * deployed operation or a third party's testing.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { assessClaims, assessSelection, readRows, readSources } from './assess.mjs'

const args = process.argv.slice(2)
const option = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1] }
const positional = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')))
const root = resolve(option('--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..'))
const ledgerPath = option('--ledger') ?? 'conformance/manifest.json'
const selectionArg = positional[0]
if (selectionArg == null) {
  console.error('usage: node conformance/qualify.mjs <selection.json> [--ledger conformance/manifest.json] [--root <dir>]')
  process.exit(2)
}
const at = (relative) => (isAbsolute(relative) ? relative : join(root, relative))
const read = (relative) => JSON.parse(readFileSync(at(relative), 'utf8'))

let invalid = 0
const defect = (sentence) => { invalid += 1; console.log(`DEFECT: ${sentence}`) }
const refused = (sentence) => console.log(`refused: ${sentence}`)
const say = (sentence) => console.log(sentence)

if (!existsSync(at(selectionArg))) { defect(`selection ${selectionArg} does not exist.`); process.exit(1) }

const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
const schemaDir = dirname(fileURLToPath(import.meta.url))
const validateSelection = ajv.compile(JSON.parse(readFileSync(join(schemaDir, 'selection.schema.json'), 'utf8')))
const validateLedger = ajv.compile(JSON.parse(readFileSync(join(schemaDir, 'manifest.schema.json'), 'utf8')))

const selection = read(selectionArg)
if (!validateSelection(selection)) {
  for (const e of validateSelection.errors ?? []) defect(`${selectionArg} ${e.instancePath || '/'} ${e.message}${e.params?.allowedValues ? ` (${e.params.allowedValues.join(', ')})` : ''}.`)
}
const ledger = read(ledgerPath)
if (!validateLedger(ledger)) {
  for (const e of validateLedger.errors ?? []) defect(`${ledgerPath} ${e.instancePath || '/'} ${e.message}.`)
}
if (invalid > 0) { say(`Selection ${selectionArg} cannot be qualified: the material is defective.`); process.exit(1) }

const { sources, moved, defects: sourceDefects } = readSources(ledger, root)
const { rows, defects: rowDefects } = readRows(ledger, sources)
for (const sentence of [...sourceDefects, ...rowDefects]) defect(sentence)
const verdicts = assessClaims(ledger, rows, moved)
for (const v of verdicts.values()) for (const id of v.unknownRows) defect(`claim ${v.id} requires ${id}, which the ledger does not carry.`)

const result = assessSelection(selection, { ledger, rows, sources, verdicts, root })
say(`selection ${selection.selectionId}: ${selection.purpose}`)
for (const sentence of result.invalid) defect(sentence)
for (const sentence of result.findings) say(sentence)
for (const sentence of result.refusals) refused(sentence)

if (invalid > 0) say(`Selection ${selection.selectionId} cannot be qualified: the selection or the ledger is defective.`)
else if (result.refusals.length > 0) say(`Selection ${selection.selectionId} is refused: a required claim cannot be made on the ledger's evidence.`)
else say(`Selection ${selection.selectionId} is qualified: every required claim can be made on the ledger's evidence. This is the ledger's answer, not a conformity certificate.`)
process.exit(invalid === 0 && result.refusals.length === 0 ? 0 : 1)
