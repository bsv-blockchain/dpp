/**
 * The published vectors of the external credential profile
 * (`fixtures/vectors/dpp/interoperability/external-credential/v1.json`), in
 * the stack's cross-language vector format. `REGENERATE_FIXTURES=1` rebuilds
 * the file from `exchange-fixture.ts` (fresh ECDSA nonces, so the proof
 * values move; everything else is fixed by the published scalars) and the
 * assertions then run over what was written; otherwise the pinned file is the
 * input, so a change to the verifier that alters an outcome goes red here
 * without a signature being regenerated.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createExternalDocumentLoader, externalCredentialVerifierFor, verifyExternalCredential, type ExternalVerification, type ExternalVerificationPolicy } from '../src/exchange.js';
import type { JsonObject, StatusPolicy } from '../src/types.js';
import { ALIAS_SUBJECT, ISSUER, KEYS, NOW, OTHER, PASSPORT_ID, STATUS_LIST, STATUS_INDEX, fixture, sha256, sign, statusList, unsignedPassport } from './exchange-fixture.js';

const VECTORS = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'vectors', 'dpp', 'interoperability', 'external-credential', 'v1.json');
const REPRESENTATION = 'vc-di-ecdsa-rdfc-2019@1';

type CheckName = keyof ExternalVerification['checks'];
interface VectorPolicy { evaluationTime: string; expectedSubject?: string; authority: { id: string; required: boolean; reason?: string; trustedIssuers?: string[] }; status?: { id: string; maxAgeMs: number }; statusOptional?: boolean; subjectBinding?: { id: string; bindings: Array<{ credentialSubject: string; passportId: string; evidenceRef: string }> } }
interface Vector {
  id: string; description: string;
  input: { representation: string; credential: string; credentialB?: string; documents: Record<string, JsonObject>; policy: VectorPolicy; keys?: Record<string, unknown> };
  expected: { sha256: string; sha256B?: string; checks: Record<CheckName, string>; issues: Partial<Record<CheckName, string>>; report?: Record<string, string> };
  tags: string[];
}

async function generate(): Promise<Vector[]> {
  const f = await fixture();
  const loader = createExternalDocumentLoader(f.documents);
  const documents = Object.fromEntries(f.documents);
  const list = await statusList(ISSUER, f.keys.issuer, loader);
  const revokedList = await statusList(ISSUER, f.keys.issuer, loader, [STATUS_INDEX]);
  const otherList = await statusList(OTHER, f.keys.other, loader);
  const positive = await sign(unsignedPassport(), f.keys.issuer, loader);
  const exact = JSON.stringify(positive);
  const docsWith = (extra: Record<string, JsonObject> = {}): Record<string, JsonObject> => ({ ...documents, [STATUS_LIST]: list, ...extra });
  const policy = (overrides: Partial<VectorPolicy> = {}): VectorPolicy => ({ evaluationTime: NOW, expectedSubject: PASSPORT_ID, authority: { id: 'urn:example:policy:external-issuers:1', required: true, trustedIssuers: [ISSUER] }, status: { id: 'urn:example:policy:status:1', maxAgeMs: 86_400_000 }, ...overrides });
  const vectors: Vector[] = [];
  const add = (id: string, description: string, credential: string, extra: Partial<Vector['input']> & { policy?: VectorPolicy }, tags: string[]): void => {
    vectors.push({ id, description, input: { representation: REPRESENTATION, credential, documents: docsWith(), policy: policy(), ...extra }, expected: { sha256: sha256(credential), checks: {} as Record<CheckName, string>, issues: {} }, tags });
  };

  add('positive', 'A passport credential under the VC 2.0 and owned payload contexts, secured with ecdsa-rdfc-2019 under the issuer\'s P-256 Multikey listed for assertion in its did:web document, with an authenticated status list, an expected subject equal to the signed subject and a named authority policy trusting the issuer. The private keys are the published scalars in `keys`; nothing derived from them will ever hold value.', exact, { keys: f.secrets }, ['happy-path']);
  add('reformatted', 'The positive credential re-serialised with indentation: the RDF proof still verifies because canonicalisation removes formatting, and the exact-byte digest differs, which is the C-11 distinction between proof validity and the anchored commitment.', JSON.stringify(positive, null, 2), {}, ['happy-path', 'exact-bytes']);
  add('tampered-subject', 'One subject value changed in the issued bytes; the proof fails.', exact.replace('"massKg":12.5', '"massKg":13.5'), {}, ['error-case']);
  const substituted = structuredClone(positive) as JsonObject;
  (substituted['@context'] as unknown[]).push({ massKg: 'urn:example:redefined#massKg' });
  add('context-substituted', 'An inline context object appended to the pinned set, redefining a subject term: the context set is unsupported, and the proof is not evaluated under it.', JSON.stringify(substituted), {}, ['error-case']);
  add('key-substituted', 'Signed by a key the issuer holds but never listed under assertionMethod: the issuer binding fails and the suite refuses the proof for its purpose.', JSON.stringify(await sign(unsignedPassport(), f.keys.issuerUnauthorised, loader)), {}, ['error-case']);
  add('issuer-substituted', 'The credential names did:web:other.example as issuer while its proof is by the first issuer\'s key: the key\'s controller is not the issuer, and the proof does not verify against the named issuer\'s document.', JSON.stringify(await sign(unsignedPassport({ issuer: OTHER }), f.keys.issuer, loader)), { policy: policy({ authority: { id: 'urn:example:policy:external-issuers:1', required: true, trustedIssuers: [ISSUER] } }) }, ['error-case']);
  add('expired', 'validUntil before the evaluation time.', JSON.stringify(await sign(unsignedPassport({ validUntil: '2026-09-05T00:00:00Z' }), f.keys.issuer, loader)), {}, ['error-case']);
  add('not-yet-valid', 'validFrom after the evaluation time.', JSON.stringify(await sign(unsignedPassport({ validFrom: '2027-01-01T00:00:00Z', validUntil: '2028-01-01T00:00:00Z' }), f.keys.issuer, loader)), {}, ['error-case']);
  add('revoked', 'The status list the credential names has its bit set; the list is signed by the issuer and fresh.', exact, { documents: docsWith({ [STATUS_LIST]: revokedList }) }, ['error-case']);
  add('status-other-issuer', 'The status list is issued and signed by a different party the policy has not delegated to.', exact, { documents: docsWith({ [STATUS_LIST]: otherList }) }, ['error-case']);
  add('status-list-unavailable', 'The status list is not pinned and no fetch is permitted: status and availability are indeterminate, never passed.', exact, { documents: { ...documents } }, ['error-case']);
  add('p384-key', 'Signed by the issuer\'s authorised P-384 key: the suite could verify it, and this profile declares P-256 only, so the answer is unsupported rather than a failure.', JSON.stringify(await sign(unsignedPassport(), f.keys.issuerP384, loader)), {}, ['error-case', 'unsupported']);
  add('jcs-suite', 'The proof declares ecdsa-jcs-2019: unsupported by this profile, refused before any signature is evaluated.', exact.replace('"cryptosuite":"ecdsa-rdfc-2019"', '"cryptosuite":"ecdsa-jcs-2019"'), {}, ['error-case', 'unsupported']);
  add('two-subjects', 'Two credential subjects, validly signed: the proof holds, the owned schema refuses the shape and the subject binding is unsupported.', JSON.stringify(await sign(unsignedPassport({ credentialSubject: [{ id: PASSPORT_ID, massKg: 12.5 }, { id: 'https://id.example.org/01/09520123456788/21/SERIAL-0002', massKg: 12.4 }] }), f.keys.issuer, loader)), {}, ['error-case', 'unsupported']);
  add('subject-bound-by-policy', 'The signed subject is an alias identifier; the expected passport differs and a named binding policy relates the two with an evidence reference, so the binding verifies under that policy and not by inference.', JSON.stringify(await sign(unsignedPassport({ credentialSubject: { id: ALIAS_SUBJECT, massKg: 12.5 } }), f.keys.issuer, loader)), { policy: policy({ subjectBinding: { id: 'urn:example:policy:subject-binding:1', bindings: [{ credentialSubject: ALIAS_SUBJECT, passportId: PASSPORT_ID, evidenceRef: 'urn:example:binding-evidence:1' }] } }) }, ['happy-path']);
  add('subject-mismatch', 'The signed subject is the alias and no binding policy is configured: the binding fails; nothing is inferred from matching text elsewhere.', JSON.stringify(await sign(unsignedPassport({ credentialSubject: { id: ALIAS_SUBJECT, massKg: 12.5 } }), f.keys.issuer, loader)), {}, ['error-case']);
  add('authority-not-required', 'The positive credential under a policy that records that no external issuer authority is required: the authority check is not-required with the stated reason, never passed by omission.', exact, { policy: policy({ authority: { id: 'urn:example:policy:no-authority:1', required: false, reason: 'This verifier has no required external issuer registry; authority remains unconfirmed' } }) }, ['happy-path']);
  add('issuer-untrusted', 'The positive credential under a policy whose trusted issuers do not include this one.', exact, { policy: policy({ authority: { id: 'urn:example:policy:external-issuers:1', required: true, trustedIssuers: [OTHER] } }) }, ['error-case']);
  add('status-missing-optional', 'No status entry, no status policy, and the profile option that accepts that with a recorded limitation.', JSON.stringify(await sign(unsignedPassport({ credentialStatus: undefined }), f.keys.issuer, loader)), { policy: policy({ status: undefined, statusOptional: true }) }, ['happy-path', 'limitation']);
  const collisionB = JSON.stringify(await sign(unsignedPassport({ credentialSubject: { id: PASSPORT_ID, productName: 'Demonstration battery module', manufacturer: 'Example Batteries', massKg: 12.9, recycledContentDeclared: false } }), f.keys.issuer, loader));
  const collision: Vector = { id: 'id-collision', description: 'Two validly signed credentials carrying the same credential id and different bytes: each verifies on its own; a registry must refuse the second under the first\'s identifier rather than replace the secured bytes.', input: { representation: REPRESENTATION, credential: exact, credentialB: collisionB, documents: docsWith(), policy: policy() }, expected: { sha256: sha256(exact), sha256B: sha256(collisionB), checks: {} as Record<CheckName, string>, issues: {} }, tags: ['error-case', 'registry-intake'] };
  vectors.push(collision);
  return vectors;
}

function policyFor(v: Vector): ExternalVerificationPolicy {
  const documents = new Map(Object.entries(v.input.documents));
  const documentLoader = createExternalDocumentLoader(documents);
  const p = v.input.policy;
  const statusPolicy: StatusPolicy | undefined = p.status == null ? undefined : { id: p.status.id, maxAgeMs: p.status.maxAgeMs, resolve: async url => { const d = documents.get(url); if (d == null) throw new Error('not pinned'); return d as never; } };
  return {
    documentLoader, evaluationTime: p.evaluationTime,
    ...(p.expectedSubject == null ? {} : { expectedSubject: p.expectedSubject }),
    authorityPolicy: p.authority.required ? { id: p.authority.id, required: true, trustedIssuers: p.authority.trustedIssuers ?? [] } : { id: p.authority.id, required: false, reason: p.authority.reason ?? '' },
    ...(statusPolicy == null ? {} : { statusPolicy }),
    ...(p.statusOptional == null ? {} : { statusOptional: p.statusOptional }),
    ...(p.subjectBinding == null ? {} : { subjectBindingPolicy: p.subjectBinding }),
  };
}

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

/** What each vector must produce, check by check, and the first issue code where one is expected. */
const EXPECTED: Record<string, { checks: Partial<Record<CheckName, string>>; issues: Partial<Record<CheckName, string>>; report?: Record<string, string> }> = {
  positive: { checks: { parse: 'verified', contexts: 'verified', schema: 'verified', proof: 'verified', issuerBinding: 'verified', subjectBinding: 'verified', temporal: 'verified', status: 'verified', authority: 'verified', availability: 'verified' }, issues: {}, report: { proof: 'pass', schema: 'pass', time: 'pass', status: 'pass', authority: 'pass', availability: 'pass' } },
  reformatted: { checks: { proof: 'verified', status: 'verified', availability: 'verified' }, issues: {} },
  'tampered-subject': { checks: { proof: 'invalid', issuerBinding: 'verified', schema: 'verified' }, issues: { proof: 'proof_failed' }, report: { proof: 'fail:signature-invalid' } },
  'context-substituted': { checks: { contexts: 'unsupported', proof: 'unsupported' }, issues: { contexts: 'context_inline', proof: 'context_unsupported' }, report: { proof: 'unknown:suite-unsupported' } },
  'key-substituted': { checks: { issuerBinding: 'invalid', proof: 'invalid' }, issues: { issuerBinding: 'key_not_authorised' }, report: { proof: 'fail' } },
  'issuer-substituted': { checks: { issuerBinding: 'invalid', proof: 'invalid', authority: 'invalid' }, issues: { issuerBinding: 'key_controller_mismatch', authority: 'issuer_unauthorised' } },
  expired: { checks: { temporal: 'invalid', proof: 'verified' }, issues: { temporal: 'expired' }, report: { time: 'fail:expired' } },
  'not-yet-valid': { checks: { temporal: 'invalid', proof: 'verified' }, issues: { temporal: 'not_yet_valid' }, report: { time: 'fail:not-yet-valid' } },
  revoked: { checks: { status: 'invalid', proof: 'verified' }, issues: { status: 'revoked' }, report: { status: 'fail:status-revoked' } },
  'status-other-issuer': { checks: { status: 'invalid' }, issues: { status: 'status_issuer' }, report: { status: 'fail:status-unauthenticated' } },
  'status-list-unavailable': { checks: { status: 'indeterminate', availability: 'indeterminate', proof: 'verified' }, issues: { status: 'status_unavailable', availability: 'referenced_artefact_unavailable' }, report: { status: 'unknown:status-unknown', availability: 'unknown:referenced-artefact-unavailable' } },
  'p384-key': { checks: { issuerBinding: 'unsupported', proof: 'unsupported' }, issues: { issuerBinding: 'curve_unsupported', proof: 'curve_unsupported' }, report: { proof: 'unknown:suite-unsupported' } },
  'jcs-suite': { checks: { proof: 'unsupported', issuerBinding: 'verified' }, issues: { proof: 'suite_unsupported' }, report: { proof: 'unknown:suite-unsupported' } },
  'two-subjects': { checks: { proof: 'verified', schema: 'invalid', subjectBinding: 'unsupported' }, issues: { schema: 'schema', subjectBinding: 'subject_structure_unsupported' }, report: { schema: 'fail:schema-invalid' } },
  'subject-bound-by-policy': { checks: { subjectBinding: 'verified', proof: 'verified' }, issues: {} },
  'subject-mismatch': { checks: { subjectBinding: 'invalid', proof: 'verified' }, issues: { subjectBinding: 'subject_mismatch' } },
  'authority-not-required': { checks: { authority: 'not-required', proof: 'verified' }, issues: { authority: 'authority_not_required' }, report: { authority: 'not-applicable:authority-not-required' } },
  'issuer-untrusted': { checks: { authority: 'invalid', proof: 'verified' }, issues: { authority: 'issuer_unauthorised' }, report: { authority: 'fail:authority-unconfirmed' } },
  'status-missing-optional': { checks: { status: 'not-required', proof: 'verified' }, issues: { status: 'status_not_required' }, report: { status: 'not-applicable:status-unset' } },
  'id-collision': { checks: { proof: 'verified' }, issues: {} },
};

let vectors: Vector[];
beforeAll(async () => {
  if (process.env.REGENERATE_FIXTURES === '1') {
    const generated = await generate();
    for (const v of generated) {
      const result = await verifyExternalCredential({ bytes: bytesOf(v.input.credential), representation: v.input.representation, policy: policyFor(v) });
      v.expected.checks = Object.fromEntries(Object.entries(result.checks).map(([name, check]) => [name, check.outcome])) as Record<CheckName, string>;
      v.expected.issues = Object.fromEntries(Object.entries(result.checks).filter(([, check]) => check.issues.length > 0).map(([name, check]) => [name, check.issues[0]!.code])) as Partial<Record<CheckName, string>>;
      const report = await externalCredentialVerifierFor(policyFor(v))({ representation: v.input.representation, bytes: [...bytesOf(v.input.credential)], digest: v.expected.sha256, checkedAt: v.input.policy.evaluationTime });
      v.expected.report = Object.fromEntries(['proof', 'schema', 'time', 'status', 'authority', 'availability'].map(name => { const c = (report as unknown as Record<string, { status: string; reasonCode?: string }>)[name]!; return [name, c.reasonCode == null ? c.status : `${c.status}:${c.reasonCode}`]; }));
    }
    const file = {
      $schema: 'https://raw.githubusercontent.com/bsv-blockchain/ts-stack/main/conformance/schema/vector.schema.json',
      id: 'dpp.interoperability.external-credential.v1',
      name: 'DPP external credential profile vc-di-ecdsa-rdfc-2019@1: exact-byte VC 2.0 credentials under ecdsa-rdfc-2019 with P-256 Multikeys, their did:web documents and status lists',
      brc: [], version: '1.0.0', reference_impl: 'vsc@0.2.0', parity_class: 'required', vectors: generated,
    };
    mkdirSync(dirname(VECTORS), { recursive: true });
    writeFileSync(VECTORS, JSON.stringify(file, null, 2) + '\n');
  }
  vectors = (JSON.parse(readFileSync(VECTORS, 'utf8')) as { vectors: Vector[] }).vectors;
}, 60_000);

describe('the external credential vectors (fixtures/vectors/dpp/interoperability/external-credential/v1.json)', () => {
  it('carries every case this suite expects, with the published scalars on the positive vector', () => {
    expect(vectors.map(v => v.id)).toEqual(Object.keys(EXPECTED));
    const positive = vectors.find(v => v.id === 'positive')!;
    expect(Object.keys(positive.input.keys ?? {})).toEqual(Object.keys(KEYS));
    for (const key of Object.values(positive.input.keys as Record<string, { secretKeyMultibase: string; publicKeyMultibase: string }>)) {
      expect(key.secretKeyMultibase).toMatch(/^z/);
      expect(key.publicKeyMultibase).toMatch(/^z/);
    }
  });

  it('pins each credential by the digest of its exact bytes, and the reformatted copy by a different one', () => {
    for (const v of vectors) expect(sha256(v.input.credential), v.id).toBe(v.expected.sha256);
    const positive = vectors.find(v => v.id === 'positive')!, reformatted = vectors.find(v => v.id === 'reformatted')!;
    expect(reformatted.expected.sha256).not.toBe(positive.expected.sha256);
    expect(JSON.parse(reformatted.input.credential)).toEqual(JSON.parse(positive.input.credential));
  });

  it.each(Object.keys(EXPECTED))('%s produces the pinned outcomes and issue codes', async id => {
    const v = vectors.find(x => x.id === id)!;
    const result = await verifyExternalCredential({ bytes: bytesOf(v.input.credential), representation: v.input.representation, policy: policyFor(v) });
    const outcomes = Object.fromEntries(Object.entries(result.checks).map(([name, check]) => [name, check.outcome]));
    expect(outcomes, `${id} outcomes ${JSON.stringify(result.issues)}`).toEqual(v.expected.checks);
    for (const [name, code] of Object.entries(v.expected.issues)) expect(result.checks[name as CheckName].issues[0]?.code, `${id} ${name}`).toBe(code);
    for (const [name, outcome] of Object.entries(EXPECTED[id]!.checks)) expect(outcomes[name], `${id} ${name}`).toBe(outcome);
    for (const [name, code] of Object.entries(EXPECTED[id]!.issues)) expect(result.checks[name as CheckName].issues[0]?.code, `${id} ${name}`).toBe(code);
    expect(result.digest).toBe(v.expected.sha256);
    expect(result.evidenceScope).toBe('provided-evidence');
  }, 30_000);

  it.each(Object.keys(EXPECTED))('%s maps onto the verification report with the pinned reason codes', async id => {
    const v = vectors.find(x => x.id === id)!;
    const verifier = externalCredentialVerifierFor(policyFor(v));
    const report = await verifier({ representation: v.input.representation, bytes: [...bytesOf(v.input.credential)], digest: v.expected.sha256, checkedAt: v.input.policy.evaluationTime });
    const summary = Object.fromEntries(['proof', 'schema', 'time', 'status', 'authority', 'availability'].map(name => { const c = (report as unknown as Record<string, { status: string; reasonCode?: string }>)[name]!; return [name, c.reasonCode == null ? c.status : `${c.status}:${c.reasonCode}`]; }));
    expect(summary, id).toEqual(v.expected.report);
    for (const [name, value] of Object.entries(EXPECTED[id]!.report ?? {})) expect(summary[name], `${id} ${name}`).toMatch(new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    if (id !== 'issuer-substituted') expect(report.issuer).toBe(ISSUER);
    expect(report.attestationType).toBe('ProductPassportCredential');
    for (const [, code] of Object.entries(summary)) {
      const reason = code.split(':')[1];
      if (reason != null) expect(reason, `${id} shared reason code`).toMatch(/^(x-external-|[a-z]+(-[a-z]+)*$)/);
    }
  }, 30_000);

  it('id-collision: both credentials verify alone, share an identifier and differ in bytes', async () => {
    const v = vectors.find(x => x.id === 'id-collision')!;
    const a = await verifyExternalCredential({ bytes: bytesOf(v.input.credential), representation: v.input.representation, policy: policyFor(v) });
    const b = await verifyExternalCredential({ bytes: bytesOf(v.input.credentialB!), representation: v.input.representation, policy: policyFor(v) });
    expect(a.checks.proof.outcome).toBe('verified');
    expect(b.checks.proof.outcome).toBe('verified');
    expect(a.credentialId).toBe(b.credentialId);
    expect(a.digest).not.toBe(b.digest);
    expect(sha256(v.input.credentialB!)).toBe(v.expected.sha256B);
  }, 30_000);
});
