// The reader: rebuild a passport's history from an index and verify it
// yourself. The index only finds the bytes; every signature, every link and
// every block proof is checked here, and the report says pass, fail, unknown
// or not-applicable for each check with a reason. Missing evidence stays
// unknown and is never treated as verified.
//
// A payload is checked against the profile it declares. Under a profile
// held by a binding there are two views and they are reported apart. The
// public view is what any reader has: it runs inside the report, for every
// state, against that state's own passport identifier. The authorised view
// is for the holder, who can open the restricted part: the two parts are
// rejoined and checked whole. Neither view says the restricted part is the
// one the record commits to. That is the protocol's owner-tier check, the
// stored ciphertext against the state's payload_owner_hash, and it is
// reported on its own line.
import { Utils, WhatsOnChain, type ChainTracker, type Transaction } from '@bsv/sdk'
import { EVIDENCE_CHECK_LABELS, findDppOutputs, verifyOwnerBlob, verifyPassportEvidence, type DeclaredPayload, type EvidenceReport, type ManagedAcceptanceRecord } from '@bsv/dpp-protocol'
import { assembleProduct, type PayloadValidation } from '@bsv/dpp-profiles'
import type { BoundProfiles, ViewCheck } from './bound-profiles.js'
import type { Network } from './config.js'
import type { IndexClient } from './index-client.js'
import type { Party } from './parties.js'
import type { PassportRecord } from './store.js'
import { OWNER_DATA_PROTOCOL } from './writer.js'

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
  /** The profiles this reader holds. With them every state's public payload is checked under the profile it declares; without them that check stays unknown. */
  profiles?: BoundProfiles
}

/** The check of one state's public payload, as any reader makes it. */
export interface PayloadCheck {
  txid: string
  stateIndex: number
  /** `id@version`, as the payload declares it. */
  profile: string
  publicView: ViewCheck
}

/** The product document of the newest state under a profile held by a binding: its public part, which is all a public reading has. */
export interface ProductReading {
  profile: string
  bindingDigest: string
  /** The sentence a demonstration record carries first. */
  notice?: string
  /** The public properties, as written on chain. */
  publicProduct: Record<string, unknown>
  /** The binding's public list, when this reader holds the binding: every other property is restricted. */
  access?: { policy: string; public: string[] }
}

export interface PassportReading {
  passportId: string
  lineage: Array<{ op: string; txid: string; timestamp: string; controllerKey: string; actorIdentityKey: string; payloadPublic: unknown }>
  report: EvidenceReport
  checks: Array<{ name: string; label: string; status: string; reasonCode?: string }>
  publisherKeys: string[]
  /** One entry per state whose payload declares a profile, genesis first. Empty when the reader holds no profiles. */
  payloadChecks: PayloadCheck[]
  /** Present when the newest state's payload is a product document under a binding. */
  product?: ProductReading
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** The envelope of a payload under a binding, when the text is one. */
function envelopeOf(payloadPublic: string): { profile: string; bindingDigest: string; notice?: string; product: Record<string, unknown> } | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(payloadPublic)
  } catch {
    return undefined
  }
  if (!isObject(parsed) || typeof parsed.profile !== 'string' || typeof parsed.profile_version !== 'number' || typeof parsed.profile_binding_sha256 !== 'string' || !isObject(parsed.product)) return undefined
  return { profile: `${parsed.profile}@${parsed.profile_version}`, bindingDigest: parsed.profile_binding_sha256, ...(typeof parsed.notice === 'string' ? { notice: parsed.notice } : {}), product: parsed.product }
}

export async function readPassport(passportId: string, options: ReaderOptions, evidence: { acceptanceRecords?: ManagedAcceptanceRecord[] } = {}): Promise<PassportReading> {
  const publisherKeys = await options.index.publisherKeys()
  const lineage: Transaction[] = await options.index.lineage(passportId)
  if (lineage.length === 0) throw new Error(`the index holds nothing for ${passportId}`)
  // The report asks the validator once per state and keeps only the combined answer, so each answer is kept here for the page.
  const profiles = options.profiles
  const answers: Array<{ payload: DeclaredPayload; validation: PayloadValidation }> = []
  const payloadValidator =
    profiles == null
      ? undefined
      : async (payload: DeclaredPayload): Promise<PayloadValidation> => {
          const validation = await profiles.validatePublic(payload)
          answers.push({ payload, validation })
          return validation
        }
  const report = await verifyPassportEvidence(
    { tokenHistory: lineage, acceptanceRecords: evidence.acceptanceRecords ?? [] },
    { passportId, source: 'request-context' },
    {
      policyId: options.policyId ?? 'managed-custody@2/application',
      publisherKeys,
      managedAcceptance: { required: true },
      chainTracker: options.chainTracker,
      ...(payloadValidator == null ? {} : { payloadValidator }),
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
    payloadChecks:
      profiles == null
        ? []
        : await Promise.all(
            answers.map(async ({ payload, validation }) => ({
              txid: payload.ref.split(':')[0],
              stateIndex: payload.stateIndex,
              profile: `${payload.profile}@${payload.profileVersion}`,
              publicView: await profiles.viewCheck('public', validation),
            }))
          ),
    ...(() => {
      const envelope = envelopeOf(findDppOutputs(lineage[lineage.length - 1])[0].state.payloadPublic)
      if (envelope == null) return {}
      const access = profiles?.get(envelope.profile)?.binding.access
      const product: ProductReading = {
        profile: envelope.profile,
        bindingDigest: envelope.bindingDigest,
        ...(envelope.notice == null ? {} : { notice: envelope.notice }),
        publicProduct: envelope.product,
        ...(access == null ? {} : { access: { policy: access.policy, public: [...access.public] } }),
      }
      return { product }
    })(),
  }
}

/** Whether the stored ciphertext is the one the state commits to. This is the protocol's check and the only statement made about the commitment. */
export interface OwnerTierCheck {
  status: 'pass' | 'fail' | 'not-checked'
  /** The state whose payload_owner_hash the ciphertext was compared with. */
  txid?: string
  detail: string
}

export interface AuthorisedReading {
  passportId: string
  profile?: string
  ownerTier: OwnerTierCheck
  authorisedView: ViewCheck
  /** The restricted part, opened for the holder. Absent when it was not opened, and when the state has none. */
  restrictedProduct?: Record<string, unknown>
  /** The two parts rejoined, for display. It is not what was signed. */
  product?: Record<string, unknown>
  access?: { policy: string; public: string[] }
}

const notChecked = (summary: string): ViewCheck => ({ view: 'authorised', status: 'not-checked', summary: `The rejoined document was not checked. ${summary} A check that could not run is not a pass.`, steps: [], findings: [], withheld: [] })

/**
 * The authorised view of the newest state, for the party that holds the
 * passport. The order is the record model's: the stored ciphertext is held
 * to the state's payload_owner_hash before any decryption, and only then is
 * it opened, rejoined with the public payload and checked whole.
 */
export async function readAuthorised(args: { record: PassportRecord; holder: Party; index: IndexClient; profiles: BoundProfiles }): Promise<AuthorisedReading> {
  const { record, holder, index, profiles } = args
  const passportId = record.passportId
  const lineage = await index.lineage(passportId)
  const tip = lineage.at(-1)
  if (tip == null) return { passportId, ownerTier: { status: 'not-checked', detail: 'The index holds no state for this passport.' }, authorisedView: notChecked('The index holds no state for this passport.') }
  const txid = tip.id('hex')
  const state = findDppOutputs(tip)[0].state
  const envelope = envelopeOf(state.payloadPublic)
  const bound = envelope == null ? undefined : profiles.get(envelope.profile)
  const base = { passportId, ...(envelope == null ? {} : { profile: envelope.profile }), ...(bound?.binding.access == null ? {} : { access: { policy: bound.binding.access.policy, public: [...bound.binding.access.public] } }) }
  const entry = record.states.find((s) => s.txid === txid)
  if (entry?.ownerTier == null) {
    const detail = 'This platform\'s journal holds no restricted part for the newest state the index returned.'
    return { ...base, ownerTier: { status: 'not-checked', txid, detail }, authorisedView: notChecked(detail) }
  }
  const ciphertext = Utils.toArray(entry.ownerTier.ciphertext, 'base64') as number[]
  if (!verifyOwnerBlob(ciphertext, state.payloadOwnerHash)) {
    return {
      ...base,
      ownerTier: { status: 'fail', txid, detail: 'The stored ciphertext does not hash to the payload_owner_hash of the state. It was not decrypted.' },
      authorisedView: notChecked('The stored restricted part is not the one the state commits to, so it was not opened.'),
    }
  }
  const ownerTier: OwnerTierCheck = { status: 'pass', txid, detail: 'The stored ciphertext hashes to the payload_owner_hash of the state. This is the protocol\'s owner-tier check; nothing else here is a statement about the commitment.' }
  if (envelope == null || bound == null) {
    return { ...base, ownerTier, authorisedView: notChecked(envelope == null ? 'The newest state\'s payload is not a product document under a binding.' : `This application holds no binding for ${envelope.profile}.`) }
  }
  let restricted: unknown
  try {
    const { plaintext } = await holder.wallet.decrypt({ ciphertext, protocolID: OWNER_DATA_PROTOCOL, keyID: passportId, counterparty: entry.ownerTier.senderIdentityKey ?? 'self' })
    restricted = JSON.parse(Utils.toUTF8(plaintext))
  } catch {
    // The reason is not repeated: a decryption error can quote the bytes it failed on.
    return { ...base, ownerTier, authorisedView: notChecked(`The wallet for ${holder.name} could not open the committed restricted part with the recorded counterparty.`) }
  }
  // A state with no restricted property seals an empty object, which is no restricted part at all.
  const restrictedProduct = isObject(restricted) && Object.keys(restricted).length === 0 ? undefined : restricted
  const validation = await profiles.validateAuthorised({ profile: bound.id, profileVersion: bound.version, payloadPublic: state.payloadPublic, passportId: state.passportId, ...(restrictedProduct === undefined ? {} : { restrictedProduct }) })
  const assembly = assembleProduct({ binding: bound.binding, publicProduct: envelope.product, ...(restrictedProduct === undefined ? {} : { restrictedProduct }) })
  return {
    ...base,
    ownerTier,
    authorisedView: await profiles.viewCheck('authorised', validation),
    ...(isObject(restrictedProduct) ? { restrictedProduct } : {}),
    ...(assembly.ok ? { product: assembly.product } : {}),
  }
}
