import type {
  LookupFormula,
  LookupQuestion,
  LookupService,
  OutputAdmittedByTopic,
  OutputSpent,
} from '@bsv/overlay'
import { CARRIER_DEPLOY_OUTPUT_INDEX, PAYLOAD_DATA_CARRIER_KEY, tokenIdOf, tryParseDppOutput } from '@bsv/dpp-core'
import { DPP_TOPIC } from './tmDpp.js'
import { normaliseGs1Key } from './gs1Key.js'
import type { DppRecordInput, DppRecordStore } from './storage.js'

export const DPP_SERVICE = 'ls_dpp'

export interface DppLookupQuery {
  passportId?: string
  uid?: string
  /**
   * The token id of a carried lineage (`spec/token-carrier.md` §3): the
   * genesis txid, 64 lower-case hex characters, followed by `_0`. Answers
   * the states of the one version 3 lineage that token is; versions 1 and 2
   * carry no token and are never answered by it.
   */
  tokenId?: string
  /**
   * A GS1 key with no host: the tuple `01:{gtin}|21:{serial}`, the path
   * `01/{gtin}/21/{serial}`, or any Digital Link URI. Answers the states of
   * every passport whose identifier names that key, under whatever host it was
   * issued, so the caller learns each exact identifier and verifies it.
   */
  gs1Key?: string
}

/** The one spelling of a token id this service answers by: the deploy txid and the implied index. */
const TOKEN_ID = /^[0-9a-f]{64}_0$/

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
 * Indexed on passport_id, chip UID (the data-carrier property inside
 * payload_public), the GS1 key tuple the passport identifier names and, for
 * a version 3 state, the token id of its carried lineage. Returns the tip plus the ordered history: spent states are
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
    // A carried state is also found by its token (`spec/token-carrier.md`
    // §3): the lineage genesis the body names, or the state itself when it is
    // the genesis, which admission held to output 0. Versions 1 and 2 carry
    // no token, and the field is absent rather than empty so the Mongo index
    // never matches them to each other.
    const tokenId =
      state.version === '3'
        ? tokenIdOf(state.lineageGenesis ?? { txid: payload.txid, outputIndex: CARRIER_DEPLOY_OUTPUT_INDEX })
        : undefined
    // The store assigns the record's sequence at insert (storage.ts).
    const record: DppRecordInput = {
      txid: payload.txid,
      outputIndex: payload.outputIndex,
      passportId: state.passportId,
      uid,
      ...(tokenId == null ? {} : { tokenId }),
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
    const tokenId = typeof query.tokenId === 'string' && query.tokenId !== '' ? query.tokenId : undefined
    const gs1Key = typeof query.gs1Key === 'string' && query.gs1Key !== '' ? query.gs1Key : undefined
    if (passportId == null && uid == null && tokenId == null && gs1Key == null) {
      throw new Error('Query must provide passportId, uid, tokenId or gs1Key')
    }
    let records
    if (passportId != null) records = await this.storage.findByPassport(passportId)
    else if (uid != null) records = await this.storage.findByUid(uid)
    else if (tokenId != null) {
      // Refused by name rather than answered empty: a token id in another
      // spelling (display order reversed, an index other than 0, upper-case
      // hex) is a different string to the store and would read as a lineage
      // this index does not hold.
      if (!TOKEN_ID.test(tokenId)) throw new Error('tokenId must be the lineage token id: the genesis txid as 64 lower-case hex characters followed by _0')
      records = await this.storage.findByTokenId(tokenId)
    } else {
      const tuple = normaliseGs1Key(gs1Key as string)
      if (tuple == null) throw new Error('gs1Key must be a GS1 key tuple such as 01:09529990001039|21:SERIAL, a Digital Link path such as 01/09529990001039/21/SERIAL, or a Digital Link URI')
      records = await this.storage.findByGs1Key(tuple)
    }
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
      'Lookup for DPP passports, indexed on passport_id, chip UID, the GS1 key',
      'the identifier names and, for a version 3 lineage, its token id.',
      'Query: { "passportId": "..." }, { "uid": "..." }, { "tokenId": "<genesis txid>_0" }',
      'or { "gs1Key": "..." }.',
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
