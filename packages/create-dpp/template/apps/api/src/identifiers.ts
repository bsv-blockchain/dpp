// Passport identifiers: GS1 Digital Links of the form
// https://<host>/01/<GTIN-14>/21/<serial>, minted under one GS1 company
// prefix. The default prefix, 952, is GS1's demonstration prefix, never
// licensed to anyone, so nothing real stands behind it. A state written under
// a GTIN you did not allocate is permanent and cannot be withdrawn, which is
// why every identifier is checked against the configured prefix before a
// write, and why the demonstration notice is carried while the prefix is 952.
import { GS1_DEMONSTRATION_PREFIX, buildGs1DigitalLink, gs1CheckDigit, gtin14, parseGs1DigitalLink } from '@bsv/dpp-profiles'

export interface IdentifierPolicy {
  host: string
  prefix: string
}

export const isDemonstrationPolicy = (policy: IdentifierPolicy): boolean => policy.prefix === GS1_DEMONSTRATION_PREFIX

/** The item reference digits that, with the prefix and the check digit, make a GTIN-13 for the host's prefix. */
export function mintGtin(prefix: string, itemReference: string): string {
  if (!/^\d+$/.test(prefix) || !/^\d+$/.test(itemReference)) throw new Error('a GTIN is digits only')
  const body = `${prefix}${itemReference}`
  if (body.length !== 12) throw new Error(`prefix and item reference must total 12 digits, not ${body.length}`)
  const data = `0${body}`
  return data + gs1CheckDigit(data)
}

/** A fresh identifier for a serialised item under the policy's host and prefix. */
export function mintPassportId(policy: IdentifierPolicy, itemReference: string, serial: string): string {
  if (!/^[A-Za-z0-9!"%&'()*+,\-./:;<=>?_]{1,20}$/.test(serial)) throw new Error('a serial is 1 to 20 characters of the GS1 encodable set')
  return buildGs1DigitalLink(policy.host, mintGtin(policy.prefix, itemReference), serial)
}

/** Why a write under this identifier is refused; empty when it may be written. */
export function identifierProblems(passportId: string, policy: IdentifierPolicy): string[] {
  let url: URL
  let link: ReturnType<typeof parseGs1DigitalLink>
  try {
    url = new URL(passportId)
    link = parseGs1DigitalLink(passportId)
  } catch (cause) {
    return [`it is not a GS1 Digital Link (${cause instanceof Error ? cause.message : String(cause)})`]
  }
  const problems: string[] = []
  if (url.search !== '' || url.hash !== '') problems.push('it carries a query or a fragment')
  if (!link.checkDigitValid) problems.push('its GTIN check digit does not hold')
  if (link.serial == null) problems.push('it has no serial under application identifier 21')
  if (link.host === 'id.gs1.org') problems.push("its host is GS1's own resolver, not a host you control")
  if (link.host !== policy.host) problems.push(`its host is ${link.host}, not this platform's ${policy.host}`)
  const digits = gtin14(link.gtin)
  if (!digits.slice(1).startsWith(policy.prefix)) {
    problems.push(
      isDemonstrationPolicy(policy)
        ? `its GTIN is not under the GS1 demonstration prefix ${GS1_DEMONSTRATION_PREFIX}, so it would name a product someone else may own`
        : `its GTIN is not under this platform's licensed prefix ${policy.prefix}`
    )
  }
  return problems
}
