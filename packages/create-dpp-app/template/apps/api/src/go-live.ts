// npm run go-live: everything a real write needs, checked in order, each
// failure printed with its fix, and nothing on the chain until all pass.
// Registration is the one step that changes the index: the wallet signs a
// dpp-index-registration@1 request, POST /register appends the publisher
// key to the index's policy and answers with this app's two write tokens,
// which go into .env beside the root key the first run generated. A passing
// run writes LIVE_PUBLISHING=true; a failing run leaves it as it was.
import { randomBytes } from 'node:crypto'
import { INDEX_REGISTRATION_FORMAT, signRegistration } from '@bsv/dpp-protocol'
import { KNOWN_INDEX_HOSTS, loadConfig, type Config } from './config.js'
import { updateEnvFile } from './env-file.js'
import { IndexClient } from './index-client.js'
import { openPlatform as openDefaultPlatform, type Platform, type PlatformOptions } from './platform.js'

export const CUSTODY_PROFILE = 'managed-custody@2'
/** A few states' worth: one costs a little over a hundred satoshis. */
export const MINIMUM_SATOSHIS = 500
const LABEL_BYTES = 128

export interface GoLiveFailure {
  check: string
  problem: string
  fix: string
}

export interface GoLiveOptions {
  env: NodeJS.ProcessEnv
  /** The project's .env, which gains the root key, the tokens and LIVE_PUBLISHING. */
  envFile: string
  /** The label the index's operator sees for this app. */
  projectName: string
  out: (line: string) => void
  openPlatform?: (options: PlatformOptions) => Promise<Platform>
  now?: () => Date
  /** 'configuration' runs the first group only (connect-index and add-index before the index runs); 'all' is go-live. */
  through?: 'configuration' | 'all'
}

export interface GoLiveResult {
  ok: boolean
  passed: string[]
  failures: GoLiveFailure[]
}

type RegisterAnswer = { status: number; body: { status?: string; error?: string; description?: string; hint?: string; policyVersion?: number; tokens?: { submit: string; callback: string } } }

async function postRegister(url: string, request: unknown): Promise<RegisterAnswer> {
  const response = await fetch(`${url}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
  const body = (await response.json().catch(() => ({}))) as RegisterAnswer['body']
  return { status: response.status, body }
}

/** An error's message with the reason fetch hides under `cause` (ENOTFOUND, ECONNREFUSED), so a newcomer can tell DNS from a service that is down. */
const describe = (cause: unknown): string => {
  if (!(cause instanceof Error)) return String(cause)
  const inner = (cause as Error & { cause?: unknown }).cause
  return inner instanceof Error && inner.message !== '' && inner.message !== cause.message ? `${cause.message} (${inner.message})` : cause.message
}

/** go-live decides LIVE_PUBLISHING itself, so the file's current value never stops the run: a true left behind without tokens would otherwise send the user round in a loop. */
const configuration = (env: NodeJS.ProcessEnv): Config => loadConfig({ ...env, LIVE_PUBLISHING: 'false' })

export async function goLive(options: GoLiveOptions): Promise<GoLiveResult> {
  const env = { ...options.env }
  const out = options.out
  const open = options.openPlatform ?? openDefaultPlatform
  const now = options.now ?? (() => new Date())
  const passed: string[] = []
  const failures: GoLiveFailure[] = []
  const pass = (check: string, detail?: string): void => {
    passed.push(check)
    out(`ok  ${check}${detail == null ? '' : `: ${detail}`}`)
  }
  const fail = (check: string, problem: string, fix: string): void => {
    failures.push({ check, problem, fix })
    out(`no  ${check}: ${problem}. Fix: ${fix}`)
  }
  const result = (): GoLiveResult => ({ ok: failures.length === 0, passed, failures })

  // 1. Configuration.
  let config: Config
  if ((env.LIVE_PUBLISHING ?? '').trim() === 'true') out('note configuration: LIVE_PUBLISHING is already true in .env; this run decides it again')
  try {
    config = configuration(env)
  } catch (cause) {
    fail('configuration', describe(cause), 'edit .env as the message says, then run npm run go-live again')
    return result()
  }
  const indexUrl = config.index.url
  if (indexUrl == null) {
    fail('configuration', 'INDEX_URL is empty', 'set INDEX_URL to the index this app publishes to (the default testnet index is https://dpp-overlay-testnet.bsvb.net), or run npm run connect-index -- --url <index>')
  } else {
    let host: string | undefined
    try {
      host = new URL(indexUrl).hostname
    } catch {
      fail('configuration', `INDEX_URL ${indexUrl} is not a URL`, 'set INDEX_URL to the index address, https://host or http://host:port')
    }
    const known = host == null ? undefined : KNOWN_INDEX_HOSTS[host]
    if (known != null && known !== config.network) {
      fail('configuration', `${host} serves ${known} and NETWORK is ${config.network}`, `set NETWORK=${known} for that index, or INDEX_URL to the ${config.network} index (${config.network === 'test' ? 'https://dpp-overlay-testnet.bsvb.net' : 'https://dpp-overlay.bsvb.net'})`)
    }
  }
  if (config.network === 'main') {
    if (config.gs1Prefix === '952') fail('configuration', 'GS1_PREFIX is 952, the demonstration prefix, and NETWORK is main', 'set GS1_PREFIX to a prefix licensed to you before writing real passports on mainnet')
    if (/^localhost(:\d+)?$/.test(config.passportHost)) fail('configuration', `PASSPORT_HOST is ${config.passportHost} and NETWORK is main`, 'set PASSPORT_HOST to a host you serve this app from, so a label opens the passport page')
  } else {
    if (config.gs1Prefix === '952') out('note configuration: GS1_PREFIX is 952, the demonstration prefix; fine on testnet, replace it before mainnet')
    if (/^localhost(:\d+)?$/.test(config.passportHost)) out(`note configuration: PASSPORT_HOST is ${config.passportHost}; fine on testnet, set a host you serve before mainnet`)
  }
  if (failures.length > 0) return result()
  pass('configuration', `${config.network}, index ${indexUrl}`)
  if (options.through === 'configuration') return result()

  // 2. Wallet.
  if (config.wallet.rootKeyHex == null) {
    const rootKey = randomBytes(32).toString('hex')
    await updateEnvFile(options.envFile, { WALLET_ROOT_KEY: rootKey })
    env.WALLET_ROOT_KEY = rootKey
    config = configuration(env)
    out('Generated WALLET_ROOT_KEY into .env. Back the file up: this key is the wallet.')
  }
  let platform: Platform
  try {
    platform = await open({ config, mode: 'live', log: () => {} })
  } catch (cause) {
    fail('wallet', `the wallet could not be opened: ${describe(cause)}`, 'check WALLET_ROOT_KEY and WALLET_FILE in .env, then run npm run go-live again')
    return result()
  }
  try {
    const publisherKey = platform.wallet.identityKey
    if (config.testWallet && platform.wallet.kind === 'test') out('DPP_TEST_WALLET=1: the test wallet stands in on the configured root key, with made-up funds; nothing can be written to the chain. Unset it unless this is the scaffold check.')
    pass('wallet', `${platform.wallet.kind} wallet on ${platform.wallet.network}, publisher key ${publisherKey}`)

    // 3. The index.
    const index = new IndexClient({ url: indexUrl! })
    let custodyProfile: string | undefined
    let registrationMode: string | undefined
    let publisherKeys: string[] = []
    try {
      const health = await index.health()
      if (health.network !== config.network) {
        fail('index', `${indexUrl} serves ${health.network} and NETWORK is ${config.network}`, `set NETWORK=${health.network}, or point INDEX_URL at a ${config.network} index`)
      }
      const document = await index.capabilities()
      const custody = document.profiles?.find((p) => p.kind === 'custody')
      custodyProfile = custody == null ? undefined : `${custody.id}@${custody.version}`
      registrationMode = (document.profiles?.find((p) => p.kind === 'operator')?.options?.registration as string | undefined) ?? 'off'
      publisherKeys = document.publisherPolicy?.publisherKeys ?? []
      if (custodyProfile !== CUSTODY_PROFILE) {
        fail('index', `${indexUrl} admits under custody profile ${custodyProfile ?? 'none'} and this app writes under ${CUSTODY_PROFILE}`, 'use an index that declares managed custody (the default indexes do), or run your own with npm run add-index')
      }
    } catch (cause) {
      fail('index', `${indexUrl} could not be reached: ${describe(cause)}`, 'check the address and that the index is running; to use another index, run npm run connect-index -- --url <index>')
    }
    if (failures.length > 0) return result()
    pass('index', `${indexUrl} on ${config.network}, ${custodyProfile}, registration ${registrationMode}`)

    // 4. Registration.
    // Named and holding tokens: done. Named without tokens is still a request:
    // an approved key collects its tokens this way, and a key the operator
    // added by hand is told 409 and where to get them.
    const named = publisherKeys.includes(publisherKey)
    if (named && config.index.joined) {
      pass('registration', 'this publisher key is registered and the tokens are held')
    } else {
      let answer: RegisterAnswer
      try {
        const request = await signRegistration(
          {
            registrationFormat: INDEX_REGISTRATION_FORMAT,
            indexUrl: indexUrl!,
            publisherKey,
            network: config.network,
            custodyProfile: CUSTODY_PROFILE,
            label: Buffer.from(options.projectName, 'utf8').subarray(0, LABEL_BYTES).toString('utf8').replace(/�+$/, '') || 'dpp-app',
            requestedAt: now().toISOString(),
          },
          platform.wallet.publisher
        )
        answer = await postRegister(indexUrl!, request)
      } catch (cause) {
        const message = describe(cause)
        if (/label/.test(message)) {
          fail('registration', `the request could not be signed: ${message}`, 'set a plain name in package.json (letters, digits and hyphens), then run npm run go-live again')
          return result()
        }
        fail('registration', `POST /register failed: ${describe(cause)}`, 'run npm run go-live again; if it keeps failing, ask the operator')
        return result()
      }
      const { status, body } = answer
      if (status === 201 && body.tokens != null) {
        await updateEnvFile(options.envFile, { INDEX_SUBMIT_TOKEN: body.tokens.submit, INDEX_CALLBACK_TOKEN: body.tokens.callback })
        env.INDEX_SUBMIT_TOKEN = body.tokens.submit
        env.INDEX_CALLBACK_TOKEN = body.tokens.callback
        config = configuration(env)
        pass('registration', `registered in policy version ${body.policyVersion}; the tokens are in .env`)
      } else if (status === 202) {
        fail('registration', `${indexUrl} holds the request for its operator's approval`, 'run npm run go-live again once the operator has approved; the tokens are handed over then')
      } else if (status === 404) {
        fail('registration', `${indexUrl} does not register publishers itself`, 'ask its operator for admission and tokens, then run npm run connect-index -- --url <index> --submit-token <t> --callback-token <t>; or run your own index with npm run add-index')
      } else if (status === 409 && body.error === 'already-registered') {
        fail('registration', `${indexUrl} names this publisher key and holds no tokens for it to hand over`, 'ask the operator for this key\'s tokens, then run npm run connect-index -- --url <index> --submit-token <t> --callback-token <t>')
      } else {
        fail('registration', `${indexUrl} answered ${status}${body.error == null ? '' : ` ${body.error}`}${body.description == null ? '' : `: ${body.description}`}`, body.hint ?? 'read the message, change .env accordingly and run npm run go-live again')
      }
    }
    if (failures.length > 0) return result()

    // 5. Funds.
    const balance = await platform.wallet.balance()
    if (balance < MINIMUM_SATOSHIS) {
      const funding = await platform.wallet.fundingAddress()
      fail('funds', `the wallet holds ${balance} satoshis`, `pay a few thousand satoshis to ${funding.address}, then take the payment in with: npm run wallet fund <txid> ${funding.address} ${funding.derivationPrefix} ${funding.derivationSuffix}; then run npm run go-live again`)
      return result()
    }
    pass('funds', `${balance} satoshis`)

    // 6. Admission: the index names the key now.
    const keys = await index.publisherKeys().catch(() => [] as string[])
    if (!keys.includes(publisherKey)) {
      fail('admission', `${indexUrl} does not yet name this publisher key`, 'run npm run go-live again in a moment; if it keeps failing, ask the operator')
      return result()
    }
    pass('admission', 'the index admits states this key countersigns')

    await updateEnvFile(options.envFile, { LIVE_PUBLISHING: 'true' })
    out(`LIVE_PUBLISHING=true is written: the next passport write spends real satoshis on ${config.network === 'main' ? 'mainnet' : 'testnet'} and is permanent.`)
    return result()
  } finally {
    await platform.close()
  }
}
