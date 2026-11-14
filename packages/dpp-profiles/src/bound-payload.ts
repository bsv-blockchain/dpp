/**
 * What a writer does with a product document under a binding, before it
 * issues or updates a state (`spec/profiles.md` §7): validate the whole
 * document, cut it into its public and restricted parts, and build the
 * public payload as the exact text to sign.
 *
 * The order matters. The whole document is validated first, because only
 * the whole can satisfy the profile, and a writer never issues from a
 * document that fails or that could not be checked. The public part is then
 * checked the way every reader will check it, so a split that leaves the
 * public payload failing on its own is caught here and not on chain.
 *
 * Nothing is issued, signed, encrypted or stored here. The restricted part
 * comes back as data, and keeping it, and committing the record to it, is
 * the caller's and the protocol's work.
 */
import { splitProductByAccess } from './access-tiers.js'
import type { BindingValidationDetail, ValidationEngines } from './binding-validator.js'
import type { PayloadValidation } from './payload-validator.js'
import type { ProfileRegistry } from './profile-registry.js'
import { createValidationPipeline } from './validation-pipeline.js'

/** The most UTF-8 bytes a version 2 state holds in `payload_public` (`spec/record-model-v2.md` §3). */
export const PUBLIC_PAYLOAD_MAX_BYTES = 65535

type Json = Record<string, unknown>

export interface BoundPayloadInput {
  registry: ProfileRegistry
  engines?: ValidationEngines
  /** The binding's `id`. */
  profile: string
  /** The binding's `version`. */
  profileVersion: number
  /** The complete product document, public and restricted properties together. */
  product: Json
  /** The identifier of the passport the state belongs to. The identity check compares the document with it. */
  passportId: string
  /** The sentence a demonstration record carries first (`spec/profiles.md` §5). */
  notice?: string
}

export type BoundPayloadRefusalCode =
  /** The identifier and version name a manifest-format profile, which has no binding digest and no envelope. */
  | 'profile-not-bound'
  /** The whole document fails a check. `validation` says which. */
  | 'validation-failed'
  /** A check could not run, so the document was not shown to be valid. `validation` says which. */
  | 'validation-unavailable'
  /** The public payload is longer than a state holds. `byteLength` is its size. */
  | 'public-payload-too-large'
  /** The whole document passes and its public part alone fails a rule. `publicView` says which. */
  | 'public-view-failed'

export interface BoundPayloadRefusal {
  ok: false
  code: BoundPayloadRefusalCode
  /** One or more sentences for a person. */
  detail: string
  /** The check of the whole document, for the two validation codes and every code after them. */
  validation?: PayloadValidation
  /** The check of the public payload as a reader runs it, for `public-view-failed`. */
  publicView?: PayloadValidation
  /** The public payload's size in UTF-8 bytes, for `public-payload-too-large`. */
  byteLength?: number
  /** The limit it was held to, for `public-payload-too-large`. */
  limit?: number
}

export interface PreparedBoundPayload {
  ok: true
  /** The public payload: the exact text to write as `payload_public` and to sign. */
  payloadPublic: string
  /** Its size in UTF-8 bytes. */
  byteLength: number
  /** The restricted part, for the caller to encrypt and keep off chain. Absent when the document has no restricted property. */
  restrictedProduct?: Json
  /** The check of the whole document. Its status is `pass`. */
  validation: PayloadValidation
  /** The check of the public payload as any reader runs it: `pass`, or `unknown` with the rules it could not decide. */
  publicView: PayloadValidation
}

const causeOf = (validation: PayloadValidation): string => (typeof validation.detail === 'object' && !Array.isArray(validation.detail) ? (validation.detail as BindingValidationDetail).cause ?? 'no cause given' : 'no cause given')

/**
 * The public payload and the restricted part of one product document, or
 * the reason nothing was prepared. A refusal is returned, never thrown.
 */
export async function prepareBoundPayload(input: BoundPayloadInput): Promise<PreparedBoundPayload | BoundPayloadRefusal> {
  const { registry, engines, profile, profileVersion, passportId, notice } = input
  const id = `${profile}@${profileVersion}`
  const run = createValidationPipeline({ registry, ...(engines == null ? {} : { engines }) })
  const check = (payloadPublic: string, view: 'whole' | 'public'): Promise<PayloadValidation> => run({ payload: { profile, profileVersion, payloadPublic, passportId }, view })
  const refuse = (code: BoundPayloadRefusalCode, detail: string, extra: Partial<BoundPayloadRefusal> = {}): BoundPayloadRefusal => ({ ok: false, code, detail, ...extra })

  const registered = registry.resolve(profile, profileVersion)
  if (registered?.format === 'manifest') return refuse('profile-not-bound', `${id} is a manifest-format profile. It has no binding, so there is no bound payload to prepare.`)
  // The pipeline answers for an unknown profile before it reads the payload.
  if (registered == null) return refuse('validation-unavailable', `${id} is not registered, so the product document could not be validated and nothing was prepared.`, { validation: await check('{}', 'whole') })

  const stamp = notice === undefined ? {} : { notice }
  const envelope = { ...stamp, profile, profile_version: profileVersion, profile_binding_sha256: registered.bindingDigest }
  let wholeText: string
  try {
    wholeText = JSON.stringify({ ...envelope, product: input.product })
  } catch (cause) {
    return refuse('validation-failed', `The product document cannot be written as JSON: ${cause instanceof Error ? cause.message : String(cause)}.`)
  }

  const validation = await check(wholeText, 'whole')
  if (validation.status === 'fail') return refuse('validation-failed', `The product document does not validate under ${id} (${causeOf(validation)}), so nothing was prepared.`, { validation })
  if (validation.status === 'unknown') return refuse('validation-unavailable', `The product document could not be validated under ${id} (${causeOf(validation)}), so nothing was prepared. A check that could not run is not a pass.`, { validation })

  // What was validated is the document as JSON carries it, so that is what is cut.
  const { publicProduct, restrictedProduct } = splitProductByAccess({ binding: registered.binding, product: (JSON.parse(wholeText) as { product: Json }).product })
  const payloadPublic = JSON.stringify({ ...envelope, product: publicProduct })
  const byteLength = new TextEncoder().encode(payloadPublic).byteLength
  if (byteLength > PUBLIC_PAYLOAD_MAX_BYTES) return refuse('public-payload-too-large', `The public payload is ${byteLength} bytes of UTF-8. A state holds at most ${PUBLIC_PAYLOAD_MAX_BYTES}.`, { validation, byteLength, limit: PUBLIC_PAYLOAD_MAX_BYTES })

  // Without a split the public payload is the whole document, already checked.
  const publicView = registered.binding.access == null ? validation : await check(payloadPublic, 'public')
  if (publicView.status === 'fail') return refuse('public-view-failed', `The whole document validates under ${id}, and its public part alone fails (${causeOf(publicView)}). Every reader of the passport would see that failure, so nothing was prepared.`, { validation, publicView })

  return { ok: true, payloadPublic, byteLength, ...(restrictedProduct == null ? {} : { restrictedProduct }), validation, publicView }
}
