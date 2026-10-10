import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { CopyButton, DefinitionList, ErrorNotice, Field, Loading, Mono, PageTitle, ToneBadge, ValueView, statusTone } from '@/components/bits'
import { api, type AcceptResult, type OfferView } from '@/lib/api'
import { formatTime, humanise, publicPathOf } from '@/lib/format'
import { useLoad } from '@/lib/use-load'

export function Accept() {
  const { requestId = '' } = useParams()
  const offer = useLoad(() => api.offer(requestId), [requestId])
  const [claimCode, setClaimCode] = useState('')
  const [busy, setBusy] = useState<'accept' | 'decline'>()
  const [error, setError] = useState<unknown>()
  const [accepted, setAccepted] = useState<AcceptResult>()
  const [declined, setDeclined] = useState<OfferView>()

  if (offer.loading) return <Loading what="Loading the offer" />
  if (offer.error != null || offer.data == null) return <ErrorNotice error={offer.error ?? new Error('no answer')} title="Could not load the offer" />
  const preview = offer.data
  const publicPath = publicPathOf(preview.passportId)
  const open = preview.status === 'open' && accepted == null && declined == null
  const { word, note, ...otherTerms } = preview.terms

  async function act(kind: 'accept' | 'decline') {
    setBusy(kind)
    setError(undefined)
    try {
      if (kind === 'accept') setAccepted(await api.acceptOffer(requestId, claimCode.trim()))
      else setDeclined(await api.declineOffer(requestId, claimCode.trim()))
      offer.reload()
    } catch (cause) {
      setError(cause)
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <PageTitle title="A passport is offered to you" description={<Mono>{preview.passportId}</Mono>} />
      <DefinitionList
        entries={[
          ['Terms', <span key="w" className="font-medium">{String(word ?? '')}</span>],
          ...(typeof note === 'string' && note !== '' ? [['Note', note] as [string, string]] : []),
          ...Object.entries(otherTerms).map(([k, v]) => [humanise(k), <ValueView key={k} value={v} />] as [string, ReactNode]),
          ['Expires', formatTime(preview.expiresAt)],
          ['Status', <ToneBadge key="s" tone={statusTone(preview.status)}>{preview.status}</ToneBadge>],
        ]}
      />

      {accepted != null ? (
        <Card className="border-emerald-300 dark:border-emerald-800">
          <CardHeader>
            <CardTitle>Accepted</CardTitle>
            <CardDescription>The transfer was written.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Transfer txid">
              <span className="flex items-center gap-2">
                <Mono>{accepted.transferTxid}</Mono>
                <CopyButton text={accepted.transferTxid} label="Copy the txid" />
              </span>
            </Field>
            <p className="text-sm">You now hold this passport. Keep your claim code: it is how you act on the passport from here, including handing it on or retiring it.</p>
            {publicPath == null ? null : (
              <Button asChild variant="outline">
                <Link to={publicPath}>Open the passport page</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : declined != null ? (
        <Card>
          <CardHeader>
            <CardTitle>Declined</CardTitle>
            <CardDescription>Nothing was written. The offer is closed.</CardDescription>
          </CardHeader>
        </Card>
      ) : !open ? (
        <p className="text-sm text-muted-foreground">This offer is {preview.status}; nothing can be done with it.</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Your claim code</CardTitle>
            <CardDescription>The code the current holder gave you. Accepting writes the transfer to you; declining writes nothing.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Claim code" htmlFor="claimCode" required>
              <Input id="claimCode" value={claimCode} onChange={(e) => setClaimCode(e.target.value)} autoComplete="off" spellCheck={false} />
            </Field>
            {error == null ? null : <ErrorNotice error={error} title="Refused" />}
            <div className="flex gap-2">
              <Button onClick={() => act('accept')} disabled={busy != null || claimCode.trim() === ''}>
                {busy === 'accept' ? 'Working' : 'Accept'}
              </Button>
              <Button variant="outline" onClick={() => act('decline')} disabled={busy != null || claimCode.trim() === ''}>
                {busy === 'decline' ? 'Working' : 'Decline'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
