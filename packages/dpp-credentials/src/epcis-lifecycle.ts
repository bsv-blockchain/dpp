/**
 * `@bsv/dpp-credentials/epcis-lifecycle`: the EPCIS lifecycle claim,
 * `dpp-epcis-lifecycle@1` (`spec/epcis-lifecycle-claim.md` of the standard).
 *
 * One EPCIS 2.0.1 event in a signed envelope that binds it to its passports.
 * The claim lives here, beside the EPCIS source and exchange code, so that
 * `@bsv/dpp-protocol` holds no EPCIS and no GS1 code. It reaches a passport
 * verifier through the protocol's slot for external credential verifiers:
 * `epcisLifecycleCredentialVerifierFor` returns one.
 *
 * This is the one entry point of the package that needs `@bsv/dpp-protocol`
 * and `@bsv/sdk`: the generic anchor, the key derivation and the signature
 * types are the protocol's, used and never copied. The other entry points
 * import neither.
 *
 * - epcis-lifecycle/claim.ts   build, sign, strict parse, verify, anchor
 * - epcis-lifecycle/jcs.ts     RFC 8785 bytes and their strict reading
 * - epcis-lifecycle/shared.ts  GS1 identifier conversion and the strict JSON
 *                              parser, internal and not exported
 */
export * from './epcis-lifecycle/claim.js'
export * from './epcis-lifecycle/jcs.js'
