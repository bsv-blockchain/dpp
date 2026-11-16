/**
 * The product-to-passport identity rules (`spec/profiles.md` §7). A payload
 * under a binding carries a product document written to somebody else's
 * rules, and that document names its own product. These rules decide whether
 * the product it names is the item the carrying passport is about.
 *
 * The eleven rules, by number:
 *
 *  1. The expected identity is the passport identifier the caller supplies,
 *     and nothing in the payload. None supplied is `unknown`.
 *  2. The subject is the document's own identifier: an uncompressed GS1
 *     Digital Link under primary key 01 with a serial under 21, whose GTIN
 *     and serial equal the passport's.
 *  3. The host is not compared.
 *  4. A GTIN of 8, 12, 13 or 14 digits is compared at fourteen. A wrong check
 *     digit fails.
 *  5. A serial read from a link is percent-decoded once and compared code
 *     point for code point. Nothing is trimmed, folded or normalised.
 *  6. Every GTIN and serial the document states must equal the subject's.
 *  7. A passport or product identifier member may be coarser than the item
 *     and must not name another product.
 *  8. The subject's own link decides the granularity: a model or a batch
 *     fails, and a declared granularity must be `item`.
 *  9. A related model or batch identifier is never compared as the subject.
 * 10. A form these rules do not read is `unknown`, never `pass`.
 * 11. Nothing is rewritten. The comparison works on parsed values.
 *
 * One principle settles every case the rules do not name: a `fail` means a
 * comparison was made and did not hold, or a number that claims to be a GTIN
 * is not one. Anything that could not be read is `unknown`.
 */
import { isValidGtin, gtin14 } from './identifiers.js'
import { granularityOf, gs1KeyOf, parseGs1DigitalLinkUri, sameGs1Key, type Gs1Key } from './gs1-resolution.js'
import type { BindingIdentity } from './profile-binding.js'

export type ProductIdentityCode =
  | 'identity-match'
  | 'passport-identifier-missing'
  | 'passport-identifier-unsupported'
  | 'passport-identifier-invalid'
  | 'passport-not-an-item'
  | 'subject-missing'
  | 'subject-ambiguous'
  | 'subject-unsupported'
  | 'subject-invalid'
  | 'subject-not-an-item'
  | 'subject-mismatch'
  | 'stated-gtin-invalid'
  | 'stated-gtin-mismatch'
  | 'stated-serial-mismatch'
  | 'stated-value-unsupported'
  | 'product-identifier-unsupported'
  | 'product-identifier-invalid'
  | 'product-identifier-mismatch'
  | 'granularity-mismatch'

/** One thing that kept the check from passing. */
export interface ProductIdentityFinding {
  status: 'fail' | 'unknown'
  code: ProductIdentityCode
  /** The member of the payload the finding is about, as the binding points at it. */
  pointer?: string
  detail: string
}

export interface ProductIdentityResult {
  status: 'pass' | 'fail' | 'unknown'
  /** The code of the first failure, else of the first unknown, else `identity-match`. */
  code: ProductIdentityCode
  detail: string
  findings: ProductIdentityFinding[]
}

type LinkReading =
  | { kind: 'key'; gtin: string; serial?: string; granularity: 'model' | 'variant' | 'batch' | 'item' }
  | { kind: 'invalid'; detail: string }
  | { kind: 'unsupported'; detail: string }

/**
 * One identifier read as a GS1 Digital Link. The package's parser does the
 * reading, so the grammar is the one the rest of the package uses. Its
 * refusals are sorted here: a number that is not a GTIN is `invalid`, and
 * every other form the parser does not read is `unsupported`.
 */
function readLink(value: unknown): LinkReading {
  if (typeof value !== 'string') return { kind: 'unsupported', detail: 'it is not text' }
  // A URL parser drops surrounding white space and embedded tabs and line
  // breaks without saying so. Accepting the result would be trimming, so the
  // identifier is refused as written.
  if (/[\u0000- \u007f]/.test(value)) return { kind: 'unsupported', detail: 'it contains white space or a control character' }
  const parsed = parseGs1DigitalLinkUri(value)
  if (parsed.kind === 'compressed') return { kind: 'unsupported', detail: 'it is a compressed GS1 Digital Link' }
  if (parsed.kind === 'invalid') {
    return parsed.reason === 'primary-key-not-a-gtin' ? { kind: 'invalid', detail: parsed.detail } : { kind: 'unsupported', detail: parsed.detail }
  }
  if (!parsed.primaryKey.checkDigitValid) return { kind: 'invalid', detail: `the check digit of GTIN ${parsed.primaryKey.value} is wrong` }
  const level = granularityOf(parsed.qualifiers)
  const serial = parsed.qualifiers.find((q) => q.ai === '21')?.value
  return { kind: 'key', gtin: parsed.primaryKey.value, ...(serial == null ? {} : { serial }), granularity: level === 'lot' ? 'batch' : level }
}

/** The key the rules compare: the GTIN and the serial, and no other qualifier. A lot or a variant is a related identity, not part of the item's. */
const itemKey = (gtin: string, serial: string): Gs1Key => gs1KeyOf({ gtin, qualifiers: [{ ai: '21', value: serial }] })

/** The value at a JSON Pointer (RFC 6901), or `undefined` where the document has none. Arrays are indexed by their decimal position. */
function valueAt(document: unknown, pointer: string): unknown {
  let current: unknown = document
  for (const token of pointer.split('/').slice(1)) {
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~')
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(key)) return undefined
      current = current[Number(key)]
    } else if (current !== null && typeof current === 'object' && Object.hasOwn(current, key)) {
      current = (current as Record<string, unknown>)[key]
    } else {
      return undefined
    }
  }
  return current
}

/**
 * Whether the product document in a payload describes the passport's item.
 * `payload` is the parsed envelope, so the binding's pointers resolve against
 * it. `passportId` is the identifier of the state being written or read,
 * supplied by the writer or the verifier, and never taken from the payload.
 */
export function checkProductIdentity(input: { payload: unknown; identity: BindingIdentity; passportId?: string | null }): ProductIdentityResult {
  const { payload, identity, passportId } = input
  const stop = (status: 'fail' | 'unknown', code: ProductIdentityCode, detail: string, pointer?: string): ProductIdentityResult => ({ status, code, detail, findings: [{ status, code, ...(pointer == null ? {} : { pointer }), detail }] })

  // Rule 1. Without the passport's identifier there is nothing to compare with.
  if (passportId == null || passportId === '') return stop('unknown', 'passport-identifier-missing', 'No passport identifier was supplied, so the product cannot be matched to a passport.')
  const expected = readLink(passportId)
  if (expected.kind === 'unsupported') return stop('unknown', 'passport-identifier-unsupported', `The passport identifier cannot be read as an uncompressed GS1 Digital Link under primary key 01: ${expected.detail}.`)
  if (expected.kind === 'invalid') return stop('fail', 'passport-identifier-invalid', `The passport identifier does not carry a valid GTIN: ${expected.detail}.`)
  if (expected.serial == null) return stop('unknown', 'passport-not-an-item', `The passport identifier names a ${expected.granularity}, not a serialised item.`)

  // Rule 2. The document's own identifier, wherever the binding says it may sit.
  const stated = identity.subject.pointers.map((pointer) => ({ pointer, value: valueAt(payload, pointer) })).filter((entry) => entry.value !== undefined)
  if (stated.length === 0) return stop('unknown', 'subject-missing', `The product document states no identifier at ${identity.subject.pointers.join(' or ')}.`)
  const first = stated[0]!
  const rival = stated.find((entry) => entry.value !== first.value)
  if (rival != null) return stop('fail', 'subject-ambiguous', `The product document states two different identifiers, at ${first.pointer} and ${rival.pointer}.`, rival.pointer)
  const subject = readLink(first.value)
  if (subject.kind === 'unsupported') return stop('unknown', 'subject-unsupported', `The product document's identifier cannot be read as an uncompressed GS1 Digital Link under primary key 01: ${subject.detail}.`, first.pointer)
  if (subject.kind === 'invalid') return stop('fail', 'subject-invalid', `The product document's identifier does not carry a valid GTIN: ${subject.detail}.`, first.pointer)
  // Rule 8, first half. The link itself says what the document is about.
  if (subject.serial == null) return stop('fail', 'subject-not-an-item', `The product document describes a ${subject.granularity}, not a serialised item.`, first.pointer)
  // Rules 2 to 5. The parser has padded the GTIN and decoded the serial once; the host was never kept.
  if (!sameGs1Key(itemKey(subject.gtin, subject.serial), itemKey(expected.gtin, expected.serial))) {
    return stop('fail', 'subject-mismatch', 'The product document describes a different product from the passport that carries it.', first.pointer)
  }

  const findings: ProductIdentityFinding[] = []
  const find = (status: 'fail' | 'unknown', code: ProductIdentityCode, pointer: string, detail: string): void => { findings.push({ status, code, pointer, detail }) }

  // Rule 6. Every stated GTIN and serial, each value of a member that lists several.
  for (const rule of identity.mustEqual) {
    const value = valueAt(payload, rule.pointer)
    if (value === undefined) continue
    for (const one of Array.isArray(value) ? value : [value]) {
      if (typeof one !== 'string') { find('unknown', 'stated-value-unsupported', rule.pointer, `The value at ${rule.pointer} is not text, so it cannot be compared with the subject.`); continue }
      if (rule.part === 'gtin') {
        if (!isValidGtin(one)) find('fail', 'stated-gtin-invalid', rule.pointer, `The value at ${rule.pointer} is not a GTIN of 8, 12, 13 or 14 digits with a correct check digit.`)
        else if (gtin14(one) !== subject.gtin) find('fail', 'stated-gtin-mismatch', rule.pointer, `The GTIN at ${rule.pointer} is not the GTIN of the product document's identifier.`)
      } else if (one !== subject.serial) {
        // Rule 5. JavaScript compares strings by code unit, which decides equality exactly as code points do.
        find('fail', 'stated-serial-mismatch', rule.pointer, `The serial at ${rule.pointer} is not the serial of the product document's identifier.`)
      }
    }
  }

  // Rule 7. A link that names the product more coarsely is welcome; one that names another product is not.
  for (const rule of identity.mustNotContradict) {
    const value = valueAt(payload, rule.pointer)
    if (value === undefined) continue
    const node = value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
    const link = readLink(node == null ? value : (node.id ?? node['@id']))
    if (link.kind === 'unsupported') find('unknown', 'product-identifier-unsupported', rule.pointer, `The identifier at ${rule.pointer} cannot be read as an uncompressed GS1 Digital Link under primary key 01: ${link.detail}.`)
    else if (link.kind === 'invalid') find('fail', 'product-identifier-invalid', rule.pointer, `The identifier at ${rule.pointer} does not carry a valid GTIN: ${link.detail}.`)
    else if (link.gtin !== subject.gtin || (link.serial != null && link.serial !== subject.serial)) find('fail', 'product-identifier-mismatch', rule.pointer, `The identifier at ${rule.pointer} names a different product from the product document's own identifier.`)
  }

  // Rule 8, second half. A document that declares a granularity must declare this one.
  if (identity.granularityMember != null) {
    const declared = valueAt(payload, identity.granularityMember.pointer)
    if (declared !== undefined && declared !== identity.granularityMember.whenPresent) {
      find('fail', 'granularity-mismatch', identity.granularityMember.pointer, `The product document declares a granularity other than ${identity.granularityMember.whenPresent} at ${identity.granularityMember.pointer}.`)
    }
  }

  // Rule 9 needs no code: `identity.related` is never read here.

  const worst = findings.find((f) => f.status === 'fail') ?? findings.find((f) => f.status === 'unknown')
  if (worst != null) return { status: worst.status, code: worst.code, detail: worst.detail, findings }
  return { status: 'pass', code: 'identity-match', detail: 'The product document describes the item the passport is about.', findings }
}
