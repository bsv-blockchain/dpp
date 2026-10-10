// The frame every page sits in: a header with the name, the navigation and
// the sign-in state, the page itself, and one footer line.
import type { ReactNode } from 'react'
import { cn } from 'cn'
import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Loading, ToneBadge } from '@/components/bits'
import { useAccount, useHealth } from '@/lib/session'

const navLink = ({ isActive }: { isActive: boolean }) => cn('text-sm transition-colors hover:text-foreground', isActive ? 'font-medium text-foreground' : 'text-muted-foreground')

/** A page for a signed-in member: with sign-in on and nobody signed in, say so instead of letting every call answer 401. */
export function RequireAccount({ children }: { children: ReactNode }) {
  const account = useAccount()
  if (account.pending) return <Loading />
  if (!account.signedIn && account.canSignIn) {
    return (
      <Alert>
        <AlertTitle>Sign in first</AlertTitle>
        <AlertDescription>
          <p>
            This page is for a member of a brand.{' '}
            <Link to="/sign-in" className="underline underline-offset-4">
              Sign in
            </Link>{' '}
            or{' '}
            <Link to="/sign-up" className="underline underline-offset-4">
              sign up
            </Link>
            .
          </p>
        </AlertDescription>
      </Alert>
    )
  }
  if (!account.signedIn) {
    return (
      <Alert variant="destructive">
        <AlertTitle>No session</AlertTitle>
        <AlertDescription>
          <p>The API did not answer, so there is nobody to act as. Check that the API is running.</p>
        </AlertDescription>
      </Alert>
    )
  }
  return <>{children}</>
}

export function Layout() {
  const account = useAccount()
  const { error } = useHealth()
  const navigate = useNavigate()

  async function signOut() {
    await account.signOut?.()
    navigate('/')
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link to="/" className="font-semibold tracking-tight">
            Digital Product Passports
          </Link>
          <nav className="flex flex-wrap items-center gap-4" aria-label="Main">
            <NavLink to="/verify" className={navLink}>
              Verify
            </NavLink>
            {account.signedIn ? (
              <>
                <NavLink to="/brands" className={navLink}>
                  Brands
                </NavLink>
                <NavLink to="/operations" className={navLink}>
                  Operations
                </NavLink>
                <NavLink to="/wallet" className={navLink}>
                  Wallet
                </NavLink>
              </>
            ) : null}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {account.pending ? null : account.devSession ? (
              <ToneBadge tone="warn">Developer</ToneBadge>
            ) : account.signedIn ? (
              <>
                <span className="text-muted-foreground">{account.name ?? account.email}</span>
                <Button variant="outline" size="sm" onClick={signOut}>
                  Sign out
                </Button>
              </>
            ) : account.canSignIn ? (
              <>
                <Link to="/sign-in" className="text-muted-foreground hover:text-foreground">
                  Sign in
                </Link>
                <Button asChild size="sm">
                  <Link to="/sign-up">Sign up</Link>
                </Button>
              </>
            ) : (
              <span className="text-muted-foreground">{error == null ? 'Sign-in is off' : 'API unreachable'}</span>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t">
        <div className="mx-auto w-full max-w-5xl px-4 py-4 text-sm text-muted-foreground">Built on the open DPP standard on BSV</div>
      </footer>
    </div>
  )
}
