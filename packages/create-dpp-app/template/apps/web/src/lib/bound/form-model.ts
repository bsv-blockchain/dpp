// The model behind the sector forms: a form is a tree of fields, each field
// names the property it writes, and the product document is built from what
// the user entered and from nothing else.
//
// The rules the model keeps:
//
//   - a field left empty is absent from the document. Nothing is defaulted:
//     no identifier, classification, date, unit or precision is made up;
//   - a number is written with the digits that were typed. A decimal goes
//     into the document as text, so 98.50 stays 98.50;
//   - a measurement is a value and a unit together, or it is nothing;
//   - a document that was loaded is rebuilt value for value. A top-level
//     property the form cannot hold exactly is kept as it came, as JSON,
//     and is never dropped or reshaped.
//
// Nothing here touches the page or the network, so the API's tests exercise
// this module directly.

export type Json = Record<string, unknown>

export const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Where a code field's choices come from: a short fixed list, or a class of the profile's own vocabulary, which the API serves. */
export type CodeSource = { options: Array<{ value: string; label: string }> } | { class: string; prefix?: string; only?: string }

interface Base {
  /** The property the field writes, as documents write it. */
  key: string
  label: string
  help?: string
  /** The profile's rules require a value here. The form marks it, and the validator is what enforces it. */
  required?: boolean
}

export type ScalarField =
  | (Base & { kind: 'text' | 'longText' | 'date' | 'dateTime' | 'integer' | 'boolean' })
  /** A web address. `as: 'reference'` writes it as a link to the thing at that address; otherwise it is written as text. */
  | (Base & { kind: 'url'; as?: 'reference' })
  /** `typed` writes the number as a value with the decimal type beside it, for a property the profile's contexts give no number type. */
  | (Base & { kind: 'decimal'; typed?: boolean })
  /** Text with its language. With no language chosen it is written as plain text. */
  | (Base & { kind: 'langText' })
  /** A measurement: the value and its UN/CEFACT unit code. */
  | (Base & { kind: 'quantity'; units: string[] })
  /** A coded value. `as: 'text'` writes the code itself; otherwise it is written as a reference. */
  | (Base & { kind: 'code'; codes: CodeSource; as?: 'text' })
  /** A country by its two-letter code. `as: 'text'` writes the code itself; otherwise a country node. */
  | (Base & { kind: 'country'; as?: 'text' })

/** A member a group always carries once it carries anything: the kind of an indicator, for example. It is never written alone. */
export interface FixedField {
  kind: 'fixed'
  key: string
  value: unknown
}

export interface GroupField extends Base {
  kind: 'group'
  /** The node's type, written first whenever the group has any value. */
  type?: string
  fields: Array<Field | FixedField>
}

export interface ListField extends Base {
  kind: 'list'
  /** What one entry is called, for the add button. */
  itemLabel: string
  item: ScalarField | GroupField
}

export type Field = ScalarField | GroupField | ListField

export interface FormSection {
  title: string
  description?: string
  fields: Field[]
}

export interface SectorForm {
  /** `id@version` of the profile the form writes. */
  profile: string
  /** The contexts a document names, by the file name the binding gives each. */
  contexts: string[]
  type: string[]
  /** The members that state the serial. They are written from the one serial the passport identifier is made of. */
  serialMembers: string[]
  sections: FormSection[]
}

export interface LangValue {
  value: string
  language: string
}
export interface QuantityValue {
  /** Text as typed, or the number a loaded document carried. */
  value: string | number
  unit: string
}
/** A reference a loaded document spelled with `id` where this form writes `@id`. The two mean the same, and the spelling is kept. */
export interface ReferenceValue {
  code: string
  spelled: 'id'
}
export type Value = string | number | boolean | LangValue | QuantityValue | ReferenceValue | { [key: string]: Value } | Value[] | undefined

/** The member of a group's values that holds the node's own identifier, where the group has no field for one. Only a loaded document sets it. */
export const NODE_ID = '~id'

const isReference = (value: unknown): value is ReferenceValue => isObject(value) && typeof value.code === 'string' && value.spelled === 'id'
/** The code or address a reference field holds, whichever way it is spelled. */
export const referenceText = (value: Value): string => (typeof value === 'string' ? value : isReference(value) ? value.code : '')
/** A reference field's value after an edit: the new text, in the spelling the value already had. */
export const withReferenceText = (value: Value, text: string): Value => (isReference(value) ? { code: text, spelled: 'id' } : text)
const writeReference = (value: Value): unknown => (isReference(value) ? { id: value.code } : { '@id': value })
const readReference = (json: unknown): Value | typeof UNFIT => {
  if (!isObject(json)) return UNFIT
  if (hasOnly(json, ['@id']) && typeof json['@id'] === 'string') return json['@id']
  if (hasOnly(json, ['id']) && typeof json.id === 'string') return { code: json.id, spelled: 'id' }
  return UNFIT
}

export interface FormState {
  /** What the user entered, by top-level property. */
  values: Record<string, Value>
  /** Top-level properties the form has no field for, or could not hold exactly: kept as JSON, written as they are. */
  others: Json
  /** Whether the document states its granularity. A new document does; a loaded one keeps what it had. */
  granularity: boolean
  /** What a loaded document carried where the form would otherwise write its own. */
  loaded?: { context?: unknown; type?: unknown; serialMembers?: string[] }
}

export const emptyState = (): FormState => ({ values: {}, others: {}, granularity: true })

/** The identity every document of the form carries: the passport identifier, and the GTIN and serial it is made of. */
export interface Identity {
  passportId: string
  gtin: string
  serial: string
}

export interface FormProblem {
  /** The field, as a pointer into the form's values. */
  pointer: string
  message: string
}

const DECIMAL = /^[+-]?(\d+(\.\d+)?|\.\d+)$/
const INTEGER = /^[+-]?\d+$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
const XSD_DECIMAL = 'xsd:decimal'
const QUANTITY_TYPE = 'gs1:QuantitativeValue'
const COUNTRY_TYPE = 'gs1:Country'

export const escapePointer = (segment: string): string => segment.replace(/~/g, '~0').replace(/\//g, '~1')
const unescapePointer = (segment: string): string => segment.replace(/~1/g, '/').replace(/~0/g, '~')
const UNFIT = Symbol('a value the field cannot hold exactly')
const hasOnly = (value: Json, names: string[]): boolean => Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name))
const isBlank = (value: unknown): boolean => value === undefined || value === null || (typeof value === 'string' && value.trim() === '')

interface Emission {
  problems: FormProblem[]
  /** For each list that was written: the form row each written entry came from. */
  rows: Map<string, number[]>
}

/** The JSON a field writes for a value, or nothing when the value is empty. `formPointer` and `docPointer` say where the field sits. */
function emit(field: Field, value: Value, formPointer: string, docPointer: string, out: Emission): unknown {
  const problem = (message: string): undefined => {
    out.problems.push({ pointer: formPointer, message })
    return undefined
  }
  switch (field.kind) {
    case 'text':
    case 'longText':
      return typeof value === 'string' && !isBlank(value) ? value : undefined
    case 'url': {
      const address = field.as === 'reference' ? referenceText(value) : value
      if (typeof address !== 'string' || isBlank(address)) return undefined
      try {
        new URL(address)
      } catch {
        return problem('Enter a complete web address, starting with https://.')
      }
      return field.as === 'reference' ? writeReference(value) : address
    }
    case 'date':
      if (typeof value !== 'string' || isBlank(value)) return undefined
      return DATE.test(value) ? value : problem('Write the date as YYYY-MM-DD.')
    case 'dateTime':
      if (typeof value !== 'string' || isBlank(value)) return undefined
      return DATE_TIME.test(value) ? value : problem('Write the date and time with its zone, for example 2026-11-02T09:30:00Z.')
    case 'integer':
      if (typeof value === 'number') return value
      if (typeof value !== 'string' || isBlank(value)) return undefined
      return INTEGER.test(value.trim()) && Number.isSafeInteger(Number(value.trim())) ? Number(value.trim()) : problem('Enter a whole number.')
    case 'decimal':
      if (typeof value === 'number') return value
      if (typeof value !== 'string' || isBlank(value)) return undefined
      if (!DECIMAL.test(value.trim())) return problem('Enter a number, with a point for the decimals.')
      // The digits as typed: nothing is rounded and no precision is added.
      return field.typed === true ? { '@value': value.trim(), '@type': XSD_DECIMAL } : value.trim()
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined
    case 'langText': {
      const text = isObject(value) ? (value as unknown as LangValue) : undefined
      if (text == null || isBlank(text.value)) return undefined
      return isBlank(text.language) ? text.value : { '@value': text.value, '@language': text.language.trim() }
    }
    case 'quantity': {
      const quantity = isObject(value) ? (value as unknown as QuantityValue) : undefined
      if (quantity == null || (isBlank(quantity.value) && isBlank(quantity.unit))) return undefined
      if (isBlank(quantity.value)) return problem('Enter the value, or clear the unit.')
      if (isBlank(quantity.unit)) return problem('Choose the unit. A measurement is a value and its unit together.')
      if (typeof quantity.value === 'string' && !DECIMAL.test(quantity.value.trim())) return problem('Enter a number, with a point for the decimals.')
      return { type: QUANTITY_TYPE, 'gs1:value': typeof quantity.value === 'string' ? quantity.value.trim() : quantity.value, 'gs1:unitCode': quantity.unit }
    }
    case 'code':
      if (isBlank(referenceText(value))) return undefined
      return field.as === 'text' ? referenceText(value) : writeReference(value)
    case 'country':
      if (typeof value !== 'string' || isBlank(value)) return undefined
      if (!/^[A-Z]{2}$/.test(value)) return problem('Enter the two-letter country code in capitals, for example AU.')
      return field.as === 'text' ? value : { type: COUNTRY_TYPE, 'gs1:countryCode': value }
    case 'group': {
      const group = isObject(value) ? (value as { [key: string]: Value }) : {}
      const members: Array<[string, unknown]> = []
      let entered = false
      // An identifier a loaded node carried, where the group has no field for one.
      if (typeof group[NODE_ID] === 'string' && !isBlank(group[NODE_ID])) {
        members.push(['id', group[NODE_ID]])
        entered = true
      }
      for (const child of field.fields) {
        if (child.kind === 'fixed') {
          members.push([child.key, child.value])
          continue
        }
        const written = emit(child, group[child.key], `${formPointer}/${escapePointer(child.key)}`, `${docPointer}/${escapePointer(child.key)}`, out)
        if (written === undefined) continue
        members.push([child.key, written])
        entered = true
      }
      // A type and fixed members alone say nothing the user entered, so they are not written alone.
      if (!entered) return undefined
      return Object.fromEntries([...(field.type == null ? [] : [['type', field.type] as [string, unknown]]), ...members])
    }
    case 'list': {
      const entries = Array.isArray(value) ? value : []
      const written: unknown[] = []
      const rows: number[] = []
      entries.forEach((entry, row) => {
        const item = emit({ ...field.item, key: field.key } as Field, entry, `${formPointer}/${row}`, `${docPointer}/${written.length}`, out)
        if (item === undefined) return
        written.push(item)
        rows.push(row)
      })
      if (written.length === 0) return undefined
      out.rows.set(docPointer, rows)
      return written
    }
  }
}


/** The form value for a piece of a document, or `UNFIT` when the field would not write it back the same. */
function read(field: Field, json: unknown): Value | typeof UNFIT {
  switch (field.kind) {
    case 'url':
      if (field.as === 'reference') return readReference(json)
      return typeof json === 'string' ? json : UNFIT
    case 'text':
    case 'longText':
    case 'date':
    case 'dateTime':
      return typeof json === 'string' ? json : UNFIT
    case 'integer':
      return typeof json === 'number' && Number.isSafeInteger(json) ? json : UNFIT
    case 'decimal':
      if (typeof json === 'number') return json
      if (field.typed === true) return isObject(json) && hasOnly(json, ['@value', '@type']) && typeof json['@value'] === 'string' && json['@type'] === XSD_DECIMAL ? json['@value'] : UNFIT
      return typeof json === 'string' ? json : UNFIT
    case 'boolean':
      return typeof json === 'boolean' ? json : UNFIT
    case 'langText':
      if (typeof json === 'string') return { value: json, language: '' }
      return isObject(json) && hasOnly(json, ['@value', '@language']) && typeof json['@value'] === 'string' && typeof json['@language'] === 'string' ? { value: json['@value'], language: json['@language'] } : UNFIT
    case 'quantity': {
      if (!isObject(json) || !hasOnly(json, ['type', 'gs1:value', 'gs1:unitCode']) || json.type !== QUANTITY_TYPE || typeof json['gs1:unitCode'] !== 'string') return UNFIT
      const value = json['gs1:value']
      return typeof value === 'string' || typeof value === 'number' ? { value, unit: json['gs1:unitCode'] } : UNFIT
    }
    case 'code':
      if (field.as === 'text') return typeof json === 'string' ? json : UNFIT
      return readReference(json)
    case 'country':
      if (field.as === 'text') return typeof json === 'string' ? json : UNFIT
      return isObject(json) && hasOnly(json, ['type', 'gs1:countryCode']) && json.type === COUNTRY_TYPE && typeof json['gs1:countryCode'] === 'string' ? json['gs1:countryCode'] : UNFIT
    case 'group': {
      if (!isObject(json)) return UNFIT
      const group: { [key: string]: Value } = {}
      for (const [key, member] of Object.entries(json)) {
        if (key === 'type' && field.type != null) {
          if (member !== field.type) return UNFIT
          continue
        }
        const child = field.fields.find((candidate) => candidate.key === key)
        if (child == null) {
          if (key !== 'id' || typeof member !== 'string') return UNFIT
          group[NODE_ID] = member
          continue
        }
        if (child.kind === 'fixed') {
          if (!sameJson(member, child.value)) return UNFIT
          continue
        }
        const value = read(child, member)
        if (value === UNFIT) return UNFIT
        group[key] = value
      }
      return group
    }
    case 'list': {
      if (!Array.isArray(json)) return UNFIT
      const entries: Value[] = []
      for (const entry of json) {
        const value = read({ ...field.item, key: field.key } as Field, entry)
        if (value === UNFIT) return UNFIT
        entries.push(value)
      }
      return entries
    }
  }
}

/** Whether two JSON values are the same, whatever order their members are written in. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((entry, index) => sameJson(entry, b[index]))
  if (isObject(a) || isObject(b)) {
    if (!isObject(a) || !isObject(b)) return false
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
  }
  return a === b
}

/** The members that state which item a document is about. A form writes them from the passport identifier and takes them from nowhere else. */
const STATED_IDENTITY = ['id', '@id', 'gs1:gtin', 'gs1:hasSerialNumber', 'schema:serialNumber']

export const topLevelFields = (form: SectorForm): Field[] => form.sections.flatMap((section) => section.fields)

/** The members the form writes from the identity, never from a field. */
export function identityMembers(form: SectorForm, state?: FormState): string[] {
  return ['@context', 'id', '@id', 'type', '@type', 'oec:granularityLevel', 'gs1:gtin', ...new Set([...form.serialMembers, ...(state?.loaded?.serialMembers ?? [])])]
}

export interface BuiltDocument {
  /** The complete product document, as it will be sent. */
  product: Json
  /** What stops the document being sent: a measurement with no unit, a number that is not one. */
  problems: FormProblem[]
  rows: Map<string, number[]>
}

/**
 * The product document for what the form holds. The identity members come
 * from the one passport identifier, so the document's GTIN and serial cannot
 * disagree with it. `contexts` are the addresses the registered binding
 * lists for the form's context files.
 */
export function buildDocument(form: SectorForm, state: FormState, identity: Identity, contexts: string[]): BuiltDocument {
  const out: Emission = { problems: [], rows: new Map() }
  const product: Json = {
    '@context': state.loaded?.context ?? contexts,
    id: identity.passportId,
    type: state.loaded?.type ?? form.type,
    ...(state.granularity ? { 'oec:granularityLevel': 'item' } : {}),
    'gs1:gtin': identity.gtin,
  }
  for (const member of state.loaded?.serialMembers ?? form.serialMembers) product[member] = identity.serial
  for (const field of topLevelFields(form)) {
    const written = emit(field, state.values[field.key], `/${escapePointer(field.key)}`, `/${escapePointer(field.key)}`, out)
    if (written !== undefined) product[field.key] = written
  }
  const reserved = new Set(Object.keys(product))
  for (const [key, value] of Object.entries(state.others)) {
    // The identifier, GTIN and serial have one source, the passport identifier, so they cannot be stated a second time here and disagree with it.
    if (STATED_IDENTITY.includes(key)) out.problems.push({ pointer: '/~others', message: `Other properties state ${key}. The form writes the identifier, GTIN and serial from the passport identifier, so remove it here.` })
    else if (reserved.has(key)) out.problems.push({ pointer: '/~others', message: `Other properties repeat ${key}, which the form already writes. Remove it from one of the two.` })
    else product[key] = value
  }
  return { product, problems: out.problems, rows: out.rows }
}

/** A document without its note members: any member whose name starts with `_comment`, at any depth. A profile's contexts do not define them, so a document that carries one is refused. */
export function stripComments<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripComments) as T
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name]) => !name.startsWith('_comment'))
      .map(([name, member]) => [name, stripComments(member)])
  ) as T
}

export interface ParsedDocument {
  state: FormState
  /** The top-level properties that went to the JSON area, because the form has no field for them or could not hold their value exactly. */
  kept: string[]
  /** What the document says of itself, for the identifier inputs. */
  stated: { id?: string; gtin?: string; serial?: string }
}

/** A product document as form values. Every top-level property ends up in a field or, unchanged, in `others`: none is dropped. */
export function parseDocument(form: SectorForm, product: Json): ParsedDocument {
  const state: FormState = { values: {}, others: {}, granularity: Object.hasOwn(product, 'oec:granularityLevel') }
  const kept: string[] = []
  const fields = new Map(topLevelFields(form).map((field) => [field.key, field]))
  const serialMembers = ['gs1:hasSerialNumber', 'schema:serialNumber'].filter((member) => Object.hasOwn(product, member))
  const stated: ParsedDocument['stated'] = {}
  const id = [product.id, product['@id']].find((value): value is string => typeof value === 'string')
  if (id != null) stated.id = id
  if (typeof product['gs1:gtin'] === 'string') stated.gtin = product['gs1:gtin']
  const serial = serialMembers.map((member) => product[member]).find((value): value is string => typeof value === 'string')
  if (serial != null) stated.serial = serial

  const loaded: NonNullable<FormState['loaded']> = {}
  if (Object.hasOwn(product, '@context')) loaded.context = product['@context']
  const type = product.type ?? product['@type']
  if (type !== undefined && !sameJson(type, form.type)) loaded.type = type
  if (serialMembers.length > 0 && !sameJson(serialMembers, form.serialMembers)) loaded.serialMembers = serialMembers
  if (Object.keys(loaded).length > 0) state.loaded = loaded

  const identity = new Set(['@context', 'id', '@id', 'type', '@type', 'oec:granularityLevel', 'gs1:gtin', ...serialMembers])
  for (const [key, value] of Object.entries(product)) {
    if (identity.has(key)) continue
    const field = fields.get(key)
    const read_ = field == null ? UNFIT : read(field, value)
    // The value is taken into the field only if the field writes it back the same. Anything else stays as it came.
    if (field != null && read_ !== UNFIT && sameJson(emit(field, read_, '', '', { problems: [], rows: new Map() }), value)) {
      state.values[key] = read_
    } else {
      state.others[key] = value
      kept.push(key)
    }
  }
  return { state, kept, stated }
}

/**
 * The field a place in the product document belongs to, as a pointer into
 * the form: the deepest field on the way to it. A finding is shown there.
 * `rows` is from the build that made the document, and maps a written list
 * entry back to its row. Nothing is returned for a place outside the form.
 */
export function fieldPointerFor(form: SectorForm, state: FormState, rows: Map<string, number[]>, docPointer: string): string | undefined {
  const segments = docPointer.split('/').slice(1).map(unescapePointer)
  if (segments.length === 0) return undefined
  if (identityMembers(form, state).includes(segments[0])) return '/~identity'
  let field: Field | undefined = topLevelFields(form).find((candidate) => candidate.key === segments[0])
  if (field == null) return Object.hasOwn(state.others, segments[0]) ? '/~others' : undefined
  let formPointer = `/${escapePointer(field.key)}`
  let docWalked = formPointer
  for (let at = 1; at < segments.length; at++) {
    const segment = segments[at]
    if (field.kind === 'list') {
      const index = Number(segment)
      if (!Number.isInteger(index)) break
      const row = rows.get(docWalked)?.[index]
      if (row == null) break
      formPointer = `${formPointer}/${row}`
      docWalked = `${docWalked}/${index}`
      field = { ...field.item, key: field.key } as Field
    } else if (field.kind === 'group') {
      const child: Field | FixedField | undefined = field.fields.find((candidate) => candidate.key === segment)
      if (child == null || child.kind === 'fixed') break
      formPointer = `${formPointer}/${escapePointer(child.key)}`
      docWalked = `${docWalked}/${escapePointer(segment)}`
      field = child
    } else break
  }
  return formPointer
}

export type Tier = 'public' | 'restricted'

/** The tier of a top-level property under a binding's split: public if the binding lists it, restricted otherwise. Without a split everything is public. */
export const tierOf = (access: { public: string[] } | undefined, property: string): Tier => (access == null || access.public.includes(property) ? 'public' : 'restricted')

/** The top-level properties of a document, by the tier each will be written to. */
export function splitPreview(product: Json, access: { public: string[] } | undefined): { public: string[]; restricted: string[] } {
  const names = Object.keys(product)
  return { public: names.filter((name) => tierOf(access, name) === 'public'), restricted: names.filter((name) => tierOf(access, name) === 'restricted') }
}

/** Every class of the profile's vocabulary the form's code fields draw on, for one request to the API. */
export function codeClasses(form: SectorForm): string[] {
  const classes = new Set<string>()
  const visit = (field: Field | FixedField): void => {
    if (field.kind === 'code' && 'class' in field.codes) classes.add(field.codes.class)
    else if (field.kind === 'group') field.fields.forEach(visit)
    else if (field.kind === 'list') visit(field.item)
  }
  topLevelFields(form).forEach(visit)
  return [...classes].sort()
}

/** A label for every property the form knows, by the name documents write, for a reader's page. The first field to name a property wins. */
export function labelsOf(form: SectorForm): Map<string, string> {
  const labels = new Map<string, string>()
  const visit = (field: Field | FixedField): void => {
    if (field.kind === 'fixed') return
    // A list entry has no property of its own, and a node's own identifier is labelled by the page.
    if (field.key !== '' && field.key !== 'id' && !labels.has(field.key)) labels.set(field.key, field.label)
    if (field.kind === 'group') field.fields.forEach(visit)
    else if (field.kind === 'list' && field.item.kind === 'group') field.item.fields.forEach(visit)
  }
  topLevelFields(form).forEach(visit)
  return labels
}
