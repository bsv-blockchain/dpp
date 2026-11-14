// The passport identifier a form's document is written for: a GS1 Digital
// Link made of the platform's host, a GTIN under its GS1 prefix and the
// item's serial. The API mints the identifier itself and refuses a document
// that names any other item, so this is for the page: it lets the form show
// the identifier and put the same GTIN and serial into the document.

export interface IdentifierPolicy {
  host: string
  prefix: string
}

/** The GS1 check digit for a run of digits: weights of three and one from the right. */
export function gs1CheckDigit(digits: string): string {
  let sum = 0
  for (let at = 0; at < digits.length; at++) sum += Number(digits[digits.length - 1 - at]) * (at % 2 === 0 ? 3 : 1)
  return String((10 - (sum % 10)) % 10)
}

export type MintedIdentity = { ok: true; passportId: string; gtin: string; serial: string } | { ok: false; problem: string }

/** The identifier, GTIN and serial for an item reference and a serial, or what is wrong with them. */
export function mintIdentity(policy: IdentifierPolicy, itemReference: string, serial: string): MintedIdentity {
  const digits = 12 - policy.prefix.length
  if (!/^\d+$/.test(itemReference) || itemReference.length !== digits) return { ok: false, problem: `The item reference is ${digits} digits: the ones after the GS1 prefix ${policy.prefix}.` }
  if (!/^[A-Za-z0-9!"%&'()*+,\-./:;<=>?_]{1,20}$/.test(serial)) return { ok: false, problem: 'A serial is 1 to 20 characters: letters, digits and the punctuation GS1 allows.' }
  const body = `0${policy.prefix}${itemReference}`
  const gtin = body + gs1CheckDigit(body)
  return { ok: true, passportId: `https://${policy.host}/01/${gtin}/21/${encodeURIComponent(serial)}`, gtin, serial }
}

/**
 * The item reference and serial a loaded document's own identifier names,
 * when its GTIN is under this platform's prefix. A document about a product
 * under another prefix cannot be written here, and the form says so.
 */
export function identityFromDocument(policy: IdentifierPolicy, id: string | undefined): { itemReference: string; serial: string } | { problem: string } {
  const match = id == null ? null : /\/01\/(\d{14})\/21\/([^/?#]+)$/.exec(id)
  if (match == null) return { problem: 'The document does not name a serialised item: its identifier is not a GS1 Digital Link with a GTIN and a serial.' }
  const gtin = match[1]
  if (!gtin.startsWith(`0${policy.prefix}`)) return { problem: `The document's GTIN ${gtin} is not under this platform's GS1 prefix ${policy.prefix}, so it cannot be written here.` }
  let serial = match[2]
  try {
    serial = decodeURIComponent(serial)
  } catch {
    // Left as written.
  }
  return { itemReference: gtin.slice(1 + policy.prefix.length, 13), serial }
}
