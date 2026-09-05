/**
 * GS1 identifier helpers for writers and readers (`spec/profiles.md` §5,
 * `spec/record-model.md` §3). Pure functions over the GS1 general
 * specifications' published rules: the mod-10 check digit, the fourteen-digit
 * GTIN spelling, the demonstration prefix 952, and the Digital Link URI's
 * application identifiers 01 and 21. None of them can say who allocated a
 * number; GS1 settles that at allocation and a reader cannot see it in the
 * digits, which is why `authority` is never inferred here.
 */

/** The GS1 prefix reserved for demonstrations and examples, never licensed to a company. */
export const GS1_DEMONSTRATION_PREFIX = '952'

/**
 * The GTIN GS1's own Digital Link documentation uses as its example. Its prefix
 * is 950, the GS1 Global Office, not the demonstration prefix 952, which is why
 * the fixtures that still carry it are moving to a 952 number.
 */
export const GS1_EXAMPLE_GTIN_14 = '09506000134352'

/**
 * The mod-10 check digit for a GS1 key: weights 3 and 1 alternating from the
 * rightmost data digit, the sum rounded up to the next multiple of ten.
 */
export function gs1CheckDigit(dataDigits: string): number {
  if (!/^\d+$/.test(dataDigits)) throw new Error('a GS1 key is digits only')
  let sum = 0
  let weight = 3
  for (let i = dataDigits.length - 1; i >= 0; i--) {
    sum += Number(dataDigits[i]) * weight
    weight = weight === 3 ? 1 : 3
  }
  return (10 - (sum % 10)) % 10
}

/** A GTIN-8, GTIN-12, GTIN-13 or GTIN-14 whose final digit is the check digit of the rest. */
export function isValidGtin(gtin: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)) return false
  return gs1CheckDigit(gtin.slice(0, -1)) === Number(gtin.at(-1))
}

/** The fourteen-digit spelling a Digital Link path carries, left-padded with zeros. */
export function gtin14(gtin: string): string {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)) throw new Error('a GTIN has 8, 12, 13 or 14 digits')
  return gtin.padStart(14, '0')
}

/**
 * Whether the GTIN sits under prefix 952. The prefix follows the indicator
 * digit in the fourteen-digit spelling, so it is read at offset one.
 */
export function isDemonstrationGtin(gtin: string): boolean {
  const fourteen = gtin14(gtin)
  return fourteen.slice(1, 4) === GS1_DEMONSTRATION_PREFIX
}

export interface Gs1DigitalLink {
  host: string
  /** Fourteen-digit spelling. */
  gtin: string
  /** Application identifier 21, when present. */
  serial?: string
  /** Application identifier 10, when present. */
  lot?: string
  checkDigitValid: boolean
  demonstration: boolean
}

/**
 * Read a GS1 Digital Link URI of the uncompressed path form
 * `https://host/01/{gtin}[/10/{lot}][/21/{serial}]`. Refuses anything else
 * rather than guessing: the compressed forms and the query-string forms are
 * not parsed, and a path this cannot read is a refusal, not an empty result.
 */
export function parseGs1DigitalLink(uri: string): Gs1DigitalLink {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    throw new Error('not a URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('a Digital Link uses http or https')
  const segments = url.pathname.split('/').filter((s) => s !== '')
  const at01 = segments.indexOf('01')
  if (at01 === -1 || segments[at01 + 1] == null) throw new Error('no application identifier 01')
  const gtinRaw = decodeURIComponent(segments[at01 + 1])
  if (!/^\d{8}$|^\d{12,14}$/.test(gtinRaw)) throw new Error('application identifier 01 must carry 8, 12, 13 or 14 digits')
  const gtin = gtin14(gtinRaw)
  const result: Gs1DigitalLink = {
    host: url.host,
    gtin,
    checkDigitValid: isValidGtin(gtinRaw),
    demonstration: isDemonstrationGtin(gtin),
  }
  for (let i = at01 + 2; i + 1 < segments.length; i += 2) {
    const ai = segments[i]
    const value = decodeURIComponent(segments[i + 1])
    if (ai === '21') {
      if (value.length === 0 || value.length > 20) throw new Error('application identifier 21 carries 1 to 20 characters')
      result.serial = value
    } else if (ai === '10') {
      if (value.length === 0 || value.length > 20) throw new Error('application identifier 10 carries 1 to 20 characters')
      result.lot = value
    } else {
      throw new Error(`application identifier ${ai} is not read by this parser`)
    }
  }
  return result
}

/**
 * Build the uncompressed Digital Link path a writer publishes: the GTIN at
 * fourteen digits with a correct check digit, then the serial under 21. The
 * host is the writer's choice and should be one that answers for the
 * identifier (`spec/record-model.md` §3).
 */
export function buildGs1DigitalLink(host: string, gtin: string, serial: string): string {
  if (!isValidGtin(gtin)) throw new Error('the GTIN check digit does not hold; a writer never publishes one that fails')
  if (serial.length === 0 || serial.length > 20) throw new Error('a serial carries 1 to 20 characters')
  if (!/^[!"%&'()*+,\-./0-9:;<=>?A-Z_a-z]+$/.test(serial)) throw new Error('a serial uses the GS1 AI encodable character set 82')
  return `https://${host}/01/${gtin14(gtin)}/21/${encodeURIComponent(serial)}`
}
