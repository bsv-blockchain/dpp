/**
 * Retraction (`POST /retract`): removing a state the index admitted on
 * announcement and the network then refused.
 *
 * `spec/writing.md` lets a writer announce a state before it sends it, so the
 * index can hold an output no block will ever contain. That phantom sits on
 * the passport as its tip: the writer's next state builds on nothing, and a
 * reader's `chainFromBeef` finds two successors of one state and can order
 * neither. The writer, who alone knows the network's answer, asks the index
 * to forget the output.
 *
 * What is never retracted: a state with a merkle path (the network did take
 * it), a state the configured chain tracker knows (same), and a spent state
 * (its successor was admitted against it; retracting the middle of a history
 * would leave the successor pointing at nothing).
 *
 * How the removal is done. The Engine's own removal path is its stale-output
 * eviction, `deleteUTXODeep`: delete the output, tell every lookup service it
 * is no longer retained, then recurse into the outputs it consumed and delete
 * each of those too once nothing else consumes them. That recursion is right
 * for the Engine's own case, a topic that did not retain a spent coin, and
 * wrong here: on a history-retaining topic the consumed lineage is the whole
 * lifecycle, and the retraction of one phantom would erase the passport back
 * to its genesis. `deleteUTXODeep` is also private to the Engine. So this
 * module performs the eviction's first step through the same storage and
 * lookup-service calls (`deleteOutput`, then the eviction hook), repairs the
 * predecessor's `consumedBy` exactly as the eviction does, and stops there;
 * then it makes the two repairs the eviction never needs, clearing the
 * predecessor's spent mark and the phantom's applied-transaction record, so
 * the real tip is a tip again and the same transaction can be announced
 * again should the network take it after all.
 */
import { Beef } from '@bsv/sdk'
import type { LookupService, Output } from '@bsv/overlay'
import type { RetractableStorage } from './engineStorage.js'
import type { DppRecordStore } from './storage.js'

export type RetractionRefusalCode = 'output-unknown' | 'retraction-refused' | 'chain-tracker-unavailable'

export class RetractionRefused extends Error {
  constructor(
    readonly status: number,
    readonly code: RetractionRefusalCode,
    message: string
  ) {
    super(message)
  }
}

export interface RetractionRequest {
  storage: RetractableStorage
  lookupServices: Record<string, LookupService>
  records: DppRecordStore
  topic: string
  txid: string
  outputIndex: number
  reason: string
  /**
   * Whether the network knows the transaction, asked of the configured chain
   * tracker's source. Undefined when the deployment has no header source
   * (CHAIN_TRACKER=scripts-only): the check is then not run, and the answer
   * says so.
   */
  knownOnChain?: (txid: string) => Promise<boolean>
}

export interface Retraction {
  txid: string
  outputIndex: number
  reason: string
  /** Whether the network was asked; false under scripts-only, where the local proof check is the whole check. */
  networkChecked: boolean
  /** The predecessor made the tip again, when the retracted state had one. */
  restoredTip?: { txid: string; outputIndex: number }
  /** Repairs the engine storage could not make, by name, when it is not one of this package's. */
  unrepaired: string[]
}

/** Whether the stored BEEF proves the transaction: a bump for its txid, or a merkle path on it. */
function beefProves(beef: number[] | undefined, txid: string): boolean {
  if (beef == null) return false
  try {
    const parsed = Beef.fromBinary(beef)
    const held = parsed.findTxid(txid)
    return held != null && (held.bumpIndex != null || held.tx?.merklePath != null)
  } catch {
    return false
  }
}

/** Why an output as it stands may not be retracted, or undefined when it may. */
function refusalFor(output: Output, txid: string): string | undefined {
  if (output.spent || output.consumedBy.length > 0) {
    return 'the output is spent: a later state was admitted against it, and a history is never cut in the middle'
  }
  if (output.blockHeight != null || beefProves(output.beef, txid)) {
    return 'this index holds a merkle path for the output: the network took the transaction, so there is nothing to retract'
  }
  return undefined
}

export async function retractOutput(request: RetractionRequest): Promise<Retraction> {
  const { storage, topic, txid, outputIndex } = request
  const output: Output | null = await storage.findOutput(txid, outputIndex, topic, undefined, true)
  if (output == null) {
    throw new RetractionRefused(404, 'output-unknown', `this index holds no ${topic} output ${txid}:${outputIndex}`)
  }
  const refusal = refusalFor(output, txid)
  if (refusal != null) throw new RetractionRefused(409, 'retraction-refused', refusal)
  let networkChecked = false
  if (request.knownOnChain != null) {
    let known: boolean
    try {
      known = await request.knownOnChain(txid)
    } catch (cause) {
      throw new RetractionRefused(
        503,
        'chain-tracker-unavailable',
        `the chain tracker could not be asked whether it knows ${txid}; the retraction was not applied, try again: ${cause instanceof Error ? cause.message : String(cause)}`
      )
    }
    if (known) {
      throw new RetractionRefused(409, 'retraction-refused', 'the chain tracker knows this transaction: the network took it, so there is nothing to retract')
    }
    networkChecked = true
  }

  // Nothing here is atomic with the Engine: while the network was asked, a
  // /submit may have admitted a successor or an /arc-ingest may have proven
  // the output. So the output is read again immediately before the delete
  // and refused if it no longer qualifies; the window left is the delete
  // itself, which the storage interface gives no way to close.
  const current = await storage.findOutput(txid, outputIndex, topic, undefined, true)
  if (current == null) {
    throw new RetractionRefused(404, 'output-unknown', `this index no longer holds ${topic} output ${txid}:${outputIndex}`)
  }
  const changed = refusalFor(current, txid)
  if (changed != null) {
    throw new RetractionRefused(409, 'retraction-refused', `the output changed while the retraction was being checked and nothing was removed: ${changed}`)
  }

  // The eviction's first step, through the same calls it makes.
  await storage.deleteOutput(txid, outputIndex, topic)
  for (const service of Object.values(request.lookupServices)) {
    try {
      await service.outputEvicted(txid, outputIndex)
    } catch (cause) {
      console.error(`retraction of ${txid}:${outputIndex}: a lookup service failed to evict it:`, cause)
    }
  }

  // The eviction's repair of the predecessor, then the two it never needs.
  const unrepaired: string[] = []
  let restoredTip: Retraction['restoredTip']
  for (const consumed of output.outputsConsumed) {
    const predecessor = await storage.findOutput(consumed.txid, consumed.outputIndex, topic)
    if (predecessor == null) continue
    const consumedBy = predecessor.consumedBy.filter((c) => !(c.txid === txid && c.outputIndex === outputIndex))
    await storage.updateConsumedBy(consumed.txid, consumed.outputIndex, topic, consumedBy)
    if (consumedBy.length > 0) continue
    if (storage.markUTXOAsUnspent != null) {
      await storage.markUTXOAsUnspent(consumed.txid, consumed.outputIndex, topic)
    } else {
      unrepaired.push(`engine storage still marks ${consumed.txid}:${consumed.outputIndex} spent`)
    }
    await request.records.markUnspent(consumed.txid, consumed.outputIndex)
    restoredTip = { txid: consumed.txid, outputIndex: consumed.outputIndex }
  }
  if (storage.deleteAppliedTransaction != null) {
    await storage.deleteAppliedTransaction({ txid, topic })
  } else {
    unrepaired.push(`engine storage still records ${txid} as applied to ${topic}, so a re-announcement would be skipped as a duplicate`)
  }

  return {
    txid,
    outputIndex,
    reason: request.reason,
    networkChecked,
    ...(restoredTip == null ? {} : { restoredTip }),
    unrepaired,
  }
}
