// EPCIS lifecycle claims in this application (`dpp-epcis-lifecycle@1`, the
// standard's spec/epcis-lifecycle-claim.md): which of this platform's
// passports an EPCIS event names, the product comparison a verifier is given,
// the pinned schema check, and the reading of every claim that concerns one
// passport, found by its anchors and confirmed by verifying the claim.
//
// Nothing here maps a passport operation, a metadata edit or a sale to an
// event. The only input is an EPCIS event a member entered or one the EPCIS
// exchange retained, and an event that names none of this platform's
// passports binds nothing.
import { Utils, type ChainTracker } from '@bsv/sdk'
import { EPCIS_CONTEXT_IRI, classifyEpcisIdentifier, validateEpcisDocument } from '@bsv/dpp-credentials/epcis-source'
import { gs1KeyOf, granularityOf, parseGs1DigitalLinkUri, sameGs1Key, type AiValue, type Gs1Key } from '@bsv/dpp-profiles'
import {
  decodeAttestationAnchor,
  verifyLifecycleClaim,
  type PartialCheck,
  type SignedLifecycleClaim,
} from '@bsv/dpp-protocol'
import {
  EPCIS_LIFECYCLE_CLASS_FIELDS,
  EPCIS_LIFECYCLE_INSTANCE_FIELDS,
  EPCIS_LIFECYCLE_REPRESENTATION,
  parseEpcisLifecycleClaim,
  verifyEpcisLifecycleClaim,
  type EpcisLifecycleAnchorEvidence,
  type EpcisLifecycleBinding,
  type EpcisLifecycleBindingField,
  type EpcisLifecycleBindingResult,
  type EpcisLifecycleComparisonInput,
  type EpcisLifecycleFindings,
  type EpcisLifecycleRelation,
} from '@bsv/dpp-credentials/epcis-lifecycle'
import type { IndexClient } from './index-client.js'
import { isEpcisLifecycleRecord, type ClaimRecord, type ClaimRegistryAnswer, type EpcisLifecycleClaimRecord, type Store } from './store.js'

/* ------------------------------------------------------------ identity rules */

/** The GS1 key of a passport identifier, when it is a GS1 Digital Link of one item; anything else is not compared. */
function passportKey(passportId: string): Gs1Key | undefined {
  const parsed = parseGs1DigitalLinkUri(passportId)
  if (parsed.kind !== 'uncompressed' || !parsed.primaryKey.checkDigitValid) return undefined
  const key = gs1KeyOf({ gtin: parsed.primaryKey.value, qualifiers: parsed.qualifiers })
  return granularityOf(key.qualifiers) === 'item' ? key : undefined
}

/**
 * The GS1 key an event identifier names, read by the profiles package's
 * identity rules: a GS1 Digital Link is parsed as one, and an SGTIN or LGTIN
 * URN or an SGTIN pattern is read for its GTIN, lot and serial. Nothing is
 * rewritten. A form these rules do not read is unknown, never a match.
 */
function identifierKey(identifier: string): { key: Gs1Key; item: boolean } | { unknown: string } | { invalid: string } {
  if (/^https?:\/\//.test(identifier)) {
    const parsed = parseGs1DigitalLinkUri(identifier)
    if (parsed.kind !== 'uncompressed') return { unknown: `${identifier} is not an uncompressed GS1 Digital Link the identity rules read` }
    if (!parsed.primaryKey.checkDigitValid) return { invalid: `the GTIN in ${identifier} has a wrong check digit` }
    const key = gs1KeyOf({ gtin: parsed.primaryKey.value, qualifiers: parsed.qualifiers })
    return { key, item: granularityOf(key.qualifiers) === 'item' }
  }
  const finding = classifyEpcisIdentifier('identifier', identifier)
  if (finding.gtin == null || finding.problem != null) return { unknown: `${identifier} is not a GS1 trade item identifier the identity rules read${finding.problem == null ? '' : ` (${finding.problem})`}` }
  const qualifiers: AiValue[] = []
  if (finding.lot != null) qualifiers.push({ ai: '10', value: finding.lot })
  if (finding.serial != null) qualifiers.push({ ai: '21', value: finding.serial })
  const key = gs1KeyOf({ gtin: finding.gtin, qualifiers })
  return { key, item: finding.scheme === 'gs1-sgtin' && granularityOf(key.qualifiers) === 'item' }
}

/**
 * Whether an event identifier denotes the passport's product (spec/profiles.md
 * section 7, through `@bsv/dpp-profiles`). An instance binding holds when the
 * identifier names the passport's own item: same GTIN at fourteen digits, same
 * serial, host not compared. A class binding holds when the class carries the
 * passport's GTIN, and it never says the passport's item took part.
 */
export function compareLifecycleProduct(input: Pick<EpcisLifecycleComparisonInput, 'passportId' | 'identifier' | 'level'>): PartialCheck {
  const passport = passportKey(input.passportId)
  if (passport == null) return { status: 'unknown', reasonCode: 'x-comparison-unsupported', detail: `${input.passportId} is not a GS1 Digital Link of one item, so the identity rules do not compare it` }
  const named = identifierKey(input.identifier)
  if ('unknown' in named) return { status: 'unknown', reasonCode: 'x-comparison-unsupported', detail: named.unknown }
  if ('invalid' in named) return { status: 'fail', reasonCode: 'stated-gtin-invalid', detail: named.invalid }
  if (input.level === 'instance') {
    if (!named.item) return { status: 'fail', reasonCode: 'x-class-as-item', detail: `${input.identifier} names a model, a lot or a pattern, which never stands in for the passport's item` }
    return sameGs1Key(named.key, passport) ? { status: 'pass', detail: `${input.identifier} names the passport's item under the identity rules` } : { status: 'fail', reasonCode: 'subject-mismatch', detail: `${input.identifier} is not the item ${input.passportId}` }
  }
  return named.key.value === passport.value
    ? { status: 'pass', detail: `${input.identifier} names a class that carries the passport's GTIN; it names no individual item${named.key.qualifiers.some((q) => q.ai === '10') ? ', and the lot is not compared' : ''}` }
    : { status: 'fail', reasonCode: 'subject-mismatch', detail: `${input.identifier} is not a class of ${input.passportId}` }
}

/** An identifier of the event that names none of the passports given, and why. */
export interface UnboundIdentifier {
  field: EpcisLifecycleBindingField
  identifier: string
  reason: string
}

/**
 * The bindings an event supports to the passports given: every identifier in
 * an object list or a parent (instance level) and every quantity element's
 * class (class level), matched under the identity rules. An identifier that
 * names a class inside an object list binds nothing, because a class is bound
 * through a quantity list only.
 */
export function bindingsFor(event: Record<string, unknown>, passportIds: string[]): { bindings: EpcisLifecycleBinding[]; unbound: UnboundIdentifier[] } {
  const bindings: EpcisLifecycleBinding[] = []
  const unbound: UnboundIdentifier[] = []
  const consider = (field: EpcisLifecycleBindingField, identifier: unknown, level: 'instance' | 'class'): void => {
    if (typeof identifier !== 'string') return
    const answers = passportIds.map((passportId) => ({ passportId, answer: compareLifecycleProduct({ passportId, identifier, level }) }))
    const matched = answers.filter((a) => a.answer.status === 'pass')
    for (const { passportId } of matched) {
      if (!bindings.some((b) => b.passportId === passportId && b.field === field && b.identifier === identifier)) bindings.push({ passportId, field, identifier, level })
    }
    if (matched.length === 0) {
      const classInList = answers.find((a) => a.answer.reasonCode === 'x-class-as-item')
      unbound.push({ field, identifier, reason: classInList != null ? 'it names a class of products inside a list of individual objects, so it binds no item; a class is bound through a quantity list' : 'it names none of the passports this application holds' })
    }
  }
  for (const field of EPCIS_LIFECYCLE_INSTANCE_FIELDS) {
    const value = event[field]
    if (field === 'parentID') consider(field, value, 'instance')
    else if (Array.isArray(value)) for (const identifier of value) consider(field, identifier, 'instance')
  }
  for (const field of EPCIS_LIFECYCLE_CLASS_FIELDS) {
    const value = event[field]
    if (Array.isArray(value)) for (const element of value) if (element != null && typeof element === 'object') consider(field, (element as Record<string, unknown>).epcClass, 'class')
  }
  return { bindings, unbound }
}

/* ------------------------------------------------------------ the pinned schema */

export type EventSchemaCheck = (event: Record<string, unknown>) => PartialCheck

/**
 * The pinned EPCIS 2.0.1 schema check, from the GS1 files the EPCIS exchange
 * provisioned. The event is checked as the one event of a document, so the
 * schema reads it as it reads an imported one. Without the files the answer
 * is `unknown`, never `pass`.
 */
export function eventSchemaCheck(artefactsDir: string): EventSchemaCheck {
  return (event) => {
    try {
      const document = { '@context': [EPCIS_CONTEXT_IRI], type: 'EPCISDocument', schemaVersion: '2.0', creationDate: new Date().toISOString(), epcisBody: { eventList: [event] } }
      const result = validateEpcisDocument(document, { artefactsDir })
      const errors = result.findings.filter((finding) => finding.severity === 'error')
      if (result.schema === 'pass' && errors.length === 0) return { status: 'pass', detail: 'the pinned EPCIS 2.0.1 JSON schema accepted the event' }
      return { status: 'fail', reasonCode: 'schema-invalid', detail: errors.map((finding) => `${finding.path.replace('/epcisBody/eventList/0', '') || '/'}: ${finding.message}`) }
    } catch (cause) {
      return { status: 'unknown', reasonCode: 'schema-unavailable', detail: cause instanceof Error ? cause.message : String(cause) }
    }
  }
}

/* ------------------------------------------------------------ reading */

/** A historical native claim, read under its own rules and shown as what it is. */
export interface HistoricalClaimView {
  claimFormat: 'dpp-lifecycle-v1'
  historical: true
  id: string
  passportId: string
  issuer: string
  issuedBy: string
  createdAt: string
  /** The signed native claim, exactly as it was signed. Its event type is one of the four historical categories and keeps that meaning. */
  claim: SignedLifecycleClaim
  /** The native claim's own signature check (spec/rules.md section 3). */
  signature: string
  registry?: ClaimRegistryAnswer
}

/** One EPCIS lifecycle claim as it concerns one passport: how it was found, what verifying it established, and each finding on its own. */
export interface LifecycleClaimView {
  claimFormat: 'dpp-epcis-lifecycle@1'
  attestationId: string
  /** `anchor`: an anchor on the index names this passport as its subject. `this-application`: this application holds the claim and it binds the passport. */
  foundBy: Array<'anchor' | 'this-application'>
  /** Whether the claim's bytes were available to verify. */
  held: boolean
  unavailable?: string
  /** What verifying the claim established for this passport: its item took part, a class it belongs to took part, or nothing was established. An anchor's subject never decides this. */
  participation: 'item' | 'class' | 'not-established'
  digest?: string
  eventId?: string
  eventType?: string
  event?: Record<string, unknown>
  issuer?: string
  assertedRole?: string
  authorityScope?: string[]
  issuedAt?: string
  source?: Record<string, unknown>
  /** The bindings that name this passport, as verified. */
  bindingsHere: EpcisLifecycleBindingResult[]
  boundPassports: string[]
  itemParticipants: string[]
  /** The claim's own event declares an earlier event in error. */
  declaresError: boolean
  findings?: EpcisLifecycleFindings
  relations: Array<{ digest: string; relation: EpcisLifecycleRelation }>
  anchors: number
  record?: { id: string; issuedBy: string; createdAt: string; importedFrom?: { importId: string; pointer: string }; registry?: ClaimRegistryAnswer }
}

export interface PassportClaimsReading {
  passportId: string
  historical: HistoricalClaimView[]
  lifecycle: LifecycleClaimView[]
  discovery: { index: 'asked' | 'unreachable'; indexDetail?: string; registry: 'configured' | 'not-configured' }
}

export interface ClaimsReaderOptions {
  store: Store
  index: IndexClient
  registry?: { url: string }
  chainTracker?: ChainTracker
  schemaCheck?: EventSchemaCheck
}

export const historicalView = (record: ClaimRecord & { claim: SignedLifecycleClaim }): HistoricalClaimView => ({
  claimFormat: 'dpp-lifecycle-v1',
  historical: true,
  id: record.id,
  passportId: record.passportId,
  issuer: record.issuer,
  issuedBy: record.issuedBy,
  createdAt: record.createdAt,
  claim: record.claim,
  signature: verifyLifecycleClaim(record.claim).signature,
  ...(record.registry == null ? {} : { registry: record.registry }),
})

/** The claim's bytes from the registry's proof route, when this application does not hold them. The registry contract carries a current record's exact bytes as `securedBytes`. */
async function bytesFromRegistry(registry: { url: string } | undefined, attestationId: string): Promise<{ bytes: string } | { unavailable: string }> {
  if (registry == null) return { unavailable: 'this application does not hold the claim, and no registry is configured to fetch its bytes from' }
  try {
    const response = await fetch(`${registry.url}/attestations/${encodeURIComponent(attestationId)}/proof`)
    if (!response.ok) return { unavailable: `the registry answered HTTP ${response.status} for the claim's bytes` }
    const body = (await response.json()) as { securedBytes?: unknown }
    return typeof body.securedBytes === 'string' ? { bytes: body.securedBytes } : { unavailable: 'the registry returned no bytes for the claim' }
  } catch (cause) {
    return { unavailable: `the registry could not be reached (${cause instanceof Error ? cause.message : String(cause)})` }
  }
}

/**
 * Verify one claim's bytes as they concern one passport. The anchors are
 * every anchor the index holds for the claim; the related claims are every
 * claim this application holds under the same event identifier, which is
 * the complete set it holds, so the correction state is `none` only when none
 * of them declares the event in error.
 */
export async function readLifecycleClaim(bytes: string, passportId: string, options: ClaimsReaderOptions & { anchors?: EpcisLifecycleAnchorEvidence[]; foundBy: LifecycleClaimView['foundBy']; record?: EpcisLifecycleClaimRecord }): Promise<LifecycleClaimView> {
  let eventId: unknown
  try {
    eventId = parseEpcisLifecycleClaim(bytes).event.eventID
  } catch {
    eventId = undefined
  }
  const related = typeof eventId !== 'string' ? [] : (await options.store.listClaims({ eventId })).filter(isEpcisLifecycleRecord).filter((r) => r.bytes !== bytes).map((r) => r.bytes)
  const v = await verifyEpcisLifecycleClaim(bytes, {
    expected: { passportId },
    compareProduct: compareLifecycleProduct,
    ...(options.schemaCheck == null ? {} : { eventSchemaValidator: options.schemaCheck }),
    ...(options.anchors == null || options.anchors.length === 0 ? {} : { anchors: options.anchors }),
    ...(options.chainTracker == null ? {} : { chainTracker: options.chainTracker }),
    related: { claims: related, complete: true },
  })
  const bindingsHere = v.bindings.filter((b) => b.passportId === passportId)
  const sound = v.findings.signature.status === 'pass' && v.findings.eventStructure.status !== 'fail'
  const participation: LifecycleClaimView['participation'] = !sound ? 'not-established' : v.itemParticipants.includes(passportId) ? 'item' : bindingsHere.some((b) => b.level === 'class' && b.status === 'pass') ? 'class' : 'not-established'
  const record = options.record
  return {
    claimFormat: 'dpp-epcis-lifecycle@1',
    attestationId: v.attestationId ?? `urn:sha256:${v.digest}`,
    foundBy: options.foundBy,
    held: true,
    participation,
    digest: v.digest,
    ...(v.eventId == null ? {} : { eventId: v.eventId }),
    ...(v.eventType == null ? {} : { eventType: v.eventType }),
    ...(v.claim == null
      ? {}
      : { event: v.claim.event, issuer: v.claim.issuer, assertedRole: v.claim.assertedRole, authorityScope: v.claim.authorityScope, issuedAt: v.claim.issuedAt, ...(v.claim.source == null ? {} : { source: v.claim.source as unknown as Record<string, unknown> }) }),
    bindingsHere,
    boundPassports: v.boundPassports,
    itemParticipants: v.itemParticipants,
    declaresError: v.claim?.event.errorDeclaration !== undefined,
    findings: v.findings,
    relations: v.relations,
    anchors: options.anchors?.length ?? 0,
    ...(record == null ? {} : { record: { id: record.id, issuedBy: record.issuedBy, createdAt: record.createdAt, ...(record.importedFrom == null ? {} : { importedFrom: record.importedFrom }), ...(record.registry == null ? {} : { registry: record.registry }) } }),
  }
}

/** The anchors the index holds for one claim, as evidence a verifier takes. */
async function anchorsOfClaim(index: IndexClient, attestationId: string): Promise<EpcisLifecycleAnchorEvidence[]> {
  return (await index.anchorsFor({ attestationId }, EPCIS_LIFECYCLE_REPRESENTATION)).map((found) => ({ transaction: found.transaction, outputIndex: found.outputIndex }))
}

/**
 * Every claim that concerns one passport. Historical native claims are read
 * under their own rules. EPCIS lifecycle claims are found two ways: by the
 * anchors on the index whose subject is the passport, and among the claims
 * this application holds that bind it. Each one found is verified, and only
 * the verified bindings say whether the passport took part: an anchor that
 * names the passport while the claim binds it to nothing is listed as found
 * and not established.
 */
export async function readPassportClaims(passportId: string, options: ClaimsReaderOptions): Promise<PassportClaimsReading> {
  const held = await options.store.listClaims({ passportId })
  const historical = held.filter((r): r is ClaimRecord & { claim: SignedLifecycleClaim } => !isEpcisLifecycleRecord(r)).map(historicalView)
  const local = held.filter(isEpcisLifecycleRecord)

  const found = new Map<string, { foundBy: Set<'anchor' | 'this-application'>; record?: EpcisLifecycleClaimRecord }>()
  for (const record of local) found.set(record.attestationId, { foundBy: new Set(['this-application']), record })
  let index: PassportClaimsReading['discovery']['index'] = 'asked'
  let indexDetail: string | undefined
  let everyHeld: EpcisLifecycleClaimRecord[] | undefined
  try {
    for (const anchor of await options.index.anchorsFor({ subject: passportId }, EPCIS_LIFECYCLE_REPRESENTATION)) {
      const decoded = decodeAttestationAnchor(anchor.transaction.outputs[anchor.outputIndex]!.lockingScript)
      if (decoded == null) continue
      const entry = found.get(decoded.attestationId) ?? { foundBy: new Set() }
      entry.foundBy.add('anchor')
      // A claim this application holds is found by its identifier, even when it does not bind this passport.
      everyHeld ??= (await options.store.listClaims()).filter(isEpcisLifecycleRecord)
      entry.record ??= everyHeld.find((r) => r.attestationId === decoded.attestationId)
      found.set(decoded.attestationId, entry)
    }
  } catch (cause) {
    index = 'unreachable'
    indexDetail = cause instanceof Error ? cause.message : String(cause)
  }

  const lifecycle: LifecycleClaimView[] = []
  for (const [attestationId, entry] of found) {
    const foundBy = [...entry.foundBy].sort()
    const obtained = entry.record != null ? { bytes: entry.record.bytes } : await bytesFromRegistry(options.registry, attestationId)
    if ('unavailable' in obtained) {
      lifecycle.push({ claimFormat: 'dpp-epcis-lifecycle@1', attestationId, foundBy, held: false, unavailable: obtained.unavailable, participation: 'not-established', bindingsHere: [], boundPassports: [], itemParticipants: [], declaresError: false, relations: [], anchors: 0 })
      continue
    }
    const text = obtained.bytes
    let anchors: EpcisLifecycleAnchorEvidence[] = []
    if (index === 'asked') {
      try {
        anchors = await anchorsOfClaim(options.index, attestationId)
      } catch {
        anchors = []
      }
    }
    const view = await readLifecycleClaim(text, passportId, { ...options, anchors, foundBy, ...(entry.record == null ? {} : { record: entry.record }) })
    if (view.attestationId !== attestationId) {
      lifecycle.push({ claimFormat: 'dpp-epcis-lifecycle@1', attestationId, foundBy, held: false, unavailable: `the bytes obtained for the claim have the digest ${view.digest ?? 'unknown'}, not the one its identifier names, so they were not read`, participation: 'not-established', bindingsHere: [], boundPassports: [], itemParticipants: [], declaresError: false, relations: [], anchors: anchors.length })
      continue
    }
    lifecycle.push(view)
  }
  lifecycle.sort((a, b) => String(b.issuedAt ?? '').localeCompare(String(a.issuedAt ?? '')) || a.attestationId.localeCompare(b.attestationId))
  return { passportId, historical, lifecycle, discovery: { index, ...(indexDetail == null ? {} : { indexDetail }), registry: options.registry == null ? 'not-configured' : 'configured' } }
}

/** The UTF-8 text of claim bytes. */
export const claimText = (bytes: number[]): string => Utils.toUTF8(bytes)
