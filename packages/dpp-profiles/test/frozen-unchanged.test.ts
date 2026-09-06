import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateAll, readManifests } from '../scripts/build.mjs'

/**
 * The digests every version 1 manifest and generated file carried before
 * the generator learnt manifest version 2, copied here as constants. A
 * change to any of them means the generator's output for a frozen version
 * moved, which no addition to the generator may do; a new profile version
 * adds entries and never touches these.
 */
const FROZEN_BEFORE_VERSION_2 = {
  manifests: {
    'battery@2': 'a697852aba912b2f54193aaa0eac3990f49dd69364b555f5485bb30289b32aaf',
    'general@1': 'ef895946e243a9fdb7b0f303e7624038d0eb41e00da0ec8c894538f92effe37e',
    'general@2': '70bbcaa8d145dd8928dcc61fc5e44343784c97d71783695e2b46cf91531b1c7d',
    'textile@1': '6fae1897b61de2269eb9507a2437f93b0f9cfc0a13239b83359a04299a0271df',
    'textile@2': '9aacfd62d465a82a8f4ae2a41c5ee4257c2b4943faf006e7f85a1e3ca2e8630e',
  },
  generated: {
    'generated/payload-schema/battery@2.public.schema.json': '4821b02554856db8bb3be9c8cc77c4e6222314ea623d0aec25898c4aba3a9e77',
    'generated/payload-schema/battery@2.restricted.schema.json': 'cc47f831e4b71f686c0623d961bb6a868b6e4dd117204983792d7af8dfb91ac8',
    'generated/consumer/battery-v2.json': '244ac5038d0c3bfd60e541621d4fae5e9839addb756959253f71e29d89da3dda',
    'generated/mapping/battery@2.md': 'c6398774469b4d8b289e9f54605e6f43ddf12eb3adabf0720723c1be091825e9',
    'generated/payload-schema/general@1.public.schema.json': '57ea63b53d5d52371cbea3f93c1771aace73cf88cd07263fb70480efeb6802a9',
    'generated/payload-schema/general@1.restricted.schema.json': 'd7411945df53d498ac188dd74c9b77bddac14e1a9cbe9fb6f0cc441acbb2deb2',
    'generated/consumer/general-v1.json': 'e843346122ed595e75850c2063b81791fd113252e07fd746840b86026253b567',
    'generated/payload-schema/general@2.public.schema.json': 'fa82ad26b73ddfb99b7fea20b464b20c6f2e4c58ef750f567c880f83f5fa8a6c',
    'generated/payload-schema/general@2.restricted.schema.json': '4960025fb10a0fd274f9527ca1d0184adf22621d950a0a72dad6c339639c6c1f',
    'generated/consumer/general-v2.json': '769a433f1d53344c7e7ea36cd2bc79fd449a6ca04ebeb0f3881f029d6ed12696',
    'generated/mapping/general@2.md': '2676806923b2b2a10d5a6259be244fffc1f38de480964cb57cd468d51a055ae3',
    'generated/payload-schema/textile@1.public.schema.json': '6017bf5df2259def03169dfd9e538e05dd7fdb77095e0fc45eac997426d6bc4d',
    'generated/payload-schema/textile@1.restricted.schema.json': '45e2b89c1289aee98fec03800b623c9ea9d4158ac178e9d84164018399812fc2',
    'generated/consumer/textile-v1.json': '0f446466586421588093798b0d803a2af031553cc61004033b252da4546af885',
    'generated/payload-schema/textile@2.public.schema.json': '521e102aff8dd621d98e5f0b5b6cafe075b3c445db05903d207e6f3d32005905',
    'generated/payload-schema/textile@2.restricted.schema.json': '07ad1f72900cda3ff4e03adbad956402ab3eb60d0df444d7034abc28aa0e4819',
    'generated/consumer/textile-v2.json': 'c63cd9a7be8e66d8f75f00432e65c6901156cda71f47d3de542b5093d1d41ebe',
    'generated/mapping/textile@2.md': 'b8aee76d29b4b82a4cee4f9994fe543bd04b3e09002e958711dc5493e0d926fd',
  },
} as const

const root = join(import.meta.dirname, '..')
const sha256 = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex')

describe('the version 1 profiles are unchanged by the generator that reads version 2', () => {
  it('every version 1 manifest still has the digest it was frozen at', () => {
    for (const [profile, digest] of Object.entries(FROZEN_BEFORE_VERSION_2.manifests)) {
      expect(sha256(readFileSync(join(root, 'manifests', `${profile}.json`))), profile).toBe(digest)
    }
  })

  it('every generated file of a version 1 profile is regenerated to exactly its frozen digest', () => {
    const fresh = generateAll(readManifests())
    for (const [relative, digest] of Object.entries(FROZEN_BEFORE_VERSION_2.generated)) {
      expect(sha256(fresh.get(relative) as string), relative).toBe(digest)
      expect(sha256(readFileSync(join(root, relative))), `${relative} on disk`).toBe(digest)
    }
  })

  it('frozen.json still records those digests, whatever it has gained since', () => {
    const frozen = JSON.parse(readFileSync(join(root, 'frozen.json'), 'utf8')) as { manifests: Record<string, string>; generated: Record<string, string> }
    for (const [profile, digest] of Object.entries(FROZEN_BEFORE_VERSION_2.manifests)) expect(frozen.manifests[profile], profile).toBe(digest)
    for (const [relative, digest] of Object.entries(FROZEN_BEFORE_VERSION_2.generated)) expect(frozen.generated[relative], relative).toBe(digest)
  })
})
