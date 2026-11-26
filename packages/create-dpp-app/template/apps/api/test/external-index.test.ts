import { createServer } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { openPlatform } from '../src/platform.js'

it.each([false, true])('uses the joined index with configured retraction support %s and reports its failure', async (supportsRetraction) => {
  let healthy = true
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(request.url ?? '')
    response.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ publisherPolicy: { publisherKeys: ['configured-provider'] } }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const platform = await openPlatform({ config: loadConfig({ INDEX_URL: url, INDEX_RETRACTION_URL: supportsRetraction ? url : undefined, INDEX_SUBMIT_TOKEN: 'a'.repeat(64), INDEX_CALLBACK_TOKEN: 'b'.repeat(64), LIVE_PUBLISHING: 'false' }), mode: 'test', log: () => {} })
  try {
    expect(platform.index.url).toBe(url)
    expect(platform.index.supportsRetraction).toBe(supportsRetraction)
    expect(await platform.index.publisherKeys()).toEqual(['configured-provider'])
    healthy = false
    await expect(platform.index.publisherKeys()).rejects.toThrow('HTTP 503')
    expect(platform.index.url).toBe(url)
    expect(requests).toEqual(['/capabilities', '/capabilities'])
  } finally {
    await platform.close()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
