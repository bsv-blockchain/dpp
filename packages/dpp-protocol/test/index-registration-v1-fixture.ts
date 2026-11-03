import { PrivateKey, ProtoWallet, Utils } from '@bsv/sdk'
import {
  INDEX_REGISTRATION_FORMAT,
  INDEX_REGISTRATION_PROTOCOL_ID,
  canonicalJson,
  inspectRegistration,
  registrationSigningPreimage,
  registrationVerificationKey,
  signRegistration,
  type RegistrationClaim,
  type RegistrationRequest,
} from '../src/index.js'

/**
 * One index registration request (`spec/services.md` section 2), pinned byte
 * for byte with the key it verifies under and the requests an index must
 * refuse. Generated, never typed: `fixtures/index-registration-v1.json` is this
 * function's output verbatim.
 *
 * The application signs with its wallet: the BRC-42 child of its publisher
 * key for `[1, 'dpp index registration v1']`, key identifier the index URL,
 * counterparty 'anyone', the BRC-100 `createSignature` operation. The
 * expectations an index states (its address, network, custody profile and
 * clock) are pinned beside the request so the refusals are reproducible.
 */
export const REGISTRATION_FIXTURE_PRIVATE_KEY_HEX = '33'.repeat(32)
export const REGISTRATION_FIXTURE_INDEX_URL = 'https://index.example/'
export const REGISTRATION_FIXTURE_NOW = '2026-11-02T10:00:00Z'

export async function indexRegistrationV1Fixture() {
  const appPriv = PrivateKey.fromHex(REGISTRATION_FIXTURE_PRIVATE_KEY_HEX)
  const appWallet = new ProtoWallet(appPriv)
  const strangerWallet = new ProtoWallet(PrivateKey.fromHex('44'.repeat(32)))
  const publisherKey = appPriv.toPublicKey().toString()
  const expectations = { indexUrl: REGISTRATION_FIXTURE_INDEX_URL, network: 'test', custodyProfile: 'managed-custody@2', now: REGISTRATION_FIXTURE_NOW, windowMs: 10 * 60 * 1000 }
  const claim: RegistrationClaim = {
    registrationFormat: INDEX_REGISTRATION_FORMAT,
    indexUrl: REGISTRATION_FIXTURE_INDEX_URL,
    publisherKey,
    network: 'test',
    custodyProfile: 'managed-custody@2',
    label: 'Cell pack demo',
    requestedAt: '2026-11-02T09:58:30Z',
  }
  const request = await signRegistration(claim, appWallet)
  const derivedBy = async (wallet: ProtoWallet, r: RegistrationClaim): Promise<string> =>
    Utils.toHex((await wallet.createSignature({ data: registrationSigningPreimage(r), protocolID: INDEX_REGISTRATION_PROTOCOL_ID, keyID: r.indexUrl, counterparty: 'anyone' })).signature)
  const expected = (r: RegistrationRequest) => {
    const inspection = inspectRegistration(r, { ...expectations, now: new Date(expectations.now) })
    return { valid: inspection.valid, reasons: inspection.failures.map((f) => f.reason) }
  }
  const refusal = (name: string, description: string, r: RegistrationRequest) => ({ name, description, request: r, expected: expected(r) })

  const tamperedLabel: RegistrationRequest = { ...request, label: 'Someone else' }
  const strangerSigned: RegistrationRequest = { ...request, signature: await derivedBy(strangerWallet, request) }
  const directlySigned: RegistrationRequest = { ...request, signature: Utils.toHex(appPriv.sign(registrationSigningPreimage(request)).toDER() as number[]) }
  const otherIndex = await signRegistration({ ...claim, indexUrl: 'https://other.example/' }, appWallet)
  const otherNetwork = await signRegistration({ ...claim, network: 'main' }, appWallet)
  const otherCustody = await signRegistration({ ...claim, custodyProfile: 'record-model-baseline@2' }, appWallet)
  const stale = await signRegistration({ ...claim, requestedAt: '2026-11-02T09:40:00Z' }, appWallet)

  return {
    publisherKey,
    signing: { protocolId: INDEX_REGISTRATION_PROTOCOL_ID, keyId: REGISTRATION_FIXTURE_INDEX_URL, counterparty: 'anyone', verificationKey: registrationVerificationKey(publisherKey, REGISTRATION_FIXTURE_INDEX_URL).toString() },
    expectations,
    request,
    canonicalUnsigned: canonicalJson({ ...request, signature: undefined }),
    signingPreimageHex: Utils.toHex(registrationSigningPreimage(request)),
    expected: expected(request),
    refusals: [
      refusal('tamperedLabel', 'label changed after signing.', tamperedLabel),
      refusal('strangerSigned', 'Signed under the registration protocol from a root other than the publisher key the request names.', strangerSigned),
      refusal('directlySigned', 'Signed with the publisher key directly, with no derivation.', directlySigned),
      refusal('otherIndex', 'Signed for another index URL: the signature verifies under its own derivation and the index refuses it as not addressed to it.', otherIndex),
      refusal('otherNetwork', 'Well signed, naming the other network.', otherNetwork),
      refusal('otherCustody', 'Well signed, naming a custody profile the index does not admit under.', otherCustody),
      refusal('stale', 'Well signed, requested twenty minutes before the index clock, outside its ten-minute window.', stale),
    ],
  }
}

export type IndexRegistrationV1Fixture = Awaited<ReturnType<typeof indexRegistrationV1Fixture>>
