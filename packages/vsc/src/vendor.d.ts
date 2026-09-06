declare module 'jsonld-signatures' { const value: any; export default value; }
declare module '@digitalbazaar/ed25519-signature-2020' { export const Ed25519Signature2020: any; export const suiteContext: any; }
declare module '@digitalbazaar/ed25519-verification-key-2020' { export const Ed25519VerificationKey2020: any; }
declare module '@digitalbazaar/data-integrity' { export const DataIntegrityProof: any; }
declare module '@digitalbazaar/bbs-2023-cryptosuite' {
 export const createSignCryptosuite: any; export const createDiscloseCryptosuite: any; export const createVerifyCryptosuite: any;
}
declare module '@digitalbazaar/bls12-381-multikey' { export const generateBbsKeyPair: any; export const ALGORITHMS: any; }
declare module '@digitalbazaar/credentials-context' { export const contexts: Map<string, any>; }
declare module '@digitalbazaar/data-integrity-context' { export const contexts: Map<string, any>; }
declare module '@digitalbazaar/multikey-context' { export const contexts: Map<string, any>; }
declare module 'did-context' { export const contexts: Map<string, any>; }
declare module '@digitalbazaar/ecdsa-rdfc-2019-cryptosuite' { export const cryptosuite: any; }
declare module '@digitalbazaar/ecdsa-multikey' {
  export const generate: any; export const from: any; export const fromJwk: any; export const fromRaw: any; export const toJwk: any;
}
