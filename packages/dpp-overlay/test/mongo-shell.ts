import { createContext, Script } from 'node:vm'
import { MessageChannel, Worker, receiveMessageOnPort, type MessagePort } from 'node:worker_threads'

/**
 * A database shell for rehearsing documented commands: it runs a block of
 * shell JavaScript, exactly as a page prints it, against a real MongoDB.
 *
 * A documented block is written for `mongosh`, where every call answers
 * before the next line runs: `db.records.deleteMany(filter).deletedCount`
 * reads a number, not a promise. The Node driver answers later. So the
 * driver runs on a thread of its own (`mongo-shell-worker.mjs`) and this
 * thread waits for each answer, which lets a block run unchanged. Rewriting
 * the block to await its calls would test the rewrite and not the page.
 *
 * The shell knows only the calls the documented commands make: `find` with
 * `sort` and `forEach`, `aggregate` with `forEach`, `distinct`,
 * `countDocuments` and `deleteMany`, and `printjson`. Any other call throws
 * and names itself, so a page that starts using one fails its rehearsal
 * until the call is added here on purpose.
 *
 * Every block of a session runs as a script in one shared global scope, with
 * no rewriting. That is the strictest rule a shell can apply to names: one
 * that a block declares with `const` or `let` cannot be declared again by a
 * later block, so a page whose blocks do that fails here. Whether a given
 * shell is more lenient does not matter to a page that passes.
 */
export interface MongoShell {
  /** Runs one block in the shell's session and returns what it printed with `printjson`, in order. */
  run(code: string): unknown[]
  close(): void
}

type Reply = { ok: true; value: unknown } | { ok: false; message: string }

const ANSWER_WITHIN_MS = 30_000

export function openMongoShell(uri: string, database: string): MongoShell {
  const signal = new SharedArrayBuffer(4)
  const flag = new Int32Array(signal)
  const { port1, port2 } = new MessageChannel()
  const worker = new Worker(new URL('./mongo-shell-worker.mjs', import.meta.url), { workerData: { uri, database, signal, port: port2 }, transferList: [port2] })
  // The worker and the port must not keep the test process alive, and a failure there surfaces as an unanswered call.
  worker.unref()
  ;(port1 as MessagePort).unref()

  const call = (request: Record<string, unknown>): unknown => {
    Atomics.store(flag, 0, 0)
    port1.postMessage(request)
    if (Atomics.wait(flag, 0, 0, ANSWER_WITHIN_MS) === 'timed-out') throw new Error(`the database did not answer ${String(request.op)} within ${ANSWER_WITHIN_MS / 1000} seconds`)
    const reply = receiveMessageOnPort(port1)?.message as Reply | undefined
    if (reply == null) throw new Error(`no answer arrived for ${String(request.op)}`)
    if (!reply.ok) throw new Error(reply.message)
    return reply.value
  }

  const collection = (name: string): object => {
    const calls: Record<string, (...args: any[]) => unknown> = {
      find: (filter?: object, projection?: object) => {
        let sort: object | undefined
        const fetch = (): unknown[] => call({ op: 'find', collection: name, filter, projection, sort }) as unknown[]
        const cursor = { sort: (spec: object) => { sort = spec; return cursor }, forEach: (visit: (document: unknown) => void) => { for (const document of fetch()) visit(document) }, toArray: fetch }
        return cursor
      },
      aggregate: (pipeline: object[]) => {
        const fetch = (): unknown[] => call({ op: 'aggregate', collection: name, pipeline }) as unknown[]
        return { forEach: (visit: (document: unknown) => void) => { for (const document of fetch()) visit(document) }, toArray: fetch }
      },
      distinct: (field: string, filter?: object) => call({ op: 'distinct', collection: name, field, filter }),
      countDocuments: (filter?: object) => call({ op: 'countDocuments', collection: name, filter }),
      deleteMany: (filter: object) => {
        // A real shell refuses a missing filter too. Here it is refused before the database is asked.
        if (filter == null || typeof filter !== 'object') throw new Error(`db.${name}.deleteMany needs a filter`)
        return call({ op: 'deleteMany', collection: name, filter })
      },
    }
    return new Proxy(calls, {
      get: (target, method) => {
        if (typeof method !== 'string' || Object.hasOwn(target, method)) return Reflect.get(target, method)
        throw new Error(`the rehearsal shell does not implement db.${name}.${method}: add it to test/mongo-shell.ts before a documented command uses it`)
      },
    })
  }

  const printed: unknown[] = []
  const context = createContext({
    db: new Proxy({}, { get: (_target, name) => (typeof name === 'string' ? collection(name) : undefined) }),
    // What a reader of the shell would see, as plain values of this realm.
    printjson: (value: unknown) => { printed.push(JSON.parse(JSON.stringify(value))) },
  })

  return {
    run: (code) => {
      printed.length = 0
      try {
        new Script(code).runInContext(context)
      } catch (cause) {
        // An error thrown inside the block belongs to the block's own realm. It is passed on as one of this realm, with its message.
        throw new Error(cause != null && typeof (cause as { message?: unknown }).message === 'string' ? (cause as { message: string }).message : String(cause))
      }
      return [...printed]
    },
    close: () => {
      try { call({ op: 'close' }) } finally { void worker.terminate() }
    },
  }
}

/** One fenced block of a documentation page, with the headings it sits under. */
export interface DocumentedBlock {
  /** The second-level heading, then the third-level one where there is one. */
  headings: string[]
  language: string
  code: string
}

/** Every fenced code block of a Markdown page, in order, each with its second and third level headings. */
export function documentedBlocks(markdown: string): DocumentedBlock[] {
  const blocks: DocumentedBlock[] = []
  let second: string | undefined
  let third: string | undefined
  let open: { language: string; lines: string[] } | undefined
  for (const line of markdown.split('\n')) {
    if (open != null) {
      if (line.trim() === '```') {
        blocks.push({ headings: [second, third].filter((heading): heading is string => heading != null), language: open.language, code: `${open.lines.join('\n')}\n` })
        open = undefined
      } else open.lines.push(line)
      continue
    }
    const fence = /^```([a-z]*)$/u.exec(line.trim())
    if (fence != null) { open = { language: fence[1]!, lines: [] }; continue }
    if (line.startsWith('## ')) { second = line.slice(3).trim(); third = undefined }
    else if (line.startsWith('### ')) third = line.slice(4).trim()
  }
  if (open != null) throw new Error('the page ends inside a code block')
  return blocks
}
