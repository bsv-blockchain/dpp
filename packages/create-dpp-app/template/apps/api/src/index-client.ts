// The index (overlay) over its HTTP contract: capabilities, lookup, submit,
// retract and proof delivery. Only an answer refuses: an index that cannot
// be reached refuses nothing, and the writer sends anyway and announces the
// same bytes again later. A 401 or 403 is this platform's own configuration
// and stops a write while the state is still a draft.
import { Beef, Transaction, type MerklePath } from '@bsv/sdk'
import { chainFromBeef, decodeAttestationAnchor } from '@bsv/dpp-protocol'

export type Announcement = 'admitted' | 'duplicate' | 'refused' | 'unauthorised' | 'unreachable'

export interface CapabilityDocument {
  implementation?: { name: string; version: string }
  publisherPolicy?: { publisherKeys: string[]; anchoringServices?: string[] }
  profiles?: Array<{ id: string; version: string; kind: string; options?: Record<string, unknown> }>
  [key: string]: unknown
}

export interface IndexClientOptions {
  url: string
  submitToken?: string
  callbackToken?: string
  /** Silence the in-process index's logging during a call; tests use it. */
  quiet?: boolean
}

/** Read a discovery response up to its wire limit, including responses without Content-Length. */
export async function boundedJson(response: Response, limit: number): Promise<unknown> {
  const reader = response.body?.getReader()
  if (reader == null) throw new Error('the response has no body')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.length
      if (length > limit) throw new Error(`the response exceeds the reader limit of ${limit} bytes`)
      chunks.push(chunk.value)
    }
  } finally {
    if (length > limit) await reader.cancel()
    reader.releaseLock()
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
}

export class IndexClient {
  readonly url: string
  private submitToken?: string
  private callbackToken?: string
  /** The last refusal reason the index gave in X-Admission-Refusal, for the journal. */
  lastRefusal: string | undefined

  constructor(options: IndexClientOptions) {
    this.url = options.url.replace(/\/+$/, '')
    this.submitToken = options.submitToken
    this.callbackToken = options.callbackToken
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    return await fetch(`${this.url}${path}`, init)
  }

  /** The index's own health answer, which names the network it serves. */
  async health(): Promise<{ status: string; network: string }> {
    const response = await this.request('/health')
    if (!response.ok) throw new Error(`the index answered HTTP ${response.status} to GET /health`)
    return (await response.json()) as { status: string; network: string }
  }

  async capabilities(): Promise<CapabilityDocument> {
    const response = await this.request('/capabilities')
    if (!response.ok) throw new Error(`the index answered HTTP ${response.status} to GET /capabilities`)
    return (await response.json()) as CapabilityDocument
  }

  /** The publisher keys the index admits, from its own capability document. */
  async publisherKeys(): Promise<string[]> {
    const document = await this.capabilities()
    return document.publisherPolicy?.publisherKeys ?? []
  }

  /** The lineage the index holds for the passport, genesis first, or an empty list. */
  async lineage(passportId: string): Promise<Transaction[]> {
    const response = await this.request('/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'ls_dpp', query: { passportId } }),
    })
    if (!response.ok) throw new Error(`the index answered HTTP ${response.status} to the lookup`)
    const { outputs } = (await response.json()) as { outputs: Array<{ beef: number[] }> }
    if (outputs.length === 0) return []
    const merged = Beef.fromBinary(outputs[0].beef)
    for (const output of outputs.slice(1)) merged.mergeBeef(output.beef)
    return chainFromBeef(merged, passportId)
  }

  /**
   * The attestation anchors the index holds under one selector (`ls_attestation`), each as its transaction and output.
   * An anchor's metadata is unsigned by the claim's issuer: it says where to look, and the claim's own verification
   * decides what the claim is about. Throws when the index cannot be reached or refuses the question.
   */
  async *scanAnchors(query: { subject: string } | { attestationId: string }, representation?: string, signal = AbortSignal.timeout(30_000)): AsyncGenerator<{ transaction: Transaction; outputIndex: number; attestationId: string }> {
    let after: { txid: string; outputIndex: number } | undefined
    let count = 0
    // The lookup contract ends on an empty page. Preserve results already read if a later page fails.
    const maxAnchors = 500
    for (;;) {
      const limit = Math.min(100, maxAnchors - count + 1)
      const response = await this.request('/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ service: 'ls_attestation', query: { ...query, ...(representation == null ? {} : { representation }), limit, after } }),
      })
      if (!response.ok) throw new Error(`the index answered HTTP ${response.status} to the anchor lookup`)
      const { outputs } = (await boundedJson(response, 32 * 1024 * 1024)) as { outputs?: Array<{ beef: number[]; outputIndex: number }> }
      if (!Array.isArray(outputs) || outputs.length > limit) throw new Error('the index returned an invalid anchor page')
      if (outputs.length === 0) return
      for (const output of outputs) {
        if (count === maxAnchors) throw new Error(`the anchor lookup exceeded the reader limit of ${maxAnchors} outputs`)
        const transaction = Transaction.fromBEEF(output.beef)
        const txid = transaction.id('hex')
        const outputIndex = output.outputIndex
        if (!Number.isSafeInteger(outputIndex) || transaction.outputs[outputIndex] == null) throw new Error('the index returned an invalid anchor outpoint')
        if (after != null && (txid < after.txid || (txid === after.txid && outputIndex <= after.outputIndex))) throw new Error('the anchor page did not advance in outpoint order')
        const metadata = decodeAttestationAnchor(transaction.outputs[outputIndex]!.lockingScript)
        if (metadata == null || ('subject' in query && metadata.subject !== query.subject) || ('attestationId' in query && metadata.attestationId !== query.attestationId) || (representation != null && metadata.representation !== representation)) {
          throw new Error('the returned anchor does not match the lookup selector')
        }
        after = { txid, outputIndex }
        count += 1
        yield { transaction, outputIndex, attestationId: metadata.attestationId }
      }
    }
  }

  async anchorsFor(query: { subject: string } | { attestationId: string }, representation?: string): Promise<Array<{ transaction: Transaction; outputIndex: number }>> {
    const anchors = []
    for await (const { transaction, outputIndex } of this.scanAnchors(query, representation)) anchors.push({ transaction, outputIndex })
    return anchors
  }

  /** The identity key the index signs its evidence packages under, as its capability document names it, or nothing when it signs none. */
  async exporterIdentityKey(): Promise<string | undefined> {
    const key = (await this.capabilities()).exporterIdentityKey
    return typeof key === 'string' && /^0[23][0-9a-f]{64}$/.test(key) ? key : undefined
  }

  /**
   * The index's bounded evidence package for one passport (GET /evidence-package), exactly as it answered: the signed
   * manifest and every file by path, base64. `absent` says why there is none: the index holds no state of the
   * passport, signs no package, or could not be reached. Nothing here checks the package; the caller inspects it.
   */
  async evidencePackage(passportId: string): Promise<{ envelope: { manifest: unknown; files: Record<string, string> } } | { absent: 'not-held' | 'export-unavailable' | 'unreachable'; detail: string }> {
    let response: Response
    try {
      response = await this.request(`/evidence-package?${new URLSearchParams({ passportId }).toString()}`)
    } catch (cause) {
      return { absent: 'unreachable', detail: `the index could not be reached (${cause instanceof Error ? cause.message : String(cause)})` }
    }
    if (response.status === 404) return { absent: 'not-held', detail: 'the index holds no state of the passport' }
    if (response.status === 503) return { absent: 'export-unavailable', detail: 'the index signs no evidence package: its operator has not set an exporter key' }
    if (!response.ok) return { absent: 'unreachable', detail: `the index answered HTTP ${response.status} to GET /evidence-package` }
    return { envelope: (await response.json()) as { manifest: unknown; files: Record<string, string> } }
  }

  /**
   * One part of the index's complete export for one passport (GET /evidence-export), exactly as it answered. The
   * bearer is the index's EXPORT_TOKEN, where its operator set one. `absent` says why there is no part.
   */
  async evidenceExportPart(passportId: string, cursor: string | null, token?: string): Promise<{ part: Record<string, unknown> } | { absent: 'not-held' | 'export-unavailable' | 'unauthorised' | 'unreachable'; detail: string }> {
    const query = new URLSearchParams({ passportId })
    if (cursor != null) query.set('cursor', cursor)
    let response: Response
    try {
      response = await this.request(`/evidence-export?${query.toString()}`, token == null ? undefined : { headers: { Authorization: `Bearer ${token}` } })
    } catch (cause) {
      return { absent: 'unreachable', detail: `the index could not be reached (${cause instanceof Error ? cause.message : String(cause)})` }
    }
    if (response.status === 401 || response.status === 403) return { absent: 'unauthorised', detail: 'the index wants its export token for the complete export: set INDEX_EXPORT_TOKEN to the one its operator gave you' }
    if (response.status === 404) return { absent: 'not-held', detail: 'the index holds no state of the passport' }
    if (response.status === 503) return { absent: 'export-unavailable', detail: 'the index signs no evidence package: its operator has not set an exporter key' }
    if (!response.ok) return { absent: 'unreachable', detail: `the index answered HTTP ${response.status} to GET /evidence-export` }
    return { part: (await response.json()) as Record<string, unknown> }
  }

  /** Announce an unsent transaction (spec/writing.md section 3). */
  async announce(beef: number[]): Promise<Announcement> {
    this.lastRefusal = undefined
    let response: Response
    try {
      response = await this.request('/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Topics': JSON.stringify(['tm_dpp']),
          ...(this.submitToken != null ? { Authorization: `Bearer ${this.submitToken}` } : {}),
        },
        body: new Uint8Array(beef),
      })
    } catch {
      return 'unreachable'
    }
    if (response.status === 401 || response.status === 403) return 'unauthorised'
    if (response.status === 400) {
      const body = (await response.json().catch(() => ({}))) as { description?: string }
      this.lastRefusal = body.description ?? 'no reason given'
      return 'refused'
    }
    if (!response.ok) return 'unreachable'
    const admission = response.headers.get('x-admission') ?? ''
    if (admission.includes('tm_dpp=none')) {
      this.lastRefusal = response.headers.get('x-admission-refusal') ?? 'no reason given'
      return 'refused'
    }
    if (admission.includes('duplicate')) return 'duplicate'
    return 'admitted'
  }

  /** Withdraw a state the network refused after the index admitted it. */
  async retract(txid: string, reason: string, outputIndex = 0): Promise<{ ok: boolean; detail: string; absent?: boolean }> {
    let response: Response
    try {
      response = await this.request('/retract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(this.submitToken != null ? { Authorization: `Bearer ${this.submitToken}` } : {}) },
        body: JSON.stringify({ txid, outputIndex, reason }),
      })
    } catch (cause) {
      return { ok: false, detail: `the index could not be reached (${cause instanceof Error ? cause.message : String(cause)})` }
    }
    const body = (await response.json().catch(() => ({}))) as { status?: string; error?: string; description?: string }
    const ok = response.ok && body.status === 'retracted'
    return { ok, absent: response.status === 404 && body.error === 'output-unknown', detail: ok ? 'retracted' : `HTTP ${response.status}${body.error != null ? ` ${body.error}` : ''}${body.description != null ? `, ${body.description}` : ''}` }
  }

  /** Offer a merkle path to the index, in the shape a broadcaster's callback carries (section 7). */
  async pushProof(txid: string, path: MerklePath): Promise<{ ok: boolean; detail: string }> {
    let response: Response
    try {
      response = await this.request('/arc-ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(this.callbackToken != null ? { 'X-Callback-Token': this.callbackToken } : {}) },
        body: JSON.stringify({ txid, merklePath: path.toHex(), blockHeight: path.blockHeight }),
      })
    } catch (cause) {
      return { ok: false, detail: `the index could not be reached (${cause instanceof Error ? cause.message : String(cause)})` }
    }
    const body = (await response.json().catch(() => ({}))) as { status?: string; description?: string }
    const ok = response.ok && body.status === 'applied'
    return { ok, detail: body.status ?? `HTTP ${response.status}${body.description != null ? `, ${body.description}` : ''}` }
  }
}
