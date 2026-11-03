import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrivateKey } from '@bsv/sdk'
import { publisherKeysAt, verifyPolicyChain, type PublisherPolicy } from '@bsv/dpp-protocol'
import { runRegistrationsCommand } from '../src/registrationsCommand.js'
import { FileRegistrationStore, type Registration } from '../src/registration.js'
import { FilePublisherTokenStore, issueToken, tokenDigest } from '../src/publisherTokens.js'
import { OPERATOR, operatorPriv, policyChain, pub, STRANGER } from './policy-fixture.js'

/**
 * `dpp-index registrations list|approve|refuse|revoke`: the operator's side of
 * self-service registration, over the stores the environment names. Here the
 * policy file and the tokens file, as an operator project has them; the
 * commands append to the policy file what the running index then serves.
 */
const APP = PrivateKey.fromHex('67'.repeat(32))
const temps: string[] = []
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

function project(): { env: Record<string, string>; policyFile: string; tokensFile: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dpp-registrations-'))
  temps.push(dir)
  const policyFile = join(dir, 'publisher-policy.json')
  writeFileSync(policyFile, JSON.stringify(policyChain(), null, 2) + '\n')
  const tokensFile = join(dir, 'publisher-tokens.json')
  return {
    env: { PUBLISHER_POLICY_FILE: policyFile, PUBLISHER_TOKENS_FILE: tokensFile, OPERATOR_IDENTITY_KEYS: `${OPERATOR}=${pub(operatorPriv)}`, OPERATOR_SIGNING_KEY: operatorPriv.toHex() },
    policyFile,
    tokensFile,
  }
}

const pending = (key: PrivateKey = APP): Registration => ({ publisherKey: pub(key), label: 'Cell pack demo', network: 'test', custodyProfile: 'record-model-baseline@2', requestedAt: '2026-07-26T08:00:00Z', status: 'pending' })

async function run(env: Record<string, string>, args: string[], values: { publisher?: string } = {}): Promise<string[]> {
  const lines: string[] = []
  await runRegistrationsCommand(args, values, env, (line) => lines.push(line))
  return lines
}

describe('dpp-index registrations', () => {
  it('lists the registrations, oldest request first, or says there are none', async () => {
    const { env, policyFile } = project()
    expect(await run(env, ['list'])).toEqual([`PUBLISHER_POLICY_FILE ${policyFile} holds no registrations`])
    const store = new FileRegistrationStore(policyFile)
    await store.saveRegistration(pending())
    await store.saveRegistration({ ...pending(STRANGER), requestedAt: '2026-07-25T08:00:00Z', status: 'refused', decidedAt: '2026-07-25T09:00:00Z' })
    const lines = await run(env, ['list'])
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain(pub(STRANGER))
    expect(lines[0]).toContain('refused')
    expect(lines[1]).toBe(`${pub(APP)}\tpending\tCell pack demo\ttest\trecord-model-baseline@2\trequested 2026-07-26T08:00:00Z`)
  })

  it('approves a pending key: a version naming it lands in the policy file and the record waits for collection', async () => {
    const { env, policyFile } = project()
    const store = new FileRegistrationStore(policyFile)
    await store.saveRegistration(pending())
    const lines = await run(env, ['approve'], { publisher: pub(APP) })
    expect(lines).toEqual([`approved ${pub(APP)} in policy version 3; it collects its tokens on its next request`])
    const chain = JSON.parse(readFileSync(policyFile, 'utf8')) as PublisherPolicy[]
    expect(chain.map((p) => p.policyVersion)).toEqual([1, 2, 3])
    expect(verifyPolicyChain(chain, { [OPERATOR]: pub(operatorPriv) }).ok).toBe(true)
    expect(publisherKeysAt(chain, new Date(Date.now() + 1000))).toContain(pub(APP))
    expect(await store.registration(pub(APP))).toMatchObject({ status: 'approved', policyVersion: 3 })
    expect((await store.registration(pub(APP)))?.decidedAt).toMatch(/Z$/)
  })

  it('refuses a pending key without touching the policy', async () => {
    const { env, policyFile } = project()
    const store = new FileRegistrationStore(policyFile)
    await store.saveRegistration(pending())
    expect(await run(env, ['refuse'], { publisher: pub(APP) })).toEqual([`refused ${pub(APP)}`])
    expect((await store.registration(pub(APP)))?.status).toBe('refused')
    expect((JSON.parse(readFileSync(policyFile, 'utf8')) as PublisherPolicy[]).length).toBe(2)
  })

  it('revokes a registered key: a version retiring it, its tokens revoked, the record revoked', async () => {
    const { env, policyFile, tokensFile } = project()
    await run(env, ['approve'], { publisher: pub(APP) }).catch(() => undefined)
    const store = new FileRegistrationStore(policyFile)
    await store.saveRegistration(pending())
    await run(env, ['approve'], { publisher: pub(APP) })
    const tokens = new FilePublisherTokenStore(tokensFile)
    const submit = (await issueToken(tokens, pub(APP), 'submit', 'Cell pack demo')).token
    const other = (await issueToken(tokens, pub(STRANGER), 'submit', 'other')).token
    await store.saveRegistration({ ...(await store.registration(pub(APP)))!, status: 'collected', collectedAt: '2026-07-26T08:10:00Z' })

    const lines = await run(env, ['revoke'], { publisher: pub(APP) })
    expect(lines).toEqual([`revoked ${pub(APP)} in policy version 4 and revoked 1 of its tokens`])
    const chain = JSON.parse(readFileSync(policyFile, 'utf8')) as PublisherPolicy[]
    expect(chain.map((p) => p.policyVersion)).toEqual([1, 2, 3, 4])
    expect(publisherKeysAt(chain, new Date(Date.now() + 1000))).not.toContain(pub(APP))
    expect((await tokens.find(tokenDigest(submit)))?.revokedAt).toMatch(/Z$/)
    expect((await tokens.find(tokenDigest(other)))?.revokedAt).toBeUndefined()
    expect((await store.registration(pub(APP)))?.status).toBe('revoked')
  })

  it('names what is wrong: an unknown command, a missing key, a key in the wrong state, no signing key, no policy', async () => {
    const { env, policyFile } = project()
    await expect(run(env, ['bless'])).rejects.toThrow(/list, approve, refuse, revoke/)
    await expect(run(env, ['approve'])).rejects.toThrow(/--publisher/)
    await expect(run(env, ['approve'], { publisher: pub(APP) })).rejects.toThrow(/no registration/)
    const store = new FileRegistrationStore(policyFile)
    await store.saveRegistration({ ...pending(), status: 'refused' })
    await expect(run(env, ['approve'], { publisher: pub(APP) })).rejects.toThrow(/refused, not pending/)
    await expect(run(env, ['revoke'], { publisher: pub(APP) })).rejects.toThrow(/not registered/)
    await store.saveRegistration(pending())
    await expect(run({ ...env, OPERATOR_SIGNING_KEY: '' }, ['approve'], { publisher: pub(APP) })).rejects.toThrow(/OPERATOR_SIGNING_KEY/)
    await expect(run({ ...env, OPERATOR_SIGNING_KEY: STRANGER.toHex() }, ['approve'], { publisher: pub(APP) })).rejects.toThrow(/operator/)
    await expect(run({ PUBLISHER_TOKENS_FILE: env.PUBLISHER_TOKENS_FILE }, ['list'])).rejects.toThrow(/PUBLISHER_POLICY_FILE/)
  })
})
