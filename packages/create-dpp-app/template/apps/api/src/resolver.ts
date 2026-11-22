// The identifier host. A passport identifier is a GS1 Digital Link minted
// under PASSPORT_HOST, and the standard's GS1 discovery profile
// (spec/gs1-discovery.md §1, rule 6) asks the host an identifier is minted
// under to be a GS1-Conformant Resolver for primary key 01. These routes are
// that resolver, and every rule of it comes from the reference helpers of
// @bsv/dpp-profiles: the description file at /.well-known/gs1resolver, and
// every path under /01/, which sends a browser to the page and gives a client
// that asks for the links the linkset.
//
// No record is stored. The records a request is resolved against are made
// from the journal: an item this application issued a passport for has its
// passport page as its default link, and its GTIN has the product page, which
// every other request under that GTIN walks up to. A link is listed only when
// this application serves its target. Reads are open, as every read here is.
import {
  GS1_LINK_TYPES,
  JSON_LD_CONTEXT_RELATION,
  LINKSET_CONTEXT_URI,
  LINKSET_MEDIA_TYPE,
  decompressGs1DigitalLink,
  describeResolver,
  gs1KeyOf,
  linksetDocument,
  parseAcceptHeader,
  parseAcceptLanguage,
  parseGs1DigitalLinkUri,
  resolutionRecordProblems,
  resolutionSetProblems,
  resolveLinks,
  uncompressedUri,
  type Gs1Key,
  type LinksetDocument,
  type ParsedGs1Uri,
  type ResolutionRecord,
} from '@bsv/dpp-profiles'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { HttpError } from './http-error.js'
import type { IdentifierPolicy } from './identifiers.js'
import type { Store } from './store.js'

export interface ResolverOptions {
  store: Store
  policy: IdentifierPolicy
}

/** The pages live under this path, each at its identifier's own path after it. The web app routes the same paths (apps/web/src/app.tsx). */
const PAGE_PREFIX = '/passport'
const METHODS = 'GET, HEAD, OPTIONS'
/** The special compressed form: one path segment that begins `eh` or `ex` and carries an EPC binary string, which is sixteen characters at its shortest. */
const COMPRESSED = /^\/e[hx][A-Za-z0-9_-]{16,}\/?$/
/** The revision of the rule the records are made by. Change it when the links below change. */
const CONFIGURATION_REVISION = 'journal-1'

export function resolverRoutes({ store, policy }: ResolverOptions): Router {
  const root = `https://${policy.host}`
  const description = describeResolver({ resolverRoot: root })
  const pageOf = (key: Gs1Key): string => `${root}${PAGE_PREFIX}${uncompressedUri('', key)}`

  /**
   * The records a request under one GTIN is resolved against. The item's record exists when the journal holds the
   * passport whose identifier is the item's own. The GTIN's record exists when the journal holds any passport under
   * that GTIN, and carries the one public default the profile's set check requires. Both checks of the profiles
   * package are applied to what is made here, so a change to these links that breaks a rule stops the answer.
   */
  async function recordsFor(key: Gs1Key): Promise<ResolutionRecord[]> {
    const product: Gs1Key = { ai: '01', value: key.value, qualifiers: [] }
    const serial = key.qualifiers.find((qualifier) => qualifier.ai === '21')
    const item: Gs1Key | undefined = serial == null ? undefined : { ...product, qualifiers: [serial] }
    const issued = item != null && (await store.getPassport(uncompressedUri(root, item))) != null
    if (!issued && !(await store.anyPassportUnder(`${uncompressedUri(root, product)}/21/`))) return []
    const records: ResolutionRecord[] = [{ key: { ai: '01', value: key.value }, qualifiers: [], configurationRevision: CONFIGURATION_REVISION, links: [{ rel: GS1_LINK_TYPES.pip, href: pageOf(product), title: 'Product information', default: 'single', disclosure: 'public' }] }]
    if (item != null && issued) records.unshift({ key: { ai: '01', value: key.value }, qualifiers: item.qualifiers, configurationRevision: CONFIGURATION_REVISION, links: [{ rel: GS1_LINK_TYPES.dpp, href: pageOf(item), title: 'Digital product passport', default: 'single', disclosure: 'public' }] })
    const problems = [...records.flatMap(resolutionRecordProblems), ...resolutionSetProblems(records)]
    if (problems.length > 0) throw new Error(`the resolver's records for GTIN ${key.value} are not admissible: ${problems.join('; ')}`)
    return records
  }

  /** The JSON linkset, with the Link header that names GS1's context for it (resolver standard §2.10). The context is named, never served: GS1 publishes it. */
  const sendLinkset = (res: Response, status: number, linkset: LinksetDocument): void => {
    res.status(status).set('Link', `<${LINKSET_CONTEXT_URI}>; rel="${JSON_LD_CONTEXT_RELATION}"; type="application/ld+json"`).type(LINKSET_MEDIA_TYPE).send(JSON.stringify(linkset))
  }

  /** Answer one identifier as the resolver standard's flow reads it: refuse what is malformed, then the linkset when it was asked for, or else a redirect. */
  async function resolve(req: Request, res: Response, parsed: ParsedGs1Uri, query: string): Promise<void> {
    if (parsed.kind !== 'uncompressed') throw new HttpError(400, 'identifier-malformed', parsed.kind === 'invalid' ? parsed.detail : 'a compressed form is read at the root of this host', { reason: parsed.kind === 'invalid' ? parsed.reason : 'no-primary-key' })
    // The resolver standard's validation includes the check digit (§2.4), and no passport here has a GTIN that fails it: the writer refuses one.
    if (!parsed.primaryKey.checkDigitValid) throw new HttpError(400, 'identifier-malformed', `the check digit of GTIN ${parsed.primaryKey.value} does not hold`, { reason: 'check-digit' })
    const key = gs1KeyOf(parsed)
    const records = await recordsFor(key)
    const accept = parseAcceptHeader(req.get('accept'))
    const request = { key, audience: 'public' as const, resolverRoot: root, accept, acceptLanguage: parseAcceptLanguage(req.get('accept-language')) }
    const unknown = (): HttpError => new HttpError(404, 'identifier-unknown', `this application issued no passport under ${uncompressedUri(root, { ...key, qualifiers: [] })}`)
    // The linkset is asked for by linkType=linkset or by its media type (§2.9), and a request for JSON alone gets the same answer (§2.10). It is never redirected.
    if (parsed.linkType?.linkset === true || accept.includes(LINKSET_MEDIA_TYPE) || (parsed.linkType == null && accept[0] === 'application/json')) {
      const linkset = linksetDocument(records, request)
      if (linkset == null) throw unknown()
      sendLinkset(res, 200, linkset)
      return
    }
    const outcome = resolveLinks(records, { ...request, linkType: parsed.linkType?.iri ?? parsed.linkType?.raw })
    switch (outcome.outcome) {
      case 'redirect':
        // 307 is the profile's choice of status, and the whole query string is passed on (§2.12). Every target is a page of this application, so it is
        // given as its path, which a client resolves against the address it asked: the redirect lands here at PASSPORT_HOST, behind a proxy and in development.
        res.redirect(307, `${new URL(outcome.link.href).pathname}${query}`)
        return
      case 'multiple-choices':
        sendLinkset(res, 300, linksetDocument(records, request) ?? { linkset: [] })
        return
      case 'not-found':
        throw new HttpError(404, 'link-type-unknown', `no link of type ${outcome.requested} is registered for ${uncompressedUri(root, key)}`)
      default:
        throw unknown()
    }
  }

  /** Every answer is open to any origin and says which request headers shaped it. OPTIONS is answered here, and a method other than GET and HEAD is refused. */
  const open =
    (handler: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction): void => {
      res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': METHODS, 'Access-Control-Allow-Headers': 'Accept, Accept-Language', 'Access-Control-Expose-Headers': 'Link', Vary: 'Accept, Accept-Language' })
      if (req.method === 'OPTIONS') {
        res.set('Allow', METHODS).status(204).end()
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.set('Allow', METHODS)
        next(new HttpError(405, 'method-not-allowed', `an identifier is read with ${METHODS}`))
        return
      }
      handler(req, res).catch(next)
    }

  const router = Router()
  router.all(
    '/.well-known/gs1resolver',
    open(async (_req, res) => {
      res.json(description)
    })
  )
  router.all(
    '/01{/*rest}',
    open(async (req, res) => {
      const uri = `${root}${req.originalUrl}`
      const parsed = parseGs1DigitalLinkUri(uri)
      await resolve(req, res, parsed, parsed.kind === 'invalid' ? '' : new URL(uri).search)
    })
  )
  // A compressed form carries a GTIN and a serial as an EPC binary string. It is decompressed and then answered as the identifier it spells (§2.3).
  router.all(
    COMPRESSED,
    open(async (req, res) => {
      const decompressed = decompressGs1DigitalLink(`${root}${req.originalUrl}`)
      if (!decompressed.ok) throw new HttpError(400, 'identifier-malformed', decompressed.detail, { reason: decompressed.reason })
      await resolve(req, res, parseGs1DigitalLinkUri(decompressed.uri), new URL(decompressed.uri).search)
    })
  )
  return router
}
