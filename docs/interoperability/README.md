# Optional, fixed when claimed

**Audience:** implementers adopting discovery, source exchange, external credentials or projections. **Canonical sources:** [`packages/dpp-profiles/schemas/interoperability-profile.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/packages/dpp-profiles/schemas/interoperability-profile.schema.json), [`spec/exchange.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/exchange.md), [`fixtures/vectors/dpp/interoperability/README.md`](https://github.com/bsv-blockchain/dpp/blob/main/fixtures/vectors/dpp/interoperability/README.md).

Four profiles beside the core, each optional to adopt and fixed in behaviour when claimed, each with its own manifest, vectors and ledger rows, and none of them writes a token state. An import is a data operation; a transfer or a retirement still needs the passport service and the recipient's acceptance.

| Profile | What it fixes | Guide |
|---|---|---|
| `gs1-digital-link@1` | Resolving a GS1 Digital Link for primary key 01 with its qualifiers to passport and evidence services, key-tuple equivalence across hosts, EPC-binary decompression, resolution records, linksets and the resolver description file | [GS1 discovery](gs1-discovery.md) |
| `epcis-json@1`, `epcis-vsc@1` | Retaining an EPCIS 2.0.1 document byte for byte under disclosed limits, validating it without mutation, digesting event bodies, classifying arrivals, and mapping events into the VSC profile with four named outcomes | [EPCIS source exchange](epcis.md) |
| `vc-di-ecdsa-rdfc-2019@1` | Verifying an externally signed W3C VC 2.0 passport credential under `ecdsa-rdfc-2019` with ten separate checks, and keeping the reformatted-but-valid case apart from the exact bytes | [External credential verification](external-credentials.md) |
| `passport-projection@1` | Deriving a passport's values deterministically from pinned model, batch and item revisions under a named policy, with the same inputs giving the same digest | [Passport projections](projections.md) |

## Two readiness statements

Deliberately not implementations, and stated as such in every capability document that carries them. An EN 18223 serialisation is not implemented, because the normative text was not accessed and no representation, media type or artefact of it is known; a request framed as EN 18223 is `representation-unsupported`. The Union digital product passport registry is not integrated: a registration reference an operator supplies is preserved verbatim as unverified evidence, and its presence does not mean the passport is registered.

## Claiming one

A capability document lists the profile with its artefact digests; a reader that meets a representation, profile or suite it did not select answers `not-selected`, `representation-unsupported` or `suite-unsupported` and blocks what depended on it. The interoperability vectors are synthetic and neutral, and every one has refusal cases beside its positive ones.
