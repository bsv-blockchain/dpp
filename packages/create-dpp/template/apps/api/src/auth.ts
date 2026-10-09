// Sign-in is the guard rail on every write: the write routes spend real
// satoshis and write permanent states, so who may act for which brand must
// be decided before a key is used. Better Auth, self-hosted on the same
// MongoDB, with email and password and organisations: an organisation is a
// brand, and its members act for it. The signature itself is always made
// with a key the platform holds; sign-in only decides who may ask for it.
// At Ring 0 this platform is the only party vouching for who a member is.
import { betterAuth } from 'better-auth'
import { mongodbAdapter } from 'better-auth/adapters/mongodb'
import { fromNodeHeaders } from 'better-auth/node'
import { organization } from 'better-auth/plugins'
import type { Db } from 'mongodb'
import type { IncomingHttpHeaders } from 'node:http'

export interface AuthOptions {
  db: Db
  secret: string
  baseURL: string
  trustedOrigins?: string[]
}

export function createAuth(options: AuthOptions) {
  return betterAuth({
    database: mongodbAdapter(options.db),
    secret: options.secret,
    baseURL: options.baseURL,
    basePath: '/api/auth',
    trustedOrigins: options.trustedOrigins ?? [],
    emailAndPassword: { enabled: true },
    plugins: [organization()],
  })
}

export type Auth = ReturnType<typeof createAuth>

export interface Session {
  userId: string
  email: string
  name: string
  /** The brands (organisations) this user is a member of. */
  brandIds: string[]
}

/** The signed-in user behind a request, or undefined. */
export async function sessionFrom(auth: Auth, headers: IncomingHttpHeaders): Promise<Session | undefined> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) })
  if (session == null) return undefined
  const organisations = await auth.api.listOrganizations({ headers: fromNodeHeaders(headers) })
  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    brandIds: organisations.map((o) => o.id),
  }
}
