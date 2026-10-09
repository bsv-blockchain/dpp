import { describe, expect, it } from 'vitest'
import { LockingScript, OverlayAdminTokenTemplate, PrivateKey, ProtoWallet, Transaction, type LookupAnswer } from '@bsv/sdk'
import { advertiseIndex, advertisingSettingsFromEnvironment } from '../src/advertise.js'

/**
 * Advertising (advertise.ts): a ProtoWallet signs the adverts exactly as an
 * advertiser's wallet would; funding and broadcasting are stand-ins, so
 * nothing reaches the network and no coin is spent.
 */
const DOMAIN = 'https://index.example.org'
const KEY = PrivateKey.fromRandom()
const WALLET = new ProtoWallet(KEY)
const TOPICS = ['tm_dpp', 'tm_attestation']
const SERVICES = ['ls_dpp', 'ls_attestation']

async function advert(key: PrivateKey, protocol: 'SHIP' | 'SLAP', domain: string, name: string): Promise<{ beef: number[]; outputIndex: number }> {
  const script = await new OverlayAdminTokenTemplate(new ProtoWallet(key)).lock(protocol, domain, name)
  return { beef: new Transaction(1, [], [{ lockingScript: script, satoshis: 1 }], 0).toBEEF(), outputIndex: 0 }
}

const answer = (outputs: Array<{ beef: number[]; outputIndex: number }>): LookupAnswer => ({ type: 'output-list', outputs })

/** Funding as a wallet would, minus the coins: one transaction holding exactly the advert outputs. */
const fundLocally = async (outputs: Array<{ lockingScript: string; satoshis: number }>): Promise<Transaction> => {
  const tx = new Transaction()
  for (const output of outputs) tx.addOutput({ lockingScript: LockingScript.fromHex(output.lockingScript), satoshis: output.satoshis })
  return tx
}

describe('advertising settings', () => {
  it('is off unless ADVERTISE=1, and then needs an https address, the advertiser key and an https storage server', () => {
    expect(advertisingSettingsFromEnvironment({})).toEqual({ enabled: false })
    const settings = { ADVERTISE: '1', PUBLIC_URL: `${DOMAIN}/`, ADVERTISER_PRIVATE_KEY: KEY.toHex(), ADVERTISER_STORAGE_URL: 'https://storage.example.org' }
    expect(advertisingSettingsFromEnvironment(settings)).toEqual({ enabled: true, domain: DOMAIN, privateKey: KEY.toHex(), storageUrl: 'https://storage.example.org' })
    expect(() => advertisingSettingsFromEnvironment({ ...settings, ADVERTISE: 'yes' })).toThrow('ADVERTISE must be 1')
    expect(() => advertisingSettingsFromEnvironment({ ...settings, PUBLIC_URL: 'http://index.example.org' })).toThrow('PUBLIC_URL')
    expect(() => advertisingSettingsFromEnvironment({ ...settings, ADVERTISER_PRIVATE_KEY: 'not-a-key' })).toThrow('ADVERTISER_PRIVATE_KEY')
    expect(() => advertisingSettingsFromEnvironment({ ...settings, ADVERTISER_STORAGE_URL: '' })).toThrow('ADVERTISER_STORAGE_URL')
  })
})

describe('advertising this index', () => {
  it('creates only the adverts missing at this address, each signed by the advertiser and naming this index, in one transaction', async () => {
    const stranger = PrivateKey.fromRandom()
    const own = {
      SHIP: answer([await advert(KEY, 'SHIP', DOMAIN, 'tm_dpp'), await advert(KEY, 'SHIP', 'https://old.example.org', 'tm_attestation'), await advert(stranger, 'SHIP', DOMAIN, 'tm_attestation')]),
      SLAP: answer([]),
    }
    const sent: Array<{ tx: Transaction; topics: string[] }> = []
    const result = await advertiseIndex({
      wallet: WALLET, domain: DOMAIN, topics: TOPICS, services: SERVICES, network: 'main',
      findOwnAdverts: async (protocol) => own[protocol],
      fund: fundLocally,
      broadcast: async (tx, topics) => sent.push({ tx, topics }),
      log: () => {},
    })
    expect(result.existing).toEqual(['SHIP tm_dpp'])
    expect(result.created).toEqual(['SHIP tm_attestation', 'SLAP ls_dpp', 'SLAP ls_attestation'])
    expect(sent).toHaveLength(1)
    expect(sent[0].topics).toEqual(['tm_ship', 'tm_slap'])
    const adverts = await Promise.all(sent[0].tx.outputs.map(async (o) => await OverlayAdminTokenTemplate.decodeAndVerify(o.lockingScript)))
    expect(adverts.map((a) => [a.protocol, a.topicOrService, a.domain, a.identityKey])).toEqual([
      ['SHIP', 'tm_attestation', DOMAIN, KEY.toPublicKey().toString()],
      ['SLAP', 'ls_dpp', DOMAIN, KEY.toPublicKey().toString()],
      ['SLAP', 'ls_attestation', DOMAIN, KEY.toPublicKey().toString()],
    ])
    expect(sent[0].tx.outputs.every((o) => o.satoshis === 1)).toBe(true)
  })

  it('spends nothing when every advert is present, and creates nothing when the trackers cannot be asked', async () => {
    const all = {
      SHIP: answer(await Promise.all(TOPICS.map(async (t) => await advert(KEY, 'SHIP', DOMAIN, t)))),
      SLAP: answer(await Promise.all(SERVICES.map(async (s) => await advert(KEY, 'SLAP', DOMAIN, s)))),
    }
    let funded = 0
    const quiet = await advertiseIndex({
      wallet: WALLET, domain: `${DOMAIN}/`, topics: TOPICS, services: SERVICES, network: 'main',
      findOwnAdverts: async (protocol) => all[protocol],
      fund: async (outputs) => { funded++; return await fundLocally(outputs) },
      broadcast: async () => {},
      log: () => {},
    })
    expect(quiet.created).toEqual([])
    expect(funded).toBe(0)
    await expect(advertiseIndex({
      wallet: WALLET, domain: DOMAIN, topics: TOPICS, services: SERVICES, network: 'main',
      findOwnAdverts: async () => { throw new Error('the trackers are down') },
      fund: async (outputs) => { funded++; return await fundLocally(outputs) },
      broadcast: async () => {},
      log: () => {},
    })).rejects.toThrow('none is created')
    expect(funded).toBe(0)
  })
})
