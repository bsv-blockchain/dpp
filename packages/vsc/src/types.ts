export type JsonObject = { [key: string]: unknown };
export type DocumentLoader = (url: string) => Promise<{ document: JsonObject; documentUrl?: string; contextUrl?: string | null }>;
export interface Issue { code: string; path: string; message: string }
export type CheckOutcome = 'verified' | 'invalid' | 'indeterminate' | 'unsupported' | 'not-required';
export interface Check { outcome: CheckOutcome; issues: Issue[]; evidence?: string[] }
export interface Proof extends JsonObject {
  type: string; verificationMethod: string; proofPurpose: string; proofValue: string;
  created?: string; cryptosuite?: string;
}
export interface Credential extends JsonObject {
  '@context': string[]; type: string[]; id: string; issuer: string;
  validFrom: string; validUntil?: string; credentialSubject: JsonObject;
  credentialStatus?: StatusEntry; proof?: Proof | Proof[];
}
export interface StatusEntry extends JsonObject {
  id: string; type: 'BitstringStatusListEntry'; statusPurpose: 'revocation' | 'suspension';
  statusListIndex: string; statusListCredential: string;
}
export interface ProductIdentifier extends JsonObject {
  scheme: string; value: string; schemeAuthority: string; serialNumber?: string;
}
export type Topology = 'linear' | 'fork' | 'merge' | 'transform' | 'correction';
export interface Seal extends Credential {
  sealVersion: '1.0'; issuanceDate: string; sealTimestamp: string; correctionOf: string | null;
  credentialStatus: StatusEntry;
  eventVector: {
    what: { productIdentifiers: ProductIdentifier[]; quantity?: number; quantityUnit?: string; [key: string]: unknown };
    when: { eventTime: string; recordedAt: string; timezone: string; timePrecision: 'millisecond' | 'second' | 'minute' };
    where: { jurisdiction: string; [key: string]: unknown };
    who: { actorDid: string; actorRole: string; assertionMethod: string; [key: string]: unknown };
    how: { eventType: string; eventTypeVocab: string; businessStep: string; disposition: string; action: 'ADD' | 'OBSERVE' | 'DELETE' };
  };
  extensions: { '+Dn': Record<string, JsonObject> };
  chainOfCustody: { chainId: string; sequenceNumber: number; parentSeals: string[]; childSeals?: string[]; topology: Topology; topologyNote?: string };
}
export interface StatusPolicy {
  id: string;
  resolve: (url: string) => Promise<Credential>;
  /** Maximum age of the signed list's validFrom, not of an unauthenticated HTTP response. */
  maxAgeMs: number;
  /** Explicit policy grants for third-party list issuers, indexed by credential issuer DID. */
  delegatedListIssuers?: Readonly<Record<string, readonly string[]>>;
}
export type AuthorityPolicy = { id: string; required: false; reason: string } | {
  id: string; required: true; trustAnchors: readonly string[];
  /** Returns signed VscEventAuthorisation credentials. This function does not decide validity. */
  resolve: (issuer: string) => Promise<Credential[]>;
};
export interface VerificationOptions {
  credential: Seal; documentLoader: DocumentLoader; evaluationTime?: string;
  statusPolicy?: StatusPolicy; authorityPolicy?: AuthorityPolicy;
  resolveSeal?: (id: string) => Promise<Seal | undefined>;
  /** The caller supplies the complete discovered candidate set for the stated evidence scope. */
  corrections?: Seal[];
  correctionPolicy?: { id: string; resolve: (originalIssuer: string, delegate: string) => Promise<Credential[]> };
  limits?: { maxDepth?: number; maxNodes?: number; maxParents?: number; timeoutMs?: number };
}
export interface VerificationResult {
  profileId: string; upstreamRevision: string; evaluatedAt: string;
  outcome: 'verified' | 'invalid' | 'indeterminate' | 'unsupported';
  checks: { structure: Check; proof: Check; temporal: Check; status: Check; authority: Check; chain: Check; corrections: Check };
  issues: Issue[];
  /** Verification is scoped to supplied/discovered evidence, and does not establish global freshness. */
  evidenceScope: 'provided-evidence';
}
