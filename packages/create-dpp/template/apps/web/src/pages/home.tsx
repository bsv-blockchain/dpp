import { Link } from 'react-router'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ErrorNotice, Loading } from '@/components/bits'
import { useAccount, useHealth } from '@/lib/session'

export function Home() {
  const { health, error, loading } = useHealth()
  const account = useAccount()

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="text-3xl font-semibold tracking-tight">Digital Product Passports on BSV</h1>
      <p className="text-base leading-relaxed text-muted-foreground">
        Brands issue a passport for each product they make and keep it current through the product's life. Every state is a transaction on BSV, signed by the brand and countersigned by this platform, and anyone holding the identifier, or the QR code it
        is printed as, can verify the whole history without asking the brand.
      </p>
      {loading ? <Loading /> : null}
      {error == null ? null : <ErrorNotice error={error} title="The API is not answering" />}
      {health?.devSession == null ? null : (
        <Alert>
          <AlertTitle>Development session</AlertTitle>
          <AlertDescription>
            <p>Sign-in is off: you are the developer, a member of Development brand. Configure MongoDB for sign-in.</p>
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link to="/verify">Verify a passport</Link>
        </Button>
        {account.signedIn ? (
          <Button asChild variant="outline">
            <Link to="/brands">Your brands</Link>
          </Button>
        ) : null}
        {!account.signedIn && account.canSignIn ? (
          <Button asChild variant="outline">
            <Link to="/sign-in">Sign in</Link>
          </Button>
        ) : null}
      </div>
      {health == null ? null : (
        <p className="text-xs text-muted-foreground">
          Network {health.network}. Identifiers under https://{health.identifiers.host} with GS1 prefix {health.identifiers.prefix}
          {health.identifiers.demonstration ? ' (the demonstration prefix)' : ''}. Live publishing {health.livePublishing ? 'on' : 'off'}.
        </p>
      )}
    </div>
  )
}
