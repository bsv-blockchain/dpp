// EPCIS events: upload a document, pull from a configured source, find the
// events that name an identifier, and download what was received.
//
// Everything on this page is data a source supplied. Nothing here signs,
// issues or changes a passport, and the page says so wherever an outcome is
// shown.
import { Fragment, useState, type FormEvent } from 'react'
import { Download } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { ErrorNotice, Field, Loading, Mono, PageTitle, Section, ToneBadge } from '@/components/bits'
import { DescribedBox, EventsNaming, SuppliedDataNotice } from '@/components/epcis-events'
import { RequireAccount } from '@/components/layout'
import { ApiError, api } from '@/lib/api'
import {
  countsLine,
  describePull,
  describePullRefusal,
  describeRefusal,
  describeRetained,
  describeSource,
  eventCounts,
  findingsOf,
  latestFirst,
  mediaTypeOf,
  originalPath,
  provenanceLabel,
  queryFromForm,
  validityLabel,
  type Described,
  type EpcisImportRecord,
  type EpcisImportSummary,
  type EpcisSource,
} from '@/lib/epcis'
import { formatTime } from '@/lib/format'
import { useLoad } from '@/lib/use-load'

export function Events() {
  return (
    <RequireAccount>
      <EventsPage />
    </RequireAccount>
  )
}

/** An identifier for one upload. It stays with the chosen file, so sending the file again is the same request and is kept once. */
const newRequestId = (): string => `upload-${crypto.randomUUID()}`

/** An error the API did not describe is shown as it is. */
const unexpected = (cause: unknown, what: string): Described => ({ tone: 'fail', title: what, lines: [cause instanceof Error ? cause.message : String(cause)] })

function EventsPage() {
  const status = useLoad(() => api.epcisStatus(), [])
  const imports = useLoad(async () => latestFirst((await api.epcisImports()).imports), [])

  return (
    <div className="space-y-10">
      <PageTitle
        title="Events"
        description="EPCIS events this application holds: documents you upload, and pages pulled from a source your server is configured for. An import keeps the exact bytes it was given. It signs nothing and changes no passport."
      />
      <SuppliedDataNotice />
      {status.data?.artefacts.state === 'unavailable' ? (
        <Alert variant="destructive">
          <AlertTitle>Imports and pulls are refused until the GS1 files are provided</AlertTitle>
          <AlertDescription>
            <p>
              Documents are checked against the EPCIS files GS1 publishes, and this server does not have them in <Mono>{status.data.artefacts.dir}</Mono>. {status.data.artefacts.remedy}
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
      {status.data?.storage === 'memory' ? <p className="text-sm text-muted-foreground">Without MongoDB, what is imported here is held in memory and is gone when the API stops.</p> : null}

      <Upload onDone={imports.reload} />
      <Pull sources={status.data?.sources} loading={status.loading} error={status.error} onDone={imports.reload} />
      <Find />

      <Section title="Imports">
        {imports.loading ? (
          <Loading what="Loading the imports" />
        ) : imports.error != null || imports.data == null ? (
          <ErrorNotice error={imports.error ?? new Error('no answer')} title="Could not load the imports" />
        ) : imports.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing has been imported.</p>
        ) : (
          <ImportTable imports={imports.data} />
        )}
      </Section>
    </div>
  )
}

function Upload({ onDone }: { onDone: () => void }) {
  const [file, setFile] = useState<File>()
  const [requestId, setRequestId] = useState('')
  const [sourceId, setSourceId] = useState('upload')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Described>()
  const [record, setRecord] = useState<EpcisImportRecord>()

  function choose(chosen: File | undefined) {
    setFile(chosen)
    setOutcome(undefined)
    setRecord(undefined)
    // A new file is a new request. The same file sent again keeps the identifier it was given here.
    setRequestId(chosen == null ? '' : newRequestId())
  }

  async function send(event: FormEvent) {
    event.preventDefault()
    if (file == null) return
    setBusy(true)
    setOutcome(undefined)
    setRecord(undefined)
    try {
      const answer = await api.epcisImport(file, { requestId, mediaType: mediaTypeOf(file), sourceId: sourceId.trim(), filename: file.name })
      setOutcome(describeRetained(answer))
      setRecord(answer.record)
      onDone()
    } catch (cause) {
      setOutcome(cause instanceof ApiError ? describeRefusal(cause) : unexpected(cause, 'The upload did not reach the API. Send it again: it is the same request.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Upload a document">
      <form onSubmit={send} className="grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <Field label="EPCIS 2.0 document" htmlFor="epcis-file" help="A JSON or JSON-LD file. It is sent and kept as the bytes it is.">
          <Input id="epcis-file" type="file" accept=".json,.jsonld,application/json,application/ld+json" onChange={(event) => choose(event.target.files?.[0])} />
        </Field>
        <Field label="Source name" htmlFor="epcis-source" help="Events are filed under it. Two sources are never merged.">
          <Input id="epcis-source" value={sourceId} onChange={(event) => setSourceId(event.target.value)} />
        </Field>
        <Button type="submit" disabled={file == null || busy}>
          {busy ? 'Uploading' : 'Upload'}
        </Button>
      </form>
      {outcome == null ? null : <DescribedBox described={outcome} />}
      {record == null ? null : <ImportFindings record={record} />}
    </Section>
  )
}

function Pull({ sources, loading, error, onDone }: { sources: EpcisSource[] | undefined; loading: boolean; error: Error | undefined; onDone: () => void }) {
  const [sourceId, setSourceId] = useState<string>()
  const [queryId, setQueryId] = useState('default')
  const [form, setForm] = useState({ identifiers: '', eventTypes: '', eventIds: '', from: '', until: '', perPage: '' })
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Described>()
  const selected = sources?.find((source) => source.sourceId === (sourceId ?? sources[0]?.sourceId))

  async function run(event: FormEvent) {
    event.preventDefault()
    if (selected == null) return
    setBusy(true)
    setOutcome(undefined)
    try {
      setOutcome(describePull(await api.epcisPull(selected.sourceId, { queryId: queryId.trim(), query: queryFromForm(form) })))
      onDone()
    } catch (cause) {
      setOutcome(cause instanceof ApiError ? describePullRefusal(cause) : unexpected(cause, 'The request did not reach the API'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Pull from a source">
      {loading ? (
        <Loading what="Loading the sources" />
      ) : error != null || sources == null ? (
        <ErrorNotice error={error ?? new Error('no answer')} title="Could not load the sources" />
      ) : sources.length === 0 || selected == null ? (
        <p className="text-sm text-muted-foreground">
          No source is configured. A source is set on the server, in <Mono>.env</Mono>: its name in <Mono>EPCIS_SOURCES</Mono>, then its address and, if it needs one, its credential. The README says how.
        </p>
      ) : (
        <form onSubmit={run} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Source" htmlFor="pull-source">
              <Select value={selected.sourceId} onValueChange={setSourceId}>
                <SelectTrigger id="pull-source" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((source) => (
                    <SelectItem key={source.sourceId} value={source.sourceId}>
                      {source.sourceId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Query name" htmlFor="pull-query" help="A later run under the same name continues this query from where it stopped. The same name with other filters is refused.">
              <Input id="pull-query" value={queryId} onChange={(event) => setQueryId(event.target.value)} required />
            </Field>
          </div>
          <div className="space-y-1 rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Mono>{selected.sourceId}</Mono>
              {selected.localTest ? <ToneBadge tone="warn">Local test</ToneBadge> : null}
              {selected.problem == null ? null : <ToneBadge tone="fail">Cannot be pulled from</ToneBadge>}
            </div>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {describeSource(selected).map((line, i) => (
                <li key={i} className="break-words">
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Product identifiers" htmlFor="pull-identifiers" help="One a line, exactly as the source writes them. Empty asks for every event.">
              <Textarea id="pull-identifiers" rows={2} value={form.identifiers} onChange={(event) => setForm({ ...form, identifiers: event.target.value })} />
            </Field>
            <Field label="Event types" htmlFor="pull-types" help="Such as ObjectEvent, one a line. Empty asks for every type.">
              <Textarea id="pull-types" rows={2} value={form.eventTypes} onChange={(event) => setForm({ ...form, eventTypes: event.target.value })} />
            </Field>
            <Field label="Event time from" htmlFor="pull-from" help="A date and time with a zone, such as 2026-03-02T08:00:00Z.">
              <Input id="pull-from" value={form.from} onChange={(event) => setForm({ ...form, from: event.target.value })} />
            </Field>
            <Field label="Event time until" htmlFor="pull-until">
              <Input id="pull-until" value={form.until} onChange={(event) => setForm({ ...form, until: event.target.value })} />
            </Field>
            <Field label="Events a page" htmlFor="pull-per-page" help="Empty uses the limit in force.">
              <Input id="pull-per-page" inputMode="numeric" value={form.perPage} onChange={(event) => setForm({ ...form, perPage: event.target.value })} />
            </Field>
          </div>
          <Button type="submit" disabled={busy || queryId.trim() === ''}>
            {busy ? 'Pulling' : 'Run one pull'}
          </Button>
          <p className="text-xs text-muted-foreground">One run reads a bounded number of pages and then stops. Run it again to continue.</p>
        </form>
      )}
      {outcome == null ? null : <DescribedBox described={outcome} />}
    </Section>
  )
}

function Find() {
  const [text, setText] = useState('')
  const [granularity, setGranularity] = useState<'instance' | 'class'>('instance')
  const [asked, setAsked] = useState<{ identifier: string; granularity: 'instance' | 'class' }>()

  function find(event: FormEvent) {
    event.preventDefault()
    if (text.trim() !== '') setAsked({ identifier: text.trim(), granularity })
  }

  return (
    <Section title="Events that name an identifier">
      <form onSubmit={find} className="grid gap-4 sm:grid-cols-[3fr_1fr_auto] sm:items-end">
        <Field label="Identifier" htmlFor="find-identifier" help="Exactly as events write it. Another spelling of the same product is another search.">
          <Input id="find-identifier" value={text} onChange={(event) => setText(event.target.value)} placeholder="urn:epc:id:sgtin:9521234.012345.SER1" />
        </Field>
        <Field label="Names" htmlFor="find-granularity">
          <Select value={granularity} onValueChange={(value) => setGranularity(value === 'class' ? 'class' : 'instance')}>
            <SelectTrigger id="find-granularity" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="instance">One item</SelectItem>
              <SelectItem value="class">A class or a lot</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Button type="submit" variant="outline" disabled={text.trim() === ''}>
          Find
        </Button>
      </form>
      {asked == null ? null : <EventsNaming identifiers={[asked.identifier]} granularity={asked.granularity} />}
    </Section>
  )
}

function ImportTable({ imports }: { imports: EpcisImportSummary[] }) {
  const [open, setOpen] = useState<string>()
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Received</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Format check</TableHead>
          <TableHead className="text-right">Events</TableHead>
          <TableHead className="text-right">Findings</TableHead>
          <TableHead className="text-right">Bytes</TableHead>
          <TableHead>Original</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {imports.map((entry) => {
          const validity = validityLabel(entry.documentValidity)
          return (
            <Fragment key={entry.importId}>
              <TableRow>
                <TableCell>{formatTime(entry.receivedAt)}</TableCell>
                <TableCell className="whitespace-normal">
                  <Mono>{entry.sourceId}</Mono>
                  <div className="text-xs text-muted-foreground">{provenanceLabel(entry.provenance)}</div>
                </TableCell>
                <TableCell>
                  <ToneBadge tone={validity.tone}>{validity.label}</ToneBadge>
                  {entry.conflicts > 0 ? (
                    <ToneBadge tone="warn" className="ml-1">
                      {entry.conflicts} in conflict
                    </ToneBadge>
                  ) : null}
                </TableCell>
                <TableCell className="text-right">{entry.events}</TableCell>
                <TableCell className="text-right">{entry.findings}</TableCell>
                <TableCell className="text-right">{entry.byteLength}</TableCell>
                <TableCell>
                  <a href={originalPath(entry.importId)} download className="inline-flex items-center gap-1 text-sm underline underline-offset-4">
                    <Download className="size-3.5" aria-hidden />
                    Download
                  </a>
                </TableCell>
                <TableCell className="text-right">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(open === entry.importId ? undefined : entry.importId)} aria-expanded={open === entry.importId}>
                    {open === entry.importId ? 'Hide' : 'Findings'}
                  </Button>
                </TableCell>
              </TableRow>
              {open === entry.importId ? (
                <TableRow>
                  <TableCell colSpan={8} className="whitespace-normal">
                    <ImportDetail importId={entry.importId} />
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          )
        })}
      </TableBody>
    </Table>
  )
}

function ImportDetail({ importId }: { importId: string }) {
  const record = useLoad(() => api.epcisImportRecord(importId), [importId])
  if (record.loading) return <Loading what="Loading the import" />
  if (record.error != null || record.data == null) return <ErrorNotice error={record.error ?? new Error('no answer')} title="Could not load the import" />
  return <ImportFindings record={record.data} />
}

function ImportFindings({ record }: { record: EpcisImportRecord }) {
  const findings = findingsOf(record)
  return (
    <div className="space-y-2 py-2 text-sm">
      <p>
        <span className="text-muted-foreground">SHA-256 of the bytes as received </span>
        <Mono>{record.sha256}</Mono>
      </p>
      <p>{countsLine(eventCounts(record))}</p>
      {record.preservedExtensions.length === 0 ? null : (
        <p>
          <span className="text-muted-foreground">Document members outside the EPCIS schema, kept as received: </span>
          <Mono>{record.preservedExtensions.join(', ')}</Mono>
        </p>
      )}
      {findings.length === 0 ? (
        <p className="text-muted-foreground">No findings.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {findings.map((finding, i) => (
            <li key={i} className="space-y-1 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <ToneBadge tone={finding.severity === 'error' ? 'fail' : finding.severity === 'warning' ? 'warn' : 'muted'}>{finding.severity}</ToneBadge>
                <Mono>{finding.code}</Mono>
                {finding.path === '' ? null : <Mono className="text-muted-foreground">{finding.path}</Mono>}
              </div>
              <p className="break-words">{finding.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
