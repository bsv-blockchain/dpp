// The product-data form a profile describes: one control per field, chosen
// from the field's valueType, grouped as the manifest groups them. Public
// fields go to the payload; every other tier goes to the owner fields the
// API encrypts off chain. The same form issues and updates.
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ErrorNotice, Field } from '@/components/bits'
import type { Profile, ProfileField } from '@/lib/api'
import { humanise } from '@/lib/format'

export interface PassportFormValues {
  payload: Record<string, unknown>
  ownerFields: Record<string, unknown>
}

interface Props {
  profile: Profile
  /** Where the values start: the sample for a new passport, the current payload for an update. */
  initial: { payload: Record<string, unknown>; ownerFields?: Record<string, unknown> }
  submitLabel: string
  busy?: boolean
  error?: unknown
  onSubmit: (values: PassportFormValues) => void
  /** Rendered inside the form before the product fields, for the identifier inputs. */
  before?: ReactNode
  /** Rendered after the product fields, for a claim code or a note. */
  after?: ReactNode
}

type Control = 'text' | 'textarea' | 'number' | 'select' | 'date' | 'url' | 'json'

function controlFor(field: ProfileField): Control {
  if (field.cardinality === 'many' || field.valueType === 'record' || field.valueType === 'multi' || field.valueType === 'any') return 'json'
  switch (field.valueType) {
    case 'decimal':
    case 'integer':
    case 'percent':
      return 'number'
    case 'enum':
      return field.codeList != null && field.codeList.options.length > 0 ? 'select' : 'text'
    case 'date':
      return 'date'
    case 'url':
    case 'document':
    case 'graphic':
      return 'url'
    default:
      return (field.constraints?.maxLength ?? 0) > 200 ? 'textarea' : 'text'
  }
}

function placeholderFor(field: ProfileField): string | undefined {
  if (field.constraints?.patternHint != null) return field.constraints.patternHint
  if (field.valueType === 'monthYear') return 'YYYY-MM'
  if (field.valueType === 'country') return 'Two-letter country code, for example AU'
  if (field.valueType === 'url' || field.valueType === 'document' || field.valueType === 'graphic') return 'https://'
  return undefined
}

const initialText = (field: ProfileField, value: unknown): string => {
  if (value === undefined || value === null) return ''
  if (controlFor(field) === 'json') return JSON.stringify(value, null, 2)
  return typeof value === 'string' ? value : String(value)
}

export function PassportForm({ profile, initial, submitLabel, busy, error, onSubmit, before, after }: Props) {
  const fields = profile.fields
  const fieldKeys = useMemo(() => new Set(fields.map((f) => f.key)), [fields])
  const [showOptional, setShowOptional] = useState(false)
  const [localError, setLocalError] = useState<string>()
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const field of fields) {
      const source = field.accessTier === 'public' ? initial.payload : (initial.ownerFields ?? {})
      if (field.key in source) out[field.key] = initialText(field, source[field.key])
    }
    return out
  })

  const groups = useMemo(() => {
    const map = new Map<string, ProfileField[]>()
    for (const field of fields) {
      const group = field.group ?? 'other'
      if (!map.has(group)) map.set(group, [])
      map.get(group)!.push(field)
    }
    return [...map.entries()]
  }, [fields])

  const optionalCount = fields.filter((f) => f.obligation === 'optional').length
  const notice = typeof initial.payload.notice === 'string' ? initial.payload.notice : undefined
  const set = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }))

  function submit(event: FormEvent) {
    event.preventDefault()
    setLocalError(undefined)
    const payload: Record<string, unknown> = {}
    const ownerFields: Record<string, unknown> = {}
    // Stamps and the notice are not fields; they are carried as they came.
    for (const [key, value] of Object.entries(initial.payload)) if (!fieldKeys.has(key)) payload[key] = value
    for (const field of fields) {
      const raw = draft[field.key] ?? ''
      if (raw.trim() === '') continue
      let value: unknown
      const control = controlFor(field)
      if (control === 'number') {
        value = Number(raw)
        if (Number.isNaN(value)) {
          setLocalError(`${field.label} must be a number.`)
          return
        }
      } else if (control === 'json') {
        try {
          value = JSON.parse(raw)
        } catch (cause) {
          setLocalError(`${field.label} must be valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`)
          return
        }
      } else {
        value = raw
      }
      ;(field.accessTier === 'public' ? payload : ownerFields)[field.key] = value
    }
    onSubmit({ payload, ownerFields })
  }

  return (
    <form onSubmit={submit} className="space-y-8">
      {notice == null ? null : (
        <Alert>
          <AlertTitle>Demonstration prefix</AlertTitle>
          <AlertDescription>
            <p>This platform issues under the GS1 demonstration prefix, so every passport carries this notice first: "{notice}"</p>
          </AlertDescription>
        </Alert>
      )}
      {before}
      {groups.map(([group, groupFields]) => {
        const shown = groupFields.filter((f) => f.obligation !== 'optional' || showOptional)
        if (shown.length === 0) return null
        return (
          <fieldset key={group} className="space-y-4">
            <legend className="mb-3 text-base font-semibold">{humanise(group)}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {shown.map((field) => (
                <FieldControl key={field.key} field={field} value={draft[field.key] ?? ''} onChange={(v) => set(field.key, v)} />
              ))}
            </div>
          </fieldset>
        )
      })}
      {optionalCount > 0 ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showOptional} onChange={(e) => setShowOptional(e.target.checked)} />
          Show {optionalCount} optional {optionalCount === 1 ? 'field' : 'fields'}
        </label>
      ) : null}
      {after}
      {localError == null ? null : <ErrorNotice error={new Error(localError)} title="Check the form" />}
      {error == null ? null : <ErrorNotice error={error} title="The API refused it" />}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? 'Working' : submitLabel}
        </Button>
        <span className="text-xs text-muted-foreground">
          <span className="text-destructive">*</span> required by the profile
        </span>
      </div>
    </form>
  )
}

function FieldControl({ field, value, onChange }: { field: ProfileField; value: string; onChange: (value: string) => void }) {
  const control = controlFor(field)
  const id = `field-${field.key}`
  const required = field.obligation === 'required'
  const tier = field.accessTier === 'public' ? undefined : `${humanise(field.accessTier)} tier, encrypted off chain`
  const help = [field.note, tier, field.obligation === 'recommended' ? 'Recommended' : undefined].filter((h): h is string => h != null).join('. ')
  const label = field.unit == null ? field.label : `${field.label} (${field.unit})`
  const wide = control === 'json' || control === 'textarea'

  let input: ReactNode
  if (control === 'select' && field.codeList != null) {
    const options = [...field.codeList.options]
    if (value !== '' && !options.some((o) => o.value === value)) options.unshift({ value, label: value })
    input = (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full" aria-required={required}>
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  } else if (control === 'json') {
    input = <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} required={required} className="min-h-28 font-mono text-xs" spellCheck={false} placeholder="JSON" />
  } else if (control === 'textarea') {
    input = <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} required={required} maxLength={field.constraints?.maxLength} />
  } else if (control === 'number') {
    input = (
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        min={field.constraints?.minimum}
        max={field.constraints?.maximum}
        step={field.constraints?.step ?? (field.valueType === 'integer' ? 1 : 'any')}
      />
    )
  } else {
    input = (
      <Input
        id={id}
        type={control === 'date' ? 'date' : control === 'url' ? 'url' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        maxLength={field.constraints?.maxLength}
        pattern={field.constraints?.pattern}
        placeholder={placeholderFor(field)}
      />
    )
  }

  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <Field label={label} htmlFor={id} required={required} help={help === '' ? undefined : help}>
        {input}
      </Field>
    </div>
  )
}
