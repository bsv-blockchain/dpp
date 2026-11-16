/**
 * The image declaration of a release set and the operator preset rendered
 * from it (scripts/lib/images.mjs, scripts/publish-images.mjs): what pins an
 * image, what the env example carries before and after publication, what a
 * preset file may name, and what the image publication refuses. Built on the
 * repository's own files and on temporary copies of them, so the test needs
 * no Docker and no network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { currentReleaseSet, integrityOf, sha256 } from '../../scripts/lib/candidates.mjs'
import { BUILD_FILES, ENV_EXAMPLE, PRESET_FILES, STARTER_COMPOSE, buildArguments, composeImages, imagesOf, pinnedReference, presetFindings, presetImageValue, renderEnvBlock, replaceEnvBlock, thirdPartyReference } from '../../scripts/lib/images.mjs'
import { imagePublicationPlan } from '../../scripts/publish-images.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const { path: setPath, set } = currentReleaseSet(root)
const images = imagesOf(set)
const DIGEST_A = `sha256:${'a'.repeat(64)}`
const DIGEST_B = `sha256:${'b'.repeat(64)}`
const failing = (findings) => findings.filter((f) => !f.ok).map((f) => f.sentence)
const published = () => { const copy = structuredClone(set); copy.images.own[0].digest = DIGEST_A; copy.images.own[1].digest = DIGEST_B; return copy }

/** A copy of everything the preset is held to, in a directory a test may change. */
function copyOfPreset() {
  const dir = mkdtempSync(join(tmpdir(), 'dpp-preset-'))
  for (const file of [...PRESET_FILES, ...BUILD_FILES, STARTER_COMPOSE, ENV_EXAMPLE, ...images.own.map((image) => image.dockerfile)]) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    cpSync(join(root, file), join(dir, file))
  }
  return dir
}
const edit = (dir, file, change) => writeFileSync(join(dir, file), change(readFileSync(join(dir, file), 'utf8')))

test('the current release set declares the index and validator images and a pinned MongoDB', () => {
  assert.deepEqual(images.own.map((image) => [image.name, image.service, image.package]), [['dpp-overlay', 'overlay', '@bsv/dpp-overlay'], ['dpp-validator', 'validator', '@bsv/dpp-profiles']])
  for (const image of images.own) assert.ok(image.digest === 'unpublished' || /^sha256:[0-9a-f]{64}$/.test(image.digest), `${image.name} records ${image.digest}`)
  const [mongo] = images.thirdParty
  assert.equal(mongo.service, 'mongo')
  assert.match(mongo.digest, /^sha256:[0-9a-f]{64}$/)
  assert.match(mongo.tag, /^7\.\d+\.\d+$/)
  assert.equal(mongo.licence, 'SSPL-1.0')
  assert.equal(thirdPartyReference(mongo), `mongo:${mongo.tag}@${mongo.digest}`)
})

test('the release set schema takes a digest or the word unpublished, and never a tag', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  addFormats(ajv)
  const validate = ajv.compile(JSON.parse(readFileSync(join(root, 'release/release-set.schema.json'), 'utf8')))
  assert.equal(validate(set), true, JSON.stringify(validate.errors))
  assert.equal(validate(published()), true, JSON.stringify(validate.errors))
  for (const digest of ['latest', '0.4.0-beta.13', 'sha256:abcd', '', null]) {
    const copy = structuredClone(set)
    copy.images.own[0].digest = digest
    assert.equal(validate(copy), false, `a set whose image digest is ${JSON.stringify(digest)} must be refused`)
  }
  const floating = structuredClone(set)
  delete floating.images.thirdParty[0].digest
  assert.equal(validate(floating), false, 'a third-party image without a digest must be refused')
  const slashed = structuredClone(set)
  slashed.images.registry = 'ghcr.io/bsv-blockchain/'
  assert.equal(validate(slashed), false, 'a registry with a trailing slash must be refused')
  // A set that predates the member still validates, as every archived set does.
  const earlier = structuredClone(set)
  delete earlier.images
  assert.equal(validate(earlier), true, JSON.stringify(validate.errors))
})

test('only a digest pins an image', () => {
  assert.equal(pinnedReference('ghcr.io/example', 'dpp-overlay', DIGEST_A), `ghcr.io/example/dpp-overlay@${DIGEST_A}`)
  for (const notADigest of ['latest', '0.4.0', 'unpublished', 'sha256:abcd', `${DIGEST_A}0`, undefined]) assert.throws(() => pinnedReference('ghcr.io/example', 'dpp-overlay', notADigest), /a tag is not a pin/)
  assert.throws(() => thirdPartyReference({ name: 'mongo', repository: 'mongo', tag: '7' }), /no registry digest/)
})

test('a preset file names each of our images through two variables that have no default', () => {
  for (const image of images.own) {
    const value = presetImageValue(image)
    assert.ok(value.startsWith('${DPP_IMAGE_REGISTRY:?'), value)
    assert.ok(value.includes(`/${image.name}@\${${image.digestVariable}:?`), value)
    // No default anywhere: ":-" would let the preset start with nothing set.
    assert.equal(value.includes(':-'), false)
    // A plain YAML scalar ends at a colon followed by a space, and a Compose message at a closing brace.
    assert.equal(/: /.test(value), false)
    assert.equal(value.split('}').length, 3)
  }
})

test('the env example carries empty digests until publication and the digests after it', () => {
  const before = renderEnvBlock(set)
  assert.match(before, new RegExp(`^DPP_IMAGE_REGISTRY=${images.registry}$`, 'm'))
  for (const image of images.own) {
    if (image.digest === 'unpublished') assert.match(before, new RegExp(`^${image.digestVariable}=$`, 'm'))
    else assert.match(before, new RegExp(`^${image.digestVariable}=${image.digest}$`, 'm'))
  }
  const after = renderEnvBlock(published())
  assert.match(after, new RegExp(`^OVERLAY_IMAGE_DIGEST=${DIGEST_A}$`, 'm'))
  assert.match(after, new RegExp(`^VALIDATOR_IMAGE_DIGEST=${DIGEST_B}$`, 'm'))
  assert.equal(after.includes('not published yet'), false)
  // The block is replaced between its markers and everything around it is kept.
  const text = `# before\n${before}\nAFTER=1\n`
  assert.equal(replaceEnvBlock(text, after), `# before\n${after}\nAFTER=1\n`)
  assert.throws(() => replaceEnvBlock('NO_MARKERS=1\n', after), /no "# >>> images" to "# <<< images" block/)
  // A registry is changed in one place, the set, and the rendering follows it.
  const moved = structuredClone(set)
  moved.images.registry = 'registry.example/dpp'
  assert.match(renderEnvBlock(moved), /^DPP_IMAGE_REGISTRY=registry\.example\/dpp$/m)
})

test('the repository\'s preset is the one the release set renders', () => {
  assert.deepEqual(failing(presetFindings(set, root)), [])
  const named = composeImages(readFileSync(join(root, 'deploy/compose.yml'), 'utf8'))
  assert.deepEqual(named.map((n) => n.service), ['mongo', 'overlay', 'validator'])
  for (const { value } of named) assert.ok(value.includes('@'), `${value} is not named by digest`)
})

test('a preset file that names an image by tag, floats MongoDB or builds is refused', () => {
  const dir = copyOfPreset()
  try {
    assert.deepEqual(failing(presetFindings(set, dir)), [])
    edit(dir, 'deploy/compose.yml', (text) => text.replace(/^( {4}image: ).*dpp-overlay@.*$/m, '$1${OVERLAY_IMAGE:-dpp-overlay:local}'))
    let sentences = failing(presetFindings(set, dir))
    assert.ok(sentences.some((s) => /deploy\/compose\.yml: service overlay runs .*which is not a pinned image/.test(s)), sentences.join('\n'))
    assert.ok(sentences.some((s) => /names no image by tag alone: /.test(s)), sentences.join('\n'))
    assert.ok(sentences.some((s) => /deploy\/compose\.yml runs dpp-overlay as its overlay service/.test(s)), sentences.join('\n'))
  } finally { rmSync(dir, { recursive: true, force: true }) }

  const floating = copyOfPreset()
  try {
    edit(floating, 'deploy/compose.second-operator.yml', (text) => text.replace(/^( {4}image: )mongo:.*$/m, '$1mongo:7'))
    const sentences = failing(presetFindings(set, floating))
    assert.ok(sentences.some((s) => /compose\.second-operator\.yml: service mongo-b runs mongo:7, which is not a pinned image/.test(s)), sentences.join('\n'))
  } finally { rmSync(floating, { recursive: true, force: true }) }

  // The file the application starter scaffolds is held to the same pin, so the two cannot drift apart.
  const starter = copyOfPreset()
  try {
    const named = composeImages(readFileSync(join(starter, STARTER_COMPOSE), 'utf8'))
    assert.deepEqual(named, composeImages(readFileSync(join(root, 'deploy/compose.yml'), 'utf8')).filter((n) => n.service === 'mongo'))
    edit(starter, STARTER_COMPOSE, (text) => text.replace(/^( {4}image: )mongo:.*$/m, '$1mongo:7'))
    let sentences = failing(presetFindings(set, starter))
    assert.ok(sentences.some((s) => /create-dpp-app\/template\/deploy\/compose\.yml: service mongo runs mongo:7, which is not the pin deploy\/compose\.yml uses for a mongo service/.test(s)), sentences.join('\n'))
    // Another digest under the same tag is a different image, and is refused as well.
    edit(starter, STARTER_COMPOSE, (text) => text.replace(/^( {4}image: )mongo:.*$/m, `$1mongo:7.0.48@${DIGEST_A}`))
    sentences = failing(presetFindings(set, starter))
    assert.ok(sentences.some((s) => /template\/deploy\/compose\.yml: service mongo runs mongo:7\.0\.48@sha256:/.test(s)), sentences.join('\n'))
    rmSync(join(starter, STARTER_COMPOSE))
    assert.ok(failing(presetFindings(set, starter)).some((s) => /template\/deploy\/compose\.yml does not exist/.test(s)))
  } finally { rmSync(starter, { recursive: true, force: true }) }

  const building = copyOfPreset()
  try {
    edit(building, 'deploy/compose.yml', (text) => text.replace('  overlay:\n', '  overlay:\n    build:\n      context: ..\n'))
    assert.ok(failing(presetFindings(set, building)).some((s) => /deploy\/compose\.yml builds nothing: it has a build section/.test(s)))
  } finally { rmSync(building, { recursive: true, force: true }) }
})

test('a build file that names a registry image, an env example edited by hand and a Dockerfile off its runtime are refused', () => {
  const remote = copyOfPreset()
  try {
    edit(remote, 'deploy/compose.build.yml', (text) => text.replace('${OVERLAY_LOCAL_IMAGE:-dpp-overlay:local}', 'ghcr.io/example/dpp-overlay:latest'))
    assert.ok(failing(presetFindings(set, remote)).some((s) => /compose\.build\.yml names only local tags/.test(s)))
  } finally { rmSync(remote, { recursive: true, force: true }) }

  const edited = copyOfPreset()
  try {
    edit(edited, ENV_EXAMPLE, (text) => text.replace(/^OVERLAY_IMAGE_DIGEST=.*$/m, `OVERLAY_IMAGE_DIGEST=${DIGEST_A}`))
    assert.ok(failing(presetFindings(set, edited)).some((s) => /operator\.env\.example carries the registry and digests .* but not as the set renders them/.test(s)))
  } finally { rmSync(edited, { recursive: true, force: true }) }

  const runtime = copyOfPreset()
  try {
    edit(runtime, images.own[0].dockerfile, (text) => text.replace(/^ARG BASE_IMAGE=.*$/m, 'ARG BASE_IMAGE=node:24-slim').replace('COPY LICENSE NOTICE PATENTS ./', 'COPY LICENSE ./'))
    const sentences = failing(presetFindings(set, runtime))
    assert.ok(sentences.some((s) => /Dockerfile builds on node:/.test(s)), sentences.join('\n'))
    assert.ok(sentences.some((s) => /copies LICENSE, NOTICE and PATENTS/.test(s)), sentences.join('\n'))
  } finally { rmSync(runtime, { recursive: true, force: true }) }
})

test('an image is labelled with the revision, the set and the version of its own package', () => {
  const source = { revision: 'c'.repeat(40), state: 'committed' }
  assert.deepEqual(buildArguments(set, images.own[0], source), { SOURCE_REVISION: source.revision, SOURCE_STATE: 'committed', RELEASE_SET: set.releaseSet, PACKAGE_VERSION: set.packages.find((p) => p.name === '@bsv/dpp-overlay').version })
  assert.equal(buildArguments(set, images.own[1], source).PACKAGE_VERSION, set.packages.find((p) => p.name === '@bsv/dpp-profiles').version)
  assert.throws(() => buildArguments(set, { ...images.own[0], package: '@bsv/absent' }, source), /does not carry/)
})

test('the image publication is planned from the npm plan and refuses anything else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dpp-image-plan-'))
  try {
    const setBytes = readFileSync(join(root, setPath))
    const tarball = Buffer.from('a tarball')
    const candidates = set.packages.map((p, index) => {
      const filename = `candidate-${index}.tgz`
      writeFileSync(join(dir, filename), tarball)
      return { name: p.name, version: p.version, filename, sha256: sha256(tarball), integrity: integrityOf(tarball), size: tarball.length }
    })
    const record = { releaseSet: set.releaseSet, releaseSetPath: setPath, releaseSetSha256: sha256(setBytes), sourceRevision: 'd'.repeat(40), sourceState: 'committed', candidates }
    const plan = { releaseSet: set.releaseSet, releaseSetSha256: record.releaseSetSha256, sourceRevision: record.sourceRevision, sourceState: 'committed' }
    if (images.own.every((image) => image.digest === 'unpublished')) {
      const planned = imagePublicationPlan({ record, set, setBytes, plan, candidateDir: dir })
      assert.equal(planned.registry, images.registry)
      assert.deepEqual(planned.images.map((image) => image.repository), images.own.map((image) => `${images.registry}/${image.name}`))
      for (const image of planned.images) {
        assert.deepEqual(image.platforms, ['linux/amd64', 'linux/arm64'])
        assert.equal(image.buildArguments.SOURCE_REVISION, record.sourceRevision)
        assert.equal(image.buildArguments.RELEASE_SET, set.releaseSet)
      }
      assert.throws(() => imagePublicationPlan({ record, set, setBytes, plan: { ...plan, sourceRevision: 'e'.repeat(40) }, candidateDir: dir }), /not the plan of these candidates/)
      assert.throws(() => imagePublicationPlan({ record, set, setBytes, plan: { ...plan, releaseSetSha256: 'f'.repeat(64) }, candidateDir: dir }), /not the plan of these candidates/)
    }
    // A set whose images are recorded as published is not published again.
    const again = published()
    const againBytes = Buffer.from(JSON.stringify(again, null, 2) + '\n')
    assert.throws(() => imagePublicationPlan({ record: { ...record, releaseSetSha256: sha256(againBytes) }, set: again, setBytes: againBytes, plan: { ...plan, releaseSetSha256: sha256(againBytes) }, candidateDir: dir }), /already recorded as published; a new publication is a new release set/)
    // Changed candidate bytes stop the plan before anything is built.
    writeFileSync(join(dir, candidates[0].filename), Buffer.from('other bytes'))
    assert.throws(() => imagePublicationPlan({ record, set, setBytes, plan, candidateDir: dir }), /SHA-256/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the image publication workflow runs only when started by hand and pushes only when told to', () => {
  const workflow = readFileSync(join(root, '.github/workflows/publish-images.yaml'), 'utf8')
  const triggers = /^on:\n((?: {2}.*\n)+)/m.exec(workflow)[1]
  assert.match(triggers, /^ {2}workflow_dispatch:$/m)
  assert.equal(/^ {2}(push|pull_request|schedule|release|workflow_run|workflow_call):/m.test(triggers), false, 'the workflow must start by hand only')
  assert.match(workflow, /dryRun:\n\s+description: .*\n\s+type: boolean\n\s+default: true/)
  // Every step that reaches the registry is behind the dry-run switch.
  for (const step of ['Sign in to the registry', 'Publish approved images', 'Check the published images']) {
    const at = workflow.indexOf(`- name: ${step}`)
    assert.ok(at > 0, step)
    assert.match(workflow.slice(at, at + 200), /if: \$\{\{ !inputs\.dryRun/, `${step} must not run on a dry run`)
  }
  assert.match(workflow, /publish-images\.mjs --execute --approval="\$APPROVED_PLAN"/)
  assert.equal(/secrets\./.test(workflow), false, 'the workflow names no secret')
  assert.equal(/docker push|--push\b/.test(workflow), false, 'only the publication script pushes, and by digest')
})
