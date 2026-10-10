// The public page a label's QR code opens: /01/<gtin>/21/<serial>. The
// identifier is the platform's passport host plus this path, which is what
// the brand minted; in development the API's host may differ from the Vite
// origin, so the host comes from /api/health before the origin is assumed.
import { useLocation } from 'react-router'
import { ErrorNotice, Loading } from '@/components/bits'
import { ReadPassport } from '@/components/read-passport'
import { useHealth } from '@/lib/session'

export function PublicPassport() {
  const { health, loading, error } = useHealth()
  const location = useLocation()

  if (loading) return <Loading what="Reading the passport" />
  const host = health?.identifiers.host
  const passportId = host == null || host === '' ? `${window.location.origin}${location.pathname}` : `https://${host}${location.pathname}`

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {error == null ? null : <ErrorNotice error={error} title="The API is not answering" />}
      <ReadPassport passportId={passportId} />
    </div>
  )
}
