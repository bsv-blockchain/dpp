import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { sealSchema } from './schema.js';
import { CONTEXT_URL } from './context.js';
import type { Issue, Seal } from './types.js';
const ajv = new Ajv({ allErrors: true, strict: false });
(addFormats as unknown as (a: Ajv) => void)(ajv);
const validateSecured = ajv.compile(sealSchema);
const validateUnsigned = ajv.compile({ ...sealSchema, $id: `${sealSchema.$id}:unsigned`, required: sealSchema.required.filter(key => key !== 'proof') });
export function validateSealStructure(value: unknown, { requireProof = true } = {}): { valid: boolean; errors: Issue[] } {
  const validate = requireProof ? validateSecured : validateUnsigned;
  if (!validate(value)) return { valid: false, errors: (validate.errors ?? []).map(e => ({ code: 'schema', path: e.instancePath, message: e.message ?? 'Invalid field' })) };
  const seal = value as Seal;
  const errors: Issue[] = [];
  const issue = (path: string, message: string) => errors.push({ code: 'structure', path, message });
  if (seal['@context'][0] !== 'https://www.w3.org/ns/credentials/v2' || !seal['@context'].includes(CONTEXT_URL)) issue('/@context', 'The owned profile context and VC2 context are required');
  if (requireProof && !seal.proof) issue('/proof', 'A secured credential is required');
  if (seal.issuer !== seal.eventVector.who.actorDid) issue('/eventVector/who/actorDid', 'Actor DID must equal issuer');
  if (seal.credentialSubject.id !== seal.id) issue('/credentialSubject/id', 'This profile identifies the attestation as the credential subject; product identifiers are separate');
  const { parentSeals, topology } = seal.chainOfCustody;
  const mirrored = seal.credentialSubject.predecessorCredentials;
  if (parentSeals.length && (!Array.isArray(mirrored) || JSON.stringify([...parentSeals].sort()) !== JSON.stringify([...mirrored].sort()))) issue('/credentialSubject/predecessorCredentials', 'Predecessor references must match the custody parents');
  if (parentSeals.includes(seal.id)) issue('/chainOfCustody/parentSeals', 'A credential cannot be its own parent');
  if (seal.correctionOf === null && topology === 'correction') issue('/correctionOf', 'Correction topology requires a target');
  if (seal.correctionOf !== null && (topology !== 'correction' || parentSeals.length !== 1 || parentSeals[0] !== seal.correctionOf)) issue('/correctionOf', 'This profile requires exactly the correction target as its parent');
  if (topology === 'linear' && parentSeals.length > 1) issue('/chainOfCustody/parentSeals', 'Linear records have at most one parent');
  if (['merge','transform'].includes(topology) && parentSeals.length < 2) issue('/chainOfCustody/parentSeals', 'Merge records require multiple parents');
  if (topology === 'fork' && (seal.chainOfCustody.childSeals?.length ?? 0) < 2) issue('/chainOfCustody/childSeals', 'Fork records preallocate at least two child identifiers');
  const how = seal.eventVector.how;
  const epcis = ['ObjectEvent','AggregationEvent','TransformationEvent','TransactionEvent','AssociationEvent'];
  if (how.eventTypeVocab === 'urn:epcis:cbv:v2' ? !epcis.includes(how.eventType) : !how.eventType.startsWith('urn:')) issue('/eventVector/how/eventType', 'Event type must belong to its declared vocabulary');
  const proofs = Array.isArray(seal.proof) ? seal.proof : seal.proof ? [seal.proof] : [];
  for (const proof of proofs) {
    if (proof.verificationMethod !== seal.eventVector.who.assertionMethod) issue('/proof/verificationMethod', 'Proof key must match the asserting key in the event');
    if (proof.type === 'Ed25519Signature2020' && !proof.created) issue('/proof/created', 'Ed25519Signature2020 proof requires its creation time');
    if (proof.type === 'DataIntegrityProof' && proof.cryptosuite !== 'bbs-2023') issue('/proof/cryptosuite', 'Only the declared BBS suite is supported');
  }
  return { valid: errors.length === 0, errors };
}

export const disclosureSchema: any = structuredClone(sealSchema);
disclosureSchema.$id += ':disclosure';
disclosureSchema.required = ['@context','type','id','issuer','validFrom','sealVersion','sealTimestamp','correctionOf','credentialSubject','credentialStatus','eventVector','chainOfCustody','proof'];
disclosureSchema.properties.eventVector.properties.when.required = ['eventTime','timezone'];
disclosureSchema.properties.eventVector.properties.how.required = ['eventType','eventTypeVocab','disposition'];
disclosureSchema.properties.chainOfCustody.required = ['chainId'];
const validateDisclosure = ajv.compile(disclosureSchema);
export function validateSealPresentationStructure(value: unknown): { valid: boolean; errors: Issue[] } {
  if (!validateDisclosure(value)) return { valid: false, errors: (validateDisclosure.errors ?? []).map(e => ({ code: 'presentation_schema', path: e.instancePath, message: e.message ?? 'Invalid disclosed field' })) };
  const credential = value as Seal;
  const errors: Issue[] = [];
  if (credential.issuer !== credential.eventVector.who.actorDid) errors.push({ code: 'issuer_binding', path: '/eventVector/who/actorDid', message: 'Disclosed actor must equal issuer' });
  if (credential.credentialSubject.id !== credential.id) errors.push({ code: 'subject_binding', path: '/credentialSubject/id', message: 'Disclosed subject must identify this attestation' });
  const proofs = Array.isArray(credential.proof) ? credential.proof : [credential.proof!];
  if (proofs.some(p => p.verificationMethod !== credential.eventVector.who.assertionMethod)) errors.push({ code: 'key_binding', path: '/proof/verificationMethod', message: 'Disclosed assertion key must match the proof' });
  return { valid: errors.length === 0, errors };
}

/** Parses exact input without replacing its bytes. Rejects duplicate keys before interpretation. */
export function parseStrictJsonBytes(bytes: Uint8Array): unknown {
  if (bytes.byteLength > 1_048_576) throw new Error('Credential exceeds the 1 MiB profile limit');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = JSON.parse(text);
  let index = 0;
  const whitespace = () => { while (/\s/.test(text[index] ?? '') && index < text.length) index++; };
  const string = (): string => { const start = index++; while (index < text.length) { if (text[index] === '\\') index += 2; else if (text[index++] === '"') return JSON.parse(text.slice(start, index)); } throw new Error('Unterminated string'); };
  const visit = (depth: number): void => {
    if (depth > 64) throw new Error('JSON nesting exceeds the profile limit');
    whitespace();
    if (text[index] === '{') {
      index++; whitespace(); const keys = new Set<string>();
      while (text[index] !== '}') { const key = string(); if (keys.has(key)) throw new Error(`Duplicate JSON key: ${key}`); keys.add(key); whitespace(); index++; visit(depth + 1); whitespace(); if (text[index] !== ',') break; index++; whitespace(); }
      index++;
    } else if (text[index] === '[') {
      index++; whitespace(); while (text[index] !== ']') { visit(depth + 1); whitespace(); if (text[index] !== ',') break; index++; } index++;
    } else if (text[index] === '"') string();
    else { while (index < text.length && !/[\s,\]}]/.test(text[index])) index++; }
  };
  visit(0);
  return value;
}
export function parseSealBytes(bytes: Uint8Array): Seal {
  const value = parseStrictJsonBytes(bytes);
  const result = validateSealStructure(value);
  if (!result.valid) throw new Error(result.errors.map(e => `${e.path}: ${e.message}`).join('; '));
  return value as Seal;
}
export function extractSealMetadata(seal: Seal) {
  return { id: seal.id, issuer: seal.issuer, type: 'VSC-SEAL' as const, subjects: [...new Set(seal.eventVector.what.productIdentifiers.map(p => p.value))] };
}
