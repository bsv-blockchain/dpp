/**
 * External credential verification: the `vc-di-ecdsa-rdfc-2019@1` exchange
 * profile (`spec/external-credential-profile.md`), a separate entry point
 * (`@bsv/vsc/exchange`) from the SEAL verifier so that a foreign credential
 * is never routed through `verifySeal` and the main entry's proof verifier
 * keeps its pinned SEAL context allowlist.
 *
 * What is verified, each as its own check and never folded into one word:
 * exact-byte parsing, the context set, the owned structural schema, the
 * Data Integrity proof under `ecdsa-rdfc-2019` with a P-256 Multikey, the
 * binding of that key to a `did:web` issuer document, the subject binding,
 * the validity interval, the Bitstring status list, the issuer's authority
 * under a named policy, and the availability of everything referenced.
 *
 * Two facts stay independent throughout. An RDF Data Integrity proof holds
 * over canonicalised statements, so the same credential re-serialised with
 * different whitespace still verifies; the exact-byte digest of what was
 * issued is a different commitment, and a re-serialised copy has a different
 * one. Both are reported, neither implies the other.
 */
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import jsigs from 'jsonld-signatures';
import { DataIntegrityProof } from '@digitalbazaar/data-integrity';
import { cryptosuite as ecdsaRdfc2019 } from '@digitalbazaar/ecdsa-rdfc-2019-cryptosuite';
import { contexts as vcContexts } from '@digitalbazaar/credentials-context';
import { contexts as diContexts } from '@digitalbazaar/data-integrity-context';
import { contexts as multikeyContexts } from '@digitalbazaar/multikey-context';
import { contexts as didContexts } from 'did-context';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parseStrictJsonBytes } from './validation.js';
import { verifyTemporal } from './verification.js';
import { createDidWebResolver } from './did-web.js';
import type { Check, Credential, DocumentLoader, Issue, JsonObject, Proof, StatusPolicy } from './types.js';

export const EXTERNAL_REPRESENTATIONS = ['vc-di-ecdsa-rdfc-2019@1'] as const;
export type ExternalRepresentation = (typeof EXTERNAL_REPRESENTATIONS)[number];
export const EXTERNAL_MEDIA_TYPE = 'application/vc+ld+json' as const;
export const EXTERNAL_CRYPTOSUITE = 'ecdsa-rdfc-2019';
/** The profile limit on one credential's exact bytes: 256 KiB. */
export const EXTERNAL_CREDENTIAL_LIMIT_BYTES = 262_144;

export const VC_V2_CONTEXT = 'https://www.w3.org/ns/credentials/v2';
export const DATA_INTEGRITY_V2_CONTEXT = 'https://w3id.org/security/data-integrity/v2';
export const MULTIKEY_V1_CONTEXT = 'https://w3id.org/security/multikey/v1';
export const DID_V1_CONTEXT = 'https://www.w3.org/ns/did/v1';
/** The owned payload context of the profile, served from the package's artefact bytes and never fetched. */
export const EXTERNAL_PASSPORT_CONTEXT_URL = 'urn:bsv:dpp:external-passport:context:1';
export const EXTERNAL_PASSPORT_SCHEMA_ID = 'urn:bsv:dpp:external-passport:schema:1';
/** The P-256 public key multicodec prefix as it appears in base58btc Multikey encoding. */
const P256_MULTIBASE_PREFIX = 'zDn';
const P384_MULTIBASE_PREFIX = 'z82';
const P521_MULTIBASE_PREFIX = 'z2J9';

// Two literal URLs rather than one built from a name: a bundler that follows
// `new URL(literal, import.meta.url)` carries exactly that file as an asset,
// while a URL assembled from a variable makes it carry the whole directory and
// hand back the first file in it, which is the notice and not JSON.
const artefact = (url: URL): JsonObject => JSON.parse(readFileSync(url, 'utf8')) as JsonObject;
export const EXTERNAL_PASSPORT_CONTEXT: JsonObject = artefact(new URL('../artifacts/external/dpp-external-passport-1.context.jsonld', import.meta.url));
export const EXTERNAL_PASSPORT_SCHEMA: JsonObject = artefact(new URL('../artifacts/external/dpp-external-passport-1.schema.json', import.meta.url));

/** The context sets the profile accepts by default: the VC 2.0 context alone, or with the Data Integrity context, each optionally followed by the owned payload context. */
export const DEFAULT_CONTEXT_SETS: readonly (readonly string[])[] = [
  [VC_V2_CONTEXT],
  [VC_V2_CONTEXT, DATA_INTEGRITY_V2_CONTEXT],
  [VC_V2_CONTEXT, EXTERNAL_PASSPORT_CONTEXT_URL],
  [VC_V2_CONTEXT, DATA_INTEGRITY_V2_CONTEXT, EXTERNAL_PASSPORT_CONTEXT_URL],
];

const ajv = new Ajv2020({ allErrors: true, strict: true });
(addFormats as unknown as (a: Ajv2020) => void)(ajv);
let ownedValidator: ValidateFunction | undefined;
/** The compiled owned schema, compiled once. */
export function externalPassportSchemaValidator(): ValidateFunction {
  ownedValidator ??= ajv.compile(EXTERNAL_PASSPORT_SCHEMA);
  return ownedValidator;
}

export interface ExternalLoaderOptions {
  /** A bounded `did:web` resolver for identifiers the caller has not pinned; absent, an unpinned DID is unavailable. */
  didWeb?: { allowedOrigins: readonly string[]; fetcher?: typeof globalThis.fetch; timeoutMs?: number; maxBytes?: number };
}

/**
 * The profile's document loader: the maintained VC 2.0, Data Integrity,
 * Multikey and DID contexts, the owned payload context from the package's
 * own bytes, and the caller's pinned documents (issuer DID documents, keys,
 * status list credentials). Nothing else is served: a context or document a
 * credential names that is not pinned is unavailable, and the SEAL profile
 * context is refused by name so a foreign credential cannot borrow it.
 */
export function createExternalDocumentLoader(documents: ReadonlyMap<string, JsonObject> = new Map(), options: ExternalLoaderOptions = {}): DocumentLoader {
  const builtins = new Map<string, JsonObject>([
    ...vcContexts, ...diContexts, ...multikeyContexts, ...didContexts,
    [EXTERNAL_PASSPORT_CONTEXT_URL, EXTERNAL_PASSPORT_CONTEXT],
  ]);
  const didWeb = options.didWeb == null ? undefined : createDidWebResolver(options.didWeb);
  return async url => {
    if (url.startsWith('urn:bsv:vsc:')) throw new Error(`Unsupported context: ${url} is the SEAL profile's and is never served to an external credential`);
    const document = builtins.get(url) ?? documents.get(url);
    if (document) return { document: structuredClone(document), documentUrl: url, contextUrl: null };
    if (didWeb != null && url.startsWith('did:web:')) return didWeb(url);
    throw new Error(`No document available: ${url}`);
  };
}

export interface ParsedExternalCredential {
  credential: JsonObject;
  /** SHA-256 of the exact bytes, lower-case hex. */
  digest: string;
  byteLength: number;
}

/** Parse exact bytes strictly (duplicate keys, malformed UTF-8 and depth refused) under the profile's 256 KiB limit. The bytes are never re-serialised. */
export function parseExternalCredentialBytes(bytes: Uint8Array, limits: { maxBytes?: number } = {}): ParsedExternalCredential {
  const maxBytes = limits.maxBytes ?? EXTERNAL_CREDENTIAL_LIMIT_BYTES;
  if (bytes.byteLength > maxBytes) throw new Error(`Credential exceeds the ${maxBytes} byte profile limit`);
  const value = parseStrictJsonBytes(bytes);
  if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new Error('A credential is a JSON object');
  return { credential: value as JsonObject, digest: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength };
}

export interface ExternalContextPolicy { allowedContextSets: readonly (readonly string[])[] }
export interface ExternalIssuerPolicy {
  /** DID methods the profile accepts for the issuer, for example `did:web`. */
  allowedMethods: readonly string[];
  /** Resolves an issuer DID to its document; defaults to the document loader. */
  resolve?: (did: string) => Promise<JsonObject>;
}
export type ExternalAuthorityPolicy =
  | { id: string; required: false; reason: string }
  | { id: string; required: true; trustedIssuers: readonly string[] };
export interface SubjectBindingPolicy {
  id: string;
  bindings: ReadonlyArray<{ credentialSubject: string; passportId: string; evidenceRef: string }>;
}
export interface ExternalVerificationPolicy {
  documentLoader: DocumentLoader;
  contextPolicy?: ExternalContextPolicy;
  /** A compiled JSON Schema 2020-12 validator; defaults to the owned external passport schema. */
  payloadSchema?: ValidateFunction;
  issuerPolicy?: ExternalIssuerPolicy;
  statusPolicy?: StatusPolicy;
  /** Only with no status policy: a profile option recording that a credential without status is accepted with a stated limitation. */
  statusOptional?: boolean;
  authorityPolicy: ExternalAuthorityPolicy;
  expectedSubject?: string;
  subjectBindingPolicy?: SubjectBindingPolicy;
  evaluationTime: string;
}

export interface ExternalVerification {
  representation: ExternalRepresentation;
  mediaType: typeof EXTERNAL_MEDIA_TYPE;
  credentialId?: string;
  issuer?: string;
  subjects: string[];
  types: string[];
  digest: string;
  checks: {
    parse: Check; contexts: Check; schema: Check; proof: Check; issuerBinding: Check;
    subjectBinding: Check; temporal: Check; status: Check; authority: Check; availability: Check;
  };
  issues: Issue[];
  /** Verification concerns the supplied bytes and the pinned or resolved documents; it establishes no global freshness. */
  evidenceScope: 'provided-evidence';
}

const good = (evidence?: string[]): Check => ({ outcome: 'verified', issues: [], ...(evidence == null ? {} : { evidence }) });
const fail = (code: string, message: string, outcome: Check['outcome'] = 'invalid', path = ''): Check => ({ outcome, issues: [{ code, path, message }] });
const notEvaluated = (): Check => fail('not_evaluated', 'Earlier validation did not permit this check', 'indeterminate');
const isUri = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9+.-]*:\S+$/i.test(value);
const proofArray = (credential: JsonObject): Proof[] => Array.isArray(credential.proof) ? credential.proof as Proof[] : credential.proof != null && typeof credential.proof === 'object' ? [credential.proof as Proof] : [];
const sameList = (a: readonly unknown[], b: readonly unknown[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

function contextsCheck(credential: JsonObject, policy: ExternalContextPolicy): Check {
  const contexts = credential['@context'];
  if (!Array.isArray(contexts) || contexts.length === 0) return fail('context_missing', 'A credential declares its contexts as a non-empty array', 'invalid', '/@context');
  if (contexts.some(c => typeof c !== 'string')) return fail('context_inline', 'An inline context object is not a pinned artefact; it could redefine signed terms, so it is unsupported rather than trusted', 'unsupported', '/@context');
  if (contexts[0] !== VC_V2_CONTEXT) return fail('context_unsupported', 'The first context must be the W3C Verifiable Credentials 2.0 context', 'unsupported', '/@context');
  if (!policy.allowedContextSets.some(set => sameList(set, contexts as string[]))) return fail('context_unsupported', `The context set [${(contexts as string[]).join(', ')}] is not one this profile pins`, 'unsupported', '/@context');
  return good(contexts as string[]);
}

function schemaCheck(credential: JsonObject, validate: ValidateFunction): Check {
  if (validate(credential)) return good([EXTERNAL_PASSPORT_SCHEMA_ID]);
  return { outcome: 'invalid', issues: (validate.errors ?? []).map(e => ({ code: 'schema', path: e.instancePath, message: e.message ?? 'Invalid field' })) };
}

interface Resolved { didDocument?: JsonObject; unavailable: string[]; available: string[] }

async function loadDocument(loader: DocumentLoader, url: string, resolved: Resolved): Promise<JsonObject | undefined> {
  try {
    const { document } = await loader(url);
    resolved.available.push(url);
    return document;
  } catch {
    resolved.unavailable.push(url);
    return undefined;
  }
}

/** Whether a DID document authorises a verification method for assertion, by identifier or by embedding. */
function authorisesAssertion(didDocument: JsonObject, methodId: string): boolean {
  const relationships = didDocument.assertionMethod;
  if (!Array.isArray(relationships)) return false;
  return relationships.some(value => value === methodId || (typeof value === 'object' && value !== null && (value as JsonObject).id === methodId));
}

/**
 * The issuer binding: the issuer is a DID under an allowed method, its
 * document resolves and identifies it, and every proof's verification method
 * is a P-256 Multikey controlled by the issuer and listed under
 * `assertionMethod`. Resolving a document establishes a key relationship and
 * nothing more: no allocation authority, no accreditation.
 */
async function issuerBindingCheck(credential: JsonObject, proofs: Proof[], policy: ExternalVerificationPolicy, resolved: Resolved): Promise<Check> {
  const issuer = credential.issuer;
  if (typeof issuer !== 'string' || !issuer.startsWith('did:')) return fail('issuer_not_did', 'The issuer must be a DID string; embedded issuer objects are not supported by this profile', 'unsupported', '/issuer');
  const methods = policy.issuerPolicy?.allowedMethods ?? ['did:web'];
  if (!methods.some(m => issuer.startsWith(`${m}:`))) return fail('did_method_unsupported', `Issuer DID method is not one of ${methods.join(', ')}`, 'unsupported', '/issuer');
  let didDocument: JsonObject | undefined;
  if (policy.issuerPolicy?.resolve != null) {
    try { didDocument = await policy.issuerPolicy.resolve(issuer); resolved.available.push(issuer); } catch { resolved.unavailable.push(issuer); }
  } else {
    didDocument = await loadDocument(policy.documentLoader, issuer, resolved);
  }
  if (didDocument == null) return fail('issuer_document_unavailable', `The issuer document ${issuer} could not be resolved`, 'indeterminate', '/issuer');
  if (didDocument.id !== issuer) return fail('issuer_document_mismatch', `The resolved document identifies ${String(didDocument.id)}, not the issuer ${issuer}`, 'invalid', '/issuer');
  resolved.didDocument = didDocument;
  if (proofs.length === 0) return fail('proof_missing', 'A secured credential is required to bind an issuer to a key', 'invalid', '/proof');
  const evidence: string[] = [issuer];
  for (const proof of proofs) {
    const methodId = proof.verificationMethod;
    if (typeof methodId !== 'string' || methodId === '') return fail('verification_method_missing', 'A proof names its verification method', 'invalid', '/proof/verificationMethod');
    const method = await loadDocument(policy.documentLoader, methodId, resolved);
    if (method == null) return fail('verification_method_unavailable', `The verification method ${methodId} could not be resolved`, 'indeterminate', '/proof/verificationMethod');
    const multibase = method.publicKeyMultibase;
    if (method.type !== 'Multikey' || typeof multibase !== 'string') return fail('key_type_unsupported', 'Only a Multikey verification method is supported by this profile', 'unsupported', '/proof/verificationMethod');
    if (!multibase.startsWith(P256_MULTIBASE_PREFIX)) {
      const curve = multibase.startsWith(P384_MULTIBASE_PREFIX) ? 'P-384' : multibase.startsWith(P521_MULTIBASE_PREFIX) ? 'P-521' : 'an unrecognised key type';
      return fail('curve_unsupported', `The verification method is ${curve}; this profile supports P-256 only`, 'unsupported', '/proof/verificationMethod');
    }
    const controller = typeof method.controller === 'string' ? method.controller : (method.controller as JsonObject | undefined)?.id;
    if (controller !== issuer) return fail('key_controller_mismatch', `The key ${methodId} is controlled by ${String(controller)}, not the issuer ${issuer}`, 'invalid', '/proof/verificationMethod');
    if (!authorisesAssertion(didDocument, methodId)) return fail('key_not_authorised', `The issuer document does not list ${methodId} under assertionMethod`, 'invalid', '/proof/verificationMethod');
    evidence.push(methodId);
  }
  return good(evidence);
}

/**
 * The proof itself: every proof is a Data Integrity proof under
 * `ecdsa-rdfc-2019` for the assertion purpose, verified by the maintained
 * suite with the issuer's resolved document as the controller. A set that
 * mixes suites, or any other suite, is unsupported rather than failed.
 */
async function proofCheck(credential: JsonObject, proofs: Proof[], policy: ExternalVerificationPolicy, resolved: Resolved): Promise<Check> {
  if (proofs.length === 0) return fail('proof_missing', 'A secured credential is required', 'invalid', '/proof');
  for (const proof of proofs) {
    if (proof.type !== 'DataIntegrityProof' || proof.cryptosuite !== EXTERNAL_CRYPTOSUITE) {
      return fail('suite_unsupported', `Proof suite ${String(proof.type)}/${String(proof.cryptosuite ?? '')} is not ${EXTERNAL_CRYPTOSUITE}`, 'unsupported', '/proof');
    }
    if (proof.proofPurpose !== 'assertionMethod') return fail('proof_purpose', 'The proof does not authorise an assertion', 'invalid', '/proof/proofPurpose');
  }
  if (resolved.didDocument == null) return fail('issuer_document_unavailable', 'The proof cannot be evaluated without the issuer document', 'indeterminate', '/issuer');
  const purpose = new jsigs.purposes.AssertionProofPurpose({ controller: resolved.didDocument });
  const suite = new DataIntegrityProof({ cryptosuite: ecdsaRdfc2019 });
  try {
    const result = await jsigs.verify(credential, { suite, purpose, documentLoader: policy.documentLoader });
    if (result.verified) return good(proofs.map(p => p.verificationMethod));
    const message: string = result.error?.message ?? result.results?.find((r: { error?: Error }) => r.error)?.error?.message ?? 'Cryptographic proof failed';
    const detail: string[] = Array.isArray(result.error?.errors) ? result.error.errors.map((e: Error) => e.message) : [];
    const text = [message, ...detail].join('; ');
    if (/not authori[sz]ed|proof purpose/i.test(text)) return fail('key_not_authorised', text, 'invalid', '/proof');
    if (/No document available/.test(text)) return fail('referenced_artefact_unavailable', text, 'indeterminate', '/proof');
    return fail('proof_failed', text, 'invalid', '/proof');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(/No document available/.test(message) ? 'referenced_artefact_unavailable' : 'proof_failed', message, /No document available/.test(message) ? 'indeterminate' : 'invalid', '/proof');
  }
}

function subjectBindingCheck(credential: JsonObject, policy: ExternalVerificationPolicy): { check: Check; subjects: string[] } {
  const subject = credential.credentialSubject;
  if (Array.isArray(subject)) return { check: fail('subject_structure_unsupported', 'This profile supports exactly one credential subject', 'unsupported', '/credentialSubject'), subjects: subject.map(s => (s as JsonObject)?.id).filter(isUri) };
  if (subject == null || typeof subject !== 'object' || !isUri((subject as JsonObject).id)) return { check: fail('subject_structure_unsupported', 'The credential subject must carry an explicit URI identifier', 'unsupported', '/credentialSubject/id'), subjects: [] };
  const id = (subject as JsonObject).id as string;
  if (policy.expectedSubject == null) return { check: { outcome: 'not-required', issues: [{ code: 'subject_not_expected', path: '/credentialSubject/id', message: `No expected subject was supplied; the credential names ${id}` }], evidence: [id] }, subjects: [id] };
  if (policy.expectedSubject === id) return { check: good([id]), subjects: [id] };
  const binding = policy.subjectBindingPolicy?.bindings.find(b => b.credentialSubject === id && b.passportId === policy.expectedSubject);
  if (binding != null) return { check: good([id, binding.evidenceRef, policy.subjectBindingPolicy!.id]), subjects: [id] };
  return { check: fail('subject_mismatch', `The credential names ${id}, not the expected ${policy.expectedSubject}, and no binding policy relates them`, 'invalid', '/credentialSubject/id'), subjects: [id] };
}

/**
 * The W3C Bitstring Status List rules of the SEAL verifier, with the proof
 * verifier a parameter so the list is checked under this profile's suite.
 * Identifier, authorised list issuer, proof, validity, signed freshness,
 * purpose, canonical encoding, bounded decompression and the bit are
 * separate refusals; a stale list stays stale however recently fetched.
 */
export async function verifyBitstringStatus(
  credential: JsonObject,
  options: { statusPolicy?: StatusPolicy; statusOptional?: boolean; evaluationTime: string },
  verifyProof: (list: JsonObject) => Promise<Check>
): Promise<Check> {
  const entry = credential.credentialStatus as JsonObject | undefined;
  const policy = options.statusPolicy;
  if (entry == null) {
    if (policy != null) return fail('status_entry_missing', 'The status policy requires a status entry and the credential carries none', 'invalid', '/credentialStatus');
    if (options.statusOptional === true) return { outcome: 'not-required', issues: [{ code: 'status_not_required', path: '/credentialStatus', message: 'The selected profile option accepts a credential without status; revocation cannot be evaluated' }] };
    return fail('status_policy_missing', 'No authenticated status evidence policy is configured', 'indeterminate', '/credentialStatus');
  }
  if (!policy) return fail('status_policy_missing', 'No authenticated status evidence policy is configured', 'indeterminate', '/credentialStatus');
  if (!policy.id || !Number.isFinite(policy.maxAgeMs) || policy.maxAgeMs <= 0 || policy.maxAgeMs > 7 * 24 * 60 * 60 * 1000) return fail('status_policy_invalid', 'Status freshness must be explicitly bounded to no more than seven days');
  if (entry.type !== 'BitstringStatusListEntry' || !['revocation', 'suspension'].includes(entry.statusPurpose as string) || typeof entry.statusListIndex !== 'string' || !/^(0|[1-9][0-9]*)$/.test(entry.statusListIndex) || typeof entry.statusListCredential !== 'string') return fail('status_entry_invalid', 'A supported status entry with a canonical decimal index is required', 'invalid', '/credentialStatus');
  const index = Number(entry.statusListIndex);
  if (!Number.isSafeInteger(index)) return fail('status_index_invalid', 'Status index is out of range');
  let list: Credential;
  try { list = await policy.resolve(entry.statusListCredential); } catch { return fail('status_unavailable', 'Status evidence could not be retrieved', 'indeterminate'); }
  if (!list || typeof list !== 'object' || list.id !== entry.statusListCredential || !Array.isArray(list.type) || !list.type.includes('BitstringStatusListCredential')) return fail('status_identity', 'Status list identifier or credential type does not match');
  const authorised = list.issuer === credential.issuer || policy.delegatedListIssuers?.[credential.issuer as string]?.includes(list.issuer);
  if (!authorised) return fail('status_issuer', 'The credential issuer has not been granted this status-list issuer by verifier policy');
  const proof = await verifyProof(list as JsonObject);
  if (proof.outcome !== 'verified') return { ...proof, issues: proof.issues.map(i => ({ ...i, code: 'status_proof' })) };
  const temporal = verifyTemporal(list, options.evaluationTime);
  if (temporal.outcome !== 'verified') return temporal;
  if (Date.parse(options.evaluationTime) - Date.parse(list.validFrom) > policy.maxAgeMs) return fail('status_stale', 'Signed status evidence exceeds the configured freshness interval', 'indeterminate');
  const subject = list.credentialSubject;
  if (!subject || subject.type !== 'BitstringStatusList' || subject.statusPurpose !== entry.statusPurpose || typeof subject.encodedList !== 'string' || !/^u[A-Za-z0-9_-]+$/.test(subject.encodedList)) return fail('status_payload', 'Status list purpose, subject type or encoding is invalid');
  try {
    const compressed = Buffer.from(subject.encodedList.slice(1), 'base64url');
    if (`u${compressed.toString('base64url')}` !== subject.encodedList || compressed.length > 1_048_576) return fail('status_encoding', 'Status list encoding is not canonical or exceeds the profile limit');
    const bytes = gunzipSync(compressed, { maxOutputLength: 1_048_576 });
    if (bytes.length < 16_384 || index >= bytes.length * 8) return fail('status_index_invalid', 'Status list is too small or index is outside the list');
    // W3C Bitstring Status List indexes each byte from most significant bit to least significant bit.
    if (bytes[Math.floor(index / 8)] & (1 << (7 - index % 8))) return fail(entry.statusPurpose === 'revocation' ? 'revoked' : 'suspended', 'Credential status prevents acceptance');
  } catch { return fail('status_encoding', 'Status list decompression failed or exceeded the profile limit'); }
  return good([list.id, policy.id]);
}

function authorityCheck(issuer: string | undefined, policy: ExternalAuthorityPolicy): Check {
  if (!policy.required) return { outcome: 'not-required', issues: [{ code: 'authority_not_required', path: '', message: policy.reason }], evidence: [policy.id] };
  if (issuer != null && policy.trustedIssuers.includes(issuer)) return good([policy.id, issuer]);
  return fail('issuer_unauthorised', `${issuer ?? 'the issuer'} is not an issuer the policy ${policy.id} trusts for this claim`, 'invalid', '/issuer');
}

/**
 * Verify one external credential from its exact bytes under the profile.
 * Every check answers for itself; `issues` is the union of their issues.
 * Nothing here consults a trust list the credential carries, and nothing
 * here reads the credential under the SEAL profile's rules.
 */
export async function verifyExternalCredential({ bytes, representation, policy }: { bytes: Uint8Array; representation: string; policy: ExternalVerificationPolicy }): Promise<ExternalVerification> {
  const digest = createHash('sha256').update(bytes).digest('hex');
  const base = { representation: EXTERNAL_REPRESENTATIONS[0], mediaType: EXTERNAL_MEDIA_TYPE as typeof EXTERNAL_MEDIA_TYPE, subjects: [] as string[], types: [] as string[], digest, evidenceScope: 'provided-evidence' as const };
  const finish = (checks: ExternalVerification['checks'], extra: Partial<ExternalVerification> = {}): ExternalVerification => ({ ...base, ...extra, checks, issues: Object.values(checks).flatMap(c => c.issues) });
  const pending = notEvaluated();
  if (!(EXTERNAL_REPRESENTATIONS as readonly string[]).includes(representation)) {
    return finish({ parse: fail('representation_unsupported', `${representation} is not a representation this entry point verifies`, 'unsupported'), contexts: pending, schema: pending, proof: pending, issuerBinding: pending, subjectBinding: pending, temporal: pending, status: pending, authority: pending, availability: pending });
  }
  let parsed: ParsedExternalCredential;
  try {
    parsed = parseExternalCredentialBytes(bytes);
  } catch (error) {
    return finish({ parse: fail('parse', error instanceof Error ? error.message : String(error)), contexts: pending, schema: pending, proof: pending, issuerBinding: pending, subjectBinding: pending, temporal: pending, status: pending, authority: pending, availability: pending });
  }
  const credential = parsed.credential;
  const types = Array.isArray(credential.type) ? credential.type.filter((t): t is string => typeof t === 'string') : [];
  const issuer = typeof credential.issuer === 'string' ? credential.issuer : undefined;
  const credentialId = isUri(credential.id) ? credential.id : undefined;
  const resolved: Resolved = { unavailable: [], available: [] };
  const proofs = proofArray(credential);

  const contexts = contextsCheck(credential, policy.contextPolicy ?? { allowedContextSets: DEFAULT_CONTEXT_SETS });
  const schema = schemaCheck(credential, policy.payloadSchema ?? externalPassportSchemaValidator());
  const issuerBinding = await issuerBindingCheck(credential, proofs, policy, resolved);
  // The proof is evaluated under pinned contexts and a resolved, supported
  // issuer binding. An unsupported key or an unresolved document leaves the
  // proof unsupported or indeterminate with the same reason; a binding that
  // resolved and failed still lets the suite say what the signature does.
  const proof = contexts.outcome !== 'verified'
    ? fail('context_unsupported', 'The proof covers statements under contexts this profile does not pin, so it is not evaluated', 'unsupported', '/@context')
    : issuerBinding.outcome === 'unsupported' || issuerBinding.outcome === 'indeterminate'
      ? { outcome: issuerBinding.outcome, issues: issuerBinding.issues.map(i => ({ ...i, path: '/proof' })) }
      : await proofCheck(credential, proofs, policy, resolved);
  const { check: subjectBinding, subjects } = subjectBindingCheck(credential, policy);
  const temporal = typeof credential.validFrom === 'string' ? verifyTemporal(credential as unknown as Credential, policy.evaluationTime) : fail('invalid_time', 'A credential states validFrom', 'invalid', '/validFrom');
  const statusVerifier = async (list: JsonObject): Promise<Check> => {
    const listProofs = proofArray(list);
    const listResolved: Resolved = { unavailable: [], available: [] };
    const listContexts = contextsCheck(list, policy.contextPolicy ?? { allowedContextSets: DEFAULT_CONTEXT_SETS });
    if (listContexts.outcome !== 'verified') return listContexts;
    const binding = await issuerBindingCheck(list, listProofs, policy, listResolved);
    resolved.unavailable.push(...listResolved.unavailable);
    resolved.available.push(...listResolved.available);
    if (binding.outcome !== 'verified') return binding;
    return proofCheck(list, listProofs, policy, listResolved);
  };
  const status = await verifyBitstringStatus(credential, { statusPolicy: policy.statusPolicy, statusOptional: policy.statusOptional, evaluationTime: policy.evaluationTime }, statusVerifier);
  if (status.issues.some(i => i.code === 'status_unavailable') && typeof (credential.credentialStatus as JsonObject | undefined)?.statusListCredential === 'string') resolved.unavailable.push((credential.credentialStatus as JsonObject).statusListCredential as string);
  const authority = authorityCheck(issuer, policy.authorityPolicy);
  const availability = resolved.unavailable.length === 0
    ? good([...new Set(resolved.available)])
    : { outcome: 'indeterminate' as const, issues: [...new Set(resolved.unavailable)].map(url => ({ code: 'referenced_artefact_unavailable', path: '', message: `${url} was not available` })), evidence: [...new Set(resolved.available)] };

  return finish({ parse: good([`sha256:${digest}`]), contexts, schema, proof, issuerBinding, subjectBinding, temporal, status, authority, availability }, { ...(credentialId == null ? {} : { credentialId }), ...(issuer == null ? {} : { issuer }), subjects, types });
}

/* ------------------------- the report adapter ------------------------- */

/** A check's answer in the verification report's vocabulary (`spec/verification.md`); the shape mirrors `PartialCheck` in @bsv/dpp-core, restated here because this package does not depend on it. */
export interface ReportPartialCheck { status: 'pass' | 'fail' | 'unknown' | 'not-applicable'; reasonCode?: string; evidenceRefs?: string[]; detail?: unknown }
/** What the report's credential verifier slot returns; mirrors `ExternalCredentialVerification` in @bsv/dpp-core. */
export interface ReportCredentialVerification {
  id?: string; issuer?: string; subjects?: string[]; attestationType?: string;
  proof: ReportPartialCheck; schema: ReportPartialCheck; time: ReportPartialCheck; status: ReportPartialCheck; authority: ReportPartialCheck; availability?: ReportPartialCheck;
}
export type ReportCredentialVerifier = (input: { representation: string; mediaType?: string; bytes: number[]; digest: string; checkedAt: string }) => Promise<ReportCredentialVerification>;

/** The profile's issue codes that name a shared reason code of the report; anything else becomes an `x-external-` code. */
const REASON_BY_ISSUE: Readonly<Record<string, string>> = {
  representation_unsupported: 'representation-unsupported',
  parse: 'decode-failed',
  context_unsupported: 'suite-unsupported',
  context_inline: 'suite-unsupported',
  context_missing: 'suite-unsupported',
  suite_unsupported: 'suite-unsupported',
  curve_unsupported: 'suite-unsupported',
  key_type_unsupported: 'suite-unsupported',
  proof_missing: 'proof-absent',
  proof_failed: 'signature-invalid',
  proof_purpose: 'signature-invalid',
  key_not_authorised: 'signature-invalid',
  key_controller_mismatch: 'signature-invalid',
  issuer_document_mismatch: 'signature-invalid',
  issuer_not_did: 'suite-unsupported',
  did_method_unsupported: 'suite-unsupported',
  verification_method_missing: 'signature-invalid',
  verification_method_unavailable: 'referenced-artefact-unavailable',
  issuer_document_unavailable: 'referenced-artefact-unavailable',
  referenced_artefact_unavailable: 'referenced-artefact-unavailable',
  schema: 'schema-invalid',
  not_yet_valid: 'not-yet-valid',
  expired: 'expired',
  invalid_time: 'time-invalid',
  revoked: 'status-revoked',
  suspended: 'status-suspended',
  status_stale: 'status-stale',
  status_unavailable: 'status-unknown',
  status_policy_missing: 'policy-missing',
  status_policy_invalid: 'policy-missing',
  status_entry_missing: 'status-unset',
  status_not_required: 'status-unset',
  status_proof: 'status-unauthenticated',
  status_issuer: 'status-unauthenticated',
  status_identity: 'status-unauthenticated',
  status_payload: 'status-unknown',
  status_encoding: 'status-unknown',
  status_index_invalid: 'status-unknown',
  status_entry_invalid: 'status-purpose-unsupported',
  issuer_unauthorised: 'authority-unconfirmed',
  authority_not_required: 'authority-not-required',
  subject_mismatch: 'subject-mismatch',
  subject_structure_unsupported: 'suite-unsupported',
  not_evaluated: 'not-inspected',
};

function partial(check: Check): ReportPartialCheck {
  const detail = check.issues.length === 0 ? undefined : check.issues.map(i => ({ code: i.code, path: i.path, message: i.message }));
  const refs = check.evidence == null ? {} : { evidenceRefs: check.evidence };
  if (check.outcome === 'verified') return { status: 'pass', ...refs };
  const first = check.issues[0]?.code;
  const reasonCode = first == null ? 'x-external-unspecified' : REASON_BY_ISSUE[first] ?? `x-external-${first.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
  if (check.outcome === 'not-required') return { status: 'not-applicable', reasonCode, ...refs, ...(detail == null ? {} : { detail }) };
  return { status: check.outcome === 'invalid' ? 'fail' : 'unknown', reasonCode, ...refs, ...(detail == null ? {} : { detail }) };
}

/** The worse of two answers: a failure outranks an unknown, an unknown outranks a pass. */
function worst(a: ReportPartialCheck, b: ReportPartialCheck): ReportPartialCheck {
  const rank = (c: ReportPartialCheck): number => c.status === 'fail' ? 3 : c.status === 'unknown' ? 2 : c.status === 'not-applicable' ? 1 : 0;
  const chosen = rank(b) > rank(a) ? b : a;
  const refs = [...new Set([...(a.evidenceRefs ?? []), ...(b.evidenceRefs ?? [])])];
  return { ...chosen, ...(refs.length === 0 ? {} : { evidenceRefs: refs }) };
}

/**
 * The verifier the report's `credentialVerifier` slot takes for this
 * representation. The proof and issuer-binding checks answer `proof`
 * together (a proof whose key its issuer never authorised does not verify
 * under its own suite's controller rule); the schema, validity interval,
 * status, authority and availability checks answer their own slots. The
 * attestation type is the credential's first type after VerifiableCredential.
 */
export function externalCredentialVerifierFor(policy: Omit<ExternalVerificationPolicy, 'evaluationTime'> & { evaluationTime?: string }): ReportCredentialVerifier {
  return async input => {
    if (!(EXTERNAL_REPRESENTATIONS as readonly string[]).includes(input.representation)) {
      throw new Error(`this verifier handles ${EXTERNAL_REPRESENTATIONS.join(', ')} only, not ${input.representation}`);
    }
    const result = await verifyExternalCredential({ bytes: Uint8Array.from(input.bytes), representation: input.representation, policy: { ...policy, evaluationTime: policy.evaluationTime ?? input.checkedAt } });
    const attestationType = result.types.find(t => t !== 'VerifiableCredential');
    return {
      ...(result.credentialId == null ? {} : { id: result.credentialId }),
      ...(result.issuer == null ? {} : { issuer: result.issuer }),
      subjects: result.subjects,
      ...(attestationType == null ? {} : { attestationType }),
      proof: worst(partial(result.checks.parse.outcome === 'verified' ? result.checks.proof : result.checks.parse), partial(result.checks.issuerBinding)),
      schema: partial(result.checks.schema),
      time: partial(result.checks.temporal),
      status: partial(result.checks.status),
      authority: partial(result.checks.authority),
      availability: partial(result.checks.availability),
    };
  };
}
