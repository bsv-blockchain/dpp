#!/usr/bin/env node
/**
 * Prepare, rehearse or execute the publication of the release set's images.
 *
 *   node scripts/publish-images.mjs                                # read-only: print what would be built and where it would go
 *   node scripts/publish-images.mjs --rehearse [--base-image <ref>] # build every platform into local archives; push nothing
 *   node scripts/publish-images.mjs --execute --approval=<digest> [--base-image <ref>]
 *
 * The images are published under the same approval as the npm packages: the
 * SHA-256 of the reviewed publication plan (scripts/publish-candidates.mjs),
 * which binds the source revision, the release set file and every packed
 * archive. An image is built from that revision and labelled with it, so a
 * package and an image of one release name the same source.
 *
 * Execution builds each image for every platform the set names and pushes
 * it by digest: no tag is written or moved, and the multi-platform digest is
 * what the operator preset pins. It then reads each pushed image back from
 * the registry by that digest, holds its platforms and its labels to the
 * set, and writes release/image-digests.json. Nothing in the repository is
 * changed: recording the digests in the release set is a reviewed change
 * made afterwards with `node scripts/release-images.mjs pin`, which this
 * prints.
 *
 * Execution runs only in the image publication workflow,
 * .github/workflows/publish-images.yaml, from the approved committed
 * revision. It refuses a set whose images are already recorded as
 * published: a new publication is a new release set. Registry credentials
 * are the workflow's; this script takes none and stores none.
 *
 * It needs Docker with buildx, and for the platforms that are not the
 * runner's own, emulation. Results print one sentence per step.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { sha256, verifyCandidates, verifyRecordAgainstSet } from './lib/candidates.mjs'
import { DIGEST, UNPUBLISHED, buildArguments, docker, imagesOf, labelFindings, pinnedReference } from './lib/images.mjs'
import { assertApproval } from './lib/publication.mjs'

const { values } = parseArgs({ options: {
  execute: { type: 'boolean', default: false },
  rehearse: { type: 'boolean', default: false },
  approval: { type: 'string' },
  'base-image': { type: 'string' },
} })
if (values.execute && values.rehearse) throw new Error('choose execution or a rehearsal')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

/**
 * What would be published, from the candidate record and the plan beside
 * it: one entry per image with its repository, Dockerfile, platforms and
 * build arguments. Throws when the record, the plan or the set do not agree,
 * or when an image is already recorded as published.
 */
export function imagePublicationPlan({ record, set, setBytes, plan, candidateDir }) {
  const failures = [...verifyRecordAgainstSet(record, set, setBytes), ...verifyCandidates(record, candidateDir)].filter((f) => !f.ok)
  if (failures.length > 0) throw new Error(failures.map((f) => f.sentence).join('\n'))
  if (plan.releaseSet !== set.releaseSet || plan.releaseSetSha256 !== sha256(setBytes) || plan.sourceRevision !== record.sourceRevision) throw new Error('the publication plan is not the plan of these candidates and this release set; run node scripts/publish-candidates.mjs')
  const images = imagesOf(set)
  const published = images.own.filter((image) => image.digest !== UNPUBLISHED)
  if (published.length > 0) throw new Error(`${published.map((image) => image.name).join(' and ')} of ${set.releaseSet} ${published.length === 1 ? 'is' : 'are'} already recorded as published; a new publication is a new release set`)
  const source = { revision: record.sourceRevision, state: record.sourceState }
  return {
    releaseSet: set.releaseSet,
    releaseSetSha256: plan.releaseSetSha256,
    sourceRevision: record.sourceRevision,
    sourceState: record.sourceState,
    registry: images.registry,
    images: images.own.map((image) => ({ name: image.name, repository: `${images.registry}/${image.name}`, dockerfile: image.dockerfile, platforms: image.platforms, package: image.package, buildArguments: buildArguments(set, image, source) })),
  }
}

if (process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const record = JSON.parse(readFileSync(join(root, 'release/candidates.json'), 'utf8'))
  if (!/^release\/dpp-release-[a-z0-9-]+\.json$/.test(record.releaseSetPath)) throw new Error('invalid release set path')
  const setBytes = readFileSync(join(root, record.releaseSetPath))
  const set = JSON.parse(setBytes)
  if (!existsSync(join(root, 'release/publication-plan.json'))) throw new Error('there is no publication plan; run node scripts/publish-candidates.mjs first')
  const planBytes = readFileSync(join(root, 'release/publication-plan.json'))
  const plan = JSON.parse(planBytes)
  const planned = imagePublicationPlan({ record, set, setBytes, plan, candidateDir: join(root, 'release/candidates') })
  const planDigest = sha256(planBytes)
  console.log(JSON.stringify(planned, null, 2))
  console.log(`Publication plan SHA-256: ${planDigest}`)

  if (!values.execute && !values.rehearse) {
    console.log('Read-only preparation. Nothing was built and nothing was pushed. Approval is of the publication plan digest above, the one the npm packages are published under.')
    process.exit(0)
  }
  if (values.execute) {
    assertApproval(plan, values.approval, git(['rev-parse', 'HEAD']), git(['status', '--porcelain']) !== '')
    if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('images are published only by the image publication workflow, from the approved committed revision')
  }

  const scratch = mkdtempSync(join(tmpdir(), 'dpp-image-publication-'))
  const results = []
  try {
    for (const image of planned.images) {
      const metadata = join(scratch, `${image.name}.json`)
      const output = values.execute
        // By digest: the registry is given the bytes and no tag, so nothing that exists there is moved.
        ? `type=image,name=${image.repository},push-by-digest=true,name-canonical=true,push=true`
        : `type=oci,dest=${join(scratch, `${image.name}.oci.tar`)}`
      const args = ['buildx', 'build', '--platform', image.platforms.join(','), ...Object.entries(image.buildArguments).flatMap(([name, value]) => ['--build-arg', `${name}=${value}`]), ...(values['base-image'] == null ? [] : ['--build-arg', `BASE_IMAGE=${values['base-image']}`]), '-f', image.dockerfile, '--output', output, '--metadata-file', metadata, '.']
      console.log(`${values.execute ? 'building and pushing' : 'rehearsing'} ${image.repository} for ${image.platforms.join(' and ')}`)
      const built = docker(args, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] })
      if (built.status !== 0) throw new Error(`${image.name} did not build for ${image.platforms.join(' and ')}`)
      const digest = JSON.parse(readFileSync(metadata, 'utf8'))['containerimage.digest']
      if (!DIGEST.test(String(digest))) throw new Error(`${image.name}: the build reported no digest`)
      if (!values.execute) { results.push({ name: image.name, rehearsalDigest: digest, platforms: image.platforms }); console.log(`${image.name} builds for ${image.platforms.join(' and ')}. Rehearsal digest ${digest}: the digest of a local archive, not of a published image.`); continue }

      // Read back from the registry what was pushed, by its digest and nothing else.
      const reference = pinnedReference(planned.registry, image.name, digest)
      const inspected = docker(['buildx', 'imagetools', 'inspect', reference, '--format', '{{json .Manifest}}'])
      if (inspected.status !== 0) throw new Error(`${reference} cannot be read back from the registry: ${inspected.stderr.trim()}`)
      const manifests = (JSON.parse(inspected.stdout).manifests ?? []).filter((m) => m.platform != null && m.platform.os !== 'unknown').map((m) => ({ platform: `${m.platform.os}/${m.platform.architecture}`, digest: m.digest }))
      const lacking = image.platforms.filter((platform) => !manifests.some((m) => m.platform === platform))
      if (lacking.length > 0) throw new Error(`${reference} lacks ${lacking.join(' and ')}`)
      if (docker(['pull', reference], { stdio: ['ignore', 'inherit', 'inherit'] }).status !== 0) throw new Error(`${reference} cannot be pulled`)
      const ownImage = imagesOf(set).own.find((i) => i.name === image.name)
      const { findings } = labelFindings(set, ownImage, reference, { revision: planned.sourceRevision, state: 'committed' })
      for (const finding of findings) console.log(`${finding.ok ? 'Holds:' : 'FAILS:'} ${finding.sentence}`)
      if (findings.some((finding) => !finding.ok)) throw new Error(`${reference} is not labelled as the image of this release`)
      results.push({ name: image.name, reference, digest, platforms: image.platforms, manifests })
      console.log(`${image.name} is published at ${reference}.`)
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  const evidence = { releaseSet: planned.releaseSet, releaseSetSha256: planned.releaseSetSha256, sourceRevision: planned.sourceRevision, publicationPlanSha256: planDigest, registry: planned.registry, mode: values.execute ? 'published' : 'rehearsal', at: new Date().toISOString(), images: results }
  mkdirSync(join(root, 'release'), { recursive: true })
  writeFileSync(join(root, 'release', 'image-digests.json'), JSON.stringify(evidence, null, 2) + '\n')
  console.log(`Wrote release/image-digests.json (${evidence.mode}).`)
  if (values.execute) {
    console.log('Record the digests in the release set and render the preset from them, in a reviewed change:')
    console.log(`  node scripts/release-images.mjs pin ${results.map((r) => `${r.name}=${r.digest}`).join(' ')}`)
  } else {
    console.log('A rehearsal. Nothing was pushed, and the digests above pin nothing.')
  }
}
