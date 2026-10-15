import { gs1KeyTuple, parseGs1DigitalLinkUri } from '@bsv/dpp-profiles'

/**
 * The GS1 key a passport is found by when the caller holds no host: the key
 * tuple of `spec/gs1-discovery.md` section 1, `01:{gtin14}` and each key
 * qualifier as `ai:value`, joined by `|`. Two Digital Link URIs under
 * different hosts or GTIN spellings that reduce to one tuple name one product,
 * so a lookup by tuple answers every passport issued for it, each under its
 * own exact identifier for the reader to verify. The parse is the profiles
 * package's own, so there is one reading of the grammar.
 */

/** Stands in for the host a bare path or a tuple does not have; never contacted. */
const NO_HOST = 'https://gs1-key.invalid'

/** The key tuple a passport identifier names, or '' when it is not an uncompressed GS1 Digital Link URI. */
export function passportGs1Key(passportId: string): string {
  const parsed = parseGs1DigitalLinkUri(passportId)
  return parsed.kind === 'uncompressed' ? gs1KeyTuple(parsed) : ''
}

/**
 * A lookup's `gs1Key` in any of its three accepted spellings, as the
 * canonical tuple; undefined when it names no GS1 key:
 *
 *   01:09529990001039|21:EBL-MUO00IJJ                 the tuple itself
 *   01/09529990001039/21/EBL-MUO00IJJ                  a Digital Link path, no host
 *   https://any.host/01/09529990001039/21/EBL-MUO00IJJ a whole Digital Link URI
 */
export function normaliseGs1Key(value: string): string | undefined {
  let uri: string
  if (/^https?:\/\//.test(value)) {
    uri = value
  } else if (/^\/?01\//.test(value)) {
    uri = `${NO_HOST}/${value.replace(/^\//, '')}`
  } else if (/^01:/.test(value)) {
    const parts = value.split('|').map((part) => {
      const at = part.indexOf(':')
      return at <= 0 ? undefined : [part.slice(0, at), part.slice(at + 1)]
    })
    if (parts.some((part) => part == null || part[1] === '')) return undefined
    uri = `${NO_HOST}/${(parts as string[][]).map(([ai, v]) => `${ai}/${encodeURIComponent(v)}`).join('/')}`
  } else {
    return undefined
  }
  const key = passportGs1Key(uri)
  return key === '' ? undefined : key
}
