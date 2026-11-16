// The form for a passport under a profile held by a binding. The user
// enters one product document; the API validates the whole of it, splits it
// by the binding's list into a public part and a restricted part, signs
// only the public part and seals the rest.
//
// What the page is careful about:
//
//   - the GTIN and serial are entered once, as the passport identifier's
//     own parts, and the document's identity members are written from them;
//   - every top-level property shows whether it will be public or
//     restricted, before anything is sent, and the user confirms the public
//     list under a warning that public means permanent;
//   - a field left empty is absent from the document;
//   - what the validator finds is shown at the field it concerns.
//
// A profile with no sector form here, such as a profile of your own, is
// written as a JSON document, with the same labelling and the same warning.
import { useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ErrorNotice, Field as Labelled, Mono } from '@/components/bits'
import { FieldView, type FieldContext } from '@/components/bound/field-view'
import { FindingLines, PublicDataWarning, TierBadge, ViewPanel } from '@/components/bound/pieces'
import { ApiError, api, type BoundProfile, type Finding, type ViewCheck } from '@/lib/api'
import { humaniseName } from '@/lib/bound/display'
import { buildDocument, codeClasses, emptyState, escapePointer, fieldPointerFor, isObject, labelsOf, parseDocument, splitPreview, stripComments, tierOf, type FormState, type Json, type Value } from '@/lib/bound/form-model'
import { sectorFormFor } from '@/lib/bound/forms'
import { identityFromDocument, mintIdentity, type IdentifierPolicy } from '@/lib/bound/identity'
import { useLoad } from '@/lib/use-load'

export interface BoundSubmission {
  itemReference: string
  serial: string
  product: Json
}

interface Props {
  profile: BoundProfile
  policy: IdentifierPolicy
  /** For an update: the passport's identifier, which cannot change. */
  passportId?: string
  /** For an update: the document as it stands, to start from. */
  initialProduct?: Json
  submitLabel: string
  busy?: boolean
  error?: unknown
  onSubmit: (submission: BoundSubmission) => void
  after?: ReactNode
}

interface Attempt {
  state: FormState
  rows: Map<string, number[]>
}

const IDENTITY = '/~identity'
const OTHERS = '/~others'

export function BoundPassportForm({ profile, policy, passportId, initialProduct, submitLabel, busy, error, onSubmit, after }: Props) {
  const form = sectorFormFor(profile.id)
  const fixed = passportId == null ? undefined : identityFromDocument(policy, passportId)
  const [itemReference, setItemReference] = useState(fixed != null && 'itemReference' in fixed ? fixed.itemReference : '')
  const [serial, setSerial] = useState(fixed != null && 'serial' in fixed ? fixed.serial : '')
  const [state, setState] = useState<FormState>(() => (form != null && initialProduct != null ? parseDocument(form, initialProduct).state : emptyState()))
  // Other properties, and for a profile with no sector form the whole document, are edited as JSON text.
  const [othersText, setOthersText] = useState(() => (form != null && initialProduct != null ? jsonText(parseDocument(form, initialProduct).state.others) : ''))
  const [documentText, setDocumentText] = useState(() => (form == null && initialProduct != null ? JSON.stringify(initialProduct, null, 2) : ''))
  const [confirmed, setConfirmed] = useState(false)
  const [loadNote, setLoadNote] = useState<string>()
  const [attempt, setAttempt] = useState<Attempt>()
  const codes = useLoad(() => (form == null ? Promise.resolve({}) : api.profileCodes(profile.id, codeClasses(form))), [profile.id])

  const identity = mintIdentity(policy, itemReference.trim(), serial.trim())
  const contexts = useMemo(() => (form == null ? [] : form.contexts.map((path) => profile.contexts.find((context) => context.path === path)?.uri).filter((uri): uri is string => uri != null)), [form, profile.contexts])
  const others = useMemo(() => parseObject(othersText), [othersText])
  const written = useMemo(() => parseObject(documentText), [documentText])

  // The document as it would be sent now, and what stops it.
  const built = useMemo(() => {
    if (!identity.ok) return undefined
    if (form == null) return written.ok && written.value != null ? { product: written.value, problems: [], rows: new Map<string, number[]>() } : undefined
    return buildDocument(form, { ...state, others: others.ok ? (others.value ?? {}) : {} }, identity, contexts)
    // The identity is rebuilt on every render; its parts are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, state, others, written, contexts, identity.ok, identity.ok ? identity.passportId : ''])
  const preview = built == null ? undefined : splitPreview(built.product, profile.access)
  const labels = useMemo(() => (form == null ? new Map<string, string>() : labelsOf(form)), [form])

  // The validation of the last refused attempt, with each finding at the field it concerns.
  const refusal = error instanceof ApiError ? error.details : undefined
  const validation = (refusal?.publicView ?? refusal?.validation) as ViewCheck | undefined
  const { placed, unplaced } = useMemo(() => {
    const placed = new Map<string, Finding[]>()
    const unplaced: Finding[] = []
    for (const finding of validation?.findings ?? []) {
      const at = form == null || attempt == null || finding.pointer == null ? undefined : fieldPointerFor(form, attempt.state, attempt.rows, finding.pointer)
      if (at == null) unplaced.push(finding)
      else placed.set(at, [...(placed.get(at) ?? []), finding])
    }
    return { placed, unplaced }
  }, [validation, form, attempt])
  const problems = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const problem of built?.problems ?? []) map.set(problem.pointer, [...(map.get(problem.pointer) ?? []), problem.message])
    return map
  }, [built])

  const engineDown = !profile.engine.available
  const jsonProblem = form == null ? (written.ok ? (written.value == null ? 'Enter the product document.' : undefined) : written.problem) : others.ok ? undefined : others.problem
  const blocked = !identity.ok || built == null || built.problems.length > 0 || jsonProblem != null || engineDown
  const context: FieldContext = { codes: codes.data ?? {}, findings: placed, problems, disabled: busy }

  function load(product: Json, source: string) {
    const clean = stripComments(product)
    const removed = JSON.stringify(product).includes('"_comment') ? ' Its note members, which the profile does not define, were removed.' : ''
    setConfirmed(false)
    setAttempt(undefined)
    if (passportId == null) {
      const named = identityFromDocument(policy, [clean.id, clean['@id']].find((value): value is string => typeof value === 'string'))
      if ('problem' in named) {
        setLoadNote(`${source} was not loaded. ${named.problem}`)
        return
      }
      setItemReference(named.itemReference)
      setSerial(named.serial)
    }
    if (form == null) {
      setDocumentText(JSON.stringify(clean, null, 2))
      setLoadNote(`${source} was loaded.${removed}`)
      return
    }
    const parsed = parseDocument(form, clean)
    setState(parsed.state)
    setOthersText(jsonText(parsed.state.others))
    setLoadNote(
      `${source} was loaded.${removed} ${parsed.kept.length === 0 ? 'Every property is in a field of the form.' : `${parsed.kept.length} ${parsed.kept.length === 1 ? 'property is' : 'properties are'} kept as JSON under Other properties, because the form has no field that holds ${parsed.kept.length === 1 ? 'it' : 'them'} exactly: ${parsed.kept.join(', ')}.`}`
    )
  }

  async function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file == null) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!isObject(parsed)) throw new Error('it is not one JSON object')
      load(parsed, file.name)
    } catch (cause) {
      setLoadNote(`${file.name} was not loaded: ${cause instanceof Error ? cause.message : String(cause)}.`)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (blocked || built == null || !identity.ok || !confirmed) return
    setAttempt({ state: { ...state, others: others.ok ? (others.value ?? {}) : {} }, rows: built.rows })
    onSubmit({ itemReference: itemReference.trim(), serial: serial.trim(), product: built.product })
  }

  const setValue = (key: string, value: Value): void => {
    setState((current) => ({ ...current, values: { ...current.values, [key]: value } }))
    setConfirmed(false)
  }
  const digits = Math.max(0, 12 - policy.prefix.length)

  return (
    <form onSubmit={submit} className="space-y-8">
      {engineDown ? (
        <Alert variant="destructive">
          <AlertTitle>This profile cannot be written yet</AlertTitle>
          <AlertDescription>
            <p>The validation engine is not available, and a document that was not validated is never written. {profile.engine.problem}</p>
          </AlertDescription>
        </Alert>
      ) : null}
      {profile.demonstration ? (
        <Alert>
          <AlertTitle>Demonstration prefix</AlertTitle>
          <AlertDescription>
            <p>This platform issues under the GS1 demonstration prefix, so the API writes a notice first in every payload, saying the record describes no real product.</p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {profile.examples.map((example) => (
          <Button key={example.title} type="button" variant="outline" size="sm" onClick={() => load(example.product, `The example "${example.title}"`)} disabled={busy}>
            Load example: {example.title}
          </Button>
        ))}
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
          Load a document from a file
          <input type="file" accept=".json,.jsonld,application/json,application/ld+json" className="sr-only" onChange={loadFile} disabled={busy} />
        </label>
      </div>
      {loadNote == null ? null : <p className="text-sm text-muted-foreground">{loadNote}</p>}
      {codes.error == null ? null : <p className="text-sm text-muted-foreground">The profile's code lists could not be loaded ({codes.error.message}). A coded value can still be typed, exactly as the profile's vocabulary spells it.</p>}

      <fieldset className="space-y-4">
        <legend className="mb-3 text-base font-semibold">Identifier</legend>
        <p className="text-sm text-muted-foreground">
          The GTIN and the serial are entered once, here. They make the passport identifier, and the document's own identifier, GTIN and serial are written from them, so the two cannot disagree. All of them are public.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Labelled label="Item reference" htmlFor="itemReference" required help={`The digits after the GS1 prefix ${policy.prefix}: ${digits} digits.`}>
            <Input id="itemReference" value={itemReference} onChange={(e) => setItemReference(e.target.value)} required inputMode="numeric" pattern="[0-9]+" placeholder={'0'.repeat(digits)} disabled={busy || passportId != null} />
          </Labelled>
          <Labelled label="Serial" htmlFor="serial" required help="The item's serial, 1 to 20 characters.">
            <Input id="serial" value={serial} onChange={(e) => setSerial(e.target.value)} required maxLength={20} disabled={busy || passportId != null} spellCheck={false} />
          </Labelled>
        </div>
        {identity.ok ? (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">Passport identifier</dt>
            <dd>
              <Mono>{identity.passportId}</Mono>
            </dd>
            <dt className="text-muted-foreground">GTIN</dt>
            <dd>
              <Mono>{identity.gtin}</Mono>
            </dd>
            {form == null ? null : (
              <>
                <dt className="text-muted-foreground">Granularity</dt>
                <dd>{state.granularity ? 'Item: one passport for one serialised item, as the identifier says.' : 'Not stated in the loaded document.'}</dd>
              </>
            )}
          </dl>
        ) : itemReference === '' && serial === '' ? null : (
          <p className="text-sm text-destructive">{identity.problem}</p>
        )}
        <FindingLines findings={placed.get(IDENTITY)} />
      </fieldset>

      {form == null ? (
        <JsonDocument profile={profile} identity={identity.ok ? identity.passportId : undefined} text={documentText} onChange={(text) => (setDocumentText(text), setConfirmed(false))} problem={documentText === '' ? undefined : jsonProblem} disabled={busy} />
      ) : (
        <>
          {form.sections.map((section) => (
            <fieldset key={section.title} className="space-y-4">
              <legend className="mb-1 text-base font-semibold">{section.title}</legend>
              {section.description == null ? null : <p className="text-sm text-muted-foreground">{section.description}</p>}
              <div className="grid gap-4 sm:grid-cols-2">
                {section.fields.map((field) => (
                  <FieldView key={field.key} field={field} value={state.values[field.key]} onChange={(value) => setValue(field.key, value)} pointer={`/${escapePointer(field.key)}`} context={context} tier={tierOf(profile.access, field.key)} />
                ))}
              </div>
            </fieldset>
          ))}
          <fieldset className="space-y-2">
            <legend className="mb-1 text-base font-semibold">Other properties</legend>
            <p className="text-sm text-muted-foreground">Properties of the profile this form has no field for, as one JSON object. They are written exactly as they are here. A property the binding does not list as public is restricted.</p>
            <Textarea value={othersText} onChange={(e) => (setOthersText(e.target.value), setConfirmed(false))} className="min-h-24 font-mono text-xs" spellCheck={false} placeholder="{ }" aria-label="Other properties, as JSON" disabled={busy} />
            <FindingLines findings={placed.get(OTHERS)} problems={[...(others.ok ? [] : [others.problem]), ...(problems.get(OTHERS) ?? [])]} />
          </fieldset>
        </>
      )}

      <section className="space-y-4">
        <h2 className="text-base font-semibold">Before you write it</h2>
        <PublicDataWarning split={profile.access != null} />
        {preview == null ? (
          <p className="text-sm text-muted-foreground">Enter the identifier{form == null ? ' and the document' : ''} to see what will be public.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <TierList tier="public" title="Public, on chain for good" names={preview.public} labels={labels} empty="Nothing." />
            <TierList tier="restricted" title="Restricted, sealed off chain for the holder" names={preview.restricted} labels={labels} empty={profile.access == null ? 'This profile has no restricted part.' : 'Nothing.'} />
          </div>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={blocked || busy} />
          <span>I have read the public list. Nothing in it, and nothing its values repeat or link to, has to stay private.</span>
        </label>
      </section>

      {after}
      {built != null && built.problems.length > 0 ? (
        <ErrorNotice error={new Error(`${built.problems.length} ${built.problems.length === 1 ? 'field needs' : 'fields need'} attention before the document can be built. Each is marked above.`)} title="Check the form" />
      ) : null}
      {error == null ? null : <ErrorNotice error={error} title="The API refused it" />}
      {validation == null ? null : (
        <ViewPanel title={validation.view === 'public' ? 'The public part on its own' : 'The whole document'} check={validation}>
          {unplaced.length === 0 || form == null ? null : <p className="text-xs text-muted-foreground">Findings that name a field are shown at that field. The ones listed here could not be placed.</p>}
        </ViewPanel>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || blocked || !confirmed}>
          {busy ? 'Working' : submitLabel}
        </Button>
        <span className="text-xs text-muted-foreground">
          <span className="text-destructive">*</span> the profile's rules require it
        </span>
      </div>
    </form>
  )
}

const jsonText = (value: Json): string => (Object.keys(value).length === 0 ? '' : JSON.stringify(value, null, 2))

/** JSON text as one object: nothing for empty text, a problem for anything that is not an object. */
function parseObject(text: string): { ok: true; value?: Json } | { ok: false; problem: string } {
  if (text.trim() === '') return { ok: true }
  try {
    const parsed: unknown = JSON.parse(text)
    return isObject(parsed) ? { ok: true, value: parsed } : { ok: false, problem: 'This must be one JSON object.' }
  } catch (cause) {
    return { ok: false, problem: `This is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}` }
  }
}

function TierList({ tier, title, names, labels, empty }: { tier: 'public' | 'restricted'; title: string; names: string[]; labels: Map<string, string>; empty: string }) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <TierBadge tier={tier} />
        {title}
      </div>
      {names.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {names.map((name) => (
            <li key={name} className="flex flex-wrap items-baseline gap-x-2">
              <span>{name === '@context' ? 'Contexts' : name === 'id' || name === '@id' ? 'Identifier' : name === 'type' || name === '@type' ? 'Type' : (labels.get(name) ?? humaniseName(name))}</span>
              <Mono className="text-muted-foreground">{name}</Mono>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The whole product document as JSON, for a profile this application has no form for. */
function JsonDocument({ profile, identity, text, onChange, problem, disabled }: { profile: BoundProfile; identity?: string; text: string; onChange: (text: string) => void; problem?: string; disabled?: boolean }) {
  function insertIdentity() {
    if (identity == null) return
    const parsed = parseObject(text)
    const document: Json = parsed.ok ? (parsed.value ?? {}) : {}
    // Only the identifier just entered goes in. Which contexts the document names, and everything else, is the author's.
    onChange(JSON.stringify({ ...document, id: identity }, null, 2))
  }
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-base font-semibold">Product document</legend>
      <p className="text-sm text-muted-foreground">
        {profile.title} has no form in this application, so its product document is written as JSON, in the profile's own data model. Its identifier must name the same GTIN and serial as the passport identifier above.
      </p>
      <Textarea value={text} onChange={(e) => onChange(e.target.value)} className="min-h-64 font-mono text-xs" spellCheck={false} placeholder="{ }" aria-label="Product document, as JSON" disabled={disabled} />
      {problem == null ? null : <p className="text-xs text-destructive">{problem}</p>}
      {profile.contexts.length === 0 ? null : (
        <p className="text-xs text-muted-foreground">
          A document may name these contexts and no others:{' '}
          {profile.contexts.map((context) => (
            <Mono key={context.uri} className="mr-2">
              {context.uri}
            </Mono>
          ))}
        </p>
      )}
      <Button type="button" variant="outline" size="sm" onClick={insertIdentity} disabled={disabled || identity == null}>
        Put the passport identifier into the document
      </Button>
    </fieldset>
  )
}
