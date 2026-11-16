// Lifecycle claims on a page: the shapes the API sends, the words each
// finding is shown with, and the event a member enters, built from a form.
//
// An EPCIS lifecycle claim (`dpp-epcis-lifecycle@1`) is reported one finding
// at a time and never as one verdict. What was not checked says unknown.
// An anchor is shown as what it is: an anchoring service's commitment to the
// claim's bytes. It is never worded as proof that the event happened, that
// anyone owns the product, or that anything complies with a rule.
//
// A historical native claim (`dpp-lifecycle-v1`) is shown as historical. Its
// event type is one of four categories this application issued before it
// moved to EPCIS lifecycle claims, and is never shown as an EPCIS event.
//
// This module touches neither the page nor the network, so the API's tests
// hold its words to the answers the API really sends.

export type LifecycleTone = 'pass' | 'fail' | 'warn' | 'unknown' | 'muted' | 'neutral'

export interface LifecycleFinding {
  status: string
  reasonCode?: string
  detail?: unknown
  from?: string[]
  to?: string[]
}

export interface LifecycleFindings {
  eventStructure: LifecycleFinding
  eventSemantics: LifecycleFinding
  productBinding: LifecycleFinding
  signature: LifecycleFinding
  authority: LifecycleFinding
  possession: LifecycleFinding & { from: string[]; to: string[] }
  ownership: LifecycleFinding & { from: string[]; to: string[] }
  anchorCommitment: LifecycleFinding
  inclusion: LifecycleFinding
  correction: LifecycleFinding
}

export interface LifecycleBinding {
  passportId: string
  field: string
  identifier: string
  level: 'instance' | 'class'
  status: string
  reasonCode?: string
  detail?: unknown
}

export interface RegistryAnswer {
  url: string
  status: number
  accepted: boolean
  attestationId?: string
  detail?: string
}

export interface LifecycleClaimView {
  claimFormat: 'dpp-epcis-lifecycle@1'
  attestationId: string
  foundBy: Array<'anchor' | 'this-application'>
  held: boolean
  unavailable?: string
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
  bindingsHere: LifecycleBinding[]
  boundPassports: string[]
  itemParticipants: string[]
  declaresError: boolean
  findings?: LifecycleFindings
  relations: Array<{ digest: string; relation: string }>
  anchors: number
  record?: { id: string; issuedBy: string; createdAt: string; importedFrom?: { importId: string; pointer: string }; registry?: RegistryAnswer }
}

export interface HistoricalClaimView {
  claimFormat: 'dpp-lifecycle-v1'
  historical: true
  id: string
  passportId: string
  issuer: string
  issuedBy: string
  createdAt: string
  claim: { eventType: string; timestamp: string; recordId?: string; [key: string]: unknown }
  signature: string
  registry?: RegistryAnswer
}

export interface PassportClaimsReading {
  passportId: string
  historical: HistoricalClaimView[]
  lifecycle: LifecycleClaimView[]
  discovery: { index: 'asked' | 'unreachable'; indexDetail?: string; registry: 'configured' | 'not-configured' }
}

/* ------------------------------------------------------------------ words */

/** What every list of lifecycle claims says above it. */
export const LIFECYCLE_NOTICE =
  'Each claim is one EPCIS event a named party signed, bound to the passports whose products it names. Every finding below is reported on its own. A valid signature says which key signed, not that its holder saw the event. An anchor says an anchoring service committed to these exact bytes. Neither proves the event happened, who owns the product, or that anything complies with a rule.'

/** How a historical native claim is labelled wherever it is shown. */
export const HISTORICAL_LABEL = 'Historical native claim'
export const HISTORICAL_NOTICE =
  'A dpp-lifecycle-v1 claim, issued before this application moved to EPCIS lifecycle claims. It is kept exactly as it was signed and verified under its own rules. Its event type is one of four historical categories (Origin, Transfer, Transformation, Disposition) with their original meaning; it is not an EPCIS event and is not read as one.'

const ROLE_WORDS: Record<string, string> = {
  observer: 'as the observer of the event',
  owner: 'as the owner',
  custodian: 'as the custodian',
  'authorised-reporter': 'as a reporter of an event someone else observed',
}

export function roleWords(role: string | undefined): string {
  return role == null ? 'in no stated role' : (ROLE_WORDS[role] ?? `as ${role}`)
}

/** What verifying the claim established for the passport on the page. An anchor's subject never decides it. */
export function participationLabel(view: Pick<LifecycleClaimView, 'participation' | 'held' | 'foundBy'>): { tone: LifecycleTone; label: string; sentence: string } {
  if (view.participation === 'item') return { tone: 'neutral', label: 'This item', sentence: "The claim binds this passport's own item, and that binding verified under the identity rules." }
  if (view.participation === 'class') return { tone: 'muted', label: 'Its class only', sentence: "The claim names a class of products this passport's product belongs to. That does not say this item took part." }
  if (!view.held) return { tone: 'unknown', label: 'Not established', sentence: 'An anchor names this passport, and the claim it commits to could not be read here, so nothing about this passport is established.' }
  return {
    tone: 'warn',
    label: 'Not established',
    sentence: view.foundBy.includes('anchor') ? 'An anchor names this passport as its subject, but verifying the claim does not bind it to this passport. An anchor\'s subject alone never makes a passport part of an event.' : 'Verifying the claim does not bind it to this passport.',
  }
}

const reasonOf = (finding: LifecycleFinding): string => {
  if (finding.reasonCode == null) return ''
  return ` (${finding.reasonCode})`
}

const parties = (list: string[]): string => (list.length === 0 ? 'none' : list.join(', '))

/** One row per finding, in a fixed order, each with its own state and sentence. Nothing is folded into a verdict. */
export function findingRows(findings: LifecycleFindings): Array<{ key: keyof LifecycleFindings; label: string; status: string; tone: LifecycleTone; sentence: string }> {
  const tone = (status: string): LifecycleTone =>
    status === 'pass' || status === 'supported' ? 'pass' : status === 'fail' || status === 'refused' ? 'fail' : status === 'declared-in-error' ? 'warn' : status === 'asserted' || status === 'none' ? 'neutral' : status === 'not-asserted' ? 'muted' : 'unknown'
  const unknown = (what: string, finding: LifecycleFinding): string => `Unknown${reasonOf(finding)}: ${what}`
  const f = findings
  return [
    {
      key: 'eventStructure',
      label: 'Event structure',
      status: f.eventStructure.status,
      tone: tone(f.eventStructure.status),
      sentence: f.eventStructure.status === 'pass' ? 'The event has the members its EPCIS type requires and the pinned EPCIS 2.0.1 schema accepts it.' : f.eventStructure.status === 'fail' ? `The event is refused${reasonOf(f.eventStructure)}.` : unknown('the pinned schema was not applied here.', f.eventStructure),
    },
    {
      key: 'eventSemantics',
      label: 'Event semantics',
      status: f.eventSemantics.status,
      tone: tone(f.eventSemantics.status),
      sentence: f.eventSemantics.status === 'pass' ? 'The event names an observed object, and every extension rule it requires held.' : f.eventSemantics.status === 'fail' ? `The event does not hold together${reasonOf(f.eventSemantics)}.` : f.eventSemantics.status === 'unavailable' ? `Unavailable${reasonOf(f.eventSemantics)}: the event requires an extension rule this application does not hold.` : unknown('the event semantics were not checked.', f.eventSemantics),
    },
    {
      key: 'productBinding',
      label: 'Product binding',
      status: f.productBinding.status,
      tone: tone(f.productBinding.status),
      sentence: f.productBinding.status === 'pass' ? 'Every identifier the claim binds is where it says in the event, at the level it says, and denotes its passport\'s product under the identity rules.' : f.productBinding.status === 'fail' ? `A binding does not hold${reasonOf(f.productBinding)}.` : unknown('no product comparison was made.', f.productBinding),
    },
    {
      key: 'signature',
      label: 'Signature',
      status: f.signature.status,
      tone: tone(f.signature.status),
      sentence: f.signature.status === 'pass' ? 'The named key signed these exact bytes. That says who signed, not that the signer saw the event.' : f.signature.status === 'fail' ? `The signature does not verify${reasonOf(f.signature)}.` : unknown('the signature could not be read.', f.signature),
    },
    {
      key: 'authority',
      label: 'Authority',
      status: f.authority.status,
      tone: tone(f.authority.status),
      sentence: f.authority.status === 'supported' ? 'Evidence supports the role the issuer asserts, for every passport in its scope.' : f.authority.status === 'refused' ? `The role the issuer asserts is refused${reasonOf(f.authority)}.` : `Unavailable${reasonOf(f.authority)}: nothing here shows that the issuer holds the role it asserts. A valid signature and an account on this application are not that evidence.`,
    },
    {
      key: 'possession',
      label: 'Possession',
      status: f.possession.status,
      tone: tone(f.possession.status),
      sentence: f.possession.status === 'asserted' ? `The signed event states possessing parties, from ${parties(f.possession.from)} to ${parties(f.possession.to)}. That is what the issuer signed, not a fact this application established, and it says nothing about ownership.` : f.possession.status === 'not-asserted' ? 'The event names no possessing party. Nothing about possession is inferred from its business step, its disposition or any passport operation.' : unknown('the event was not read.', f.possession),
    },
    {
      key: 'ownership',
      label: 'Ownership',
      status: f.ownership.status,
      tone: tone(f.ownership.status),
      sentence: f.ownership.status === 'asserted' ? `The signed event states owning parties, from ${parties(f.ownership.from)} to ${parties(f.ownership.to)}. That is what the issuer signed, not legal ownership this application established.` : f.ownership.status === 'not-asserted' ? 'The event names no owning party. Nothing about ownership is inferred from possession, a sale, a business step or any passport operation.' : unknown('the event was not read.', f.ownership),
    },
    {
      key: 'anchorCommitment',
      label: 'Anchor',
      status: f.anchorCommitment.status,
      tone: tone(f.anchorCommitment.status),
      sentence: f.anchorCommitment.status === 'pass' ? 'An anchoring service committed to these exact bytes, with matching metadata. That proves the commitment only: not that the event happened, not who owns the product, and not compliance with anything.' : f.anchorCommitment.status === 'fail' ? `An anchor found for the claim does not match it${reasonOf(f.anchorCommitment)}.` : unknown('no anchor of the claim was found.', f.anchorCommitment),
    },
    {
      key: 'inclusion',
      label: 'Inclusion',
      status: f.inclusion.status,
      tone: tone(f.inclusion.status),
      sentence: f.inclusion.status === 'pass' ? 'The anchor transaction is in a block the header source holds. That dates the commitment, and proves nothing more about the event.' : f.inclusion.status === 'fail' ? `The inclusion proof does not hold${reasonOf(f.inclusion)}.` : unknown('no merkle path and header source were available.', f.inclusion),
    },
    {
      key: 'correction',
      label: 'Correction',
      status: f.correction.status,
      tone: tone(f.correction.status),
      sentence: f.correction.status === 'declared-in-error' ? 'The event is declared in error by a verified claim of its issuer. The original claim is kept exactly as it was signed.' : f.correction.status === 'none' ? 'No claim this application holds declares the event in error. Another party may hold one.' : unknown('whether the event was declared in error is not known.', f.correction),
    },
  ]
}

/** What the claim's correction state says, in one line for the list. */
export function correctionLabel(view: Pick<LifecycleClaimView, 'declaresError' | 'findings'>): { tone: LifecycleTone; label: string } | undefined {
  if (view.declaresError) return { tone: 'warn', label: 'Declares an earlier event in error' }
  if (view.findings?.correction.status === 'declared-in-error') return { tone: 'warn', label: 'Declared in error' }
  return undefined
}

/* ------------------------------------------------------------------ the form */

export const LIFECYCLE_EVENT_TYPES = ['ObjectEvent', 'AggregationEvent', 'TransactionEvent', 'TransformationEvent', 'AssociationEvent'] as const
export type LifecycleEventType = (typeof LIFECYCLE_EVENT_TYPES)[number]
export const LIFECYCLE_ACTIONS = ['ADD', 'OBSERVE', 'DELETE'] as const
export const LIFECYCLE_ROLES = ['observer', 'owner', 'custodian', 'authorised-reporter'] as const

/** A few CBV 2.0 business steps and dispositions, offered as suggestions. Any CBV term or an extension URI may be typed. */
export const SUGGESTED_BUSINESS_STEPS = ['commissioning', 'shipping', 'receiving', 'packing', 'unpacking', 'assembling', 'installing', 'removing', 'repairing', 'inspecting', 'sensor_reporting', 'retail_selling', 'collecting', 'disassembling', 'decommissioning', 'accepting', 'departing', 'arriving']
export const SUGGESTED_DISPOSITIONS = ['active', 'in_progress', 'in_transit', 'conformant', 'non_conformant', 'needs_replacement', 'retail_sold', 'inactive', 'destroyed']

/** Which identifier and quantity lists each event type has (EPCIS 2.0.1 section 7). A list the type does not have is not offered and never sent. */
export const EVENT_FIELDS: Record<LifecycleEventType, { action: boolean; lists: Array<'epcList' | 'childEPCs' | 'inputEPCList' | 'outputEPCList'>; parent: boolean; quantities: Array<'quantityList' | 'childQuantityList' | 'inputQuantityList' | 'outputQuantityList'>; transactions: boolean; transformationID: boolean }> = {
  ObjectEvent: { action: true, lists: ['epcList'], parent: false, quantities: ['quantityList'], transactions: true, transformationID: false },
  AggregationEvent: { action: true, lists: ['childEPCs'], parent: true, quantities: ['childQuantityList'], transactions: true, transformationID: false },
  TransactionEvent: { action: true, lists: ['epcList'], parent: true, quantities: ['quantityList'], transactions: true, transformationID: false },
  TransformationEvent: { action: false, lists: ['inputEPCList', 'outputEPCList'], parent: false, quantities: ['inputQuantityList', 'outputQuantityList'], transactions: true, transformationID: true },
  AssociationEvent: { action: true, lists: ['childEPCs'], parent: true, quantities: ['childQuantityList'], transactions: true, transformationID: false },
}

export interface LifecycleEventForm {
  type: LifecycleEventType
  eventID: string
  eventTime: string
  eventTimeZoneOffset: string
  action: string
  bizStep: string
  disposition: string
  /** One identifier per line, for each list the type has. */
  epcList: string
  childEPCs: string
  inputEPCList: string
  outputEPCList: string
  parentID: string
  /** One quantity element per line: the class, then optionally a quantity and a unit code. */
  quantityList: string
  childQuantityList: string
  inputQuantityList: string
  outputQuantityList: string
  /** One business transaction per line: its type, then its identifier, or the identifier alone. */
  bizTransactionList: string
  transformationID: string
  readPoint: string
  bizLocation: string
  /** One source or destination per line: its type (owning_party, possessing_party or location), then the party or place. */
  sourceList: string
  destinationList: string
  /** The sensor elements as EPCIS JSON, exactly as they are to be signed. */
  sensorElementList: string
}

export function emptyEventForm(identifier = '', now = new Date(), eventID = `urn:uuid:${globalThis.crypto.randomUUID()}`): LifecycleEventForm {
  return {
    type: 'ObjectEvent', eventID, eventTime: now.toISOString(), eventTimeZoneOffset: '+00:00', action: 'OBSERVE', bizStep: '', disposition: '',
    epcList: identifier, childEPCs: '', inputEPCList: '', outputEPCList: '', parentID: '',
    quantityList: '', childQuantityList: '', inputQuantityList: '', outputQuantityList: '',
    bizTransactionList: '', transformationID: '', readPoint: '', bizLocation: '', sourceList: '', destinationList: '', sensorElementList: '',
  }
}

const lines = (text: string): string[] => text.split('\n').map((line) => line.trim()).filter((line) => line !== '')

/**
 * The EPCIS event the form describes, or what is wrong with it. Only the
 * members the event type has are sent: a TransformationEvent never gets an
 * action. Empty fields are left out, never sent empty. Nothing is added that
 * the member did not enter, apart from the identifiers the form starts with.
 */
export function eventFromForm(form: LifecycleEventForm): { event: Record<string, unknown> } | { problems: string[] } {
  const problems: string[] = []
  const shape = EVENT_FIELDS[form.type]
  const event: Record<string, unknown> = { type: form.type, eventTime: form.eventTime.trim(), eventTimeZoneOffset: form.eventTimeZoneOffset.trim(), eventID: form.eventID.trim() }
  if (shape.action) event.action = form.action
  if (shape.parent && form.parentID.trim() !== '') event.parentID = form.parentID.trim()
  for (const list of shape.lists) if (lines(form[list]).length > 0) event[list] = lines(form[list])
  for (const list of shape.quantities) {
    const elements = lines(form[list]).map((line, i) => {
      const [epcClass, quantity, uom] = line.split(/\s+/)
      const element: Record<string, unknown> = { epcClass }
      if (quantity != null) {
        const value = Number(quantity)
        if (!Number.isFinite(value)) problems.push(`${list} line ${i + 1}: ${quantity} is not a quantity`)
        element.quantity = value
      }
      if (uom != null) element.uom = uom
      return element
    })
    if (elements.length > 0) event[list] = elements
  }
  if (form.bizStep.trim() !== '') event.bizStep = form.bizStep.trim()
  if (form.disposition.trim() !== '') event.disposition = form.disposition.trim()
  if (form.readPoint.trim() !== '') event.readPoint = { id: form.readPoint.trim() }
  if (form.bizLocation.trim() !== '') event.bizLocation = { id: form.bizLocation.trim() }
  if (shape.transactions && lines(form.bizTransactionList).length > 0) {
    event.bizTransactionList = lines(form.bizTransactionList).map((line) => {
      const [first, second] = line.split(/\s+/)
      return second == null ? { bizTransaction: first } : { type: first, bizTransaction: second }
    })
  }
  if (shape.transformationID && form.transformationID.trim() !== '') event.transformationID = form.transformationID.trim()
  for (const [list, member] of [['sourceList', 'source'], ['destinationList', 'destination']] as const) {
    const entries = lines(form[list]).map((line, i) => {
      const [type, value] = line.split(/\s+/)
      if (value == null) problems.push(`${list} line ${i + 1}: give a type (owning_party, possessing_party or location) and then the party or place`)
      return { type, [member]: value }
    })
    if (entries.length > 0) event[list] = entries
  }
  if (form.sensorElementList.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(form.sensorElementList)
      if (!Array.isArray(parsed)) problems.push('the sensor elements are a JSON list of sensor elements')
      else event.sensorElementList = parsed
    } catch {
      problems.push('the sensor elements are not JSON')
    }
  }
  return problems.length > 0 ? { problems } : { event }
}
