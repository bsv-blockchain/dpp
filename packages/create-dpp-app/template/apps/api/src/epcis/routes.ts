// The EPCIS exchange over HTTP, under /api/epcis. Every route needs a
// signed-in user. Every route calls the exchange (exchange.ts), which calls
// the module, and none does the module's work again.
//
// These routes are mounted before the application's JSON parser, because an
// import takes its body as the exact bytes that arrived: they are digested,
// retained and exported as they are, and are never parsed here or written
// out again from a parsed form. The routes that do take JSON parse it
// themselves.
//
// Nothing here reaches the wallet, the writer or the index. An import or a
// pull retains data and changes no passport.
import { EpcisStorageError } from '@bsv/dpp-credentials/epcis-exchange'
import { EPCIS_DEFAULT_LIMITS } from '@bsv/dpp-credentials/epcis-source'
import express, { Router, type NextFunction, type Request, type Response } from 'express'
import type { Session } from '../auth.js'
import { HttpError } from '../http-error.js'
import { EPCIS_UPLOAD_SOURCE, type EpcisExchange } from './exchange.js'
import { describeEpcisSource } from './sources.js'

export interface EpcisRoutesOptions {
  exchange: EpcisExchange
  /** The signed-in user behind a request. It throws the application's own 401 when there is none. */
  requireSession: (req: Request) => Promise<Session>
}

/** The status each refusal of a transport is answered with. Anything not named is 422: the bytes arrived and cannot be read as an EPCIS document. */
const REFUSAL_STATUS: Record<string, number> = {
  'unsupported-media-type': 415,
  oversized: 413,
  'invalid-request': 400,
  'gs1-artefact-unavailable': 503,
  'credentials-unavailable': 503,
  'pull-conflict': 409,
}

/**
 * A store may hold less in one record than the module can make of a document.
 * The MongoDB store refuses such a record before it writes anything of it,
 * and that refusal is answered as one, not as a failure of the API.
 */
async function withinStore<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof EpcisStorageError && error.code === 'invalid-value') throw new HttpError(413, 'record-too-large', `${what}: the record of what it holds is larger than this store keeps as one record. There is no import of it.`, { outcome: 'refused', kept: false })
    throw error
  }
}

const one = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)
const param = (req: Request, name: string): string => {
  const value = req.params[name]
  return Array.isArray(value) ? value[0]! : value!
}
const objectOf = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {})

export function epcisRoutes(options: EpcisRoutesOptions): Router {
  const { exchange, requireSession } = options
  const router = Router()
  const wrap = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).then((body) => {
      if (!res.headersSent) res.json(body)
    }, next)
  }
  // The module refuses a document past its limit with its own words. The parser's limit sits just above it, so only a body far past the limit is cut off unread.
  const exactBytes = express.raw({ type: () => true, limit: EPCIS_DEFAULT_LIMITS.maxDocumentBytes + 1024, inflate: false })
  const json = express.json({ limit: '256kb' })

  router.get(
    '/status',
    wrap(async (req) => {
      await requireSession(req)
      return exchange.status()
    })
  )

  router.get(
    '/sources',
    wrap(async (req) => {
      await requireSession(req)
      // What a source is, and whether a credential is set for it. Never the credential.
      return exchange.sources.map(describeEpcisSource)
    })
  )

  // ------------------------------------------------------------------ imports

  router.post(
    '/imports',
    exactBytes,
    wrap(async (req, res) => {
      await requireSession(req)
      const requestId = one(req.query.requestId)
      if (requestId == null) throw new HttpError(400, 'request-id-required', 'give requestId: an identifier you choose for this upload, so that sending it again is the same request')
      // The parser hands over a Buffer when there was a body. Anything else means none arrived.
      const bytes = Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : new Uint8Array(0)
      const outcome = await withinStore('the document was not imported', () =>
        exchange.importDocument({
          sourceId: one(req.query.sourceId) ?? EPCIS_UPLOAD_SOURCE,
          requestId,
          bytes,
          mediaType: req.headers['content-type'] ?? '',
          ...(one(req.query.filename) == null ? {} : { filename: one(req.query.filename) }),
        })
      )
      if (outcome.outcome === 'refused') {
        res.status(REFUSAL_STATUS[outcome.reason] ?? 422)
        return { error: outcome.reason, description: outcome.detail, ...(outcome.remedy == null ? {} : { remedy: outcome.remedy }), outcome: 'refused', kept: false }
      }
      if (outcome.outcome === 'request-conflict') {
        res.status(409)
        return { error: 'request-conflict', description: outcome.detail, outcome: 'request-conflict', kept: false, existingImportId: outcome.existingImportId }
      }
      res.status(outcome.replayed ? 200 : 201)
      return outcome
    })
  )

  router.get(
    '/imports',
    wrap(async (req) => {
      await requireSession(req)
      const limit = Math.min(Math.max(Math.trunc(Number(one(req.query.limit) ?? 50)) || 50, 1), 200)
      const after = one(req.query.after)
      const records = await exchange.listImports({ ...(after == null ? {} : { after }), limit })
      return {
        // A listing names each import and counts what it holds. The record itself is one request away.
        imports: records.map((record) => ({
          importId: record.importId,
          sourceId: record.sourceId,
          requestId: record.requestId,
          receivedAt: record.receivedAt,
          mediaType: record.mediaType,
          byteLength: record.byteLength,
          sha256: record.sha256,
          provenance: record.sourceLocation,
          state: record.state,
          documentValidity: record.documentValidity,
          events: record.events.length,
          findings: record.findings.length + record.events.reduce((sum, event) => sum + event.validation.findings.length, 0),
          conflicts: record.events.filter((event) => event.conflict?.state === 'open').length,
        })),
        ...(records.length === limit ? { next: records[records.length - 1]!.importId } : {}),
      }
    })
  )

  router.get(
    '/imports/:importId',
    wrap(async (req) => {
      await requireSession(req)
      const record = await exchange.getImport(param(req, 'importId'))
      if (record == null) throw new HttpError(404, 'import-unknown', 'no import with that identifier is held')
      return record
    })
  )

  router.get('/imports/:importId/original', (req, res, next) => {
    void (async () => {
      await requireSession(req)
      const original = await exchange.exportOriginal(param(req, 'importId'))
      if (original == null) throw new HttpError(404, 'import-unknown', 'no import with that identifier is held')
      // The retained bytes, under the media type they arrived with. A Buffer is sent as it is: nothing is parsed, formatted or given a character set.
      res.status(200)
      res.setHeader('content-type', original.mediaType)
      res.setHeader('content-length', String(original.byteLength))
      res.setHeader('content-disposition', `attachment; filename="epcis-${original.sha256.slice(0, 16)}.${original.mediaType === 'application/ld+json' ? 'jsonld' : 'json'}"`)
      res.setHeader('x-content-sha256', original.sha256)
      res.setHeader('cache-control', 'no-store')
      // What was uploaded is whatever someone uploaded. A browser is told to save it and not to guess at what it is.
      res.setHeader('x-content-type-options', 'nosniff')
      res.end(Buffer.from(original.bytes.buffer, original.bytes.byteOffset, original.bytes.byteLength))
    })().catch(next)
  })

  // ------------------------------------------------------------------ pulls

  router.post(
    '/sources/:sourceId/pulls',
    json,
    wrap(async (req, res) => {
      await requireSession(req)
      const body = objectOf(req.body)
      const queryId = one(body.queryId)
      if (queryId == null) throw new HttpError(400, 'query-id-required', 'give queryId: the name of this query, under which a later run continues it')
      const window = body.window === 'watermark' || body.window === 'query-bounds' ? body.window : undefined
      const outcome = await withinStore('the run stopped at a page it could not import', () => exchange.pull({ sourceId: param(req, 'sourceId'), queryId, query: objectOf(body.query), ...(window == null ? {} : { window }) }))
      if (outcome == null) throw new HttpError(404, 'source-unknown', `no EPCIS source named ${param(req, 'sourceId')} is configured`)
      if (outcome.outcome === 'refused') {
        res.status(REFUSAL_STATUS[outcome.reason] ?? 400)
        return { error: outcome.reason, description: outcome.detail, ...(outcome.remedy == null ? {} : { remedy: outcome.remedy }), outcome: 'refused', requested: false }
      }
      // A run that ran is answered 200 whatever it found. Its outcome, reason and completion are the module's, as they are.
      return outcome
    })
  )

  router.get(
    '/sources/:sourceId/pulls/:queryId',
    wrap(async (req) => {
      await requireSession(req)
      const held = await exchange.getPull(param(req, 'sourceId'), param(req, 'queryId'))
      if (held == null) throw new HttpError(404, 'pull-unknown', 'that query has not been run against that source')
      return held
    })
  )

  // ------------------------------------------------------------------ events

  router.get(
    '/events',
    wrap(async (req) => {
      await requireSession(req)
      const identifier = one(req.query.identifier)
      if (identifier == null || identifier.length > 2048) throw new HttpError(400, 'identifier-required', 'give identifier: the product identifier exactly as events write it')
      const granularity = one(req.query.granularity) ?? 'instance'
      if (granularity !== 'instance' && granularity !== 'class') throw new HttpError(400, 'granularity-unknown', 'granularity is instance, for one item, or class, for a class, a lot or a pattern')
      const sourceId = one(req.query.sourceId)
      const after = one(req.query.after)
      const limit = Math.min(Math.max(Math.trunc(Number(one(req.query.limit) ?? 100)) || 100, 1), 200)
      const page = await exchange.eventsFor({ identifier, granularity, ...(sourceId == null ? {} : { sourceId }), ...(after == null ? {} : { after }), limit })
      return {
        identifier,
        granularity,
        // Said with every answer, so no reader of this route takes a retained event for more than it is.
        nature: 'supplied-data',
        notice: 'These events are data a source supplied. A valid document passed a format check. It is not signed, and nothing here verifies who observed an event or that it happened.',
        ...page,
      }
    })
  )

  // ------------------------------------------------------------------ conflicts

  router.get(
    '/conflicts',
    wrap(async (req) => {
      await requireSession(req)
      return await exchange.listConflicts()
    })
  )

  router.get(
    '/conflicts/:conflictId',
    wrap(async (req) => {
      await requireSession(req)
      const conflict = await exchange.getConflict(param(req, 'conflictId'))
      if (conflict == null) throw new HttpError(404, 'conflict-unknown', 'no event identity with more than one body is held under that identifier')
      return conflict
    })
  )

  router.post(
    '/conflicts/:conflictId/resolutions',
    json,
    wrap(async (req, res) => {
      const session = await requireSession(req)
      const body = objectOf(req.body)
      const outcome = await exchange.resolveConflict({
        conflictId: param(req, 'conflictId'),
        decision: typeof body.decision === 'string' ? body.decision : '',
        disposition: body.disposition as never,
        ...(body.selectedBodyDigest === undefined ? {} : { selectedBodyDigest: body.selectedBodyDigest as string }),
        ...(typeof body.decidedAt === 'string' ? { decidedAt: body.decidedAt } : {}),
        // Who decided, as this application names its users. Never a credential.
        decidedBy: session.userId,
      })
      if (outcome.outcome === 'refused') {
        res.status(outcome.reason === 'no-conflict' ? 404 : 400)
        return { error: outcome.reason, description: outcome.detail, outcome: 'refused' }
      }
      res.status(outcome.replayed ? 200 : 201)
      return outcome
    })
  )

  // A body the parsers refused: too large, or sent under a content encoding. The parser's own error can quote the body, so only its kind is answered.
  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    const parser = error as { type?: unknown; status?: unknown }
    if (typeof parser?.type !== 'string' || typeof parser.status !== 'number') return next(error)
    if (parser.type === 'entity.too.large') {
      res.status(413).json({ error: 'oversized', description: 'the body is larger than this API reads. Nothing was kept.', outcome: 'refused', kept: false })
      return
    }
    if (parser.type === 'encoding.unsupported') {
      res.status(415).json({ error: 'content-encoding-unsupported', description: 'send the document as the bytes it is, without a content encoding. Nothing was kept.', outcome: 'refused', kept: false })
      return
    }
    next(error)
  })

  return router
}
