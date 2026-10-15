import { Ed25519VerificationKey2020 } from '@digitalbazaar/ed25519-verification-key-2020';
import * as Bls from '@digitalbazaar/bls12-381-multikey';
import { createDocumentLoader, SEAL_CONTEXTS } from '../src/context.js';
import type { Seal, JsonObject } from '../src/types.js';
export const NOW = '2026-09-05T12:00:00Z';
export const ISSUER = 'did:web:issuer.example';
export async function fixtureKeys() {
  const ed = await Ed25519VerificationKey2020.generate({ id: `${ISSUER}#ed`, controller: ISSUER });
  const bbs = await Bls.generateBbsKeyPair({ algorithm: Bls.ALGORITHMS.BBS_BLS12381_SHA256, id: `${ISSUER}#bbs`, controller: ISSUER });
  const documents = new Map<string, JsonObject>();
  const edPublic = await ed.export({ publicKey: true, includeContext: true });
  const bbsPublic = await bbs.export({ publicKey: true, includeContext: true });
  documents.set(ed.id, edPublic); documents.set(bbs.id, bbsPublic);
  documents.set(ISSUER, { '@context': ['https://www.w3.org/ns/did/v1','https://w3id.org/security/suites/ed25519-2020/v1','https://w3id.org/security/multikey/v1'], id: ISSUER, assertionMethod: [edPublic, bbsPublic] });
  return { ed, bbs, documents, documentLoader: createDocumentLoader(documents) };
}
export function unsignedSeal(keyId = `${ISSUER}#ed`, id = 'urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'): Seal {
  return {
    '@context': [...SEAL_CONTEXTS], type: ['VerifiableCredential','VSC-SEAL'], id,
    issuer: ISSUER, issuanceDate: NOW, validFrom: NOW, validUntil: '2027-09-05T12:00:00Z',
    sealVersion: '1.0', sealTimestamp: NOW, correctionOf: null,
    credentialSubject: { id },
    credentialStatus: { id: 'https://issuer.example/status/1#0', type: 'BitstringStatusListEntry', statusPurpose: 'revocation', statusListIndex: '0', statusListCredential: 'https://issuer.example/status/1' },
    eventVector: {
      what: { productIdentifiers: [{ scheme: 'DID', value: 'did:web:products.example:object:serial:123', schemeAuthority: 'DID Core' }], description: 'Private product detail', quantity: 5, quantityUnit: 'units' },
      when: { eventTime: NOW, recordedAt: NOW, timezone: 'UTC', timePrecision: 'second' },
      where: { jurisdiction: 'AU' }, who: { actorDid: ISSUER, actorRole: 'manufacturer', assertionMethod: keyId },
      how: { eventType: 'ObjectEvent', eventTypeVocab: 'urn:epcis:cbv:v2', businessStep: 'commissioning', disposition: 'active', action: 'ADD' },
    },
    extensions: { '+Dn': {} },
    chainOfCustody: { chainId: 'urn:uuid:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sequenceNumber: 1, parentSeals: [], topology: 'linear' },
  };
}
