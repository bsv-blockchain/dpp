import { createHash } from 'node:crypto'
import type { BindingArtefact, ProfileBinding } from '../src/index.js'

// A binding built in the test, so the format's tests do not depend on any
// profile's files. Every GTIN here sits under GS1's demonstration prefix 952.

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

/** The files the synthetic binding names, by path. */
export const SYNTHETIC_FILES: Record<string, string> = {
  'product.schema.json': JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://profiles.example/lamp/v1/product.schema.json',
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name'],
    properties: {
      // The schema says nothing about contexts: which ones a document may name is the binding's rule.
      '@context': {},
      id: { type: 'string' },
      '@id': { type: 'string' },
      name: { type: 'string', minLength: 1 },
      gtin: { type: 'string' },
      serialNumber: { type: 'string' },
      granularity: { type: 'string' },
      model: { type: 'string' },
      batch: { type: 'string' },
      lumens: { type: 'integer', minimum: 1 },
    },
  }),
  'context.jsonld': JSON.stringify({ '@context': { id: '@id', lamp: 'https://profiles.example/lamp/v1#', name: 'lamp:name', lumens: 'lamp:lumens' } }),
  'shapes.ttl': '@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix lamp: <https://profiles.example/lamp/v1#> .\nlamp:LampShape a sh:NodeShape ; sh:targetSubjectsOf lamp:name ; sh:property [ sh:path lamp:lumens ; sh:minCount 1 ] .\n',
  'background.ttl': '@prefix lamp: <https://profiles.example/lamp/v1#> .\nlamp:Lamp a <http://www.w3.org/2000/01/rdf-schema#Class> .\n',
}

export const SYNTHETIC_CONTEXT_URI = 'https://profiles.example/lamp/v1/context.jsonld'

const artefact = (role: BindingArtefact['role'], path: string, mediaType: string, uri?: string): BindingArtefact => {
  const bytes = utf8(SYNTHETIC_FILES[path]!)
  return { role, path, ...(uri == null ? {} : { uri }), mediaType, byteLength: bytes.byteLength, sha256: sha256Hex(bytes), licence: 'Apache-2.0' }
}

/** A binding that uses every step. Each call returns a fresh object, so a test may change its copy. */
export function syntheticBinding(): ProfileBinding {
  return {
    bindingVersion: '1',
    id: 'example-lamp',
    version: 1,
    profile: 'example-lamp@1',
    title: 'Example lamp, serialised item',
    scope: 'A test profile. The name states the data model only and makes no claim about any product.',
    publisher: { name: 'Test publisher', registration: 'local' },
    source: { name: 'This test', licence: 'Apache-2.0', notices: [] },
    granularity: 'item',
    payload: { root: '/product', mediaType: 'application/ld+json', documents: 'one-self-contained' },
    artefacts: [
      artefact('schema', 'product.schema.json', 'application/schema+json'),
      artefact('context', 'context.jsonld', 'application/ld+json', SYNTHETIC_CONTEXT_URI),
      artefact('shapes', 'shapes.ttl', 'text/turtle'),
      artefact('background', 'background.ttl', 'text/turtle'),
    ],
    validation: {
      steps: ['json-schema', 'json-ld-expand', 'shacl', 'passport-identity'],
      engine: { requires: ['json-schema-2020-12', 'shacl-core', 'shacl-sparql-constraints'] },
      blockingSeverities: ['Violation'],
    },
    identity: {
      scheme: 'gs1-digital-link',
      comparison: 'gs1-key-tuple',
      subject: { pointers: ['/product/id', '/product/@id'], keys: ['01', '21'] },
      mustEqual: [
        { pointer: '/product/gtin', part: 'gtin' },
        { pointer: '/product/serialNumber', part: 'serial' },
      ],
      mustNotContradict: [{ pointer: '/product/model' }],
      granularityMember: { pointer: '/product/granularity', whenPresent: 'item' },
      related: [{ pointer: '/product/batch', relation: 'batch' }],
    },
    vectors: { positive: ['vectors/positive.json'], negative: ['vectors/negative.json'] },
    baseline: 'native-baseline@2',
    roles: ['passport-writer', 'passport-reader'],
  }
}

/** The properties the synthetic access split makes public. `lumens` and `batch` are left out, so they are restricted. */
export const SYNTHETIC_PUBLIC = ['@context', 'id', '@id', 'name', 'gtin', 'serialNumber', 'granularity', 'model']

/** The synthetic binding with a public and a restricted tier, under an identifier of its own. */
export function syntheticAccessBinding(): ProfileBinding {
  return { ...syntheticBinding(), id: 'example-lamp-tiers', profile: 'example-lamp-tiers@1', access: { policy: 'example-lamp-access@1', tierSplit: 'top-level-property', default: 'restricted', public: [...SYNTHETIC_PUBLIC] } }
}

/** The exact bytes a binding is registered and digested as. */
export const bindingBytes = (binding: unknown): Uint8Array => utf8(JSON.stringify(binding, null, 2) + '\n')

/** The caller's side of registration: the synthetic files by artefact path. */
export const resolveSynthetic = (a: BindingArtefact): Uint8Array | undefined => (a.path in SYNTHETIC_FILES ? utf8(SYNTHETIC_FILES[a.path]!) : undefined)
