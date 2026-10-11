// An index in this process for development and tests: the real topic
// manager, lookup service and HTTP host the reference deployment runs, over
// in-memory storage, on a loopback port, with a publisher policy naming the
// platform wallet and the managed-custody profile selected. Its header
// checks are off, so it takes the made-up proofs a dry run pushes and claims
// no inclusion. Production runs the reference index as its own service
// (a separate operator project or an existing provider) and never this.
//
// The HTTP host is not an export of @bsv/dpp-overlay-topics (its entry point
// is the library), so it is loaded by file URL beside the library's own
// entry. Imported, the host is a library and starts nothing by itself.
import { PrivateKey } from '@bsv/sdk'
import { policySigningPreimage, type PublisherPolicy } from '@bsv/dpp-protocol'

export interface DevIndex {
  url: string
  submitToken: string
  callbackToken: string
  close: () => Promise<void>
}

export async function startDevIndex(publisherKey: string): Promise<DevIndex> {
  const overlay = await import('@bsv/overlay')
  const topics = await import('@bsv/dpp-overlay-topics')
  const host = (await import(new URL('./index.js', import.meta.resolve('@bsv/dpp-overlay-topics')).href)) as {
    startOverlayService: (engine: unknown, options: Record<string, unknown>) => Promise<{ port: number; close: () => Promise<void> }>
  }

  // The policy chain of spec/services.md section 1: one operator signs a genesis naming the platform wallet as a state publisher.
  const operatorKey = PrivateKey.fromHex('44'.repeat(32))
  const operator = 'Development operator'
  const genesis: PublisherPolicy = {
    policyFormat: 'dpp-publisher-policy@1',
    policyVersion: 1,
    scope: { operatorProfile: 'single-operator@1', operators: [operator], topics: ['tm_dpp'] },
    issuedAt: '2026-01-01T00:00:00Z',
    publishers: [{ key: publisherKey, role: 'state-publisher', activeFrom: '2026-01-01T00:00:00Z' }],
    authorisation: { kind: 'genesis', signer: operatorKey.toPublicKey().toString(), suite: 'bsv-ecdsa-der', value: '' },
  }
  genesis.authorisation.value = operatorKey.sign(policySigningPreimage(genesis)).toDER('hex') as string
  const policy = topics.loadPublisherPolicyJson(JSON.stringify([genesis]), { [operator]: operatorKey.toPublicKey().toString() })

  const records = new topics.InMemoryDppStorage()
  const storage = new topics.InMemoryOverlayStorage()
  const lookupServices = { ls_dpp: new topics.DppLookupService(records) }
  const silent = { ...console, log() {}, info() {}, warn() {}, error() {} }
  const engine = new overlay.Engine(
    { tm_dpp: new topics.DppTopicManager('', { publisherPolicy: policy.chain, managedAcceptance: true, admittedOutputs: storage }) },
    lookupServices,
    storage,
    'scripts only',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { tm_dpp: false },
    false,
    '[index] ',
    false,
    undefined,
    silent
  )
  const submitToken = 'dev-submit-token'
  const callbackToken = 'dev-callback-token'
  const service = await host.startOverlayService(engine, {
    port: 0,
    host: '127.0.0.1',
    submitToken,
    proofToken: callbackToken,
    components: { records, engineStorage: storage, lookupServices, publisherPolicy: policy, managedAcceptance: true },
  })
  return { url: `http://127.0.0.1:${service.port}`, submitToken, callbackToken, close: service.close }
}
