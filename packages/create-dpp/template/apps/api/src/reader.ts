// The reader: rebuild a passport's history from an index and verify it
// yourself. The index only finds the bytes; every signature, every link and
// every block proof is checked here, and the report says pass, fail, unknown
// or not-applicable for each check with a reason. Missing evidence stays
// unknown and is never treated as verified.
import { WhatsOnChain, type ChainTracker, type Transaction } from '@bsv/sdk'
import { EVIDENCE_CHECK_LABELS, findDppOutputs, verifyPassportEvidence, type EvidenceReport, type ManagedAcceptanceRecord } from '@bsv/dpp-core'
import type { Network } from './config.js'
import type { IndexClient } from './index-client.js'

/**
 * Ask the header source one question at a time, a little apart, and keep
 * each answer for the run: WhatsOnChain answers only a few requests a second.
 */
export function pacedTracker(inner: ChainTracker, gapMs = 400): ChainTracker {
  const answers = new Map<string, Promise<unknown>>()
  let queue: Promise<unknown> = Promise.resolve()
  const ask = <T>(key: string, question: () => Promise<T>): Promise<T> => {
    if (!answers.has(key)) {
      const answer = queue.then(() => new Promise((wait) => setTimeout(wait, gapMs))).then(question)
      queue = answer.catch(() => {})
      answers.set(
        key,
        answer.catch((error: unknown) => {
          answers.delete(key)
          throw error
        })
      )
    }
    return answers.get(key) as Promise<T>
  }
  return {
    isValidRootForHeight: (root, height) => ask(`${height}:${root}`, () => inner.isValidRootForHeight(root, height)),
    currentHeight: () => ask('height', () => inner.currentHeight()),
  }
}

export function headerSource(network: Network, wocApiKey?: string): ChainTracker {
  return pacedTracker(new WhatsOnChain(network, wocApiKey == null ? {} : { apiKey: wocApiKey }))
}

export interface ReaderOptions {
  index: IndexClient
  /** 'scripts only' checks no inclusion; development and tests use it because nothing there is mined. */
  chainTracker: ChainTracker | 'scripts only'
  /** The custodians whose acceptance records this reader accepts: this platform's own key, and any it trusts. */
  acceptanceCustodians?: string[]
  /** The issuers whose genesis this reader accepts; empty accepts any. */
  genesisIssuers?: string[]
  policyId?: string
}

export interface PassportReading {
  passportId: string
  lineage: Array<{ op: string; txid: string; timestamp: string; controllerKey: string; actorIdentityKey: string; payloadPublic: unknown }>
  report: EvidenceReport
  checks: Array<{ name: string; label: string; status: string; reasonCode?: string }>
  publisherKeys: string[]
}

export async function readPassport(passportId: string, options: ReaderOptions, evidence: { acceptanceRecords?: ManagedAcceptanceRecord[] } = {}): Promise<PassportReading> {
  const publisherKeys = await options.index.publisherKeys()
  const lineage: Transaction[] = await options.index.lineage(passportId)
  if (lineage.length === 0) throw new Error(`the index holds nothing for ${passportId}`)
  const report = await verifyPassportEvidence(
    { tokenHistory: lineage, acceptanceRecords: evidence.acceptanceRecords ?? [] },
    { passportId, source: 'request-context' },
    {
      policyId: options.policyId ?? 'managed-custody@1/application',
      publisherKeys,
      managedAcceptance: { required: true },
      chainTracker: options.chainTracker,
      authority: {
        required: true,
        ...(options.genesisIssuers != null && options.genesisIssuers.length > 0 ? { genesisIssuers: options.genesisIssuers } : {}),
        ...(options.acceptanceCustodians != null ? { acceptanceCustodians: options.acceptanceCustodians } : {}),
      },
    }
  )
  return {
    passportId,
    lineage: lineage.map((tx) => {
      const { state } = findDppOutputs(tx)[0]
      let payloadPublic: unknown = state.payloadPublic
      try {
        payloadPublic = JSON.parse(state.payloadPublic)
      } catch {
        // Left as the string it is.
      }
      return { op: state.op, txid: tx.id('hex'), timestamp: state.timestamp, controllerKey: state.ownerIdentityKey, actorIdentityKey: state.actorIdentityKey, payloadPublic }
    }),
    report,
    checks: report.checks.map((c) => ({ name: c.name, label: EVIDENCE_CHECK_LABELS[c.name], status: c.status, reasonCode: c.reasonCode })),
    publisherKeys,
  }
}
