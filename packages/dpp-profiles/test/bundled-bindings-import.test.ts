import { describe, expect, it, vi } from 'vitest'

// The bundled bindings are more than a megabyte of contexts and shapes, and
// most users of the package never validate against them. Importing the
// package therefore reads none of them: the files are read when
// `registerBundledBindings` is called, and not before. The file system is
// counted here to hold that.
const reads = vi.hoisted(() => ({ paths: [] as string[] }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const readFileSync = ((...args: Parameters<typeof actual.readFileSync>) => { reads.paths.push(String(args[0])); return actual.readFileSync(...args) }) as typeof actual.readFileSync
  return { ...actual, default: { ...actual, readFileSync }, readFileSync }
})

describe('importing the package loads no bundled binding', () => {
  it('reads no file at import, and reads the binding folders only when asked to register them', async () => {
    const { BUNDLED_BINDINGS, BUNDLED_BINDING_DIGESTS, createProfileRegistry, registerBundledBindings } = await import('../src/index.js')
    expect(BUNDLED_BINDINGS.map((entry) => entry.profile)).toEqual(['eu-battery@1', 'eu-textile@1', 'eu-battery@2', 'eu-textile@2'])
    expect(reads.paths).toEqual([])

    const registry = createProfileRegistry({ trustedBindingDigests: BUNDLED_BINDING_DIGESTS })
    expect(reads.paths).toEqual([])
    expect(registry.list().filter((p) => p.format === 'binding')).toEqual([])

    const results = await registerBundledBindings(registry, { profiles: ['eu-textile@1'] })
    expect(results.map((r) => r.ok)).toEqual([true])
    // The binding and its six artefacts, of the one profile asked for.
    expect(reads.paths.length).toBe(7)
    expect(reads.paths.every((path) => path.includes('/bindings/eu-textile@1/'))).toBe(true)
  })
})
