import type {
  LookupFormula,
  LookupQuestion,
  LookupService,
  OutputAdmittedByTopic,
  OutputSpent,
} from '@bsv/overlay'
import { PAYLOAD_DATA_CARRIER_KEY, tryParseDppOutput } from '@bsv/dpp-core'
import type { DppRecord, DppRecordStore } from './storage.js'

export interface DppLookupQuery {
  passportId?: string
  uid?: string
}

/**
 * Answers stay bounded whatever the caller asks for; matches the anchor
 * rail's MAX_ANCHOR_RESULTS. A lifecycle this long has never existed, but the
 * cap is what stands between one query and a BEEF hydrated per stored state.
 */
export const MAX_LOOKUP_RESULTS = 500

/**
 * ls_dpp - passport lookup (`spec/services.md` §2).
 *
 * Indexed on passport_id and chip UID (the data-carrier property inside
 * payload_public). Returns the tip plus the ordered history: spent states are
 * kept (the engine retains them via tm_dpp's coinsToRetain) so a fresh device
 * can resolve and verify the full lifecycle. Clients order the result with
 * dpp-core's chainFromBeef; record order here is best-effort.
 */
export class DppLookupService implements LookupService {
  readonly admissionMode = 'locking-script' as const
  readonly spendNotificationMode = 'txid' as const

  constructor(private readonly storage: DppRecordStore) {}

  async outputAdmittedByTopic(payload: OutputAdmittedByTopic): Promise<void> {
    if (payload.mode !== 'locking-script') throw new Error('Invalid admission mode')
    if (payload.topic !== 'tm_dpp') return
    const parsed = tryParseDppOutput(payload.lockingScript)
    if (parsed == null) return
    const { state } = parsed
    let uid = ''
    try {
      const publicPayload = JSON.parse(state.payloadPublic) as Record<string, unknown>
      const carrier = publicPayload[PAYLOAD_DATA_CARRIER_KEY]
      if (typeof carrier === 'string') uid = carrier
    } catch {
      // payload_public was validated as JSON at admission; defensive only
    }
    const record: DppRecord = {
      txid: payload.txid,
      outputIndex: payload.outputIndex,
      passportId: state.passportId,
      uid,
      op: state.op,
      timestamp: state.timestamp,
      previousTxid: state.previousTxid,
      spent: false,
      spendingTxid: '',
      createdAt: new Date(),
    }
    await this.storage.insert(record)
  }

  async outputSpent(payload: OutputSpent): Promise<void> {
    if (payload.mode !== 'txid') throw new Error('Invalid spend notification mode')
    if (payload.topic !== 'tm_dpp') return
    // Spent states remain part of the lifecycle history (`spec/record-model.md` §1); mark only.
    await this.storage.markSpent(payload.txid, payload.outputIndex, payload.spendingTxid)
  }

  async outputNoLongerRetainedInHistory(
    txid: string,
    outputIndex: number,
    topic: string
  ): Promise<void> {
    if (topic !== 'tm_dpp') return
    await this.storage.delete(txid, outputIndex)
  }

  async outputEvicted(txid: string, outputIndex: number): Promise<void> {
    await this.storage.delete(txid, outputIndex)
  }

  async lookup(question: LookupQuestion): Promise<LookupFormula> {
    if (question.service !== 'ls_dpp') throw new Error(`Unsupported service ${question.service}`)
    // Non-empty strings only, checked here and not only at the HTTP handler,
    // because MiniOverlay calls this directly and MongoDppStorage would run
    // whatever object it is handed as a filter.
    const query = (question.query ?? {}) as DppLookupQuery
    const passportId =
      typeof query.passportId === 'string' && query.passportId !== '' ? query.passportId : undefined
    const uid = typeof query.uid === 'string' && query.uid !== '' ? query.uid : undefined
    if (passportId == null && uid == null) {
      throw new Error('Query must provide passportId or uid')
    }
    const records =
      passportId != null
        ? await this.storage.findByPassport(passportId)
        : await this.storage.findByUid(uid as string)
    // The newest states survive the cap so the tip stays resolvable; a caller
    // holding a truncated history sees verification fail, not a stale tip.
    return records
      .slice(-MAX_LOOKUP_RESULTS)
      .map((r) => ({ txid: r.txid, outputIndex: r.outputIndex }))
  }

  async getDocumentation(): Promise<string> {
    return [
      '# ls_dpp',
      '',
      'Lookup for DPP passports, indexed on passport_id and chip UID.',
      'Query: { "passportId": "..." } or { "uid": "..." }.',
      'Answers contain the tip plus all retained historical states as BEEF;',
      'order with dpp-core chainFromBeef and verify with verifyChain.',
    ].join('\n')
  }

  async getMetaData(): Promise<{ name: string; shortDescription: string; version?: string }> {
    return {
      name: 'ls_dpp',
      shortDescription: 'Digital Product Passport lookup (tip + lifecycle history)',
      version: '1.0.0',
    }
  }
}
