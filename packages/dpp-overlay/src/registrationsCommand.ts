/**
 * `dpp-index registrations list|approve|refuse|revoke`: the operator's side
 * of self-service registration (`registration.ts`). The commands open the
 * policy and the stores the environment names, do one thing and exit; the
 * running index picks an appended version up at its next registration
 * request, GET /publisher-policy or restart, and a revoked key's tokens are
 * refused at once.
 */
import { MongoClient } from 'mongodb'
import { loadPublisherPolicy, loadPublisherPolicyJson, parseOperatorIdentityKeys, type PublisherPolicyConfig } from './policyConfig.js'
import { appendRegistrationVersion, operatorSigningKeyFromEnvironment, refreshPolicyChain, registrationStoreFromEnvironment, type RegistrationStore } from './registration.js'
import { openTokenStore } from './tokensCommand.js'

export interface RegistrationsCommandValues {
  publisher?: string
}

/** The policy chain and registration store the environment names, with whatever has to be closed afterwards. */
export async function openRegistrationStore(env: Record<string, string | undefined>): Promise<{ policy: PublisherPolicyConfig; store: RegistrationStore; source: string; close: () => Promise<void> }> {
  const file = (env.PUBLISHER_POLICY_FILE ?? '').trim()
  const inline = (env.PUBLISHER_POLICY_JSON ?? '').trim()
  if (file === '' && inline === '') throw new Error('set PUBLISHER_POLICY_FILE (with OPERATOR_IDENTITY_KEYS) so there is a policy to append to')
  const operators = parseOperatorIdentityKeys(env.OPERATOR_IDENTITY_KEYS)
  const policy = file !== '' ? loadPublisherPolicy(file, operators) : loadPublisherPolicyJson(inline, operators)
  const mongoUrl = (env.MONGO_URL ?? '').trim()
  let close = async (): Promise<void> => {}
  let db
  if (mongoUrl !== '') {
    const client = new MongoClient(mongoUrl)
    await client.connect()
    db = client.db(env.MONGO_DB)
    close = async () => { await client.close() }
  }
  const store = registrationStoreFromEnvironment(env, db)
  if (store == null) {
    await close()
    throw new Error('registrations need MONGO_URL or PUBLISHER_POLICY_FILE: a chain held in PUBLISHER_POLICY_JSON has nowhere to grow')
  }
  await refreshPolicyChain(policy, store)
  return { policy, store, source: db != null ? `MongoDB ${env.MONGO_DB ?? ''}`.trim() : `PUBLISHER_POLICY_FILE ${file}`, close }
}

const COMPRESSED_KEY = /^0[23][0-9a-f]{64}$/

export async function runRegistrationsCommand(args: string[], values: RegistrationsCommandValues, env: Record<string, string | undefined>, out: (line: string) => void = console.log): Promise<void> {
  const command = args[0]
  if (command !== 'list' && command !== 'approve' && command !== 'refuse' && command !== 'revoke') {
    throw new Error('registrations takes one of: list, approve, refuse, revoke; see --help')
  }
  const { policy, store, source, close } = await openRegistrationStore(env)
  try {
    if (command === 'list') {
      const records = await store.listRegistrations()
      if (records.length === 0) out(`${source} holds no registrations`)
      for (const r of records) {
        out(`${r.publisherKey}\t${r.status}\t${r.label}\t${r.network}\t${r.custodyProfile}\trequested ${r.requestedAt}${r.policyVersion == null ? '' : `\tversion ${r.policyVersion}`}${r.decidedAt == null ? '' : `\tdecided ${r.decidedAt}`}${r.collectedAt == null ? '' : `\tcollected ${r.collectedAt}`}`)
      }
      return
    }
    const key = (values.publisher ?? '').trim().toLowerCase()
    if (!COMPRESSED_KEY.test(key)) throw new Error(`registrations ${command} needs --publisher <compressed key>, as registrations list shows it`)
    const record = await store.registration(key)
    if (record == null) throw new Error(`no registration for ${key} in ${source}`)
    const now = new Date()
    const decidedAt = now.toISOString()
    if (command === 'refuse') {
      if (record.status !== 'pending') throw new Error(`${key} is ${record.status}, not pending`)
      await store.saveRegistration({ ...record, status: 'refused', decidedAt })
      out(`refused ${key}`)
      return
    }
    if (command === 'approve') {
      if (record.status !== 'pending') throw new Error(`${key} is ${record.status}, not pending`)
      const signingKey = operatorSigningKeyFromEnvironment(env, policy)
      const version = await appendRegistrationVersion(policy, store, signingKey, { add: { key, role: 'state-publisher' } }, now)
      await store.saveRegistration({ ...record, status: 'approved', policyVersion: version.policyVersion, decidedAt })
      out(`approved ${key} in policy version ${version.policyVersion}; it collects its tokens on its next request`)
      return
    }
    if (record.status !== 'registered' && record.status !== 'collected' && record.status !== 'approved') throw new Error(`${key} is ${record.status}, not registered`)
    const signingKey = operatorSigningKeyFromEnvironment(env, policy)
    const version = await appendRegistrationVersion(policy, store, signingKey, { retire: key }, now)
    const tokens = await openTokenStore(env)
    let revoked = 0
    try {
      for (const token of await tokens.store.list()) {
        if (token.publisherKey === key && token.revokedAt == null && (await tokens.store.revoke(token.sha256, decidedAt.replace(/\.\d{3}Z$/, 'Z')))) revoked += 1
      }
    } finally {
      await tokens.close()
    }
    await store.saveRegistration({ ...record, status: 'revoked', decidedAt })
    out(`revoked ${key} in policy version ${version.policyVersion} and revoked ${revoked} of its tokens`)
  } finally {
    await close()
  }
}
