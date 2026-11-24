// The lifecycle claims of one passport, on the public reading and on the
// brand's page alike: EPCIS lifecycle claims with each finding on its own
// line, and historical native claims, labelled as historical, apart from
// them. No claim gets an overall verdict, and an anchor is never shown as
// proof of the event, of ownership or of compliance.
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Mono, ToneBadge, ValueView } from '@/components/bits'
import { formatTime, humanise } from '@/lib/format'
import { HISTORICAL_LABEL, HISTORICAL_NOTICE, LIFECYCLE_NOTICE, correctionLabel, findingRows, participationLabel, roleWords, type LifecycleClaimView, type PassportClaimsReading, type RegistryAnswer } from '@/lib/lifecycle'

function Registry({ answer }: { answer?: RegistryAnswer }) {
  if (answer == null) return <span className="text-muted-foreground">Not sent to a registry.</span>
  return (
    <span>
      <ToneBadge tone={answer.accepted ? 'neutral' : 'fail'}>{answer.accepted ? 'Accepted by the registry' : `Registry answered HTTP ${answer.status}`}</ToneBadge>
      {answer.detail == null ? null : <span className="ml-2 text-muted-foreground">{answer.detail}</span>}
    </span>
  )
}

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

function LifecycleClaimItem({ claim, passportId, onDeclareError }: { claim: LifecycleClaimView; passportId: string; onDeclareError?: (claim: LifecycleClaimView) => void }) {
  const participation = participationLabel(claim)
  const correction = correctionLabel(claim)
  const event = claim.event ?? {}
  const others = claim.boundPassports.filter((passportId) => !claim.bindingsHere.some((b) => b.passportId === passportId))
  const canDeclare = onDeclareError != null && claim.record != null && !claim.declaresError && claim.findings?.correction.status !== 'declared-in-error'
  return (
    <li className="space-y-3 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{claim.eventType ?? 'EPCIS lifecycle claim'}</span>
        {text(event.bizStep) == null ? null : <ToneBadge tone="muted">{humanise(text(event.bizStep)!)}</ToneBadge>}
        {text(event.action) == null ? null : <ToneBadge tone="muted">{text(event.action)}</ToneBadge>}
        <ToneBadge tone={participation.tone}>{participation.label}</ToneBadge>
        {correction == null ? null : <ToneBadge tone={correction.tone}>{correction.label}</ToneBadge>}
        {text(event.eventTime) == null ? null : <span className="text-muted-foreground">{formatTime(text(event.eventTime)!)}</span>}
      </div>
      <p className="text-muted-foreground">{participation.sentence}</p>
      {!claim.held ? (
        <p>
          The claim <Mono>{claim.attestationId}</Mono> could not be read: {claim.unavailable}
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">Signed by</dt>
            <dd className="min-w-0">
              <Mono>{claim.issuer}</Mono> <span className="text-muted-foreground">{roleWords(claim.assertedRole)}</span>
            </dd>
            <dt className="text-muted-foreground">Event identifier</dt>
            <dd className="min-w-0">
              <Mono>{claim.eventId}</Mono>
            </dd>
            <dt className="text-muted-foreground">Bound here by</dt>
            <dd className="min-w-0">
              {claim.bindingsHere.length === 0 ? (
                <span className="text-muted-foreground">No binding names this passport.</span>
              ) : (
                claim.bindingsHere.map((binding) => (
                  <div key={`${binding.field}-${binding.identifier}`}>
                    <Mono>{binding.identifier}</Mono>
                    <span className="text-muted-foreground">
                      {' '}
                      in {binding.field}, {binding.level === 'class' ? 'a class of products' : 'one item'}, {binding.status}
                    </span>
                  </div>
                ))
              )}
            </dd>
            <dt className="text-muted-foreground">Other passports</dt>
            <dd>{others.length === 0 ? 'None' : `${others.length} passport${others.length === 1 ? '' : 's'} bound by the same event`}</dd>
            {claim.authorityScope == null ? null : (
              <>
                <dt className="text-muted-foreground">Declared role scope</dt>
                <dd className="min-w-0">
                  <p>{claim.authorityScope.includes(passportId) ? 'The issuer declares this role for this passport.' : 'This passport is outside the issuer’s declared role scope.'}</p>
                  <ul>{claim.authorityScope.map((id) => <li key={id}><Mono>{id}</Mono></li>)}</ul>
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Found</dt>
            <dd>{claim.foundBy.map((how) => (how === 'anchor' ? 'by an anchor naming this passport' : "among this application's claims")).join(' and ')}</dd>
            {claim.source == null ? null : (
              <>
                <dt className="text-muted-foreground">Source</dt>
                <dd>
                  Imported, from a document with SHA-256 <Mono>{String(claim.source.sourceDigest)}</Mono>. The issuer reports an event someone else supplied.
                </dd>
              </>
            )}
            {claim.record == null ? null : (
              <>
                <dt className="text-muted-foreground">Registry</dt>
                <dd>
                  <Registry answer={claim.record.registry} />
                </dd>
              </>
            )}
          </dl>
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer">Findings, one by one</summary>
            {claim.findings == null ? null : (
              <ul className="mt-3 divide-y">
                {findingRows(claim.findings).map((row) => (
                  <li key={row.key} className="grid gap-1 py-2 sm:grid-cols-[9rem_8rem_1fr] sm:gap-3">
                    <span>{row.key === 'authority' ? 'Authority for declared scope' : row.label}</span>
                    <span>
                      <ToneBadge tone={row.tone}>{humanise(row.status)}</ToneBadge>
                    </span>
                    <span className="text-muted-foreground">{row.sentence}</span>
                  </li>
                ))}
              </ul>
            )}
          </details>
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer">The signed event</summary>
            <div className="mt-3">
              <ValueView value={claim.event} />
            </div>
          </details>
          <div className="flex flex-wrap items-center gap-3">
            {claim.record == null ? null : (
              <a href={`/api/lifecycle-claims/${encodeURIComponent(claim.attestationId)}`} download className="inline-flex items-center gap-1 underline underline-offset-4">
                <Download className="size-3.5" aria-hidden />
                Download the signed claim
              </a>
            )}
            {canDeclare ? (
              <Button variant="outline" size="sm" onClick={() => onDeclareError(claim)}>
                Declare in error
              </Button>
            ) : null}
          </div>
        </>
      )}
    </li>
  )
}

export function LifecycleClaims({ reading, onDeclareError, emptyText }: { reading: PassportClaimsReading; onDeclareError?: (claim: LifecycleClaimView) => void; emptyText?: string }) {
  const incomplete = reading.discovery.index !== 'asked' || reading.discovery.relatedClaims === 'incomplete'
  if (reading.lifecycle.length === 0 && reading.historical.length === 0) {
    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>{!incomplete ? (emptyText ?? 'No lifecycle claim was found for this passport.') : 'No lifecycle claim was found in the available records.'}</p>
        {incomplete ? <p>Claim discovery was incomplete. Additional claims may exist.</p> : null}
      </div>
    )
  }
  return (
    <div className="space-y-6">
      {incomplete ? <p className="text-sm text-muted-foreground">Claim discovery was incomplete. This list shows the claims found so far.</p> : null}
      {reading.lifecycle.length === 0 ? null : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{LIFECYCLE_NOTICE}</p>
          <ul className="divide-y rounded-lg border">
            {reading.lifecycle.map((claim) => (
              <LifecycleClaimItem key={claim.attestationId} claim={claim} passportId={reading.passportId} onDeclareError={onDeclareError} />
            ))}
          </ul>
        </div>
      )}
      {reading.historical.length === 0 ? null : (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">{HISTORICAL_LABEL}s</h3>
          <p className="text-sm text-muted-foreground">{HISTORICAL_NOTICE}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Historical category</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Issued by</TableHead>
                <TableHead>Signature</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reading.historical.map((claim) => (
                <TableRow key={claim.id}>
                  <TableCell>
                    {claim.claim.eventType} <ToneBadge tone="muted">{HISTORICAL_LABEL}</ToneBadge>
                  </TableCell>
                  <TableCell>{formatTime(claim.claim.timestamp)}</TableCell>
                  <TableCell>{claim.issuedBy}</TableCell>
                  <TableCell>
                    <ToneBadge tone={claim.signature === 'verified' ? 'pass' : 'fail'}>{claim.signature}</ToneBadge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
