// The Better Auth client. The API mounts Better Auth under /api/auth on the
// same origin, so the session cookie travels with every API call by itself.
import { createAuthClient } from 'better-auth/react'
import { organizationClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: '/api/auth',
  plugins: [organizationClient()],
})
