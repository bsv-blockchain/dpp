// Keeps a test's network to the services the test itself started. Every way
// out of the process is replaced: `fetch`, a name lookup, a TCP or TLS
// connection and a datagram. A connection to this machine's loopback address
// on a port the test allowed goes through. Anything else is written down and
// refused, so a test asserts afterwards that nothing was attempted, and an
// attempt fails the test even where the code that made it caught the error
// and carried on.
//
// The replacements are made on the objects Node's own modules share, so they
// also reach a library that loaded `node:net` or `node:dns` before the guard
// was installed. A connection that was already open when the guard went on is
// not touched: the guard decides about new ones.
import dgram from 'node:dgram'
import dns from 'node:dns'
import net from 'node:net'

export interface NetworkGuard {
  /** Every attempt that was refused: what was tried, and where to. */
  attempts: string[]
  /** Permit new connections to this port of the loopback address. */
  allow(port: number | string): void
  /** Puts back everything the guard replaced. */
  restore(): void
}

type Patchable = Record<string, unknown>
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '[::1]'])

/** The host and port a `connect` call names, in any of the forms Node takes them. */
function targetOf(args: unknown[]): { host: string; port: string } {
  const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0]
  if (first !== null && typeof first === 'object') {
    const options = first as { host?: unknown; hostname?: unknown; port?: unknown; path?: unknown }
    if (options.path != null) return { host: `unix:${String(options.path)}`, port: '' }
    return { host: String(options.host ?? options.hostname ?? 'localhost'), port: String(options.port ?? '') }
  }
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: String(first) }
  return { host: `unix:${String(first)}`, port: '' }
}

export function guardNetwork(): NetworkGuard {
  const attempts: string[] = []
  const ports = new Set<string>()
  const undo: Array<() => void> = []
  const permitted = (host: string, port: string): boolean => LOOPBACK.has(host) && ports.has(port)

  const connect = net.Socket.prototype.connect
  ;(net.Socket.prototype as unknown as Patchable).connect = function (this: net.Socket, ...args: unknown[]): unknown {
    const { host, port } = targetOf(args)
    if (!permitted(host, port)) {
      attempts.push(`connect ${host}:${port}`)
      throw new Error(`the network is kept to this test's own services: connect ${host}:${port}`)
    }
    return (connect as (...inner: unknown[]) => unknown).apply(this, args)
  }
  undo.push(() => {
    net.Socket.prototype.connect = connect
  })

  const patchLookup = (owner: Patchable, name: string, label: string): void => {
    const original = owner[name]
    if (typeof original !== 'function') return
    owner[name] = function (this: unknown, ...args: unknown[]): unknown {
      const host = String(args[0])
      if (!LOOPBACK.has(host) && !net.isIP(host)) {
        attempts.push(`${label} ${host}`)
        throw new Error(`the network is kept to this test's own services: ${label} ${host}`)
      }
      return (original as (...inner: unknown[]) => unknown).apply(this, args)
    }
    undo.push(() => {
      owner[name] = original
    })
  }
  for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny']) {
    patchLookup(dns as unknown as Patchable, name, `dns.${name}`)
    patchLookup(dns.promises as unknown as Patchable, name, `dns.promises.${name}`)
  }

  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const port = url.port !== '' ? url.port : url.protocol === 'https:' ? '443' : '80'
    if (!permitted(url.hostname, port)) {
      attempts.push(`fetch ${url.origin}`)
      throw new TypeError(`the network is kept to this test's own services: fetch ${url.origin}`)
    }
    return await realFetch(input, init)
  }) as typeof globalThis.fetch
  undo.push(() => {
    globalThis.fetch = realFetch
  })

  for (const name of ['send', 'connect']) {
    const owner = dgram.Socket.prototype as unknown as Patchable
    const original = owner[name]
    owner[name] = function (): never {
      attempts.push(`datagram ${name}`)
      throw new Error(`the network is kept to this test's own services: datagram ${name}`)
    }
    undo.push(() => {
      owner[name] = original
    })
  }

  return {
    attempts,
    allow: (port) => void ports.add(String(port)),
    restore: () => {
      for (const put of undo.reverse()) put()
    },
  }
}
