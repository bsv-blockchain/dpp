// The duties that run on their own, after the screen that caused them:
// announcing again when the index could not be reached, fetching each
// state's merkle proof once it is mined, and pushing that proof to the
// index. They are read from the journal, never from a separate queue, so
// the journal stays the one source of truth and a retry never rebuilds.
// Run one worker per platform; it is a loop over pending work, not a job
// library.
import { Utils } from '@bsv/sdk'
import type { IndexClient } from './index-client.js'
import type { PassportRecord, Store } from './store.js'
import type { Writer } from './writer.js'

export interface Duty {
  passportId: string
  txid: string
  op: string
  duty: 'announce' | 'prove' | 'push-proof' | 'resolve-interrupted'
  since: string
}

export interface WorkerOptions {
  store: Store
  index: IndexClient
  writer: Writer
  log?: (line: string) => void
}

/** What is still owed for every passport, oldest first. */
export async function pendingDuties(store: Store): Promise<Duty[]> {
  const duties: Duty[] = []
  for (const passport of await store.listPassports()) {
    for (const state of passport.states) {
      if (state.network === 'pending') {
        duties.push({ passportId: passport.passportId, txid: state.txid, op: state.op, duty: 'resolve-interrupted', since: state.timestamp })
        continue
      }
      if (state.network !== 'accepted' && state.network !== 'dry-run') continue
      if (state.index === 'unreachable' || state.index === 'pending') duties.push({ passportId: passport.passportId, txid: state.txid, op: state.op, duty: 'announce', since: state.timestamp })
      if (state.proof == null) duties.push({ passportId: passport.passportId, txid: state.txid, op: state.op, duty: 'prove', since: state.timestamp })
      else if (state.proofPushed !== true) duties.push({ passportId: passport.passportId, txid: state.txid, op: state.op, duty: 'push-proof', since: state.timestamp })
    }
  }
  return duties.sort((a, b) => a.since.localeCompare(b.since))
}

/** One pass over the pending duties. Returns what it did, one line each. */
export async function runDuties(options: WorkerOptions): Promise<string[]> {
  const { store, index, writer } = options
  const log = options.log ?? (() => {})
  const done: string[] = []
  const say = (line: string): void => {
    done.push(line)
    log(line)
  }
  for (const duty of await pendingDuties(store)) {
    const passport = await store.getPassport(duty.passportId)
    const state = passport?.states.find((s) => s.txid === duty.txid)
    if (passport == null || state == null) continue
    // Only the operator can say what became of an interrupted write; it is listed, never guessed.
    if (duty.duty === 'resolve-interrupted') continue
    try {
      if (duty.duty === 'announce') {
        const announced = await index.announce(Utils.toArray(state.beef, 'base64') as number[])
        state.index = announced
        state.refusal = index.lastRefusal
        await store.savePassport(passport)
        say(`${duty.op} ${duty.txid.slice(0, 12)}... announced again: ${announced}${index.lastRefusal == null ? '' : ` (${index.lastRefusal})`}`)
      } else {
        const proven = await writer.prove(passport, duty.txid)
        say(`${duty.op} ${duty.txid.slice(0, 12)}... ${proven ? 'proof held' : 'no proof yet'}`)
      }
    } catch (cause) {
      say(`${duty.op} ${duty.txid.slice(0, 12)}... ${duty.duty} failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
  return done
}

/** Run the duties on an interval until stopped. */
export function startWorker(options: WorkerOptions & { intervalMs?: number }): { stop: () => void } {
  const interval = options.intervalMs ?? 60_000
  let running = false
  let stopped = false
  const tick = async (): Promise<void> => {
    if (running || stopped) return
    running = true
    try {
      await runDuties(options)
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick(), interval)
  void tick()
  return {
    stop: () => {
      stopped = true
      clearInterval(timer)
    },
  }
}

export function summariseJournal(passport: PassportRecord): { states: number; proven: number; pending: number; status: string } {
  const proven = passport.states.filter((s) => s.proof != null && s.proofPushed === true).length
  return { states: passport.states.length, proven, pending: passport.states.length - proven, status: passport.status }
}
