# Attestation verifier

An attestation verifier is a claim verifier. Implementers can use this guide to check a product claim's signature and any anchor: a small on-chain output committing to its exact bytes. Produce a report showing each check's evidence. With the packages, `verifyLifecycleClaim` and `verifyPassportEvidence` from `@bsv/dpp-protocol` perform these checks ([gather a passport's evidence](../../packages/dpp-protocol.md#gather-a-passports-evidence)).

## Prerequisites and evidence inputs

| Exercise or input | Requirement and source |
|---|---|
| Claim verification | Secured bytes exactly as received, their representation, and the passport identifier the caller expects. |
| Anchor checks | The anchor's locking script from the supplied evidence. |
| Authority, status and inclusion | Policy and evidence for each check; without them, report `unknown`. |
| Checkout examples | Node.js 22 or later, npm and git; complete [setup](../../quick-start.md#get-the-code), including `npm ci` and `npm run build`. Run at the checkout root. |
| Live registry command | Registry URL and network access to its query routes and the chain source. Optionally supply accepted service keys and `WOC_API_KEY` as described below. |
| Hosted proof page | Registry URL; its two showcase routes enabled and available cross-origin with `Access-Control-Allow-Origin`. |

A claim and anchor establish that a key signed the bytes and an anchoring service committed to them. They establish neither the issuer's authority nor that the event happened.

## See the reference answer

Run the native claim and anchor example:

```sh
node examples/verify-attestation-anchor.mjs
```

Expect these checks for one valid claim and its anchor:

```
Holds: the anchoring service signature, key derivation and ten-field layout verify.
Holds: the complete secured representation includes the native claim signature.
Holds: the native claim signature verifies under its did:key issuer.
Holds: the anchor commits to those complete secured bytes.
Holds: the carried issuer, subject and event type match the signed claim.
Holds: the representation and media type select the native lifecycle verifier.
This example does not evaluate business authority, physical product binding, credential status, VSC conformance or transaction inclusion.
```

This example refuses nothing; use [the cases to run](#the-cases-to-run) for refusals. For historical `uora-anchor-v3`, [`examples/verify-anchor.mjs`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/examples/verify-anchor.mjs) checks `fixtures/anchor-v3.json` from the output's bytes. Run `node examples/verify-anchor.mjs`: expect `Holds:` per check and for all eight refusals, then `Every check holds.`

## Build the verifier

1. **Keep the bytes** ([rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md) section 4). Store the received bytes before decoding, and refuse duplicate JSON keys.
2. **Dispatch on the representation** using the table below. Each format has different proof rules. Report an unimplemented representation as `unknown` with `representation-unsupported`, never a pass.
3. **Verify a native claim** (rules section 3). Accept exactly the allowed properties. Serialise all except `signature` as restricted canonical JSON, hash with SHA-256, and verify the DER signature under the issuer key's BRC-42 child: protocol `[1, 'dpp attestation v1']`, key identifier `passportId`, counterparty `anyone`. A `did:key` issuer names the key; otherwise `issuerKeyDid` names it, and its relationship to the issuer needs separate evidence.
4. **Decode the anchor** (rules section 5). Check every layout and derivation rule in the anchor table below.
5. **Bind the anchor to the claim** (rules section 6). Field 2 must equal the complete secured bytes' SHA-256; for native claims, hash restricted canonical JSON including `signature`. The anchor's issuer, subject, type, representation and media type must equal the verified claim's.
6. **Compare the subject** ([verification](https://github.com/bsv-blockchain/dpp/blob/fc73e35145d19c802c4cd566b4396f5a2b79a75b/spec/verification.md) section 3) with the identifier your caller expects.
7. **Report each check separately** (verification section 4): `nativeAttestationSignature`, `anchorSignature`, `anchorKeyDerivation`, `anchorDigestAndMetadataBinding`, `subjectBinding`, `issuerAuthority` and `evidenceAvailability`, among the sixteen. A valid claim without an anchor is not a completed anchor check; a valid anchor without the claim cannot establish what the claim says.

| Representation | Format and proof rules |
|---|---|
| `dpp-lifecycle-json-v1` | Native claim, rules section 3 |
| `vsc-seal-json-v1` | SEAL, the event credential of the parked Verifiable Supply Chain (VSC) profile; a verifier need not implement it |
| `vc-di-ecdsa-rdfc-2019@1` | [External W3C credential](../../interoperability/external-credentials.md) |
| `epcis-event-vc@1` | Directly signed EPCIS event, `spec/epcis-event-profile.md` sections 3 to 7: recompute the CBV 2.0 Event Hash ID from the subject, verify the ES256K compact JWS against the key its `kid` names, and bind the anchor to the exact JWS bytes ([sign an event](../../interoperability/epcis.md#sign-an-event)) |
| `legacy-uora-json` | Record predating the native format; [legacy UORA anchors](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/legacy-uora-anchor-v3.md) sections 3 to 5 |

| Anchor element | Required value or check |
|---|---|
| Complete script | Exactly a 33-byte key, `OP_CHECKSIG`, ten fields and five `OP_2DROP`; nothing after. |
| Field 1 | `bsv-attestation-anchor-v1` |
| Fields 1 to 9 | Printable UTF-8 within their bounds; prefix each with its length as a Bitcoin VarInt when building the signing preimage. |
| Field 10 | Service's DER signature over the SHA-256 of that preimage. |
| Signature key | BRC-42 child of field 9 (`anchoredBy`), protocol `[1, 'bsv attestation anchor v1']`, key identifier field 3 (`attestationId`), counterparty `anyone`. |
| Locking key | Must equal the same child. |

Present the [individual findings](../../learn/evidence-and-freshness.md), including unknown authority or inclusion. An application can apply policy without hiding them.

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

- The fixture claim is about the genesis of `fixtures/chain-v1.json`, named by its outpoint, under `general@2` ([fields for a live claim](attestation-issuer.md#fields-for-a-live-claim)).

## Run an anchor proof page

A proof page checks claims without trusting their registry. The registry supplies stored bytes and names each anchor transaction; everything else comes from the chain. The [hosted reference](../../deployment.md#the-hosted-reference) reads `GET /showcase/attestations` and `GET /showcase/verify/{id}`, two routes the reference registry serves and documents beyond the minimum of the [registry contract](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/registry.yaml).

1. Enable both showcase routes in the registry deployment; they are off until enabled.
2. Set the proof page's RESOLVER field to your registry URL. It defaults to the hosted registry.
3. For the hosted page's browser requests, provide the cross-origin header listed above, as the hosted registry does. For your own page's server requests, allow only configured registries. Fetching any visitor-supplied address permits server-side request forgery against internal services.
4. Pace verify-route requests and use the chain source's API key: the route fetches the anchor transaction on every request.

To check any registry using only its two query routes, run `examples/check-registry.mjs`; copy its source for your implementation:

```sh
node examples/check-registry.mjs --fixture
node examples/check-registry.mjs https://dpp-resolver.bsvb.net
```

The first runs offline on repository test data and ends `Every sentence above holds.` The second checks a live registry's first 10 records.

| Option or output | Meaning |
|---|---|
| `--subject=<passportId>` | Select one passport. |
| `--limit=<n>` | Check more records. |
| `--anchoring-services=<key>,<key>` | Name the anchoring services you accept. |
| `WOC_API_KEY` | Raise WhatsOnChain's rate limit. |
| Per-record output | One line per check: `pass`, `fail`, `unknown` or `not-applicable`; no overall verdict (verification section 4). |
| Exit status 1 | At least one check failed. Inspect that check before relying on its result. |

| Check | What it does | Where the evidence comes from |
|---|---|---|
| `digest` | Hashes the stored bytes with SHA-256 and compares the result with the registry's `digest` | `GET /attestations/{id}/proof`: `securedBytes`, or `canonical` on a `legacy-uora-json` record |
| `claim signature` | Verifies a native claim with `verifyLifecycleClaim` from `@bsv/dpp-protocol` | The stored bytes |
| `anchor` | Decode using the first field's format; verify signature and locking key | WhatsOnChain transaction (`/tx/<txid>/hex`), located by the proof's `anchor.recordId` and `anchor.outputIndex`. Any registry-supplied script must match. |
| `binding` | The anchor commits to the digest and names the claim's identifier, issuer, subject and type | The decoded anchor and the claim |
| `inclusion` | Verify the transaction's merkle path against headers. A registry-supplied path counts only if its root matches the header. | The proof's `anchor.merklePath`, otherwise WhatsOnChain's `/tx/<txid>/proof/bump`. Both are BUMPs read unchanged by `MerklePath.fromHex` from `@bsv/sdk`. Block headers come from your header source. |
| `anchoring service` | Compare the anchor's signing key with accepted services; without your own list, use the registry's keys. | Decoded anchor and `--anchoring-services`, otherwise `GET /capabilities` keys in `anchoredBy` or `publisherPolicy.anchoringServices`. |

What each kind of record can establish:

| Record | Anchor | What can be established |
|---|---|---|
| `dpp-lifecycle-json-v1`, a native claim | `bsv-attestation-anchor-v1`, read with `inspectAttestationAnchor` from `@bsv/dpp-protocol` | Every check |
| `legacy-uora-json` | `uora-anchor-v3`, read with `tryParseUoraAnchor` from `@bsv/dpp-overlay` | Every check but the claim signature, which the example does not check |
| `legacy-uora-json` | `uora-anchor-v1` | The digest, inclusion, and that the output is signed by its own locking key. A v1 anchor names no issuer and no anchoring service, so who anchored it cannot be established |
| `vsc-seal-json-v1`, a SEAL credential | `bsv-attestation-anchor-v1` | The digest, anchor and inclusion; the credential itself is the parked VSC profile's, which [`@bsv/dpp-credentials`](../../packages/dpp-credentials.md#parked-the-vsc-compatibility-profile) verified up to 0.2.0-beta.5 |

## Known gaps

These are open questions in the standard; [known limitations](../../operate/limitations.md) lists the reference service's limits.

An anchor names the claim's digest, identifier, issuer, subject and anchoring service key, but no registry. A passport names no registry either. Obtain the registry out of band, for example from the passport's application. With only an anchor, report the `anchor-bytes-absent` case:

| Check | Status | Reason |
|---|---|---|
| `anchorSignature`, `anchorKeyDerivation` | `pass` | Anchor checks can run without claim bytes. |
| `anchorDigestAndMetadataBinding` | `unknown` | `secured-bytes-absent` |
| `nativeAttestationSignature`, `schema`, `credentialTime`, `credentialStatus` | `unknown` | `no-evidence` |
| `evidenceAvailability` | `unknown` | `referenced-artefact-unavailable` |

Live identity assurance is Ring 0: the platform vouches only for the account and brand label ([identity and authority](../../learn/identity-and-authority.md)). A `did:key` names a key, not a legal entity. `issuerAuthority` passes only against a policy naming the issuers you trust.

## Exact implementation sources

- [spec/rules.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md)
- [spec/identity.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/identity.md)
- [spec/verification.md](https://github.com/bsv-blockchain/dpp/blob/fc73e35145d19c802c4cd566b4396f5a2b79a75b/spec/verification.md)
- [spec/legacy-uora-anchor-v3.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/legacy-uora-anchor-v3.md), for the historical anchor
- [fixtures/attestation-anchor-v1.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/attestation-anchor-v1.json) and its [vector form](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/vectors/dpp/attestation-anchor/v1.json)

Record results as [evidence reporting](../reporting.md) describes; the [source gaps](../fixture-runner.md#source-gaps) remain open. Next: the [registry](registry.md), which stores claims and serves the bytes a verifier needs.
