import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CopyButton, ErrorNotice, Loading, Mono, PageTitle, Section, ToneBadge, statusTone } from '@/components/bits'
import { RequireAccount } from '@/components/layout'
import { api, passportRef } from '@/lib/api'
import { formatTime, publicPathOf, shortTxid } from '@/lib/format'
import { useLoad } from '@/lib/use-load'

export function Operations() {
  return (
    <RequireAccount>
      <OperationsPage />
    </RequireAccount>
  )
}

function OperationsPage() {
  const ops = useLoad(() => api.operations(), [])
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState<string[]>()
  const [runError, setRunError] = useState<unknown>()

  async function run() {
    setRunning(true)
    setRunError(undefined)
    try {
      const answer = await api.runOperations()
      setDone(answer.done)
      ops.reload()
    } catch (cause) {
      setRunError(cause)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-10">
      <PageTitle
        title="Operations"
        description="What the worker still owes: announcing a state again, fetching its proof once mined, and pushing that proof to the index. The worker runs on its own; Run now does one pass here."
        action={
          <Button onClick={run} disabled={running}>
            {running ? 'Running' : 'Run now'}
          </Button>
        }
      />
      {runError == null ? null : <ErrorNotice error={runError} title="The run failed" />}
      {done == null ? null : (
        <div className="rounded-lg border p-4">
          <p className="mb-2 text-sm font-medium">Last run</p>
          {done.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing was owed.</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 font-mono text-xs">
              {done.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {ops.loading ? (
        <Loading what="Loading the duties" />
      ) : ops.error != null || ops.data == null ? (
        <ErrorNotice error={ops.error ?? new Error('no answer')} title="Could not load the operations" />
      ) : (
        <>
          <Section title="Duties">
            {ops.data.duties.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing is owed.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Passport</TableHead>
                    <TableHead>Op</TableHead>
                    <TableHead>Duty</TableHead>
                    <TableHead>Since</TableHead>
                    <TableHead>Txid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ops.data.duties.map((duty) => (
                    <TableRow key={`${duty.txid}-${duty.duty}`}>
                      <TableCell>
                        <Link to={`/passports/${passportRef(duty.passportId)}`} className="font-mono text-xs underline-offset-4 hover:underline">
                          {publicPathOf(duty.passportId) ?? duty.passportId}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <ToneBadge tone="neutral">{duty.op}</ToneBadge>
                      </TableCell>
                      <TableCell>{duty.duty}</TableCell>
                      <TableCell>{formatTime(duty.since)}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1">
                          <Mono>{shortTxid(duty.txid)}</Mono>
                          <CopyButton text={duty.txid} label="Copy the txid" />
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
          <Section title="Passports">
            {ops.data.passports.length === 0 ? (
              <p className="text-sm text-muted-foreground">No passports in the journal.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Passport</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">States</TableHead>
                    <TableHead className="text-right">Proven</TableHead>
                    <TableHead className="text-right">Pending</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ops.data.passports.map((p) => (
                    <TableRow key={p.passportId}>
                      <TableCell>
                        <Link to={`/passports/${passportRef(p.passportId)}`} className="font-mono text-xs underline-offset-4 hover:underline">
                          {publicPathOf(p.passportId) ?? p.passportId}
                        </Link>
                      </TableCell>
                      <TableCell>{p.brandId}</TableCell>
                      <TableCell>
                        <ToneBadge tone={statusTone(p.status)}>{p.status}</ToneBadge>
                      </TableCell>
                      <TableCell className="text-right">{p.journal.states}</TableCell>
                      <TableCell className="text-right">{p.journal.proven}</TableCell>
                      <TableCell className="text-right">{p.journal.pending}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        </>
      )}
    </div>
  )
}
