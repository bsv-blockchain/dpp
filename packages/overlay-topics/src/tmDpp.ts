import { Beef, LockingScript, Transaction, type TransactionInput } from '@bsv/sdk'
import type { AdmittanceInstructions, Storage, TopicManager } from '@bsv/overlay'
import {
  checkGenesisState,
  checkOwnerConsent,
  checkTransition,
  findDppOutputs,
  normaliseTransferAuthorities,
  tryParseDppOutput,
  verifyServerSignature,
  verifyUserSignature,
  type DppState,
  type PublisherPolicy,
} from '@bsv/dpp-core'
import { policyKeysFor } from './policyConfig.js'

export const DPP_TOPIC = 'tm_dpp'

/**
 * A fresh object each time, never a shared constant: the Engine writes
 * `coinsRemoved` onto the instructions a topic manager returns, so a shared
 * refusal object would carry the first refusal's mutation into every later
 * answer.
 */
const none = (): AdmittanceInstructions => ({ outputsToAdmit: [], coinsToRetain: [] })

/**
 * How many recently inspected states the manager remembers, by txid. A
 * synchronisation pass hands the manager one state at a time in lineage
 * order, each as a BEEF that stops at its own proof, so the predecessor's
 * bytes arrive one call earlier and nowhere else; this is where they wait.
 */
const RECENT_STATES = 4096

/**
 * tm_dpp - DPP Token Standard v1 admission (`spec/record-model.md` §6 and §8).
 *
 * Admits a transaction's single DPP output when:
 * - exactly one well-formed DPP output exists (invariant 1; field rules are
 *   enforced by the dpp-core codec at parse time),
 * - user_signature verifies against actor_identity_key + actor_keyID,
 * - server_signature verifies against the configured service key
 *   (admission policy, not token validity - §5),
 * - genesis states satisfy the genesis rules. Non-genesis states spend the
 *   previously admitted tip (invariant 4, via previousCoins) and satisfy the
 *   per-link transition rules (invariants 5–7).
 *
 * Spent tips are retained (coinsToRetain) so the lifecycle history stays
 * resolvable (§1: the spend history is the passport's lifecycle).
 *
 * One rule is a profile's choice rather than the record model's, and this
 * manager enforces it only when told to: the owner-signed transfer of
 * `spec/custody.md` §4, under which a TRANSFER is admitted only when its actor
 * proves it is the previous owner, by equality or by owner_linkage, or is a
 * named transfer authority. It is admission policy of the same kind as the
 * service signature, and the topic documentation says whether this instance
 * enforces it, so a writer learns the rule from the index and not from a
 * refusal (`spec/services.md` §6).
 */
export interface DppAdmissionOptions {
  /**
   * The owner-signed transfer (`spec/custody.md` §4). `true` runs the predicate
   * on every TRANSFER; an object also names the transfer authorities, identity
   * keys whose TRANSFER is admitted without proof (recovery). Off by default:
   * the record model's baseline admits any signed TRANSFER that spends the tip.
   * A malformed authority throws at construction, so a misconfigured
   * deployment fails to boot rather than silently never matching.
   */
  ownerConsent?: boolean | { authorities: string[] }
  /**
   * The publisher key policy chain (`spec/services.md` §1), already verified
   * by the caller with `verifyPolicyChain`. When present and in force for this
   * topic, a state's countersignature is accepted only from a state-publisher
   * key active at the state's own timestamp, and the positional identity key
   * is not consulted: a retired key still admits the states it signed while
   * active, and a key admits nothing timestamped before its activation.
   * Absent, the identity key is the whole policy, as it always was.
   */
  publisherPolicy?: PublisherPolicy[]
  /**
   * The engine's own storage, so the manager can read an admitted
   * predecessor's locking script when the BEEF it is handed does not carry
   * the predecessor's bytes. Two callers hand it such a BEEF: a writer that
   * announces a proven state alone, and the SDK's peer synchronisation, whose
   * per-node BEEF stops at the node's proof and whose admission emulation
   * lists as previous coins only what the temporary graph holds. Absent, the
   * manager sees only what the BEEF and its own recent memory show, as it
   * always did.
   */
  admittedOutputs?: Pick<Storage, 'findOutput'>
}

export class DppTopicManager implements TopicManager {
  private readonly consentSelected: boolean
  private readonly authorities: string[]
  private readonly policy?: PublisherPolicy[]
  private readonly admitted?: Pick<Storage, 'findOutput'>
  /** States inspected recently, by txid: the predecessor a synchronisation pass showed one call ago. */
  private readonly recent = new Map<string, Transaction>()

  constructor(
    private readonly serverIdentityKey: string,
    options: DppAdmissionOptions = {}
  ) {
    this.consentSelected = options.ownerConsent != null && options.ownerConsent !== false
    this.authorities =
      typeof options.ownerConsent === 'object'
        ? normaliseTransferAuthorities(options.ownerConsent.authorities)
        : []
    this.policy = options.publisherPolicy != null && options.publisherPolicy.length > 0 ? options.publisherPolicy : undefined
    this.admitted = options.admittedOutputs
  }

  /**
   * The keys this state's countersignature may come from: under a policy, the
   * state-publisher keys active at the state's timestamp; otherwise the one
   * configured identity key. The state's own timestamp is the instant that
   * matters, not the admission time, because a state announced late is still
   * the state it was when it was signed.
   */
  private publisherKeysFor(state: DppState): string[] {
    if (this.policy != null) {
      const keys = policyKeysFor(this.policy, state.timestamp, 'state-publisher', DPP_TOPIC)
      if (keys != null) return keys
    }
    return this.serverIdentityKey === '' ? [] : [this.serverIdentityKey]
  }

  private remember(tx: Transaction): void {
    const txid = tx.id('hex')
    if (this.recent.has(txid)) return
    if (this.recent.size >= RECENT_STATES) {
      const oldest = this.recent.keys().next().value
      if (oldest != null) this.recent.delete(oldest)
    }
    this.recent.set(txid, tx)
  }

  /**
   * The predecessor's locking script for one input, from the nearest source
   * that has it: the hydrated input, the submitted BEEF, the engine's storage,
   * and, on the historical paths only, the manager's recent memory. The txid
   * the input names commits to the bytes each source yields, so none of them
   * is trusted more than another; they differ only in who happened to hand
   * the bytes over. Memory is kept for the synchronisation pass, where the SDK
   * validates a graph one state at a time before any of it reaches storage;
   * on the live path a writer's proven state announced without its parent is
   * judged against what the index holds, never against what it happened to
   * see, so the contract a submitter is held to stays the one it always was.
   */
  private async predecessorScript(
    input: TransactionInput,
    prevTxid: string,
    parsedBeef: Beef | undefined,
    historical: boolean
  ): Promise<LockingScript | undefined> {
    const outputIndex = input.sourceOutputIndex
    const hydrated = input.sourceTransaction?.outputs[outputIndex]?.lockingScript
    if (hydrated != null) return hydrated
    const fromBeef = parsedBeef?.findTxid(prevTxid)?.tx?.outputs[outputIndex]?.lockingScript
    if (fromBeef != null) return fromBeef
    if (this.admitted != null) {
      const output = await this.admitted.findOutput(prevTxid, outputIndex, DPP_TOPIC)
      if (output != null) return LockingScript.fromBinary(output.outputScript)
    }
    if (historical) {
      const remembered = this.recent.get(prevTxid)?.outputs[outputIndex]?.lockingScript
      if (remembered != null) return remembered
    }
    return undefined
  }

  /**
   * The inputs to treat as previously admitted coins. The Engine names them
   * on the live path; the synchronisation emulation names only what its
   * temporary graph holds, which for a state on top of a lineage this index
   * already has is nothing. Then, and only when the storage is at hand, the
   * inputs that spend an output this index has admitted for the topic stand
   * in, which is the same question the Engine answers on the live path.
   */
  private async previousCoinsFor(tx: Transaction, state: DppState, previousCoins: number[]): Promise<number[]> {
    if (previousCoins.length > 0 || this.admitted == null) return previousCoins
    const found: number[] = []
    for (const [index, input] of tx.inputs.entries()) {
      const sourceTxid = input.sourceTransaction?.id('hex') ?? input.sourceTXID
      if (sourceTxid !== state.previousTxid) continue
      if ((await this.admitted.findOutput(sourceTxid, input.sourceOutputIndex, DPP_TOPIC)) != null) found.push(index)
    }
    return found
  }

  async identifyAdmissibleOutputs(
    beef: number[],
    previousCoins: number[],
    _offChainValues?: number[],
    mode?: 'historical-tx' | 'current-tx' | 'historical-tx-no-spv'
  ): Promise<AdmittanceInstructions> {
    // The SDK's synchronisation names its passes: 'historical-tx' while it
    // validates a fetched graph, 'historical-tx-no-spv' while it admits one.
    const historical = mode === 'historical-tx' || mode === 'historical-tx-no-spv'
    let tx: Transaction
    try {
      tx = Transaction.fromBEEF(beef)
    } catch {
      return none()
    }

    /*
     * A refusal keeps the coins the Engine offered. Without this the Engine
     * reads a refused spend of an admitted tip as that tip's consumption by a
     * transaction the topic did not care to retain, and its stale-output
     * eviction removes the tip and, recursively, every predecessor nothing
     * else consumes: one refused announcement emptied a passport's index
     * entry in the 2026-08-12 rehearsal. Retaining the offered coins on
     * refusal is the documented half of the contract that keeps the lineage.
     * What the Engine still does with a refused transaction is written up in
     * this package's README (a refused spend of the tip): it marks the tip
     * spent in its own storage, tells the lookup services of the spend, and
     * records the transaction as applied to the topic.
     */
    const refuse = (): AdmittanceInstructions =>
      previousCoins.length === 0 ? none() : { outputsToAdmit: [], coinsToRetain: [...previousCoins] }

    const refs = findDppOutputs(tx)
    if (refs.length !== 1) return refuse()
    const { state, outputIndex } = refs[0]

    if (!verifyUserSignature(state)) return refuse()
    if (!this.publisherKeysFor(state).some((key) => verifyServerSignature(state, key))) {
      if (this.policy != null) {
        // Under a policy the refusal can be a matter of time rather than of
        // key: a writer signing with a key that has since retired, or that
        // was not yet active at the state's timestamp, learns which from the
        // operator's log, since the wire says only that nothing was admitted.
        console.warn(
          `${DPP_TOPIC} refused ${tx.id('hex')}: server_signature is not from a state-publisher key active at ${state.timestamp}`
        )
      }
      return refuse()
    }

    if (state.previousTxid === '') {
      if (checkGenesisState(state) != null) return refuse()
      this.remember(tx)
      return { outputsToAdmit: [outputIndex], coinsToRetain: [] }
    }

    /*
     * The predecessor's bytes, found in the submitted BEEF by txid rather than
     * read off `input.sourceTransaction`, and the distinction is a defect the
     * 2026-08-12 backfill rehearsal caught: every mined event on every
     * multi-state passport was refused, and the refusal consumed the admitted
     * genesis coin, so one backfill pass left those passports with an empty
     * index entry.
     *
     * The SDK's writer and reader agree on a rule this check used to be on the
     * wrong side of. A transaction carrying its own merkle proof needs no
     * ancestry for SPV, so `Beef.mergeTransaction` stops walking parents at a
     * proof (`Beef.js:333`) and the reader symmetrically leaves
     * `input.sourceTransaction` unset on a proven subject, even when the
     * parent's bytes sit in the same BEEF. SPV is the wrong standard here:
     * this check wants the predecessor's locking script to hold the transition
     * rules against, which is a stricter need than proof of inclusion. So the
     * BEEF is searched directly, hydration is taken when the SDK happens to
     * provide it (a fresh unproven state, which is the live announce path),
     * and the submitter's side of the contract is to include the predecessor's
     * bytes, which `scripts/announce.ts` does by submitting each state atomic
     * over the whole stored chain. Since peer synchronisation, two more
     * sources stand behind those (`predecessorScript`).
     */
    let parsedBeef: Beef | undefined
    try {
      parsedBeef = Beef.fromBinary(beef)
    } catch {
      parsedBeef = undefined
    }
    const coins = await this.previousCoinsFor(tx, state, previousCoins)
    for (const inputIndex of coins) {
      const input = tx.inputs[inputIndex]
      if (input == null) continue
      const prevTxid = input.sourceTransaction?.id('hex') ?? input.sourceTXID
      if (prevTxid !== state.previousTxid) continue
      const prevScript = await this.predecessorScript(input, prevTxid, parsedBeef, historical)
      if (prevScript == null) continue
      const prev = tryParseDppOutput(prevScript)
      if (prev == null) continue
      if (checkTransition(prev.state, state, prevTxid) != null) return refuse()
      if (this.consentSelected) {
        const reason = checkOwnerConsent(prev.state, state, this.authorities)
        if (reason != null) {
          // The other refusals are silent because the wire says everything a
          // writer needs. This one is a policy the writer may not know this
          // instance runs, so the operator's log names it.
          console.warn(`${DPP_TOPIC} refused ${tx.id('hex')}: ${reason}`)
          return refuse()
        }
      }
      this.remember(tx)
      return { outputsToAdmit: [outputIndex], coinsToRetain: [inputIndex] }
    }

    // No previously admitted coin matches previous_txid: not the admitted tip.
    return refuse()
  }

  /**
   * What a synchronising peer must fetch before this state can be judged: the
   * input that spends the predecessor, when the state is not a genesis. The
   * SDK asks this only for a proven state it could not admit alone, and drops
   * any input this index already holds, so the answer is the predecessor and
   * nothing else. Anything that does not decode as one DPP state needs nothing.
   */
  async identifyNeededInputs(beef: number[]): Promise<Array<{ txid: string; outputIndex: number }>> {
    let tx: Transaction
    try {
      tx = Transaction.fromBEEF(beef)
    } catch {
      return []
    }
    const refs = findDppOutputs(tx)
    if (refs.length !== 1 || refs[0].state.previousTxid === '') return []
    const prevTxid = refs[0].state.previousTxid
    return tx.inputs
      .filter((input) => (input.sourceTransaction?.id('hex') ?? input.sourceTXID) === prevTxid)
      .map((input) => ({ txid: prevTxid, outputIndex: input.sourceOutputIndex }))
  }

  async getDocumentation(): Promise<string> {
    const lines = [
      `# ${DPP_TOPIC}`,
      '',
      'Admission for DPP Token Standard v1 passports (spec/record-model.md).',
      'One DPP output per transaction; signatures over the canonical byte',
      'preimage; non-genesis states must spend the admitted tip; spent states',
      'are retained as lifecycle history. Admission additionally requires a',
      'valid service signature (deployment policy, spec/record-model.md §8).',
      'A refused state that spends the admitted tip leaves the tip and its',
      'history in place. The same rules judge a state a peer offers during',
      'synchronisation as one a writer announces.',
      '',
      '## The publisher key',
      '',
    ]
    if (this.policy != null) {
      const newest = this.policy[this.policy.length - 1]
      lines.push(
        `This index admits under a publisher key policy (spec/services.md section 1, dpp-publisher-policy@1), currently version ${newest.policyVersion} for the ${newest.scope.operatorProfile} scope. A state's server_signature must come from a state-publisher key that was active at the state's own timestamp: a retired key still admits the states it signed while active, and a key admits nothing timestamped before its activation. GET /capabilities lists the keys active now.`
      )
    } else {
      lines.push(
        'This index admits states countersigned by its one configured service identity key, an implicit single-operator policy with no rotation history. GET /capabilities names the key.'
      )
    }
    lines.push('', '## The owner-signed transfer', '')
    if (this.consentSelected) {
      lines.push(
        'This index is deployed for a profile that selects the owner-signed transfer (spec/custody.md section 4). A TRANSFER is admitted only when its actor is the previous owner, proven by equality (actor_identity_key equals the previous owner_identity_key) or by linkage (event_data carries owner_linkage, 64 lower-case hex characters, with the previous owner_identity_key equal to actor_identity_key plus owner_linkage times G), or when the actor is a transfer authority named below. The predicate is evaluated in that order: equality, authorities, linkage.',
        '',
        this.authorities.length === 0
          ? 'Transfer authorities: none. Every TRANSFER must prove consent.'
          : `Transfer authorities: ${this.authorities.join(', ')}. A TRANSFER by one of these keys is admitted without proof of consent; the profile expects it to be attested on the anchor rail.`
      )
    } else {
      lines.push(
        'Not enforced by this index, which admits any signed TRANSFER that spends the tip: the record model baseline. The owner-signed transfer (spec/custody.md section 4) is a profile choice, switched on when the topic manager is configured for it.'
      )
    }
    return lines.join('\n')
  }

  async getMetaData(): Promise<{
    name: string
    shortDescription: string
    version?: string
  }> {
    return {
      name: DPP_TOPIC,
      shortDescription: 'Digital Product Passport token admission (DPP Standard v1)',
      version: '1.3.0',
    }
  }
}
