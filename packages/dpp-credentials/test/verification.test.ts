import { beforeAll, describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { issueSealEd25519, signCredentialEd25519 } from '../src/crypto.js';
import { verifySeal, verifyCredentialStatus } from '../src/verification.js';
import { SEAL_CONTEXTS } from '../src/context.js';
import type { Credential, Seal, VerificationOptions } from '../src/types.js';
import { fixtureKeys, unsignedSeal, NOW, ISSUER } from './fixtures.js';
let keys: Awaited<ReturnType<typeof fixtureKeys>>;
beforeAll(async () => { keys = await fixtureKeys(); });
async function statusCredential(bit = -1): Promise<Credential> {
  const bytes = Buffer.alloc(16384); if (bit >= 0) bytes[Math.floor(bit / 8)] |= 1 << (7 - bit % 8);
  const credential: Credential = {
    '@context': [...SEAL_CONTEXTS], type: ['VerifiableCredential','BitstringStatusListCredential'], id: 'https://issuer.example/status/1', issuer: ISSUER, validFrom: NOW, validUntil: '2026-09-06T12:00:00Z',
    credentialSubject: { id: 'https://issuer.example/status/1#list', type: 'BitstringStatusList', statusPurpose: 'revocation', encodedList: `u${gzipSync(bytes).toString('base64url')}` },
  };
  return signCredentialEd25519({ credential, key: keys.ed, documentLoader: keys.documentLoader });
}
async function options(credential: Seal, bit = -1): Promise<VerificationOptions> {
  const list = await statusCredential(bit);
  return { credential, documentLoader: keys.documentLoader, evaluationTime: NOW,
    statusPolicy: { id: 'urn:test:status-policy', maxAgeMs: 86400000, resolve: async () => list },
    authorityPolicy: { id: 'urn:test:public-verification', required: false, reason: 'This verifier has no required external issuer registry; authority remains unconfirmed' },
  };
}
const sign = (credential: Seal) => issueSealEd25519({ credential, key: keys.ed, documentLoader: keys.documentLoader });
function child(id: string, parents: Seal[], disposition = 'in_transit', topology: Seal['chainOfCustody']['topology'] = 'linear'): Seal {
  const value = unsignedSeal(keys.ed.id, `urn:uuid:${id}`);
  value.eventVector.how.disposition = disposition;
  value.chainOfCustody = { ...value.chainOfCustody, sequenceNumber: Math.max(...parents.map(p => p.chainOfCustody.sequenceNumber)) + 1, parentSeals: parents.map(p => p.id), topology };
  value.credentialSubject.predecessorCredentials = parents.map(p => p.id);
  return value;
}
describe('authenticated evidence and custody verification', () => {
  it('verifies a root with explicit evidence policy and reports its limited evidence scope', async () => {
    const seal = await sign(unsignedSeal()); const result = await verifySeal(await options(seal));
    expect(result.outcome, JSON.stringify(result.issues)).toBe('verified');
    expect(result.checks.authority.outcome).toBe('not-required');
    expect(result.evidenceScope).toBe('provided-evidence');
  });
  it('does not turn missing status and authority into successful verification', async () => {
    const seal = await sign(unsignedSeal()); const result = await verifySeal({ credential: seal, documentLoader: keys.documentLoader, evaluationTime: NOW });
    expect(result.outcome).toBe('indeterminate');
    expect(result.issues.map(i => i.code)).toContain('status_policy_missing');
  });
  it('rejects MSB-indexed revocation and unauthenticated or wrongly scoped status evidence', async () => {
    const seal = await sign(unsignedSeal()); const policy = await options(seal, 0);
    expect((await verifySeal(policy)).issues.map(i => i.code)).toContain('revoked');
    const list = await statusCredential(); delete list.proof;
    policy.statusPolicy!.resolve = async () => list;
    expect((await verifySeal(policy)).issues.map(i => i.code)).toContain('status_proof');
    const forged = await statusCredential(); forged.issuer = 'did:web:attacker.example'; policy.statusPolicy!.resolve = async () => forged;
    expect((await verifySeal(policy)).issues.map(i => i.code)).toContain('status_issuer');
  });
  it('rejects a blank index, stale evidence, purpose mismatch and small status lists', async () => {
    const seal = await sign(unsignedSeal()); const policy = await options(seal);
    seal.credentialStatus.statusListIndex = '';
    expect((await verifyCredentialStatus(seal, { ...policy, evaluationTime: NOW })).outcome).toBe('invalid');
    seal.credentialStatus.statusListIndex = '0';
    const stale = await verifyCredentialStatus(seal, { ...policy, evaluationTime: '2026-09-06T11:59:59Z', statusPolicy: { ...policy.statusPolicy!, maxAgeMs: 1000 } });
    expect(stale.issues[0].code).toBe('status_stale');
    const list = await statusCredential(); delete list.proof; list.credentialSubject.statusPurpose = 'suspension';
    policy.statusPolicy!.resolve = async () => signCredentialEd25519({ credential: list, key: keys.ed, documentLoader: keys.documentLoader });
    expect((await verifyCredentialStatus(seal, { ...policy, evaluationTime: NOW })).issues[0].code).toBe('status_payload');
  });
  it('accepts a diamond DAG using path-local cycle detection', async () => {
    const origin = await sign(unsignedSeal());
    const a = await sign(child('a', [origin])); const b = await sign(child('b', [origin]));
    const merged = await sign(child('merged', [a,b], 'transformed', 'merge'));
    const nodes = new Map([origin,a,b].map(n => [n.id,n]));
    const result = await verifySeal({ ...await options(merged), resolveSeal: async id => nodes.get(id) });
    expect(result.outcome, JSON.stringify(result.issues)).toBe('verified');
  });
  it('rejects forbidden transitions, cycles, missing parents and bounded traversal', async () => {
    const origin = await sign(unsignedSeal()); const skipped = await sign(child('skip', [origin], 'received'));
    expect((await verifySeal({ ...await options(skipped), resolveSeal: async () => origin })).issues.map(i => i.code)).toContain('state_transition');
    const transit = await sign(child('t', [origin]));
    expect((await verifySeal(await options(transit))).outcome).toBe('indeterminate');
    const a = child('cycle-a', [origin]), b = child('cycle-b', [origin]);
    a.chainOfCustody.parentSeals = [b.id]; a.credentialSubject.predecessorCredentials = [b.id];
    b.chainOfCustody.parentSeals = [a.id]; b.credentialSubject.predecessorCredentials = [a.id];
    const signedA = await sign(a), signedB = await sign(b);
    const cyclic = await verifySeal({ ...await options(signedA), resolveSeal: async id => id === signedA.id ? signedA : signedB });
    expect(cyclic.issues.map(i => i.code)).toContain('cycle');
    expect((await verifySeal({ ...await options(transit), resolveSeal: async () => origin, limits: { maxDepth: 0 } })).issues.map(i => i.code)).toContain('resource_limit');
  });
  it('accepts only signed, status-checked scoped authority from configured trust anchors', async () => {
    const seal = await sign(unsignedSeal()); const policy = await options(seal);
    const authority: Credential = { '@context': [...SEAL_CONTEXTS], type: ['VerifiableCredential','VscEventAuthorisation'], id: 'urn:uuid:authority', issuer: ISSUER, validFrom: NOW, credentialStatus: seal.credentialStatus,
      credentialSubject: { id: ISSUER, permittedEventTypes: ['ObjectEvent'], permittedProductSchemes: ['DID'], permittedJurisdictions: ['AU'] } };
    const signed = await signCredentialEd25519({ credential: authority, key: keys.ed, documentLoader: keys.documentLoader });
    policy.authorityPolicy = { id: 'urn:test:trusted-issuer', required: true, trustAnchors: [ISSUER], resolve: async () => [signed] };
    expect((await verifySeal(policy)).outcome).toBe('verified');
    policy.authorityPolicy.trustAnchors = [];
    expect((await verifySeal(policy)).issues.map(i => i.code)).toContain('issuer_unauthorised');
  });
});

describe('immutable correction projection', () => {
  async function correction(original: Seal, id: string, change: (value: Seal) => void = () => {}): Promise<Seal> {
    const corrected = structuredClone(original); delete corrected.proof;
    corrected.id = `urn:uuid:${id}`; corrected.credentialSubject = { id: corrected.id, predecessorCredentials: [original.id] };
    corrected.correctionOf = original.id;
    corrected.chainOfCustody = { chainId: `urn:uuid:correction-chain-${id}`, sequenceNumber: 1, parentSeals: [original.id], topology: 'correction' };
    corrected.extensions = { '+Dn': { '+D1': { vocabularyUrn: 'urn:bsv:vsc:vocab:correction:1', correctionReason: 'Correct a recording error' } } };
    change(corrected);
    return sign(corrected);
  }
  it('uses a unique authorised correction and retains the original signed record', async () => {
    const origin = await sign(unsignedSeal()); const changed = await correction(origin, 'correction-1', c => { c.eventVector.what.description = 'Corrected description'; });
    const originalBytes = JSON.stringify(origin);
    const result = await verifySeal({ ...await options(origin), corrections: [changed], resolveSeal: async id => id === origin.id ? origin : changed });
    expect(result.outcome, JSON.stringify(result.issues)).toBe('verified');
    expect(result.checks.corrections.evidence).toContain(changed.id);
    expect(JSON.stringify(origin)).toBe(originalBytes);
  });
  it('does not select an arbitrary winner between competing authorised corrections', async () => {
    const origin = await sign(unsignedSeal()); const a = await correction(origin, 'correction-a'), b = await correction(origin, 'correction-b');
    const result = await verifySeal({ ...await options(origin), corrections: [a,b] });
    expect(result.outcome).toBe('indeterminate'); expect(result.issues.map(i => i.code)).toContain('correction_conflict');
  });
  it('rechecks downstream state against corrected facts', async () => {
    const origin = await sign(unsignedSeal()); const transit = await sign(child('transit-correction', [origin]));
    const receipt = await sign(child('receipt-correction', [transit], 'received'));
    const altered = await correction(transit, 'bad-correction', c => { c.eventVector.how.disposition = 'destroyed'; });
    const nodes = new Map([origin,transit,receipt,altered].map(n => [n.id,n]));
    const result = await verifySeal({ ...await options(receipt), corrections: [altered], resolveSeal: async id => nodes.get(id) });
    expect(result.outcome).toBe('invalid'); expect(result.issues.map(i => i.code)).toContain('state_transition');
  });
});
it('does not join equal literal identifiers from different schemes or authorities', async () => {
  const origin = await sign(unsignedSeal()); const altered = child('different-namespace', [origin]);
  altered.eventVector.what.productIdentifiers[0].scheme = 'LocalCatalogue';
  altered.eventVector.what.productIdentifiers[0].schemeAuthority = 'An unrelated issuer';
  const result = await verifySeal({ ...await options(await sign(altered)), resolveSeal: async () => origin });
  expect(result.outcome).toBe('invalid'); expect(result.issues.map(i => i.code)).toContain('subject_continuity');
});
it('rejects signed undersized lists and tampered purposes rather than trusting their signatures alone', async () => {
  const seal = await sign(unsignedSeal()); const policy = await options(seal);
  const list = await statusCredential(); delete list.proof;
  list.credentialSubject.encodedList = `u${gzipSync(Buffer.alloc(1)).toString('base64url')}`;
  const signed = await signCredentialEd25519({ credential: list, key: keys.ed, documentLoader: keys.documentLoader });
  policy.statusPolicy!.resolve = async () => signed;
  expect((await verifyCredentialStatus(seal, { ...policy, evaluationTime: NOW })).issues[0].code).toBe('status_index_invalid');
});
it('rejects additional unresolved parents on supplied correction candidates', async () => {
  const origin = await sign(unsignedSeal()); const correction = structuredClone(origin); delete correction.proof;
  correction.id = 'urn:uuid:extra-parent-correction'; correction.correctionOf = origin.id;
  correction.chainOfCustody = { chainId: 'urn:uuid:extra-correction-chain', sequenceNumber: 1, parentSeals: [origin.id, 'urn:uuid:missing-parent'], topology: 'correction' };
  correction.credentialSubject = { id: correction.id, predecessorCredentials: [...correction.chainOfCustody.parentSeals] };
  correction.extensions = { '+Dn': { '+D1': { correctionReason: 'Correct a recording error' } } };
  // Sign externally to exercise validation of a credential our issuer refuses to produce.
  const signed = await signCredentialEd25519({ credential: correction, key: keys.ed, documentLoader: keys.documentLoader }) as Seal;
  const result = await verifySeal({ ...await options(origin), corrections: [signed] });
  expect(result.outcome).toBe('invalid'); expect(result.issues.map(i => i.code)).toContain('correction_structure');
});
it('requires a signed, scoped and status-checked delegation for a different correction issuer', async () => {
  const { Ed25519VerificationKey2020 } = await import('@digitalbazaar/ed25519-verification-key-2020');
  const delegateDid = 'did:web:delegate.example';
  const delegate = await Ed25519VerificationKey2020.generate({ id: `${delegateDid}#ed`, controller: delegateDid });
  const publicKey = await delegate.export({ publicKey: true, includeContext: true });
  keys.documents.set(delegate.id, publicKey);
  keys.documents.set(delegateDid, { '@context': ['https://www.w3.org/ns/did/v1','https://w3id.org/security/suites/ed25519-2020/v1'], id: delegateDid, assertionMethod: [publicKey] });
  const origin = await sign(unsignedSeal()); const correction = structuredClone(origin); delete correction.proof;
  correction.id = 'urn:uuid:delegated-correction'; correction.issuer = delegateDid; correction.correctionOf = origin.id;
  correction.eventVector.who.actorDid = delegateDid; correction.eventVector.who.assertionMethod = delegate.id;
  correction.chainOfCustody = { chainId: 'urn:uuid:delegated-chain', sequenceNumber: 1, parentSeals: [origin.id], topology: 'correction' };
  correction.credentialSubject = { id: correction.id, predecessorCredentials: [origin.id] };
  correction.extensions = { '+Dn': { '+D1': { correctionReason: 'An authorised delegate corrects a recording error' } } };
  const signedCorrection = await issueSealEd25519({ credential: correction, key: delegate, documentLoader: keys.documentLoader });
  const grant: Credential = { '@context': [...SEAL_CONTEXTS], type: ['VerifiableCredential','VscCorrectionAuthorisation'], id: 'urn:uuid:correction-delegation', issuer: ISSUER, validFrom: NOW, credentialStatus: origin.credentialStatus,
    credentialSubject: { id: delegateDid, originalIssuer: ISSUER, permittedRecordIds: [origin.id], permittedActions: ['correct'] } };
  const signedGrant = await signCredentialEd25519({ credential: grant, key: keys.ed, documentLoader: keys.documentLoader });
  const policy = await options(origin); policy.statusPolicy!.delegatedListIssuers = { [delegateDid]: [ISSUER] };
  const missing = await verifySeal({ ...policy, corrections: [signedCorrection] });
  expect(missing.outcome).toBe('indeterminate'); expect(missing.issues.map(i => i.code)).toContain('correction_authority_missing');
  const result = await verifySeal({ ...policy, corrections: [signedCorrection], correctionPolicy: { id: 'urn:test:correction-policy', resolve: async () => [signedGrant] } });
  expect(result.outcome, JSON.stringify(result.issues)).toBe('verified');
});
it('accepts a standalone correction with valid effective ancestry and rejects a later incompatible event', async () => {
  const origin = await sign(unsignedSeal());
  const transit = await sign(child('standalone-transit', [origin]));
  const receipt = await sign(child('standalone-receipt', [transit], 'received'));
  const correction = structuredClone(receipt); delete correction.proof;
  correction.id = 'urn:uuid:standalone-correction'; correction.correctionOf = receipt.id;
  correction.credentialSubject = { id: correction.id, predecessorCredentials: [receipt.id] };
  correction.chainOfCustody = { chainId: 'urn:uuid:standalone-correction-chain', sequenceNumber: 1, parentSeals: [receipt.id], topology: 'correction' };
  correction.eventVector.how.disposition = 'stored';
  correction.extensions = { '+Dn': { '+D1': { correctionReason: 'The consignment remained in storage; it had not been received' } } };
  const signedCorrection = await sign(correction);
  const nodes = new Map([origin,transit,receipt,signedCorrection].map(n => [n.id,n]));
  const standalone = await verifySeal({ ...await options(signedCorrection), resolveSeal: async id => nodes.get(id) });
  expect(standalone.outcome, JSON.stringify(standalone.issues)).toBe('verified');
  const terminal = await sign(child('standalone-terminal', [receipt], 'dispensed'));
  const downstream = await verifySeal({ ...await options(terminal), corrections: [signedCorrection], resolveSeal: async id => nodes.get(id) });
  expect(downstream.outcome).toBe('invalid'); expect(downstream.issues.map(i => i.code)).toContain('state_transition');
});
