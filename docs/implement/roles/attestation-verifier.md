# Attestation verifier

An attestation verifier checks a signed claim about a product and, when it is given one, the claim's anchor: the small on-chain output that commits to the claim's exact bytes. This page is for anyone building one in their own code; with the packages, `verifyLifecycleClaim` and `verifyPassportEvidence` from `@bsv/dpp-core` do it, as [gather a passport's evidence](../../packages/dpp-core.md#gather-a-passports-evidence) shows.

A verifier needs:

- the claim's secured bytes exactly as received, and the representation they are in;
- the passport identifier the caller expects;
- for the anchor checks, the anchor's locking script;
- for authority, status and inclusion, the policy and evidence each needs. Without them those checks read `unknown`.

A claim and its anchor establish that a key signed the bytes and that an anchoring service committed to them. They do not establish that the issuer had authority or that the claimed event happened.

## See the reference answer

At the root of a checkout, after [setup](../../quick-start.md#get-the-code):

```sh
node examples/verify-attestation-anchor.mjs
```

It checks one valid claim and its anchor and prints:

```
Holds: the anchoring service signature, key derivation and ten-field layout verify.
Holds: the complete secured representation includes the native claim signature.
Holds: the native claim signature verifies under its did:key issuer.
Holds: the anchor commits to those complete secured bytes.
Holds: the carried issuer, subject and event type match the signed claim.
Holds: the representation and media type select the native lifecycle verifier.
This example does not evaluate business authority, physical product binding, credential status, VSC conformance or transaction inclusion.
```

It refuses nothing; the refusal cases are in [the cases to run](#the-cases-to-run). For the historical `uora-anchor-v3` format, [`examples/verify-anchor.mjs`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/examples/verify-anchor.mjs) checks `fixtures/anchor-v3.json` from the output's own bytes: run `node examples/verify-anchor.mjs`, and it prints a `Holds:` line for each check and for each of its eight refusals, then `Every check holds.`

## Build the verifier

1. **Keep the bytes** ([rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md) section 4). Store the received bytes before decoding, and refuse duplicate JSON keys.
2. **Dispatch on the representation.** A native claim is `dpp-lifecycle-json-v1` (rules section 3); a SEAL credential, the event credential of the Verifiable Supply Chain (VSC) profile, is `vsc-seal-json-v1`; an external W3C credential is `vc-di-ecdsa-rdfc-2019@1` ([external credentials](../../interoperability/external-credentials.md)); a record written before the native format is `legacy-uora-json` ([legacy UORA anchors](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/legacy-uora-anchor-v3.md) sections 3 to 5). They use different proof rules. A representation you do not implement reads `unknown` with `representation-unsupported`, never a pass.
3. **Verify a native claim** (rules section 3). Accept exactly the allowed properties. Serialise every property except `signature` as restricted canonical JSON, hash it with SHA-256, and verify the DER signature under the BRC-42 child of the issuer's key for protocol `[1, 'dpp attestation v1']`, key identifier `passportId`, counterparty `anyone`. A `did:key` issuer names the key itself; otherwise `issuerKeyDid` names the key that signed, and its relationship to the issuer needs separate evidence.
4. **Decode the anchor** (rules section 5). The script is exactly a 33-byte key, `OP_CHECKSIG`, ten fields and five `OP_2DROP`, with nothing after. Field 1 is `bsv-attestation-anchor-v1`, fields 1 to 9 are printable UTF-8 within their bounds, and field 10 is the service's DER signature over the SHA-256 of fields 1 to 9, each prefixed with its length as a Bitcoin VarInt. Verify it under the BRC-42 child of field 9 (`anchoredBy`) for protocol `[1, 'bsv attestation anchor v1']`, key identifier field 3 (`attestationId`), counterparty `anyone`. The locking key must equal that same child.
5. **Bind the anchor to the claim** (rules section 6). Field 2 must equal the SHA-256 of the complete secured bytes, which for a native claim is the restricted canonical JSON including `signature`. The issuer, subject, type, representation and media type the anchor carries must equal the verified claim's.
6. **Compare the subject** ([verification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md) section 3) with the identifier your caller expects.
7. **Report each check separately** (verification section 4): `nativeAttestationSignature`, `anchorSignature`, `anchorKeyDerivation`, `anchorDigestAndMetadataBinding`, `subjectBinding`, `issuerAuthority` and `evidenceAvailability`, among the sixteen. A valid claim without an anchor is not a completed anchor check; a valid anchor without the claim cannot establish what the claim says.

Present the [individual findings](../../learn/evidence-and-freshness.md), including unknown authority or inclusion. An application can apply its policy to them without hiding them.

## The cases to run

| File | Case | Your verifier must |
|---|---|---|
| `fixtures/attestation-anchor-v1.json` | The whole file | Reproduce `canonicalUnsignedClaim`, verify `claim.signature`, get `digest` from `representationBytes`, decode `lockingScript` to the nine `fields`, verify `signature` over `signingPreimage`, and derive `lockingKey` |
| `fixtures/vectors/dpp/attestation-anchor/v1.json` | `signed-claim-to-anchor`, `script-to-metadata` | Follow the positive path from the unsigned claim and test keys to the script, and back |
| The same file | `refuse-metadata-tampering` | Refuse: a signed issuer byte changed without signing again |
| The same file | `refuse-boundary-shift` | Refuse: the subject and type boundary moved, with the same concatenated bytes and signature |
| The same file | `refuse-short-tail` | Refuse: one of the five `OP_2DROP` removed |
| The same file | `refuse-trailing-code` | Refuse: code after the drop tail |
| The same file | `refuse-uncompressed-key` | Refuse: the locking key pushed as 65 bytes |
| The same file | `refuse-invalid-utf8` | Refuse: the subject as invalid UTF-8 |
| `fixtures/evidence-v1.json` | `anchor-and-claim`, `anchor-and-claim-authorised` | Pass every claim and anchor check; `issuerAuthority` reads `unknown` `policy-missing` without a policy and `pass` with one |
| The same file | `anchor-tampered-bytes` | Report `anchorDigestAndMetadataBinding` `fail` `digest-mismatch` |
| The same file | `anchor-metadata-mismatch` | Report `anchorDigestAndMetadataBinding` `fail` `metadata-mismatch` and `subjectBinding` `fail` `subject-mismatch` |
| The same file | `anchor-unsupported-representation` | Report `anchorDigestAndMetadataBinding` `unknown` `representation-unsupported` |
| The same file | `anchor-bytes-absent` | Report `anchorDigestAndMetadataBinding` `unknown` `secured-bytes-absent` and `evidenceAvailability` `unknown` `referenced-artefact-unavailable` |
| `fixtures/anchor-v3.json` | `boundaryShifted`, `uncompressedKey`, `malformedTail` | Historical and read-only: verify the anchor and refuse every script listed; never write this format |

No fixture case alters the native claim's own signature; add one to your own tests. [Run the fixtures](../fixture-runner.md#what-a-matching-report-is) says which parts of a report must match. Add [external credentials](../../interoperability/external-credentials.md) only for the representations you support.

## What not to copy from the fixtures

- The fixture claim's `recordId` `state-1` and `profile` `generic` are test values, not live forms ([fields for a live claim](attestation-issuer.md#fields-for-a-live-claim)).

## Run an anchor proof page

A proof page checks a registry's claims without trusting the registry: the registry hands over each record's stored bytes and names its anchor transaction, and everything else comes from the chain. The hosted reference serves one over the hosted registry ([the hosted reference](../../deployment.md#the-hosted-reference)). One command does the same, and its source, `examples/check-registry.mjs`, is the recipe to copy:

```sh
node examples/check-registry.mjs --fixture
node examples/check-registry.mjs https://dpp-resolver.bsvb.net
```

The first runs offline on the repository's test data and ends `Every sentence above holds.` The second checks a live registry's first 10 records. Add `--subject=<passportId>` for one passport, `--limit=<n>` for more records and `--anchoring-services=<key>,<key>` to name the anchoring services you accept, and set `WOC_API_KEY` to raise WhatsOnChain's rate limit. For each record it prints one line per check, each `pass`, `fail`, `unknown` or `not-applicable`, and no overall verdict (verification section 4). It exits 1 when any check fails.

| Check | What it does | Where the evidence comes from |
|---|---|---|
| `digest` | Hashes the stored bytes with SHA-256 and compares the result with the registry's `digest` | `GET /attestations/{id}/proof`: `securedBytes`, or `canonical` on a `legacy-uora-json` record |
| `claim signature` | Verifies a native claim with `verifyLifecycleClaim` from `@bsv/dpp-core` | The stored bytes |
| `anchor` | Decodes the output under the format its first field names, and verifies its signature and locking key | The transaction from WhatsOnChain (`/tx/<txid>/hex`), by the proof's `anchor.recordId` and `anchor.outputIndex`; a script the registry also sends must equal it |
| `binding` | The anchor commits to the digest and names the claim's identifier, issuer, subject and type | The decoded anchor and the claim |
| `inclusion` | Verifies the transaction's merkle path against block headers | WhatsOnChain's `/tx/<txid>/proof/tsc`, which the example's `merklePathFromTsc` turns into an `@bsv/sdk` `MerklePath`, and its headers |
| `anchoring service` | Compares the key that wrote the anchor with the services you accept | The decoded anchor and your `--anchoring-services` |

What each kind of record can establish:

| Record | Anchor | What can be established |
|---|---|---|
| `dpp-lifecycle-json-v1`, a native claim | `bsv-attestation-anchor-v1`, read with `inspectAttestationAnchor` from `@bsv/dpp-core` | Every check |
| `legacy-uora-json` | `uora-anchor-v3`, read with `tryParseUoraAnchor` from `@bsv/dpp-overlay-topics` | Every check but the claim signature, which the example does not check |
| `legacy-uora-json` | `uora-anchor-v1` | The digest, inclusion, and that the output is signed by its own locking key. A v1 anchor names no issuer and no anchoring service, so who anchored it cannot be established |
| `vsc-seal-json-v1`, a SEAL credential | `bsv-attestation-anchor-v1` | The digest, anchor and inclusion; verify the credential itself with [`@bsv/vsc`](../../packages/vsc.md) |

## Known gaps

These are open questions in the standard; [known limitations](../../operate/limitations.md) lists the reference service's limits.

- **Finding the claim behind an anchor.** An anchor names the claim's digest, identifier, issuer, subject and anchoring service key, but not the registry that holds the claim, and a passport names no registry either. Learn the registry out of band, for example from the passport's application. Given the anchor alone, the report reads as case `anchor-bytes-absent` does: `anchorSignature` and `anchorKeyDerivation` pass; `anchorDigestAndMetadataBinding` is `unknown` with `secured-bytes-absent`; `nativeAttestationSignature`, `schema`, `credentialTime` and `credentialStatus` are `unknown` with `no-evidence`; and `evidenceAvailability` is `unknown` with `referenced-artefact-unavailable`.
- **Issuer identity.** Live identity assurance is Ring 0, where the platform vouches only for the account and brand label ([identity and authority](../../learn/identity-and-authority.md)). A `did:key` names a key, not a legal entity, and `issuerAuthority` passes only against a policy that names the issuers you trust.

## Exact implementation sources

- [spec/rules.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md)
- [spec/identity.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/identity.md)
- [spec/verification.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md)
- [spec/legacy-uora-anchor-v3.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/legacy-uora-anchor-v3.md), for the historical anchor
- [fixtures/attestation-anchor-v1.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/attestation-anchor-v1.json) and its [vector form](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/vectors/dpp/attestation-anchor/v1.json)

Record results as [evidence reporting](../reporting.md) describes; the [source gaps](../fixture-runner.md#source-gaps) remain open. Next: the [registry](registry.md), which stores claims and serves the bytes a verifier needs.
