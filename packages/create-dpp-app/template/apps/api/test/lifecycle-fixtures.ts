// What the lifecycle claim tests share: synthetic EPCIS events about this
// application's own passports, and a small stand-in for a registry that
// admits EPCIS lifecycle claims.
//
// The stand-in does what the registry contract says a registry does with
// `dpp-epcis-lifecycle-json@1`, and no more: it verifies the claim, keeps
// the exact bytes, anchors them once per bound passport in one transaction
// on the index's `tm_attestation`, and serves the bytes from its proof
// route. Its proof answer and its refusals have the members the contract
// gives them: `securedBytes` for the exact bytes, `outcome` and `issues`
// for a refusal. It is not the reference registry, listens on 127.0.0.1
// only, and funds its transactions the way the test wallet does, with
// made-up coins only an index with its header checks off takes.
import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { LockingScript, MerklePath, PrivateKey, ProtoWallet, Transaction, UnlockingScript } from '@bsv/sdk'
import { buildAttestationAnchor } from '@bsv/dpp-protocol'
import {
  EPCIS_LIFECYCLE_MEDIA_TYPE,
  EPCIS_LIFECYCLE_REPRESENTATION,
  epcisLifecycleAnchorMetadata,
  parseEpcisLifecycleClaim,
  verifyEpcisLifecycleClaim,
} from '@bsv/dpp-credentials/epcis-lifecycle'

export type Json = Record<string, unknown>

/* --------------------------------- identifiers ---------------------------- */

/** The SGTIN URN of a passport minted as a GS1 Digital Link: the same item, written the EPC way. */
export function sgtinOf(passportId: string): string {
  const match = /\/01\/(\d{14})\/21\/([^/?#]+)$/.exec(passportId)
  if (match == null) throw new Error(`${passportId} is not a Digital Link of an item`)
  const gtin = match[1]!
  return `urn:epc:id:sgtin:${gtin.slice(1, 8)}.${gtin[0]}${gtin.slice(8, 13)}.${match[2]}`
}

/** The class of a passport's product at model level, as a GS1 Digital Link with no serial. */
export function classOf(passportId: string): string {
  const match = /\/01\/(\d{14})\//.exec(passportId)
  if (match == null) throw new Error(`${passportId} carries no GTIN`)
  return `https://id.gs1.org/01/${match[1]}`
}

const prefix = '9521234'
export const PARTY = { maker: `urn:epc:id:pgln:${prefix}.00001`, carrier: `urn:epc:id:pgln:${prefix}.00002`, retailer: `urn:epc:id:pgln:${prefix}.00003`, repairer: `urn:epc:id:pgln:${prefix}.00006` }
export const PLACE = { factory: `urn:epc:id:sgln:${prefix}.00001.0`, warehouse: `urn:epc:id:sgln:${prefix}.00002.0`, shop: `urn:epc:id:sgln:${prefix}.00003.0`, workshop: `urn:epc:id:sgln:${prefix}.00006.0` }
export const PALLET = `urn:epc:id:sscc:${prefix}.0000000001`

let sequence = 0
/** The members every event carries: a fresh eventID and a time in the past. */
export function base(day = 2, hour = 9): Json {
  sequence += 1
  return { eventTime: `2026-03-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`, eventTimeZoneOffset: '+00:00', eventID: `urn:uuid:6c000000-0000-4000-8000-${String(sequence).padStart(12, '0')}` }
}

/* ---------------------------------- registry ------------------------------ */

export interface TestRegistry {
  url: string
  anchoredBy: string
  /** Every claim it accepted, by attestation identifier, as the exact bytes. */
  held: Map<string, string>
  /** Every anchor transaction it wrote, in order. */
  anchors: Transaction[]
  /** Anchor a held claim under a subject of the test's choosing, as a careless or hostile anchoring service could. */
  anchorUnder(attestationId: string, subject: string): Promise<void>
  close(): Promise<void>
}

const ANYONE_CAN_SPEND = new LockingScript([{ op: 0x51 }])

function funding(): Transaction {
  const tx = new Transaction()
  tx.addOutput({ satoshis: 10_000, lockingScript: ANYONE_CAN_SPEND })
  tx.merklePath = MerklePath.fromCoinbaseTxidAndHeight(tx.id('hex'), 800_000)
  return tx
}

/** Start the stand-in. `index` is read when a claim arrives, so the registry can be started before the application whose index it writes to. */
export async function startTestRegistry(index: () => { url: string; submitToken: string }): Promise<TestRegistry> {
  const key = PrivateKey.fromHex('66'.repeat(32))
  const wallet = new ProtoWallet(key)
  const anchoredBy = key.toPublicKey().toString()
  const held = new Map<string, string>()
  const anchors: Transaction[] = []
  /** The transaction that anchors each held claim, by attestation identifier. */
  const anchoredIn = new Map<string, string>()

  const write = async (scripts: LockingScript[]): Promise<string> => {
    const tx = new Transaction()
    tx.addInput({ sourceTransaction: funding(), sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]) })
    for (const lockingScript of scripts) tx.addOutput({ satoshis: 1, lockingScript })
    const { url, submitToken } = index()
    const response = await fetch(`${url}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Topics': JSON.stringify(['tm_attestation']), Authorization: `Bearer ${submitToken}` }, body: new Uint8Array(tx.toAtomicBEEF()) })
    if (!response.ok) throw new Error(`the index answered HTTP ${response.status} to the anchors`)
    anchors.push(tx)
    return tx.id('hex')
  }

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      void (async () => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const answer = (status: number, body: unknown): void => void response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
        if (request.method === 'POST' && url.pathname === '/attestations') {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { representation?: string; claim?: string; subject?: string }
          if (body.representation !== EPCIS_LIFECYCLE_REPRESENTATION || typeof body.claim !== 'string') return answer(422, { outcome: 'unsupported', issues: ['representation-unsupported: this stand-in admits dpp-epcis-lifecycle-json@1 only'] })
          const verified = await verifyEpcisLifecycleClaim(body.claim)
          if (verified.findings.signature.status !== 'pass' || verified.findings.eventStructure.status === 'fail') return answer(422, { outcome: 'invalid', issues: ['the claim does not verify'], checks: verified.findings })
          if (body.subject != null && !verified.boundPassports.includes(body.subject)) return answer(422, { outcome: 'invalid', issues: [`subject mismatch: the claim does not bind ${body.subject}`], checks: verified.findings })
          if (!held.has(verified.attestationId!)) {
            const claim = parseEpcisLifecycleClaim(body.claim)
            const scripts: LockingScript[] = []
            for (const metadata of epcisLifecycleAnchorMetadata(claim, anchoredBy)) scripts.push(await buildAttestationAnchor(metadata, wallet))
            anchoredIn.set(verified.attestationId!, await write(scripts))
            held.set(verified.attestationId!, body.claim)
          }
          return answer(202, { accepted: true, attestationId: verified.attestationId, digest: verified.digest, representation: EPCIS_LIFECYCLE_REPRESENTATION, mediaType: EPCIS_LIFECYCLE_MEDIA_TYPE, verdict: 'valid' })
        }
        const proof = /^\/attestations\/(.+)\/proof$/.exec(url.pathname)
        if (request.method === 'GET' && proof != null) {
          const id = decodeURIComponent(proof[1]!)
          const bytes = held.get(id)
          if (bytes == null) return answer(404, { error: 'not_found' })
          // The contract's AnchorProof: the exact bytes travel as `securedBytes`, and as `canonical` for a reader of older records.
          return answer(200, {
            attestationId: id,
            attestation: JSON.parse(bytes),
            claimRelations: { relations: [], derived: [], conflicts: [], notProduced: ['supersedes', 'disputes'], evaluatedAt: new Date().toISOString() },
            canonical: bytes,
            securedBytes: bytes,
            representation: EPCIS_LIFECYCLE_REPRESENTATION,
            mediaType: EPCIS_LIFECYCLE_MEDIA_TYPE,
            digest: id.slice('urn:sha256:'.length),
            algorithm: 'SHA-256 over the exact secured bytes, hex',
            anchored: true,
            anchor: { recordId: anchoredIn.get(id), outputIndex: 0, format: 'bsv-attestation-anchor-v1' },
          })
        }
        answer(404, { error: 'not_found' })
      })().catch((cause: unknown) => void response.writeHead(500).end(String(cause)))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    anchoredBy,
    held,
    anchors,
    async anchorUnder(attestationId, subject) {
      const bytes = held.get(attestationId)
      if (bytes == null) throw new Error(`the stand-in holds no claim ${attestationId}`)
      const [first] = epcisLifecycleAnchorMetadata(parseEpcisLifecycleClaim(bytes), anchoredBy)
      await write([await buildAttestationAnchor({ ...first!, subject }, wallet)])
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
