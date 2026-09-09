/**
 * What a candidate record promises and how it is held to the bytes: shared
 * by the packer, the consumer check, the bundle and the publication workflow,
 * so that every one of them refuses the same things for the same reasons.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
export const integrityOf = (bytes) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

/**
 * The current release set under release/: the newest whose status is not
 * superseded. A superseded set records versions the tree has moved past.
 */
export function currentReleaseSet(root) {
  const sets = readdirSync(join(root, 'release'))
    .filter((name) => /^dpp-release-.*\.json$/.test(name))
    .map((name) => ({ path: `release/${name}`, set: JSON.parse(readFileSync(join(root, 'release', name), 'utf8')) }))
    .filter(({ set }) => set.status !== 'superseded')
    .sort((a, b) => a.path.localeCompare(b.path))
  if (sets.length === 0) throw new Error('no release set under release/ is current; name one on the command line')
  return sets.at(-1)
}

/**
 * Hold the tarballs in a directory to a candidate record: every recorded
 * candidate present with the recorded SHA-256, npm integrity and size, and
 * nothing in the directory the record does not name. Returns the sentences,
 * each with whether it holds; the caller decides what to do with a failure.
 */
export function verifyCandidates(record, dir) {
  const findings = []
  const say = (ok, sentence) => findings.push({ ok, sentence })
  if (!Array.isArray(record?.candidates) || record.candidates.length === 0) { say(false, 'the candidate record names no candidates.'); return findings }
  const present = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.tgz')) : []
  for (const c of record.candidates) {
    if (typeof c.filename !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/.test(c.filename)) {
      say(false, `${c.name}: invalid candidate filename.`)
      continue
    }
    const path = join(dir, c.filename)
    if (!existsSync(path)) { say(false, `${c.name}@${c.version}: ${c.filename} is missing from ${dir}.`); continue }
    const bytes = readFileSync(path)
    const digest = sha256(bytes)
    const integrity = integrityOf(bytes)
    say(digest === c.sha256, `${c.name}@${c.version}: ${c.filename} has SHA-256 ${digest.slice(0, 16)}…${digest === c.sha256 ? ', as recorded' : `, but the record says ${String(c.sha256).slice(0, 16)}…`}.`)
    say(integrity === c.integrity, `${c.name}@${c.version}: ${c.filename} has npm integrity ${integrity === c.integrity ? 'as recorded' : 'that differs from the record'}.`)
    say(bytes.length === c.size, `${c.name}@${c.version}: ${c.filename} is ${bytes.length} bytes${bytes.length === c.size ? ', as recorded' : `, but the record says ${c.size}`}.`)
  }
  const unexpected = present.filter((f) => !record.candidates.some((c) => c.filename === f))
  say(unexpected.length === 0, `no tarball in ${dir} is outside the record${unexpected.length ? `: ${unexpected.join(', ')}` : ''}.`)
  const names = record.candidates.map((c) => c.name)
  say(new Set(names).size === names.length, 'no package is recorded twice.')
  return findings
}

/**
 * Hold a candidate record to the release set it names: the same set
 * identifier, every package of the set present once at the set's version,
 * and the set file's digest unchanged since the record was made.
 */
export function verifyRecordAgainstSet(record, set, setBytes) {
  const findings = []
  const say = (ok, sentence) => findings.push({ ok, sentence })
  say(record.releaseSet === set.releaseSet, `the record names ${record.releaseSet}; the set is ${set.releaseSet}.`)
  say(set.status === 'candidate', `${set.releaseSet} is a ${set.status}${set.status === 'candidate' ? '' : ', not a candidate'}.`)
  for (const pkg of set.packages) {
    const c = (record.candidates ?? []).filter((x) => x.name === pkg.name)
    say(c.length === 1 && c[0].version === pkg.version, `${pkg.name}@${pkg.version} is recorded once${c.length === 1 && c[0].version === pkg.version ? '' : c.length === 0 ? ', but the record lacks it' : `, but the record has ${c.map((x) => x.version).join(', ')}`}.`)
  }
  const extra = (record.candidates ?? []).filter((c) => !set.packages.some((p) => p.name === c.name))
  say(extra.length === 0, `the record names no package outside the set${extra.length ? `: ${extra.map((c) => c.name).join(', ')}` : ''}.`)
  if (setBytes != null) {
    const digest = sha256(setBytes)
    say(record.releaseSetSha256 === digest, `the set file's digest is ${record.releaseSetSha256 === digest ? 'the one the record was made against' : 'not the one the record was made against; re-pack'}.`)
  }
  return findings
}
