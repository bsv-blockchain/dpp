import type {
  LookupFormula,
  LookupQuestion,
  LookupService,
  OutputAdmittedByTopic,
  OutputSpent,
} from '@bsv/overlay'
import { PAYLOAD_DATA_CARRIER_KEY, tryParseDppOutput } from '@bsv/dpp-core'
import { DPP_TOPIC } from './tmDpp.js'
import type { DppRecordInput, DppRecordStore } from './storage.js'

export const DPP_SERVICE = 'ls_dpp'

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

/** Unconfirmed spend announcements kept, at most; a refused spend leaves one behind. */
const PENDING_SPENDS = 1000

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

  /**
   * Spends the Engine has announced whose spending transaction has not yet
   * been admitted, by spending txid. The Engine tells every lookup service
   * that a previous coin was spent before it says whether the spending
   * transaction was admitted, and it says so even when the topic manager
   * refused that transaction (a refused spend of the tip keeps the tip, see
   * tmDpp.ts). A spend is therefore recorded only once the admission of the
   * spending transaction follows, which in `Engine.submit` is the same call
   * when it happens at all; a spend nobody confirms names a state this index
   * never held, and the tip stays a tip. Bounded, because a refused spend
   * leaves its entry behind.
   */
  private readonly pendingSpends = new Map<string, Array<{ txid: string; outputIndex: number }>>()

  constructor(private readonly storage: DppRecordStore) {}

  async outputAdmittedByTopic(payload: OutputAdmittedByTopic): Promise<void> {
    if (payload.mode !== 'locking-script') throw new Error('Invalid admission mode')
    if (payload.topic !== DPP_TOPIC) return
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
    // The store assigns the record's sequence at insert (storage.ts).
    const record: DppRecordInput = {
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
    // The admission confirms the spends the Engine announced for it.
    const spends = this.pendingSpends.get(payload.txid)
    if (spends != null) {
      this.pendingSpends.delete(payload.txid)
      for (const spent of spends) await this.storage.markSpent(spent.txid, spent.outputIndex, payload.txid)
    }
  }

  async outputSpent(payload: OutputSpent): Promise<void> {
    if (payload.mode !== 'txid') throw new Error('Invalid spend notification mode')
    if (payload.topic !== DPP_TOPIC) return
    // Spent states remain part of the lifecycle history (`spec/record-model.md` §1):
    // the record is marked, never removed, and only once the spender is admitted.
    const spends = this.pendingSpends.get(payload.spendingTxid) ?? []
    spends.push({ txid: payload.txid, outputIndex: payload.outputIndex })
    this.pendingSpends.set(payload.spendingTxid, spends)
    while (this.pendingSpends.size > PENDING_SPENDS) {
      const oldest = this.pendingSpends.keys().next().value
      if (oldest == null) break
      this.pendingSpends.delete(oldest)
    }
  }

  async outputNoLongerRetainedInHistory(
    txid: string,
    outputIndex: number,
    topic: string
  ): Promise<void> {
    if (topic !== DPP_TOPIC) return
    await this.storage.delete(txid, outputIndex)
  }

  async outputEvicted(txid: string, outputIndex: number): Promise<void> {
    await this.storage.delete(txid, outputIndex)
  }

  async lookup(question: LookupQuestion): Promise<LookupFormula> {
    if (question.service !== DPP_SERVICE) throw new Error(`Unsupported service ${question.service}`)
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
      `# ${DPP_SERVICE}`,
      '',
      'Lookup for DPP passports, indexed on passport_id and chip UID.',
      'Query: { "passportId": "..." } or { "uid": "..." }.',
      'Answers contain the tip plus all retained historical states as BEEF,',
      'bounded to the newest 500; order with dpp-core chainFromBeef and verify',
      'with verifyChain. GET /history pages the complete history over a stable',
      'snapshot and GET /evidence-package exports it (spec/portable-evidence.md).',
    ].join('\n')
  }

  async getMetaData(): Promise<{ name: string; shortDescription: string; version?: string }> {
    return {
      name: DPP_SERVICE,
      shortDescription: 'Digital Product Passport lookup (tip + lifecycle history)',
      version: '1.0.0',
    }
  }
}
