import { integrityOf, sha256 } from './candidates.mjs'
import { setTimeout as delay } from 'node:timers/promises'

export const NPM_REGISTRY = 'https://registry.npmjs.org/'

/** Drop token auth so npm uses GitHub OIDC for trusted publishing. */
export function oidcPublishEnv(env) {
  const next = { ...env }
  delete next.NODE_AUTH_TOKEN
  delete next.NPM_TOKEN
  return next
}

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
export async function registryVersion(candidate, fetcher = fetch, { signal, allowPendingArchive = false } = {}) {
  const requestSignal = () => signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)
  const response = await fetcher(`${NPM_REGISTRY}${encodeURIComponent(candidate.name)}/${encodeURIComponent(candidate.version)}`, { signal: requestSignal() })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`${candidate.name}@${candidate.version}: registry HTTP ${response.status}`)
  const metadata = await response.json()
  if (metadata.name !== candidate.name || metadata.version !== candidate.version) throw new Error(`registry identity mismatch for ${candidate.name}`)
  if (metadata.dist?.integrity !== candidate.integrity) throw new Error(`${candidate.name}@${candidate.version}: published integrity differs; never overwrite or skip different bytes`)
  const url = new URL(metadata.dist.tarball)
  if (url.origin !== new URL(NPM_REGISTRY).origin) throw new Error(`unexpected tarball host for ${candidate.name}`)
  const archive = await fetcher(url, { signal: requestSignal() })
  // Only the post-upload waiter may treat a missing archive as propagation.
  // Preparation must never interpret an existing version as safe to republish.
  if (archive.status === 404 && allowPendingArchive) return null
  if (!archive.ok) throw new Error(`${candidate.name}@${candidate.version}: tarball HTTP ${archive.status}`)
  const bytes = Buffer.from(await archive.arrayBuffer())
  if (sha256(bytes) !== candidate.sha256 || integrityOf(bytes) !== candidate.integrity || bytes.length !== candidate.size) throw new Error(`${candidate.name}@${candidate.version}: downloaded bytes differ`)
  return metadata
}

/** Wait after a successful upload, without retrying publication or relaxing verification. */
export async function waitForRegistryVersion(candidate, {
  timeoutMs = 600_000,
  pollIntervalMs = 15_000,
  fetcher = fetch,
  sleep = delay,
  now = () => performance.now(),
  onProgress = () => {},
} = {}) {
  for (const [name, value] of Object.entries({ timeoutMs, pollIntervalMs })) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) throw new Error(`${name} must be a positive timer duration`)
  }
  const label = `${candidate.name}@${candidate.version}`
  const deadline = now() + timeoutMs
  const signal = AbortSignal.timeout(timeoutMs)
  const timedOut = () => new Error(`${label}: npm availability was not verified within ${timeoutMs / 1000}s; publication may still be processing. Retain the approved plan and archives, verify npm availability, then resume the same approved plan. Do not change the version or republish blindly.`)
  onProgress(`${label}: upload accepted; waiting up to ${timeoutMs / 1000}s for npm availability and matching archive bytes.`)
  while (now() < deadline) {
    let metadata
    try {
      metadata = await registryVersion(candidate, fetcher, { signal, allowPendingArchive: true })
    } catch (error) {
      if (signal.aborted) throw timedOut()
      throw error
    }
    if (signal.aborted || now() >= deadline) throw timedOut()
    if (metadata !== null) {
      onProgress(`${label}: available; downloaded archive matches the approved bytes.`)
      return metadata
    }
    const remaining = deadline - now()
    onProgress(`${label}: npm is still processing; checking again in ${Math.min(pollIntervalMs, remaining) / 1000}s.`)
    await sleep(Math.min(pollIntervalMs, remaining))
  }
  throw timedOut()
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
