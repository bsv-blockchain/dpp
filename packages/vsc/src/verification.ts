import { gunzipSync } from 'node:zlib';
import { PROFILE_ID, UPSTREAM_REVISION } from './context.js';
import { verifyCredentialProof } from './crypto.js';
import { validateSealStructure } from './validation.js';
import type { Check, Credential, Issue, Seal, VerificationOptions, VerificationResult } from './types.js';
const good = (evidence?: string[]): Check => ({ outcome: 'verified', issues: [], evidence });
const fail = (code: string, message: string, outcome: Check['outcome'] = 'invalid', path = ''): Check => ({ outcome, issues: [{ code, path, message }] });
const outcomeOf = (checks: Check[]): VerificationResult['outcome'] => checks.some(c => c.outcome === 'invalid') ? 'invalid' : checks.some(c => c.outcome === 'unsupported') ? 'unsupported' : checks.some(c => c.outcome === 'indeterminate') ? 'indeterminate' : 'verified';

export function verifyTemporal(credential: Credential, evaluationTime: string): Check {
  const now = Date.parse(evaluationTime), start = Date.parse(credential.validFrom);
  if (!Number.isFinite(now) || !Number.isFinite(start)) return fail('invalid_time', 'A valid evaluation time and credential validFrom are required');
  if (start > now) return fail('not_yet_valid', 'Credential is not valid at the evaluation time');
  if (credential.validUntil !== undefined && (!Number.isFinite(Date.parse(credential.validUntil)) || Date.parse(credential.validUntil) <= now || Date.parse(credential.validUntil) <= start)) return fail('expired', 'Credential validity interval excludes the evaluation time');
  return good();
}
export async function verifyCredentialStatus(credential: Credential, options: Pick<VerificationOptions, 'documentLoader' | 'statusPolicy'> & { evaluationTime: string }): Promise<Check> {
  const { statusPolicy: policy, documentLoader, evaluationTime } = options;
  if (!policy) return fail('status_policy_missing', 'No authenticated status evidence policy is configured', 'indeterminate');
  if (!policy.id || !Number.isFinite(policy.maxAgeMs) || policy.maxAgeMs <= 0 || policy.maxAgeMs > 7 * 24 * 60 * 60 * 1000) return fail('status_policy_invalid', 'Status freshness must be explicitly bounded to no more than seven days');
  const entry = credential.credentialStatus;
  if (!entry || entry.type !== 'BitstringStatusListEntry' || !['revocation','suspension'].includes(entry.statusPurpose) || typeof entry.statusListIndex !== 'string' || !/^(0|[1-9][0-9]*)$/.test(entry.statusListIndex)) return fail('status_entry_invalid', 'A supported status entry with a canonical decimal index is required');
  const index = Number(entry.statusListIndex);
  if (!Number.isSafeInteger(index)) return fail('status_index_invalid', 'Status index is out of range');
  let list: Credential;
  try { list = await policy.resolve(entry.statusListCredential); } catch { return fail('status_unavailable', 'Status evidence could not be retrieved', 'indeterminate'); }
  if (!list || typeof list !== 'object' || list.id !== entry.statusListCredential || !Array.isArray(list.type) || !list.type.includes('BitstringStatusListCredential')) return fail('status_identity', 'Status list identifier or credential type does not match');
  const authorised = list.issuer === credential.issuer || policy.delegatedListIssuers?.[credential.issuer]?.includes(list.issuer);
  if (!authorised) return fail('status_issuer', 'The credential issuer has not been granted this status-list issuer by verifier policy');
  const proof = await verifyCredentialProof({ credential: list, documentLoader });
  if (proof.outcome !== 'verified') return { ...proof, issues: proof.issues.map(i => ({ ...i, code: 'status_proof' })) };
  const temporal = verifyTemporal(list, evaluationTime);
  if (temporal.outcome !== 'verified') return temporal;
  if (Date.parse(evaluationTime) - Date.parse(list.validFrom) > policy.maxAgeMs) return fail('status_stale', 'Signed status evidence exceeds the configured freshness interval', 'indeterminate');
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
export async function verifyIssuerAuthority(seal: Seal, options: VerificationOptions & { evaluationTime: string }): Promise<Check> {
  const policy = options.authorityPolicy;
  if (!policy) return fail('authority_policy_missing', 'Issuer authority has not been independently confirmed', 'indeterminate');
  if (!policy.required) return { outcome: 'not-required', issues: [{ code: 'authority_not_required', path: '', message: policy.reason }], evidence: [policy.id] };
  let credentials: Credential[];
  try { credentials = await policy.resolve(seal.issuer); } catch { return fail('authority_unavailable', 'Authorisation evidence is unavailable', 'indeterminate'); }
  if (!Array.isArray(credentials) || credentials.length > 256) return fail('authority_evidence_limit', 'Authorisation evidence is malformed or exceeds the profile limit', 'indeterminate');
  const failures: Issue[] = [];
  for (const credential of credentials) {
    if (!credential || typeof credential !== 'object' || !policy.trustAnchors.includes(credential.issuer) || !credential.type?.includes('VscEventAuthorisation') || credential.credentialSubject?.id !== seal.issuer) continue;
    const proof = await verifyCredentialProof({ credential, documentLoader: options.documentLoader });
    const temporal = verifyTemporal(credential, options.evaluationTime);
    const status = await verifyCredentialStatus(credential, options);
    if ([proof, temporal, status].some(c => c.outcome !== 'verified')) { failures.push(...proof.issues, ...temporal.issues, ...status.issues); continue; }
    const subject = credential.credentialSubject;
    const events = subject.permittedEventTypes, schemes = subject.permittedProductSchemes, jurisdictions = subject.permittedJurisdictions;
    if (!Array.isArray(events) || !events.includes(seal.eventVector.how.eventType)) continue;
    if (schemes !== undefined && (!Array.isArray(schemes) || !seal.eventVector.what.productIdentifiers.every(p => schemes.includes(p.scheme)))) continue;
    if (jurisdictions !== undefined && (!Array.isArray(jurisdictions) || !jurisdictions.includes(seal.eventVector.where.jurisdiction))) continue;
    return good([policy.id, credential.id]);
  }
  return { outcome: failures.some(i => ['status_unavailable','status_stale','status_policy_missing'].includes(i.code)) ? 'indeterminate' : 'invalid', issues: [{ code: 'issuer_unauthorised', path: '/issuer', message: 'No valid scoped authorisation from a configured trust anchor' }, ...failures] };
}
const states: Record<string, string> = { active: 'Q1', in_transit: 'Q2', stored: 'Q2', transshipped: 'Q2', returned: 'Q2', transformed: 'Q2', received: 'Q3', dispensed: 'Q4', destroyed: 'Q4' };
const transitions: Record<string, string[]> = { Q1: ['Q2'], Q2: ['Q2','Q3'], Q3: ['Q2','Q4'], Q4: [] };
function extensionHas(seal: Seal, field: string): boolean { return Object.values(seal.extensions['+Dn']).some(value => typeof value[field] === 'string' && (value[field] as string).trim().length > 0); }
function stateCheck(seal: Seal, parents: Seal[]): Check {
  const chain = seal.chainOfCustody, state = states[seal.eventVector.how.disposition];
  if (seal.correctionOf !== null) {
    const original = parents.find(p => p.id === seal.correctionOf);
    if (!original || chain.chainId === original.chainOfCustody.chainId || !extensionHas(seal, 'correctionReason')) return fail('correction_structure', 'Corrections require a separate chain and a reason');
    if (chain.sequenceNumber !== 1) return fail('correction_sequence', 'This profile starts each correction chain at sequence 1');
    return good();
  }
  if (!parents.length) return state === 'Q1' && chain.sequenceNumber === 1 ? good() : fail('origin_required', 'A custody chain must begin in Q1 with sequence 1');
  if (chain.sequenceNumber !== Math.max(...parents.map(p => p.chainOfCustody.sequenceNumber)) + 1) return fail('sequence', 'Sequence must be one greater than the maximum parent sequence');
  if (parents.some(p => !transitions[states[p.eventVector.how.disposition]]?.includes(state))) return fail('state_transition', 'Custody transition is prohibited');
  if (parents.some(p => states[p.eventVector.how.disposition] === 'Q3') && state === 'Q2' && !extensionHas(seal, 'returnReason')) return fail('return_reason', 'A return requires its justification');
  if (['fork','merge','transform'].includes(chain.topology) && state !== 'Q2') return fail('topology_state', 'Fork and merge operations belong to the transit state');
  if (chain.topology === 'linear' && parents.some(p => p.chainOfCustody.chainId !== chain.chainId)) return fail('chain_identity', 'A linear custody chain must retain its chain identifier');
  if (parents.some(p => p.chainOfCustody.topology === 'fork' && !p.chainOfCustody.childSeals?.includes(seal.id))) return fail('fork_child', 'A fork parent must predeclare this child identifier');
  if (chain.topology === 'linear' && parents.some(p => JSON.stringify(p.eventVector.what.productIdentifiers.map(v => JSON.stringify([v.scheme, v.schemeAuthority, v.value, v.serialNumber ?? null])).sort()) !== JSON.stringify(seal.eventVector.what.productIdentifiers.map(v => JSON.stringify([v.scheme, v.schemeAuthority, v.value, v.serialNumber ?? null])).sort()))) return fail('subject_continuity', 'A linear custody step must preserve the identified products');
  return good();
}

export async function verifySeal(options: VerificationOptions): Promise<VerificationResult> {
  const evaluationTime = options.evaluationTime ?? new Date().toISOString();
  const policyOptions = { ...options, evaluationTime };
  const validation = validateSealStructure(options.credential);
  for (const [name, value] of Object.entries(options.limits ?? {})) {
    if (!Number.isSafeInteger(value) || value < 0 || (name !== 'maxDepth' && value === 0)) { validation.valid = false; validation.errors.push({ code: 'invalid_limit', path: `/limits/${name}`, message: 'Resource limits must be finite non-negative integers, and only depth may be zero' }); }
  }
  const structure: Check = validation.valid ? good() : { outcome: 'invalid', issues: validation.errors };
  const pending = fail('not_evaluated', 'Earlier validation did not permit this check', 'indeterminate');
  const checks = { structure, proof: pending, temporal: pending, status: pending, authority: pending, chain: pending, corrections: pending };
  if (validation.valid) {
    const seal = options.credential;
    checks.proof = await verifyCredentialProof({ credential: seal, documentLoader: options.documentLoader });
    checks.temporal = verifyTemporal(seal, evaluationTime);
    checks.status = await verifyCredentialStatus(seal, policyOptions);
    checks.authority = await verifyIssuerAuthority(seal, policyOptions);
    const maxDepth = options.limits?.maxDepth ?? 64, maxNodes = options.limits?.maxNodes ?? 1024, maxParents = options.limits?.maxParents ?? 256;
    const deadline = Date.now() + (options.limits?.timeoutMs ?? 30_000);
    const completed = new Map<string, Seal>(), visited = new Set<string>(), evidence: string[] = [];
    let graphError: Check | undefined;
    const fetchNode = async (id: string): Promise<Seal | undefined> => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('deadline');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([options.resolveSeal?.(id), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('deadline')), remaining); })]); }
      finally { if (timer) clearTimeout(timer); }
    };
    const visit = async (node: Seal, depth: number, path: Set<string>): Promise<void> => {
      if (graphError) return;
      if (path.has(node.id)) { graphError = fail('cycle', 'A parent reference forms a cycle'); return; }
      if (completed.has(node.id)) return;
      if (depth > maxDepth || visited.size >= maxNodes || node.chainOfCustody.parentSeals.length > maxParents || Date.now() > deadline) { graphError = fail('resource_limit', 'Graph evaluation exceeded declared resource limits', 'indeterminate'); return; }
      visited.add(node.id);
      if (node.id !== seal.id) {
        const structure = validateSealStructure(node);
        if (!structure.valid) { graphError = { outcome: 'invalid', issues: structure.errors }; return; }
        for (const check of [await verifyCredentialProof({ credential: node, documentLoader: options.documentLoader }), verifyTemporal(node, evaluationTime), await verifyCredentialStatus(node, policyOptions), await verifyIssuerAuthority(node, { ...policyOptions, credential: node })]) {
          if (!['verified','not-required'].includes(check.outcome)) { graphError = check; return; }
        }
      }
      const nextPath = new Set(path).add(node.id), parents: Seal[] = [];
      for (const id of node.chainOfCustody.parentSeals) {
        let parent: Seal | undefined;
        try { parent = completed.get(id) ?? await fetchNode(id); } catch { graphError = fail('predecessor_unavailable', 'Predecessor resolution failed or timed out', 'indeterminate'); return; }
        if (!parent) { graphError = fail('predecessor_missing', 'A referenced predecessor is unavailable', 'indeterminate'); return; }
        if (parent.id !== id) { graphError = fail('predecessor_identity', 'Resolved predecessor has a different identifier'); return; }
        await visit(parent, depth + 1, nextPath); if (graphError) return;
        parents.push(parent);
      }
      completed.set(node.id, node); evidence.push(node.id);
    };
    await visit(seal, 0, new Set());
    const supplied = [...(options.corrections ?? []), ...(seal.correctionOf ? [seal] : [])];
    const candidates = new Map<string, Seal>();
    for (const candidate of supplied) {
      const previous = candidates.get(candidate.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(candidate)) { graphError = fail('credential_collision', 'Different correction credentials use the same identifier'); break; }
      candidates.set(candidate.id, candidate);
    }
    const correctionTargets = new Map<string, Seal[]>(), checkedCorrections = new Set<string>();
    let correctionError: Check | undefined;
    const checkCorrection = async (correction: Seal, path: Set<string>): Promise<void> => {
      if (checkedCorrections.has(correction.id) || correctionError) return;
      if (path.has(correction.id)) { correctionError = fail('correction_cycle', 'Correction references contain a cycle'); return; }
      if (path.size > maxDepth || checkedCorrections.size >= maxNodes) { correctionError = fail('resource_limit', 'Correction traversal exceeds profile limits', 'indeterminate'); return; }
      const structure = validateSealStructure(correction);
      if (!structure.valid || !correction.correctionOf) { correctionError = fail('correction_structure', 'A supplied correction is structurally invalid'); return; }
      let target = candidates.get(correction.correctionOf) ?? completed.get(correction.correctionOf);
      if (!target) { try { target = await fetchNode(correction.correctionOf); } catch { /* Report missing evidence below. */ } }
      if (!target || target.id !== correction.correctionOf) { correctionError = fail('correction_target_missing', 'Correction target could not be resolved', 'indeterminate'); return; }
      if (target.correctionOf) await checkCorrection(target, new Set(path).add(correction.id));
      else if (!completed.has(target.id)) { await visit(target, 0, new Set()); if (graphError) correctionError = graphError; }
      if (correctionError) return;
      for (const check of [await verifyCredentialProof({ credential: correction, documentLoader: options.documentLoader }), verifyTemporal(correction, evaluationTime), await verifyCredentialStatus(correction, policyOptions), await verifyIssuerAuthority(correction, { ...policyOptions, credential: correction }), stateCheck(correction, [target])]) {
        if (!['verified','not-required'].includes(check.outcome)) { correctionError = check; return; }
      }
      if (target.issuer !== correction.issuer) {
        const policy = options.correctionPolicy;
        if (!policy) { correctionError = fail('correction_authority_missing', 'Cross-issuer correction requires signed delegated authority', 'indeterminate'); return; }
        let grants: Credential[];
        try { grants = await policy.resolve(target.issuer, correction.issuer); } catch { correctionError = fail('correction_authority_unavailable', 'Delegated correction authority is unavailable', 'indeterminate'); return; }
        if (!Array.isArray(grants) || grants.length > 256) { correctionError = fail('correction_evidence_limit', 'Delegation evidence exceeds the profile limit', 'indeterminate'); return; }
        let authorised = false;
        for (const grant of grants) {
          if (!grant || typeof grant !== 'object') continue;
          const subject = grant.credentialSubject;
          if (grant.issuer !== target.issuer || !grant.type?.includes('VscCorrectionAuthorisation') || subject?.id !== correction.issuer || subject.originalIssuer !== target.issuer || !Array.isArray(subject.permittedRecordIds) || !subject.permittedRecordIds.includes(target.id) || !Array.isArray(subject.permittedActions) || !subject.permittedActions.includes('correct')) continue;
          const grantChecks = [await verifyCredentialProof({ credential: grant, documentLoader: options.documentLoader }), verifyTemporal(grant, evaluationTime), await verifyCredentialStatus(grant, policyOptions)];
          if (grantChecks.every(c => c.outcome === 'verified')) { authorised = true; break; }
        }
        if (!authorised) { correctionError = fail('correction_unauthorised', 'No valid scoped delegation authorises this correction'); return; }
      }
      checkedCorrections.add(correction.id);
      correctionTargets.set(correction.correctionOf, [...(correctionTargets.get(correction.correctionOf) ?? []), correction]);
    };
    for (const correction of candidates.values()) await checkCorrection(correction, new Set());
    if (!correctionError && [...correctionTargets.values()].some(values => new Set(values.map(c => c.id)).size > 1)) correctionError = fail('correction_conflict', 'Competing authorised correction branches require an explicit resolution', 'indeterminate');
    const effective = (node: Seal): Seal => {
      let corrected = node;
      const seen = new Set<string>();
      while (!seen.has(corrected.id) && correctionTargets.get(corrected.id)?.length === 1) {
        seen.add(corrected.id); corrected = correctionTargets.get(corrected.id)![0];
      }
      // This is an in-memory state projection, never a newly signed credential.
      return { ...node, eventVector: corrected.eventVector };
    };
    if (!graphError && !correctionError) {
      for (const node of completed.values()) {
        const parents = node.chainOfCustody.parentSeals.map(id => completed.get(id)!).filter(Boolean);
        const state = stateCheck(effective(node), parents.map(effective));
        if (state.outcome !== 'verified') { graphError = state; break; }
      }
    }
    checks.chain = graphError ?? (correctionError ? fail('chain_correction_unresolved', 'Effective custody state cannot be established until corrections resolve', 'indeterminate') : good(evidence));
    checks.corrections = correctionError ?? good([...checkedCorrections]);
  }
  return { profileId: PROFILE_ID, upstreamRevision: UPSTREAM_REVISION, evaluatedAt: evaluationTime, outcome: outcomeOf(Object.values(checks)), checks, issues: Object.values(checks).flatMap(c => c.issues), evidenceScope: 'provided-evidence' };
}
