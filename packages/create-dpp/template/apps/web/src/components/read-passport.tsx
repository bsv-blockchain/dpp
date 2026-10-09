// Read one passport the way the public page and the verify page do: the
// reader's report from the index, this platform's journal when it has the
// passport, and the claims. A journal 404 is not a failure: the passport may
// be another platform's, and the report still stands on its own.
import { ErrorNotice, Loading } from '@/components/bits'
import { PassportReading } from '@/components/reading'
import { api, isNotFound, type ClaimView, type PassportView, type Verification } from '@/lib/api'
import { useLoad } from '@/lib/use-load'

interface Read {
  verification?: Verification
  verifyError?: unknown
  journal?: PassportView
  claims: ClaimView[]
}

const unlessNotFound =
  <T,>(fallback: T) =>
  (cause: unknown): T => {
    if (isNotFound(cause)) return fallback
    throw cause
  }

async function read(passportId: string): Promise<Read> {
  const [verification, journal, claims] = await Promise.all([
    api.verify(passportId).then(
      (value): { ok: true; value: Verification } => ({ ok: true, value }),
      (error: unknown): { ok: false; error: unknown } => ({ ok: false, error })
    ),
    api.passport(passportId).catch(unlessNotFound<PassportView | undefined>(undefined)),
    api.passportClaims(passportId).catch(unlessNotFound<ClaimView[]>([])),
  ])
  return {
    verification: verification.ok ? verification.value : undefined,
    verifyError: verification.ok ? undefined : verification.error,
    journal,
    claims,
  }
}

export function ReadPassport({ passportId, manageLink, publicLink }: { passportId: string; manageLink?: boolean; publicLink?: boolean }) {
  const result = useLoad(() => read(passportId), [passportId])
  if (result.loading) return <Loading what="Reading the passport" />
  if (result.error != null || result.data == null) return <ErrorNotice error={result.error ?? new Error('nothing was read')} title="Could not read the passport" />
  const { verification, verifyError, journal, claims } = result.data
  if (verification == null && journal == null) return <ErrorNotice error={verifyError} title="Nothing was found for this identifier" />
  return <PassportReading passportId={passportId} verification={verification} verifyError={verifyError} journal={journal} claims={claims} manageLink={manageLink} publicLink={publicLink} />
}
