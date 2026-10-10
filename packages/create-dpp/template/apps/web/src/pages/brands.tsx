import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CopyButton, ErrorNotice, Loading, Mono, PageTitle } from '@/components/bits'
import { RequireAccount } from '@/components/layout'
import { api } from '@/lib/api'
import { formatTime, shortKey } from '@/lib/format'
import { useLoad } from '@/lib/use-load'

export function Brands() {
  return (
    <RequireAccount>
      <BrandsPage />
    </RequireAccount>
  )
}

function BrandsPage() {
  const brands = useLoad(() => api.brands(), [])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()

  async function create(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await api.createBrand(name.trim())
      setName('')
      brands.reload()
    } catch (cause) {
      setError(cause)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-10">
      <PageTitle title="Brands" description="A brand issues passports and holds them until it hands them on. Its identity key is derived by the platform." />
      {brands.loading ? (
        <Loading what="Loading your brands" />
      ) : brands.error != null || brands.data == null ? (
        <ErrorNotice error={brands.error ?? new Error('no answer')} title="Could not load your brands" />
      ) : brands.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">You are not a member of any brand yet. Create one below.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Identity key</TableHead>
              <TableHead>Created</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {brands.data.map((brand) => (
              <TableRow key={brand.id}>
                <TableCell>
                  <Link to={`/brands/${encodeURIComponent(brand.id)}`} className="font-medium underline-offset-4 hover:underline">
                    {brand.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">{brand.id}</div>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1">
                    <Mono>{shortKey(brand.identityKey)}</Mono>
                    <CopyButton text={brand.identityKey} label="Copy the identity key" />
                  </span>
                </TableCell>
                <TableCell>{formatTime(brand.createdAt)}</TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/brands/${encodeURIComponent(brand.id)}`}>Passports</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Create a brand</CardTitle>
          <CardDescription>You become its first member.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={create} className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Brand name" required aria-label="Brand name" />
            <Button type="submit" disabled={busy || name.trim() === ''}>
              {busy ? 'Working' : 'Create'}
            </Button>
          </form>
          {error == null ? null : <ErrorNotice error={error} title="The brand was not created" />}
        </CardContent>
      </Card>
    </div>
  )
}
