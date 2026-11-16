// One field of a sector form, drawn from its definition: a control for a
// single value, a box of fields for a nested object, a list of rows for a
// repeated one. A field starts empty and stays out of the document until
// something is entered. Findings and problems appear under the field they
// concern.
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FindingLines, NativeSelect, TierBadge } from '@/components/bound/pieces'
import type { CodeLists, Finding } from '@/lib/api'
import { NODE_ID, escapePointer, referenceText, withReferenceText, type CodeSource, type Field, type GroupField, type LangValue, type QuantityValue, type Tier, type Value } from '@/lib/bound/form-model'
import { unitName } from '@/lib/bound/units'

export interface FieldContext {
  codes: CodeLists
  /** Findings of the last refused attempt, by the field they were placed at. */
  findings: Map<string, Finding[]>
  /** What stops the document being built, by field. */
  problems: Map<string, string[]>
  disabled?: boolean
}

interface FieldProps {
  field: Field
  value: Value
  onChange: (value: Value) => void
  /** The field's place in the form's values. */
  pointer: string
  context: FieldContext
  /** Shown beside the label of a top-level property. */
  tier?: Tier
}

const idOf = (pointer: string): string => `f${pointer.replace(/[^A-Za-z0-9]+/g, '-')}`
const textOf = (value: Value): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '')

/** The choices for a code field: a fixed list, or the profile's own vocabulary narrowed to what the field is about. */
function optionsFor(source: CodeSource, codes: CodeLists): Array<{ value: string; label: string }> {
  if ('options' in source) return source.options
  const only = source.only == null ? undefined : new RegExp(source.only)
  return (codes[source.class] ?? []).filter((option) => (source.prefix == null || option.value.startsWith(source.prefix)) && (only == null || only.test(option.value.slice(option.value.indexOf(':') + 1))))
}

function Shell({ field, pointer, context, tier, children, wide }: { field: Field; pointer: string; context: FieldContext; tier?: Tier; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'space-y-1.5 sm:col-span-2' : 'space-y-1.5'}>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={idOf(pointer)}>
          {field.label}
          {field.required ? <span className="text-destructive" aria-hidden>*</span> : null}
        </Label>
        {tier == null ? null : <TierBadge tier={tier} />}
      </div>
      {children}
      {field.help == null ? null : <p className="text-xs text-muted-foreground">{field.help}</p>}
      <FindingLines findings={context.findings.get(pointer)} problems={context.problems.get(pointer)} />
    </div>
  )
}

export function FieldView({ field, value, onChange, pointer, context, tier }: FieldProps) {
  const id = idOf(pointer)
  const disabled = context.disabled
  switch (field.kind) {
    case 'text':
    case 'url':
    case 'date':
    case 'dateTime':
    case 'integer':
    case 'decimal':
      return (
        <Shell field={field} pointer={pointer} context={context} tier={tier}>
          <Input
            id={id}
            type={field.kind === 'date' ? 'date' : 'text'}
            inputMode={field.kind === 'integer' ? 'numeric' : field.kind === 'decimal' ? 'decimal' : field.kind === 'url' ? 'url' : undefined}
            value={field.kind === 'url' ? referenceText(value) : textOf(value)}
            onChange={(e) => onChange(field.kind === 'url' ? withReferenceText(value, e.target.value) : e.target.value)}
            placeholder={field.kind === 'url' ? 'https://' : field.kind === 'dateTime' ? '2026-11-02T09:30:00Z' : undefined}
            disabled={disabled}
            spellCheck={field.kind === 'text' ? undefined : false}
          />
        </Shell>
      )
    case 'longText':
      return (
        <Shell field={field} pointer={pointer} context={context} tier={tier} wide>
          <Textarea id={id} value={textOf(value)} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
        </Shell>
      )
    case 'boolean':
      return (
        <Shell field={field} pointer={pointer} context={context} tier={tier}>
          <NativeSelect id={id} value={value === true ? 'yes' : value === false ? 'no' : ''} onChange={(e) => onChange(e.target.value === 'yes' ? true : e.target.value === 'no' ? false : undefined)} disabled={disabled}>
            <option value="">Not stated</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </NativeSelect>
        </Shell>
      )
    case 'langText': {
      const text = (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : { value: '', language: '' }) as unknown as LangValue
      return (
        <Shell field={field} pointer={pointer} context={context} tier={tier} wide>
          <div className="flex gap-2">
            <Input id={id} value={text.value} onChange={(e) => onChange({ value: e.target.value, language: text.language })} disabled={disabled} />
            <Input className="w-24 shrink-0" value={text.language} onChange={(e) => onChange({ value: text.value, language: e.target.value })} placeholder="Language" aria-label={`Language of ${field.label}`} disabled={disabled} spellCheck={false} />
          </div>
        </Shell>
      )
    }
    case 'quantity': {
      const quantity = (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : { value: '', unit: '' }) as unknown as QuantityValue
      // A unit a loaded document used stays choosable, even when this form would not offer it.
      const units = quantity.unit !== '' && !field.units.includes(quantity.unit) ? [quantity.unit, ...field.units] : field.units
      return (
        <Shell field={field} pointer={pointer} context={context} tier={tier}>
          <div className="flex gap-2">
            <Input id={id} inputMode="decimal" value={typeof quantity.value === 'number' ? String(quantity.value) : quantity.value} onChange={(e) => onChange({ value: e.target.value, unit: quantity.unit })} disabled={disabled} />
            <NativeSelect className="w-44 shrink-0" value={quantity.unit} onChange={(e) => onChange({ value: quantity.value, unit: e.target.value })} aria-label={`Unit of ${field.label}`} disabled={disabled}>
              <option value="">Unit</option>
              {units.map((unit) => (
                <option key={unit} value={unit}>
                  {unitName(unit)} ({unit})
                </option>
              ))}
            </NativeSelect>
          </div>
        </Shell>
      )
    }
    case 'code': {
      const current = referenceText(value)
      const set = (text: string): void => onChange(withReferenceText(value, text))
      const offered = optionsFor(field.codes, context.codes)
      const options = current !== '' && !offered.some((option) => option.value === current) ? [{ value: current, label: current }, ...offered] : offered
      return (
        <Shell field={field} pointer={pointer} context={context} tier={tier}>
          {options.length === 0 ? (
            // No list was loaded for this code. The code can still be written by hand, exactly as the profile's vocabulary spells it.
            <Input id={id} value={current} onChange={(e) => set(e.target.value)} placeholder="A code from the profile's vocabulary" disabled={disabled} spellCheck={false} />
          ) : (
            <NativeSelect id={id} value={current} onChange={(e) => set(e.target.value)} disabled={disabled}>
              <option value="">Not stated</option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </Shell>
      )
    }
    case 'country':
      return (
        <Shell field={field} pointer={pointer} context={context} tier={tier}>
          <Input id={id} value={textOf(value)} onChange={(e) => onChange(e.target.value.toUpperCase())} maxLength={2} placeholder="Two letters, for example AU" disabled={disabled} spellCheck={false} />
        </Shell>
      )
    case 'group':
      return (
        <fieldset className="space-y-3 rounded-lg border p-3 sm:col-span-2">
          <legend className="flex items-center gap-2 px-1 text-sm font-medium">
            {field.label}
            {field.required ? <span className="text-destructive" aria-hidden>*</span> : null}
            {tier == null ? null : <TierBadge tier={tier} />}
          </legend>
          {field.help == null ? null : <p className="text-xs text-muted-foreground">{field.help}</p>}
          <FindingLines findings={context.findings.get(pointer)} problems={context.problems.get(pointer)} />
          <GroupFields field={field} value={value} onChange={onChange} pointer={pointer} context={context} />
        </fieldset>
      )
    case 'list': {
      const rows = Array.isArray(value) ? value : []
      const item = { ...field.item, key: field.key } as Field
      const set = (row: number, next: Value): void => onChange(rows.map((entry, at) => (at === row ? next : entry)))
      return (
        <fieldset className="space-y-3 rounded-lg border p-3 sm:col-span-2">
          <legend className="flex items-center gap-2 px-1 text-sm font-medium">
            {field.label}
            {field.required ? <span className="text-destructive" aria-hidden>*</span> : null}
            {tier == null ? null : <TierBadge tier={tier} />}
          </legend>
          {field.help == null ? null : <p className="text-xs text-muted-foreground">{field.help}</p>}
          <FindingLines findings={context.findings.get(pointer)} problems={context.problems.get(pointer)} />
          {rows.map((entry, row) => (
            <div key={row} className="space-y-2 rounded-md border border-dashed p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {field.itemLabel[0].toUpperCase() + field.itemLabel.slice(1)} {row + 1}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange(rows.filter((_, at) => at !== row))} disabled={disabled}>
                  Remove
                </Button>
              </div>
              {item.kind === 'group' ? (
                <>
                  <FindingLines findings={context.findings.get(`${pointer}/${row}`)} problems={context.problems.get(`${pointer}/${row}`)} />
                  <GroupFields field={item} value={entry} onChange={(next) => set(row, next)} pointer={`${pointer}/${row}`} context={context} />
                </>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <FieldView field={{ ...item, label: `${field.itemLabel[0].toUpperCase() + field.itemLabel.slice(1)} ${row + 1}` } as Field} value={entry} onChange={(next) => set(row, next)} pointer={`${pointer}/${row}`} context={context} />
                </div>
              )}
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, undefined])} disabled={disabled}>
            Add {rows.length === 0 ? 'a' : 'another'} {field.itemLabel}
          </Button>
        </fieldset>
      )
    }
  }
}

function GroupFields({ field, value, onChange, pointer, context }: { field: GroupField; value: Value; onChange: (value: Value) => void; pointer: string; context: FieldContext }) {
  const group = (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}) as { [key: string]: Value }
  const nodeId = group[NODE_ID]
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {typeof nodeId !== 'string' ? null : (
        // A loaded document gave this node an identifier. It is kept and can be edited; the form never makes one up.
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${idOf(pointer)}-id`}>Identifier</Label>
          <Input id={`${idOf(pointer)}-id`} value={nodeId} onChange={(e) => onChange({ ...group, [NODE_ID]: e.target.value })} disabled={context.disabled} spellCheck={false} />
        </div>
      )}
      {field.fields.map((child) =>
        child.kind === 'fixed' ? null : <FieldView key={child.key} field={child} value={group[child.key]} onChange={(next) => onChange({ ...group, [child.key]: next })} pointer={`${pointer}/${escapePointer(child.key)}`} context={context} />
      )}
    </div>
  )
}
