// An index in this process for development and tests: the real topic
// manager, lookup service and HTTP host the reference deployment runs, over
// in-memory storage, on a loopback port, with a publisher policy naming the
// platform wallet and the managed-custody profile selected. Its header
// checks are off, so it takes the made-up proofs a dry run pushes and claims
// no inclusion. Production runs the reference index as its own service
// (a separate operator project or an existing provider) and never this.
//
// The HTTP host is the package's ./server export. Imported, it is a library
// and starts nothing by itself.
import { PrivateKey } from '@bsv/sdk'
import { policySigningPreimage, type PublisherPolicy } from '@bsv/dpp-protocol'
import type { RegistrationSettings } from '@bsv/dpp-overlay'
import type { Network } from './config.js'

export interface DevIndex {
  url: string
  submitToken: string
  callbackToken: string
  /** The development operator's identity key, which signs the policy and, with registration on, each appended version. */
  operatorKey: string
  /** Under approval, what the operator's command line would do: append the version and mark the key approved. */
  approve?: (publisherKey: string) => Promise<void>
  close: () => Promise<void>
}

export interface DevIndexOptions {
  /** The key the genesis names as the state publisher. */
  publisherKey: string
  /** What the index reports on GET /health, so it agrees with the app's NETWORK. */
  network: Network
  /** Run POST /register in this mode, for the go-live test; off by default. */
  registration?: 'open' | 'approval'
  /** The custody profile the index declares; managed custody unless the test says otherwise. */
  custody?: 'managed-custody@2' | 'record-model-baseline@2'
}

export async function startDevIndex(options: DevIndexOptions): Promise<DevIndex> {
  const { publisherKey, network } = options
  const overlay = await import('@bsv/overlay')
  const topics = await import('@bsv/dpp-overlay')
  const host = await import('@bsv/dpp-overlay/server')

  // The publisher key policy of the @bsv/dpp-overlay README: one operator signs a genesis naming the platform wallet as a state publisher.
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

  const managedAcceptance = (options.custody ?? 'managed-custody@2') === 'managed-custody@2'
  const records = new topics.InMemoryDppStorage()
  const storage = new topics.InMemoryOverlayStorage()
  const lookupServices = { ls_dpp: new topics.DppLookupService(records) }
  const silent = { ...console, log() {}, info() {}, warn() {}, error() {} }
  const engine = new overlay.Engine(
    { tm_dpp: new topics.DppTopicManager('', { publisherPolicy: policy.chain, managedAcceptance, admittedOutputs: storage }) },
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
  // With registration on, a registering key's tokens come from this store and
  // its policy version from the registration store; the address the request
  // must name is this index's own, known only once the socket is bound, so the
  // settings are completed after the start.
  const publisherTokens = options.registration == null ? undefined : new topics.InMemoryPublisherTokenStore()
  const registration: RegistrationSettings | undefined =
    options.registration == null
      ? undefined
      : { mode: options.registration, signingKey: operatorKey, indexUrl: 'http://127.0.0.1', custodyProfile: topics.declaredCustodyProfile(managedAcceptance), store: new topics.InMemoryRegistrationStore(), rateLimitPerHour: 1_000, trustProxy: false }
  const service = await host.startOverlayService(engine, {
    port: 0,
    host: '127.0.0.1',
    network,
    submitToken,
    proofToken: callbackToken,
    components: { records, engineStorage: storage, lookupServices, publisherPolicy: policy, managedAcceptance, ...(publisherTokens == null ? {} : { publisherTokens }), ...(registration == null ? {} : { registration }) },
  })
  const url = `http://127.0.0.1:${service.port}`
  if (registration != null) registration.indexUrl = url
  const approve = registration == null
    ? undefined
    : async (publisherKey: string): Promise<void> => {
        const record = await registration.store.registration(publisherKey)
        if (record == null || record.status !== 'pending') throw new Error(`${publisherKey} is not pending`)
        const version = await topics.appendRegistrationVersion(policy, registration.store, operatorKey, { add: { key: publisherKey, role: 'state-publisher' } }, new Date())
        await registration.store.saveRegistration({ ...record, status: 'approved', policyVersion: version.policyVersion, decidedAt: new Date().toISOString() })
      }
  return { url, submitToken, callbackToken, operatorKey: operatorKey.toPublicKey().toString(), ...(approve == null ? {} : { approve }), close: service.close }
}
