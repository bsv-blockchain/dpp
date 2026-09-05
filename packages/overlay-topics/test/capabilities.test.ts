import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { STANDARD_VERSION } from '@bsv/dpp-core'
import {
  buildCapabilities,
  IMPLICIT_POLICY_VERSION,
  OVERLAY_HTTP_CONTRACT_VERSION,
  VSC_SEAL_MEDIA_TYPE,
  VSC_SEAL_REPRESENTATION,
  type CapabilityDocument,
} from '../src/capabilities.js'
import { startOverlayService, type RunningService } from '../src/index.js'
import { bodyOf, newNode, SERVER_ID } from './helpers.js'
import { A1, FEDERATION_OPERATORS, federatedChain, K1, K2, OPERATORS, policyChain, pub } from './policy-fixture.js'

/**
 * The capability document (spec/conformance.md section 4): built from the
 * constants and the configuration, validated against the schema the contract
 * publishes, and held to the published example wherever the example describes
 * this node. The example's contract version lags a bump on purpose (another
 * file owns it), so protocol ids are compared and versions come from the
 * constants.
 */

const root = new URL('../../../', import.meta.url)
const readJson = (relative: string): any => JSON.parse(readFileSync(new URL(relative, root), 'utf8'))
const schema = readJson('contracts/capabilities.schema.json')
const example = readJson('conformance/examples/capabilities-reference-node.json')
const baseline = readJson('conformance/baseline-native-1.json')

const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true })
addFormats(ajv)
const validate = ajv.compile(schema)

function expectValid(document: unknown): void {
  const ok = validate(document)
  expect(validate.errors ?? []).toEqual([])
  expect(ok).toBe(true)
}

const AT = new Date('2026-09-05T12:00:00Z')
const policy = { chain: policyChain(), operators: OPERATORS, versions: [1, 2], source: 'test' }

function reference(): CapabilityDocument {
  return buildCapabilities({
    serviceIdentityKey: SERVER_ID,
    anchorServiceKeys: [],
    ownerConsent: false,
    exportAvailable: false,
    networkOracleConfigured: false,
    at: AT,
  })
}

const ids = (entries: Array<{ id: string }>): string[] => entries.map((e) => e.id)

describe('the capability document', () => {
  it('validates against contracts/capabilities.schema.json', () => {
    expectValid(reference())
    expectValid(buildCapabilities({ publisherPolicy: policy, exportAvailable: true, networkOracleConfigured: true, at: AT }))
    expectValid(buildCapabilities({ serviceIdentityKey: SERVER_ID, ownerConsent: { authorities: [SERVER_ID] }, exportAvailable: true, networkOracleConfigured: false, at: AT }))
  })

  it('matches the published example wherever the example describes this node', () => {
    const document = reference()
    expect(Object.keys(document).sort()).toEqual(Object.keys(example).sort())
    expect(document.implementation.name).toBe(example.implementation.name)
    expect(document.implementation.baselineId).toBe(example.implementation.baselineId)
    expect(document.implementation.version).toBe(readJson('packages/overlay-topics/package.json').version)
    expect(document.roles).toEqual(example.roles)
    expect(ids(document.protocols)).toEqual(ids(example.protocols))
    expect(document.profiles.map((p) => [p.id, p.version, p.kind])).toEqual(example.profiles.map((p: any) => [p.id, p.version, p.kind]))
    expect(document.representations).toEqual(example.representations)
    expect(document.proofSuites).toEqual(example.proofSuites)
    expect(document.anchorFormats).toEqual(example.anchorFormats)
    expect(document.topics).toEqual(example.topics)
    expect(document.services).toEqual(example.services)
    expect(Object.keys(document.publisherPolicy).sort()).toEqual(Object.keys(example.publisherPolicy).sort())
    expect(document.publisherPolicy.policyVersion).toBe(example.publisherPolicy.policyVersion)
    expect(document.publisherPolicy.ownerConsent).toBe(example.publisherPolicy.ownerConsent)
    expect(document.synchronisation).toEqual(example.synchronisation)
    for (const [key, value] of Object.entries(example.limits)) expect(document.limits[key]).toBe(value)
    expect(ids(document.unsupported)).toEqual(expect.arrayContaining(ids(example.unsupported)))
  })

  it('takes the wire versions from the constants, and the contract version from the contract', () => {
    const document = reference()
    expect(document.protocols).toContainEqual({ id: 'dpp-record', version: STANDARD_VERSION })
    expect(document.protocols).toContainEqual({ id: 'bsv-attestation-anchor', version: '1' })
    expect(document.protocols).toContainEqual({ id: 'overlay-http', version: OVERLAY_HTTP_CONTRACT_VERSION })
    const yaml = readFileSync(new URL('contracts/overlay.yaml', root), 'utf8')
    const declared = /^info:\n(?:  [^\n]*\n)*?  version: (\S+)$/m.exec(yaml)?.[1]
    expect(declared).toBe(OVERLAY_HTTP_CONTRACT_VERSION)
    // The seal representation is repeated here because its rules live in a
    // package this one does not depend on; the baseline is where it is pinned.
    const seal = baseline.representations.find((r: any) => r.id === VSC_SEAL_REPRESENTATION)
    expect(seal?.mediaType).toBe(VSC_SEAL_MEDIA_TYPE)
    expect(baseline.refused).toContain('uora-anchor-v2')
    expect(document.anchorFormats.filter((f) => f.status === 'refused').map((f) => f.prefix)).toEqual(baseline.refused)
  })

  it('reports the implicit single-key policy when no chain is configured', () => {
    const document = reference()
    expect(document.publisherPolicy).toEqual({
      policyVersion: IMPLICIT_POLICY_VERSION,
      publisherKeys: [SERVER_ID],
      anchoringServices: [],
      ownerConsent: 'not-selected',
      transferAuthorities: [],
    })
    expect(ids(document.unsupported)).toContain('publisher-key-rotation')
    expect(document.profiles[0]).toMatchObject({ id: 'single-operator', version: '1', kind: 'operator' })
  })

  it('reports the keys active now under a policy, version by version', () => {
    const before = buildCapabilities({ publisherPolicy: policy, exportAvailable: true, networkOracleConfigured: true, at: new Date('2026-03-01T00:00:00Z') })
    expect(before.publisherPolicy).toMatchObject({ policyVersion: '1', publisherKeys: [pub(K1)], anchoringServices: [] })
    const after = buildCapabilities({ publisherPolicy: policy, exportAvailable: true, networkOracleConfigured: true, at: new Date('2026-07-01T00:00:00Z') })
    expect(after.publisherPolicy).toMatchObject({ policyVersion: '2', publisherKeys: [pub(K2)], anchoringServices: [pub(A1)] })
    expect(ids(after.unsupported)).not.toContain('publisher-key-rotation')
    expect(after.profiles[0].options).toEqual({ discovery: 'none', gasp: false, operators: Object.keys(OPERATORS) })
    expect(after.synchronisation.profile).toBe('single-operator@1')
  })

  it('states the owner-signed transfer and its authorities when selected', () => {
    const document = buildCapabilities({ serviceIdentityKey: SERVER_ID, ownerConsent: { authorities: [SERVER_ID] }, exportAvailable: false, networkOracleConfigured: false, at: AT })
    expect(document.publisherPolicy.ownerConsent).toBe('required')
    expect(document.publisherPolicy.transferAuthorities).toEqual([SERVER_ID])
  })

  it('says whether the export and the retraction network check are available', () => {
    const off = reference()
    expect(off.limits.evidencePackageExport).toBe('unavailable')
    expect(ids(off.unsupported)).toEqual(expect.arrayContaining(['evidence-package-export', 'retraction-network-check']))
    const on = buildCapabilities({ serviceIdentityKey: SERVER_ID, exportAvailable: true, networkOracleConfigured: true, at: AT })
    expect(on.limits.evidencePackageExport).toBe('available')
    expect(ids(on.unsupported)).not.toContain('evidence-package-export')
    expect(ids(on.unsupported)).not.toContain('retraction-network-check')
    expect(on.limits).toMatchObject({ maxLookupResults: 500, defaultHistoryPageSize: 100, maxHistoryPageSize: 500, historySnapshotTtlSeconds: 600 })
  })
})

describe('synchronisation in the capability document', () => {
  const federation = { chain: [federatedChain().genesis], operators: FEDERATION_OPERATORS, versions: [1], source: 'test' }
  const peers = ['http://127.0.0.1:18081', 'https://operator-a.example']

  it('says none without peers, static-peers with them, and reports the interval', () => {
    const off = buildCapabilities({ publisherPolicy: federation, exportAvailable: false, networkOracleConfigured: false, at: AT })
    expect(off.synchronisation).toEqual({ profile: 'single-operator@1', discovery: 'none', gasp: false, peers: [] })
    expect(off.limits.syncIntervalMs).toBeUndefined()
    expect(ids(off.unsupported)).toContain('gasp-synchronisation')
    const on = buildCapabilities({ publisherPolicy: federation, syncPeers: peers, syncIntervalMs: 30_000, exportAvailable: false, networkOracleConfigured: false, at: AT })
    expectValid(on)
    expect(on.synchronisation).toEqual({ profile: 'federated-operators@1', discovery: 'static-peers', gasp: true, peers })
    expect(on.limits.syncIntervalMs).toBe(30_000)
    expect(ids(on.unsupported)).not.toContain('gasp-synchronisation')
    expect(ids(on.unsupported)).toContain('ship-slap-discovery')
    const defaulted = buildCapabilities({ serviceIdentityKey: SERVER_ID, syncPeers: peers, exportAvailable: false, networkOracleConfigured: false, at: AT })
    expect(defaulted.limits.syncIntervalMs).toBe(60_000)
  })

  it('claims federated-operators@1 only with both a two-operator policy and peers', () => {
    const single = { chain: policyChain(), operators: OPERATORS, versions: [1, 2], source: 'test' }
    const singleWithPeers = buildCapabilities({ publisherPolicy: single, syncPeers: peers, exportAvailable: false, networkOracleConfigured: false, at: AT })
    expect(singleWithPeers.profiles[0]).toMatchObject({ id: 'single-operator', version: '1', options: { discovery: 'static-peers', gasp: true, peers } })
    expect(singleWithPeers.synchronisation.profile).toBe('single-operator@1')
    const federatedNoPeers = buildCapabilities({ publisherPolicy: federation, exportAvailable: false, networkOracleConfigured: false, at: AT })
    expect(federatedNoPeers.profiles[0].id).toBe('single-operator')
    const federated = buildCapabilities({ publisherPolicy: federation, syncPeers: peers, exportAvailable: false, networkOracleConfigured: false, at: AT })
    expect(federated.profiles[0]).toMatchObject({ id: 'federated-operators', version: '1', kind: 'operator', options: { discovery: 'static-peers', gasp: true, operators: Object.keys(FEDERATION_OPERATORS), peers, syncIntervalMs: 60_000 } })
    const noPolicy = buildCapabilities({ serviceIdentityKey: SERVER_ID, syncPeers: peers, exportAvailable: false, networkOracleConfigured: false, at: AT })
    expect(noPolicy.profiles[0].id).toBe('single-operator')
  })
})

describe('the anchor rail in the capability document', () => {
  it('names an unrestricted anchor rail, so an empty list never reads as nothing admitted', () => {
    expect(ids(reference().unsupported)).toContain('anchoring-service-restriction')
    const listed = buildCapabilities({ serviceIdentityKey: SERVER_ID, anchorServiceKeys: [pub(A1)], exportAvailable: false, networkOracleConfigured: false, at: AT })
    expect(ids(listed.unsupported)).not.toContain('anchoring-service-restriction')
    expect(listed.publisherPolicy.anchoringServices).toEqual([pub(A1)])
    // Under the policy before its rotation no anchoring service is active:
    // the list is empty because nothing is admitted, and the entry is absent.
    const covered = buildCapabilities({ publisherPolicy: policy, exportAvailable: false, networkOracleConfigured: false, at: new Date('2026-03-01T00:00:00Z') })
    expect(covered.publisherPolicy.anchoringServices).toEqual([])
    expect(ids(covered.unsupported)).not.toContain('anchoring-service-restriction')
    // A policy that leaves the anchor topic to the static list, and no list: unrestricted again.
    const statesOnly = { chain: policyChain({ topics: ['tm_dpp'] }), operators: OPERATORS, versions: [1, 2], source: 'test' }
    const uncovered = buildCapabilities({ publisherPolicy: statesOnly, exportAvailable: false, networkOracleConfigured: false, at: AT })
    expect(ids(uncovered.unsupported)).toContain('anchoring-service-restriction')
  })

  it('states the export and synchronisation caps', () => {
    expect(reference().limits.maxEvidencePackageStates).toBe(500)
    expect(reference().limits.maxSyncPageSize).toBe(500)
  })
})

describe('the published example', () => {
  it('is exactly what the reference configuration serves: one identity key, no anchoring services, no policy, no export, no network oracle', () => {
    // conformance/examples/capabilities-reference-node.json is generated from this
    // call and held equal here, so the example the ledger validates never lags
    // the node. Regenerate it from the same input when the node changes.
    const document = buildCapabilities({
      serviceIdentityKey: '02466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27',
      anchorServiceKeys: [],
      ownerConsent: false,
      exportAvailable: false,
      networkOracleConfigured: false,
      at: new Date('2026-09-05T12:00:00Z'),
    })
    expect(document).toEqual(example)
  })
})

describe('GET /capabilities', () => {
  let running: RunningService | undefined
  afterEach(async () => {
    await running?.close()
    running = undefined
  })

  it('serves the document for the running configuration, valid against the schema', async () => {
    const node = newNode()
    running = await startOverlayService(node.engine, { port: 0, host: '127.0.0.1', components: node.components })
    const response = await fetch(`http://127.0.0.1:${running.port}/capabilities`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    const document = await bodyOf(response)
    expectValid(document)
    expect(document.publisherPolicy.publisherKeys).toEqual([SERVER_ID])
    expect(ids(document.unsupported)).toContain('evidence-package-export')
  })

  it('lists the export as available once a signing key is configured', async () => {
    const node = newNode()
    running = await startOverlayService(node.engine, { port: 0, host: '127.0.0.1', components: node.components, exportSigningKey: '77'.repeat(32) })
    const document = await bodyOf(await fetch(`http://127.0.0.1:${running.port}/capabilities`))
    expectValid(document)
    expect(document.limits.evidencePackageExport).toBe('available')
    expect(ids(document.unsupported)).not.toContain('evidence-package-export')
  })
})
