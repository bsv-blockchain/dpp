// The public pages, where the resolver sends a browser that asked for an
// identifier: /passport/01/<gtin>/21/<serial> for an item's passport, and
// /passport/01/<gtin> for the product. The identifier is the platform's
// passport host plus the path after /passport, which is what the brand
// minted; in development the API's host may differ from the Vite origin, so
// the host comes from /api/health before the origin is assumed.
import { Link, useLocation, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { CopyButton, ErrorNotice, Loading, Mono, PageTitle } from '@/components/bits'
import { ReadPassport } from '@/components/read-passport'
import { PAGE_PREFIX } from '@/lib/format'
import { useHealth } from '@/lib/session'

/** The identifier a public page is about: the passport host, or this origin when the API has not said, and the page's path without its prefix. */
function useIdentifier(): { identifier: string; loading: boolean; error: unknown } {
  const { health, loading, error } = useHealth()
  const location = useLocation()
  const host = health?.identifiers.host
  const path = location.pathname.slice(PAGE_PREFIX.length)
  return { identifier: host == null || host === '' ? `${window.location.origin}${path}` : `https://${host}${path}`, loading, error }
}

export function PublicPassport() {
  const { identifier, loading, error } = useIdentifier()

  if (loading) return <Loading what="Reading the passport" />

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {error == null ? null : <ErrorNotice error={error} title="The API is not answering" />}
      <ReadPassport passportId={identifier} />
    </div>
  )
}

/** The page a product's identifier leads to. A passport belongs to one item, so this page holds none: it says what the identifier names and where an item's passport is found. */
export function PublicProduct() {
  const { identifier, loading, error } = useIdentifier()
  const { gtin } = useParams()

  if (loading) return <Loading />

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {error == null ? null : <ErrorNotice error={error} title="The API is not answering" />}
      <PageTitle
        title={`GTIN ${gtin ?? ''}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Mono>{identifier}</Mono>
            <CopyButton text={identifier} label="Copy the identifier" />
          </span>
        }
      />
      <p className="text-sm leading-relaxed">
        This identifier names a product, not one item of it. A passport belongs to one item and is found under the item's own identifier, which ends with its serial: <Mono>{identifier}/21/&lt;serial&gt;</Mono>. Scan the code on the item, or paste its
        identifier to verify it.
      </p>
      <Button asChild variant="outline">
        <Link to="/verify">Verify a passport</Link>
      </Button>
    </div>
  )
}
