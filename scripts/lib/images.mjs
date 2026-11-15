/**
 * The images of a release set, and how everything else is held to them:
 * shared by scripts/release-images.mjs, the checker, the contents check, the
 * parity check and the image publication workflow, so that each of them
 * reads one declaration and refuses the same things for the same reasons.
 *
 * The release set is the one place the registry, each image's name and each
 * digest are written. The operator preset under deploy/ is rendered from it
 * and held to it; nothing under deploy/ is a second source.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** A registry digest. Nothing else pins an image: a tag can be moved. */
export const DIGEST = /^sha256:[0-9a-f]{64}$/
/** What an image of ours records until it has been published. */
export const UNPUBLISHED = 'unpublished'

/** The labels both Dockerfiles write. `inspect` reads these back. */
export const LABELS = {
  title: 'org.opencontainers.image.title',
  source: 'org.opencontainers.image.source',
  revision: 'org.opencontainers.image.revision',
  version: 'org.opencontainers.image.version',
  licences: 'org.opencontainers.image.licenses',
  package: 'io.github.bsv-blockchain.dpp.package',
  releaseSet: 'io.github.bsv-blockchain.dpp.release-set',
  sourceState: 'io.github.bsv-blockchain.dpp.source-state',
  node: 'io.github.bsv-blockchain.dpp.node',
  licenceScope: 'io.github.bsv-blockchain.dpp.licence-scope',
}
export const SOURCE_REPOSITORY = 'https://github.com/bsv-blockchain/dpp'

/** The Compose files the operator runs from pinned images, and the override files a contributor adds to build from source. */
export const PRESET_FILES = ['deploy/compose.yml', 'deploy/compose.second-operator.yml']
export const BUILD_FILES = ['deploy/compose.build.yml', 'deploy/compose.second-operator.build.yml']
/** The Compose file the application starter scaffolds. It runs the generated application's database, at the pin the operator preset uses. */
export const STARTER_COMPOSE = 'packages/create-dpp-app/template/deploy/compose.yml'
export const ENV_EXAMPLE = 'deploy/operator.env.example'
const BLOCK_START = '# >>> images'
const BLOCK_END = '# <<< images'

/** The set's image declaration, or a sentence saying it has none. */
export function imagesOf(set) {
  if (set.images == null) throw new Error(`${set.releaseSet} declares no images`)
  return set.images
}

/** `registry/name@sha256:…` for one of our images. Throws for anything that is not a digest, a tag above all. */
export function pinnedReference(registry, name, digest) {
  if (!DIGEST.test(String(digest))) throw new Error(`${name} has no registry digest (${digest}); a tag is not a pin`)
  return `${registry}/${name}@${digest}`
}

/** `repository:tag@sha256:…` for an image somebody else publishes. The tag is for the reader; the digest is what is pulled. */
export function thirdPartyReference(entry) {
  if (!DIGEST.test(String(entry.digest))) throw new Error(`${entry.name} has no registry digest; resolve one before it is named`)
  return `${entry.repository}:${entry.tag}@${entry.digest}`
}

/** The `image:` value of one of our images in a preset file: the registry and the digest are variables the env file sets, and neither has a default. */
export function presetImageValue(image) {
  return `\${DPP_IMAGE_REGISTRY:?set DPP_IMAGE_REGISTRY to the registry of this release set's images}/${image.name}@\${${image.digestVariable}:?set ${image.digestVariable} to the sha256 digest of the published ${image.name} image. A tag is not accepted. To build from source see deploy/README.md}`
}

/** The block of deploy/operator.env.example that carries the pins, rendered from the set. */
export function renderEnvBlock(set) {
  const images = imagesOf(set)
  const unpublished = images.own.filter((image) => image.digest === UNPUBLISHED)
  const lines = [
    `${BLOCK_START}: rendered from release/${set.releaseSet}.json by scripts/release-images.mjs render. Do not edit by hand.`,
    `# The images of ${set.releaseSet}. The preset pulls each by digest and by`,
    '# nothing else: a tag can be moved to other bytes, so a tag is not a pin,',
    '# and the preset has no setting that takes one. With a digest left empty',
    '# docker compose refuses to start and says which one is missing.',
    `DPP_IMAGE_REGISTRY=${images.registry}`,
  ]
  for (const image of images.own) {
    lines.push(image.digest === UNPUBLISHED
      ? `# ${image.name} of this set is not published yet, so it has no digest.`
      : `# ${image.name}, built from ${image.dockerfile} for ${image.platforms.join(' and ')}.`)
    lines.push(`${image.digestVariable}=${image.digest === UNPUBLISHED ? '' : image.digest}`)
  }
  if (unpublished.length > 0) {
    lines.push('# Until the images are published, build them from a source checkout:')
    lines.push('# deploy/README.md, Build from source.')
  }
  lines.push(`${BLOCK_END}`)
  return lines.join('\n')
}

/** The env example with its image block replaced by `block`. Throws when the markers are not there. */
export function replaceEnvBlock(text, block) {
  const start = text.indexOf(BLOCK_START)
  const end = text.indexOf(BLOCK_END)
  if (start === -1 || end === -1 || end < start) throw new Error(`${ENV_EXAMPLE} has no "${BLOCK_START}" to "${BLOCK_END}" block`)
  const after = text.indexOf('\n', end)
  return text.slice(0, start) + block + (after === -1 ? '\n' : text.slice(after))
}

/** Every `image:` value of a Compose file, in order, with the service it belongs to. */
export function composeImages(text) {
  const found = []
  let section
  let service
  for (const line of text.split('\n')) {
    const top = /^([a-z][a-z0-9_-]*):/.exec(line)
    if (top != null) { section = top[1]; service = undefined; continue }
    if (section !== 'services') continue
    const named = /^ {2}([a-z][a-z0-9_-]*):\s*$/.exec(line)
    if (named != null) { service = named[1]; continue }
    const image = /^ {4}image:\s*(.+?)\s*$/.exec(line)
    if (image != null) found.push({ service, value: image[1] })
  }
  return found
}

/**
 * Hold the preset to the set: the sentences, each with whether it holds.
 * A preset file names our images through the two variables and nothing
 * else, names every other image by tag and digest as the set records it,
 * and builds nothing; a build file names local tags and builds; and the env
 * example carries the rendered block.
 */
export function presetFindings(set, root) {
  const images = imagesOf(set)
  const findings = []
  const say = (ok, sentence) => findings.push({ ok, sentence })
  const expected = new Map()
  for (const image of images.own) expected.set(presetImageValue(image), image.name)
  for (const entry of images.thirdParty) expected.set(thirdPartyReference(entry), entry.name)

  for (const file of PRESET_FILES) {
    if (!existsSync(join(root, file))) { say(false, `${file} does not exist.`); continue }
    const text = readFileSync(join(root, file), 'utf8')
    const named = composeImages(text)
    say(named.length > 0, `${file} names ${named.length} image${named.length === 1 ? '' : 's'}.`)
    for (const { service, value } of named) {
      say(expected.has(value), `${file}: service ${service} runs ${expected.has(value) ? `${expected.get(value)}, pinned as the release set records it` : `${value}, which is not a pinned image of ${set.releaseSet}`}.`)
    }
    say(!/^\s+build:/m.test(text), `${file} builds nothing${/^\s+build:/m.test(text) ? ': it has a build section, which belongs in a build file' : ''}.`)
    const tagOnly = named.filter(({ value }) => !value.includes('@'))
    say(tagOnly.length === 0, `${file} names no image by tag alone${tagOnly.length === 0 ? '' : `: ${tagOnly.map((n) => n.value).join(', ')}`}.`)
  }
  // The starter's Compose file is scaffolded into every generated application, so a floating tag there would put a different
  // database under each of them. It names third-party images only, each at the pin the release set records, and builds nothing.
  if (!existsSync(join(root, STARTER_COMPOSE))) say(false, `${STARTER_COMPOSE} does not exist.`)
  else {
    const text = readFileSync(join(root, STARTER_COMPOSE), 'utf8')
    const named = composeImages(text)
    const pinned = new Map(images.thirdParty.map((entry) => [thirdPartyReference(entry), entry]))
    say(named.length > 0, `${STARTER_COMPOSE} names ${named.length} image${named.length === 1 ? '' : 's'}.`)
    for (const { service, value } of named) {
      const entry = pinned.get(value)
      say(entry != null && entry.service === service, `${STARTER_COMPOSE}: service ${service} runs ${entry != null && entry.service === service ? `${entry.name} ${entry.tag}, at the pin ${images.preset} uses` : `${value}, which is not the pin ${images.preset} uses for a ${service} service`}.`)
    }
    say(!/^\s+build:/m.test(text), `${STARTER_COMPOSE} builds nothing${/^\s+build:/m.test(text) ? ': it has a build section' : ''}.`)
  }

  const preset = existsSync(join(root, images.preset)) ? composeImages(readFileSync(join(root, images.preset), 'utf8')) : []
  for (const image of images.own) say(preset.some((n) => n.service === image.service && n.value === presetImageValue(image)), `${images.preset} runs ${image.name} as its ${image.service} service.`)
  for (const entry of images.thirdParty) say(preset.some((n) => n.service === entry.service && n.value === thirdPartyReference(entry)), `${images.preset} runs ${entry.name} ${entry.tag} as its ${entry.service} service, at the digest resolved on ${entry.resolvedAt}.`)

  for (const file of BUILD_FILES) {
    if (!existsSync(join(root, file))) { say(false, `${file} does not exist.`); continue }
    const text = readFileSync(join(root, file), 'utf8')
    const named = composeImages(text)
    const remote = named.filter(({ value }) => value.includes('/') || value.includes('@'))
    say(named.length > 0 && remote.length === 0, `${file} names only local tags, so a source build is never mistaken for a published image${remote.length === 0 ? '' : `: ${remote.map((n) => n.value).join(', ')}`}.`)
    // The first build file belongs to the preset and builds every image; the others build the ones their preset file runs.
    for (const image of images.own) {
      const builds = text.includes(`dockerfile: ${image.dockerfile}`)
      if (builds || file === BUILD_FILES[0]) say(builds, `${file} ${builds ? 'builds' : 'does not build'} ${image.name} from ${image.dockerfile}.`)
    }
  }

  for (const image of images.own) {
    if (!existsSync(join(root, image.dockerfile))) { say(false, `${image.dockerfile} does not exist.`); continue }
    const dockerfile = readFileSync(join(root, image.dockerfile), 'utf8')
    say(new RegExp(`^ARG BASE_IMAGE=${image.runtime.baseImage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(dockerfile), `${image.dockerfile} builds on ${image.runtime.baseImage}, as the release set records.`)
    say(dockerfile.includes(`RUN test "$(node --version)" = "v${image.runtime.node}"`), `${image.dockerfile} refuses a base image whose Node is not ${image.runtime.node}.`)
    for (const argument of ['SOURCE_REVISION', 'SOURCE_STATE', 'RELEASE_SET', 'PACKAGE_VERSION']) {
      if (!new RegExp(`^ARG ${argument}=unknown$`, 'm').test(dockerfile)) say(false, `${image.dockerfile} does not take the build argument ${argument}.`)
    }
    const labelled = [LABELS.revision, LABELS.version, LABELS.releaseSet, LABELS.sourceState, LABELS.licences, LABELS.source, LABELS.licenceScope].filter((label) => !dockerfile.includes(`${label}=`))
    say(labelled.length === 0, `${image.dockerfile} writes the source revision, release set, package version, licence and source as labels${labelled.length === 0 ? '' : `, but not ${labelled.join(', ')}`}.`)
    say(dockerfile.includes(`${LABELS.package}="${image.package}"`) && dockerfile.includes(`${LABELS.node}="${image.runtime.node}"`), `${image.dockerfile} labels the image as ${image.package} on Node ${image.runtime.node}.`)
    say(/^COPY LICENSE NOTICE PATENTS \.\/$/m.test(dockerfile.split(/^FROM /m).at(-1)), `${image.dockerfile} copies LICENSE, NOTICE and PATENTS into the image it ships.`)
    const pkg = set.packages.find((p) => p.name === image.package)
    say(pkg != null, `${image.name} is the image of ${image.package}, a package of ${set.releaseSet}.`)
  }

  if (!existsSync(join(root, ENV_EXAMPLE))) say(false, `${ENV_EXAMPLE} does not exist.`)
  else {
    const text = readFileSync(join(root, ENV_EXAMPLE), 'utf8')
    let rendered
    try { rendered = replaceEnvBlock(text, renderEnvBlock(set)) } catch (cause) { say(false, `${cause.message}.`) }
    if (rendered != null) say(rendered === text, `${ENV_EXAMPLE} carries the registry and digests of ${set.releaseSet}${rendered === text ? '' : ', but not as the set renders them; run node scripts/release-images.mjs render'}.`)
  }
  const unpublished = images.own.filter((image) => image.digest === UNPUBLISHED).map((image) => image.name)
  say(true, unpublished.length === 0 ? `every image of ${set.releaseSet} is pinned by a published digest.` : `${unpublished.join(' and ')} of ${set.releaseSet} ${unpublished.length === 1 ? 'is' : 'are'} unpublished: the preset refuses to start from ${ENV_EXAMPLE} as it stands, and a contributor builds from source.`)
  return findings
}

/** The source revision and whether the tree has changes, as the packer records them. */
export function sourceState(root) {
  const run = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  try { return { revision: run(['rev-parse', 'HEAD']), state: run(['status', '--porcelain']) === '' ? 'committed' : 'working-tree' } } catch { return { revision: 'unknown', state: 'unknown' } }
}

/** The build arguments that label one image as belonging to `set` at this checkout's revision. */
export function buildArguments(set, image, source) {
  const pkg = set.packages.find((p) => p.name === image.package)
  if (pkg == null) throw new Error(`${image.name} names ${image.package}, which ${set.releaseSet} does not carry`)
  return { SOURCE_REVISION: source.revision, SOURCE_STATE: source.state, RELEASE_SET: set.releaseSet, PACKAGE_VERSION: pkg.version }
}

export const docker = (argv, options = {}) => spawnSync('docker', argv, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options })

/** The labels and configuration of a local image, or undefined when Docker does not hold it. */
export function inspectImage(reference) {
  const inspected = docker(['image', 'inspect', reference])
  if (inspected.status !== 0) return undefined
  const [image] = JSON.parse(inspected.stdout)
  return { id: image.Id, labels: image.Config?.Labels ?? {}, config: image.Config ?? {}, architecture: image.Architecture, os: image.Os, sizeBytes: image.Size, repoDigests: image.RepoDigests ?? [] }
}

/**
 * Hold a built image's labels to the set and to what the image contains:
 * the sentences, each with whether it holds, and the facts read. `expected`
 * names the source revision and state the image should carry, when the
 * caller knows them (the candidate record's, for a release).
 */
export function labelFindings(set, image, reference, expected = {}) {
  const findings = []
  const say = (ok, sentence) => findings.push({ ok, sentence })
  const inspected = inspectImage(reference)
  if (inspected == null) return { findings: [{ ok: false, sentence: `Docker does not hold ${reference}.` }], facts: undefined }
  const { labels } = inspected
  const pkg = set.packages.find((p) => p.name === image.package)
  const workdir = inspected.config.WorkingDir
  const inside = docker(['run', '--rm', '--network', 'none', '--entrypoint', 'node', reference, '-e', `console.log(JSON.stringify({ node: process.version, version: require(${JSON.stringify(`${workdir}/${pkg.directory}/package.json`)}).version, name: require(${JSON.stringify(`${workdir}/${pkg.directory}/package.json`)}).name }))`])
  const read = inside.status === 0 ? JSON.parse(inside.stdout.trim().split('\n').at(-1)) : undefined
  say(labels[LABELS.title] === image.name, `${reference} is labelled ${labels[LABELS.title] ?? 'nothing'}; the set calls it ${image.name}.`)
  say(labels[LABELS.package] === image.package, `it is labelled as the image of ${labels[LABELS.package] ?? 'nothing'}; the set says ${image.package}.`)
  say(labels[LABELS.releaseSet] === set.releaseSet, `it names release set ${labels[LABELS.releaseSet] ?? 'nothing'}; this is ${set.releaseSet}.`)
  say(labels[LABELS.version] === pkg.version, `it names version ${labels[LABELS.version] ?? 'nothing'}; the set has ${image.package}@${pkg.version}.`)
  say(read != null && read.name === image.package && read.version === labels[LABELS.version], `the package manifest inside it is ${read == null ? 'unreadable' : `${read.name}@${read.version}`}, which ${read != null && read.version === labels[LABELS.version] ? 'is' : 'is not'} the version on the label.`)
  say(read != null && read.node === `v${image.runtime.node}` && labels[LABELS.node] === image.runtime.node, `it runs Node ${read?.node ?? 'unknown'} and is labelled ${labels[LABELS.node] ?? 'nothing'}; the set records ${image.runtime.node}.`)
  say(/^[0-9a-f]{40}$/.test(labels[LABELS.revision] ?? ''), `it names source revision ${labels[LABELS.revision] ?? 'nothing'}.`)
  if (expected.revision != null) say(labels[LABELS.revision] === expected.revision, `that is ${labels[LABELS.revision] === expected.revision ? '' : 'not '}the revision expected, ${expected.revision}.`)
  say(['committed', 'working-tree'].includes(labels[LABELS.sourceState]), `it says its source was ${labels[LABELS.sourceState] ?? 'nothing'}.`)
  if (expected.state != null) say(labels[LABELS.sourceState] === expected.state, `the source state expected is ${expected.state}.`)
  say(labels[LABELS.source] === SOURCE_REPOSITORY, `it names its source as ${labels[LABELS.source] ?? 'nothing'}.`)
  say(labels[LABELS.licences] === 'Apache-2.0' && (labels[LABELS.licenceScope] ?? '').includes('keep their own terms'), 'its licence label names Apache-2.0 for this repository\'s code, and its scope label says the base image and dependencies keep their own terms.')
  return {
    findings,
    facts: { reference, id: inspected.id, platform: `${inspected.os}/${inspected.architecture}`, sizeBytes: inspected.sizeBytes, node: read?.node, package: read == null ? undefined : `${read.name}@${read.version}`, releaseSet: labels[LABELS.releaseSet], sourceRevision: labels[LABELS.revision], sourceState: labels[LABELS.sourceState] },
  }
}
