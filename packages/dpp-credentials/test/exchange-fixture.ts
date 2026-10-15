/**
 * The generator of `fixtures/vectors/dpp/interoperability/external-credential/v1.json`:
 * neutral, independently constructed vectors for the `vc-di-ecdsa-rdfc-2019@1`
 * profile. Keys derive from published fixed scalars, so a reader in any
 * language rebuilds the same key pairs; the ECDSA signatures use the Web
 * Crypto random nonce, so `REGENERATE_FIXTURES=1` produces fresh proof values
 * and the pinned file is what the vector test verifies. Nothing derived from
 * these keys will ever hold value.
 */
import { createECDH, createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import jsigs from 'jsonld-signatures';
import { DataIntegrityProof } from '@digitalbazaar/data-integrity';
import { cryptosuite as ecdsaRdfc2019 } from '@digitalbazaar/ecdsa-rdfc-2019-cryptosuite';
import * as EcdsaMultikey from '@digitalbazaar/ecdsa-multikey';
import { createExternalDocumentLoader, DATA_INTEGRITY_V2_CONTEXT, DID_V1_CONTEXT, EXTERNAL_PASSPORT_CONTEXT_URL, MULTIKEY_V1_CONTEXT, VC_V2_CONTEXT } from '../src/exchange.js';
import type { JsonObject } from '../src/types.js';

export const NOW = '2026-09-06T12:00:00Z';
export const ISSUER = 'did:web:issuer.example';
export const OTHER = 'did:web:other.example';
export const STATUS_LIST = 'https://issuer.example/status/1';
export const STATUS_INDEX = 7;
export const PASSPORT_ID = 'https://id.example.org/01/09520123456788/21/SERIAL-0001';
/** A second identifier the same object is known by, related to the passport only through the binding policy. */
export const ALIAS_SUBJECT = 'urn:example:object:serial-0001';

/** The mod-10 check digit, so the demonstration GTIN above is a valid one under prefix 952. */
export function gs1CheckDigit(digits: string): number {
  let sum = 0, weight = 3;
  for (let i = digits.length - 1; i >= 0; i--) { sum += Number(digits[i]) * weight; weight = weight === 3 ? 1 : 3; }
  return (10 - (sum % 10)) % 10;
}

export interface FixtureKey { id: string; controller: string; curve: 'P-256' | 'P-384'; fill: number }
/** The published scalars: each key's secret is one byte repeated to the curve's length. */
export const KEYS: Record<'issuer' | 'issuerUnauthorised' | 'other' | 'issuerP384', FixtureKey> = {
  issuer: { id: `${ISSUER}#key-1`, controller: ISSUER, curve: 'P-256', fill: 0x11 },
  issuerUnauthorised: { id: `${ISSUER}#key-2`, controller: ISSUER, curve: 'P-256', fill: 0x22 },
  other: { id: `${OTHER}#key-1`, controller: OTHER, curve: 'P-256', fill: 0x33 },
  issuerP384: { id: `${ISSUER}#key-384`, controller: ISSUER, curve: 'P-384', fill: 0x44 },
};

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

export async function keyPair(key: FixtureKey): Promise<any> {
  const size = key.curve === 'P-256' ? 32 : 48;
  const secret = Buffer.alloc(size, key.fill);
  const ecdh = createECDH(key.curve === 'P-256' ? 'prime256v1' : 'secp384r1');
  ecdh.setPrivateKey(secret);
  const pub = ecdh.getPublicKey();
  const jwk = { kty: 'EC', crv: key.curve, x: b64(pub.subarray(1, 1 + size)), y: b64(pub.subarray(1 + size)), d: b64(secret) };
  return EcdsaMultikey.fromJwk({ jwk, secretKey: true, id: key.id, controller: key.controller });
}

export interface Fixture {
  keys: Record<string, any>;
  /** Public key documents and DID documents, pinned by identifier. */
  documents: Map<string, JsonObject>;
  /** The published secrets, one per key. */
  secrets: Record<string, { id: string; controller: string; curve: string; publicKeyMultibase: string; secretKeyMultibase: string }>;
}

export async function fixture(): Promise<Fixture> {
  const keys: Record<string, any> = {};
  const documents = new Map<string, JsonObject>();
  const secrets: Fixture['secrets'] = {};
  for (const [name, spec] of Object.entries(KEYS)) {
    const pair = await keyPair(spec);
    keys[name] = pair;
    const exported = await pair.export({ publicKey: true, includeContext: true });
    documents.set(spec.id, exported);
    secrets[name] = { id: spec.id, controller: spec.controller, curve: spec.curve, publicKeyMultibase: pair.publicKeyMultibase, secretKeyMultibase: pair.secretKeyMultibase };
  }
  const method = (name: string): JsonObject => { const { '@context': _c, ...rest } = documents.get(KEYS[name as keyof typeof KEYS].id) as JsonObject; return rest; };
  documents.set(ISSUER, {
    '@context': [DID_V1_CONTEXT, MULTIKEY_V1_CONTEXT], id: ISSUER,
    verificationMethod: [method('issuer'), method('issuerUnauthorised'), method('issuerP384')],
    // key-2 is a key the issuer holds and has not authorised for assertion.
    assertionMethod: [KEYS.issuer.id, KEYS.issuerP384.id],
  });
  documents.set(OTHER, { '@context': [DID_V1_CONTEXT, MULTIKEY_V1_CONTEXT], id: OTHER, verificationMethod: [method('other')], assertionMethod: [KEYS.other.id] });
  return { keys, documents, secrets };
}

export function unsignedPassport(overrides: Partial<JsonObject> = {}): JsonObject {
  return {
    '@context': [VC_V2_CONTEXT, EXTERNAL_PASSPORT_CONTEXT_URL],
    type: ['VerifiableCredential', 'ProductPassportCredential'],
    id: 'urn:uuid:5c1f5a7e-1b2a-4f5e-9a1d-000000000001',
    issuer: ISSUER,
    validFrom: '2026-09-01T00:00:00Z',
    validUntil: '2027-09-01T00:00:00Z',
    credentialStatus: { id: `${STATUS_LIST}#${STATUS_INDEX}`, type: 'BitstringStatusListEntry', statusPurpose: 'revocation', statusListIndex: String(STATUS_INDEX), statusListCredential: STATUS_LIST },
    credentialSubject: { id: PASSPORT_ID, productName: 'Demonstration battery module', manufacturer: 'Example Batteries', massKg: 12.5, recycledContentDeclared: false },
    ...overrides,
  };
}

export async function sign(document: JsonObject, key: any, documentLoader: ReturnType<typeof createExternalDocumentLoader>, created = '2026-09-01T00:00:00Z'): Promise<JsonObject> {
  const suite = new DataIntegrityProof({ signer: key.signer(), cryptosuite: ecdsaRdfc2019, date: created });
  return jsigs.sign(structuredClone(document), { suite, purpose: new jsigs.purposes.AssertionProofPurpose(), documentLoader });
}

/** A Bitstring status list credential of 16 KiB with the named bits set, issued by `issuer` and signed by `key`. */
export async function statusList(issuer: string, key: any, documentLoader: ReturnType<typeof createExternalDocumentLoader>, setBits: number[] = [], id = STATUS_LIST): Promise<JsonObject> {
  const bytes = Buffer.alloc(16384);
  for (const bit of setBits) bytes[Math.floor(bit / 8)] |= 1 << (7 - bit % 8);
  const credential: JsonObject = {
    '@context': [VC_V2_CONTEXT], type: ['VerifiableCredential', 'BitstringStatusListCredential'], id, issuer,
    validFrom: '2026-09-06T00:00:00Z', validUntil: '2026-09-13T00:00:00Z',
    credentialSubject: { id: `${id}#list`, type: 'BitstringStatusList', statusPurpose: 'revocation', encodedList: `u${gzipSync(bytes).toString('base64url')}` },
  };
  return sign(credential, key, documentLoader, '2026-09-06T00:00:00Z');
}

export const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
export const CONTEXT_CONSTANTS = { VC_V2_CONTEXT, DATA_INTEGRITY_V2_CONTEXT, EXTERNAL_PASSPORT_CONTEXT_URL };
