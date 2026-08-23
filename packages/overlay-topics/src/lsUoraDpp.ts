import type {
  LookupFormula,
  LookupQuestion,
  LookupService,
  OutputAdmittedByTopic,
  OutputSpent,
} from '@bsv/overlay'
import { tryParseUoraAnchor, UORA_ANCHOR_PREFIX } from './uoraAnchor.js'
import type { UoraAnchorQuery, UoraAnchorStore } from './anchorStorage.js'

export const UORA_TOPIC = 'tm_uora_dpp'
export const UORA_SERVICE = 'ls_uora_dpp'

/**
 * `ls_uora_dpp`: the DID-keyed lookup.
 *
 * The question this exists to answer is "what has this party attested", keyed
 * on the issuer's `did:key`, and it is the question no index over the v1 anchor
 * format could answer at all: a v1 anchor names no issuer, so an indexer
 * holding one has a digest and no idea whose claim it covers.
 *
 * Four other selectors come free from the same fields and are worth having:
 * the subject (every claim about one passport, from every party), the
 * attestation id (the anchor for one known claim), the digest (given an
 * attestation in hand, has anyone anchored exactly this), and the UORA type,
 * which narrows any of the others.
 *
 * ## What the answer is, and what it is not
 *
 * The answer is outputs, as BRC-24 requires, so the caller receives the anchors
 * as chain data and checks them without trusting this service. That matters
 * more here than for a passport lookup: this index is derived from the outputs,
 * so an index that lied would be caught by the caller reading the same outputs
 * it just returned.
 *
 * The answer is **not** the attestations. Those are never on chain, by the
 * privacy rule, so a caller who wants the claim itself fetches it from the
 * resolver and checks its digest against the anchor this returned. The anchor
 * is the proof; the resolver is merely convenient.
 */
export class UoraAnchorLookupService implements LookupService {
  readonly admissionMode = 'locking-script' as const
  readonly spendNotificationMode = 'txid' as const

  constructor(private readonly storage: UoraAnchorStore) {}

  async outputAdmittedByTopic(payload: OutputAdmittedByTopic): Promise<void> {
    if (payload.mode !== 'locking-script') throw new Error('Invalid admission mode')
    if (payload.topic !== UORA_TOPIC) return
    const anchor = tryParseUoraAnchor(payload.lockingScript)
    // Admission already validated this; a null here would mean the topic
    // manager and this service disagree, and indexing a half-read output is
    // worse than not indexing it.
    if (anchor == null) return
    await this.storage.insert({
      txid: payload.txid,
      outputIndex: payload.outputIndex,
      digest: anchor.digest,
      attestationId: anchor.attestationId,
      issuer: anchor.issuer,
      issuerKey: anchor.issuerKey,
      subject: anchor.subject,
      uoraType: anchor.uoraType,
      anchoredBy: anchor.anchoredBy,
      lockingKey: anchor.lockingKey,
      createdAt: new Date(),
    })
  }

  /**
   * An anchor is a leaf and should never be spent. If one is, the claim it
   * carries is unaffected: the digest sat at that point in the chain's order
   * whatever later happened to the satoshi. So the record stays, and the spend
   * is not recorded, because nothing about this index turns on it.
   */
  async outputSpent(payload: OutputSpent): Promise<void> {
    if (payload.mode !== 'txid') throw new Error('Invalid spend notification mode')
  }

  async outputNoLongerRetainedInHistory(
    txid: string,
    outputIndex: number,
    topic: string
  ): Promise<void> {
    if (topic !== UORA_TOPIC) return
    await this.storage.delete(txid, outputIndex)
  }

  async outputEvicted(txid: string, outputIndex: number): Promise<void> {
    await this.storage.delete(txid, outputIndex)
  }

  async lookup(question: LookupQuestion): Promise<LookupFormula> {
    if (question.service !== UORA_SERVICE) {
      throw new Error(`Unsupported service ${question.service}`)
    }
    const query = (question.query ?? {}) as UoraAnchorQuery
    // Refused rather than ignored: `selectors()` in the storage layer would
    // drop a non-string field, and a query that silently loses a selector
    // answers broader than it was asked, up to a full scan under the cap.
    const fields = [
      'issuer',
      'issuerKey',
      'subject',
      'attestationId',
      'digest',
      'uoraType',
      'anchoredBy',
    ] as const
    for (const field of fields) {
      const value = query[field]
      if (value != null && typeof value !== 'string') {
        throw new Error(`Query field ${field} must be a string`)
      }
    }
    // `uoraType` alone is every anchor of a common type, which is a table scan
    // wearing a query, so it narrows and never selects.
    const selective = [
      query.issuer,
      query.issuerKey,
      query.subject,
      query.attestationId,
      query.digest,
      query.anchoredBy,
    ].some((value) => typeof value === 'string' && value !== '')
    if (!selective) {
      throw new Error(
        'Query must provide issuer, issuerKey, subject, attestationId, digest or anchoredBy'
      )
    }
    const records = await this.storage.find(query)
    return records.map((record) => ({ txid: record.txid, outputIndex: record.outputIndex }))
  }

  async getDocumentation(): Promise<string> {
    return [
      `# ${UORA_SERVICE}`,
      '',
      `Lookup for ${UORA_ANCHOR_PREFIX} attestation anchors, keyed on the issuer DID.`,
      '',
      'Query with at least one of `issuer` (a did:key), `issuerKey` (the same',
      'key as hex), `subject` (a passport id), `attestationId`, `digest`, or',
      '`anchoredBy` (the treasury that wrote the anchor). `uoraType` narrows any',
      'of them and cannot select on its own. All are',
      'exact matches. `limit` caps the answer and is itself capped.',
      '',
      'Every indexed field is one the anchoring service signed, at the boundary',
      'it is read at: the signature covers each field behind its length, so the',
      'subject this index is keyed on is the subject that was written. Anchors',
      'in the superseded uora-anchor-v2 layout are not admitted and are',
      'therefore not indexed, because their signature left that boundary open.',
      '',
      'The answer is the anchor outputs as BEEF, so the caller verifies them',
      'against the chain rather than trusting this index. The attestations',
      'themselves are never on chain: fetch one from the resolver and check its',
      "canonical digest against the anchor's.",
    ].join('\n')
  }

  async getMetaData(): Promise<{ name: string; shortDescription: string; version?: string }> {
    return {
      name: UORA_SERVICE,
      shortDescription: 'UORA attestation anchor lookup, keyed on issuer DID',
      version: '1.0.0',
    }
  }
}
