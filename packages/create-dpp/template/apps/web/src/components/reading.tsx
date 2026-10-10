// What a reader sees for one passport: the notice first, the product data,
// the verification report one check per line, then the history and any
// claims. There is no overall verdict on purpose: the report is the sixteen
// answers, and a reader decides what they mean for their own purpose.
import { Link } from 'react-router'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CheckBadge, CopyButton, DefinitionList, ErrorNotice, Mono, Section, ToneBadge, entriesOf } from '@/components/bits'
import type { Check, ClaimView, PassportView, Verification } from '@/lib/api'
import { STAMP_KEYS, formatTime, humanise, isRecord, publicPathOf, shortTxid } from '@/lib/format'

export function ReportChecks({ checks }: { checks: Check[] }) {
  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-lg border">
        {checks.map((check) => (
          <li key={check.name} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <span className="text-sm">{check.label}</span>
            <span className="flex shrink-0 items-center gap-2">
              <CheckBadge status={check.status} />
              {check.reasonCode == null ? null : <Mono className="text-muted-foreground">{check.reasonCode}</Mono>}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">Unknown means the evidence was not available to this reader, not that the check failed.</p>
    </div>
  )
}

interface ReadingProps {
  passportId: string
  verification?: Verification
  verifyError?: unknown
  journal?: PassportView
  claims?: ClaimView[]
  /** Link to the brand's view when this platform's journal holds the passport. */
  manageLink?: boolean
  /** Link to the identifier's own page; off when this is that page. */
  publicLink?: boolean
}

export function PassportReading({ passportId, verification, verifyError, journal, claims, manageLink, publicLink }: ReadingProps) {
  const latestPayload = journal?.payload ?? verification?.lineage.at(-1)?.payloadPublic
  const payload = isRecord(latestPayload) ? latestPayload : undefined
  const notice = typeof payload?.notice === 'string' ? payload.notice : undefined
  const profile = journal?.profile ?? (payload?.profile == null ? undefined : `${String(payload.profile)}@${String(payload.profile_version ?? '')}`)
  const history = verification?.lineage.map((entry) => ({ op: entry.op, txid: entry.txid, timestamp: entry.timestamp })) ?? journal?.states.map((s) => ({ op: s.op, txid: s.txid, timestamp: s.timestamp })) ?? []
  const path = publicPathOf(passportId)

  return (
    <div className="space-y-10">
      {notice == null ? null : (
        <Alert className="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <AlertTitle>Notice</AlertTitle>
          <AlertDescription className="text-current">
            <p className="text-base">{notice}</p>
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Mono className="text-sm">{passportId}</Mono>
          <CopyButton text={passportId} label="Copy the identifier" />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {profile == null ? null : <span>Profile {profile}</span>}
          {journal == null ? null : <ToneBadge tone={journal.status === 'active' ? 'pass' : 'muted'}>{journal.status}</ToneBadge>}
          {journal?.demonstration ? <ToneBadge tone="warn">Demonstration</ToneBadge> : null}
          {journal == null ? <span>Not in this platform's journal; read from the index alone.</span> : null}
        </div>
      </div>

      <Section title="Product">
        {payload == null ? <p className="text-sm text-muted-foreground">No payload was read.</p> : <DefinitionList entries={entriesOf(payload, STAMP_KEYS, humanise)} />}
      </Section>

      <Section title="Verification">
        {verifyError != null ? <ErrorNotice error={verifyError} title="The reader could not verify this passport" /> : null}
        {verification == null ? (
          verifyError == null ? (
            <p className="text-sm text-muted-foreground">No report.</p>
          ) : null
        ) : (
          <>
            <ReportChecks checks={verification.checks} />
            {verification.report.checkedAt == null ? null : <p className="text-xs text-muted-foreground">Checked {formatTime(verification.report.checkedAt)}.</p>}
          </>
        )}
      </Section>

      <Section title="History">
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No states were read.</p>
        ) : (
          <ol className="divide-y rounded-lg border">
            {history.map((entry) => (
              <li key={entry.txid} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex items-center gap-3">
                  <ToneBadge tone="neutral">{entry.op}</ToneBadge>
                  <span className="text-sm">{formatTime(entry.timestamp)}</span>
                </span>
                <span className="flex items-center gap-1">
                  <Mono className="text-muted-foreground">{shortTxid(entry.txid)}</Mono>
                  <CopyButton text={entry.txid} label="Copy the txid" />
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {claims != null && claims.length > 0 ? (
        <Section title="Claims">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Issued by</TableHead>
                <TableHead>Signature</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {claims.map((claim) => (
                <TableRow key={claim.id}>
                  <TableCell>{claim.claim.eventType}</TableCell>
                  <TableCell>{formatTime(claim.claim.timestamp)}</TableCell>
                  <TableCell>{claim.issuedBy}</TableCell>
                  <TableCell>
                    <ToneBadge tone={claim.verified === 'verified' ? 'pass' : 'fail'}>{claim.verified}</ToneBadge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}

      {manageLink && journal != null ? (
        <p className="text-sm">
          <Link to={`/passports/${encodeURIComponent(passportId)}`} className="underline underline-offset-4">
            Open the brand's view
          </Link>
        </p>
      ) : null}
      {publicLink && path != null ? (
        <p className="text-sm">
          <Link to={path} className="underline underline-offset-4">
            Public page
          </Link>
        </p>
      ) : null}
    </div>
  )
}
