// The HTTP surface. JSON under /api; the built web app and the passport
// pages under everything else. Reads are open: anyone may verify a passport.
// Writes need a signed-in member of the brand that holds the passport, or,
// for a recipient under managed custody, the claim code they accepted with.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hash, Utils } from '@bsv/sdk'
import { verifyLifecycleClaim } from '@bsv/dpp-protocol'
import { readPublicPayloadSchema, readRestrictedPayloadSchema } from '@bsv/dpp-profiles'
import express, { type NextFunction, type Request, type Response } from 'express'
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node'
import { sessionFrom, type Auth, type Session } from './auth.js'
import { EVENT_TYPES } from './claims.js'
import { isDemonstrationPolicy, mintPassportId } from './identifiers.js'
import type { Party } from './parties.js'
import type { Platform } from './platform.js'
import { currentProfiles, isProfileId, manifestFor, sampleWithProblems } from './profiles.js'
import type { PassportRecord, StateEntry } from './store.js'
import { pendingDuties, runDuties, summariseJournal } from './worker.js'
import { WriteRefused } from './writer.js'

export interface ServerOptions {
  platform: Platform
  auth?: Auth
  /**
   * Without sign-in (no MongoDB), every request is this developer, a member of
   * one development brand. Never set in production: it is what makes
   * `npm run dev` work with no services, and nothing else.
   */
  devSession?: Session
  /** The built web app to serve, when it exists. */
  webDist?: string
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string
  ) {
    super(detail)
  }
}

const sha256hex = (text: string): string => Utils.toHex(Hash.sha256(Utils.toArray(text, 'utf8')))
/** A URL-safe slug from a name: lower-case letters and digits with single hyphens, at most 64 characters, built without backtracking. */
function slugOf(name: string): string {
  let slug = ''
  let hyphen = false
  for (const char of name.toLowerCase().slice(0, 128)) {
    if (/[a-z0-9]/.test(char)) {
      slug += char
      hyphen = false
    } else if (slug.length > 0 && !hyphen) {
      slug += '-'
      hyphen = true
    }
    if (slug.length >= 64) break
  }
  return slug.endsWith('-') ? slug.slice(0, -1) : slug
}
/** A route parameter as one string; Express 5 types it as possibly several. */
const param = (req: Request, name: string): string => {
  const value = req.params[name]
  return Array.isArray(value) ? value[0] : value
}

/** What a passport looks like over the API: the journal without the owner-tier ciphertext. */
function publicView(record: PassportRecord, policyIsDemo: boolean) {
  const tip = record.states.at(-1)
  let payload: unknown = tip?.payloadPublic
  try {
    payload = tip == null ? undefined : JSON.parse(tip.payloadPublic)
  } catch {
    // Left as the string it is.
  }
  return {
    passportId: record.passportId,
    brandId: record.brandId,
    profile: record.profile,
    status: record.status,
    demonstration: policyIsDemo,
    holder: record.holder,
    createdAt: record.createdAt,
    payload,
    journal: summariseJournal(record),
    states: record.states.map((s: StateEntry) => ({
      op: s.op,
      txid: s.txid,
      timestamp: s.timestamp,
      actor: s.actor,
      index: s.index,
      refusal: s.refusal,
      network: s.network,
      proven: s.proof != null,
      proofPushed: s.proofPushed === true,
      blockHeight: s.proof?.blockHeight,
    })),
    acceptanceRecords: record.acceptanceRecords,
  }
}

export function createServer(options: ServerOptions): express.Express {
  const { platform, auth } = options
  const { store, parties, writer, custody, claims, config } = platform
  const policy = { host: config.passportHost, prefix: config.gs1Prefix }
  const demo = isDemonstrationPolicy(policy)
  const app = express()
  app.disable('x-powered-by')

  // Better Auth owns /api/auth; it must see the raw body, so it is mounted before the JSON parser.
  if (auth != null) app.all('/api/auth/{*splat}', toNodeHandler(auth))
  app.use(express.json({ limit: '1mb' }))

  const wrap = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).then((body) => {
      if (!res.headersSent) res.json(body)
    }, next)
  }
  const session = async (req: Request): Promise<Session | undefined> => (auth == null ? options.devSession : await sessionFrom(auth, req.headers))
  const requireSession = async (req: Request): Promise<Session> => {
    const s = await session(req)
    if (s == null) throw new HttpError(401, 'sign-in-required', 'sign in first')
    return s
  }
  const requireMember = async (req: Request, brandId: string): Promise<Session> => {
    const s = await requireSession(req)
    if (!s.brandIds.includes(brandId)) throw new HttpError(403, 'not-a-member', `you are not a member of brand ${brandId}`)
    return s
  }
  const passportFrom = async (ref: string): Promise<PassportRecord> => {
    const passportId = decodeURIComponent(ref)
    const record = await store.getPassport(passportId)
    if (record == null) throw new HttpError(404, 'passport-unknown', `no passport ${passportId} in this platform's journal`)
    return record
  }
  /**
   * Who may act on a held passport: a member of the brand while the brand
   * holds it; the recipient, with the claim code they accepted with, once a
   * hand-on moved control to them.
   */
  const actorFor = async (req: Request, record: PassportRecord): Promise<Party> => {
    const [scope, id] = record.holder.party.split(':', 2)
    if (scope === 'brand') {
      await requireMember(req, record.brandId)
      return parties.brand(id)
    }
    if (scope === 'recipient') {
      const claimCode = typeof req.body?.claimCode === 'string' ? req.body.claimCode : undefined
      const offer = await store.getOffer(id)
      if (claimCode == null || offer?.claimCodeHash == null || sha256hex(claimCode) !== offer.claimCodeHash) throw new HttpError(403, 'claim-code-required', 'the holder acts with the claim code they accepted with')
      return parties.recipient(id)
    }
    throw new HttpError(409, 'holder-unknown', `the holder ${record.holder.party} is not one this platform acts for`)
  }

  // ------------------------------------------------------------------ open reads

  app.get(
    '/api/health',
    wrap(async () => ({
      ok: true,
      network: config.network,
      index: platform.index.url,
      publisherKey: platform.wallet.identityKey,
      wallet: platform.wallet.kind,
      livePublishing: config.livePublishing,
      identifiers: { host: policy.host, prefix: policy.prefix, demonstration: demo },
      signIn: auth != null,
      devSession: auth == null && options.devSession != null ? { name: options.devSession.name, brandIds: options.devSession.brandIds } : undefined,
    }))
  )

  app.get('/api/profiles', wrap(async () => currentProfiles()))
  app.get(
    '/api/profiles/:id',
    wrap(async (req) => {
      const id = param(req, 'id')
      if (!isProfileId(id)) throw new HttpError(404, 'profile-unknown', `${id} is not a profile this platform knows`)
      const manifest = manifestFor(id)
      return {
        id,
        title: manifest.title,
        description: manifest.description,
        fields: manifest.fields.map((f) => ({ key: f.key, label: f.label, valueType: f.valueType, unit: f.unit, accessTier: f.accessTier, obligation: f.obligation, cardinality: f.cardinality, codeList: f.codeList, constraints: f.constraints, note: f.note, group: f.group })),
        publicSchema: readPublicPayloadSchema(id),
        restrictedSchema: readRestrictedPayloadSchema(id),
        ...(() => {
          const { payload, problems } = sampleWithProblems(id, demo)
          return { sample: payload, sampleProblems: problems }
        })(),
      }
    })
  )

  app.get(
    '/api/verify',
    wrap(async (req) => {
      const passportId = typeof req.query.passportId === 'string' ? req.query.passportId : undefined
      if (passportId == null) throw new HttpError(400, 'passport-id-required', 'give passportId')
      try {
        return await platform.read(passportId)
      } catch (cause) {
        throw new HttpError(404, 'not-found', cause instanceof Error ? cause.message : String(cause))
      }
    })
  )

  app.get('/api/passports/:ref', wrap(async (req) => publicView(await passportFrom(param(req, 'ref')), demo)))
  app.get('/api/passports/:ref/claims', wrap(async (req) => (await store.listClaims({ passportId: (await passportFrom(param(req, 'ref'))).passportId })).map((c) => ({ ...c, verified: verifyLifecycleClaim(c.claim).signature }))))

  app.get('/api/offers/:requestId', wrap(async (req) => await custody.preview(param(req, 'requestId'))))
  app.post('/api/offers/:requestId/accept', wrap(async (req) => await custody.accept({ requestId: param(req, 'requestId'), claimCode: req.body?.claimCode })))
  app.post('/api/offers/:requestId/decline', wrap(async (req) => await custody.decline(param(req, 'requestId'), req.body?.claimCode)))

  // ------------------------------------------------------------------ signed in

  app.get(
    '/api/me',
    wrap(async (req) => {
      const s = await requireSession(req)
      return { ...s, brands: await store.listBrands(s.brandIds) }
    })
  )

  app.get('/api/brands', wrap(async (req) => await store.listBrands((await requireSession(req)).brandIds)))
  app.post(
    '/api/brands',
    wrap(async (req) => {
      const s = await requireSession(req)
      const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 128) : ''
      if (name === '') throw new HttpError(400, 'name-required', 'a brand needs a name')
      let id: string
      if (auth == null) {
        // Development without sign-in: one brand per name, owned by the development session.
        id = `dev-${slugOf(name)}`
        if (!s.brandIds.includes(id)) s.brandIds.push(id)
      } else {
        const slug = `${slugOf(name)}-${Date.now().toString(36)}`
        const organisation = await auth.api.createOrganization({ body: { name, slug }, headers: fromNodeHeaders(req.headers) })
        if (organisation == null) throw new HttpError(500, 'brand-not-created', 'the organisation was not created')
        id = organisation.id
      }
      const party = parties.brand(id)
      const brand = { id, name, identityKey: party.identityKey, did: party.did, createdAt: new Date().toISOString() }
      await store.saveBrand(brand)
      return brand
    })
  )

  app.get(
    '/api/brands/:brandId/passports',
    wrap(async (req) => {
      await requireMember(req, param(req, 'brandId'))
      return (await store.listPassports({ brandId: param(req, 'brandId') })).map((p) => publicView(p, demo))
    })
  )

  app.post(
    '/api/brands/:brandId/passports',
    wrap(async (req) => {
      const brandId = param(req, 'brandId')
      await requireMember(req, brandId)
      const brandRecord = await store.getBrand(brandId)
      if (brandRecord == null) throw new HttpError(404, 'brand-unknown', `no brand ${brandId}`)
      const { profile, itemReference, serial, payload, ownerFields } = req.body ?? {}
      if (!isProfileId(profile)) throw new HttpError(400, 'profile-unknown', `${profile} is not a profile this platform knows`)
      if (typeof itemReference !== 'string' || typeof serial !== 'string') throw new HttpError(400, 'identifier-required', 'give itemReference (digits) and serial')
      const passportId = mintPassportId(policy, itemReference, serial)
      const outcome = await writer.issue({ brandId, brand: parties.brand(brandId), passportId, profile, payload: payload ?? {}, ownerFields: ownerFields ?? {} })
      return publicView(outcome.record, demo)
    })
  )

  app.post(
    '/api/passports/:ref/update',
    wrap(async (req) => {
      const record = await passportFrom(param(req, 'ref'))
      const actor = await actorFor(req, record)
      // ownerFields absent carries the current owner tier unchanged; {} seals an empty one.
      const ownerFields = typeof req.body?.ownerFields === 'object' && req.body.ownerFields != null ? req.body.ownerFields : undefined
      const outcome = await writer.update({ record, actor, payload: req.body?.payload ?? {}, ownerFields, eventData: req.body?.eventData })
      return publicView(outcome.record, demo)
    })
  )

  app.post(
    '/api/passports/:ref/offer',
    wrap(async (req) => {
      const record = await passportFrom(param(req, 'ref'))
      const holder = await actorFor(req, record)
      const terms = typeof req.body?.terms === 'object' && req.body.terms != null ? req.body.terms : { word: 'Handed on' }
      return await custody.offer({ record, holder, terms, mechanism: req.body?.mechanism, recipientIdentityKey: req.body?.recipientIdentityKey })
    })
  )

  app.post(
    '/api/offers/:requestId/withdraw',
    wrap(async (req) => {
      const offer = await store.getOffer(param(req, 'requestId'))
      if (offer == null) throw new HttpError(404, 'offer-unknown', `no offer ${param(req, 'requestId')}`)
      const record = await passportFrom(encodeURIComponent(offer.passportId))
      const holder = await actorFor(req, record)
      return await custody.withdraw(param(req, 'requestId'), holder)
    })
  )

  app.get(
    '/api/passports/:ref/offers',
    wrap(async (req) => {
      const record = await passportFrom(param(req, 'ref'))
      await requireMember(req, record.brandId)
      return (await store.listOffers({ passportId: record.passportId })).map(({ claimCodeHash: _hidden, ...offer }) => offer)
    })
  )

  app.post(
    '/api/passports/:ref/retire',
    wrap(async (req) => {
      const record = await passportFrom(param(req, 'ref'))
      const actor = await actorFor(req, record)
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : 'retired'
      const outcome = await writer.retire({ record, actor, reason })
      return publicView(outcome.record, demo)
    })
  )

  app.post(
    '/api/passports/:ref/states/:txid/resolve',
    wrap(async (req) => {
      const record = await passportFrom(param(req, 'ref'))
      await requireMember(req, record.brandId)
      const outcome = req.body?.outcome
      if (outcome !== 'sent' && outcome !== 'abandoned') throw new HttpError(400, 'outcome-required', "outcome must be 'sent' or 'abandoned'")
      return publicView(await writer.resolveInterrupted(record, param(req, 'txid'), outcome), demo)
    })
  )

  app.post(
    '/api/passports/:ref/claims',
    wrap(async (req) => {
      const s = await requireSession(req)
      const record = await passportFrom(param(req, 'ref'))
      const eventType = req.body?.eventType
      if (!EVENT_TYPES.includes(eventType)) throw new HttpError(400, 'event-type-unknown', `eventType must be one of ${EVENT_TYPES.join(', ')}`)
      const issuer = parties.member(s.userId)
      let claim = await claims.sign({ passport: record, issuer, eventType, keyId: s.email })
      if (req.body?.submit === true) claim = await claims.submit(claim)
      return { ...claim, verified: verifyLifecycleClaim(claim.claim).signature }
    })
  )

  app.get(
    '/api/operations',
    wrap(async (req) => {
      await requireSession(req)
      return { duties: await pendingDuties(store), passports: (await store.listPassports()).map((p) => ({ passportId: p.passportId, brandId: p.brandId, status: p.status, journal: summariseJournal(p) })) }
    })
  )
  app.post(
    '/api/operations/run',
    wrap(async (req) => {
      await requireSession(req)
      return { done: await runDuties({ store, index: platform.index, writer }) }
    })
  )

  app.get(
    '/api/wallet',
    wrap(async (req) => {
      await requireSession(req)
      return { kind: platform.wallet.kind, network: config.network, identityKey: platform.wallet.identityKey, balance: await platform.wallet.balance(), livePublishing: config.livePublishing }
    })
  )
  app.post(
    '/api/wallet/funding-address',
    wrap(async (req) => {
      await requireSession(req)
      return await platform.wallet.fundingAddress()
    })
  )
  app.post(
    '/api/wallet/internalize',
    wrap(async (req) => {
      await requireSession(req)
      const { txid, funding } = req.body ?? {}
      if (typeof txid !== 'string' || typeof funding !== 'object') throw new HttpError(400, 'funding-required', 'give the txid and the funding address record it paid')
      return await platform.wallet.internalize(funding, txid)
    })
  )

  // ------------------------------------------------------------------ the web app

  const webDist = options.webDist
  if (webDist != null && existsSync(join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: false }))
    // The passport page lives at the identifier's own path, and every other path is the single-page app's. Its shell is read once, not per request.
    const shell = readFileSync(join(webDist, 'index.html'), 'utf8')
    app.get('/{*splat}', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next()
      res.type('html').send(shell)
    })
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.code, description: error.message })
      return
    }
    if (error instanceof WriteRefused) {
      res.status(error.code.endsWith('-unknown') ? 404 : 409).json({ error: error.code, description: error.message })
      return
    }
    const description = error instanceof Error ? error.message : String(error)
    console.error('request failed:', error)
    res.status(500).json({ error: 'internal', description })
  })

  return app
}
