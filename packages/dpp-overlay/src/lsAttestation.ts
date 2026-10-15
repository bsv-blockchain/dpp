import type { LookupFormula, LookupQuestion, LookupService, OutputAdmittedByTopic, OutputSpent } from '@bsv/overlay'
import { decodeAttestationAnchor } from './attestationAnchor.js'
import { validateAttestationQuery, type AttestationStore } from './attestationStorage.js'
import { ATTESTATION_TOPIC } from './tmAttestation.js'

export const ATTESTATION_SERVICE = 'ls_attestation'

export class AttestationLookupService implements LookupService {
  readonly admissionMode = 'locking-script' as const
  readonly spendNotificationMode = 'txid' as const
  constructor(private readonly storage: AttestationStore) {}

  async outputAdmittedByTopic(payload: OutputAdmittedByTopic): Promise<void> {
    if (payload.mode !== 'locking-script') throw new Error('Invalid admission mode')
    if (payload.topic !== ATTESTATION_TOPIC) return
    const anchor = decodeAttestationAnchor(payload.lockingScript)
    if (!anchor) throw new Error('admitted output is not a valid current attestation anchor')
    const { signature: _signature, ...metadata } = anchor
    await this.storage.insert({ ...metadata, txid: payload.txid, outputIndex: payload.outputIndex, createdAt: new Date() })
  }
  async outputSpent(payload: OutputSpent): Promise<void> {
    if (payload.mode !== 'txid') throw new Error('Invalid spend notification mode')
  }
  async outputNoLongerRetainedInHistory(txid: string, outputIndex: number, topic: string): Promise<void> {
    if (topic === ATTESTATION_TOPIC) await this.storage.delete(txid, outputIndex)
  }
  async outputEvicted(txid: string, outputIndex: number): Promise<void> { await this.storage.delete(txid, outputIndex) }
  async lookup(question: LookupQuestion): Promise<LookupFormula> {
    if (question.service !== ATTESTATION_SERVICE) throw new Error(`Unsupported service ${question.service}`)
    const records = await this.storage.find(validateAttestationQuery(question.query))
    return records.map(({ txid, outputIndex }) => ({ txid, outputIndex }))
  }
  async getDocumentation(): Promise<string> {
    return `${ATTESTATION_SERVICE} returns BRC-24 anchor outpoints. Require an exact issuer, subject, attestationId, digest or anchoredBy selector; attestationType, representation and mediaType may narrow it. limit is an integer from 1 to 500, default 100. Results sort by txid then outputIndex. Set after to the last returned {txid,outputIndex} to continue until an empty page. Pagination observes the current index, not a global snapshot. Unknown fields are rejected. Fetch the original secured bytes separately and verify their digest, metadata and credential proof. Legacy results are queried through ls_uora_dpp.`
  }
  async getMetaData(): Promise<{ name: string; shortDescription: string; version: string }> {
    return { name: ATTESTATION_SERVICE, shortDescription: 'Lookup for complete-representation BSV attestation anchors', version: '1.0.0' }
  }
}
