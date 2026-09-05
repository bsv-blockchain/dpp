import { beforeAll, describe, expect, it } from 'vitest';
import jsigs from 'jsonld-signatures';
import { Ed25519Signature2020 } from '@digitalbazaar/ed25519-signature-2020';
import { DataIntegrityProof } from '@digitalbazaar/data-integrity';
import { createVerifyCryptosuite } from '@digitalbazaar/bbs-2023-cryptosuite';
import { issueSealEd25519, issueSealBbs, verifyCredentialProof, deriveSealPresentation, verifySealPresentation, presentationHeader } from '../src/crypto.js';
import { validateSealStructure, parseSealBytes } from '../src/validation.js';
import { createDocumentLoader } from '../src/context.js';
import { fixtureKeys, unsignedSeal, NOW, ISSUER } from './fixtures.js';
let keys: Awaited<ReturnType<typeof fixtureKeys>>;
beforeAll(async () => { keys = await fixtureKeys(); });
const binding = { requestId: 'urn:uuid:request', challenge: 'challenge-with-128-bits-of-entropy', verifierDid: 'did:web:verifier.example', holderDid: ISSUER, expiresAt: '2026-09-05T13:00:00Z' };
describe('independent Data Integrity suite interoperability', () => {
  it('issues an Ed25519 credential independently verified by the maintained suite', async () => {
    const seal = await issueSealEd25519({ credential: unsignedSeal(), key: keys.ed, documentLoader: keys.documentLoader });
    expect(validateSealStructure(seal)).toEqual({ valid: true, errors: [] });
    const result = await jsigs.verify(seal, { suite: new Ed25519Signature2020(), purpose: new jsigs.purposes.AssertionProofPurpose(), documentLoader: keys.documentLoader });
    expect(result.verified, JSON.stringify(result.error)).toBe(true);
    expect((await verifyCredentialProof({ credential: seal, documentLoader: keys.documentLoader })).outcome).toBe('verified');
    seal.eventVector.what.quantity = 8;
    expect((await verifyCredentialProof({ credential: seal, documentLoader: keys.documentLoader })).outcome).toBe('invalid');
  });
  it('rejects an otherwise valid signature whose key is not authorised by the claimed issuer', async () => {
    const seal = await issueSealEd25519({ credential: unsignedSeal(), key: keys.ed, documentLoader: keys.documentLoader });
    const docs = new Map(keys.documents); docs.set(ISSUER, { ...docs.get(ISSUER), assertionMethod: [] });
    expect((await verifyCredentialProof({ credential: seal, documentLoader: createDocumentLoader(docs) })).outcome).toBe('invalid');
  });
  it('issues real BBS credentials and derives independently verified selective disclosure', async () => {
    const seal = await issueSealBbs({ credential: unsignedSeal(keys.bbs.id), key: keys.bbs, documentLoader: keys.documentLoader });
    expect(validateSealStructure(seal)).toEqual({ valid: true, errors: [] });
    const base = await verifyCredentialProof({ credential: seal, documentLoader: keys.documentLoader });
    expect(base.outcome, JSON.stringify(base.issues)).toBe('verified');
    const derived = await deriveSealPresentation({ credential: seal, documentLoader: keys.documentLoader, binding });
    expect(JSON.stringify(derived)).not.toContain('Private product detail');
    const result = await jsigs.verify(derived, { suite: new DataIntegrityProof({ cryptosuite: createVerifyCryptosuite({ expectedPresentationHeader: presentationHeader(binding) }) }), purpose: new jsigs.purposes.AssertionProofPurpose(), documentLoader: keys.documentLoader });
    expect(result.verified, JSON.stringify(result.error)).toBe(true);
    expect((await verifySealPresentation({ credential: derived, documentLoader: keys.documentLoader, binding, evaluationTime: NOW })).outcome).toBe('verified');
    expect((await verifySealPresentation({ credential: derived, documentLoader: keys.documentLoader, binding: { ...binding, challenge: 'replayed' }, evaluationTime: NOW })).outcome).toBe('invalid');
    const malformed = structuredClone(derived); malformed.correctionOf = [];
    expect((await verifySealPresentation({ credential: malformed, documentLoader: keys.documentLoader, binding, evaluationTime: NOW })).outcome).toBe('invalid');
  }, 30_000);
  it('rejects duplicate JSON keys before interpreting a credential', () => {
    const input = JSON.stringify(unsignedSeal()).replace('"issuer":', '"issuer":"did:web:other.example","issuer":');
    expect(() => parseSealBytes(new TextEncoder().encode(input))).toThrow('Duplicate JSON key');
  });
});
it('verifies an externally issued suite credential and rejects an altered BBS base message', async () => {
  const external = await jsigs.sign(unsignedSeal(), { suite: new Ed25519Signature2020({ key: keys.ed, date: NOW }), purpose: new jsigs.purposes.AssertionProofPurpose(), documentLoader: keys.documentLoader });
  expect((await verifyCredentialProof({ credential: external, documentLoader: keys.documentLoader })).outcome).toBe('verified');
  const bbs = await issueSealBbs({ credential: unsignedSeal(keys.bbs.id), key: keys.bbs, documentLoader: keys.documentLoader });
  bbs.eventVector.what.description = 'A forged private value';
  expect((await verifyCredentialProof({ credential: bbs, documentLoader: keys.documentLoader })).outcome).toBe('invalid');
}, 30_000);
