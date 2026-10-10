import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ErrorNotice, Field, Loading, PageTitle } from '@/components/bits'
import { RequireAccount } from '@/components/layout'
import { PassportForm, type PassportFormValues } from '@/components/passport-form'
import { api, passportRef, type Profile } from '@/lib/api'
import { useHealth } from '@/lib/session'
import { useLoad } from '@/lib/use-load'

export function NewPassport() {
  return (
    <RequireAccount>
      <NewPassportPage />
    </RequireAccount>
  )
}

function NewPassportPage() {
  const { brandId = '' } = useParams()
  const navigate = useNavigate()
  const { health } = useHealth()
  const profiles = useLoad(() => api.profiles(), [])
  const [profileId, setProfileId] = useState('')
  const profile = useLoad<Profile | undefined>(() => (profileId === '' ? Promise.resolve(undefined) : api.profile(profileId)), [profileId])
  const [itemReference, setItemReference] = useState('')
  const [serial, setSerial] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()

  async function issue(values: PassportFormValues) {
    setBusy(true)
    setError(undefined)
    try {
      const view = await api.issuePassport(brandId, { profile: profileId, itemReference: itemReference.trim(), serial: serial.trim(), ...values })
      navigate(`/passports/${passportRef(view.passportId)}`)
    } catch (cause) {
      setError(cause)
    } finally {
      setBusy(false)
    }
  }

  const chosen = profiles.data?.find((p) => p.id === profileId)
  const prefix = health?.identifiers.prefix ?? '952'
  const digits = Math.max(0, 12 - prefix.length)

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageTitle
        title="Issue a passport"
        description={
          <span>
            For brand {brandId}.{' '}
            <Link to={`/brands/${encodeURIComponent(brandId)}`} className="underline underline-offset-4">
              Back to the brand
            </Link>
          </span>
        }
      />
      <div className="max-w-md space-y-2">
        <Field label="Profile" htmlFor="profile" required help={chosen?.description}>
          {profiles.loading ? (
            <Loading what="Loading the profiles" />
          ) : profiles.error != null || profiles.data == null ? (
            <ErrorNotice error={profiles.error ?? new Error('no answer')} title="Could not load the profiles" />
          ) : (
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger id="profile" className="w-full">
                <SelectValue placeholder="Choose a profile" />
              </SelectTrigger>
              <SelectContent>
                {profiles.data.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title} ({p.id})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      </div>
      {profileId === '' ? null : profile.loading ? (
        <Loading what="Loading the profile" />
      ) : profile.error != null || profile.data == null ? (
        <ErrorNotice error={profile.error ?? new Error('no answer')} title={`Could not load ${profileId}`} />
      ) : (
        <PassportForm
          key={profileId}
          profile={profile.data}
          initial={{ payload: profile.data.sample }}
          submitLabel="Issue the passport"
          busy={busy}
          error={error}
          onSubmit={issue}
          before={
            <fieldset className="space-y-4">
              <legend className="mb-3 text-base font-semibold">Identifier</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Item reference" htmlFor="itemReference" required help={`The digits after the GS1 prefix, nine for prefix 952. This platform's prefix is ${prefix}, so ${digits} digits.`}>
                  <Input id="itemReference" value={itemReference} onChange={(e) => setItemReference(e.target.value)} required inputMode="numeric" pattern="[0-9]+" placeholder={'0'.repeat(digits)} />
                </Field>
                <Field label="Serial" htmlFor="serial" required help="The item's serial, 1 to 20 characters.">
                  <Input id="serial" value={serial} onChange={(e) => setSerial(e.target.value)} required maxLength={20} />
                </Field>
              </div>
            </fieldset>
          }
        />
      )}
    </div>
  )
}
