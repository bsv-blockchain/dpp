import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Monitor, Task, Wallet } from '@bsv/wallet-toolbox'
import { expect, it, vi } from 'vitest'
import { openToolboxWallet } from '../src/wallet.js'

it('starts only the header and proof tasks for the wallet and stops the monitor before closing', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'dpp-wallet-monitor-'))
  // Capture the real scheduler before its first network poll.
  let finish!: () => void
  const active = new Promise<void>(resolve => { finish = resolve })
  const started = vi.spyOn(Monitor.prototype, 'startTasks').mockReturnValue(active)
  const stopped = vi.spyOn(Monitor.prototype, 'stopTasks')
  const destroyed = vi.spyOn(Wallet.prototype, 'destroy')
  try {
    const wallet = await openToolboxWallet({ network: 'test', rootKeyHex: '11'.repeat(32), filePath: join(folder, 'wallet.sqlite') })
    try {
      expect(started).toHaveBeenCalledOnce()
      const monitor = started.mock.instances[0]!
      expect(monitor._tasks.map(task => task.constructor)).toEqual([Task.TaskNewHeader, Task.TaskCheckForProofs])
      expect(monitor.options.maxRebroadcastAttempts).toBe(0)
    } finally {
      const closing = wallet.close()
      try {
        expect(stopped.mock.instances).toEqual(started.mock.instances)
        expect(destroyed).not.toHaveBeenCalled()
      } finally {
        finish()
        await closing
      }
    }
    expect(destroyed).toHaveBeenCalledOnce()
  } finally {
    vi.restoreAllMocks()
    rmSync(folder, { recursive: true, force: true })
  }
})
