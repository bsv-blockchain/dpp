// A passport under a profile held by a binding, as a reader sees it. Two
// checks are shown and they are kept apart. The public view is made by any
// reader from the public payload, and is a statement about that payload
// only. The authorised view is made for the holder, who can open the
// restricted part: the two parts are rejoined and checked whole. Whether
// the restricted part is the one the record commits to is a third thing,
// the protocol's owner-tier check, and has a line of its own.
import { useMemo, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorNotice, Loading, Mono, Section } from '@/components/bits'
import { ViewBadge, ViewPanel } from '@/components/bound/pieces'
import { ProductView } from '@/components/bound/structured-value'
import { api, type AuthorisedReading, type PayloadCheck, type ProductReading, type Verification, type ViewCheck } from '@/lib/api'
import { describeProduct } from '@/lib/bound/display'
import { labelsOf } from '@/lib/bound/form-model'
import { sectorFormFor } from '@/lib/bound/forms'
import { isRecord, shortTxid } from '@/lib/format'
import { useLoad } from '@/lib/use-load'

/** The envelope of a payload under a binding, when the payload is one. */
export function boundPayload(payload: unknown): { profile: string; bindingDigest: string; notice?: string; product: Record<string, unknown> } | undefined {
  if (!isRecord(payload) || typeof payload.profile !== 'string' || typeof payload.profile_binding_sha256 !== 'string' || !isRecord(payload.product)) return undefined
  return { profile: `${payload.profile}@${String(payload.profile_version)}`, bindingDigest: payload.profile_binding_sha256, ...(typeof payload.notice === 'string' ? { notice: payload.notice } : {}), product: payload.product }
}

const labelsFor = (profile: string): Map<string, string> => {
  const form = sectorFormFor(profile)
  return form == null ? new Map() : labelsOf(form)
}

/** The check of the newest state's public payload, among the checks of every state. */
const newestCheck = (verification: Verification | undefined): PayloadCheck | undefined => {
  const tip = verification?.lineage.at(-1)?.txid
  return verification?.payloadChecks?.find((check) => check.txid === tip) ?? verification?.payloadChecks?.at(-1)
}

function PublicViewPanel({ check, states }: { check: ViewCheck | undefined; states?: PayloadCheck[] }) {
  if (check == null) {
    return (
      <div className="space-y-2 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Public view</h3>
          <ViewBadge status="not-checked" />
        </div>
        <p className="text-sm text-muted-foreground">The public payload was not checked: no report was read for this passport. A check that did not run is not a pass.</p>
      </div>
    )
  }
  const earlier = (states ?? []).slice(0, -1)
  return (
    <ViewPanel title="Public view: the public payload of the newest state" check={check}>
      {earlier.length === 0 ? null : (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {earlier.map((state) => (
            <li key={state.txid} className="flex items-center gap-2">
              Earlier state <Mono>{shortTxid(state.txid)}</Mono> <ViewBadge status={state.publicView.status} />
            </li>
          ))}
        </ul>
      )}
    </ViewPanel>
  )
}

/** What any reader has: the public part of the document and the check of it. Nothing here speaks for the restricted part. */
export function PublicReading({ product, verification }: { product: ProductReading; verification?: Verification }) {
  const labels = useMemo(() => labelsFor(product.profile), [product.profile])
  const properties = useMemo(() => describeProduct({ publicProduct: product.publicProduct, access: product.access }, labels), [product, labels])
  return (
    <>
      <Section title="Product">
        <p className="text-sm text-muted-foreground">
          The public part of the product document, as written on chain under <Mono>{product.profile}</Mono>.{' '}
          {product.access == null ? 'This reader holds no public list for the profile, so it cannot say which other properties exist.' : 'Any other property of the document is restricted: it is not on chain and is not shown here.'}
        </p>
        <ProductView properties={properties} />
      </Section>
      <Section title="Product data checks">
        <PublicViewPanel check={newestCheck(verification)?.publicView} states={verification?.payloadChecks} />
        <div className="space-y-2 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Authorised view: the public payload with the restricted part</h3>
            <ViewBadge status="not-checked" />
          </div>
          <p className="text-sm text-muted-foreground">Not checked here. This page reads the public payload alone, so nothing on it is a statement about restricted data, or about whether a restricted part exists. The holder sees this check on the passport's own page.</p>
        </div>
      </Section>
    </>
  )
}

/**
 * What the holder has: the same public view, then the authorised view once
 * the restricted part is opened. A recipient opens it with the claim code
 * they accepted with.
 */
export function HolderReading({ passportId, payload, needsClaimCode }: { passportId: string; payload: NonNullable<ReturnType<typeof boundPayload>>; needsClaimCode: boolean }) {
  const verification = useLoad(() => api.verify(passportId), [passportId, payload.bindingDigest, JSON.stringify(payload.product)])
  const [claimCode, setClaimCode] = useState('')
  const [asked, setAsked] = useState(!needsClaimCode)
  const authorised = useLoad<AuthorisedReading | undefined>(() => (asked ? api.authorisedView(passportId, needsClaimCode ? claimCode : undefined) : Promise.resolve(undefined)), [passportId, asked, JSON.stringify(payload.product)])
  const labels = useMemo(() => labelsFor(payload.profile), [payload.profile])
  const access = authorised.data?.access ?? verification.data?.product?.access
  const properties = useMemo(() => describeProduct({ publicProduct: payload.product, restrictedProduct: authorised.data?.restrictedProduct, access }, labels), [payload.product, authorised.data, access, labels])

  function open(event: FormEvent) {
    event.preventDefault()
    if (asked) authorised.reload()
    else setAsked(true)
  }

  return (
    <>
      <Section title="Product">
        <p className="text-sm text-muted-foreground">
          The product document under <Mono>{payload.profile}</Mono>. A public property is on chain for anyone. A restricted property is sealed off chain{authorised.data?.restrictedProduct == null ? ' and is shown once it is opened below' : ' and was opened for you'}.
        </p>
        <ProductView properties={properties} />
      </Section>
      <Section title="Product data checks">
        {verification.loading ? <Loading what="Reading the public view" /> : verification.error != null ? <ErrorNotice error={verification.error} title="The public view could not be read" /> : <PublicViewPanel check={newestCheck(verification.data)?.publicView} states={verification.data?.payloadChecks} />}
        {needsClaimCode ? (
          <form onSubmit={open} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input value={claimCode} onChange={(e) => setClaimCode(e.target.value)} placeholder="Claim code" aria-label="Claim code" required autoComplete="off" spellCheck={false} className="sm:w-64" />
            <Button type="submit" variant="outline">
              Open the restricted part
            </Button>
          </form>
        ) : null}
        {!asked ? (
          <p className="text-sm text-muted-foreground">The authorised view is not checked until the restricted part is opened with the claim code.</p>
        ) : authorised.loading ? (
          <Loading what="Opening the restricted part" />
        ) : authorised.error != null || authorised.data == null ? (
          <ErrorNotice error={authorised.error ?? new Error('no answer')} title="The authorised view could not be read" />
        ) : (
          <>
            <div className="space-y-2 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Owner-tier check: the stored restricted part against the record</h3>
                <ViewBadge status={authorised.data.ownerTier.status} />
              </div>
              <p className="text-sm text-muted-foreground">{authorised.data.ownerTier.detail}</p>
            </div>
            <ViewPanel title="Authorised view: the public payload with the restricted part" check={authorised.data.authorisedView} />
          </>
        )}
      </Section>
    </>
  )
}
