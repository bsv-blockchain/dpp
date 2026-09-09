import { integrityOf, sha256 } from './candidates.mjs'

export const NPM_REGISTRY = 'https://registry.npmjs.org/'

/** Dependencies within the release must be available before their consumers. */
export function publicationOrder(candidates, manifests) {
  const ordered = []
  const visiting = new Set()
  const visited = new Set()
  const byName = new Map(candidates.map((c) => [c.name, c]))
  function visit(candidate) {
    if (visited.has(candidate.name)) return
    if (visiting.has(candidate.name)) throw new Error(`dependency cycle at ${candidate.name}`)
    visiting.add(candidate.name)
    const manifest = manifests[candidate.name]
    if (manifest?.name !== candidate.name || manifest.version !== candidate.version) throw new Error(`manifest mismatch for ${candidate.name}`)
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }).sort()) {
      if (byName.has(name)) visit(byName.get(name))
    }
    visiting.delete(candidate.name)
    visited.add(candidate.name)
    ordered.push(candidate)
  }
  for (const candidate of candidates) visit(candidate)
  return ordered
}

/** Only a registry 404 means absent. Network, authentication and server errors stop the release. */
export async function registryVersion(candidate, fetcher = fetch) {
  const response = await fetcher(`${NPM_REGISTRY}${encodeURIComponent(candidate.name)}/${encodeURIComponent(candidate.version)}`, { signal: AbortSignal.timeout(30_000) })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`${candidate.name}@${candidate.version}: registry HTTP ${response.status}`)
  const metadata = await response.json()
  if (metadata.name !== candidate.name || metadata.version !== candidate.version) throw new Error(`registry identity mismatch for ${candidate.name}`)
  if (metadata.dist?.integrity !== candidate.integrity) throw new Error(`${candidate.name}@${candidate.version}: published integrity differs; never overwrite or skip different bytes`)
  const url = new URL(metadata.dist.tarball)
  if (url.origin !== new URL(NPM_REGISTRY).origin) throw new Error(`unexpected tarball host for ${candidate.name}`)
  const archive = await fetcher(url, { signal: AbortSignal.timeout(30_000) })
  if (!archive.ok) throw new Error(`${candidate.name}@${candidate.version}: tarball HTTP ${archive.status}`)
  const bytes = Buffer.from(await archive.arrayBuffer())
  if (sha256(bytes) !== candidate.sha256 || integrityOf(bytes) !== candidate.integrity || bytes.length !== candidate.size) throw new Error(`${candidate.name}@${candidate.version}: downloaded bytes differ`)
  return metadata
}

/** Inspect every version before the first write, so a later conflict cannot cause a partial release. */
export async function publicationActions(candidates, fetcher = fetch) {
  const actions = []
  for (const candidate of candidates) {
    const metadata = await registryVersion(candidate, fetcher)
    actions.push({ candidate, action: metadata === null ? 'publish' : 'already-published' })
  }
  return actions
}

export function assertApproval(plan, expectedDigest, revision, dirty) {
  if (!/^[a-f0-9]{64}$/.test(expectedDigest ?? '') || sha256(Buffer.from(JSON.stringify(plan, null, 2) + '\n')) !== expectedDigest) throw new Error('approval does not match the exact publication plan')
  if (plan.sourceState !== 'committed' || dirty || revision !== plan.sourceRevision) throw new Error('publication requires the approved committed revision and a clean working tree')
}
