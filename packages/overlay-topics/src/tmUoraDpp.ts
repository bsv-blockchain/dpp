import { Transaction } from '@bsv/sdk'
import type { AdmittanceInstructions, TopicManager } from '@bsv/overlay'
import {
  tryParseUoraAnchor,
  uoraAnchorPrefix,
  UORA_ANCHOR_PREFIX,
  UORA_ANCHOR_PREFIX_V2,
} from './uoraAnchor.js'

const NONE: AdmittanceInstructions = { outputsToAdmit: [], coinsToRetain: [] }

/**
 * `tm_uora_dpp`: admission for UORA attestation anchors.
 *
 * The second rail. `tm_dpp` admits the passport itself, a chain of states each
 * spending the last; this one admits the anchors that say what a named party
 * claimed about a passport and when. They are deliberately separate topics
 * rather than one: they carry different formats, they are written by different
 * treasuries, and an instance may reasonably want one and not the other.
 *
 * ## How this differs from `tm_dpp`, and why the rules are shorter
 *
 * An anchor is a leaf. It is never spent, it has no predecessor and no
 * transition rules apply, so `previousCoins` is not consulted and nothing is
 * retained. Everything admissible about one is legible in the output itself,
 * which is the property that makes the format worth versioning.
 *
 * **Every valid anchor in the transaction is admitted, not exactly one.**
 * `tm_dpp` insists on exactly one output because a second passport state in the
 * same transaction would make "the tip" ambiguous. Anchors have no such
 * relation to each other: each is independent and self-validating. Admitting
 * all of them means a service can batch a fleet's worth of attestations into
 * one transaction later without the topic needing to change, which at battery
 * scale is the difference between one anchor per event being affordable and not.
 *
 * ## The admission policy
 *
 * Structural validity is `tryParseUoraAnchor`, and it already includes the
 * attribution: the prefix, a 64-character digest, a resolvable `did:key`
 * issuer, a subject, a type, the anchoring service's identity key, the appended
 * signature sealing all seven **at the boundaries they were written at**, and
 * the locking key being the BRC-42 child of the service key the output itself
 * names. Producing an output that passes needs that key's private half, so
 * every admitted anchor is attributable without this topic being told anything.
 *
 * That is the part v1 could not express, and the reason the service key is a
 * field rather than a configuration value. A shared overlay serving several DPP
 * deployments should not need a key list amended every time one is added, and a
 * key list is not a security boundary anyway: it is a preference about whose
 * anchors to carry.
 *
 * Which is exactly what the optional list is. Name services and this instance
 * carries only theirs; name none and it carries any well-formed anchor, each of
 * which still says whose it is.
 *
 * ## Only v3
 *
 * v2 is not admitted, and the reason is not tidiness. A v2 signature covers the
 * field bytes run together, so it does not fix where the subject stops and the
 * type starts, and any holder of a v2 anchor can re-cut that boundary and keep
 * the signature. An index built on those fields would then be keyed on a
 * subject nobody signed. `uoraAnchor.ts` sets out the whole of it.
 *
 * Nothing in the `TopicManager` contract lets a topic explain a refusal: the
 * answer is a list of indices, and an absent index says only "not this one". So
 * a v2 anchor is also warned about on the node's own console, because a
 * treasury still writing v2 would otherwise get a 200 and an empty list back
 * and have no way to tell that from a transaction carrying no anchors. A
 * submitter that cares still has to read the admitted list rather than the HTTP
 * status.
 */
export class UoraAnchorTopicManager implements TopicManager {
  private readonly accepted: readonly string[]

  constructor(anchorServiceKeys: readonly string[] = []) {
    this.accepted = [...anchorServiceKeys].filter((key) => key !== '')
  }

  async identifyAdmissibleOutputs(beef: number[]): Promise<AdmittanceInstructions> {
    let tx: Transaction
    try {
      tx = Transaction.fromBEEF(beef)
    } catch {
      return NONE
    }

    const outputsToAdmit: number[] = []
    for (const [outputIndex, output] of tx.outputs.entries()) {
      const anchor = tryParseUoraAnchor(output.lockingScript)
      if (anchor == null) {
        // A v2 anchor is turned away out loud. `outputsToAdmit` cannot tell a
        // refusal from an output that was never an anchor, and a treasury still
        // writing v2 would otherwise see a 200 and an empty list and read it as
        // "nothing to index here". Everything else that fails to parse is
        // somebody else's output and is not worth a line.
        if (uoraAnchorPrefix(output.lockingScript) === UORA_ANCHOR_PREFIX_V2) {
          console.warn(
            `tm_uora_dpp: refused output ${outputIndex}, a ${UORA_ANCHOR_PREFIX_V2} anchor. ` +
              'Its signature covers the field bytes run together, so the boundary between the ' +
              `subject and the type is unsigned. Rewrite it as ${UORA_ANCHOR_PREFIX}.`
          )
        }
        continue
      }
      if (this.accepted.length > 0 && !this.accepted.includes(anchor.anchoredBy)) continue
      outputsToAdmit.push(outputIndex)
    }

    // Nothing is ever retained: an anchor is never spent, so there is no
    // history for a spend to consume.
    return { outputsToAdmit, coinsToRetain: [] }
  }

  async getDocumentation(): Promise<string> {
    return [
      `# tm_uora_dpp`,
      '',
      `Admission for UORA attestation anchors in the ${UORA_ANCHOR_PREFIX} format.`,
      '',
      'An anchor is a 1-satoshi PushDrop output carrying, in order: the version',
      'prefix, the SHA-256 digest of the attestation in lower-case hex, the',
      "attestation id, the issuer's did:key, the subject passport id, the UORA",
      "attestation type, and the anchoring service's identity key. An eighth",
      'field holds an ECDSA signature by the key that locks the output, over',
      'each of the seven preceded by its length as a varint. The lengths are',
      'the point: the signature fixes where every field stops, so no reader can',
      'be shown the same bytes cut into a different subject and type.',
      '',
      'Admitted when all seven parse, the issuer resolves to a compressed',
      'secp256k1 key, that signature verifies against the locking key, and the',
      'locking key is the BRC-42 child of the service key in field 6 at protocol',
      "[1, 'uora anchor v3'], key id the attestation id, counterparty 'anyone'.",
      'The derivation is reproducible by anyone holding the output, and both it',
      "and the signature need the service key's private half, so an admitted",
      'anchor names its author checkably and carries no field its author did not',
      'sign at the boundary it is read at.',
      '',
      `${UORA_ANCHOR_PREFIX_V2} is superseded and is not admitted. Its signature`,
      'covered the field bytes run together, which left the boundary between the',
      'subject and the type unsigned and re-cuttable by any holder.',
      '',
      'The issuer in field 3 is signed but not proved: anyone able to write an',
      'anchor can write any DID there, and the signature says only that the',
      'anchoring service wrote that DID and not that the party consented. What',
      "the claim itself is worth is settled by the attestation's own signature,",
      'which is not on chain.',
      '',
      'An instance may narrow to named anchoring services. That is a preference',
      'about whose anchors to carry, not a security boundary.',
      '',
      'Anchors are leaves: never spent, nothing retained, no transition rules.',
      'Every valid anchor in a transaction is admitted, so anchors may be batched.',
    ].join('\n')
  }

  async getMetaData(): Promise<{ name: string; shortDescription: string; version?: string }> {
    return {
      name: 'tm_uora_dpp',
      shortDescription: `UORA attestation anchor admission (${UORA_ANCHOR_PREFIX})`,
      version: '3.0.0',
    }
  }
}
