// Small presentation helpers shared by the pages.

export const shortTxid = (txid: string): string => (txid.length <= 20 ? txid : `${txid.slice(0, 10)}...${txid.slice(-6)}`)

export const shortKey = (key: string): string => (key.length <= 16 ? key : `${key.slice(0, 8)}...${key.slice(-6)}`)

export function formatTime(iso: string | undefined): string {
  if (iso == null || iso === '') return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/** `endOfLife` becomes `End of life`; `profile_version` becomes `Profile version`. */
export const humanise = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase())

/** The identifier's own path, `/01/<gtin>/21/<serial>`: a short form of the identifier to show. The API answers this path as the identifier's resolver. */
export function identifierPathOf(passportId: string): string | undefined {
  try {
    return new URL(passportId).pathname
  } catch {
    return undefined
  }
}

/** Where the public pages live: each at its identifier's own path after this prefix, where the resolver redirects a browser that asked for the identifier (apps/api/src/resolver.ts). */
export const PAGE_PREFIX = '/passport'

/** The passport's public page in this app, `/passport/01/<gtin>/21/<serial>`. A link inside the app goes straight to it; what is printed or copied stays the identifier. */
export function publicPathOf(passportId: string): string | undefined {
  const path = identifierPathOf(passportId)
  return path == null ? undefined : `${PAGE_PREFIX}${path}`
}

/** The GTIN and serial an identifier names, when it is a GS1 Digital Link of the form this app serves. */
export function parseIdentifier(passportId: string): { gtin: string; serial: string } | undefined {
  const match = identifierPathOf(passportId)?.match(/^\/01\/(\d+)\/21\/([^/]+)$/)
  if (match == null) return undefined
  let serial = match[2]
  try {
    serial = decodeURIComponent(serial)
  } catch {
    // Left as written.
  }
  return { gtin: match[1], serial }
}

/** The route parameter back to an identifier: React Router decodes it once; a still-encoded value is decoded here. */
export function passportIdFromRef(ref: string): string {
  if (ref.includes('://')) return ref
  try {
    return decodeURIComponent(ref)
  } catch {
    return ref
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Payload keys that are stamps or the demonstration marker, not product data. */
export const STAMP_KEYS = new Set(['notice', 'profile', 'profile_version'])

export const holderLabel = (party: string): string => {
  const [scope, id] = party.split(':', 2)
  if (scope === 'brand') return `Brand ${id}`
  if (scope === 'recipient') return `Recipient of offer ${id}`
  if (scope === 'member') return `Member ${id}`
  return party
}
