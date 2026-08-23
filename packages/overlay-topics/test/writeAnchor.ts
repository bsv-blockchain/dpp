import { PushDrop } from '@bsv/sdk'
import type { LockingScript, ProtoWallet, WalletInterface } from '@bsv/sdk'
import { uoraAnchorSigningPreimage, UORA_ANCHOR_PROTOCOL } from '../src/uoraAnchor.js'

/**
 * Write one v3 anchor exactly as the resolver's `anchor()` writes one.
 *
 * Shared by every suite in this directory rather than copied into each, because
 * four almost-identical writers are four chances to drift from the one thing
 * this package is really testing: that a reader here and a writer in the
 * anchoring service agree byte for byte. The fixture catches a drift between the repositories;
 * this catches a drift between the tests.
 *
 * Two details carry the format and neither is decoration:
 *
 * - The signature covers `uoraAnchorSigningPreimage`, each field behind its own
 *   length, and is appended as the eighth field. `includeSignature` is
 *   therefore false: `PushDrop.lock`'s own signature covers `fields.flat()`,
 *   which does not commit to where a field stops, and writing one of those is
 *   writing a v2 anchor under a v3 prefix.
 * - `forSelf: true`. Without it `lock` locks to the counterparty's derived key,
 *   and the anchor still parses, still verifies its own signature, and is
 *   unattributable in exactly the way v1 is.
 */
export async function writeUoraAnchor(
  wallet: ProtoWallet,
  fields: number[][],
  keyId: string
): Promise<LockingScript> {
  const walletInterface = wallet as unknown as WalletInterface
  const { signature } = await walletInterface.createSignature({
    data: uoraAnchorSigningPreimage(fields),
    protocolID: UORA_ANCHOR_PROTOCOL,
    keyID: keyId,
    counterparty: 'anyone',
  })
  return await new PushDrop(walletInterface).lock(
    [...fields, signature],
    UORA_ANCHOR_PROTOCOL,
    keyId,
    'anyone',
    true, // forSelf
    false // the signature is already the last field
  )
}
