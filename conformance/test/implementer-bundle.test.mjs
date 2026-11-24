import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { currentReleaseSet, sha256 } from '../../scripts/lib/candidates.mjs'
import { markdownTargets } from '../../scripts/lib/markdown-links.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('the extracted implementer archive identifies its source bytes, licences and local Markdown targets', (t) => {
  const output = mkdtempSync(join(tmpdir(), 'dpp-implementer-bundle-'))
  const extracted = mkdtempSync(join(tmpdir(), 'dpp-extracted-bundle-'))
  t.after(() => { for (const dir of [output, extracted]) rmSync(dir, { recursive: true, force: true }) })
  const selection = currentReleaseSet(root)
  execFileSync(process.execPath, ['scripts/implementer-bundle.mjs', selection.path, output], { cwd: root })
  const { releaseSet } = JSON.parse(readFileSync(join(root, selection.path)))
  const archive = join(output, `dpp-implementer-bundle-${releaseSet}.tgz`)
  execFileSync('tar', ['xzf', archive, '-C', extracted])
  const bundle = join(extracted, 'implementer-bundle')
  const read = (path) => readFileSync(join(bundle, path))
  const manifest = JSON.parse(read('bundle-manifest.json'))
  // libarchive otherwise hides AppleDouble members when listing a macOS archive.
  const isBsdtar = execFileSync('tar', ['--version'], { encoding: 'utf8' }).includes('bsdtar')
  const listingFlags = isBsdtar ? ['--options', '!mac-ext'] : []
  const members = execFileSync('tar', [...listingFlags, '-tzf', archive], { encoding: 'utf8' })
    .trimEnd().split('\n').filter(name => !name.endsWith('/')).sort()
  const expected = [...Object.keys(manifest.files), 'bundle-manifest.json']
    .map(name => 'implementer-bundle/' + name).sort()
  assert.deepEqual(members, expected)
  for (const [path, item] of Object.entries(manifest.files)) {
    const bytes = read(path)
    assert.equal(bytes.length, item.bytes, path)
    assert.equal(sha256(bytes), item.sha256, path)
    assert.doesNotMatch(path, /(^|\/)(?:src|test|node_modules)\/|\.(?:ts|js|mjs)$/)
    if (!path.endsWith('.md')) continue
    for (const target of markdownTargets(bytes.toString())) {
      if (/^(?:https?:|mailto:|#)/i.test(target)) continue
      const destination = resolve(bundle, dirname(path), decodeURIComponent(target.split('#')[0]))
      assert.ok(!relative(bundle, destination).startsWith('..' + sep) && existsSync(destination), `${path} links to ${target}`)
    }
  }
  const schema = 'packages/dpp-profiles/schemas/passport-projection.schema.json'
  const guide = read('docs/implement/README.md').toString()
  const guideTargets = markdownTargets(guide)
  assert.ok(guideTargets.includes('../../fixtures/README.md'))
  assert.ok(guideTargets.includes('../../profiles/frozen.json'))
  assert.ok(guideTargets.includes('../../conformance/manifest.json'))
  const historical = 'https://github.com/bsv-blockchain/dpp/blob/c678cf9281168179d16d599e5fdb3846ddbbaf61/fixtures/README.md'
  assert.ok(guideTargets.includes(historical))
  assert.match(read('fixtures/README.md').toString(), /anchor-supplied-bytes-digest-mismatch/)
  assert.ok(markdownTargets(read('docs/implement/reporting.md').toString()).includes('../../GOVERNANCE.md#conformance-reporting'))
  const registry = markdownTargets(read('docs/implement/roles/registry.md').toString())
  assert.ok(registry.includes('../../../contracts/registry.yaml'))
  assert.ok(!registry.some(target => target.includes('registry.yaml#L')))
  assert.ok(registry.some(target => /^https:\/\/github\.com\/bsv-blockchain\/dpp\/blob\/[a-f0-9]{40}\/examples\/verify-attestation-anchor\.mjs$/.test(target)))
  assert.deepEqual(read('docs/reference/parked/python-reader/README.md'), readFileSync(join(root, 'docs/reference/parked/python-reader/README.md')))
  for (const path of Object.keys(manifest.files).filter(file => /^(?:spec|fixtures|contracts)\//.test(file))) {
    assert.deepEqual(read(path), readFileSync(join(root, path)), path)
  }
  const sources = ['LICENSE', 'NOTICE', 'PATENTS', 'SECURITY.md', 'GOVERNANCE.md', 'fixtures/README.md', 'spec/conformance.md', 'spec/vsc-profile.md', 'packages/dpp-credentials/README.md', 'packages/dpp-credentials/LICENSE', schema]
  for (const path of sources) assert.deepEqual(read(path), readFileSync(join(root, path)), path)
  assert.deepEqual(read(schema), read('profiles/schemas/passport-projection.schema.json'))
  for (const sector of ['eu-battery@1', 'eu-textile@1']) {
    const folder = `profiles/bindings/${sector}/`
    const binding = JSON.parse(read(folder + 'binding.v2.json'))
    for (const artefact of binding.artefacts) assert.equal(sha256(read(folder + artefact.path)), artefact.sha256)
    for (const notice of binding.source.notices) assert.deepEqual(read(folder + notice), readFileSync(join(root, 'packages/dpp-profiles/bindings', sector, notice)))
    const vectors = JSON.parse(read(folder + 'vectors/subject-class-v2.json'))
    assert.equal(vectors.profile, binding.profile)
    for (const fixture of new Set([vectors.from, ...vectors.cases.flatMap((entry) => [entry.include, entry.passportOf]).filter(Boolean)])) {
      assert.deepEqual(read(folder + fixture), readFileSync(join(root, 'packages/dpp-profiles/test/fixtures/sector-bindings', sector, fixture)))
    }
  }
})
