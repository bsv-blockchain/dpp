/**
 * The binding update check (`spec/profiles.md` §7): what a candidate set of
 * files would change in a profile held by a binding, as a report a person
 * reviews, together with the binding that would define the next version.
 *
 * A binding is immutable, so new files from the profile's source are never
 * an edit to it. They are a new version, and somebody has to decide whether
 * to publish one. This module is the step before that decision. It is given
 * the active binding, as a registry holds it, and the files the next version
 * would list, and it answers with two things: a report of every file added,
 * removed, changed or unchanged, and a proposed binding at the next version
 * with a digest of its own.
 *
 * Four rules shape it.
 *
 * It decides nothing. The check registers nothing, reads no registry and
 * writes no file. The active version is exactly what it was, and a payload
 * that declares it validates as before. Registering the proposal is the
 * caller's own, later step, and the registry applies its usual rules to it:
 * the proposal's digest must be on the trusted list, and it can never take
 * the place of the version it was derived from.
 *
 * It fetches nothing. The caller obtains the candidate files, from wherever
 * the profile's source publishes them, and hands over their bytes.
 *
 * It says how far it looked. A JSON-LD context is compared term by term,
 * because a term that is removed or redefined changes what a document that
 * uses it says. Every other file is compared by length and digest only, and
 * the report says so for each one. The acceptance vectors are not run: this
 * package holds no validation engine. The limits are in every report, in
 * fixed words.
 *
 * It is reproducible. The same active binding and the same candidate give
 * the same report and the same proposed bytes, in whatever order the
 * candidate lists its files, so two people who run the check review one
 * digest.
 */
import canonicalize from 'canonicalize'
import { describeArtefact, profileBindingDigest, readProfileBinding, type BindingArtefact, type BindingArtefactRole, type ProfileBinding } from './profile-binding.js'
import type { BindingProfile } from './profile-registry.js'
import { parseStrictJson } from './strict-json.js'

export const BINDING_UPDATE_REPORT_VERSION = 1

/** What a report does not establish, in fixed words. Every report carries exactly these, so none can claim more. */
export const BINDING_UPDATE_LIMITS = {
  /** The check registers nothing. A proposal becomes usable only when its caller registers it. */
  activation: 'explicit-registration',
  /** Whether the proposal may be registered is decided by the registry's trusted digests, never by the report. */
  trust: 'registry-trusted-digests',
  /** A context is compared term by term. Every other file is compared by length and digest, and what its rules now require is not analysed. */
  rules: 'contexts-by-term-others-by-digest',
  /** The acceptance vectors the binding lists are carried over and were not run under the proposal. */
  vectors: 'not-run',
} as const

/**
 * One file of the candidate set. For a path the active binding already
 * lists, `role`, `uri`, `mediaType` and `licence` are the active entry's
 * unless given here. A new path states its own.
 */
export interface CandidateArtefact {
  /** The file's name relative to the binding. */
  path: string
  bytes: Uint8Array
  role?: BindingArtefactRole
  /** The URI documents name a context by. Only a context has one. */
  uri?: string
  mediaType?: string
  licence?: string
}

/**
 * The next version as the caller proposes it. `artefacts` is the whole set
 * the next version would list: a file the active binding lists and the
 * candidate leaves out is reported as removed, never carried over in
 * silence.
 */
export interface BindingUpdateCandidate {
  artefacts: readonly CandidateArtefact[]
  /** Members of the binding's `source` to replace, such as the `release` and `revision` the candidate files come from. Applied only when a version is proposed. */
  source?: Partial<ProfileBinding['source']>
  /** Who publishes the proposed version, where that is not the active version's publisher. Applied only when a version is proposed. */
  publisher?: ProfileBinding['publisher']
  /** The version to propose. Default: the active version plus one. */
  version?: number
}

/** What a binding records about one artefact, on one side of the comparison. */
export interface ArtefactSnapshot {
  role: BindingArtefactRole
  uri?: string
  mediaType: string
  licence: string
  byteLength: number
  sha256: string
}

/**
 * One member of a context that differs between the two versions: a term, or
 * a keyword such as `@vocab`, which is listed with the terms because it
 * changes how every name the context does not define is read.
 */
export interface ContextTermChange {
  term: string
  change: 'added' | 'removed' | 'redefined'
  /** True when a document written under the active version and using this member would be read differently, or not at all, under the proposal. */
  breaking: boolean
  /** One sentence, where `breaking` is true. */
  why?: string
  /** The definition in the active version, as the context writes it. */
  before?: unknown
  /** The definition in the candidate. */
  after?: unknown
}

/** What changed inside a context, or why it could not be read. A context that could not be read was not compared, and the report never calls that "no change". */
export type ContextChanges =
  | { read: true; terms: ContextTermChange[]; /** Other contexts this one names, by URI. */ references: { added: string[]; removed: string[] } }
  | { read: false; reason: string }

export interface ArtefactChange {
  path: string
  change: 'added' | 'removed' | 'changed' | 'unchanged'
  /** The active version's record. Absent for an added file. */
  before?: ArtefactSnapshot
  /** The candidate's record. Absent for a removed file. */
  after?: ArtefactSnapshot
  /** What differs for a changed file: `bytes`, `role`, `uri`, `mediaType`, `licence`. Empty otherwise. */
  properties: string[]
  /** How far the check looked inside the file: `terms` where a context's terms were compared, `digest` for every other file, for a context that could not be read and for a file whose record is the same on both sides. */
  compared: 'terms' | 'digest'
  /** True when the check can show that documents written under the active version are affected. False is not a finding that they are safe: see `compared`. */
  breaking: boolean
  /** For a file that is a context on either side. */
  context?: ContextChanges
}

export interface BindingUpdateReport {
  reportVersion: typeof BINDING_UPDATE_REPORT_VERSION
  /** The version the check started from. It is unchanged by the check. */
  active: { profile: string; bindingDigest: string }
  /**
   * `unchanged`: the candidate is the active version's files, byte for byte,
   * and nothing is proposed. `proposed`: a binding at the next version is
   * returned beside the report. `refused`: the candidate differs and no
   * binding could be written from it, for the reasons in `problems`.
   */
  outcome: 'unchanged' | 'proposed' | 'refused'
  /** The proposed version and the digest of its binding file: what an operator would add to a trusted list after review. */
  proposed?: { profile: string; bindingDigest: string }
  /** Every file of either version, in the active binding's order, then the added files by path in code-unit order. */
  artefacts: ArtefactChange[]
  /** Members of the binding other than `artefacts` that the proposal writes differently. */
  bindingChanges: Array<{ member: string; before?: unknown; after?: unknown }>
  /** One sentence per change the check can show affects documents written under the active version. */
  breaking: string[]
  /** One sentence per thing a reviewer must look at that the check did not decide. */
  review: string[]
  /** Why no binding could be proposed, one sentence each. Empty unless `outcome` is `refused`. */
  problems: string[]
  limits: typeof BINDING_UPDATE_LIMITS
}

/**
 * The binding the check proposes: its exact bytes, the digest of those bytes
 * and every file it lists. It is registered like any binding, by handing
 * `bindingBytes` to a registry with a resolver that answers from `artefacts`.
 */
export interface BindingUpdateProposal {
  id: string
  version: number
  profile: string
  /** The SHA-256 of `bindingBytes`. */
  bindingDigest: string
  /** The proposed `binding.json`, byte for byte. */
  bindingBytes: Uint8Array
  binding: ProfileBinding
  artefacts: ReadonlyArray<{ artefact: BindingArtefact; bytes: Uint8Array }>
}

export interface BindingUpdateCheck {
  report: BindingUpdateReport
  /** Present only when `report.outcome` is `proposed`. */
  proposal?: BindingUpdateProposal
}

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)
const same = (a: unknown, b: unknown): boolean => canonicalize(a) === canonicalize(b)
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const snapshot = (artefact: BindingArtefact): ArtefactSnapshot => ({
  role: artefact.role,
  ...(artefact.uri == null ? {} : { uri: artefact.uri }),
  mediaType: artefact.mediaType,
  licence: artefact.licence,
  byteLength: artefact.byteLength,
  sha256: artefact.sha256,
})

/** What one context defines: its own members, by name, and the other contexts it names. */
type ContextReading = { ok: true; members: Map<string, unknown>; references: string[] } | { ok: false; reason: string }

/** Every context a `@context` value names by URI, a scoped context inside a term definition included. */
function collectReferences(value: unknown, into: Set<string>, depth = 0): void {
  // Deeper than any context nests its scoped contexts. Strict JSON reading has already bounded the document.
  if (depth > 64) return
  if (typeof value === 'string') { into.add(value); return }
  if (Array.isArray(value)) { for (const entry of value) collectReferences(entry, into, depth + 1); return }
  if (!isObject(value)) return
  for (const [key, definition] of Object.entries(value)) {
    if (key === '@import' && typeof definition === 'string') into.add(definition)
    else if (isObject(definition) && Object.hasOwn(definition, '@context')) collectReferences(definition['@context'], into, depth + 1)
  }
}

/**
 * A context file read for comparison. The members of every object under
 * `@context` are merged in order, a later one replacing an earlier, which is
 * how a processor reads them. A context named by URI is a reference and its
 * terms are not read here: it is a file of its own in the binding.
 */
function readContext(bytes: Uint8Array): ContextReading {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { ok: false, reason: 'the bytes are not UTF-8' }
  }
  const parsed = parseStrictJson(text)
  if (!parsed.ok) return { ok: false, reason: parsed.detail }
  if (!isObject(parsed.value) || !Object.hasOwn(parsed.value, '@context')) return { ok: false, reason: 'the file is not a JSON object with an @context member' }
  const context = parsed.value['@context']
  const members = new Map<string, unknown>()
  for (const entry of Array.isArray(context) ? context : [context]) {
    // A null entry clears what came before it.
    if (entry === null) members.clear()
    else if (isObject(entry)) for (const [key, definition] of Object.entries(entry)) members.set(key, definition)
    else if (typeof entry !== 'string') return { ok: false, reason: 'an entry of @context is not an object, a URI or null' }
  }
  const references = new Set<string>()
  collectReferences(context, references)
  return { ok: true, members, references: [...references].sort(byCodeUnit) }
}

const REMOVED = 'A document that uses it is no longer read as it was: the member is undefined, or takes whatever meaning another context gives the name.'
const REDEFINED = 'A document that uses it says something else under the proposed definition.'
const KEYWORD = 'It is a keyword of the context, and a keyword can change how every term in it, and every name it does not define, is read.'
const ADDED_UNDER_VOCAB = 'The active version sets @vocab, which already gave this name a meaning, and the new definition replaces it.'

/** The members that differ between two readings of a context. An absent side is a context with no members. */
function compareContexts(before: ContextReading | undefined, after: ContextReading | undefined, activeSetsVocab: boolean): ContextChanges {
  for (const [side, reading] of [['active', before], ['candidate', after]] as const) {
    if (reading != null && !reading.ok) return { read: false, reason: `the ${side} file could not be read as a context: ${reading.reason}` }
  }
  const left = before?.ok === true ? before : { members: new Map<string, unknown>(), references: [] as string[] }
  const right = after?.ok === true ? after : { members: new Map<string, unknown>(), references: [] as string[] }
  const terms: ContextTermChange[] = []
  for (const term of [...new Set([...left.members.keys(), ...right.members.keys()])].sort(byCodeUnit)) {
    const keyword = term.startsWith('@')
    const had = left.members.has(term)
    const has = right.members.has(term)
    if (had && !has) terms.push({ term, change: 'removed', breaking: true, why: keyword ? KEYWORD : REMOVED, before: left.members.get(term) })
    else if (!had && has) {
      // A new term breaks nothing by itself: no stored document could use a name the context did not define, unless @vocab defined every name.
      const breaking = keyword || activeSetsVocab
      terms.push({ term, change: 'added', breaking, ...(breaking ? { why: keyword ? KEYWORD : ADDED_UNDER_VOCAB } : {}), after: right.members.get(term) })
    } else if (!same(left.members.get(term), right.members.get(term))) {
      terms.push({ term, change: 'redefined', breaking: true, why: keyword ? KEYWORD : REDEFINED, before: left.members.get(term), after: right.members.get(term) })
    }
  }
  return {
    read: true,
    terms,
    references: { added: right.references.filter((uri) => !left.references.includes(uri)), removed: left.references.filter((uri) => !right.references.includes(uri)) },
  }
}

const list = (values: readonly string[]): string => values.join(', ')

/**
 * Compares the active version of a profile held by a binding with a
 * candidate set of files, and proposes the binding of the next version.
 *
 * `active` is the profile as a registry returns it from `resolve`. It is read
 * and never changed, and it is first held to its own record: the binding
 * bytes to the binding digest, and each file to the length and SHA-256 the
 * binding lists. A report about bytes that are not the active version's
 * would be a report about nothing, so that throws.
 *
 * The proposal differs from the active binding in `version`, `profile`,
 * `artefacts` and whatever `source` and `publisher` members the candidate
 * replaces. Every other member is carried over as written: the steps, the
 * identity rules, the access split and the vectors. A change to one of
 * those is a binding written by hand, not an update of its files.
 *
 * Throws `TypeError` for an input that is not what the types say. A
 * candidate that is well formed and cannot make a binding, such as one that
 * leaves out the only shapes file of a profile with a `shacl` step, is not
 * an error: the report's outcome is `refused` and `problems` says why.
 */
export function checkBindingUpdate(input: { active: BindingProfile; candidate: BindingUpdateCandidate }): BindingUpdateCheck {
  const { active, candidate } = input

  // The active version, from its bytes. The parsed object the caller holds is not trusted to be those bytes.
  const read = readProfileBinding(active.bindingBytes)
  if (!read.ok) throw new TypeError(`the active binding cannot be read: ${read.detail.join(' ')}`)
  if (read.digest !== active.bindingDigest) throw new TypeError(`the active binding's bytes have digest ${read.digest}, not the ${active.bindingDigest} it is registered under`)
  const binding = read.binding
  const activeBytes = new Map<string, Uint8Array>()
  for (const artefact of binding.artefacts) {
    const held = active.artefacts.find((entry) => entry.artefact.path === artefact.path)?.bytes
    if (!(held instanceof Uint8Array)) throw new TypeError(`the active profile does not hold the artefact ${artefact.path}`)
    const actual = describeArtefact(held)
    if (actual.byteLength !== artefact.byteLength || actual.sha256 !== artefact.sha256) throw new TypeError(`the active profile's copy of ${artefact.path} is not the file its binding records`)
    activeBytes.set(artefact.path, held)
  }

  const version = candidate.version ?? binding.version + 1
  if (!Number.isSafeInteger(version) || version <= binding.version) throw new TypeError(`the proposed version must be a whole number above ${binding.version}; got ${JSON.stringify(candidate.version)}`)
  if (!Array.isArray(candidate.artefacts)) throw new TypeError('candidate.artefacts must be a list')

  // The candidate's entries, each completed from the active entry of the same path and described from its own bytes.
  const proposedEntries = new Map<string, { artefact: BindingArtefact; bytes: Uint8Array }>()
  for (const entry of candidate.artefacts as readonly CandidateArtefact[]) {
    if (!isObject(entry) || typeof entry.path !== 'string') throw new TypeError('each candidate artefact names its path as text')
    if (!(entry.bytes instanceof Uint8Array)) throw new TypeError(`the candidate artefact ${entry.path} must give its bytes as a Uint8Array`)
    if (proposedEntries.has(entry.path)) throw new TypeError(`the candidate lists the artefact ${entry.path} twice`)
    const previous = binding.artefacts.find((artefact) => artefact.path === entry.path)
    // A private copy, so the proposal is the bytes that were compared, whatever the caller does with its buffer afterwards.
    const bytes = Uint8Array.from(entry.bytes)
    const role = entry.role ?? previous?.role
    // A URI is carried over only while the file stays a context. A missing member is left missing, and the binding's own checks name it.
    const uri = entry.uri ?? (role === 'context' && previous?.role === 'context' ? previous.uri : undefined)
    const mediaType = entry.mediaType ?? previous?.mediaType
    const licence = entry.licence ?? previous?.licence
    const artefact = {
      ...(role == null ? {} : { role }),
      path: entry.path,
      ...(uri == null ? {} : { uri }),
      ...(mediaType == null ? {} : { mediaType }),
      ...describeArtefact(bytes),
      ...(licence == null ? {} : { licence }),
    } as BindingArtefact
    proposedEntries.set(entry.path, { artefact, bytes })
  }

  // One order for the report and the proposal: the active binding's, then what is new, by path in code-unit order.
  // The order the caller listed its files in does not reach the proposed bytes, so the same set of files gives the same digest.
  const activePaths = binding.artefacts.map((artefact) => artefact.path)
  const addedPaths = [...proposedEntries.keys()].filter((path) => !activePaths.includes(path)).sort(byCodeUnit)
  const proposedArtefacts = [...activePaths.filter((path) => proposedEntries.has(path)), ...addedPaths].map((path) => proposedEntries.get(path)!)

  const readings = (entries: Iterable<{ artefact: BindingArtefact; bytes: Uint8Array }>): Map<string, ContextReading> => {
    const found = new Map<string, ContextReading>()
    for (const { artefact, bytes } of entries) if (artefact.role === 'context') found.set(artefact.path, readContext(bytes))
    return found
  }
  const before = readings(binding.artefacts.map((artefact) => ({ artefact, bytes: activeBytes.get(artefact.path)! })))
  const after = readings(proposedArtefacts)
  const activeSetsVocab = [...before.values()].some((reading) => reading.ok && reading.members.get('@vocab') != null)
  // The contexts each version lists, by the URI documents name them by. A validator reads no other.
  const contextUris = (entries: readonly BindingArtefact[]): Set<string> => new Set(entries.flatMap((artefact) => (artefact.role === 'context' && artefact.uri != null ? [artefact.uri] : [])))
  const activeListed = contextUris(binding.artefacts)
  const listed = contextUris(proposedArtefacts.map(({ artefact }) => artefact))

  const breaking: string[] = []
  const review: string[] = []
  const artefacts: ArtefactChange[] = []
  for (const path of [...activePaths, ...addedPaths]) {
    const old = binding.artefacts.find((artefact) => artefact.path === path)
    const next = proposedEntries.get(path)?.artefact
    const properties: string[] = []
    if (old != null && next != null) {
      if (old.sha256 !== next.sha256 || old.byteLength !== next.byteLength) properties.push('bytes')
      for (const member of ['role', 'uri', 'mediaType', 'licence'] as const) if (old[member] !== next[member]) properties.push(member)
    }
    const change: ArtefactChange['change'] = old == null ? 'added' : next == null ? 'removed' : properties.length > 0 ? 'changed' : 'unchanged'
    const isContext = old?.role === 'context' || next?.role === 'context'
    const entry: ArtefactChange = {
      path,
      change,
      ...(old == null ? {} : { before: snapshot(old) }),
      ...(next == null ? {} : { after: snapshot(next) }),
      properties,
      // Set to `terms` below, once a context's terms have been compared.
      compared: 'digest',
      breaking: false,
    }

    if (isContext && change !== 'unchanged') {
      // A context the active version does not list is one no document written under it can name, so @vocab gives its terms no earlier meaning.
      const context = compareContexts(before.get(path), after.get(path), activeSetsVocab && old?.role === 'context')
      entry.context = context
      if (!context.read) {
        // Not compared is said as such, and the file stays at what a digest can show.
        review.push(`${path}: ${context.reason}. Its terms were not compared.`)
      } else {
        entry.compared = 'terms'
        const broken = context.terms.filter((term) => term.breaking)
        if (broken.length > 0) entry.breaking = true
        // A context that leaves the profile whole is one finding, made below, and not one per term it held.
        if (old?.role === 'context' && next?.role === 'context') {
          for (const kind of ['removed', 'redefined', 'added'] as const) {
            const names = broken.filter((term) => term.change === kind).map((term) => term.term)
            if (names.length > 0) breaking.push(`${path} ${kind === 'added' ? 'adds, over a meaning the active version already gave' : kind === 'removed' ? 'removes' : 'redefines'}: ${list(names)}.`)
          }
          // A context named here is read wherever this one is. A document that names this context alone loses what one it no longer names defined.
          // A reference the active version did not list was never read, so dropping it changes nothing a validator saw.
          for (const uri of context.references.removed.filter((reference) => activeListed.has(reference))) {
            entry.breaking = true
            breaking.push(`${path} no longer names ${uri}, so a document that names ${String(old.uri)} and not ${uri} loses the terms ${uri} defines under the proposed version.`)
          }
          // A context it names now can define a name a document already uses. One the proposal does not list is reported below, with the others.
          const namedNow = context.references.added.filter((reference) => listed.has(reference))
          if (namedNow.length > 0) review.push(`${path} now names ${list(namedNow)}, which ${namedNow.length === 1 ? 'is' : 'are'} read wherever ${path} is and can give a name a document already uses another meaning: compare what ${namedNow.length === 1 ? 'it defines' : 'they define'} with the terms of ${path}.`)
        }
      }
      if (old?.role === 'context' && (next == null || next.role !== 'context')) {
        entry.breaking = true
        breaking.push(`${path} is no longer a context of the profile, so a document that names ${old.uri} is refused under the proposed version.`)
      } else if (old?.role === 'context' && next?.role === 'context' && old.uri !== next.uri) {
        entry.breaking = true
        breaking.push(`${path} is named by ${String(next.uri)} in place of ${String(old.uri)}, so a document that names the earlier URI is refused under the proposed version.`)
      }
    }
    if (!isContext && change !== 'unchanged') {
      const what = change === 'added' ? 'is new' : change === 'removed' ? 'is removed' : properties.includes('bytes') ? 'has other bytes' : `has another ${list(properties)}`
      review.push(`${path} (${old?.role ?? next?.role}) ${what} and was compared by length and digest only: what the profile's rules now require was not analysed.`)
    }
    if (properties.includes('licence')) review.push(`${path} is under ${String(next?.licence)} in place of ${String(old?.licence)}: confirm the notices and the terms it may be passed on under.`)
    if (properties.includes('role')) review.push(`${path} changes role from ${String(old?.role)} to ${String(next?.role)}, so another step reads it.`)
    if (change === 'added' && next?.licence != null) review.push(`${path} is new, under ${next.licence}: confirm a notice accounts for it.`)
    artefacts.push(entry)
  }

  const report: BindingUpdateReport = {
    reportVersion: BINDING_UPDATE_REPORT_VERSION,
    active: { profile: binding.profile, bindingDigest: active.bindingDigest },
    outcome: 'unchanged',
    artefacts,
    bindingChanges: [],
    breaking,
    review,
    problems: [],
    // A copy, so a caller that edits one report's limits changes neither the constant nor any other report.
    limits: { ...BINDING_UPDATE_LIMITS },
  }
  // The same files under the same records: there is no next version to propose, whatever else the candidate names.
  if (artefacts.every((entry) => entry.change === 'unchanged')) {
    if (candidate.source != null || candidate.publisher != null) review.push('The candidate names another source or publisher and the same files, byte for byte. No version is proposed for that alone, and the members given were not applied.')
    return { report }
  }

  // A context the proposal lists may name another, and the engine reads a context only if the binding lists it.
  for (const { artefact } of proposedArtefacts) {
    const reading = after.get(artefact.path)
    if (reading?.ok !== true) continue
    const unlisted = reading.references.filter((uri) => !listed.has(uri))
    if (unlisted.length > 0) review.push(`${artefact.path} names ${unlisted.length === 1 ? 'a context' : 'contexts'} the proposed version does not list, and a validator reads no context a binding does not list: ${list(unlisted)}.`)
  }

  // The proposed binding: the active file's members in the active file's order, with only these replaced.
  const proposed = JSON.parse(new TextDecoder().decode(active.bindingBytes)) as ProfileBinding
  proposed.version = version
  proposed.profile = `${binding.id}@${version}`
  proposed.artefacts = proposedArtefacts.map(({ artefact }) => artefact)
  if (candidate.source != null) proposed.source = { ...proposed.source, ...candidate.source }
  if (candidate.publisher != null) proposed.publisher = { ...candidate.publisher }
  // Two-space JSON and a final newline: how the bundled bindings are written, and one fixed spelling so the digest is reproducible.
  const bindingBytes = new TextEncoder().encode(`${JSON.stringify(proposed, null, 2)}\n`)

  const changed = (member: string, was: unknown, now: unknown): void => { if (!same(was, now)) report.bindingChanges.push({ member, ...(was === undefined ? {} : { before: was }), ...(now === undefined ? {} : { after: now }) }) }
  changed('version', binding.version, proposed.version)
  changed('profile', binding.profile, proposed.profile)
  for (const member of [...new Set([...Object.keys(binding.source), ...Object.keys(proposed.source ?? {})])]) changed(`source.${member}`, (binding.source as Json)[member], (proposed.source as Json | undefined)?.[member])
  for (const member of [...new Set([...Object.keys(binding.publisher), ...Object.keys(proposed.publisher ?? {})])]) changed(`publisher.${member}`, (binding.publisher as Json)[member], (proposed.publisher as Json | undefined)?.[member])

  // Held to the same reading as any binding file, from the bytes that would be distributed.
  const written = readProfileBinding(bindingBytes)
  if (!written.ok) {
    report.outcome = 'refused'
    report.problems = written.detail
    return { report }
  }

  if (binding.source.revision != null && written.binding.source.revision === binding.source.revision) review.push(`\`source.revision\` is still ${binding.source.revision} while the files differ: name the revision the candidate files come from, or confirm they come from this one.`)
  review.push(`The proposal lists the acceptance vectors of ${binding.profile} unchanged, and none was run under it. Run them, and any the new files call for, before the digest is trusted.`)

  report.outcome = 'proposed'
  report.proposed = { profile: written.binding.profile, bindingDigest: written.digest }
  return {
    report,
    proposal: { id: written.binding.id, version: written.binding.version, profile: written.binding.profile, bindingDigest: written.digest, bindingBytes, binding: written.binding, artefacts: proposedArtefacts },
  }
}
