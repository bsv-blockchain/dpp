// The brand's view of one passport: what is in the journal, and every action
// on it in a dialog. A passport that was handed on is held by a recipient,
// and every action then needs the claim code they accepted with.
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { CopyButton, DefinitionList, ErrorNotice, Field, Loading, Mono, PageTitle, Section, ToneBadge, YesNo, entriesOf, indexTone, networkTone, statusTone } from '@/components/bits'
import { RequireAccount } from '@/components/layout'
import { PassportForm, type PassportFormValues } from '@/components/passport-form'
import { EVENT_TYPES, api, type ClaimView, type EventType, type OfferView, type PassportView } from '@/lib/api'
import { formatTime, holderLabel, humanise, isRecord, parseIdentifier, passportIdFromRef, publicPathOf, shortKey, shortTxid } from '@/lib/format'
import { useLoad } from '@/lib/use-load'

type DialogKind = 'update' | 'offer' | 'retire' | 'claim'

export function Passport() {
  return (
    <RequireAccount>
      <PassportPage />
    </RequireAccount>
  )
}

function PassportPage() {
  const { ref = '' } = useParams()
  const passportId = passportIdFromRef(ref)
  const passport = useLoad(() => api.passport(passportId), [passportId])
  const offers = useLoad(() => api.passportOffers(passportId), [passportId])
  const claims = useLoad(() => api.passportClaims(passportId), [passportId])
  const [dialog, setDialog] = useState<DialogKind>()

  if (passport.loading) return <Loading what="Loading the passport" />
  if (passport.error != null || passport.data == null) return <ErrorNotice error={passport.error ?? new Error('no answer')} title="Could not load the passport" />

  const view = passport.data
  const needsClaimCode = view.holder.party.startsWith('recipient:')
  const retired = view.status === 'retired'
  const ident = parseIdentifier(view.passportId)
  const publicPath = publicPathOf(view.passportId)
  const close = () => setDialog(undefined)

  return (
    <div className="space-y-10">
      <PageTitle
        title={ident == null ? view.passportId : `Serial ${ident.serial}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {ident == null ? null : <span>GTIN {ident.gtin}</span>}
            <Mono>{view.passportId}</Mono>
            <CopyButton text={view.passportId} label="Copy the identifier" />
          </span>
        }
        action={
          publicPath == null ? null : (
            <Button asChild variant="outline">
              <Link to={publicPath}>Public page</Link>
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <ToneBadge tone={statusTone(view.status)}>{view.status}</ToneBadge>
        {view.demonstration ? <ToneBadge tone="warn">Demonstration</ToneBadge> : null}
        <span className="text-muted-foreground">Profile {view.profile}</span>
        <span className="text-muted-foreground">
          Held by {holderLabel(view.holder.party)} <Mono className="text-muted-foreground">{shortKey(view.holder.controllerKey)}</Mono>
        </span>
        <span className="text-muted-foreground">Issued {formatTime(view.createdAt)}</span>
        <span className="text-muted-foreground">
          Brand{' '}
          <Link to={`/brands/${encodeURIComponent(view.brandId)}`} className="underline underline-offset-4">
            {view.brandId}
          </Link>
        </span>
      </div>

      {needsClaimCode ? (
        <Alert>
          <AlertTitle>Held by a recipient</AlertTitle>
          <AlertDescription>
            <p>This passport was handed on. Every action on it now needs the claim code the recipient accepted with.</p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setDialog('update')} disabled={retired}>
          Update
        </Button>
        <Button variant="outline" onClick={() => setDialog('offer')} disabled={retired}>
          Hand on
        </Button>
        <Button variant="outline" onClick={() => setDialog('retire')} disabled={retired}>
          Retire
        </Button>
        <Button variant="outline" onClick={() => setDialog('claim')}>
          Add a claim
        </Button>
        {retired ? <span className="self-center text-sm text-muted-foreground">Retired: no further state can be written.</span> : null}
      </div>

      <Section title="Public payload">
        <DefinitionList entries={entriesOf(view.payload, new Set(), humanise)} />
      </Section>

      <Section title="Journal">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="States" value={view.journal.states} />
          <Stat label="Proven" value={view.journal.proven} />
          <Stat label="Pending" value={view.journal.pending} />
          <Stat label="Status" value={view.journal.status} />
        </div>
      </Section>

      <Section title="States">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Op</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Index</TableHead>
              <TableHead>Network</TableHead>
              <TableHead>Proven</TableHead>
              <TableHead>Proof pushed</TableHead>
              <TableHead>Block</TableHead>
              <TableHead>Txid</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.states.map((state) => (
              <TableRow key={state.txid}>
                <TableCell>
                  <ToneBadge tone="neutral">{state.op}</ToneBadge>
                </TableCell>
                <TableCell>{formatTime(state.timestamp)}</TableCell>
                <TableCell>{state.actor}</TableCell>
                <TableCell>
                  <ToneBadge tone={indexTone(state.index)}>{state.index}</ToneBadge>
                  {state.refusal == null ? null : <div className="mt-1 max-w-xs whitespace-normal text-xs text-muted-foreground">{state.refusal}</div>}
                </TableCell>
                <TableCell>
                  <ToneBadge tone={networkTone(state.network)}>{state.network}</ToneBadge>
                </TableCell>
                <TableCell>
                  <YesNo value={state.proven} />
                </TableCell>
                <TableCell>
                  <YesNo value={state.proofPushed} />
                </TableCell>
                <TableCell>{state.blockHeight ?? <span className="text-muted-foreground">none</span>}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-1">
                    <Mono>{shortTxid(state.txid)}</Mono>
                    <CopyButton text={state.txid} label="Copy the txid" />
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title="Offers">
        {offers.loading ? (
          <Loading what="Loading the offers" />
        ) : offers.error != null || offers.data == null ? (
          <ErrorNotice error={offers.error ?? new Error('no answer')} title="Could not load the offers" />
        ) : offers.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No offers. Hand on makes one.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Request</TableHead>
                <TableHead>Terms</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Made</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {offers.data.map((offer) => (
                <TableRow key={offer.requestId}>
                  <TableCell>
                    <Mono>{offer.requestId}</Mono>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="font-medium">{String(offer.terms.word ?? '')}</span>
                    {typeof offer.terms.note === 'string' && offer.terms.note !== '' ? <span className="text-muted-foreground"> {offer.terms.note}</span> : null}
                  </TableCell>
                  <TableCell>
                    <ToneBadge tone={statusTone(offer.status)}>{offer.status}</ToneBadge>
                    {offer.transferTxid == null ? null : <div className="mt-1 text-xs text-muted-foreground">{shortTxid(offer.transferTxid)}</div>}
                  </TableCell>
                  <TableCell>{formatTime(offer.createdAt)}</TableCell>
                  <TableCell>{formatTime(offer.expiresAt)}</TableCell>
                  <TableCell className="text-right">{offer.status === 'open' ? <WithdrawButton offer={offer} needsClaimCode={needsClaimCode} onDone={offers.reload} /> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Claims">
        {claims.loading ? (
          <Loading what="Loading the claims" />
        ) : claims.error != null || claims.data == null ? (
          <ErrorNotice error={claims.error ?? new Error('no answer')} title="Could not load the claims" />
        ) : claims.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No claims. A claim is a signed statement about the passport on its own rail; it never spends the passport.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Issued by</TableHead>
                <TableHead>Signature</TableHead>
                <TableHead>Registry</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {claims.data.map((claim) => (
                <TableRow key={claim.id}>
                  <TableCell>
                    {claim.claim.eventType}
                    <div className="text-xs text-muted-foreground">{claim.id}</div>
                  </TableCell>
                  <TableCell>{formatTime(claim.claim.timestamp)}</TableCell>
                  <TableCell>{claim.issuedBy}</TableCell>
                  <TableCell>
                    <ToneBadge tone={claim.verified === 'verified' ? 'pass' : 'fail'}>{claim.verified}</ToneBadge>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <RegistryAnswer claim={claim} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      {dialog === 'update' ? <UpdateDialog passport={view} needsClaimCode={needsClaimCode} onClose={close} onDone={passport.setData} /> : null}
      {dialog === 'offer' ? <HandOnDialog passportId={view.passportId} needsClaimCode={needsClaimCode} onClose={close} onDone={offers.reload} /> : null}
      {dialog === 'retire' ? <RetireDialog passportId={view.passportId} needsClaimCode={needsClaimCode} onClose={close} onDone={passport.setData} /> : null}
      {dialog === 'claim' ? <ClaimDialog passportId={view.passportId} onClose={close} onDone={claims.reload} /> : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  )
}

function RegistryAnswer({ claim }: { claim: ClaimView }) {
  if (claim.registry == null) return <span className="text-muted-foreground">not sent</span>
  return (
    <span className="text-xs">
      <ToneBadge tone={claim.registry.accepted ? 'pass' : 'fail'}>{claim.registry.accepted ? 'accepted' : `HTTP ${claim.registry.status}`}</ToneBadge>
      {claim.registry.attestationId == null ? null : <span className="ml-2 font-mono">{claim.registry.attestationId}</span>}
      {claim.registry.detail == null ? null : <div className="mt-1 text-muted-foreground">{claim.registry.detail}</div>}
    </span>
  )
}

function ClaimCodeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Field label="Claim code" htmlFor="claimCode" required help="The holder acts with the claim code they accepted with.">
      <Input id="claimCode" value={value} onChange={(e) => onChange(e.target.value)} required autoComplete="off" spellCheck={false} />
    </Field>
  )
}

function WithdrawButton({ offer, needsClaimCode, onDone }: { offer: OfferView; needsClaimCode: boolean; onDone: () => void }) {
  const [claimCode, setClaimCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  async function withdraw() {
    setBusy(true)
    setError(undefined)
    try {
      await api.withdrawOffer(offer.requestId, needsClaimCode ? claimCode : undefined)
      onDone()
    } catch (cause) {
      setError(cause)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {needsClaimCode ? <Input value={claimCode} onChange={(e) => setClaimCode(e.target.value)} placeholder="Claim code" className="h-8 w-40" aria-label="Claim code" /> : null}
        <Button variant="outline" size="sm" onClick={withdraw} disabled={busy || (needsClaimCode && claimCode === '')}>
          {busy ? 'Working' : 'Withdraw'}
        </Button>
      </div>
      {error == null ? null : <span className="max-w-xs whitespace-normal text-xs text-destructive">{error instanceof Error ? error.message : String(error)}</span>}
    </div>
  )
}

function UpdateDialog({ passport, needsClaimCode, onClose, onDone }: { passport: PassportView; needsClaimCode: boolean; onClose: () => void; onDone: (view: PassportView) => void }) {
  const profile = useLoad(() => api.profile(passport.profile), [passport.profile])
  const [claimCode, setClaimCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()

  async function submit(values: PassportFormValues) {
    setBusy(true)
    setError(undefined)
    try {
      const view = await api.updatePassport(passport.passportId, { ...values, ...(needsClaimCode ? { claimCode } : {}) })
      onDone(view)
      onClose()
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
          <DialogTitle>Update the passport</DialogTitle>
          <DialogDescription>A new state carrying the payload you submit. The current public payload is filled in.</DialogDescription>
        </DialogHeader>
        <Alert>
          <AlertTitle>Owner-tier fields start empty</AlertTitle>
          <AlertDescription>
            <p>The API never returns the encrypted owner tier, so those fields are blank here. What you submit becomes the new owner tier; leave them blank and it is written blank.</p>
          </AlertDescription>
        </Alert>
        {profile.loading ? (
          <Loading what="Loading the profile" />
        ) : profile.error != null || profile.data == null ? (
          <ErrorNotice error={profile.error ?? new Error('no answer')} title={`Could not load ${passport.profile}`} />
        ) : (
          <PassportForm
            profile={profile.data}
            initial={{ payload: isRecord(passport.payload) ? passport.payload : {} }}
            submitLabel="Write the update"
            busy={busy}
            error={error}
            onSubmit={submit}
            after={needsClaimCode ? <ClaimCodeField value={claimCode} onChange={setClaimCode} /> : null}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function HandOnDialog({ passportId, needsClaimCode, onClose, onDone }: { passportId: string; needsClaimCode: boolean; onClose: () => void; onDone: () => void }) {
  const [word, setWord] = useState('Handed on')
  const [note, setNote] = useState('')
  const [claimCode, setClaimCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const [result, setResult] = useState<{ offer: OfferView; claimCode?: string }>()

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const answer = await api.offerPassport(passportId, { terms: { word: word.trim(), ...(note.trim() === '' ? {} : { note: note.trim() }) }, ...(needsClaimCode ? { claimCode } : {}) })
      setResult(answer)
      onDone()
    } catch (cause) {
      setError(cause)
    } finally {
      setBusy(false)
    }
  }

  const acceptUrl = result == null ? '' : `${window.location.origin}/accept/${encodeURIComponent(result.offer.requestId)}`

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Hand on this passport</DialogTitle>
          <DialogDescription>The platform offers it under these terms. The recipient accepts with a claim code, and the transfer is written then.</DialogDescription>
        </DialogHeader>
        {result == null ? (
          <form onSubmit={submit} className="space-y-4">
            <Field label="Terms word" htmlFor="offer-word" required help="One word for what is happening, for example Sold or Gifted.">
              <Input id="offer-word" value={word} onChange={(e) => setWord(e.target.value)} required maxLength={40} />
            </Field>
            <Field label="Note" htmlFor="offer-note" help="Shown to the recipient before they decide.">
              <Textarea id="offer-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} />
            </Field>
            {needsClaimCode ? <ClaimCodeField value={claimCode} onChange={setClaimCode} /> : null}
            {error == null ? null : <ErrorNotice error={error} title="The offer was refused" />}
            <DialogFooter>
              <Button type="submit" disabled={busy || word.trim() === ''}>
                {busy ? 'Working' : 'Make the offer'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Claim code</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="text-2xl font-semibold tracking-wider">{result.claimCode ?? 'none'}</code>
                {result.claimCode == null ? null : <CopyButton text={result.claimCode} label="Copy the claim code" />}
              </div>
              <p className="mt-3 text-sm">Give this code to the recipient out of band. It is shown once and never stored.</p>
            </div>
            <Field label="Accept link" help="Where the recipient enters the code.">
              <div className="flex items-center gap-2">
                <Mono>{acceptUrl}</Mono>
                <CopyButton text={acceptUrl} label="Copy the accept link" />
              </div>
            </Field>
            <p className="text-sm text-muted-foreground">
              Offer {result.offer.requestId}, open until {formatTime(result.offer.expiresAt)}.
            </p>
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function RetireDialog({ passportId, needsClaimCode, onClose, onDone }: { passportId: string; needsClaimCode: boolean; onClose: () => void; onDone: (view: PassportView) => void }) {
  const [reason, setReason] = useState('')
  const [claimCode, setClaimCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const view = await api.retirePassport(passportId, { reason: reason.trim(), ...(needsClaimCode ? { claimCode } : {}) })
      onDone(view)
      onClose()
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
          <DialogTitle>Retire the passport</DialogTitle>
          <DialogDescription>A final state. Nothing can be written after it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Reason" htmlFor="retire-reason" required>
            <Input id="retire-reason" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={200} placeholder="Recycled, destroyed, withdrawn" />
          </Field>
          {needsClaimCode ? <ClaimCodeField value={claimCode} onChange={setClaimCode} /> : null}
          {error == null ? null : <ErrorNotice error={error} title="The retirement was refused" />}
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={busy || reason.trim() === ''}>
              {busy ? 'Working' : 'Retire'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ClaimDialog({ passportId, onClose, onDone }: { passportId: string; onClose: () => void; onDone: () => void }) {
  const [eventType, setEventType] = useState<EventType>('Origin')
  const [submitToRegistry, setSubmitToRegistry] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const [result, setResult] = useState<ClaimView>()

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const claim = await api.addClaim(passportId, { eventType, ...(submitToRegistry ? { submit: true } : {}) })
      setResult(claim)
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
          <DialogTitle>Add a claim</DialogTitle>
          <DialogDescription>A signed statement about the passport's current state, on its own rail. It never spends the passport.</DialogDescription>
        </DialogHeader>
        {result == null ? (
          <form onSubmit={submit} className="space-y-4">
            <Field label="Event type" htmlFor="claim-event" required>
              <Select value={eventType} onValueChange={(v) => setEventType(v as EventType)}>
                <SelectTrigger id="claim-event" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={submitToRegistry} onChange={(e) => setSubmitToRegistry(e.target.checked)} />
              Send to the registry
            </label>
            {error == null ? null : <ErrorNotice error={error} title="The claim was refused" />}
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                {busy ? 'Working' : 'Sign the claim'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <DefinitionList
              entries={[
                ['Claim', <Mono key="id">{result.id}</Mono>],
                ['Event', result.claim.eventType],
                ['Signature', <ToneBadge key="v" tone={result.verified == null || result.verified === 'verified' ? 'pass' : 'fail'}>{result.verified ?? 'signed'}</ToneBadge>],
                ['Registry', <RegistryAnswer key="r" claim={result} />],
              ]}
            />
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
