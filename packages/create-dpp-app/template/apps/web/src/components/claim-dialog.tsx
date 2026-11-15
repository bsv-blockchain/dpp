// Signing an EPCIS lifecycle claim from the brand's page: from an event the
// member enters, or from an event the EPCIS exchange retained, and declaring
// one of this application's claims in error. Signing is one step, done with
// the member's managed identity; sending to the registry, which anchors the
// claim once per bound passport, is a second step the member ticks.
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ErrorNotice, Field, Loading, Mono, ToneBadge } from '@/components/bits'
import { api, type IssueClaimRequest } from '@/lib/api'
import { passportSpellings } from '@/lib/epcis'
import { formatTime } from '@/lib/format'
import { EVENT_FIELDS, LIFECYCLE_ACTIONS, LIFECYCLE_EVENT_TYPES, LIFECYCLE_ROLES, SUGGESTED_BUSINESS_STEPS, SUGGESTED_DISPOSITIONS, emptyEventForm, eventFromForm, findingRows, participationLabel, roleWords, type LifecycleClaimView, type LifecycleEventForm, type LifecycleEventType } from '@/lib/lifecycle'
import { useLoad } from '@/lib/use-load'

function Outcome({ claim, onClose }: { claim: LifecycleClaimView; onClose: () => void }) {
  const participation = participationLabel(claim)
  return (
    <div className="space-y-4 text-sm">
      <p>
        Signed. The claim is <Mono>{claim.attestationId}</Mono>. <ToneBadge tone={participation.tone}>{participation.label}</ToneBadge>
      </p>
      {claim.record?.registry == null ? <p className="text-muted-foreground">It was not sent to a registry, so nothing anchors it yet.</p> : <p>The registry answered HTTP {claim.record.registry.status}{claim.record.registry.detail == null ? '' : `: ${claim.record.registry.detail}`}.</p>}
      {claim.findings == null ? null : (
        <ul className="divide-y rounded-md border">
          {findingRows(claim.findings).map((row) => (
            <li key={row.key} className="flex flex-wrap items-center gap-2 p-2">
              <span className="w-32">{row.label}</span>
              <ToneBadge tone={row.tone}>{row.status}</ToneBadge>
            </li>
          ))}
        </ul>
      )}
      <DialogFooter>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </div>
  )
}

function RoleFields({ role, setRole, party, setParty, imported }: { role: string; setRole: (role: string) => void; party: string; setParty: (party: string) => void; imported: boolean }) {
  const roles = LIFECYCLE_ROLES.filter((r) => !(imported && r === 'observer'))
  return (
    <>
      <Field label="You sign" htmlFor="claim-role" required help={imported ? 'An imported event was observed by whoever supplied it, so it is never signed as the observer.' : 'Your signature says which key signed. It does not show that you hold the role: nothing here supports that, and the claim says so.'}>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger id="claim-role" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roles.map((r) => (
              <SelectItem key={r} value={r}>
                {roleWords(r)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {role === 'owner' || role === 'custodian' ? (
        <Field label="Your party identifier" htmlFor="claim-party" help="The party the event's owning or possessing roles name as you, such as a PGLN.">
          <Input id="claim-party" value={party} onChange={(e) => setParty(e.target.value)} spellCheck={false} />
        </Field>
      ) : null}
    </>
  )
}

const LIST_LABELS: Record<string, string> = { epcList: 'Objects', childEPCs: 'Contents or components', inputEPCList: 'Inputs', outputEPCList: 'Outputs', quantityList: 'Quantities', childQuantityList: 'Content quantities', inputQuantityList: 'Input quantities', outputQuantityList: 'Output quantities' }

function EventFields({ form, setForm }: { form: LifecycleEventForm; setForm: (form: LifecycleEventForm) => void }) {
  const shape = EVENT_FIELDS[form.type]
  const set = (key: keyof LifecycleEventForm) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Event type" htmlFor="ev-type" required>
        <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as LifecycleEventType })}>
          <SelectTrigger id="ev-type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIFECYCLE_EVENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {shape.action ? (
        <Field label="Action" htmlFor="ev-action" required>
          <Select value={form.action} onValueChange={(v) => setForm({ ...form, action: v })}>
            <SelectTrigger id="ev-action" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIFECYCLE_ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : (
        <p className="self-end text-xs text-muted-foreground">A transformation has no action.</p>
      )}
      <Field label="Event identifier" htmlFor="ev-id" required help="The event's own eventID. Keep the one your capture system gave it.">
        <Input id="ev-id" value={form.eventID} onChange={set('eventID')} spellCheck={false} />
      </Field>
      <Field label="Event time" htmlFor="ev-time" required help="When it happened, ISO 8601 with a timezone.">
        <Input id="ev-time" value={form.eventTime} onChange={set('eventTime')} spellCheck={false} />
      </Field>
      <Field label="Timezone offset" htmlFor="ev-tz" required>
        <Input id="ev-tz" value={form.eventTimeZoneOffset} onChange={set('eventTimeZoneOffset')} spellCheck={false} />
      </Field>
      <Field label="Business step" htmlFor="ev-step" help="A CBV 2.0 business step, or an extension URI.">
        <Input id="ev-step" list="ev-steps" value={form.bizStep} onChange={set('bizStep')} spellCheck={false} />
        <datalist id="ev-steps">
          {SUGGESTED_BUSINESS_STEPS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>
      <Field label="Disposition" htmlFor="ev-disp">
        <Input id="ev-disp" list="ev-disps" value={form.disposition} onChange={set('disposition')} spellCheck={false} />
        <datalist id="ev-disps">
          {SUGGESTED_DISPOSITIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>
      {shape.parent ? (
        <Field label="Parent" htmlFor="ev-parent" help="The container, assembly or parent object, by its identifier.">
          <Input id="ev-parent" value={form.parentID} onChange={set('parentID')} spellCheck={false} />
        </Field>
      ) : null}
      {shape.lists.map((list) => (
        <Field key={list} label={LIST_LABELS[list]} htmlFor={`ev-${list}`} help="One identifier per line, exactly as written.">
          <Textarea id={`ev-${list}`} rows={2} value={form[list]} onChange={set(list)} spellCheck={false} />
        </Field>
      ))}
      {shape.quantities.map((list) => (
        <Field key={list} label={LIST_LABELS[list]} htmlFor={`ev-${list}`} help="One per line: a class identifier, then a quantity and a unit code if known. A class never says which items took part.">
          <Textarea id={`ev-${list}`} rows={2} value={form[list]} onChange={set(list)} spellCheck={false} />
        </Field>
      ))}
      <Field label="Read point" htmlFor="ev-rp">
        <Input id="ev-rp" value={form.readPoint} onChange={set('readPoint')} spellCheck={false} />
      </Field>
      <Field label="Business location" htmlFor="ev-bl">
        <Input id="ev-bl" value={form.bizLocation} onChange={set('bizLocation')} spellCheck={false} />
      </Field>
      <Field label="Sources" htmlFor="ev-src" help="One per line: owning_party, possessing_party or location, then the party or place.">
        <Textarea id="ev-src" rows={2} value={form.sourceList} onChange={set('sourceList')} spellCheck={false} />
      </Field>
      <Field label="Destinations" htmlFor="ev-dst" help="The same form. Possession and ownership are separate roles.">
        <Textarea id="ev-dst" rows={2} value={form.destinationList} onChange={set('destinationList')} spellCheck={false} />
      </Field>
      <Field label="Business transactions" htmlFor="ev-btx" help="One per line: a type such as po, then its identifier.">
        <Textarea id="ev-btx" rows={2} value={form.bizTransactionList} onChange={set('bizTransactionList')} spellCheck={false} />
      </Field>
      {shape.transformationID ? (
        <Field label="Transformation identifier" htmlFor="ev-tid">
          <Input id="ev-tid" value={form.transformationID} onChange={set('transformationID')} spellCheck={false} />
        </Field>
      ) : null}
      <div className="sm:col-span-2">
        <Field label="Sensor elements" htmlFor="ev-sensors" help="EPCIS JSON, a list of sensor elements, exactly as it is to be signed.">
          <Textarea id="ev-sensors" rows={3} value={form.sensorElementList} onChange={set('sensorElementList')} spellCheck={false} className="font-mono text-xs" />
        </Field>
      </div>
    </div>
  )
}

function RetainedEvents({ passportId, chosen, setChosen }: { passportId: string; chosen?: string; setChosen: (key: string, imported: { importId: string; pointer: string }) => void }) {
  const found = useLoad(async () => (await Promise.all(passportSpellings(passportId).map((identifier) => api.epcisEvents(identifier, 'instance')))).flatMap((answer) => answer.events), [passportId])
  if (found.loading) return <Loading what="Looking for retained events" />
  if (found.error != null || found.data == null) return <ErrorNotice error={found.error ?? new Error('no answer')} title="Could not look for retained events" />
  if (found.data.length === 0) return <p className="text-sm text-muted-foreground">The EPCIS exchange retains no event that names this passport. Import one on the Events page.</p>
  return (
    <ul className="divide-y rounded-md border text-sm">
      {found.data.map((entry) => {
        const key = `${entry.source.importId} ${entry.association.pointer}`
        return (
          <li key={`${key} ${entry.association.role}`} className="p-2">
            <label className="flex items-start gap-2">
              <input type="radio" name="retained" checked={chosen === key} onChange={() => setChosen(key, { importId: entry.source.importId, pointer: entry.association.pointer })} />
              <span>
                <span className="font-medium">{entry.association.eventType}</span> {entry.association.eventTime == null ? null : <span className="text-muted-foreground">{formatTime(entry.association.eventTime)}</span>}
                <span className="block text-xs text-muted-foreground">
                  From {entry.source.sourceId}, received {formatTime(entry.source.receivedAt)}. {entry.event?.eventId == null ? 'It declares no eventID and cannot be signed.' : entry.event.eventId}
                </span>
              </span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}

export function ClaimDialog({ passportId, onClose, onDone }: { passportId: string; onClose: () => void; onDone: () => void }) {
  const [tab, setTab] = useState<'enter' | 'retained'>('enter')
  const [form, setForm] = useState<LifecycleEventForm>(() => emptyEventForm(passportId))
  const [role, setRole] = useState<string>('observer')
  const [party, setParty] = useState('')
  const [chosen, setChosen] = useState<{ key: string; imported: { importId: string; pointer: string } }>()
  const [submitToRegistry, setSubmitToRegistry] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const [result, setResult] = useState<LifecycleClaimView>()
  const built = eventFromForm(form)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(undefined)
    let body: IssueClaimRequest
    if (tab === 'retained') {
      if (chosen == null) return setError(new Error('choose a retained event'))
      body = { imported: chosen.imported }
    } else {
      if ('problems' in built) return setError(new Error(built.problems.join('; ')))
      body = { event: built.event }
    }
    const signedRole = tab === 'retained' && role === 'observer' ? 'authorised-reporter' : role
    setBusy(true)
    try {
      setResult(await api.issueClaim(passportId, { ...body, assertedRole: signedRole, ...(party.trim() === '' ? {} : { issuerParty: party.trim() }), ...(submitToRegistry ? { submit: true } : {}) }))
      onDone()
    } catch (cause) {
      setError(cause)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Sign a lifecycle claim</DialogTitle>
          <DialogDescription>One EPCIS event that happened, signed with your identity and bound to every passport whose product it names. It never spends a passport, and it is never made from a passport operation, an edit or a sale label.</DialogDescription>
        </DialogHeader>
        {result != null ? (
          <Outcome claim={result} onClose={onClose} />
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Tabs value={tab} onValueChange={(v) => setTab(v as 'enter' | 'retained')}>
              <TabsList>
                <TabsTrigger value="enter">Enter the event</TabsTrigger>
                <TabsTrigger value="retained">A retained event</TabsTrigger>
              </TabsList>
              <TabsContent value="enter" className="space-y-3 pt-3">
                <EventFields form={form} setForm={setForm} />
                <details className="rounded-md border p-3 text-sm">
                  <summary className="cursor-pointer">The event as it will be signed</summary>
                  <pre className="mt-2 overflow-x-auto text-xs">{'event' in built ? JSON.stringify(built.event, null, 2) : built.problems.join('\n')}</pre>
                </details>
              </TabsContent>
              <TabsContent value="retained" className="space-y-3 pt-3">
                <p className="text-sm text-muted-foreground">The event is signed exactly as it was received, with a link to the import it came from. You report it; you did not observe it.</p>
                <RetainedEvents passportId={passportId} chosen={chosen?.key} setChosen={(key, imported) => setChosen({ key, imported })} />
              </TabsContent>
            </Tabs>
            <RoleFields role={tab === 'retained' && role === 'observer' ? 'authorised-reporter' : role} setRole={setRole} party={party} setParty={setParty} imported={tab === 'retained'} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={submitToRegistry} onChange={(e) => setSubmitToRegistry(e.target.checked)} />
              Then send it to the registry, which anchors it once for each bound passport
            </label>
            {error == null ? null : <ErrorNotice error={error} title="The claim was refused" />}
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                {busy ? 'Working' : 'Sign the claim'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function DeclareErrorDialog({ passportId, claim, onClose, onDone }: { passportId: string; claim: LifecycleClaimView; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState<'incorrect_data' | 'did_not_occur'>('incorrect_data')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const [result, setResult] = useState<LifecycleClaimView>()

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      setResult(await api.issueClaim(passportId, { correctionOf: claim.attestationId, reason }))
      onDone()
    } catch (cause) {
      setError(cause)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Declare the event in error</DialogTitle>
          <DialogDescription>A new claim, signed by you, that carries the same event with an EPCIS error declaration. The original claim stays exactly as it was signed. Only a declaration by the original's issuer is shown as declaring it in error.</DialogDescription>
        </DialogHeader>
        {result != null ? (
          <Outcome claim={result} onClose={onClose} />
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm">
              Event <Mono>{claim.eventId}</Mono>
            </p>
            <Field label="Reason" htmlFor="declare-reason">
              <Select value={reason} onValueChange={(v) => setReason(v as 'incorrect_data' | 'did_not_occur')}>
                <SelectTrigger id="declare-reason" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="incorrect_data">The event's data is incorrect</SelectItem>
                  <SelectItem value="did_not_occur">The event did not occur</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {error == null ? null : <ErrorNotice error={error} title="The declaration was refused" />}
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                {busy ? 'Working' : 'Sign the declaration'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
