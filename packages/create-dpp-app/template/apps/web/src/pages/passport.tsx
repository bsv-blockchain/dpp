// The brand's view of one passport: what is in the journal, and every action
// on it in a dialog. A passport that was handed on is held by a recipient,
// and every action then needs the claim code they accepted with.
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { CopyButton, DefinitionList, ErrorNotice, Field, Loading, Mono, PageTitle, Section, ToneBadge, YesNo, entriesOf, indexTone, networkTone, statusTone } from '@/components/bits'
import { BoundPassportForm, type BoundSubmission } from '@/components/bound/bound-passport-form'
import { EventsNaming, SuppliedDataNotice } from '@/components/epcis-events'
import { HolderReading, boundPayload } from '@/components/bound/readings'
import { RequireAccount } from '@/components/layout'
import { PassportForm, type PassportFormValues } from '@/components/passport-form'
import { passportSpellings } from '@/lib/epcis'
import { RecordNotice } from '@/components/reading'
import { ClaimDialog, DeclareErrorDialog } from '@/components/claim-dialog'
import { LifecycleClaims } from '@/components/lifecycle-claims'
import { api, type AuthorisedReading, type BoundProfile, type OfferView, type PassportView } from '@/lib/api'
import type { LifecycleClaimView } from '@/lib/lifecycle'
import { formatTime, holderLabel, humanise, isRecord, parseIdentifier, passportIdFromRef, publicPathOf, shortKey, shortTxid } from '@/lib/format'
import { useHealth } from '@/lib/session'
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
  const [declaring, setDeclaring] = useState<LifecycleClaimView>()

  if (passport.loading) return <Loading what="Loading the passport" />
  if (passport.error != null || passport.data == null) return <ErrorNotice error={passport.error ?? new Error('no answer')} title="Could not load the passport" />

  const view = passport.data
  const needsClaimCode = view.holder.party.startsWith('recipient:')
  const retired = view.status === 'retired'
  // A passport under a retired profile is shown as it was written. The API refuses every write for it, so none is offered.
  const profileRetired = view.profileRetired
  const closed = view.status !== 'active' || profileRetired != null || view.states.some((s) => s.network !== 'accepted' && s.network !== 'dry-run')
  const ident = parseIdentifier(view.passportId)
  const publicPath = publicPathOf(view.passportId)
  const close = () => setDialog(undefined)
  // Under a profile held by a binding the payload is one product document, split into a public and a restricted part.
  const bound = boundPayload(view.payload)

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

      {profileRetired == null ? null : (
        <Alert>
          <AlertTitle>Profile {view.profile} is retired</AlertTitle>
          <AlertDescription>
            <p>
              This passport stays as it was written, and its product data is not checked against the retired profile. No further state, hand-on or claim is made for it. {profileRetired.replacedBy} replaces the profile, and nothing converts this passport: issue a new one under the replacement.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {needsClaimCode ? (
        <Alert>
          <AlertTitle>Held by a recipient</AlertTitle>
          <AlertDescription>
            <p>This passport was handed on. Every action on it now needs the claim code the recipient accepted with.</p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setDialog('update')} disabled={closed}>
          Update
        </Button>
        <Button variant="outline" onClick={() => setDialog('offer')} disabled={closed}>
          Hand on
        </Button>
        <Button variant="outline" onClick={() => setDialog('retire')} disabled={closed}>
          Retire
        </Button>
        <Button variant="outline" onClick={() => setDialog('claim')} disabled={profileRetired != null}>
          Sign a lifecycle claim
        </Button>
        {retired ? <span className="self-center text-sm text-muted-foreground">Retired: no further state can be written.</span> : null}
      </div>

      <RecordNotice payload={view.payload} />
      {bound == null ? (
        <Section title="Public payload">
          <DefinitionList entries={entriesOf(view.payload, new Set(['notice']), humanise)} />
        </Section>
      ) : (
        <HolderReading passportId={view.passportId} payload={bound} needsClaimCode={needsClaimCode} />
      )}

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

      <Section title="Lifecycle claims">
        {claims.loading ? (
          <Loading what="Loading the claims" />
        ) : claims.error != null || claims.data == null ? (
          <ErrorNotice error={claims.error ?? new Error('no answer')} title="Could not load the claims" />
        ) : (
          <LifecycleClaims reading={claims.data} onDeclareError={closed ? undefined : setDeclaring} emptyText="No lifecycle claim concerns this passport. A claim is one EPCIS event a named party signed, on its own rail; it never spends the passport." />
        )}
      </Section>

      {/* Kept apart from everything above. The sections above are this passport's own record: states its holder signed and claims their issuers signed. What follows is data other parties supplied, and none of it is signed. */}
      <Section title="Events that name this product">
        <div className="space-y-3 rounded-lg border border-dashed p-4">
          <SuppliedDataNotice />
          <p className="text-sm text-muted-foreground">
            This list is separate from the passport's own record above. It changes nothing in it: an event here moved no custody and wrote no state. Events are found under the exact identifier they write. Searched:{' '}
            {passportSpellings(view.passportId).map((spelling, i) => (
              <span key={spelling}>
                {i === 0 ? null : ' and '}
                <Mono>{spelling}</Mono>
              </span>
            ))}
            . An event that writes this product another way, as an EPC URN for one, is found on the{' '}
            <Link to="/events" className="underline underline-offset-4">
              Events page
            </Link>
            .
          </p>
          <EventsNaming identifiers={passportSpellings(view.passportId)} />
        </div>
      </Section>

      {dialog === 'update' && bound == null ? <UpdateDialog passport={view} needsClaimCode={needsClaimCode} onClose={close} onDone={passport.setData} /> : null}
      {dialog === 'update' && bound != null ? <BoundUpdateDialog passport={view} publicProduct={bound.product} needsClaimCode={needsClaimCode} onClose={close} onDone={passport.setData} /> : null}
      {dialog === 'offer' ? <HandOnDialog passportId={view.passportId} needsClaimCode={needsClaimCode} onClose={close} onDone={offers.reload} /> : null}
      {dialog === 'retire' ? <RetireDialog passportId={view.passportId} needsClaimCode={needsClaimCode} onClose={close} onDone={passport.setData} /> : null}
      {dialog === 'claim' ? <ClaimDialog passportId={view.passportId} onClose={close} onDone={claims.reload} /> : null}
      {declaring == null ? null : <DeclareErrorDialog passportId={view.passportId} claim={declaring} onClose={() => setDeclaring(undefined)} onDone={claims.reload} />}
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
        ) : profile.error != null || profile.data == null || profile.data.format !== 'manifest' ? (
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

/**
 * An update under a profile held by a binding: a new complete product
 * document. The form starts from the document as it stands, which needs the
 * restricted part opened. Where it cannot be opened the form starts from
 * the public part and says what that means.
 */
function BoundUpdateDialog({ passport, publicProduct, needsClaimCode, onClose, onDone }: { passport: PassportView; publicProduct: Record<string, unknown>; needsClaimCode: boolean; onClose: () => void; onDone: (view: PassportView) => void }) {
  const { health } = useHealth()
  const profile = useLoad(() => api.profile(passport.profile), [passport.profile])
  const [claimCode, setClaimCode] = useState('')
  const [opened, setOpened] = useState<{ reading?: AuthorisedReading; error?: unknown }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  // A brand member's restricted part is opened straight away; a recipient gives the claim code first.
  const auto = useLoad(() => (needsClaimCode ? Promise.resolve(undefined) : api.authorisedView(passport.passportId)), [passport.passportId, needsClaimCode])
  const reading = opened?.reading ?? auto.data
  const ready = needsClaimCode ? opened != null : !auto.loading

  async function open(event: FormEvent) {
    event.preventDefault()
    try {
      setOpened({ reading: await api.authorisedView(passport.passportId, claimCode) })
    } catch (cause) {
      setOpened({ error: cause })
    }
  }

  async function submit(submission: BoundSubmission) {
    setBusy(true)
    setError(undefined)
    try {
      const view = await api.updatePassport(passport.passportId, { product: submission.product, ...(needsClaimCode ? { claimCode } : {}) })
      onDone(view)
      onClose()
    } catch (cause) {
      setError(cause)
    } finally {
      setBusy(false)
    }
  }

  const whole = reading?.product
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Update the passport</DialogTitle>
          <DialogDescription>A new state carrying the complete product document you submit. Its public part is written on chain and its restricted part is sealed again.</DialogDescription>
        </DialogHeader>
        {needsClaimCode && opened?.reading == null ? (
          <form onSubmit={open} className="space-y-3">
            <ClaimCodeField value={claimCode} onChange={setClaimCode} />
            {opened?.error == null ? null : <ErrorNotice error={opened.error} title="The restricted part was not opened" />}
            <Button type="submit" variant="outline">
              Open the document
            </Button>
          </form>
        ) : null}
        {!ready || profile.loading ? (
          needsClaimCode && opened == null ? null : <Loading what="Loading the document" />
        ) : profile.error != null || profile.data == null || profile.data.format !== 'binding' ? (
          <ErrorNotice error={profile.error ?? new Error(`${passport.profile} is not registered in this application, so its documents cannot be written here`)} title={`Could not load ${passport.profile}`} />
        ) : (
          <>
            {whole == null ? (
              <Alert>
                <AlertTitle>The restricted part is not filled in</AlertTitle>
                <AlertDescription>
                  <p>
                    {reading?.authorisedView.summary ?? (auto.error instanceof Error ? auto.error.message : 'The restricted part could not be opened.')} The form starts from the public part alone. What you submit becomes the whole document: a restricted property you do not enter again is no longer
                    part of it.
                  </p>
                </AlertDescription>
              </Alert>
            ) : null}
            <BoundPassportForm
              key={whole == null ? 'public' : 'whole'}
              profile={profile.data as BoundProfile}
              policy={{ host: health?.identifiers.host ?? window.location.host, prefix: health?.identifiers.prefix ?? '952' }}
              passportId={passport.passportId}
              initialProduct={whole ?? publicProduct}
              submitLabel="Write the update"
              busy={busy}
              error={error}
              onSubmit={submit}
            />
          </>
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

