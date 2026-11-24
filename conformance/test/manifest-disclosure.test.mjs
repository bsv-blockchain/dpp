import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PrivateKey, ProtoWallet, Utils } from '@bsv/sdk'
import { readManifest, readRestrictedPayloadSchema } from '@bsv/dpp-profiles'
import { ownerBlobHash } from '@bsv/dpp-protocol'
import { discloseManifestFields } from '../../examples/manifest-disclosure.mjs'

const passportId = 'https://passport.example/01/09521234543213/21/DISCLOSURE-1'
const protocolID = [2, 'dpp owner data v1']
const wallet = (n) => new ProtoWallet(PrivateKey.fromHex(n.repeat(32)))
const publicKey = async (wallet) => (await wallet.getPublicKey({ identityKey: true })).publicKey
const unpack = (plain) => JSON.parse(Utils.toUTF8(plain))
async function seal(owner, fields) {
  const { ciphertext } = await owner.encrypt({ plaintext: Utils.toArray(JSON.stringify(fields), 'utf8'), protocolID, keyID: passportId, counterparty: 'self' })
  return { ciphertext, commitment: ownerBlobHash(ciphertext) }
}

test('a legitimate reader receives only its fields from the committed general@2 owner blob', async () => {
  const owner = wallet('11'), reader = wallet('22')
  const fields = { purchase: 'Private invoice', serviceNotes: 'Replace the filter' }
  const blob = await seal(owner, fields)
  const disclosure = await discloseManifestFields({ owner, passportId, ...blob, manifest: readManifest('general@2'), schema: readRestrictedPayloadSchema('general@2'), audience: 'legitimate', readerKey: await publicKey(reader) })
  const { plaintext } = await reader.decrypt({ ciphertext: disclosure, protocolID, keyID: passportId, counterparty: await publicKey(owner) })
  assert.deepEqual(unpack(plaintext), { serviceNotes: 'Replace the filter' })
  assert.deepEqual(unpack((await owner.decrypt({ ciphertext: blob.ciphertext, protocolID, keyID: passportId, counterparty: 'self' })).plaintext), fields)
  assert.equal(ownerBlobHash(blob.ciphertext), blob.commitment)
})

test('an authority may receive legitimate and authority fields, and neither recipient receives owner-only fields', async () => {
  // A synthetic manifest adds a required authority property to the published general profile's fields.
  const manifest = structuredClone(readManifest('general@2'))
  const schema = structuredClone(readRestrictedPayloadSchema('general@2'))
  manifest.fields.push({ ...manifest.fields.find((f) => f.key === 'serviceNotes'), key: 'inspection', pointer: '/inspection', accessTier: 'authority' })
  schema.properties.inspection = { type: 'string', minLength: 1 }
  schema.required = ['purchase', 'inspection']
  const owner = wallet('11'), legitimate = wallet('22'), authority = wallet('33')
  const fields = { purchase: 'Private invoice', serviceNotes: 'Replace the filter', inspection: 'Inspector reference' }
  const blob = await seal(owner, fields)
  const common = { owner, passportId, ...blob, manifest, schema }
  const recipient = async (audience, receiver) => discloseManifestFields({ ...common, audience, readerKey: await publicKey(receiver) })
  const decode = async (receiver, ciphertext) => unpack((await receiver.decrypt({ ciphertext, protocolID, keyID: passportId, counterparty: await publicKey(owner) })).plaintext)
  const forAuthority = await recipient('authority', authority), forLegitimate = await recipient('legitimate', legitimate)
  assert.deepEqual(await decode(authority, forAuthority), { serviceNotes: fields.serviceNotes, inspection: fields.inspection })
  assert.deepEqual(await decode(legitimate, forLegitimate), { serviceNotes: fields.serviceNotes })
  await assert.rejects(decode(legitimate, forAuthority))
  await assert.rejects(discloseManifestFields({ ...common, audience: 'authority', readerKey: await publicKey(authority), commitment: '0'.repeat(64) }), /commitment/)
  const incomplete = await seal(owner, { serviceNotes: fields.serviceNotes })
  await assert.rejects(discloseManifestFields({ ...common, ...incomplete, audience: 'legitimate', readerKey: await publicKey(legitimate) }), /restricted schema/)
  await assert.rejects(recipient('public', legitimate), /audience/)
  await assert.rejects(discloseManifestFields({ ...common, audience: 'legitimate', readerKey: 'self' }), /identity key/)
  assert.equal(ownerBlobHash(blob.ciphertext), blob.commitment)
})
