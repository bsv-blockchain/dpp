import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ErrorNotice, Loading, PageTitle, ToneBadge, statusTone } from '@/components/bits'
import { RequireAccount } from '@/components/layout'
import { api, passportRef } from '@/lib/api'
import { parseIdentifier } from '@/lib/format'
import { useLoad } from '@/lib/use-load'

export function Brand() {
  return (
    <RequireAccount>
      <BrandPage />
    </RequireAccount>
  )
}

function BrandPage() {
  const { brandId = '' } = useParams()
  const passports = useLoad(() => api.brandPassports(brandId), [brandId])
  const brands = useLoad(() => api.brands(), [])
  const brand = brands.data?.find((b) => b.id === brandId)

  return (
    <div className="space-y-8">
      <PageTitle
        title={brand?.name ?? brandId}
        description={
          <span>
            Brand {brandId}.{' '}
            <Link to="/brands" className="underline underline-offset-4">
              All brands
            </Link>
          </span>
        }
        action={
          <Button asChild>
            <Link to={`/brands/${encodeURIComponent(brandId)}/new`}>Issue a passport</Link>
          </Button>
        }
      />
      {passports.loading ? (
        <Loading what="Loading the passports" />
      ) : passports.error != null || passports.data == null ? (
        <ErrorNotice error={passports.error ?? new Error('no answer')} title="Could not load the passports" />
      ) : passports.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No passports yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Identifier</TableHead>
              <TableHead>Profile</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">States</TableHead>
              <TableHead className="text-right">Proven</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {passports.data.map((passport) => {
              const ident = parseIdentifier(passport.passportId)
              return (
                <TableRow key={passport.passportId}>
                  <TableCell>
                    {ident == null ? (
                      <span className="font-mono text-xs">{passport.passportId}</span>
                    ) : (
                      <>
                        <div className="font-medium">Serial {ident.serial}</div>
                        <div className="text-xs text-muted-foreground">GTIN {ident.gtin}</div>
                      </>
                    )}
                  </TableCell>
                  <TableCell>{passport.profile}</TableCell>
                  <TableCell>
                    <ToneBadge tone={statusTone(passport.status)}>{passport.status}</ToneBadge>
                  </TableCell>
                  <TableCell className="text-right">{passport.journal.states}</TableCell>
                  <TableCell className="text-right">{passport.journal.proven}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/passports/${passportRef(passport.passportId)}`}>Open</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
