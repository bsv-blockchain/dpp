/**
 * Pages of a snapshot (`spec/portable-evidence.md` section 1,
 * `contracts/paginated-history.schema.json`): the export beside the bounded
 * lookup, which stays exactly what it is.
 *
 * A snapshot is the highest record sequence at the moment the first page is
 * asked for. Every later page of the export reads only records at or below
 * it, ordered by the store's own sequence, so a record admitted while a
 * reader is walking the pages never appears in them and never shifts a page
 * boundary: two readers of one snapshot receive the same pages. The cursor
 * carries the snapshot and the position, base64url over JSON, and an
 * HMAC-SHA256 tag under a secret this process drew at startup, so a cursor
 * from another process, or one edited in transit, is refused by name rather
 * than read as a position. A snapshot older than the TTL is refused by name
 * too, with the instruction to start again without a cursor, because a stale
 * snapshot continued from the middle would be a history that quietly stopped.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { DPP_SERVICE } from './lsDpp.js'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, SNAPSHOT_TTL_MS } from './limits.js'
import { selectorFilter, type DppRecord, type DppRecordStore, type RecordSelector } from './storage.js'

export const PAGE_VERSION = '1'

/** One record as a page carries it: what the record store knows, nothing hydrated. */
export interface HistoryItem {
  txid: string
  outputIndex: number
  op: string
  timestamp: string
  previousTxid: string
  spent: boolean
  spendingTxid: string
  /** The source's own sequence, the order pages are read in; strictly increasing across the pages of one export. */
  sequence: number
}

export interface HistoryPage {
  pageVersion: typeof PAGE_VERSION
  items: HistoryItem[]
  nextCursor: string | null
  snapshotId: string
  scope: {
    source: string
    query: { passportId: string } | { uid: string }
    /**
     * The sequences this page covers within the snapshot: from the position
     * after the previous page to the last item here, or to the snapshot's own
     * sequence on the last page. Consecutive pages tile the snapshot with no
     * gap and no overlap, so a reader detects a missing or a repeated page
     * from the ranges alone.
     */
    sequenceRange: { from: number; to: number }
  }
  truncated: boolean
  completeForSnapshot: boolean
  pageSize: number
}

export type HistoryErrorCode = 'query-invalid' | 'limit-invalid' | 'cursor-invalid' | 'snapshot-expired'

/** A refusal with the status and the name the wire carries. */
export class HistoryError extends Error {
  constructor(
    readonly status: number,
    readonly code: HistoryErrorCode,
    message: string,
    readonly hint?: string
  ) {
    super(message)
  }
}

export interface Snapshot {
  id: string
  /** Records with a sequence above this are outside the snapshot. */
  sequence: number
  /** When the snapshot was taken, epoch milliseconds; expiry is measured from here. */
  takenAt: number
}

interface CursorPayload {
  v: 1
  snapshot: Snapshot
  query: { passportId: string } | { uid: string }
  /** The sequence of the last item served; the next page starts after it. */
  after: number
}

export interface HistoryRequest {
  selector: RecordSelector
  /** As received on the wire: absent means the default page size. */
  limit?: string | null
  cursor?: string | null
}

const base64url = (bytes: Buffer): string => bytes.toString('base64url')

export class HistoryPaginator {
  private readonly secret: Buffer
  private readonly now: () => Date

  constructor(
    private readonly records: DppRecordStore,
    options: { secret?: Buffer; now?: () => Date } = {}
  ) {
    // Per process, never persisted: a cursor is a resumption token for this
    // node's current snapshot, and outliving the process is exactly what it
    // must not do.
    this.secret = options.secret ?? randomBytes(32)
    this.now = options.now ?? (() => new Date())
  }

  /** Pin the store as it is now. The exporter uses this directly; the paginator does on a first page. */
  async takeSnapshot(): Promise<Snapshot> {
    const sequence = await this.records.highestSequence()
    const takenAt = this.now().getTime()
    return { id: `${sequence}.${takenAt.toString(36)}`, sequence, takenAt }
  }

  /** Every record of the selector within the snapshot, in sequence order, read page by page. */
  async readAll(selector: RecordSelector, snapshot: Snapshot): Promise<DppRecord[]> {
    const all: DppRecord[] = []
    let after = 0
    for (;;) {
      const rows = await this.records.findPage(selector, { after, upTo: snapshot.sequence }, MAX_PAGE_SIZE)
      all.push(...rows)
      if (rows.length < MAX_PAGE_SIZE) return all
      after = rows[rows.length - 1].sequence
    }
  }

  async page(request: HistoryRequest): Promise<HistoryPage> {
    let query: { passportId: string } | { uid: string }
    try {
      query = selectorFilter(request.selector)
    } catch (cause) {
      throw new HistoryError(400, 'query-invalid', cause instanceof Error ? cause.message : 'invalid query')
    }
    const limit = parseLimit(request.limit)

    let snapshot: Snapshot
    let after: number
    if (request.cursor == null || request.cursor === '') {
      snapshot = await this.takeSnapshot()
      after = 0
    } else {
      const payload = this.openCursor(request.cursor)
      if (!sameQuery(payload.query, query)) {
        throw new HistoryError(400, 'cursor-invalid', 'the cursor was issued for a different query')
      }
      if (this.now().getTime() - payload.snapshot.takenAt > SNAPSHOT_TTL_MS) {
        throw new HistoryError(
          410,
          'snapshot-expired',
          `snapshot ${payload.snapshot.id} is older than ${SNAPSHOT_TTL_MS / 1000} seconds`,
          'restart the export without a cursor to read a fresh snapshot from its first page'
        )
      }
      snapshot = payload.snapshot
      after = payload.after
    }

    // One row beyond the page tells whether the snapshot continues, without a
    // count query that would race nothing but cost a scan.
    const rows = await this.records.findPage(query, { after, upTo: snapshot.sequence }, limit + 1)
    const more = rows.length > limit
    const items = rows.slice(0, limit)
    const last = items[items.length - 1]
    const to = more && last != null ? last.sequence : snapshot.sequence
    const nextCursor = more && last != null
      ? this.mintCursor({ v: 1, snapshot, query, after: last.sequence })
      : null
    return {
      pageVersion: PAGE_VERSION,
      items: items.map(toItem),
      nextCursor,
      snapshotId: snapshot.id,
      scope: {
        source: DPP_SERVICE,
        query,
        sequenceRange: { from: Math.min(after + 1, to), to },
      },
      truncated: more,
      // Only on the last page: every record of the selector at or below the
      // snapshot has now been returned across the pages of this export.
      completeForSnapshot: !more,
      pageSize: limit,
    }
  }

  private mintCursor(payload: CursorPayload): string {
    const body = base64url(Buffer.from(JSON.stringify(payload), 'utf8'))
    return `${body}.${this.tag(body)}`
  }

  private tag(body: string): string {
    return base64url(createHmac('sha256', this.secret).update(body).digest())
  }

  private openCursor(cursor: string): CursorPayload {
    const invalid = (detail: string): HistoryError =>
      new HistoryError(400, 'cursor-invalid', `the cursor is not one this node issued: ${detail}`)
    const separator = cursor.lastIndexOf('.')
    if (separator <= 0) throw invalid('malformed')
    const body = cursor.slice(0, separator)
    const given = Buffer.from(cursor.slice(separator + 1), 'base64url')
    const expected = Buffer.from(this.tag(body), 'base64url')
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw invalid('bad signature')
    let payload: CursorPayload
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CursorPayload
    } catch {
      throw invalid('unreadable')
    }
    if (
      payload?.v !== 1 ||
      typeof payload.snapshot?.id !== 'string' ||
      !Number.isSafeInteger(payload.snapshot.sequence) ||
      !Number.isSafeInteger(payload.snapshot.takenAt) ||
      !Number.isSafeInteger(payload.after) ||
      typeof payload.query !== 'object' ||
      payload.query === null
    ) {
      throw invalid('unexpected shape')
    }
    return payload
  }
}

/** Default 100, maximum 500, anything else refused: a string of digits is the only accepted spelling. */
function parseLimit(raw: string | null | undefined): number {
  if (raw == null || raw === '') return DEFAULT_PAGE_SIZE
  if (!/^\d+$/.test(raw)) throw new HistoryError(400, 'limit-invalid', `limit must be an integer from 1 to ${MAX_PAGE_SIZE}`)
  const limit = Number(raw)
  if (limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new HistoryError(400, 'limit-invalid', `limit must be an integer from 1 to ${MAX_PAGE_SIZE}`)
  }
  return limit
}

function sameQuery(a: CursorPayload['query'], b: CursorPayload['query']): boolean {
  return ('passportId' in a ? a.passportId : undefined) === ('passportId' in b ? b.passportId : undefined) &&
    ('uid' in a ? a.uid : undefined) === ('uid' in b ? b.uid : undefined)
}

function toItem(record: DppRecord): HistoryItem {
  return {
    txid: record.txid,
    outputIndex: record.outputIndex,
    op: record.op,
    timestamp: record.timestamp,
    previousTxid: record.previousTxid,
    spent: record.spent,
    spendingTxid: record.spendingTxid,
    sequence: record.sequence,
  }
}
