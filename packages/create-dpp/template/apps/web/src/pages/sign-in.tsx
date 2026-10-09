import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ErrorNotice, Field, Loading } from '@/components/bits'
import { authClient } from '@/lib/auth'
import { useHealth } from '@/lib/session'

export function SignIn({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const { health, loading, error: healthError } = useHealth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const signingUp = mode === 'sign-up'

  if (loading) return <Loading />
  if (healthError != null) return <ErrorNotice error={healthError} title="The API is not answering" />
  if (!health?.signIn) {
    return (
      <div className="mx-auto max-w-md">
        <Alert>
          <AlertTitle>Sign-in is off</AlertTitle>
          <AlertDescription>
            <p>
              {health?.devSession == null ? 'This platform has no sign-in configured.' : 'You are the developer, a member of Development brand. Configure MongoDB for sign-in.'}{' '}
              <Link to="/" className="underline underline-offset-4">
                Home
              </Link>
            </p>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const result = signingUp ? await authClient.signUp.email({ email, password, name }) : await authClient.signIn.email({ email, password })
      if (result.error != null) {
        setError(result.error.message ?? (signingUp ? 'Sign-up failed' : 'Sign-in failed'))
        return
      }
      navigate('/brands')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>{signingUp ? 'Sign up' : 'Sign in'}</CardTitle>
          <CardDescription>{signingUp ? 'An account to create brands and issue passports.' : 'Email and password.'}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            {signingUp ? (
              <Field label="Name" htmlFor="name" required>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
              </Field>
            ) : null}
            <Field label="Email" htmlFor="email" required>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </Field>
            <Field label="Password" htmlFor="password" required help={signingUp ? 'At least eight characters.' : undefined}>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={signingUp ? 8 : undefined} autoComplete={signingUp ? 'new-password' : 'current-password'} />
            </Field>
            {error == null ? null : <ErrorNotice error={new Error(error)} title={signingUp ? 'Sign-up failed' : 'Sign-in failed'} />}
            <div className="flex items-center justify-between gap-3">
              <Button type="submit" disabled={busy}>
                {busy ? 'Working' : signingUp ? 'Sign up' : 'Sign in'}
              </Button>
              <Link to={signingUp ? '/sign-in' : '/sign-up'} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
                {signingUp ? 'Have an account? Sign in' : 'New here? Sign up'}
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
