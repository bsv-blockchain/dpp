// The protocol package owns the passport record, the generic attestation
// anchor, signatures, evidence and the slots a verifier is handed. It reads
// no event format and no product identifier scheme: the EPCIS lifecycle claim
// lives in `@bsv/dpp-credentials` and reaches a verifier through the
// `credentialVerifier` slot. Both properties are easy to lose by one
// convenient import, so both are held here.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageRoot = join(import.meta.dirname, '..')
const src = join(packageRoot, 'src')

/** Every module the entry point reaches, by following its imports, and every package or built-in any of them names. */
function importGraph(entry: string): { files: string[]; external: string[] } {
  const files = new Set<string>()
  const external = new Set<string>()
  const visit = (file: string): void => {
    if (files.has(file)) return
    files.add(file)
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)) {
      const specifier = (match[1] ?? match[2] ?? match[3])!
      if (specifier.startsWith('.')) visit(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')))
      else external.add(specifier)
    }
  }
  visit(entry)
  return { files: [...files].map((f) => f.slice(src.length + 1)).sort(), external: [...external].sort() }
}

/** Source text with its comments removed, so that only what runs or is declared is searched. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
}

/** What marks EPCIS or GS1 logic: the standards by name, their identifier schemes and their vocabularies. */
const EVENT_FORMAT = /epcis|gs1|gtin|sscc|sgln|\bcbv\b|urn:epc|digital\s*link|check\s*digit/i

describe('the protocol package reads no event format', () => {
  it('exports no name of the EPCIS lifecycle claim, its canonical JSON or its GS1 helpers', async () => {
    const entry = await import('../src/index.js')
    const names = Object.keys(entry)
    expect(names.length).toBeGreaterThan(100)
    expect(names.filter((name) => /epcis|gs1|jcs|digitallink/i.test(name))).toEqual([])
    for (const name of [
      'EPCIS_LIFECYCLE_CLAIM_FORMAT', 'EPCIS_LIFECYCLE_REPRESENTATION', 'EPCIS_LIFECYCLE_PROTOCOL', 'EPCIS_LIFECYCLE_KEY_ID',
      'buildEpcisLifecycleClaim', 'signEpcisLifecycleClaim', 'parseEpcisLifecycleClaim', 'verifyEpcisLifecycleClaim', 'assertEpcisLifecycleClaim',
      'epcisLifecycleSigningBytes', 'epcisLifecycleClaimBytes', 'epcisLifecycleClaimDigest', 'epcisLifecycleClaimId', 'epcisLifecycleClaimRelation',
      'epcisLifecycleAnchorMetadata', 'buildEpcisLifecycleAnchors', 'epcisLifecycleCredentialVerifierFor', 'epcisLifecycleReportEntries', 'epcisIdentifierGranularity',
      'JcsError', 'jcsString', 'jcsBytes', 'parseStrictJcsJson', 'parseCanonicalJcs',
      'parseStrictJson', 'gs1CheckDigit', 'epcUriToDigitalLink', 'constrainedCanonicalDigitalLink', 'canonicalEpcisIdentifier',
      'epcisEventHashId', 'verifyEpcisEventCredential',
    ]) expect(name in entry, name).toBe(false)
    // The native claim and the generic anchor are still here: the slot is filled from outside, not emptied.
    for (const name of ['verifyLifecycleClaim', 'buildAttestationAnchor', 'decodeAttestationAnchor', 'verifyPassportEvidence']) expect(name in entry, name).toBe(true)
  })

  it('holds every source file within reach of the entry point, and reaches @bsv/sdk and nothing else', () => {
    const graph = importGraph(join(src, 'index.ts'))
    expect(graph.external).toEqual(['@bsv/sdk'])
    // No module sits beside the entry point unexported, where a parked or shared helper could hide.
    expect(graph.files).toEqual(readdirSync(src).sort())
    expect(graph.files).toEqual([
      'acceptance.ts', 'anchor.ts', 'attestation.ts', 'blob.ts', 'canonical.ts', 'canonicalJson.ts', 'codec.ts', 'constants.ts', 'did.ts',
      'evidence.ts', 'evidencePackage.ts', 'index.ts', 'nativeAnchorBinding.ts', 'owner.ts', 'publisherPolicy.ts', 'registration.ts', 'signatures.ts', 'transition.ts',
      'types.ts', 'verifyChain.ts',
    ])
  })

  it('carries no EPCIS or GS1 logic: outside comments, no source file names either', () => {
    for (const file of readdirSync(src)) {
      const lines = code(readFileSync(join(src, file), 'utf8')).split('\n').filter((line) => EVENT_FORMAT.test(line))
      expect(lines, file).toEqual([])
    }
    // The search can see such logic: the claim module, where it now lives, is full of it.
    const claim = join(packageRoot, '..', 'dpp-credentials', 'src', 'epcis-lifecycle', 'claim.ts')
    expect(existsSync(claim)).toBe(true)
    expect(code(readFileSync(claim, 'utf8')).split('\n').filter((line) => EVENT_FORMAT.test(line)).length).toBeGreaterThan(50)
  })

  it('names EPCIS and GS1 only in the three comment lines it had before the claim was written, and in the one line that deprecates the native signer in favour of the claim', () => {
    const mentions: Record<string, number> = {}
    for (const file of readdirSync(src)) {
      const count = readFileSync(join(src, file), 'utf8').split('\n').filter((line) => /epcis|gs1/i.test(line)).length
      if (count > 0) mentions[file] = count
    }
    expect(mentions).toEqual({ 'attestation.ts': 1, 'canonicalJson.ts': 2, 'types.ts': 1 })
  })

  it('depends on @bsv/sdk alone and is depended on by the credentials package, never the reverse', () => {
    const own = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>
    expect(Object.keys(own.dependencies ?? {})).toEqual(['@bsv/sdk'])
    for (const list of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) expect(own[list]?.['@bsv/dpp-credentials'], list).toBeUndefined()
    const credentials = JSON.parse(readFileSync(join(packageRoot, '..', 'dpp-credentials', 'package.json'), 'utf8')) as { version: string; dependencies: Record<string, string>; exports: Record<string, unknown> }
    expect(credentials.dependencies['@bsv/dpp-protocol']).toBe(own.version)
    expect(credentials.dependencies['@bsv/sdk']).toBe(own.dependencies!['@bsv/sdk'])
    expect(credentials.exports['./epcis-lifecycle']).toEqual({ types: './dist/epcis-lifecycle.d.ts', default: './dist/epcis-lifecycle.js' })
  })
})
