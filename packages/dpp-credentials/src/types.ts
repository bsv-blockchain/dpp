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
export interface StatusPolicy {
  id: string;
  resolve: (url: string) => Promise<Credential>;
  /** Maximum age of the signed list's validFrom, not of an unauthenticated HTTP response. */
  maxAgeMs: number;
  /** Explicit policy grants for third-party list issuers, indexed by credential issuer DID. */
  delegatedListIssuers?: Readonly<Record<string, readonly string[]>>;
}
