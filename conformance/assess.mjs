/**
 * The one assessment of the ledger (spec/conformance.md section 6), shared by
 * the diagnostic checker (check.mjs) and the selected-claim qualification
 * (qualify.mjs) so the two can never disagree: one reading of the sources,
 * one reading of the rows, one verdict per claim, and one reading of a
 * selection. Every finding is a sentence; the callers decide which sentences
 * are defects, which are refusals and which are notes.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The status order the gate compares against; unassessed always blocks. */
export const STATUS_RANK = { unassessed: -1, gap: 0, 'not-applicable': 1, implemented: 2, tested: 3, 'independently-tested': 4 }

/** What a selection may call a claim, so a component's evidence is never read as a system's. */
export const CLAIM_KINDS = ['component', 'system', 'draft-compatibility', 'operation', 'product', 'governance']

/**
 * Why a row that carries a claim's profile is left out of the claim.
 * outside-claim-scope: the row belongs to another instrument or scope.
 * separately-claimed: another named claim requires it.
 * deferred: a known requirement deliberately left for later, which a
 * component claim may say and a system or product claim may not.
 */
export const EXCLUSION_SCOPES = ['outside-claim-scope', 'separately-claimed', 'deferred']

/** The kinds whose full applicable scope the qualification holds the claim to. */
export const FULL_SCOPE_KINDS = ['system', 'product']

export const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

/**
 * Read the sources: the map by identifier, the set whose local artefact moved
 * or vanished, and the defects as sentences, exactly as the checker reports them.
 */
export function readSources(ledger, root) {
  const sources = new Map(ledger.sources.map((s) => [s.id, s]))
  const moved = new Set()
  const defects = []
  if (sources.size !== ledger.sources.length) defects.push('two ledger sources share an identifier.')
  for (const s of ledger.sources) {
    if (s.kind !== 'local') continue
    if (s.path == null || s.digest == null) { defects.push(`local source ${s.id} records no path or no digest.`); continue }
    if (!existsSync(join(root, s.path))) { defects.push(`local source ${s.id} names ${s.path}, which does not exist.`); moved.add(s.id); continue }
    const actual = sha256File(join(root, s.path))
    if (actual !== s.digest) {
      moved.add(s.id)
      defects.push(`source ${s.id} (${s.path}) has digest ${actual.slice(0, 12)}…, not the recorded ${s.digest.slice(0, 12)}…; every row citing it is invalidated until reviewed (run conformance/pin-sources.mjs after review).`)
    }
  }
  return { sources, moved, defects }
}

/** Read the rows: the map by identifier and the defects a schema cannot find. */
export function readRows(ledger, sources) {
  const rows = new Map()
  const defects = []
  for (const r of ledger.requirements) {
    if (rows.has(r.id)) defects.push(`requirement ${r.id} appears twice.`)
    rows.set(r.id, r)
    const s = sources.get(r.sourceId)
    if (s == null) { defects.push(`requirement ${r.id} cites source ${r.sourceId}, which the ledger does not pin.`); continue }
    if (r.sourceUri !== s.uri) defects.push(`requirement ${r.id} records sourceUri ${r.sourceUri} but source ${s.id} is ${s.uri}.`)
    if (r.sourceVersion !== s.version) defects.push(`requirement ${r.id} records sourceVersion "${r.sourceVersion}" but source ${s.id} is "${s.version}".`)
    if (s.digest != null && r.sourceDigest != null && r.sourceDigest !== s.digest) defects.push(`requirement ${r.id} records a sourceDigest that differs from source ${s.id}.`)
    if (r.roles.includes('all') && r.roles.length > 1) defects.push(`requirement ${r.id} lists "all" beside other roles.`)
    if (r.roles.includes('none') && r.roles.length > 1) defects.push(`requirement ${r.id} lists "none" beside other roles.`)
  }
  return { rows, defects }
}

/**
 * One claim's verdict: the problems that block it, in the sentences the
 * checker prints, and the rows it names that the ledger does not carry.
 */
export function assessClaim(claim, rows, moved) {
  const minimum = claim.minimumStatus ?? 'tested'
  const problems = []
  const unknownRows = []
  for (const id of claim.requires) {
    const r = rows.get(id)
    if (r == null) { unknownRows.push(id); continue }
    if (moved.has(r.sourceId)) problems.push(`${id} cites a source whose artefact changed`)
    else if (r.status === 'unassessed') problems.push(`${id} is unassessed`)
    else if (r.status === 'not-applicable') continue
    else if (STATUS_RANK[r.status] < STATUS_RANK[minimum]) problems.push(`${id} is ${r.status}, below ${minimum}`)
  }
  return { id: claim.id, minimum, problems, unknownRows, canBeMade: problems.length === 0 && unknownRows.length === 0 }
}

/** Every claim's verdict, by identifier. */
export function assessClaims(ledger, rows, moved) {
  return new Map(ledger.claims.map((claim) => [claim.id, assessClaim(claim, rows, moved)]))
}

/**
 * Whether a row carries a profile: its profileId is the profile, or names it
 * among others ("battery@2 (existing) and battery@3 (proposed)"), with any
 * parenthetical qualifier ignored. A qualifier never hides a row from the
 * profile it names.
 */
export function rowCarriesProfile(row, profileId) {
  if (typeof row.profileId !== 'string' || typeof profileId !== 'string' || profileId === '') return false
  return row.profileId
    .split(/\s+and\s+|,\s*/)
    .map((part) => part.replace(/\s*\(.*\)\s*$/, '').trim())
    .some((part) => part === profileId)
}

/**
 * A selection read against the ledger's verdicts. Three lists of sentences:
 * `invalid` makes the selection itself unusable (a defect in the material);
 * `refusals` refuse the qualification; `findings` refuse nothing and are
 * printed so nothing selected, withheld or excluded is silent.
 */
export function assessSelection(selection, { ledger, rows, sources, verdicts, root }) {
  const invalid = []
  const refusals = []
  const findings = []
  const name = `selection ${selection.selectionId}`
  const claims = new Map(ledger.claims.map((c) => [c.id, c]))

  if (selection.releaseSet != null) {
    const path = `release/${selection.releaseSet}.json`
    if (root == null || !existsSync(join(root, path))) invalid.push(`${name} names release set ${selection.releaseSet}, which ${path} does not define.`)
    else {
      const set = JSON.parse(readFileSync(join(root, path), 'utf8'))
      if (set.status === 'superseded') invalid.push(`${name} names release set ${selection.releaseSet}, which is superseded; a selection qualifies a current set.`)
      else findings.push(`release set: ${name} qualifies ${selection.releaseSet} (${set.status}).`)
    }
  }

  // The exclusions first, so the full-scope rule below can consult them.
  const excluded = new Map()
  for (const x of selection.exclusions ?? []) {
    const claim = claims.get(x.claimId)
    const row = rows.get(x.requirementId)
    if (claim == null) { invalid.push(`${name} excludes ${x.requirementId} from claim ${x.claimId}, which the ledger does not carry.`); continue }
    if (row == null) { invalid.push(`${name} excludes ${x.requirementId} from claim ${x.claimId}, but the ledger carries no such requirement.`); continue }
    if (claim.requires.includes(x.requirementId)) { invalid.push(`${name} excludes ${x.requirementId} from claim ${x.claimId}, which requires it; an exclusion cannot remove a required row.`); continue }
    if (!EXCLUSION_SCOPES.includes(x.scope)) { invalid.push(`${name} excludes ${x.requirementId} from ${x.claimId} under scope ${String(x.scope)}, which is not one of ${EXCLUSION_SCOPES.join(', ')}.`); continue }
    if (x.scope === 'separately-claimed') {
      const other = x.coveredBy == null ? undefined : claims.get(x.coveredBy)
      if (other == null) { invalid.push(`${name} excludes ${x.requirementId} from ${x.claimId} as separately claimed without naming a ledger claim in coveredBy.`); continue }
      if (!other.requires.includes(x.requirementId)) { invalid.push(`${name} excludes ${x.requirementId} from ${x.claimId} as covered by ${x.coveredBy}, which does not require it.`); continue }
    }
    const entry = (selection.claims ?? []).find((c) => c.id === x.claimId)
    if (x.scope === 'deferred' && entry != null && FULL_SCOPE_KINDS.includes(entry.kind)) {
      invalid.push(`${name} defers ${x.requirementId} under ${x.claimId}, a ${entry.kind} claim; a ${entry.kind} claim names every requirement of its scope or is withheld.`)
      continue
    }
    if (!excluded.has(x.claimId)) excluded.set(x.claimId, new Map())
    excluded.get(x.claimId).set(x.requirementId, x)
    findings.push(`excluded: ${x.requirementId} (${row.status}) from ${x.claimId}, ${x.scope}${x.coveredBy == null ? '' : ` by ${x.coveredBy}`}: ${x.rationale}`)
  }

  const seen = new Set()
  for (const entry of selection.claims ?? []) {
    if (seen.has(entry.id)) invalid.push(`${name} names claim ${entry.id} twice.`)
    seen.add(entry.id)
    const claim = claims.get(entry.id)
    if (claim == null) { invalid.push(`${name} names claim ${entry.id}, which the ledger does not carry.`); continue }
    if (!CLAIM_KINDS.includes(entry.kind)) { invalid.push(`${name} calls ${entry.id} a ${String(entry.kind)} claim, which is not one of ${CLAIM_KINDS.join(', ')}.`); continue }
    const verdict = verdicts.get(entry.id)
    const label = `${entry.id} (${entry.kind}${claim.profileId == null ? '' : `, ${claim.profileId}`})`

    // The full-scope rule: a row carrying the profile of a system or product
    // claim is required by the claim, excluded with a reason, or a refusal.
    const silent = []
    if (FULL_SCOPE_KINDS.includes(entry.kind) && claim.profileId != null) {
      for (const row of rows.values()) {
        if (!rowCarriesProfile(row, claim.profileId)) continue
        if (claim.requires.includes(row.id)) continue
        if (excluded.get(entry.id)?.has(row.id)) continue
        silent.push(row.id)
      }
    }

    if (entry.disposition === 'withheld') {
      findings.push(`withheld: ${label}: ${entry.rationale}`)
      if (verdict?.canBeMade) findings.push(`note: withheld claim ${entry.id} could be made on the ledger's evidence; review whether it stays withheld.`)
      else if (verdict != null) findings.push(`note: withheld claim ${entry.id} is also blocked: ${verdict.problems.join('; ')}.`)
      for (const id of silent) findings.push(`note: ${id} carries profile ${claim.profileId} and withheld claim ${entry.id} neither requires nor excludes it.`)
      continue
    }

    if (verdict == null) { invalid.push(`${name}: no verdict for ${entry.id}.`); continue }
    if (!verdict.canBeMade) refusals.push(`required claim ${label} cannot be made: ${[...verdict.problems, ...verdict.unknownRows.map((id) => `${id} is not in the ledger`)].join('; ')}.`)
    else findings.push(`ok: required claim ${label} can be made: every required row is ${verdict.minimum} or better.`)

    for (const id of silent) refusals.push(`required claim ${label}: ${id} carries profile ${claim.profileId} and the claim neither requires nor excludes it; no requirement leaves a claimed full scope silently.`)

    for (const id of claim.requires) {
      const r = rows.get(id)
      if (r == null) continue
      const s = sources.get(r.sourceId)
      const assessed = STATUS_RANK[r.status] > STATUS_RANK.gap
      if (r.status === 'not-applicable') {
        if (typeof r.notes !== 'string' || r.notes.trim() === '') refusals.push(`required claim ${label}: ${id} is not-applicable with no reasoning in notes; not-applicable is a reviewed finding, never a free pass.`)
        else findings.push(`not-applicable: ${id} under ${entry.id}, reviewed ${r.reviewedAt} by ${r.reviewOwner}: ${r.notes}`)
      }
      if (s?.kind === 'unavailable' && assessed) refusals.push(`required claim ${label}: ${id} is ${r.status} against source ${s.id}, which is unavailable; an assessment cannot rest on a text nobody can read.`)
      if (s?.kind === 'licensed' && s.digest == null && assessed) {
        const provenance = [s.retrievedAt == null ? undefined : `retrieved ${s.retrievedAt}`, s.notes].filter((p) => typeof p === 'string' && p.trim() !== '')
        if (provenance.length === 0) refusals.push(`required claim ${label}: ${id} is ${r.status} against licensed source ${s.id} (${s.version}) with neither a digest nor recorded access provenance.`)
        else findings.push(`licensed: ${id} under ${entry.id} is ${r.status} against ${s.id} (${s.version}) without a byte digest; provenance: ${provenance.join('; ')}`)
      }
    }
  }

  for (const claim of ledger.claims) {
    if (!seen.has(claim.id)) findings.push(`not selected: ${claim.id} is not part of ${name}.`)
  }

  return { invalid, refusals, findings, qualified: invalid.length === 0 && refusals.length === 0 }
}
