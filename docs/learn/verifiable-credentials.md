# Verifiable credentials

A verifiable credential (VC) is an issuer's statement secured by a proof that a recipient can check. It identifies the issuer and subject and carries claims about that subject. In a digital product passport (DPP), a credential can carry a product assertion or lifecycle event, such as a repair, alongside the passport's transaction history.

A [DID](dids.md) helps identify the issuer and obtain its verification keys. The VC carries what that issuer says. The proof attributes the statement to an authorised key; evidence and policy determine whether to accept the claim. A DID document alone does not establish accreditation or product truth.

## What exists

The reference packages implement selected World Wide Web Consortium (W3C) VC formats. Each representation selects its own data model, proof suite and identity rules. A native lifecycle claim has a separate format; signing one does not produce a W3C VC.

| Representation | Current capability | Ledger evidence |
|---|---|---|
| Verifiable Supply Chain (VSC), `vsc-draft-compat/0.1.0` | Issue and verify SEAL event credentials with `Ed25519Signature2020` or `bbs-2023` proofs. | `tested`: [VSC-2-structure](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json#L2514), [VSC-3-proofs](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json#L2545). |
| External passport credential, `vc-di-ecdsa-rdfc-2019@1` | Verify and accept VC Data Model 2.0 credentials using `did:web`, P-256 keys and `ecdsa-rdfc-2019`. This profile has no issuance API. | `tested`: [EXTC-1-representation](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json#L4630), [EXTC-5-registry-intake](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json#L4744). |
| JSON Web Signature (JWS) with ES256K | The companion application issues and verifies compact credentials through an injected signer. | `tested`: [EXCH-4-signer](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json#L3568). This does not close the product-profile gaps below. |

`bbs-2023` supports selective disclosure: a holder can present selected claims through a derived proof. The selected VSC implementation binds that proof to a presentation request. Holder authentication and the HTTPS presentation transport remain unimplemented, as the proof ledger row records.

## Run the credential exercises

After [repository setup](../quick-start.md#prepare-the-checkout), run:

```sh
npm run test -w @bsv/vsc -- test/crypto.test.ts test/verification.test.ts
npm run test -w @bsv/vsc -- test/exchange.test.ts test/exchange-vectors.test.ts
```

The first command exercises VSC issuance, proof verification and evidence checks. The second exercises the external profile with valid, altered, expired, revoked and unsupported credentials. The tests supply identity documents and status evidence locally. Expect all assertions to pass, including refusals of deliberately invalid inputs. No wallet or funds are needed.

## Connect an issuer or verifier

For VSC issuance, prepare the event, product subject, issuer DID document, status entry and a signing key authorised for assertion. The [credential APIs](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/vsc/src/crypto.ts) expose `issueSealEd25519` and `issueSealBbs`. The selected suite uses its own signing capability; the native BSV wallet key is not an interchangeable input.

For verification, retain the exact received credential bytes and independently supply the expected product identifier. Provide the selected contexts, issuer documents, observation time, status sources and authority policy. Use `verifySeal` for the VSC profile or `verifyExternalCredential` for the external profile. [External credential verification](../interoperability/external-credentials.md) explains the latter route and its shared-report adapter.

Check proof, issuer authority, subject binding, time and status separately. Missing evidence can leave a finding unknown even when the proof verifies. Retain the original secured bytes when adding a blockchain commitment: a derived presentation or reformatted credential is a different byte sequence. [Evidence and its limits](evidence-and-freshness.md) explains these results.

## What remains incomplete

| Capability | Ledger status and remaining work |
|---|---|
| Exact upstream VSC context and upstream suite | `unassessed`: the reviewed upstream context and executable suite are unavailable. The package uses its own declared context. [VSC-context-upstream](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json#L2674), [VSC-conformance-suite](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json#L2701). |
| United Nations Transparency Protocol (UNTP) 0.7.0 passport | `gap`: an application pilot exists, but its credential still lacks the pinned UNTP context, terms and issuing-software block and does not validate against the pinned schema. [UNTP-0.7.0-dpp](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json#L2916). |
| UNTP traceability event | `gap`: no event export exists; actual event evidence is required by the mapping. [UNTP-0.7.0-dte](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json#L2942). |
| Optional ES256 application signer | Unimplemented; the tested ES256K signer does not supply it. [EXCH-4-signer](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json#L3568). |

The [VSC profile](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/vsc-profile.md) and [external credential profile](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/external-credential-profile.md) define the selected representations. Teranode Group's `did:bsv` method does not replace a profile's selected DID method, proof purpose or curve.

Live identity assurance is Ring 0. Higher rings are absent. A credential or a passing proof does not promote that assurance.
