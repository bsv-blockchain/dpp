// Who is looking: the API's health answer (sign-in on or off, the development
// session) and, when sign-in is on, the Better Auth session. Pages read both
// through two hooks and never call the auth client when sign-in is off.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, type Health } from './api'
import { authClient } from './auth'
import { toError } from './use-load'

interface HealthState {
  health: Health | undefined
  error: Error | undefined
  loading: boolean
  reload: () => void
}

const HealthContext = createContext<HealthState>({ health: undefined, error: undefined, loading: true, reload: () => {} })

export function HealthProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<Health>()
  const [error, setError] = useState<Error>()
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.health().then(
      (answer) => {
        if (cancelled) return
        setHealth(answer)
        setError(undefined)
        setLoading(false)
      },
      (cause: unknown) => {
        if (cancelled) return
        setError(toError(cause))
        setLoading(false)
      }
    )
    return () => {
      cancelled = true
    }
  }, [tick])

  return <HealthContext.Provider value={{ health, error, loading, reload: () => setTick((t) => t + 1) }}>{children}</HealthContext.Provider>
}

export const useHealth = (): HealthState => useContext(HealthContext)

export interface Account {
  /** Someone may act for a brand: a signed-in user, or the development session. */
  signedIn: boolean
  pending: boolean
  name?: string
  email?: string
  /** Sign-in is on: MongoDB is configured and Better Auth is mounted. */
  canSignIn: boolean
  devSession: boolean
  signOut?: () => Promise<void>
}

const nobody: Account = { signedIn: false, pending: true, canSignIn: false, devSession: false }
const AccountContext = createContext<Account>(nobody)

export function AccountProvider({ children }: { children: ReactNode }) {
  const { health, loading } = useHealth()
  if (loading) return <AccountContext.Provider value={nobody}>{children}</AccountContext.Provider>
  if (health?.signIn) return <AuthAccountProvider>{children}</AuthAccountProvider>
  const dev = health?.devSession
  const value: Account = { signedIn: dev != null, pending: false, name: dev?.name, canSignIn: false, devSession: dev != null }
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}

function AuthAccountProvider({ children }: { children: ReactNode }) {
  const session = authClient.useSession()
  const user = session.data?.user
  const value: Account = {
    signedIn: user != null,
    pending: session.isPending,
    name: user?.name,
    email: user?.email,
    canSignIn: true,
    devSession: false,
    signOut: async () => {
      await authClient.signOut()
      await session.refetch()
    },
  }
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}

export const useAccount = (): Account => useContext(AccountContext)
