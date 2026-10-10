// The routes. The public passport page sits at the identifier's own path,
// /01/<gtin>/21/<serial>, so a label's QR code opens it directly.
import { Link, Route, Routes } from 'react-router'
import { Layout } from '@/components/layout'
import { Accept } from '@/pages/accept'
import { Brand } from '@/pages/brand'
import { Brands } from '@/pages/brands'
import { Home } from '@/pages/home'
import { NewPassport } from '@/pages/new-passport'
import { Operations } from '@/pages/operations'
import { Passport } from '@/pages/passport'
import { PublicPassport } from '@/pages/public-passport'
import { SignIn } from '@/pages/sign-in'
import { Verify } from '@/pages/verify'
import { Wallet } from '@/pages/wallet'

function NotFound() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="text-sm text-muted-foreground">
        There is no page here.{' '}
        <Link to="/" className="underline underline-offset-4">
          Home
        </Link>
      </p>
    </div>
  )
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="sign-in" element={<SignIn mode="sign-in" />} />
        <Route path="sign-up" element={<SignIn mode="sign-up" />} />
        <Route path="brands" element={<Brands />} />
        <Route path="brands/:brandId" element={<Brand />} />
        <Route path="brands/:brandId/new" element={<NewPassport />} />
        <Route path="passports/:ref" element={<Passport />} />
        <Route path="01/:gtin/21/:serial" element={<PublicPassport />} />
        <Route path="verify" element={<Verify />} />
        <Route path="accept/:requestId" element={<Accept />} />
        <Route path="operations" element={<Operations />} />
        <Route path="wallet" element={<Wallet />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
