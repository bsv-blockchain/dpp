// Lifecycle claims: a signed statement about a passport, such as a repair or
// a recycling, on its own rail. It never spends the passport. The issuer
// signs it with their own key, a registry validates and stores it and
// publishes a separate anchor, and a reader checks the signature and the
// anchor itself. This platform signs for a signed-in member with the
// managed identity it derives for them, and sends the claim to the
// configured registry over HTTP.
import { PrivateKey, Utils } from '@bsv/sdk'
import { lifecycleClaimDigest, signLifecycleClaim, verifyLifecycleClaim, type LifecycleClaim, type LifecycleEventType, type SignedLifecycleClaim } from '@bsv/dpp-protocol'
import type { Party } from './parties.js'
import type { ClaimRecord, PassportRecord, Store } from './store.js'
import { WriteRefused } from './writer.js'

export interface ClaimsOptions {
  store: Store
  registry?: { url: string; token?: string }
}

export const EVENT_TYPES: LifecycleEventType[] = ['Origin', 'Transfer', 'Transformation', 'Disposition']

export class Claims {
  constructor(private readonly options: ClaimsOptions) {}

  /** Sign a claim about the passport's current state as the issuer, and keep it. */
  async sign(args: { passport: PassportRecord; issuer: Party; eventType: LifecycleEventType; keyId?: string }): Promise<ClaimRecord> {
    const tip = args.passport.states.at(-1)
    if (tip == null) throw new WriteRefused('not-issued', `${args.passport.passportId} has no state to claim about`)
    const [profile, version] = args.passport.profile.split('@')
    const claim: LifecycleClaim = {
      claimFormat: 'dpp-lifecycle-v1',
      passportId: args.passport.passportId,
      recordId: tip.txid,
      eventType: args.eventType,
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      issuer: args.issuer.did,
      issuerKeyId: args.keyId ?? args.issuer.name,
      profile,
      profile_version: Number(version),
    }
    const signed = await signLifecycleClaim(claim, args.issuer.wallet)
    if (verifyLifecycleClaim(signed).signature !== 'verified') throw new WriteRefused('claim-unsigned', 'the signed claim does not verify under its own issuer key')
    const record: ClaimRecord = {
      id: `claim-${lifecycleClaimDigest(signed).slice(0, 16)}-${Utils.toHex(PrivateKey.fromRandom().toArray().slice(0, 4))}`,
      passportId: args.passport.passportId,
      issuer: signed.issuer,
      issuedBy: args.issuer.name,
      claim: signed,
      createdAt: claim.timestamp,
    }
    await this.options.store.saveClaim(record)
    return record
  }

  /** Send a signed claim to the registry to verify, store and anchor (POST /attestations). Storing needs the registry's permission. */
  async submit(record: ClaimRecord): Promise<ClaimRecord> {
    const registry = this.options.registry
    if (registry == null) throw new WriteRefused('registry-unset', 'REGISTRY_URL is not set')
    const response = await fetch(`${registry.url}/attestations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(registry.token != null ? { Authorization: `Bearer ${registry.token}` } : {}) },
      body: JSON.stringify(record.claim),
    })
    const body = (await response.json().catch(() => ({}))) as { accepted?: boolean; attestationId?: string; description?: string; error?: string }
    record.registry = {
      url: registry.url,
      status: response.status,
      accepted: response.status === 202 && body.accepted === true,
      attestationId: body.attestationId,
      detail: body.description ?? body.error,
    }
    await this.options.store.saveClaim(record)
    return record
  }

  /** Ask the registry to check a claim without storing it (POST /validate is open on the hosted reference). */
  async validate(claim: SignedLifecycleClaim): Promise<unknown> {
    const registry = this.options.registry
    if (registry == null) throw new WriteRefused('registry-unset', 'REGISTRY_URL is not set')
    const url = new URL('/validate', registry.url)
    url.searchParams.set('subject', claim.passportId)
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(claim) })
    if (!response.ok) throw new WriteRefused('registry-refused', `the registry answered HTTP ${response.status} to /validate`)
    return await response.json()
  }
}
