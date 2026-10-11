import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { baseUrl, loadEnvironment, validateConfiguration } from './config.mjs'

let json = process.argv.includes('--json')
try {
  const { values } = parseArgs({ options: { json: { type: 'boolean' }, online: { type: 'boolean' }, url: { type: 'string' } } })
  json = values.json === true
  const env = loadEnvironment()
  const errors = validateConfiguration(env)
  const checks = ['configuration']
  const project = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  let policy
  if (!errors.length) {
    const runtime = await import('@bsv/dpp-overlay-topics')
    policy = runtime.publisherPolicyFromEnvironment()
    runtime.syncSettingsFromEnvironment()
    runtime.discoverySettingsFromEnvironment(env.NETWORK)
    checks.push('publisher policy and peer settings')
    if (values.online) {
      const url = baseUrl(values.url ?? `http://localhost:${env.PORT}`, 'doctor URL', true)
      const get = async path => {
        const response = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(5000), redirect: 'error' })
        if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`)
        return response.json()
      }
      const [health, caps] = await Promise.all([get('/health'), get('/capabilities')])
      if (health.status !== 'ok') errors.push('Index health is not ok')
      if (health.network !== env.NETWORK) errors.push('Index network differs from NETWORK')
      if (caps.unsupported?.some(item => item.id === 'retraction-network-check')) errors.push('Index has disabled its network checks; do not use a fixture runtime for live traffic')
      const expected = project.dpp.packages['@bsv/dpp-overlay-topics']
      if (caps.implementation?.version !== expected) errors.push(`Index runtime differs from the pinned version ${expected}`)
      for (const topic of ['tm_dpp', 'tm_attestation']) if (!caps.topics?.includes(topic)) errors.push(`Missing topic ${topic}`)
      for (const service of ['ls_dpp', 'ls_attestation']) if (!caps.services?.includes(service)) errors.push(`Missing lookup service ${service}`)
      const wanted = env.ACCEPTANCE_COMMITMENT === 'required' ? 'managed-custody' : 'record-model-baseline'
      if (!caps.profiles?.some(profile => profile.id === wanted)) errors.push(`Index does not select the expected ${wanted} custody profile`)
      const equal = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
      const now = new Date()
      const publishers = (policy && runtime.policyKeysFor(policy.chain, now, 'state-publisher', 'tm_dpp')) ?? [env.SERVICE_IDENTITY_KEY]
      const anchors = (policy && runtime.policyKeysFor(policy.chain, now, 'anchor-publisher', 'tm_attestation')) ?? env.ANCHOR_SERVICE_KEYS.split(',').map(key => key.trim())
      if (!equal(caps.publisherPolicy?.publisherKeys ?? [], publishers)) errors.push('Index publisher keys differ from local configuration')
      if (!equal(caps.publisherPolicy?.anchoringServices ?? [], anchors)) errors.push('Index anchor publisher keys differ from local configuration')
      checks.push('reachable HTTP service', 'network, versions, topics, custody and publisher keys')
    }
  }
  const result = { ok: errors.length === 0, checks, errors, releaseSet: project.dpp.releaseSet,
    scope: values.online ? 'Configuration and running HTTP capabilities. Does not establish blockchain settlement or database recovery.' : 'Configuration only. Add --online after starting the service.' }
  console.log(json ? JSON.stringify(result) : `${result.ok ? 'OK' : 'FAILED'}: ${checks.join('; ')}\n${errors.join('\n')}${errors.length ? '\n' : ''}${result.scope}`)
  process.exitCode = result.ok ? 0 : 1
} catch (error) {
  const result = { ok: false, errors: [error instanceof Error ? error.message : 'Doctor failed'] }
  console.log(json ? JSON.stringify(result) : result.errors.join('\n'))
  process.exitCode = 1
}
