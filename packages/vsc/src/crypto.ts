import jsigs from 'jsonld-signatures';
import { Ed25519Signature2020 } from '@digitalbazaar/ed25519-signature-2020';
import { DataIntegrityProof } from '@digitalbazaar/data-integrity';
import { createSignCryptosuite, createDiscloseCryptosuite, createVerifyCryptosuite } from '@digitalbazaar/bbs-2023-cryptosuite';
import type { Credential, DocumentLoader, JsonObject, Proof, Seal, Check } from './types.js';
import { validateSealStructure, validateSealPresentationStructure } from './validation.js';
import { SEAL_CONTEXTS } from './context.js';

export interface SigningKey { id: string; controller: string; signer(): unknown; }
export const ALWAYS_DISCLOSED = [
  '/id','/type','/issuer','/validFrom','/sealVersion','/sealTimestamp','/correctionOf',
  '/credentialSubject','/credentialStatus',
  '/eventVector/what/productIdentifiers','/eventVector/when/eventTime',
  '/eventVector/when/timezone','/eventVector/where/jurisdiction',
  '/eventVector/who/actorDid','/eventVector/who/actorRole','/eventVector/who/assertionMethod',
  '/eventVector/how/eventType','/eventVector/how/eventTypeVocab','/eventVector/how/disposition',
  '/chainOfCustody/chainId',
] as const;

function assertUnsigned(seal: Seal, key: SigningKey): void {
  const validation = validateSealStructure(seal, { requireProof: false });
  if (!validation.valid) throw new Error(validation.errors.map(e => `${e.path}: ${e.message}`).join('; '));
  if (seal.proof) throw new Error('Issue a new immutable credential instead of replacing a proof');
  if (seal.issuer !== key.controller || seal.eventVector.who.assertionMethod !== key.id) throw new Error('Signing key must match the declared issuer and assertion method');
}
export async function signCredentialEd25519({ credential, key, documentLoader, date }: {
  credential: Credential; key: SigningKey; documentLoader: DocumentLoader; date?: string;
}): Promise<Credential> {
  if (credential.issuer !== key.controller) throw new Error('Signing key controller must match issuer');
  const suite = new Ed25519Signature2020({ key, date: date ?? credential.validFrom });
  return jsigs.sign(structuredClone(credential), { suite, purpose: new jsigs.purposes.AssertionProofPurpose(), documentLoader });
}
export async function issueSealEd25519(options: { credential: Seal; key: SigningKey; documentLoader: DocumentLoader }): Promise<Seal> {
  assertUnsigned(options.credential, options.key);
  return await signCredentialEd25519(options) as Seal;
}
export async function issueSealBbs({ credential, key, documentLoader }: { credential: Seal; key: SigningKey; documentLoader: DocumentLoader }): Promise<Seal> {
  assertUnsigned(credential, key);
  const mandatoryPointers: string[] = ALWAYS_DISCLOSED.filter(p => p !== '/correctionOf' || credential.correctionOf !== null);
  if (credential.validUntil) mandatoryPointers.push('/validUntil');
  const suite = new DataIntegrityProof({ signer: key.signer(), cryptosuite: createSignCryptosuite({ mandatoryPointers }) });
  return jsigs.sign(structuredClone(credential), { suite, purpose: new jsigs.purposes.AssertionProofPurpose(), documentLoader });
}
async function issuerPurpose(credential: Credential, proof: Proof, documentLoader: DocumentLoader): Promise<unknown> {
  if (typeof credential.issuer !== 'string' || !credential.issuer.startsWith('did:')) throw new Error('Issuer must be a DID');
  if (proof.proofPurpose !== 'assertionMethod') throw new Error('Proof does not authorise an assertion');
  const { document } = await documentLoader(credential.issuer);
  if (document.id !== credential.issuer) throw new Error('Resolved DID document does not identify the issuer');
  const relationships = document.assertionMethod;
  if (!Array.isArray(relationships) || !relationships.some(value => value === proof.verificationMethod || (typeof value === 'object' && value !== null && (value as JsonObject).id === proof.verificationMethod))) throw new Error('Issuer has not authorised this assertion method');
  return new jsigs.purposes.AssertionProofPurpose({ controller: document });
}
function proofArray(credential: Credential): Proof[] { return Array.isArray(credential.proof) ? credential.proof : credential.proof ? [credential.proof] : []; }
function bbsDerived(proof: Proof): boolean {
  // The maintained suite parses and verifies the encoded proof. This prefix only selects its operation.
  return proof.proofValue.startsWith('u2V0D');
}
async function verifyOne(credential: Credential, proof: Proof, documentLoader: DocumentLoader, presentationHeader?: Uint8Array): Promise<void> {
  const purpose = await issuerPurpose(credential, proof, documentLoader);
  let document = { ...structuredClone(credential), proof };
  let suite: unknown;
  if (proof.type === 'Ed25519Signature2020') {
    if (presentationHeader) throw new Error('An ordinary Ed25519 proof is not a request-bound selective presentation');
    suite = new Ed25519Signature2020();
  }
  else if (proof.type === 'DataIntegrityProof' && proof.cryptosuite === 'bbs-2023') {
    if (!bbsDerived(proof)) {
      if (presentationHeader) throw new Error('A presentation must contain a derived proof');
      const selectivePointers = Object.keys(document).filter(k => k !== '@context' && k !== 'proof' && document[k as keyof typeof document] !== null).map(k => `/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`);
      document = await jsigs.derive(document, {
        suite: new DataIntegrityProof({ cryptosuite: createDiscloseCryptosuite({ selectivePointers }) }), purpose, documentLoader,
      });
    }
    suite = new DataIntegrityProof({ cryptosuite: createVerifyCryptosuite({ expectedPresentationHeader: presentationHeader }) });
  } else throw new Error(`Unsupported proof suite: ${proof.type}/${proof.cryptosuite ?? ''}`);
  const result = await jsigs.verify(document, { suite, purpose, documentLoader });
  if (!result.verified) throw new Error(result.error?.message ?? result.results?.[0]?.error?.message ?? 'Cryptographic proof failed');
}
export async function verifyCredentialProof({ credential, documentLoader, presentationHeader }: { credential: Credential; documentLoader: DocumentLoader; presentationHeader?: Uint8Array }): Promise<Check> {
  if (!Array.isArray(credential['@context']) || credential['@context'][0] !== SEAL_CONTEXTS[0] || credential['@context'].some(c => typeof c !== 'string' || !SEAL_CONTEXTS.includes(c))) return { outcome: 'unsupported', issues: [{ code: 'context_unsupported', path: '/@context', message: 'Only pinned profile and standard contexts are accepted' }] };
  const proofs = proofArray(credential);
  if (!proofs.length) return { outcome: 'invalid', issues: [{ code: 'proof_missing', path: '/proof', message: 'A secured credential is required' }] };
  try {
    for (const proof of proofs) await verifyOne(credential, proof, documentLoader, presentationHeader);
    return { outcome: 'verified', issues: [], evidence: proofs.map(p => p.verificationMethod) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { outcome: message.startsWith('Unsupported') ? 'unsupported' : message.startsWith('No document available') ? 'indeterminate' : 'invalid', issues: [{ code: 'proof_failed', path: '/proof', message }] };
  }
}
export interface PresentationBinding { requestId: string; challenge: string; verifierDid: string; holderDid: string; expiresAt: string; }
export function presentationHeader(binding: PresentationBinding): Uint8Array {
  if (!binding.challenge || !binding.requestId || !binding.verifierDid.startsWith('did:') || !binding.holderDid.startsWith('did:') || !Number.isFinite(Date.parse(binding.expiresAt))) throw new Error('Invalid presentation binding');
  return new TextEncoder().encode(JSON.stringify([binding.requestId, binding.challenge, binding.verifierDid, binding.holderDid, binding.expiresAt]));
}
/** Cryptographic disclosure primitive. Callers must separately authorise every optional pointer. */
export async function deriveSealPresentation({ credential, documentLoader, selectivePointers = [], binding }: { credential: Seal; documentLoader: DocumentLoader; selectivePointers?: string[]; binding: PresentationBinding }): Promise<Credential> {
  const checked = await verifyCredentialProof({ credential, documentLoader });
  if (checked.outcome !== 'verified') throw new Error('Cannot derive from an unverified base credential');
  const bbs = proofArray(credential).find(p => p.type === 'DataIntegrityProof' && p.cryptosuite === 'bbs-2023');
  if (!bbs) throw new Error('Credential has no BBS base proof');
  const derived = await jsigs.derive({ ...structuredClone(credential), proof: bbs }, {
    suite: new DataIntegrityProof({ cryptosuite: createDiscloseCryptosuite({ selectivePointers, presentationHeader: presentationHeader(binding) }) }),
    purpose: await issuerPurpose(credential, bbs, documentLoader), documentLoader,
  });
  // RDF omits null; restore the profile's explicit original-record marker.
  if (credential.correctionOf === null) derived.correctionOf = null;
  return derived;
}
export async function verifySealPresentation({ credential, documentLoader, binding, evaluationTime = new Date().toISOString() }: { credential: Credential; documentLoader: DocumentLoader; binding: PresentationBinding; evaluationTime?: string }): Promise<Check> {
  if (!Number.isFinite(Date.parse(evaluationTime)) || !Number.isFinite(Date.parse(binding.expiresAt)) || Date.parse(binding.expiresAt) <= Date.parse(evaluationTime)) return { outcome: 'invalid', issues: [{ code: 'presentation_expired', path: '', message: 'Presentation request has expired' }] };
  const structure = validateSealPresentationStructure(credential);
  if (!structure.valid) return { outcome: 'invalid', issues: structure.errors };
  const missing = ALWAYS_DISCLOSED.filter(pointer => {
    let value: unknown = credential;
    for (const part of pointer.slice(1).split('/')) value = value && typeof value === 'object' ? (value as JsonObject)[part] : undefined;
    return value === undefined;
  });
  if (missing.length) return { outcome: 'invalid', issues: missing.map(path => ({ code: 'required_disclosure', path, message: 'Required presentation field is absent' })) };
  return verifyCredentialProof({ credential, documentLoader, presentationHeader: presentationHeader(binding) });
}
