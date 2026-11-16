#!/usr/bin/env node
/**
 * The images of the current release set: render the operator preset from
 * the set, hold the preset to it, build the images labelled with what they
 * were built from, read those labels back, and record published digests.
 *
 *   node scripts/release-images.mjs check                       # hold deploy/ and the Dockerfiles to the set; exit 1 on a difference
 *   node scripts/release-images.mjs render                      # write the image block of deploy/operator.env.example and the third-party references
 *   node scripts/release-images.mjs build [--prefix <text>] [--tag <tag>] [--base-image <ref>]
 *                                                               # build both images for this machine, labelled from the checkout and the set
 *   node scripts/release-images.mjs inspect <image>=<reference> [...] [--revision <sha>] [--state committed|working-tree]
 *                                                               # read the labels of built images back and hold them to the set
 *   node scripts/release-images.mjs pin <image>=sha256:<digest> [...]
 *                                                               # record published digests in the set and render the preset from them
 *
 * The release set is the one place the registry, the image names and the
 * digests are written (release/README.md, Images). `render` and `pin` write
 * files under deploy/ and release/; `check`, `build` and `inspect` write
 * none. `build` tags images locally and never pushes; publication is the
 * workflow .github/workflows/publish-images.yaml and nothing else.
 *
 * `build` prints one last line, `IMAGES ` and a JSON object naming each
 * image built with its local tag and identifier, for a script to read.
 * Results print one sentence per check, never a score.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { currentReleaseSet } from './lib/candidates.mjs'
import { DIGEST, ENV_EXAMPLE, PRESET_FILES, UNPUBLISHED, buildArguments, docker, imagesOf, inspectImage, labelFindings, presetFindings, renderEnvBlock, replaceEnvBlock, sourceState, thirdPartyReference } from './lib/images.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [command, ...rest] = process.argv.slice(2)
const option = (name) => { const at = rest.indexOf(name); return at === -1 ? undefined : rest[at + 1] }
const pairs = () => rest.filter((arg, index) => arg.includes('=') && !arg.startsWith('--') && !(rest[index - 1] ?? '').startsWith('--')).map((arg) => { const at = arg.indexOf('='); return [arg.slice(0, at), arg.slice(at + 1)] })
const { path: setPath, set } = currentReleaseSet(root)
const images = imagesOf(set)
let failures = 0
const say = (ok, sentence) => { console.log(`${ok ? 'Holds:' : 'FAILS:'} ${sentence}`); if (!ok) failures += 1 }
const named = (name) => { const image = images.own.find((i) => i.name === name); if (image == null) throw new Error(`${set.releaseSet} has no image called ${name}; it has ${images.own.map((i) => i.name).join(' and ')}`); return image }

/** Write the files rendered from the set: the env example's block, and each third-party reference in the preset files. */
function render() {
  const example = join(root, ENV_EXAMPLE)
  writeFileSync(example, replaceEnvBlock(readFileSync(example, 'utf8'), renderEnvBlock(set)))
  console.log(`wrote the image block of ${ENV_EXAMPLE} from ${setPath}`)
  for (const file of PRESET_FILES) {
    let text = readFileSync(join(root, file), 'utf8')
    for (const entry of images.thirdParty) {
      const repository = entry.repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      text = text.replace(new RegExp(`^( {4}image: )${repository}[:@]\\S*$`, 'gm'), `$1${thirdPartyReference(entry)}`)
    }
    writeFileSync(join(root, file), text)
    console.log(`wrote the third-party references of ${file} from ${setPath}`)
  }
}

if (command === 'check') {
  for (const finding of presetFindings(set, root)) say(finding.ok, finding.sentence)
} else if (command === 'render') {
  render()
  for (const finding of presetFindings(set, root)) say(finding.ok, finding.sentence)
} else if (command === 'build') {
  const prefix = option('--prefix') ?? ''
  const tag = option('--tag') ?? 'local'
  const base = option('--base-image')
  const source = sourceState(root)
  const built = {}
  for (const image of images.own) {
    const reference = `${prefix}${image.name}:${tag}`
    const args = Object.entries(buildArguments(set, image, source)).flatMap(([name, value]) => ['--build-arg', `${name}=${value}`])
    console.log(`building ${reference} from ${image.dockerfile} at ${source.revision.slice(0, 12)} (${source.state})`)
    const result = docker(['build', ...args, ...(base == null ? [] : ['--build-arg', `BASE_IMAGE=${base}`]), '-f', image.dockerfile, '-t', reference, '.'], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] })
    say(result.status === 0, `${reference} built from ${image.dockerfile}.`)
    if (result.status !== 0) continue
    const inspected = inspectImage(reference)
    built[image.name] = { reference, id: inspected.id, platform: `${inspected.os}/${inspected.architecture}` }
    for (const finding of labelFindings(set, image, reference, source).findings) say(finding.ok, finding.sentence)
  }
  console.log(`IMAGES ${JSON.stringify({ releaseSet: set.releaseSet, sourceRevision: source.revision, sourceState: source.state, images: built })}`)
} else if (command === 'inspect') {
  const expected = { ...(option('--revision') == null ? {} : { revision: option('--revision') }), ...(option('--state') == null ? {} : { state: option('--state') }) }
  const requested = pairs()
  if (requested.length === 0) { console.error('Name at least one image, for example dpp-overlay=dpp-overlay:local'); process.exit(2) }
  const read = {}
  for (const [name, reference] of requested) {
    const { findings, facts } = labelFindings(set, named(name), reference, expected)
    for (const finding of findings) say(finding.ok, finding.sentence)
    read[name] = facts
  }
  console.log(`IMAGES ${JSON.stringify({ releaseSet: set.releaseSet, images: read })}`)
} else if (command === 'pin') {
  const requested = pairs()
  if (requested.length === 0) { console.error('Name at least one digest, for example dpp-overlay=sha256:<64 hex characters>'); process.exit(2) }
  for (const [name, digest] of requested) {
    const image = named(name)
    if (digest !== UNPUBLISHED && !DIGEST.test(digest)) throw new Error(`${digest} is not a sha256 digest; a tag is not a pin`)
    image.digest = digest
  }
  writeFileSync(join(root, setPath), JSON.stringify(set, null, 2) + '\n')
  console.log(`recorded ${requested.map(([name, digest]) => `${name} at ${digest}`).join(' and ')} in ${setPath}`)
  render()
  for (const finding of presetFindings(set, root)) say(finding.ok, finding.sentence)
  console.log('The set file changed, so its digest did: pack the candidates again before anything refers to them.')
} else {
  console.error('Usage: node scripts/release-images.mjs check | render | build | inspect <image>=<reference> ... | pin <image>=sha256:<digest> ...')
  process.exit(2)
}
process.exit(failures === 0 ? 0 : 1)
