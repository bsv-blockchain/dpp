// The EPCIS query sources this application may pull from. A source is server
// configuration and nothing in it comes from a request: an identifier, the
// address of the source's query interface, the origins a request may go to,
// and a credential read from the environment.
//
// The credential is kept behind a function. Printing or serialising the
// configuration shows that a credential is set and which kind, never what it
// is. It is handed to the pull when a run begins and goes nowhere else: not
// into the database, a response, a log line or the web client.
import type { EpcisSourceCredential } from '@bsv/dpp-credentials/epcis-exchange'

export interface EpcisSourceConfig {
  /** The name events from this source are filed under. Lower-case letters, digits and hyphens. */
  sourceId: string
  /** The address the events query is made under: `<baseUrl>/events`. */
  baseUrl: string
  /** Every origin a request may be made to. The base address's own origin when the setting is empty. */
  permittedOrigins: string[]
  /** Permits plain http and private addresses. For a source on your own machine only. */
  localTest: boolean
  /** Sends each value of a list as its own parameter, for a source that does not read the pipe-delimited form. */
  repeatListParameters: boolean
  /** Which kind of credential is set, when one is. */
  credentialScheme?: EpcisSourceCredential['scheme']
  /** Reads the credential. Absent when none is set. */
  credentials?: () => EpcisSourceCredential
}

/** A source as the API describes it. It says whether a credential is set, and never carries one. */
export interface EpcisSourceDescription {
  sourceId: string
  baseUrl: string
  permittedOrigins: string[]
  localTest: boolean
  repeatListParameters: boolean
  credentialConfigured: boolean
  credentialScheme?: EpcisSourceCredential['scheme']
  /** Why a pull from this source will be refused as it is configured, when it will be. */
  problem?: string
}

const text = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const value = env[name]?.trim()
  return value == null || value === '' ? undefined : value
}
const list = (env: NodeJS.ProcessEnv, name: string): string[] =>
  (text(env, name) ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
const flag = (env: NodeJS.ProcessEnv, name: string): boolean => {
  const value = text(env, name)
  if (value == null || value === 'false') return false
  if (value === 'true') return true
  throw new Error(`${name} must be true or false`)
}

/** The environment variables of one source start with this: `supplier-a` reads `EPCIS_SOURCE_SUPPLIER_A_URL` and the rest. */
export const sourceVariablePrefix = (sourceId: string): string => `EPCIS_SOURCE_${sourceId.toUpperCase().replace(/-/g, '_')}_`

/**
 * Read the configured sources. A setting that cannot be used stops the start
 * and is named. Its value is never part of the message, because one of them
 * is a credential.
 */
export function loadEpcisSources(env: NodeJS.ProcessEnv): EpcisSourceConfig[] {
  const ids = list(env, 'EPCIS_SOURCES')
  const seen = new Set<string>()
  return ids.map((sourceId) => {
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(sourceId)) throw new Error('EPCIS_SOURCES holds a name that is not 1 to 32 lower-case letters, digits and hyphens')
    const prefix = sourceVariablePrefix(sourceId)
    // Two names that differ only in case or punctuation would read the same variables.
    if (seen.has(prefix)) throw new Error(`EPCIS_SOURCES names ${sourceId} twice`)
    seen.add(prefix)

    const address = text(env, `${prefix}URL`)
    if (address == null) throw new Error(`${prefix}URL is not set: the source ${sourceId} needs the address of its EPCIS query interface`)
    let url: URL
    try {
      url = new URL(address)
    } catch {
      throw new Error(`${prefix}URL does not parse as an address`)
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`${prefix}URL must be an https address, or an http one with ${prefix}LOCAL_TEST=true`)
    if (url.username !== '' || url.password !== '') throw new Error(`${prefix}URL carries user information: set the credential in ${prefix}BEARER_TOKEN, ${prefix}BASIC_USER and ${prefix}BASIC_PASSWORD, or ${prefix}HEADER_NAME and ${prefix}HEADER_VALUE`)
    if (url.search !== '' || url.hash !== '') throw new Error(`${prefix}URL carries a query or a fragment: give the base address only`)
    const localTest = flag(env, `${prefix}LOCAL_TEST`)
    if (url.protocol === 'http:' && !localTest) throw new Error(`${prefix}URL is a plain http address: use https, or set ${prefix}LOCAL_TEST=true for a source on your own machine`)

    const origins = list(env, `${prefix}ORIGINS`)
    for (const origin of origins) {
      let parsed: URL | undefined
      try {
        parsed = new URL(origin)
      } catch {
        // Reported below.
      }
      if (parsed == null || parsed.origin !== origin) throw new Error(`${prefix}ORIGINS holds an entry that is not an origin: each is a scheme, a host and a port, such as https://events.example.org`)
    }

    const bearer = text(env, `${prefix}BEARER_TOKEN`)
    const basicUser = text(env, `${prefix}BASIC_USER`)
    const basicPassword = text(env, `${prefix}BASIC_PASSWORD`)
    const headerName = text(env, `${prefix}HEADER_NAME`)
    const headerValue = text(env, `${prefix}HEADER_VALUE`)
    if ((basicUser == null) !== (basicPassword == null)) throw new Error(`${prefix}BASIC_USER and ${prefix}BASIC_PASSWORD are set together`)
    if ((headerName == null) !== (headerValue == null)) throw new Error(`${prefix}HEADER_NAME and ${prefix}HEADER_VALUE are set together`)
    if ([bearer, basicUser, headerName].filter((value) => value != null).length > 1) throw new Error(`the source ${sourceId} has more than one credential set: use ${prefix}BEARER_TOKEN, or the BASIC pair, or the HEADER pair`)
    const credential: EpcisSourceCredential | undefined =
      bearer != null
        ? { scheme: 'bearer', token: bearer }
        : basicUser != null && basicPassword != null
          ? { scheme: 'basic', username: basicUser, password: basicPassword }
          : headerName != null && headerValue != null
            ? { scheme: 'header', name: headerName, value: headerValue }
            : undefined

    return {
      sourceId,
      baseUrl: `${url.origin}${url.pathname.replace(/\/+$/, '')}`,
      permittedOrigins: origins.length === 0 ? [url.origin] : origins,
      localTest,
      repeatListParameters: flag(env, `${prefix}REPEAT_LISTS`),
      ...(credential == null ? {} : { credentialScheme: credential.scheme, credentials: () => credential }),
    }
  })
}

export function describeEpcisSource(source: EpcisSourceConfig): EpcisSourceDescription {
  const origin = new URL(source.baseUrl).origin
  return {
    sourceId: source.sourceId,
    baseUrl: source.baseUrl,
    permittedOrigins: source.permittedOrigins,
    localTest: source.localTest,
    repeatListParameters: source.repeatListParameters,
    credentialConfigured: source.credentials != null,
    ...(source.credentialScheme == null ? {} : { credentialScheme: source.credentialScheme }),
    // The pull itself refuses this before it asks for anything. Saying so here lets an operator see it without running one.
    ...(source.permittedOrigins.includes(origin) ? {} : { problem: `its permitted origins do not list ${origin}, the origin of its own base address, so every pull is refused` }),
  }
}
