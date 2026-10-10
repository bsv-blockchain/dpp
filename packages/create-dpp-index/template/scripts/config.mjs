import { ECDH, createECDH } from 'node:crypto'
import { existsSync } from 'node:fs'
import { isIP } from 'node:net'
import { loadEnvFile } from 'node:process'

export function publicKey(value, name) {
  if (typeof value !== 'string' || !/^0[23][0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a compressed public key (66 hex characters), never a private key`)
  try { return ECDH.convertKey(value, 'secp256k1', 'hex', 'hex', 'compressed') }
  catch { throw new Error(`${name} is not a valid secp256k1 public key`) }
}

export function baseUrl(value, name, allowInternalHttp = false) {
  if (typeof value !== 'string') throw new Error(`${name} must be an HTTP(S) origin string`)
  let url
  try { url = new URL(value) } catch { throw new Error(`${name} must be an absolute HTTP(S) origin`) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error(`${name} must be an HTTP(S) origin without credentials, path, query or fragment`)
  if (url.protocol === 'http:' && !allowInternalHttp && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error(`${name} must use HTTPS outside localhost`)
  return url.origin
}

export function loadEnvironment() {
  if (existsSync('.env')) loadEnvFile('.env')
  return process.env
}

export function validateConfiguration(env) {
  const errors = []
  const value = name => (env[name] ?? '').trim()
  const check = fn => { try { fn() } catch (error) { errors.push(error.message) } }
  for (const name of ['SERVICE_IDENTITY_KEY', 'NETWORK', 'PORT', 'HOST', 'PUBLIC_URL', 'MONGO_URL', 'MONGO_DB', 'SUBMIT_TOKEN', 'ARC_CALLBACK_TOKEN', 'EXPORT_TOKEN', 'EXPORT_SIGNING_KEY', 'ACCEPTANCE_COMMITMENT']) {
    if (env[name] != null && env[name] !== value(name)) errors.push(`${name} must not have leading or trailing whitespace`)
  }
  check(() => publicKey(value('SERVICE_IDENTITY_KEY'), 'SERVICE_IDENTITY_KEY'))
  const anchors = value('ANCHOR_SERVICE_KEYS').split(',').map(key => key.trim()).filter(Boolean)
  if (!anchors.length) errors.push('Set ANCHOR_SERVICE_KEYS to the authorised anchor publisher public keys')
  for (const key of anchors) check(() => publicKey(key, 'ANCHOR_SERVICE_KEYS'))
  if (!['main', 'test'].includes(value('NETWORK'))) errors.push('NETWORK must be main or test, matching the app wallet')
  if (!/^\d+$/.test(value('PORT')) || Number(value('PORT')) < 1 || Number(value('PORT')) > 65535) errors.push('PORT must be an integer from 1 to 65535')
  if (!isIP(value('HOST'))) errors.push('HOST must be an IP address, normally 127.0.0.1 or 0.0.0.0 inside a container')
  check(() => baseUrl(value('PUBLIC_URL'), 'PUBLIC_URL'))
  if (!/^mongodb(?:\+srv)?:\/\/[^\s]+$/.test(value('MONGO_URL'))) errors.push('MONGO_URL must name persistent MongoDB storage; memory-only storage is not selected by this starter')
  if (!/^[a-zA-Z0-9_-]{1,63}$/.test(value('MONGO_DB'))) errors.push('MONGO_DB must name the index database using letters, digits, underscores or hyphens')
  const tokens = ['SUBMIT_TOKEN', 'ARC_CALLBACK_TOKEN', ...(value('EXPORT_SIGNING_KEY') ? ['EXPORT_TOKEN'] : [])]
  for (const token of tokens) {
    if (!/^[a-zA-Z0-9_-]{32,}$/.test(value(token))) errors.push(`${token} must contain at least 32 URL-safe characters; generate an independent random secret`)
  }
  if (new Set(tokens.map(value)).size !== tokens.length) errors.push('Use separate secrets for submit, proof delivery and complete export')
  if (value('SERVER_PRIVATE_KEY')) errors.push('Remove SERVER_PRIVATE_KEY; this index uses the publisher public key')
  if (value('CHAIN_TRACKER')) errors.push('Leave CHAIN_TRACKER empty for header verification; scripts-only is reserved for synthetic protocol tests')
  for (const flag of ['ACCEPTANCE_COMMITMENT', 'OWNER_CONSENT']) {
    if (!['', 'required'].includes(value(flag))) errors.push(`${flag} must be required or empty`)
  }
  for (const name of ['CONTROL_AUTHORITIES', 'TRANSFER_AUTHORITIES']) {
    for (const key of value(name).split(',').map(key => key.trim()).filter(Boolean)) check(() => publicKey(key, name))
  }
  if (value('PUBLISHER_POLICY_FILE') && value('PUBLISHER_POLICY_JSON')) errors.push('Set only one of PUBLISHER_POLICY_FILE and PUBLISHER_POLICY_JSON')
  if (value('EXPORT_SIGNING_KEY')) {
    check(() => {
      try {
        if (!/^[0-9a-fA-F]{64}$/.test(value('EXPORT_SIGNING_KEY'))) throw new Error()
        const signer = createECDH('secp256k1')
        signer.setPrivateKey(value('EXPORT_SIGNING_KEY'), 'hex')
        if (signer.getPublicKey('hex', 'compressed') === value('SERVICE_IDENTITY_KEY').toLowerCase()) throw new Error()
      } catch { throw new Error('EXPORT_SIGNING_KEY must be a separate valid 32-byte private key, never the publisher key') }
    })
  }
  return errors
}

export function requireConfiguration(env) {
  const errors = validateConfiguration(env)
  if (errors.length) throw new Error(errors.join('\n'))
}
