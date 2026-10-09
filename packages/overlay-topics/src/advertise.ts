/**
 * Advertising this index (`spec/services.md` section 1: public overlays
 * SHOULD advertise through SHIP and SLAP): with `ADVERTISE=1`, the index
 * finds the SHIP and SLAP adverts its advertiser key already has for
 * `PUBLIC_URL`, and creates the missing ones, one 1-satoshi token per topic
 * and lookup service, in one transaction its own wallet funds. Other indexes
 * with `SYNC_DISCOVERY=ship` then find it through the trackers (discovery.ts).
 *
 * The tokens are the SDK's: `OverlayAdminTokenTemplate` builds each one,
 * signed by the advertiser's identity key and locked to that key's discovery
 * child, and `TopicBroadcaster` hands the transaction to the hosts of
 * `tm_ship` and `tm_slap`. The wallet is the one thing the SDK does not
 * carry: `advertiserWallet` builds it from `@bsv/wallet-toolbox-client`, an
 * optional peer dependency installed only by an index that advertises, from
 * the advertiser's private key and a wallet storage URL, as the upstream
 * discovery services do. Any BRC-100 wallet can be passed instead.
 *
 * Nothing here revokes an advert. An index that moves host or stops leaves
 * its old adverts in place until its operator spends them; a peer that cannot
 * read the old address backs off (discovery.ts), so a stale advert costs a
 * failed request a round at most.
 */
import {
  completeBoundAction,
  KeyDeriver,
  LookupResolver,
  OverlayAdminTokenTemplate,
  PrivateKey,
  TopicBroadcaster,
  Transaction,
  type LookupAnswer,
  type WalletInterface,
} from '@bsv/sdk'
import { stripTrailingSlashes } from './sync.js'

export interface AdvertisingSettings {
  /** ADVERTISE=1. */
  enabled: boolean
  /** PUBLIC_URL, the https address the adverts name. */
  domain?: string
  /** ADVERTISER_PRIVATE_KEY, hex: the advertiser's root key, not the operator, export or publisher key. */
  privateKey?: string
  /** ADVERTISER_STORAGE_URL: the wallet storage server holding the advertiser's coins. */
  storageUrl?: string
}

export function advertisingSettingsFromEnvironment(env: NodeJS.ProcessEnv = process.env): AdvertisingSettings {
  const flag = (env.ADVERTISE ?? '').trim()
  if (flag !== '' && flag !== '1') throw new Error('ADVERTISE must be 1, or unset for no advertising')
  if (flag === '') {
    if ((env.ADVERTISER_PRIVATE_KEY ?? '') !== '' || (env.ADVERTISER_STORAGE_URL ?? '') !== '') {
      console.warn('ADVERTISER_PRIVATE_KEY or ADVERTISER_STORAGE_URL is set but ADVERTISE is not: nothing is advertised')
    }
    return { enabled: false }
  }
  const domain = stripTrailingSlashes((env.PUBLIC_URL ?? '').trim())
  if (!domain.startsWith('https://')) throw new Error('ADVERTISE=1 needs PUBLIC_URL, the https address other indexes reach this one at')
  const privateKey = (env.ADVERTISER_PRIVATE_KEY ?? '').trim()
  try {
    PrivateKey.fromHex(privateKey)
  } catch {
    throw new Error('ADVERTISE=1 needs ADVERTISER_PRIVATE_KEY, a private key in hex for the advertiser alone')
  }
  const storageUrl = (env.ADVERTISER_STORAGE_URL ?? '').trim()
  if (!storageUrl.startsWith('https://')) throw new Error('ADVERTISE=1 needs ADVERTISER_STORAGE_URL, the https address of the wallet storage server holding its coins')
  return { enabled: true, domain, privateKey, storageUrl }
}

/** The advertiser's wallet from its key and storage URL, through the optional `@bsv/wallet-toolbox-client`. */
export async function advertiserWallet(privateKey: string, storageUrl: string, network: 'main' | 'test'): Promise<WalletInterface> {
  let toolbox: any
  try {
    toolbox = await import('@bsv/wallet-toolbox-client' as string)
  } catch {
    throw new Error('ADVERTISE=1 needs @bsv/wallet-toolbox-client installed beside this package (npm install @bsv/wallet-toolbox-client)')
  }
  const keyDeriver = new KeyDeriver(PrivateKey.fromHex(privateKey))
  const storageManager = new toolbox.WalletStorageManager(keyDeriver.identityKey)
  const signer = new toolbox.WalletSigner(network, keyDeriver, storageManager)
  const wallet = new toolbox.Wallet(signer, new toolbox.Services(network))
  const client = new toolbox.StorageClient(wallet, storageUrl)
  await client.makeAvailable()
  await storageManager.addWalletStorageProvider(client)
  return wallet as WalletInterface
}

export interface AdvertiseOptions {
  wallet: WalletInterface
  /** The https address the adverts name, PUBLIC_URL. */
  domain: string
  /** The topics and lookup services this index hosts. */
  topics: string[]
  services: string[]
  network: 'main' | 'test'
  /** The adverts this identity already has for a protocol; the SDK's resolver through the default trackers in a deployment. */
  findOwnAdverts?: (protocol: 'SHIP' | 'SLAP', identityKey: string) => Promise<LookupAnswer>
  /** Fund and sign the advert outputs; `completeBoundAction` on the wallet in a deployment. */
  fund?: (outputs: Array<{ lockingScript: string; satoshis: number; outputDescription: string }>) => Promise<Transaction>
  /** Hand the funded transaction to the hosts of `tm_ship` and `tm_slap`; `TopicBroadcaster` in a deployment. */
  broadcast?: (tx: Transaction, topics: string[]) => Promise<unknown>
  log?: (line: string) => void
}

export interface AdvertiseResult {
  identityKey: string
  /** `SHIP tm_dpp` and the like, advertised already at this address. */
  existing: string[]
  /** Advertised by this run. */
  created: string[]
  txid?: string
}

/**
 * Advertise every hosted topic and lookup service not yet advertised at this
 * address under the wallet's identity key. Idempotent: a second run with
 * every advert present creates nothing and spends nothing.
 */
export async function advertiseIndex(options: AdvertiseOptions): Promise<AdvertiseResult> {
  const log = options.log ?? ((line) => console.log(line))
  const domain = stripTrailingSlashes(options.domain)
  const preset = options.network === 'main' ? 'mainnet' : 'testnet'
  const { publicKey: identityKey } = await options.wallet.getPublicKey({ identityKey: true })
  const resolver = new LookupResolver({ networkPreset: preset })
  const findOwnAdverts = options.findOwnAdverts ?? (async (protocol, key) => await resolver.query({ service: protocol === 'SHIP' ? 'ls_ship' : 'ls_slap', query: { identityKey: key } }))

  const existing: string[] = []
  for (const protocol of ['SHIP', 'SLAP'] as const) {
    let answer: LookupAnswer
    try {
      answer = await findOwnAdverts(protocol, identityKey)
    } catch (cause) {
      throw new Error(`the trackers could not say which ${protocol} adverts already exist, so none is created: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
    if (answer.type !== 'output-list') continue
    for (const output of answer.outputs) {
      try {
        const script = Transaction.fromBEEF(output.beef).outputs[output.outputIndex]?.lockingScript
        if (script == null) continue
        const advert = await OverlayAdminTokenTemplate.decodeAndVerify(script, protocol)
        if (advert.identityKey === identityKey && stripTrailingSlashes(advert.domain) === domain) existing.push(`${protocol} ${advert.topicOrService}`)
      } catch {
        // Not an advert of ours: someone else's, forged or malformed.
      }
    }
  }

  const wanted = [...options.topics.map((name) => ['SHIP', name] as const), ...options.services.map((name) => ['SLAP', name] as const)]
  const missing = wanted.filter(([protocol, name]) => !existing.includes(`${protocol} ${name}`))
  if (missing.length === 0) {
    log(`advertising: every topic and lookup service is already advertised at ${domain} under ${identityKey}`)
    return { identityKey, existing: [...new Set(existing)], created: [] }
  }

  const template = new OverlayAdminTokenTemplate(options.wallet)
  const outputs = []
  for (const [protocol, name] of missing) {
    outputs.push({ lockingScript: (await template.lock(protocol, domain, name)).toHex(), satoshis: 1, outputDescription: `${protocol} advert of ${name}` })
  }
  const fund = options.fund ?? (async (adverts) => await completeBoundAction(options.wallet, { description: 'DPP index adverts', outputs: adverts }))
  const tx = await fund(outputs)
  const topics = [...new Set(missing.map(([protocol]) => (protocol === 'SHIP' ? 'tm_ship' : 'tm_slap')))]
  const broadcast = options.broadcast ?? (async (transaction, to) => await new TopicBroadcaster(to, { networkPreset: preset }).broadcast(transaction))
  await broadcast(tx, topics)
  const created = missing.map(([protocol, name]) => `${protocol} ${name}`)
  log(`advertising: ${created.join(', ')} at ${domain} under ${identityKey}, in ${tx.id('hex')}`)
  return { identityKey, existing: [...new Set(existing)], created, txid: tx.id('hex') }
}
