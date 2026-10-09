// The API client: one fetch wrapper that turns the API's { error, description }
// answer into an Error, and a typed helper for every route in apps/api/API.md.
// Reads are open; writes carry the session cookie, which a same-origin fetch
// sends by itself.

export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
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
    const failure = (parsed ?? {}) as { error?: string; description?: string }
    throw new ApiError(failure.description ?? `the API answered HTTP ${response.status}`, failure.error ?? `http-${response.status}`, response.status)
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
  index?: string
  publisherKey: string
  wallet: 'toolbox' | 'test'
  livePublishing: boolean
  identifiers: { host: string; prefix: string; demonstration: boolean }
  signIn: boolean
  devSession?: { name: string; brandIds: string[] }
}

export interface ProfileSummary {
  id: string
  title: string
  description?: string
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

export interface Profile extends ProfileSummary {
  fields: ProfileField[]
  publicSchema: unknown
  restrictedSchema: unknown
  sample: Record<string, unknown>
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
  issuePassport: (brandId: string, body: { profile: string; itemReference: string; serial: string; payload: Record<string, unknown>; ownerFields: Record<string, unknown> }) =>
    post<PassportView>(`/api/brands/${encodeURIComponent(brandId)}/passports`, body),
  updatePassport: (passportId: string, body: { payload: Record<string, unknown>; ownerFields: Record<string, unknown>; eventData?: Record<string, unknown>; claimCode?: string }) =>
    post<PassportView>(`/api/passports/${passportRef(passportId)}/update`, body),
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
