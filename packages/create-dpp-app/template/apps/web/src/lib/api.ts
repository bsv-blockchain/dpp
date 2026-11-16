// The API client: one fetch wrapper that turns the API's { error, description }
// answer into an Error, and a typed helper for every route in apps/api/API.md.
// Reads are open; writes carry the session cookie, which a same-origin fetch
// sends by itself.

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  /** Everything else the API put in its answer: for a refused product document, the validation with its findings. */
  readonly details: Record<string, unknown>

  constructor(message: string, code: string, status: number, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export const isNotFound = (error: unknown): boolean => error instanceof ApiError && error.status === 404

async function request<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { accept: 'application/json' } }
  if (body !== undefined) {
    init.headers = { ...init.headers, 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const response = await fetch(path, init)
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = text === '' ? undefined : JSON.parse(text)
  } catch {
    parsed = undefined
  }
  if (!response.ok) {
    const failure = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as { error?: string; description?: string } & Record<string, unknown>
    const { error: code, description, ...details } = failure
    throw new ApiError(description ?? `the API answered HTTP ${response.status}`, code ?? `http-${response.status}`, response.status, details)
  }
  if (parsed === undefined) throw new ApiError('the API answered with something that is not JSON', 'not-json', response.status)
  return parsed as T
}

const get = <T>(path: string): Promise<T> => request<T>(path)
const post = <T>(path: string, body: unknown = {}): Promise<T> => request<T>(path, 'POST', body)

/** A passport reference for a URL: the identifier, URL-encoded once. */
export const passportRef = (passportId: string): string => encodeURIComponent(passportId)

// ------------------------------------------------------------------ shapes

export interface Health {
  ok: boolean
  network: 'main' | 'test'
  /** The index in use: in this process until the app has joined the configured one. */
  index: { url: string; joined: boolean; inProcess: boolean; configured?: string }
  publisherKey: string
  wallet: 'toolbox' | 'test'
  livePublishing: boolean
  /** False when the validation libraries did not load: a profile held by a binding then cannot be written, and its readings say "not checked". */
  validationEngine: boolean
  identifiers: { host: string; prefix: string; demonstration: boolean }
  signIn: boolean
  devSession?: { name: string; brandIds: string[] }
}

export interface ProfileSummary {
  id: string
  title: string
  description?: string
  /** `manifest`: a field list this application's form is drawn from. `binding`: a data model defined elsewhere, written as one product document. */
  format: 'manifest' | 'binding'
}

export interface CodeList {
  closed: boolean
  options: Array<{ value: string; label: string }>
}

export interface Constraints {
  minimum?: number
  maximum?: number
  step?: number
  pattern?: string
  patternHint?: string
  maxLength?: number
}

export interface ProfileField {
  key: string
  label: string
  valueType: string
  unit?: string
  accessTier: string
  obligation: 'required' | 'recommended' | 'optional'
  codeList?: CodeList
  constraints?: Constraints
  note?: string
  group?: string
  /** Not sent by the API today; read when present. */
  cardinality?: 'one' | 'many'
}

export interface ManifestProfile extends ProfileSummary {
  format: 'manifest'
  fields: ProfileField[]
  publicSchema: unknown
  restrictedSchema: unknown
  sample: Record<string, unknown>
}

/** A profile held by a binding: its product document is split by top-level property into a public part, on chain, and a restricted part, sealed off chain. */
export interface BoundProfile extends ProfileSummary {
  format: 'binding'
  bindingDigest: string
  steps: string[]
  /** The binding's public list. Every other property is restricted. Absent when the binding makes no split: the whole document is then public. */
  access?: { policy: string; public: string[] }
  contexts: Array<{ path: string; uri: string }>
  prefixes: Record<string, string>
  engine: { available: boolean; problem?: string }
  /** Complete product documents of invented data, minted for this deployment's host and prefix. */
  examples: Array<{ title: string; itemReference: string; serial: string; passportId: string; product: Record<string, unknown> }>
  demonstration: boolean
}

export type Profile = ManifestProfile | BoundProfile

export type CodeLists = Record<string, Array<{ value: string; label: string }>>

/** How a view of a payload came out. `not-checked` is never a pass. */
export type ViewStatus = 'pass' | 'fail' | 'not-checked'

export interface Finding {
  severity: 'Violation' | 'Warning' | 'Info'
  constraint: string
  step: string
  focusNode?: string
  path?: string
  message?: string
  value?: string
  /** A JSON pointer into the product document, when the finding could be placed. */
  pointer?: string
  property?: string
}

export interface ViewCheck {
  view: 'public' | 'authorised' | 'whole'
  status: ViewStatus
  cause?: string
  summary: string
  steps: Array<{ step: string; status: ViewStatus; cause?: string; messages: string[] }>
  findings: Finding[]
  withheld: Array<{ step: string; property: string; constraint: string; message?: string }>
}

export interface PayloadCheck {
  txid: string
  stateIndex: number
  profile: string
  publicView: ViewCheck
}

export interface ProductReading {
  profile: string
  bindingDigest: string
  notice?: string
  publicProduct: Record<string, unknown>
  access?: { policy: string; public: string[] }
}

/** The holder's view of a passport under a bound profile. The owner-tier check is the protocol's, and the only statement about the on-chain commitment. */
export interface AuthorisedReading {
  passportId: string
  profile?: string
  ownerTier: { status: ViewStatus; txid?: string; detail: string }
  authorisedView: ViewCheck
  restrictedProduct?: Record<string, unknown>
  product?: Record<string, unknown>
  access?: { policy: string; public: string[] }
}

export type CheckStatus = 'pass' | 'fail' | 'unknown' | 'not-applicable'

export interface Check {
  name: string
  label: string
  status: CheckStatus
  reasonCode?: string
}

export interface LineageEntry {
  op: string
  txid: string
  timestamp: string
  controllerKey: string
  actorIdentityKey: string
  payloadPublic: unknown
}

export interface Verification {
  passportId: string
  lineage: LineageEntry[]
  checks: Check[]
  report: { checkedAt?: string; limits?: string[]; [key: string]: unknown }
  publisherKeys: string[]
  /** One entry per state whose payload declares a profile, genesis first. */
  payloadChecks?: PayloadCheck[]
  /** Present when the newest state carries a product document under a binding. */
  product?: ProductReading
}

export type Op = 'ISSUE' | 'UPDATE' | 'TRANSFER' | 'RETIRE'

export interface StateView {
  op: Op
  txid: string
  timestamp: string
  actor: string
  index: string
  refusal?: string
  network: string
  proven: boolean
  proofPushed: boolean
  blockHeight?: number
}

export interface JournalSummary {
  states: number
  proven: number
  pending: number
  status: string
}

export interface PassportView {
  passportId: string
  brandId: string
  profile: string
  /** Present when the passport's profile is retired: nothing further is written for it, and this names the profile that replaces it. */
  profileRetired?: { replacedBy: string }
  status: 'active' | 'retired'
  demonstration: boolean
  holder: { party: string; controllerKey: string }
  createdAt: string
  payload: unknown
  journal: JournalSummary
  states: StateView[]
  acceptanceRecords: unknown[]
}

export interface ClaimView {
  id: string
  passportId: string
  issuer: string
  issuedBy: string
  claim: { eventType: string; timestamp: string; recordId?: string; [key: string]: unknown }
  registry?: { url: string; status: number; accepted: boolean; attestationId?: string; detail?: string }
  createdAt: string
  /** The signature check, on the list route only; the record a POST returns has none, and was refused if it did not verify. */
  verified?: string
}

export type OfferStatus = 'open' | 'accepted' | 'transferred' | 'declined' | 'withdrawn' | 'expired'

export interface OfferPreview {
  requestId: string
  passportId: string
  terms: Record<string, unknown>
  expiresAt: string
  status: OfferStatus
}

export interface OfferView {
  requestId: string
  passportId: string
  brandId: string
  mechanism: 'claim-code' | 'named-recipient'
  terms: Record<string, unknown>
  createdAt: string
  expiresAt: string
  status: OfferStatus
  transferTxid?: string
}

export interface AcceptResult {
  offer: OfferView
  record: unknown
  transferTxid: string
}

export interface Brand {
  id: string
  name: string
  identityKey: string
  did: string
  createdAt: string
}

export interface Me {
  userId: string
  email: string
  name: string
  brandIds: string[]
  brands: Brand[]
}

export interface Duty {
  passportId: string
  txid: string
  op: string
  duty: 'announce' | 'prove' | 'push-proof'
  since: string
}

export interface Operations {
  duties: Duty[]
  passports: Array<{ passportId: string; brandId: string; status: string; journal: JournalSummary }>
  /** What start-up could not load: the validation engine's problem, and each profile folder that was refused. */
  profiles?: { engine: { available: boolean; problem?: string }; refused: Array<{ source: string; code: string; detail: string }> }
}

export interface WalletView {
  kind: 'toolbox' | 'test'
  network: string
  identityKey: string
  balance: number
  livePublishing: boolean
}

export interface FundingAddress {
  address: string
  derivationPrefix: string
  derivationSuffix: string
  senderIdentityKey: string
}

export type EventType = 'Origin' | 'Transfer' | 'Transformation' | 'Disposition'
export const EVENT_TYPES: EventType[] = ['Origin', 'Transfer', 'Transformation', 'Disposition']

// ------------------------------------------------------------------ routes

export const api = {
  health: () => get<Health>('/api/health'),
  profiles: () => get<ProfileSummary[]>('/api/profiles'),
  profile: (id: string) => get<Profile>(`/api/profiles/${encodeURIComponent(id)}`),
  profileCodes: (id: string, classes: string[]) => (classes.length === 0 ? Promise.resolve<CodeLists>({}) : get<CodeLists>(`/api/profiles/${encodeURIComponent(id)}/codes?${classes.map((name) => `class=${encodeURIComponent(name)}`).join('&')}`)),
  verify: (passportId: string) => get<Verification>(`/api/verify?passportId=${encodeURIComponent(passportId)}`),
  passport: (passportId: string) => get<PassportView>(`/api/passports/${passportRef(passportId)}`),
  passportClaims: (passportId: string) => get<ClaimView[]>(`/api/passports/${passportRef(passportId)}/claims`),
  offer: (requestId: string) => get<OfferPreview>(`/api/offers/${encodeURIComponent(requestId)}`),
  acceptOffer: (requestId: string, claimCode: string) => post<AcceptResult>(`/api/offers/${encodeURIComponent(requestId)}/accept`, { claimCode }),
  declineOffer: (requestId: string, claimCode: string) => post<OfferView>(`/api/offers/${encodeURIComponent(requestId)}/decline`, { claimCode }),

  me: () => get<Me>('/api/me'),
  brands: () => get<Brand[]>('/api/brands'),
  createBrand: (name: string) => post<Brand>('/api/brands', { name }),
  brandPassports: (brandId: string) => get<PassportView[]>(`/api/brands/${encodeURIComponent(brandId)}/passports`),
  issuePassport: (brandId: string, body: { profile: string; itemReference: string; serial: string } & ({ payload: Record<string, unknown>; ownerFields: Record<string, unknown> } | { product: Record<string, unknown> })) =>
    post<PassportView>(`/api/brands/${encodeURIComponent(brandId)}/passports`, body),
  updatePassport: (passportId: string, body: ({ payload: Record<string, unknown>; ownerFields: Record<string, unknown> } | { product: Record<string, unknown> }) & { eventData?: Record<string, unknown>; claimCode?: string }) =>
    post<PassportView>(`/api/passports/${passportRef(passportId)}/update`, body),
  authorisedView: (passportId: string, claimCode?: string) => post<AuthorisedReading>(`/api/passports/${passportRef(passportId)}/authorised-view`, claimCode == null ? {} : { claimCode }),
  offerPassport: (passportId: string, body: { terms: { word: string; note?: string }; claimCode?: string }) =>
    post<{ offer: OfferView; claimCode?: string }>(`/api/passports/${passportRef(passportId)}/offer`, body),
  passportOffers: (passportId: string) => get<OfferView[]>(`/api/passports/${passportRef(passportId)}/offers`),
  withdrawOffer: (requestId: string, claimCode?: string) => post<OfferView>(`/api/offers/${encodeURIComponent(requestId)}/withdraw`, claimCode == null ? {} : { claimCode }),
  retirePassport: (passportId: string, body: { reason: string; claimCode?: string }) => post<PassportView>(`/api/passports/${passportRef(passportId)}/retire`, body),
  addClaim: (passportId: string, body: { eventType: EventType; submit?: boolean }) => post<ClaimView>(`/api/passports/${passportRef(passportId)}/claims`, body),

  operations: () => get<Operations>('/api/operations'),
  runOperations: () => post<{ done: string[] }>('/api/operations/run'),
  wallet: () => get<WalletView>('/api/wallet'),
  fundingAddress: () => post<FundingAddress>('/api/wallet/funding-address'),
  internalize: (txid: string, funding: FundingAddress) => post<{ satoshis: number }>('/api/wallet/internalize', { txid, funding }),
}
