import { ATOMIC_BEEF, BEEF_V1, BEEF_V2, Beef, Transaction, Utils } from '@bsv/sdk'
import { MANAGED_ACCEPTANCE_FORMAT, MANAGED_ACCEPTANCE_FORMAT_V1 } from './acceptance.js'
import type { EvidencePackageManifest, InventoryEntry, PackageFailure } from './evidencePackage.js'
import type { DppStateV2 } from './types.js'
import { findDppOutputs } from './verifyChain.js'

/** The profile explicitly selected by a package using the custody export rules. */
export const MANAGED_CUSTODY_EXPORT_PROFILE = 'managed-custody@3'

const record = (value: unknown): value is Record<string, unknown> => value != null && typeof value === 'object' && !Array.isArray(value)
const acceptanceFormat = (value: unknown): boolean => value === MANAGED_ACCEPTANCE_FORMAT || value === MANAGED_ACCEPTANCE_FORMAT_V1

function parseJson(text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}

/** Recognise the signed record and retained offer even inside another JSON record or a serialised journal field. */
function publicDisclosureProblem(value: unknown): string | undefined {
  const pending: unknown[] = [value]
  const visited = new WeakSet<object>()
  while (pending.length > 0) {
    const item = pending.pop()
    if (item !== null && typeof item === 'object') {
      if (visited.has(item)) continue
      visited.add(item)
    }
    if (Array.isArray(item)) {
      for (const member of item) pending.push(member)
    } else if (record(item)) {
      if (acceptanceFormat(item.acceptanceFormat) && typeof item.signature === 'string') return 'The public package contains a signed acceptance.'
      if (typeof item.claimCode === 'string' && item.claimCode.length > 0) return 'The public package contains a claim code.'
      if ((item.mechanism === 'claim-code' || item.mechanism === 'named-recipient') &&
          typeof item.requestId === 'string' && typeof item.holderIdentityKey === 'string' && record(item.expectedPredecessor)) return 'The public package contains a retained offer.'
      if (record(item.manifest) && item.manifest.format === 'dpp-evidence-package' && record(item.files)) {
        // The reference archive envelope encodes its files in base64.
        for (const encoded of Object.values(item.files)) {
          if (typeof encoded !== 'string') return 'An embedded package file has no base64 encoding.'
          try { pending.push(Utils.toUTF8(Utils.toArray(encoded, 'base64'))) }
          catch { return 'An embedded package file has invalid base64.' }
        }
      }
      for (const member of Object.values(item)) pending.push(member)
    } else if (typeof item === 'string') {
      const parsed = /^\s*(?:\[|\{|")/.test(item) ? parseJson(item) : undefined
      if (parsed !== undefined) pending.push(parsed)
      // A text report may quote a record alongside prose or several JSON records.
      else if (/"acceptanceFormat"\s*:\s*"dpp-managed-acceptance@[12]"/.test(item) && /"signature"\s*:\s*"/.test(item)) return 'The public text quotes a signed acceptance.'
    }
  }
  return undefined
}

export const privateCustodyRepresentation = (value: unknown): boolean => acceptanceFormat(value) || value === 'dpp-application-offer@1' || value === 'dpp-application-passport-journal@1'

type CustodyEntry = Pick<InventoryEntry, 'category' | 'represents' | 'representation'>

function isBeef(entry: CustodyEntry, bytes: number[] | Uint8Array): boolean {
  if (entry.representation === 'beef' || entry.representation === 'atomic-beef') return true
  if (bytes.length < 4) return false
  const header = new DataView(Uint8Array.from(bytes.slice(0, 4)).buffer).getUint32(0, true)
  return header === BEEF_V1 || header === BEEF_V2 || header === ATOMIC_BEEF
}

/**
 * Transfer commitments covered by an inventory entry. A raw transaction or the named or atomic
 * subject of a BEEF supplies the states. Every DPP payload in those bytes is checked for disclosure,
 * including other outputs and proof ancestors. Callers select the passport they are exporting.
 */
export function publicCustodyTransfers(entry: CustodyEntry, bytes: number[] | Uint8Array): DppStateV2[] {
  const transfers: DppStateV2[] = []
  const outpoint = typeof entry.represents === 'string' ? /^([0-9a-f]{64}):(0|[1-9][0-9]*)$/.exec(entry.represents) : null
  const outputIndex = outpoint == null ? undefined : Number(outpoint[2])
  const read = (tx: Transaction, selected: boolean): void => {
    if (selected && outputIndex != null && outputIndex >= tx.outputs.length) throw new Error('The referenced transaction output is missing.')
    for (const output of findDppOutputs(tx)) {
      const { state } = output
      const problem = publicDisclosureProblem(state.payloadPublic) ?? publicDisclosureProblem(state.eventData)
      if (problem != null) throw new Error(problem)
      if (selected && (outputIndex == null || output.outputIndex === outputIndex) &&
          state.version === '2' && state.op === 'TRANSFER' && state.authorisationCommitment) transfers.push(state)
    }
  }
  if (entry.category === 'transactions') {
    const tx = Transaction.fromBinary(bytes)
    if (outpoint != null && tx.id('hex') !== outpoint[1]) throw new Error('The raw transaction differs from the referenced outpoint.')
    read(tx, true)
  } else if (entry.category === 'proofs' && isBeef(entry, bytes)) {
    const beef = Beef.fromBinaryStrict(bytes)
    if (beef.atomicTxid != null && outpoint != null && beef.atomicTxid !== outpoint[1]) throw new Error('The declared outpoint differs from the atomic BEEF subject.')
    const subject = outpoint?.[1] ?? beef.atomicTxid
    if (subject != null && beef.findTxid(subject) == null) throw new Error('The BEEF lacks its referenced transaction.')
    for (const member of beef.txs) {
      const tx = member.tx
      if (tx != null) read(tx, subject === member.txid)
    }
  }
  return transfers
}

/** Check the declarations of this exporter against the raw transactions in this part. Proof ancestors do not extend a part's scope. */
export function inspectPublicCustody(manifest: EvidencePackageManifest, files: Map<string, number[]>, failures: PackageFailure[]): void {
  const fail = (detail: string, path?: string) => failures.push({ reason: 'disclosure-contradiction', detail, ...(path == null ? {} : { path }) })
  const references = new Set<string>()
  let allTransfersRead = true
  const manifestProblem = publicDisclosureProblem(manifest)
  if (manifestProblem != null) fail(manifestProblem)
  for (const entry of manifest.inventory) {
    const bytes = files.get(entry.path)
    if (bytes == null) continue
    if (privateCustodyRepresentation(entry.representation)) {
      fail('The public package lists a private custody record.', entry.path)
      continue
    }
    if (entry.category === 'transactions' || entry.category === 'proofs') {
      try {
        for (const state of publicCustodyTransfers(entry, bytes)) {
          if (state.passportId === manifest.passportId || manifest.passportId.startsWith('urn:bsv:dpp:evidence-export:sha256:')) {
            references.add('acceptance:sha256:' + state.authorisationCommitment)
          }
        }
      } catch (error) {
        allTransfersRead = false
        fail(error instanceof Error ? error.message : 'The transaction evidence could not be inspected.', entry.path)
        continue
      }
    }
    // Reports and copied records may have any path or media type, and proof bytes can include text.
    const problem = publicDisclosureProblem(Utils.toUTF8(bytes))
    if (problem != null) fail(problem, entry.path)
  }
  const declared = new Set<string>()
  for (const [kind, entries] of [['absent', manifest.completeness.absent], ['withheld', manifest.completeness.withheld]] as const) {
    for (const line of entries) {
      if (typeof line !== 'string' || !line.startsWith('acceptance:')) continue
      const reference = line.split(' ')[0]
      if ((allTransfersRead && !references.has(reference)) || line !== (kind === 'absent' ? reference : reference + ' not-public') || declared.has(reference)) {
        fail(`Invalid or repeated public acceptance declaration in completeness.${kind}.`)
      } else declared.add(reference)
    }
  }
  for (const reference of references) {
    if (!declared.has(reference)) fail(`The exporter must declare ${reference} absent or withheld.`)
  }
}
