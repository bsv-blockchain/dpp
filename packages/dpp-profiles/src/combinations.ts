/**
 * Profile combinations (`spec/conformance.md` §4, `spec/profiles.md`): an
 * industry profile says what a passport carries, an exchange profile how a
 * credential travels beside it, an operator profile how an index is run. They
 * are selected together, and some selections contradict themselves: a new
 * state under a superseded version, a conformance claim on a proposed profile
 * whose artefacts were never pinned, a single operator declaring peers, a
 * federation of one. `checkSelection` names every contradiction rather than
 * choosing for the caller, and passes with notes when the selection is only
 * unusual.
 */
import { EXCHANGE_PROFILE_IDS, OPERATOR_PROFILE_IDS, PROFILE_IDS, readExchangeProfile, readOperatorProfile, type ExchangeProfileId, type OperatorProfileId } from './index.js'
import { isManifestV2, readManifestAny } from './manifest-v2.js'

export const BASELINE_ID = 'native-baseline@1'
/** The second recommended baseline: record version 2 with the managed-custody profile (conformance/baseline-native-2.json). */
export const BASELINE_ID_2 = 'native-baseline@2'
export const BASELINE_IDS = [BASELINE_ID, BASELINE_ID_2] as const

export type SelectionPurpose = 'read' | 'write' | 'claim'

export interface DeploymentDeclaration {
  operators?: number
  discovery?: 'none' | 'ship-slap' | 'static-peers'
  gasp?: boolean
}

export interface ProfileSelection {
  baseline: string
  industry?: string
  exchange?: string[]
  operator?: string
  deployment?: DeploymentDeclaration
  /** read: verify what exists; write: issue new states or claims; claim: state conformance to the selected profiles. */
  purpose: SelectionPurpose
}

export type SelectionConflictCode =
  | 'baseline-unknown'
  | 'industry-unknown'
  | 'industry-superseded'
  | 'industry-draft'
  | 'exchange-unknown'
  | 'exchange-duplicate'
  | 'exchange-proposed'
  | 'exchange-artefacts-unpinned'
  | 'operator-unknown'
  | 'operator-proposed'
  | 'operator-single-with-federation-options'
  | 'operator-federation-needs-two'
  | 'operator-federation-without-discovery'

export interface SelectionResult {
  ok: boolean
  conflicts: Array<{ code: SelectionConflictCode; detail: string }>
  notes: string[]
}

export function checkSelection(selection: ProfileSelection): SelectionResult {
  const conflicts: SelectionResult['conflicts'] = []
  const notes: string[] = []
  const conflict = (code: SelectionConflictCode, detail: string): void => { conflicts.push({ code, detail }) }

  if (!(BASELINE_IDS as readonly string[]).includes(selection.baseline)) conflict('baseline-unknown', `${selection.baseline} is not a baseline this catalogue knows; the baselines are ${BASELINE_IDS.join(' and ')}`)

  if (selection.industry != null) {
    if (!(PROFILE_IDS as readonly string[]).includes(selection.industry)) {
      conflict('industry-unknown', `${selection.industry} is not an industry profile in this catalogue`)
    } else {
      const manifest = readManifestAny(selection.industry)
      if (manifest.status === 'superseded') {
        if (selection.purpose === 'read') notes.push(`${manifest.profile} is superseded by ${manifest.supersededBy}; states that declare it decode under it and are never reinterpreted`)
        else conflict('industry-superseded', `${manifest.profile} is superseded by ${manifest.supersededBy}; a new state or claim is issued under the current version`)
      } else if (manifest.status === 'draft') {
        // A draft successor is opt-in: a deployment may read and write under
        // it by explicit version, and is told so; a conformance claim rests on
        // the current version until the reviewed cutover marks it superseded.
        const of = isManifestV2(manifest) && manifest.succession != null ? manifest.succession.of : 'the current version'
        if (selection.purpose === 'claim') conflict('industry-draft', `${manifest.profile} is a draft successor to ${of}; a conformance claim rests on the current version`)
        else notes.push(`${manifest.profile} is a draft: opt-in successor to ${of}, not yet the current version; a conformance claim rests on the current version`)
      }
    }
  }

  const seen = new Set<string>()
  for (const id of selection.exchange ?? []) {
    if (seen.has(id)) { conflict('exchange-duplicate', `${id} is selected twice`); continue }
    seen.add(id)
    if (!(EXCHANGE_PROFILE_IDS as readonly string[]).includes(id)) { conflict('exchange-unknown', `${id} is not an exchange profile in this catalogue`); continue }
    const profile = readExchangeProfile(id as ExchangeProfileId) as { status: string; artefacts?: Array<{ id: string; retrieval?: string }> }
    const unpinned = (profile.artefacts ?? []).filter((a) => a.retrieval === 'not-retrieved').map((a) => a.id)
    if (selection.purpose === 'claim') {
      if (profile.status !== 'current') {
        conflict('exchange-proposed', `${id} is ${profile.status}; no conformance claim rests on a profile that is not current`)
        if (unpinned.length > 0) conflict('exchange-artefacts-unpinned', `${id} has artefacts not retrieved and pinned: ${unpinned.join(', ')}`)
      } else if (unpinned.length > 0) {
        // A current profile with an upstream artefact nobody could retrieve
        // (the ledger's unassessed rows) supports the implemented-subset claim
        // and never the full one; the ledger's claim gate is where that split
        // is enforced, and the note points at it.
        notes.push(`${id}: the claim covers the implemented subset; artefacts not retrieved (${unpinned.join(', ')}) keep the full-conformance claim blocked in the ledger`)
      }
    } else if (profile.status !== 'current' || unpinned.length > 0) {
      notes.push(`${id} is ${profile.status}${unpinned.length > 0 ? ` with unpinned artefacts (${unpinned.join(', ')})` : ''}; usable for a pilot, not for a claim`)
    }
  }

  if (selection.operator != null) {
    if (!(OPERATOR_PROFILE_IDS as readonly string[]).includes(selection.operator)) {
      conflict('operator-unknown', `${selection.operator} is not an operator profile in this catalogue`)
    } else {
      const profile = readOperatorProfile(selection.operator as OperatorProfileId) as { status: string; synchronisation: { mode: string }; discovery: { mode: string } }
      const d = selection.deployment ?? {}
      if (selection.operator === 'single-operator@1') {
        if ((d.operators ?? 1) > 1 || d.gasp === true || (d.discovery != null && d.discovery !== 'none')) {
          conflict('operator-single-with-federation-options', 'single-operator@1 declares one administration with discovery and synchronisation off; peers, GASP or advertisement belong to federated-operators@1')
        }
      } else {
        if ((d.operators ?? 1) < 2) conflict('operator-federation-needs-two', 'federated-operators@1 needs at least two independently administered operators; one operator is single-operator@1')
        if (d.discovery == null || d.discovery === 'none') conflict('operator-federation-without-discovery', 'federated-operators@1 needs SHIP and SLAP or a declared static-peer profile so operators find each other; discovery none is single-operator@1')
        if (selection.purpose === 'claim' && profile.status !== 'current') conflict('operator-proposed', `${selection.operator} is ${profile.status}; the independently administered exercise has not been run, so no claim rests on it`)
      }
    }
  }

  return { ok: conflicts.length === 0, conflicts, notes }
}
