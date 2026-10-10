import { sha256 } from './candidates.mjs'
import { NPM_REGISTRY, publicationActions, registryVersion } from './publication.mjs'

const runtimeNames = ['@bsv/dpp-overlay-topics', '@bsv/dpp-profiles', '@bsv/dpp-protocol']

/** Keep the independently released generator bound to one compatible runtime set. */
export function starterRuntimePackages(manifest, template, set) {
  if (manifest.name !== '@bsv/create-dpp-index' || manifest.private) throw new Error('select the public index starter')
  if (manifest.publishConfig?.access !== 'public' || manifest.publishConfig?.registry !== NPM_REGISTRY || manifest.publishConfig?.tag !== 'next') {
    throw new Error('the index starter must publish to public npm under next')
  }
  if (manifest.dpp?.releaseSet !== set.releaseSet || !['candidate', 'released'].includes(set.status)) throw new Error('the starter must select a current candidate or released runtime set')
  if (JSON.stringify(Object.keys(manifest.dpp.packages ?? {}).sort()) !== JSON.stringify(runtimeNames)) throw new Error('the starter must pin the overlay, profiles and protocol packages')
  if (Object.keys(template.dependencies ?? {}).length !== 1 || template.dependencies['@bsv/dpp-overlay-topics'] !== manifest.dpp.packages['@bsv/dpp-overlay-topics']) {
    throw new Error('the template must include the pinned overlay as its only direct runtime dependency')
  }
  return runtimeNames.map(name => {
    const entries = set.packages.filter(pkg => pkg.name === name)
    if (entries.length !== 1 || entries[0].version !== manifest.dpp.packages[name]) throw new Error(`${name}: starter pin differs from the selected runtime set`)
    return entries[0]
  })
}

export function indexStarterPlan({ manifest, template, set, setBytes, candidates, sourceRevision, sourceState, provenance, authentication = 'oidc' }) {
  if (!['oidc', 'interactive'].includes(authentication)) throw new Error('authentication must be oidc or interactive')
  if (authentication === 'interactive' && provenance) throw new Error('an interactive first publication requires a separately approved plan with provenance=false')
  const packages = starterRuntimePackages(manifest, template, set)
  const expected = [{ name: manifest.name, version: manifest.version }, ...packages]
  if (candidates.length !== expected.length || new Set(candidates.map(candidate => candidate.name)).size !== expected.length) throw new Error('pack exactly the starter and its selected runtime packages')
  const selected = expected.map(pkg => {
    const candidate = candidates.find(candidate => candidate.name === pkg.name)
    if (candidate?.version !== pkg.version) throw new Error(`${pkg.name}: candidate version differs from the selected package`)
    return candidate
  })
  return {
    kind: 'dpp-index-starter',
    releaseSet: set.releaseSet,
    releaseSetSha256: sha256(setBytes),
    sourceRevision,
    sourceState,
    registry: NPM_REGISTRY,
    access: 'public',
    tag: manifest.publishConfig.tag,
    provenance,
    authentication,
    candidates: [selected[0]],
    // These are prerequisites, never additional publication targets in this workflow.
    dependencies: selected.slice(1),
  }
}

/** Refuse publication until all pinned runtime archives are already on npm. */
export async function checkIndexStarterRegistry(plan, fetcher = fetch) {
  const missing = []
  for (const dependency of plan.dependencies) {
    if (await registryVersion(dependency, fetcher) === null) missing.push(`${dependency.name}@${dependency.version}`)
  }
  if (missing.length) throw new Error(`Publish the runtime release first; npm is missing ${missing.join(', ')}`)
  return publicationActions(plan.candidates, fetcher)
}
