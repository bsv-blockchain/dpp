import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { contexts as vcContexts } from '@digitalbazaar/credentials-context';
import {
  DEFAULT_CONTEXT_SETS, EXTERNAL_CREDENTIAL_LIMIT_BYTES, EXTERNAL_PASSPORT_CONTEXT, EXTERNAL_PASSPORT_CONTEXT_URL, EXTERNAL_PASSPORT_SCHEMA, VC_V2_CONTEXT,
  createExternalDocumentLoader, externalCredentialVerifierFor, parseExternalCredentialBytes, verifyBitstringStatus, verifyExternalCredential, type ExternalVerificationPolicy,
} from '../src/exchange.js';
import { verifyCredentialProof } from '../src/crypto.js';
import { createDocumentLoader, CONTEXT_URL } from '../src/context.js';
import type { Credential, JsonObject } from '../src/types.js';
import { ISSUER, NOW, PASSPORT_ID, STATUS_LIST, fixture, sign, statusList, unsignedPassport } from './exchange-fixture.js';

let f: Awaited<ReturnType<typeof fixture>>;
let loader: ReturnType<typeof createExternalDocumentLoader>;
let signed: JsonObject;
let list: JsonObject;
beforeAll(async () => {
  f = await fixture();
  loader = createExternalDocumentLoader(f.documents);
  signed = await sign(unsignedPassport(), f.keys.issuer, loader);
  list = await statusList(ISSUER, f.keys.issuer, loader);
});
const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
function policy(overrides: Partial<ExternalVerificationPolicy> = {}): ExternalVerificationPolicy {
  const documents = new Map(f.documents); documents.set(STATUS_LIST, list);
  return {
    documentLoader: createExternalDocumentLoader(documents), evaluationTime: NOW, expectedSubject: PASSPORT_ID,
    authorityPolicy: { id: 'urn:test:authority', required: true, trustedIssuers: [ISSUER] },
    statusPolicy: { id: 'urn:test:status', maxAgeMs: 86_400_000, resolve: async url => { const d = documents.get(url); if (d == null) throw new Error('not pinned'); return d as unknown as Credential; } },
    ...overrides,
  };
}

describe('the external document loader', () => {
  it('serves the maintained VC 2.0 context and the bytes carried beside the package agree', async () => {
    const carried = JSON.parse(readFileSync(new URL('../artifacts/w3c/credentials-v2.jsonld', import.meta.url), 'utf8'));
    expect(carried).toEqual(vcContexts.get(VC_V2_CONTEXT));
    expect((await loader(VC_V2_CONTEXT)).document).toEqual(carried);
    expect(createHash('sha256').update(readFileSync(new URL('../artifacts/w3c/credentials-v2.jsonld', import.meta.url))).digest('hex')).toBe('59955ced6697d61e03f2b2556febe5308ab16842846f5b586d7f1f7adec92734');
  });
  it('serves the owned payload context from the artefact bytes and never the SEAL context or an unpinned URL', async () => {
    expect((await loader(EXTERNAL_PASSPORT_CONTEXT_URL)).document).toEqual(EXTERNAL_PASSPORT_CONTEXT);
    expect(JSON.parse(readFileSync(new URL('../artifacts/external/dpp-external-passport-1.context.jsonld', import.meta.url), 'utf8'))).toEqual(EXTERNAL_PASSPORT_CONTEXT);
    expect(JSON.parse(readFileSync(new URL('../artifacts/external/dpp-external-passport-1.schema.json', import.meta.url), 'utf8'))).toEqual(EXTERNAL_PASSPORT_SCHEMA);
    await expect(loader(CONTEXT_URL)).rejects.toThrow('Unsupported context');
    await expect(loader('https://example.org/contexts/anything')).rejects.toThrow('No document available');
    await expect(loader('did:web:unpinned.example')).rejects.toThrow('No document available');
  });
  it('hands an unpinned did:web to the bounded resolver only when one is configured, and only its permitted origin', async () => {
    const fetcher = (async () => new Response(JSON.stringify({ id: 'did:web:allowed.example' }), { status: 200, headers: { 'content-type': 'application/did+ld+json' } })) as unknown as typeof fetch;
    const withDidWeb = createExternalDocumentLoader(new Map(), { didWeb: { allowedOrigins: ['https://allowed.example'], fetcher } });
    expect((await withDidWeb('did:web:allowed.example')).document.id).toBe('did:web:allowed.example');
    await expect(withDidWeb('did:web:refused.example')).rejects.toThrow('not permitted');
  });
});

describe('exact-byte parsing', () => {
  it('parses strict UTF-8 JSON under the 256 KiB limit and digests the exact bytes', () => {
    const text = JSON.stringify(signed);
    const parsed = parseExternalCredentialBytes(bytes(text));
    expect(parsed.credential).toEqual(signed);
    expect(parsed.digest).toBe(createHash('sha256').update(text).digest('hex'));
    expect(parsed.byteLength).toBe(Buffer.byteLength(text));
  });
  it('refuses duplicate keys, arrays and oversize input before interpretation', () => {
    expect(() => parseExternalCredentialBytes(bytes(JSON.stringify(signed).replace('"issuer":', '"issuer":"did:web:other.example","issuer":')))).toThrow('Duplicate JSON key');
    expect(() => parseExternalCredentialBytes(bytes('[1]'))).toThrow('JSON object');
    expect(() => parseExternalCredentialBytes(new Uint8Array(EXTERNAL_CREDENTIAL_LIMIT_BYTES + 1))).toThrow('profile limit');
    const result = verifyExternalCredential({ bytes: bytes('{"a":1,"a":2}'), representation: 'vc-di-ecdsa-rdfc-2019@1', policy: policy() });
    return result.then(r => { expect(r.checks.parse.outcome).toBe('invalid'); expect(r.checks.proof.issues[0]?.code).toBe('not_evaluated'); });
  });
});

describe('verifyExternalCredential', () => {
  it('verifies the positive credential check by check and never reads a trust list from the credential', async () => {
    const result = await verifyExternalCredential({ bytes: bytes(signed), representation: 'vc-di-ecdsa-rdfc-2019@1', policy: policy() });
    expect(Object.values(result.checks).map(c => c.outcome)).toEqual(Array(10).fill('verified'));
    expect(result.issuer).toBe(ISSUER);
    expect(result.subjects).toEqual([PASSPORT_ID]);
    expect(result.types).toEqual(['VerifiableCredential', 'ProductPassportCredential']);
    const withTrustList = structuredClone(signed) as JsonObject; (withTrustList as JsonObject).trustedIssuers = [ISSUER];
    const untrusted = await verifyExternalCredential({ bytes: bytes(withTrustList), representation: 'vc-di-ecdsa-rdfc-2019@1', policy: policy({ authorityPolicy: { id: 'urn:test:authority', required: true, trustedIssuers: [] } }) });
    expect(untrusted.checks.authority.outcome).toBe('invalid');
    expect(untrusted.checks.authority.issues[0]?.code).toBe('issuer_unauthorised');
  }, 30_000);
  it('refuses another representation by name and leaves every other check not evaluated', async () => {
    const result = await verifyExternalCredential({ bytes: bytes(signed), representation: 'vsc-seal-json-v1', policy: policy() });
    expect(result.checks.parse.outcome).toBe('unsupported');
    expect(result.checks.parse.issues[0]?.code).toBe('representation_unsupported');
    expect(result.checks.proof.outcome).toBe('indeterminate');
  });
  it('holds the proof over a re-serialised copy while the digest moves, and fails a changed byte', async () => {
    const pretty = JSON.stringify(signed, null, 2);
    const a = await verifyExternalCredential({ bytes: bytes(JSON.stringify(signed)), representation: 'vc-di-ecdsa-rdfc-2019@1', policy: policy() });
    const b = await verifyExternalCredential({ bytes: bytes(pretty), representation: 'vc-di-ecdsa-rdfc-2019@1', policy: policy() });
    expect(a.checks.proof.outcome).toBe('verified');
    expect(b.checks.proof.outcome).toBe('verified');
    expect(a.digest).not.toBe(b.digest);
    const c = await verifyExternalCredential({ bytes: bytes(pretty.replace('12.5', '12.6')), representation: 'vc-di-ecdsa-rdfc-2019@1', policy: policy() });
    expect(c.checks.proof.outcome).toBe('invalid');
  }, 30_000);
  it('binds the subject only by equality or a named policy, and reports no expectation as not-required', async () => {
    const none = await verifyExternalCredential({ bytes: bytes(signed), representation: 'vc-di-ecdsa-rdfc-2019@1', policy: policy({ expectedSubject: undefined }) });
    expect(none.checks.subjectBinding.outcome).toBe('not-required');
    expect(none.checks.subjectBinding.evidence).toEqual([PASSPORT_ID]);
    const other = await verifyExternalCredential({ bytes: bytes(signed), representation: 'vc-di-ecdsa-rdfc-2019@1', policy: policy({ expectedSubject: 'https://id.example.org/01/09520123456788/21/OTHER' }) });
    expect(other.checks.subjectBinding.outcome).toBe('invalid');
    const bound = await verifyExternalCredential({ bytes: bytes(signed), representation: 'vc-di-ecdsa-rdfc-2019@1', policy: policy({ expectedSubject: 'urn:example:passport:9', subjectBindingPolicy: { id: 'urn:test:binding', bindings: [{ credentialSubject: PASSPORT_ID, passportId: 'urn:example:passport:9', evidenceRef: 'urn:test:evidence:1' }] } }) });
    expect(bound.checks.subjectBinding.outcome).toBe('verified');
    expect(bound.checks.subjectBinding.evidence).toEqual([PASSPORT_ID, 'urn:test:evidence:1', 'urn:test:binding']);
  }, 30_000);
  it('keeps status distinct: a policy without an entry fails, no policy is indeterminate, and the optional profile records its limitation', async () => {
    const noStatus = await sign(unsignedPassport({ credentialStatus: undefined }), f.keys.issuer, loader);
    const required = await verifyExternalCredential({ bytes: bytes(noStatus), representation: 'vc-di-ecdsa-rdfc-2019@1', policy: policy() });
    expect(required.checks.status.outcome).toBe('invalid');
    expect(required.checks.status.issues[0]?.code).toBe('status_entry_missing');
    const noPolicy = await verifyExternalCredential({ bytes: bytes(signed), representation: 'vc-di-ecdsa-rdfc-2019@1', policy: policy({ statusPolicy: undefined }) });
    expect(noPolicy.checks.status.outcome).toBe('indeterminate');
    expect(noPolicy.checks.status.issues[0]?.code).toBe('status_policy_missing');
    const optional = await verifyExternalCredential({ bytes: bytes(noStatus), representation: 'vc-di-ecdsa-rdfc-2019@1', policy: policy({ statusPolicy: undefined, statusOptional: true }) });
    expect(optional.checks.status.outcome).toBe('not-required');
    const stale = await verifyExternalCredential({ bytes: bytes(signed), representation: 'vc-di-ecdsa-rdfc-2019@1', policy: policy({ evaluationTime: '2026-09-08T12:00:00Z' }) });
    expect(stale.checks.status.outcome).toBe('indeterminate');
    expect(stale.checks.status.issues[0]?.code).toBe('status_stale');
    const bounded = await verifyBitstringStatus(signed, { statusPolicy: { id: 'x', maxAgeMs: 8 * 24 * 3600 * 1000, resolve: async () => list as unknown as Credential }, evaluationTime: NOW }, async () => ({ outcome: 'verified', issues: [] }));
    expect(bounded.issues[0]?.code).toBe('status_policy_invalid');
  }, 30_000);
  it('accepts only the pinned context sets, exactly and in order', async () => {
    expect(DEFAULT_CONTEXT_SETS[0]).toEqual([VC_V2_CONTEXT]);
    const reordered = structuredClone(signed) as JsonObject; reordered['@context'] = [EXTERNAL_PASSPORT_CONTEXT_URL, VC_V2_CONTEXT];
    const result = await verifyExternalCredential({ bytes: bytes(reordered), representation: 'vc-di-ecdsa-rdfc-2019@1', policy: policy() });
    expect(result.checks.contexts.outcome).toBe('unsupported');
    expect(result.checks.proof.outcome).toBe('unsupported');
    const narrowed = await verifyExternalCredential({ bytes: bytes(signed), representation: 'vc-di-ecdsa-rdfc-2019@1', policy: policy({ contextPolicy: { allowedContextSets: [[VC_V2_CONTEXT]] } }) });
    expect(narrowed.checks.contexts.issues[0]?.code).toBe('context_unsupported');
  }, 30_000);
  it('reports an issuer whose document is not pinned as indeterminate on binding, proof and availability', async () => {
    const documents = new Map(f.documents); documents.delete(ISSUER); documents.set(STATUS_LIST, list);
    const result = await verifyExternalCredential({ bytes: bytes(signed), representation: 'vc-di-ecdsa-rdfc-2019@1', policy: policy({ documentLoader: createExternalDocumentLoader(documents) }) });
    expect(result.checks.issuerBinding.outcome).toBe('indeterminate');
    expect(result.checks.proof.outcome).toBe('indeterminate');
    expect(result.checks.availability.outcome).toBe('indeterminate');
    expect(result.checks.availability.issues.map(i => i.message)).toContain(`${ISSUER} was not available`);
  }, 30_000);
  it('refuses an issuer under another DID method and an embedded issuer object as unsupported', async () => {
    const keyDid = structuredClone(signed) as JsonObject; keyDid.issuer = 'did:key:z6MkExample';
    const a = await verifyExternalCredential({ bytes: bytes(keyDid), representation: 'vc-di-ecdsa-rdfc-2019@1', policy: policy() });
    expect(a.checks.issuerBinding.issues[0]?.code).toBe('did_method_unsupported');
    const embedded = structuredClone(signed) as JsonObject; embedded.issuer = { id: ISSUER, name: 'Example' };
    const b = await verifyExternalCredential({ bytes: bytes(embedded), representation: 'vc-di-ecdsa-rdfc-2019@1', policy: policy() });
    expect(b.checks.issuerBinding.outcome).toBe('unsupported');
    expect(b.checks.schema.outcome).toBe('invalid');
  }, 30_000);
});

describe('the report adapter', () => {
  it('answers the report slots with shared reason codes and the credential identity', async () => {
    const verifier = externalCredentialVerifierFor(policy());
    const text = JSON.stringify(signed);
    const report = await verifier({ representation: 'vc-di-ecdsa-rdfc-2019@1', mediaType: 'application/vc+ld+json', bytes: [...bytes(text)], digest: createHash('sha256').update(text).digest('hex'), checkedAt: NOW });
    expect(report).toMatchObject({ id: signed.id, issuer: ISSUER, subjects: [PASSPORT_ID], attestationType: 'ProductPassportCredential' });
    for (const name of ['proof', 'schema', 'time', 'status', 'authority', 'availability'] as const) expect(report[name]?.status, name).toBe('pass');
    expect(report.proof.evidenceRefs).toContain(`${ISSUER}#key-1`);
    await expect(verifier({ representation: 'vsc-seal-json-v1', bytes: [...bytes(text)], digest: 'x', checkedAt: NOW })).rejects.toThrow('handles vc-di-ecdsa-rdfc-2019@1 only');
  }, 30_000);
  it('folds an unauthorised key into the proof slot as a failure, never as a pass on the signature alone', async () => {
    const unauthorised = await sign(unsignedPassport(), f.keys.issuerUnauthorised, loader);
    const report = await externalCredentialVerifierFor(policy())({ representation: 'vc-di-ecdsa-rdfc-2019@1', bytes: [...bytes(unauthorised)], digest: 'x', checkedAt: NOW });
    expect(report.proof.status).toBe('fail');
    expect(report.proof.reasonCode).toBe('signature-invalid');
  }, 30_000);
});

describe('the SEAL verifier is untouched by the external profile', () => {
  it('still answers unsupported with context_unsupported for an ecdsa credential under the VC 2.0 contexts', async () => {
    const check = await verifyCredentialProof({ credential: signed as unknown as Credential, documentLoader: createDocumentLoader(f.documents) });
    expect(check.outcome).toBe('unsupported');
    expect(check.issues[0]?.code).toBe('context_unsupported');
  });
  it('does not export the external entry point from the main entry', async () => {
    const main = await import('../src/index.js');
    expect('verifyExternalCredential' in main).toBe(false);
  });
});
