import { Utils } from '@bsv/sdk'
import { ownerBlobHash } from '@bsv/dpp-protocol'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

/**
 * An off-chain disclosure from the owner's committed, self-encrypted blob. Supply the manifest
 * and its generated restricted schema for the recorded profile. The application
 * establishes the recipient's entitlement before choosing an audience and key.
 */
export async function discloseManifestFields({ owner, passportId, ciphertext, commitment, manifest, schema, audience, readerKey }) {
  if (audience !== 'legitimate' && audience !== 'authority') throw new Error('The reader needs a legitimate or authority audience.')
  if (typeof readerKey !== 'string' || !/^0[23][0-9a-f]{64}$/i.test(readerKey)) throw new Error('The entitled reader must supply a compressed identity key.')
  if (ownerBlobHash(ciphertext) !== commitment) throw new Error('The owner blob differs from the record commitment.')
  const protocol = { protocolID: [2, 'dpp owner data v1'], keyID: passportId }
  const { plaintext } = await owner.decrypt({ ...protocol, ciphertext, counterparty: 'self' })
  const fields = JSON.parse(Utils.toUTF8(plaintext))
  const validate = addFormats(new Ajv2020())
  if (!validate.compile(schema)(fields)) throw new Error('The committed fields do not satisfy the restricted schema.')

  const allowed = new Set(manifest.fields.filter((field) => field.accessTier === 'legitimate' || (audience === 'authority' && field.accessTier === 'authority')).map((field) => field.key))
  const selected = Object.fromEntries(Object.entries(fields).filter(([key]) => allowed.has(key)))
  // The same property constraints apply. A required field in a withheld tier
  // belongs to the complete owner object and cannot be required of this reader.
  const { $id, required = [], ...constraints } = schema
  if (!validate.compile({ ...constraints, required: required.filter((key) => allowed.has(key)) })(selected)) throw new Error('The selected fields do not satisfy the restricted schema.')
  const disclosure = await owner.encrypt({ ...protocol, plaintext: Utils.toArray(JSON.stringify(selected), 'utf8'), counterparty: readerKey })
  return disclosure.ciphertext
}
