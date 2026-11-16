// Lifecycle claims: a signed statement about what happened to one or more
// products, on its own rail. It never spends a passport. This application
// issues EPCIS lifecycle claims (`dpp-epcis-lifecycle@1`): one EPCIS 2.0.1
// event, entered by a member or retained by the EPCIS exchange, in an
// envelope that binds it to the passports whose products it names and says
// in which role the member signs. The member's managed identity signs it;
// that is the wallet step. Sending it to a registry, which verifies it,
// stores the exact bytes and anchors them once per bound passport, is a
// separate step the member asks for; that is the blockchain step, and this
// application takes neither without being asked.
//
// Native claims with one of four event types (`dpp-lifecycle-v1`) are no
// longer issued here. Those this application issued before are kept, read
// and verified under their own rules, and shown as historical.
import {
  EPCIS_LIFECYCLE_CLAIM_FORMAT,
  EPCIS_LIFECYCLE_REPRESENTATION,
  EPCIS_LIFECYCLE_ROLES,
  buildEpcisLifecycleClaim,
  epcisLifecycleClaimBytes,
  epcisLifecycleClaimDigest,
  signEpcisLifecycleClaim,
  verifyEpcisLifecycleClaim,
  type EpcisLifecycleRole,
  type EpcisLifecycleSource,
} from '@bsv/dpp-credentials/epcis-lifecycle'
import { bindingsFor, claimText, type EventSchemaCheck } from './lifecycle.js'
import type { Party } from './parties.js'
import type { ClaimRecord, EpcisLifecycleClaimRecord, Store } from './store.js'
import { WriteRefused, refuseRetiredProfile } from './writer.js'

export interface ClaimsOptions {
  store: Store
  registry?: { url: string; token?: string }
}

export const ASSERTED_ROLES: readonly EpcisLifecycleRole[] = EPCIS_LIFECYCLE_ROLES

export interface IssueClaimInput {
  /** One EPCIS 2.0.1 event, exactly as it is to be signed. */
  event: Record<string, unknown>
  issuer: Party
  assertedRole: EpcisLifecycleRole
  /** The passports the issuer asserts the role for. By default the passport the claim is issued from. */
  authorityScope?: string[]
  /** The EPCIS party identifier the issuer is, needed to sign as owner or custodian of an event that names party roles. */
  issuerParty?: string
  /** The passport the claim is issued from: it must be among the passports the event names. */
  expectedPassport?: string
  /** Where an imported event came from: the import's digest and the event's place in it. */
  source?: EpcisLifecycleSource
  importedFrom?: { importId: string; pointer: string }
  /** Inline prefix declarations the event's extension members are read under. */
  extensionContexts?: Array<Record<string, string>>
  requiredExtensions?: string[]
  /** The pinned EPCIS 2.0.1 schema check. Issuance is refused when it fails or cannot be applied. */
  schemaCheck?: EventSchemaCheck
  /** The issue time; now by default. */
  issuedAt?: string
}

const now = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

export class Claims {
  constructor(private readonly options: ClaimsOptions) {}

  /**
   * Sign an EPCIS lifecycle claim as the issuer, and keep its exact bytes.
   * The bindings come from the event's own identifiers, matched to this
   * platform's passports under the identity rules: an item identifier binds
   * that item's passport, a quantity element's class binds at class level
   * only. Refused, with nothing signed, when the event names none of the
   * passports, does not name the one it is issued from, names one under a
   * retired profile, fails the pinned schema or any issuance rule.
   */
  async issue(input: IssueClaimInput): Promise<EpcisLifecycleClaimRecord> {
    const { store } = this.options
    const passports = await store.listPassports()
    const { bindings, unbound } = bindingsFor(input.event, passports.map((p) => p.passportId))
    if (bindings.length === 0) {
      throw new WriteRefused('event-binds-no-passport', `the event names none of this platform's passports, so there is nothing to bind it to${unbound.length === 0 ? '' : `: ${unbound.map((u) => `${u.identifier} in ${u.field}: ${u.reason}`).join('; ')}`}. Nothing was signed.`, { unbound })
    }
    const bound = [...new Set(bindings.map((b) => b.passportId))]
    if (input.expectedPassport != null && !bound.includes(input.expectedPassport)) {
      throw new WriteRefused('passport-not-bound', `the event does not name ${input.expectedPassport} under the identity rules, so a claim issued from it would not concern it. It names ${bound.join(', ')}. Nothing was signed.`, { boundPassports: bound, unbound })
    }
    // A passport under a retired profile gets no further claim, as it gets no further state.
    for (const passportId of bound) refuseRetiredProfile(passports.find((p) => p.passportId === passportId)!.profile)

    if (input.schemaCheck == null) throw new WriteRefused('event-schema-unavailable', 'the pinned EPCIS 2.0.1 schema is not available to this application, so no event is signed. Nothing was signed.')
    const schema = input.schemaCheck(input.event)
    if (schema.status === 'fail') throw new WriteRefused('event-schema-invalid', 'the pinned EPCIS 2.0.1 schema refuses the event. Nothing was signed.', { findings: schema.detail })
    if (schema.status !== 'pass') throw new WriteRefused('event-schema-unavailable', `the pinned EPCIS 2.0.1 schema could not be applied (${String(schema.detail ?? schema.reasonCode)}). Nothing was signed.`)

    const authorityScope = input.authorityScope ?? (input.expectedPassport != null ? [input.expectedPassport] : bound)
    let signed
    try {
      const claim = buildEpcisLifecycleClaim({
        event: input.event,
        ...(input.extensionContexts == null || input.extensionContexts.length === 0 ? {} : { extensionContexts: input.extensionContexts }),
        bindings,
        issuer: input.issuer.did,
        ...(input.issuerParty == null ? {} : { issuerParty: input.issuerParty }),
        assertedRole: input.assertedRole,
        authorityScope,
        issuedAt: input.issuedAt ?? now(),
        ...(input.requiredExtensions == null || input.requiredExtensions.length === 0 ? {} : { requiredExtensions: input.requiredExtensions }),
        ...(input.source == null ? {} : { source: input.source }),
      })
      signed = await signEpcisLifecycleClaim(claim, input.issuer.wallet)
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      const prefix = 'the claim cannot be issued: '
      throw new WriteRefused('claim-refused', `${detail}. Nothing was signed.`, { reasons: detail.startsWith(prefix) ? detail.slice(prefix.length).split('; ') : [detail] })
    }
    const bytes = claimText(epcisLifecycleClaimBytes(signed))
    const verified = await verifyEpcisLifecycleClaim(bytes)
    if (verified.findings.signature.status !== 'pass') throw new WriteRefused('claim-unsigned', 'the signed claim does not verify under its own issuer key')
    const digest = epcisLifecycleClaimDigest(signed)
    const record: EpcisLifecycleClaimRecord = {
      id: `claim-${digest.slice(0, 16)}`,
      claimFormat: EPCIS_LIFECYCLE_CLAIM_FORMAT,
      passportId: input.expectedPassport ?? bound[0]!,
      boundPassports: verified.boundPassports,
      attestationId: `urn:sha256:${digest}`,
      digest,
      eventId: String(signed.event.eventID),
      eventType: String(signed.event.type),
      issuer: signed.issuer,
      issuedBy: input.issuer.name,
      bytes,
      ...(input.importedFrom == null ? {} : { importedFrom: input.importedFrom }),
      createdAt: signed.issuedAt,
    }
    // Identical bytes are the same claim: kept once.
    const held = (await store.listClaims({ eventId: record.eventId })).find((c) => c.id === record.id)
    if (held != null) return held as EpcisLifecycleClaimRecord
    await store.saveClaim(record)
    return record
  }

  /**
   * Send a claim to the registry to verify, store and anchor (POST /attestations): the exact bytes, which the registry
   * anchors once per bound passport. Storing needs the registry's permission. Only EPCIS lifecycle claims are sent:
   * this application issues no other kind.
   */
  async submit(record: ClaimRecord): Promise<ClaimRecord> {
    const registry = this.options.registry
    if (registry == null) throw new WriteRefused('registry-unset', 'REGISTRY_URL is not set')
    if (record.claimFormat !== EPCIS_LIFECYCLE_CLAIM_FORMAT) throw new WriteRefused('claim-historical', 'a historical native claim is kept as it is and is not sent again')
    let response: Response
    try {
      response = await fetch(`${registry.url}/attestations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(registry.token != null ? { Authorization: `Bearer ${registry.token}` } : {}) },
        body: JSON.stringify({ representation: EPCIS_LIFECYCLE_REPRESENTATION, claim: record.bytes, subject: record.passportId }),
      })
    } catch (cause) {
      record.registry = { url: registry.url, status: 0, accepted: false, detail: `the registry could not be reached (${cause instanceof Error ? cause.message : String(cause)})` }
      await this.options.store.saveClaim(record)
      return record
    }
    const body = (await response.json().catch(() => ({}))) as { accepted?: boolean; attestationId?: string; description?: string; error?: string }
    record.registry = {
      url: registry.url,
      status: response.status,
      accepted: response.status === 202 && body.accepted === true,
      ...(body.attestationId == null ? {} : { attestationId: body.attestationId }),
      ...((body.description ?? body.error) == null ? {} : { detail: body.description ?? body.error }),
    }
    await this.options.store.saveClaim(record)
    return record
  }
}
