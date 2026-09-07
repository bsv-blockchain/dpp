# Optional, fixed when claimed

**Audience:** implementers adopting discovery, source exchange, external credentials or projections. **Canonical sources:** [`packages/dpp-profiles/schemas/interoperability-profile.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/packages/dpp-profiles/schemas/interoperability-profile.schema.json), [`spec/exchange.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/exchange.md), [`fixtures/vectors/dpp/interoperability/README.md`](https://github.com/bsv-blockchain/dpp/blob/main/fixtures/vectors/dpp/interoperability/README.md).

Four profiles beside the core, each optional to adopt and fixed in behaviour when claimed, each with its own manifest, vectors and ledger rows, and none of them writes a token state. An import is a data operation; a transfer or a retirement still needs the passport service and the recipient's acceptance.

| Profile | What it fixes | Guide |
|---|---|---|
| `gs1-digital-link@1` | Resolving a GS1 Digital Link for primary key 01 with its qualifiers to passport and evidence services, key-tuple equivalence across hosts, EPC-binary decompression, resolution records, linksets and the resolver description file | [GS1 discovery](gs1-discovery.md) |
| `epcis-json@1`, `epcis-vsc@1` | Retaining an EPCIS 2.0.1 document byte for byte under disclosed limits, validating it without mutation, digesting event bodies, classifying arrivals, and mapping events into the VSC profile with four named outcomes | [EPCIS source exchange](epcis.md) |
| `vc-di-ecdsa-rdfc-2019@1` | Verifying an externally signed W3C VC 2.0 passport credential under `ecdsa-rdfc-2019` with ten separate checks, and keeping the reformatted-but-valid case apart from the exact bytes | [External credential verification](external-credentials.md) |
| `passport-projection@1` | Deriving a passport's values deterministically from pinned model, batch and item revisions under a named policy, with the same inputs giving the same digest | [Passport projections](projections.md) |

## The UNTP exchange profile, proposed

`untp-0.7.0-jose@1` (`spec/exchange.md`, manifest under `packages/dpp-profiles/manifests/exchange/`) is a proposed exchange profile, not an interoperability profile of the four above and not claimed by any release. It names the UN Transparency Protocol's 0.7.0 release, tagged on 4 May 2026 at the specification's GitLab home, and pins its DigitalProductPassport, DigitalTraceabilityEvent and ConformityCredential schemas and its single JSON-LD context by digest from that tag. What exists against it is the reference application's function-level pilot: a passport exported as a VC Data Model 2.0 credential secured as a compact JWS under ES256K with the native evidence extension. What does not exist yet is named in the ledger: the credential carries no UNTP context or term and validates against nothing pinned, and UNTP's own test tooling verifies EdDSA on Ed25519 under `did:web` issuers only, so passing it would be a separate claim needing a signing capability this profile does not define. UNTP compatibility is in any case distinct from regulatory conformance.

## Two readiness statements

Deliberately not implementations, and stated as such in every capability document that carries them. An EN 18223 serialisation is not implemented, because the normative text was not accessed and no representation, media type or artefact of it is known; a request framed as EN 18223 is `representation-unsupported`. The Union digital product passport registry is not integrated: a registration reference an operator supplies is preserved verbatim as unverified evidence, and its presence does not mean the passport is registered.

## Claiming one

A capability document lists the profile with its artefact digests; a reader that meets a representation, profile or suite it did not select answers `not-selected`, `representation-unsupported` or `suite-unsupported` and blocks what depended on it. The interoperability vectors are synthetic and neutral, and every one has refusal cases beside its positive ones.
