import { Transaction } from '@bsv/sdk'
import type { AdmittanceInstructions, TopicManager } from '@bsv/overlay'
import type { PublisherPolicy } from '@bsv/dpp-core'
import { decodeAttestationAnchor, ATTESTATION_ANCHOR_PREFIX } from './attestationAnchor.js'
import { policyKeysFor } from './policyConfig.js'

export const ATTESTATION_TOPIC = 'tm_attestation'

export interface AttestationAdmissionOptions {
  /**
   * The publisher key policy chain (`spec/services.md` section 1), verified by
   * the caller. When present and in force for this topic, an anchor is
   * admitted only when its anchoring service is an anchor-publisher key active
   * at admission time, and the static list is not consulted. Admission time,
   * not the anchor's time: an anchor carries no timestamp, so the instant a
   * key's window is held against is the only instant the index has. A late
   * announcement of an anchor written under a since-retired key is therefore
   * refused, which the operator resolves by re-announcing before retiring the
   * key or by keeping the key active until the backlog is announced.
   */
  publisherPolicy?: PublisherPolicy[]
  /** The clock admission time is read from; injectable for tests. */
  now?: () => Date
}

/** Independent anchor admission. Credential proof, authority and status require the document. */
export class AttestationTopicManager implements TopicManager {
  private readonly policy?: PublisherPolicy[]
  private readonly now: () => Date

  constructor(
    private readonly acceptedAnchoringServices: string[] = [],
    options: AttestationAdmissionOptions = {}
  ) {
    this.policy = options.publisherPolicy != null && options.publisherPolicy.length > 0 ? options.publisherPolicy : undefined
    this.now = options.now ?? (() => new Date())
  }

  /** The anchoring services admitted at this instant; undefined means any well-formed anchor. */
  private acceptedAt(at: Date): string[] | undefined {
    if (this.policy != null) {
      const keys = policyKeysFor(this.policy, at, 'anchor-publisher', ATTESTATION_TOPIC)
      if (keys != null) return keys
    }
    return this.acceptedAnchoringServices.length === 0 ? undefined : this.acceptedAnchoringServices
  }

  async identifyAdmissibleOutputs(beef: number[]): Promise<AdmittanceInstructions> {
    const outputsToAdmit: number[] = []
    try {
      const transaction = Transaction.fromBEEF(beef)
      if (!Array.isArray(transaction.inputs) || transaction.inputs.length === 0 || !Array.isArray(transaction.outputs) || transaction.outputs.length === 0) return { outputsToAdmit: [], coinsToRetain: [] }
      const accepted = this.acceptedAt(this.now())
      for (let index = 0; index < transaction.outputs.length; index++) {
        const anchor = decodeAttestationAnchor(transaction.outputs[index].lockingScript)
        if (anchor && (accepted == null || accepted.includes(anchor.anchoredBy))) outputsToAdmit.push(index)
      }
    } catch { /* Invalid transaction input admits no outputs. */ }
    return { outputsToAdmit, coinsToRetain: [] }
  }
  async getDocumentation(): Promise<string> {
    const policy = this.policy == null
      ? ''
      : ' This index admits anchors only from anchor-publisher keys active at admission time under its publisher key policy (spec/services.md section 1); an anchor carries no timestamp, so admission time is the instant held against the key window. GET /capabilities lists the keys active now.'
    return `${ATTESTATION_TOPIC} admits ${ATTESTATION_ANCHOR_PREFIX} outputs with ten fields and an exact five-OP_2DROP tail. The anchoring service signs nine length-prefixed fields. The digest commits to the complete secured representation. Carried issuer/subject/type/representation/media metadata must be checked against that document. Admission proves anchoring-service attribution, not credential validity, issuer authority, status, availability or VSC conformance. Legacy UORA layouts belong to their separately named historical topic.${policy}`
  }
  async getMetaData(): Promise<{ name: string; shortDescription: string; version: string }> {
    return { name: ATTESTATION_TOPIC, shortDescription: 'BSV attestation commitments with explicit representation formats', version: '1.1.0' }
  }
}
