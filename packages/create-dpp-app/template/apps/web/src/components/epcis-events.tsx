// EPCIS events on a page: the notice that says what they are, one list of
// the events that name an identifier, and the box an outcome is shown in.
//
// Everything here is supplied data. No badge on an event is green: a "valid"
// document passed a check of its format and is not signed, and the list must
// not look like the passport's own evidence, which is checked against the
// chain.
import { Download } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ErrorNotice, Loading, Mono, ToneBadge, ValueView } from '@/components/bits'
import { api } from '@/lib/api'
import { SUPPLIED_DATA_NOTICE, extensionMembers, originalPath, provenanceLabel, validityLabel, type Described, type EpcisEventEntry } from '@/lib/epcis'
import { formatTime, humanise } from '@/lib/format'
import { useLoad } from '@/lib/use-load'

export function SuppliedDataNotice() {
  return (
    <Alert>
      <AlertTitle>Supplied data. Not signed, and not verified.</AlertTitle>
      <AlertDescription>
        <p>{SUPPLIED_DATA_NOTICE}</p>
      </AlertDescription>
    </Alert>
  )
}

/** An outcome in words: a title, a tone and the sentences under it. */
export function DescribedBox({ described }: { described: Described }) {
  return (
    <div className="space-y-2 rounded-lg border p-4" role="status">
      <div className="flex flex-wrap items-center gap-2">
        <ToneBadge tone={described.tone}>{described.title}</ToneBadge>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {described.lines.map((line, i) => (
          <li key={i} className="break-words">
            {line}
          </li>
        ))}
      </ul>
    </div>
  )
}

function EventRow({ entry }: { entry: EpcisEventEntry }) {
  const validity = validityLabel(entry.source.documentValidity)
  const extensions = extensionMembers(entry)
  const { association, event, source } = entry
  return (
    <li className="space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{association.eventType}</span>
        <ToneBadge tone="muted">{humanise(association.role)}</ToneBadge>
        <ToneBadge tone={validity.tone}>{validity.label}</ToneBadge>
        {association.errorDeclared ? <ToneBadge tone="warn">Declared an error by its source</ToneBadge> : null}
        {event?.conflict == null ? null : <ToneBadge tone="warn">{event.conflict.state === 'open' ? 'Another body is held under this identifier' : 'Conflict decided'}</ToneBadge>}
        <span className="text-muted-foreground">{formatTime(association.eventTime)}</span>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[10rem_1fr]">
        <dt className="text-muted-foreground">Source</dt>
        <dd className="min-w-0">
          <Mono>{source.sourceId}</Mono>
          <span className="text-muted-foreground"> · {provenanceLabel(source.provenance)} · received {formatTime(source.receivedAt)}</span>
        </dd>
        <dt className="text-muted-foreground">Event identifier</dt>
        <dd className="min-w-0">{event == null ? <span className="text-muted-foreground">not recorded</span> : event.identityKind === 'event-id' ? <Mono>{event.identity}</Mono> : <span className="text-muted-foreground">The event declares none. A local identity was assigned on import.</span>}</dd>
        {association.quantity == null ? null : (
          <>
            <dt className="text-muted-foreground">Quantity</dt>
            <dd>
              {association.quantity} {association.uom ?? ''}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Original</dt>
        <dd>
          <a href={originalPath(source.importId)} download className="inline-flex items-center gap-1 underline underline-offset-4">
            <Download className="size-3.5" aria-hidden />
            Download the document as received
          </a>
        </dd>
      </dl>
      {extensions.length === 0 ? null : (
        <div className="space-y-1">
          <p className="text-muted-foreground">Extension members. They are outside the EPCIS schema, kept as received and not interpreted.</p>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[10rem_1fr]">
            {extensions.map((member) => (
              <div key={member.name} className="contents">
                <dt>
                  <Mono>{member.name}</Mono>
                </dt>
                <dd className="min-w-0">{member.held ? <ValueView value={member.value} /> : <span className="text-muted-foreground">Named by the import record. Its value is in the original.</span>}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </li>
  )
}

export function EpcisEventList({ entries }: { entries: EpcisEventEntry[] }) {
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">No retained event names this identifier.</p>
  return (
    <ul className="divide-y rounded-lg border">
      {entries.map((entry, i) => (
        <EventRow key={`${entry.source.importId}-${entry.association.pointer}-${entry.association.role}-${i}`} entry={entry} />
      ))}
    </ul>
  )
}

/** The events that name each of the identifiers given, searched exactly as written. */
export function EventsNaming({ identifiers, granularity = 'instance' }: { identifiers: string[]; granularity?: 'instance' | 'class' }) {
  const found = useLoad(async () => (await Promise.all(identifiers.map((identifier) => api.epcisEvents(identifier, granularity)))).flatMap((answer) => answer.events), [identifiers.join('\n'), granularity])
  if (found.loading) return <Loading what="Looking for events" />
  if (found.error != null || found.data == null) return <ErrorNotice error={found.error ?? new Error('no answer')} title="Could not look for events" />
  return <EpcisEventList entries={found.data} />
}
