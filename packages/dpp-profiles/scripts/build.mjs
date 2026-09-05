#!/usr/bin/env node
/**
 * The deterministic generator (`spec/profiles.md` §6). From the immutable
 * manifests in `manifests/` it derives, byte for byte reproducibly:
 *
 *   generated/payload-schema/<profile>.public.schema.json      JSON Schema 2020-12 for the public payload
 *   generated/payload-schema/<profile>.restricted.schema.json  the same for the off-chain tiers
 *   generated/consumer/<id>-v<version>.json                    the legacy consumer document the registry and application serve
 *   generated/index.json                                       every file with its digest
 *
 * `node scripts/build.mjs` regenerates and then fails if a manifest's recorded
 * schema digest or `frozen.json` disagrees with what was generated, because a
 * frozen version changes only by publishing a new one. `--refreeze` writes the
 * new digests into the manifests and `frozen.json` instead; the review of that
 * diff is what a re-freeze consists of.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const stable = (value) => JSON.stringify(value, null, 2) + '\n'
const tidy = (value) => JSON.parse(JSON.stringify(value))

export function readManifests() {
  return readdirSync(join(root, 'manifests'))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(root, 'manifests', f), 'utf8')))
}

const DIALECT = 'https://json-schema.org/draft/2020-12/schema'

/** A JSON Schema for one field's value, from its resolved constraints. */
function valueSchema(field, forPart = false) {
  const c = field.constraints ?? {}
  const numeric = (type) => tidy({ type, ...(c.minimum == null ? {} : { minimum: c.minimum }), ...(c.maximum == null ? {} : { maximum: c.maximum }), ...(c.step == null || type === 'integer' ? {} : { multipleOf: c.step }) })
  let schema
  switch (field.valueType) {
    case 'id':
    case 'text':
      schema = tidy({ type: 'string', minLength: 1, ...(c.maxLength == null ? {} : { maxLength: c.maxLength }), ...(c.pattern == null ? {} : { pattern: c.pattern }) })
      break
    case 'enum':
      schema = field.codeList?.closed ? { enum: field.codeList.options.map((o) => o.value) } : { type: 'string', minLength: 1 }
      break
    case 'multi':
      schema = { type: 'array', uniqueItems: true, items: field.codeList?.closed ? { enum: field.codeList.options.map((o) => o.value) } : { type: 'string', minLength: 1 } }
      break
    case 'decimal':
      schema = numeric('number')
      break
    case 'integer':
      schema = numeric('integer')
      break
    case 'percent':
      schema = { type: 'number', minimum: c.minimum ?? 0, maximum: c.maximum ?? 100 }
      break
    case 'monthYear':
      schema = { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' }
      break
    case 'date':
      schema = { type: 'string', format: 'date' }
      break
    case 'url':
      schema = { type: 'string', format: 'uri' }
      break
    case 'document':
      // A file or a link to one, content hashed and held off chain: the value
      // shape is the application's, so only its outer form is fixed here.
      schema = { oneOf: [{ type: 'string', format: 'uri' }, { type: 'object' }] }
      break
    case 'graphic':
      schema = { type: 'string', minLength: 1 }
      break
    case 'country':
      schema = { type: 'string', pattern: c.pattern ?? '^[A-Z]{2}$' }
      break
    case 'record': {
      const properties = {}
      const required = []
      for (const part of field.parts ?? []) {
        properties[part.key] = valueSchema({ ...part, constraints: part.constraints, codeList: part.codeList }, true)
        if (part.required) required.push(part.key)
      }
      schema = tidy({ type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) })
      break
    }
    case 'any':
      schema = {}
      break
    default:
      throw new Error(`unknown valueType ${field.valueType} on ${field.key}`)
  }
  if (field.awaitingAct != null && field.valueType !== 'record') {
    // No list or pattern may be stated while the act is pending, so the value is
    // only typed, never constrained, and a consumer does not reject on it.
    schema = field.valueType === 'multi' ? { type: 'array', items: { type: 'string' } } : { type: 'string' }
  }
  if (!forPart && field.cardinality === 'many' && field.valueType !== 'multi') schema = { type: 'array', items: schema }
  return schema
}

function stampSchema(stamp) {
  if (stamp.const != null) return { const: stamp.const }
  if (stamp.codeList != null) return { enum: stamp.codeList.options.map((o) => o.value) }
  if (stamp.pattern != null) return { type: 'string', pattern: stamp.pattern }
  return stamp.valueType === 'integer' ? { type: 'integer' } : { type: 'string', minLength: 1 }
}

/** The payload schema for one tier set: public, or every restricted tier together. */
export function payloadSchema(manifest, tier) {
  const isPublic = tier === 'public'
  const fields = manifest.fields.filter((f) => (isPublic ? f.accessTier === 'public' : f.accessTier !== 'public'))
  const properties = {}
  const required = []
  const description = []
  if (isPublic) {
    for (const stamp of manifest.stamps) {
      properties[stamp.key] = { ...stampSchema(stamp), description: stamp.description }
    }
    for (const stamp of manifest.stamps) if (stamp.const != null) required.push(stamp.key)
  }
  for (const field of fields) {
    properties[field.key] = { ...valueSchema(field), title: field.label, description: `${field.obligation}; ${field.legalBasis}${field.applicability.rule === 'always' ? '' : `; applicability ${field.applicability.rule}`}` }
    if (field.obligation === 'required' && field.applicability.rule === 'always' && ['form', 'brand', 'platform'].includes(field.provenance.capture)) required.push(field.key)
  }
  description.push(`${manifest.profile}: ${isPublic ? 'the public payload carried on chain in field 10' : 'the restricted tiers held off chain, encrypted, and committed by field 11'}.`)
  description.push('JSON Schema validity is one check; obligation under a condition (needs-review), units, provenance and legal applicability are separate checks.')
  return tidy({
    $schema: DIALECT,
    $id: `urn:bsv:dpp:profile:${manifest.profile}:payload-${tier}`,
    title: `${manifest.title} (${manifest.profile}), ${tier} payload`,
    description: description.join(' '),
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length ? { required: [...new Set(required)].sort() } : {}),
  })
}

const FIELD_KEY_ORDER = ['key', 'label', 'obligation', 'access', 'level', 'type', 'unit', 'options', 'closed', 'minimum', 'maximum', 'step', 'pattern', 'patternHint', 'maxLength', 'fields', 'repeat', 'awaitingAct', 'prose', 'conditional', 'categories', 'needsBms', 'dynamic', 'onLabel', 'group', 'source', 'clause', 'specName', 'legalRef', 'bpdm', 'bpdmUrn', 'supersedes', 'note']
const ordered = (field) => {
  const rank = (k) => { const at = FIELD_KEY_ORDER.indexOf(k); return at === -1 ? FIELD_KEY_ORDER.length : at }
  return Object.fromEntries(Object.entries(field).sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)))
}
const OBLIGATION_LEGACY = { required: 'must', recommended: 'should', optional: 'nice' }

const CONSTRAINT_CONVENTIONS = {
  resolved: 'Constraints are resolved, not implied: a percent field carries minimum 0 and maximum 100 explicitly, and a country field carries its pattern. No type-specific defaults need reapplying.',
  closed: 'closed:true means options are exhaustive and a value outside them is invalid. closed:false means the list is what is known in practice and a value outside it is valid, because the source names no exhaustive vocabulary. A field with options and no closed key is closed.',
  awaitingAct: "awaitingAct names a delegated or implementing act that will fix this value's permitted form. Until it is adopted no list or pattern is stated, because stating one would publish a guess as a standard. Do not reject values on this field.",
  prose: 'prose:true marks a value that is meant to be written for a person to read. It is a deliberate per-field decision, not an absent constraint.',
  record: 'type:record carries fields describing its parts. With repeat:true the value is an array of such records; without, a single one.',
}

/**
 * The legacy consumer document: the shape the registry serves at
 * /spec/profiles/{profile} and the application publishes under content/profiles,
 * reproduced byte for byte from the manifest so the three repositories cannot
 * drift.
 */
export function consumerDocument(manifest, all) {
  const current = all.find((m) => m.id === manifest.id && m.status === 'current')
  const status = manifest.status === 'current'
    ? 'in use'
    : manifest.status === 'superseded'
      ? `superseded by ${manifest.supersededBy}, and still served: passports published under it declare this version and are never rewritten`
      : 'draft: declared, not installed'
  const legacyField = (f) => {
    const din = f.sourceRefs?.find((s) => s.source === 'din-dke-spec-99100')
    const bpdm = f.sourceRefs?.find((s) => s.source === 'bpdm-1.2.0')
    return ordered(tidy({
      key: f.key,
      label: f.label,
      obligation: OBLIGATION_LEGACY[f.obligation],
      access: f.accessTier,
      level: f.valueType === 'any' ? undefined : f.granularity,
      type: f.valueType === 'any' ? undefined : f.valueType,
      unit: f.unit,
      options: f.codeList?.options,
      closed: f.codeList == null ? undefined : f.codeList.closed,
      minimum: f.constraints?.minimum,
      maximum: f.constraints?.maximum,
      step: f.constraints?.step,
      pattern: f.constraints?.pattern,
      patternHint: f.constraints?.patternHint,
      maxLength: f.constraints?.maxLength,
      fields: f.parts?.map((p) => tidy({ key: p.key, label: p.label, type: p.valueType, unit: p.unit, options: p.codeList?.options, closed: p.codeList == null ? undefined : p.codeList.closed, minimum: p.constraints?.minimum, maximum: p.constraints?.maximum, pattern: p.constraints?.pattern, patternHint: p.constraints?.patternHint, required: p.required ? true : undefined })),
      repeat: f.cardinality === 'many' && f.valueType !== 'multi' ? true : undefined,
      awaitingAct: f.awaitingAct,
      prose: f.provenance.prose ? true : undefined,
      conditional: f.applicability.condition,
      categories: f.applicability.categories,
      needsBms: f.provenance.needsBms ? true : undefined,
      dynamic: f.provenance.dynamic ? true : undefined,
      onLabel: f.provenance.onLabel ? true : undefined,
      group: f.group,
      source: f.valueType === 'any' ? (f.provenance.capture === 'brand' ? 'brand' : 'product') : f.provenance.capture,
      clause: din?.clause,
      specName: din?.name,
      legalRef: f.valueType === 'any' ? undefined : f.legalBasis,
      bpdm: bpdm?.property,
      bpdmUrn: f.semanticUri,
      supersedes: f.supersedes,
      // Version-1 documents carried no notes; the manifest's own commentary on
      // those fields stays in the manifest.
      note: f.valueType === 'any' ? undefined : f.note,
    }))
  }
  // Every declared field, whatever its capture: the consumer document has always
  // described the registry in full, and a reader of a lifecycle event needs the
  // event-captured fields as much as the form ones.
  const fields = manifest.fields.map(legacyField)
  const registers = manifest.sourceRefs.filter((s) => s.fields != null).map((s) => tidy({ prefix: s.id.split('-')[0], name: s.name, reference: s.reference, use: s.use, fields: s.fields }))
  const vocabularies = manifest.contextRefs.map((c) => tidy({ prefix: c.id.split('-')[0], name: c.name, repository: c.repository, licence: c.licence, retrieved: c.retrieved, urnPattern: c.urnPattern, use: c.use }))
  const sources = manifest.sourceRefs.filter((s) => s.fields == null).map((s) => s.name)
  return tidy({
    id: manifest.id,
    version: manifest.version,
    profile: manifest.profile,
    status,
    regulatoryLine: manifest.regulatoryLine,
    supersededBy: manifest.status === 'superseded' ? manifest.supersededBy : undefined,
    note: manifest.version === 1 ? undefined : manifest.description,
    sources: manifest.version === 1 ? undefined : sources.length ? sources : undefined,
    vocabularies: vocabularies.length ? vocabularies : undefined,
    registers: manifest.version === 1 ? undefined : registers.length ? registers : undefined,
    conventions: manifest.version === 1 ? undefined : CONSTRAINT_CONVENTIONS,
    fields,
    ...(current == null ? {} : {}),
  })
}

const CAPTURE_CLAIMANT = {
  form: 'the registering maker, at registration',
  brand: 'the brand record, supplied once',
  platform: 'the platform, stamped',
  event: 'the party acting in the lifecycle event',
  derived: 'calculated by the platform from other fields',
  deferred: 'not captured yet',
}

/**
 * The row-level mapping inventory (spec/profiles.md, P09): every field with its
 * external semantic field, unit or code list, granularity, obligation and its
 * source, applicability, access tier, who captures it and what evidence it
 * needs. Cells this manifest cannot fill say so; no legal conclusion is drawn.
 */
export function mappingTable(manifest) {
  const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const rows = manifest.fields.map((f) => {
    const list = f.codeList ? `${f.codeList.closed ? 'closed' : 'open'} list (${f.codeList.options.length})` : ''
    const unit = [f.valueType, f.unit ? `in ${f.unit}` : '', list].filter(Boolean).join(', ')
    const applicability = f.applicability.rule === 'always' ? 'always' : f.applicability.rule === 'category-in' ? `categories ${f.applicability.categories.join(', ')}` : `needs review: ${f.applicability.condition}${f.applicability.categories ? ` (categories ${f.applicability.categories.join(', ')})` : ''}`
    const evidence = f.provenance.kind === 'calculation' ? 'the inputs it is calculated from' : f.provenance.capture === 'event' ? 'the event record and its signer' : f.valueType === 'document' ? 'the referenced document, hashed' : 'needs review'
    return `| ${cell(f.key)} | ${cell(f.label)} | ${cell(f.semanticUri ?? 'not mapped')} | ${cell(unit)} | ${cell(f.granularity)} | ${cell(f.obligation)} | ${cell(f.legalBasis)} | ${cell(applicability)} | ${cell(f.accessTier)} | ${cell(CAPTURE_CLAIMANT[f.provenance.capture])} | ${cell(evidence)} |`
  })
  return [
    `# Field mapping inventory: ${manifest.profile}`,
    '',
    `Generated from \`manifests/${manifest.profile}.json\` by the profiles generator. One row per declared field. The external semantic field is the manifest's semantic URI where one is recorded and \`not mapped\` otherwise; obligation and legal basis are separate columns because one is this profile's requirement and the other is the instrument that asks, or the statement that none does. \`needs review\` marks what no generator can decide: a conditional applicability, or the evidence a value needs. Nothing here is a legal conclusion, and no external exchange vocabulary is mapped until its artefacts are pinned.`,
    '',
    `Regulatory line: ${manifest.regulatoryLine}`,
    '',
    ...manifest.applicability.statements.map((s) => `- Applicability statement (${s.status}): ${s.text}`),
    '',
    '| Key | Label | External semantic field | Type, unit, list | Granularity | Obligation | Legal basis | Applicability | Access tier | Captured by | Evidence required |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

export function generateAll(manifests) {
  const files = new Map()
  for (const m of manifests) {
    files.set(`generated/payload-schema/${m.profile}.public.schema.json`, stable(payloadSchema(m, 'public')))
    files.set(`generated/payload-schema/${m.profile}.restricted.schema.json`, stable(payloadSchema(m, 'restricted')))
    files.set(`generated/consumer/${m.id}-v${m.version}.json`, stable(consumerDocument(m, manifests)))
    if (m.status === 'current') files.set(`generated/mapping/${m.profile}.md`, mappingTable(m))
  }
  const index = manifests.map((m) => ({
    profile: m.profile,
    status: m.status,
    manifest: `manifests/${m.profile}.json`,
    manifestSha256: sha256(readFileSync(join(root, 'manifests', `${m.profile}.json`))),
    publicSchema: `generated/payload-schema/${m.profile}.public.schema.json`,
    publicSchemaSha256: sha256(files.get(`generated/payload-schema/${m.profile}.public.schema.json`)),
    restrictedSchema: `generated/payload-schema/${m.profile}.restricted.schema.json`,
    restrictedSchemaSha256: sha256(files.get(`generated/payload-schema/${m.profile}.restricted.schema.json`)),
    consumer: `generated/consumer/${m.id}-v${m.version}.json`,
    consumerSha256: sha256(files.get(`generated/consumer/${m.id}-v${m.version}.json`)),
  }))
  files.set('generated/index.json', stable(index))
  return files
}

function main() {
  const refreeze = process.argv.includes('--refreeze')
  let manifests = readManifests()
  const files = generateAll(manifests)
  let problems = 0
  // Record the payload schema digests in the manifests, then regenerate the
  // index (whose manifest digests depend on the manifest bytes).
  for (const m of manifests) {
    const publicDigest = sha256(files.get(`generated/payload-schema/${m.profile}.public.schema.json`))
    const restrictedDigest = sha256(files.get(`generated/payload-schema/${m.profile}.restricted.schema.json`))
    if (m.schemaDigest !== publicDigest || m.restrictedSchemaDigest !== restrictedDigest) {
      if (refreeze) {
        m.schemaDigest = publicDigest
        m.restrictedSchemaDigest = restrictedDigest
        writeFileSync(join(root, 'manifests', `${m.profile}.json`), stable(m))
        console.log(`refroze ${m.profile}: schema digests recorded in its manifest.`)
      } else {
        problems += 1
        console.log(`DEFECT: ${m.profile} records schema digest ${m.schemaDigest.slice(0, 12)}… but the generator produces ${publicDigest.slice(0, 12)}…; a frozen profile changes only by a new version, or by an explicit --refreeze that is reviewed.`)
      }
    }
  }
  manifests = readManifests()
  const finalFiles = generateAll(manifests)
  for (const [relative, text] of finalFiles) {
    mkdirSync(dirname(join(root, relative)), { recursive: true })
    writeFileSync(join(root, relative), text)
  }
  const frozenPath = join(root, 'frozen.json')
  const frozen = {
    frozenAt: '2026-09-05',
    description: 'Digests every published manifest and generated file is held to. A frozen version changes only by publishing a new version; an explicit, reviewed --refreeze is the one other way this file moves.',
    manifests: Object.fromEntries(manifests.map((m) => [m.profile, sha256(readFileSync(join(root, 'manifests', `${m.profile}.json`)))])),
    generated: Object.fromEntries([...finalFiles].map(([relative, text]) => [relative, sha256(text)])),
  }
  let previous
  try { previous = JSON.parse(readFileSync(frozenPath, 'utf8')) } catch { previous = undefined }
  if (previous == null || refreeze) {
    if (previous != null) frozen.frozenAt = previous.frozenAt
    writeFileSync(frozenPath, stable(frozen))
    console.log(`${previous == null ? 'froze' : 'refroze'} ${Object.keys(frozen.manifests).length} manifests and ${Object.keys(frozen.generated).length} generated files in frozen.json.`)
  } else {
    for (const [profile, digest] of Object.entries(frozen.manifests)) {
      if (previous.manifests[profile] !== digest) { problems += 1; console.log(`DEFECT: manifest ${profile} differs from its frozen digest; publish a new version or --refreeze after review.`) }
    }
    for (const [relative, digest] of Object.entries(frozen.generated)) {
      if (previous.generated[relative] !== digest) { problems += 1; console.log(`DEFECT: generated ${relative} differs from its frozen digest.`) }
    }
  }
  console.log(problems === 0 ? `generated ${finalFiles.size} files from ${manifests.length} manifests; nothing drifted from frozen.json.` : `${problems} defect${problems === 1 ? '' : 's'}.`)
  process.exit(problems === 0 ? 0 : 1)
}

if (process.argv[1] != null && fileURLToPath(import.meta.url) === (await import('node:fs')).realpathSync(process.argv[1])) main()
