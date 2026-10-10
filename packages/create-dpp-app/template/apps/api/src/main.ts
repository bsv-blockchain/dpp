// Boot: configuration, the platform, sign-in, the HTTP server and the worker
// loop, in one process. Scale by running more API processes and exactly one
// worker (WORKER=only runs the loop alone; WORKER=off runs the API alone).
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAuth } from './auth.js'
import { loadConfig } from './config.js'
import { openPlatform } from './platform.js'
import { createServer } from './server.js'
import { startWorker } from './worker.js'

const config = loadConfig()
const role = process.env.WORKER ?? 'with-api'
const platform = await openPlatform({ config, mode: 'live' })

const auth = platform.db == null ? undefined : createAuth({ db: platform.db, secret: config.authSecret, baseURL: config.publicUrl, trustedOrigins: ['http://localhost:5173'] })
// No MongoDB means no sign-in: a development session stands in, with one development brand, so the pages work with no services.
const devSession = auth != null || process.env.NODE_ENV === 'production' ? undefined : { userId: 'developer', email: 'developer@localhost', name: 'Developer', brandIds: ['dev-brand'] }
if (devSession != null) {
  const party = platform.parties.brand('dev-brand')
  await platform.store.saveBrand({ id: 'dev-brand', name: 'Development brand', identityKey: party.identityKey, did: party.did, createdAt: new Date().toISOString() })
  console.log('Sign-in is off: every request is the developer, a member of "Development brand". Configure MongoDB for sign-in and persistence.')
}

let server: ReturnType<ReturnType<typeof createServer>['listen']> | undefined
if (role !== 'only') {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [join(here, '..', '..', 'web', 'dist'), join(process.cwd(), 'apps', 'web', 'dist')]
  const webDist = candidates.find((path) => existsSync(join(path, 'index.html')))
  const app = createServer({ platform, auth, devSession, webDist })
  server = app.listen(config.port, () => {
    console.log(`API on http://localhost:${config.port}${webDist == null ? ' (no built web app; run the Vite dev server for the pages)' : ', serving the web app'}`)
  })
}

const worker = role === 'off' ? undefined : startWorker({ store: platform.store, index: platform.index, writer: platform.writer, intervalMs: 60_000, log: (line) => console.log(`[worker] ${line}`) })

let stopping = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    console.log(`${signal} received, stopping`)
    worker?.stop()
    server?.close()
    void platform.close().finally(() => process.exit(0))
  })
}
