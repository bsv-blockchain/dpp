import dgram from 'node:dgram'
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'

// Turns the network off for a test, and keeps a record of every attempt to
// use it. Each way out of the process is replaced by a function that writes
// the attempt down and throws: `fetch`, a name lookup, a TCP or TLS
// connection, an HTTP request and a datagram. A test then asserts that the
// record is empty, so an attempt fails the test even where the code under
// test caught the error and carried on.
//
// The replacements are made on the objects Node's own modules share, so they
// also reach a library that required `node:net` or `node:dns` before the
// guard was installed.

export interface NetworkGuard {
  /** Every attempt made while the guard was on: what was tried, and the target where one was given. */
  attempts: string[]
  /** Puts back everything the guard replaced. */
  restore(): void
}

type Patchable = Record<string, unknown>

const describeTarget = (args: unknown[]): string => {
  const first = args[0]
  if (typeof first === 'string' || typeof first === 'number') return String(first)
  if (first instanceof URL) return first.href
  if (first !== null && typeof first === 'object') {
    const target = first as { host?: unknown; hostname?: unknown; port?: unknown; path?: unknown; href?: unknown; url?: unknown }
    return String(target.href ?? target.url ?? `${String(target.hostname ?? target.host ?? target.path ?? '')}${target.port == null ? '' : `:${String(target.port)}`}`)
  }
  return ''
}

export function refuseNetwork(): NetworkGuard {
  const attempts: string[] = []
  const undo: Array<() => void> = []
  const replace = (owner: Patchable, name: string, what: string): void => {
    const original = owner[name]
    if (typeof original !== 'function') return
    owner[name] = (...args: unknown[]): never => {
      attempts.push(`${what} ${describeTarget(args)}`.trim())
      throw new Error(`the network is off for this test: ${what}`)
    }
    undo.push(() => { owner[name] = original })
  }

  replace(globalThis as unknown as Patchable, 'fetch', 'fetch')
  for (const name of ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveNs', 'resolveSrv', 'resolveTxt', 'reverse']) {
    replace(dns as unknown as Patchable, name, `dns.${name}`)
    replace(dns.promises as unknown as Patchable, name, `dns.promises.${name}`)
  }
  replace(net.Socket.prototype as unknown as Patchable, 'connect', 'socket connect')
  replace(net as unknown as Patchable, 'connect', 'net.connect')
  replace(net as unknown as Patchable, 'createConnection', 'net.createConnection')
  replace(tls as unknown as Patchable, 'connect', 'tls.connect')
  for (const [module, label] of [[http, 'http'], [https, 'https']] as const) {
    replace(module as unknown as Patchable, 'request', `${label}.request`)
    replace(module as unknown as Patchable, 'get', `${label}.get`)
  }
  for (const name of ['send', 'connect', 'bind']) replace(dgram.Socket.prototype as unknown as Patchable, name, `datagram ${name}`)

  return { attempts, restore: () => { for (const put of undo.reverse()) put() } }
}
