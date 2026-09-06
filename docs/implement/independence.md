# Independence and shared dependencies

**Audience:** the independent implementer and whoever reviews the claim. **Canonical sources:** [`GOVERNANCE.md`](https://github.com/bsv-blockchain/dpp/blob/main/GOVERNANCE.md) (declaring version 1.0), [`spec/conformance.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/conformance.md) §6.

## The scope, frozen

| Roles, in order | Baseline | Fixtures held to |
|---|---|---|
| Passport reader | `native-baseline@2` | `record-v1`, `chain-v1`, `evidence-v1`, `record-v2`, `chain-v2`, `managed-acceptance-v1`, `evidence-v2` and their vector forms |
| Attestation verifier | `native-baseline@2` | `attestation-anchor-v1`, `anchor-v3`, the anchor and claim cases of `evidence-v1` |
| Passport writer | `native-baseline@2`, version 2 writes; version 1 optional | The positive vectors of `record-v2` and `chain-v2` reproduced byte for byte from the published test keys; the writer self-report |
| Attestation issuer | `native-baseline@2` | The positive vector of `attestation-anchor-v1` reproduced from the published keys |
| Registry, overlay | `native-baseline@2`, `single-operator@1` | The contracts, the anchor fixture, the vector runner, the publisher policy and evidence package vectors |

Custody profile: `managed-custody@1` for the exchange scenarios, because the reference provider selects it; `record-model-baseline@2` and the owner-signed transfer are read but not required. Industry profiles: none required for the core roles; `battery@2` and `textile@2` data may be read to show separate core and profile results. Interoperability profiles: out of scope for the trial unless claimed separately.

## Permitted shared dependencies

| Shared | Why it is fine |
|---|---|
| `@bsv/sdk` (or another library) for scripts, keys, ECDSA, SHA-256, BRC-42 derivation, transactions, BEEF and merkle paths | Generic blockchain primitives; the standard's rules are what you do with them |
| A BRC-100 wallet, `@bsv/wallet-toolbox` or another | Key custody and broadcast are the wallet's business |
| `@bsv/overlay` engine and GASP as a host for your own topic managers | The overlay protocol is generic; admission rules are yours |
| A JSON Schema 2020-12 validator, an RFC 8785 canonicaliser, a Data Integrity suite for credentials | Generic |
| The frozen profile manifests, schemas and generated documents | Immutable data; sharing a profile is not sharing an implementation |
| Every fixture and vector file, vendored verbatim | The point of a fixture |
| The contracts and schemas | The interface, not an implementation |

## Not permitted on the decision path

`@bsv/dpp-core`, `@bsv/dpp-overlay-topics`, `@dpp/service`, the application, the registry's source, and the Python reader: not imported, vendored, mirrored, transpiled, generated from, called through a service as the decision engine, or consulted at runtime. Exchanging records with a reference provider under test is permitted and expected; using its answer as your verdict is not. Where your harness drives a reference provider, the driver and your decision engine are separate modules and the driver's output is data your engine judges.

## Language

Choose the language after the role scope and the generic library capabilities are recorded, and default to the stack your team will maintain. Another language is useful where it exposes underspecified bytes, because it cannot share a serialiser by accident; it is not an acceptance condition, and sharing a language with the reference does not invalidate independent logic.

## Authorship and provenance record

Your report carries, for each DPP module: who wrote it, from which bundle revision, which generic libraries it depends on at which versions, and whether its author had read the reference source. Do not claim a clean-room process retrospectively for someone who has reviewed the reference source; say so, and let the reviewer weigh it. The ledger distinguishes `tested` (the reference suite), engineering evidence from within this programme (the Python reader), and `independently-tested` (another implementing party importing none of the reference code for the property). This trial's evidence is the second kind until an outside party is on record, and the version 1.0 declaration needs the third.

## Ambiguity

Where the specification underdetermines a byte or a refusal, the fixtures usually decide it; where they do not, raise it through [reporting a disagreement](../contribute/disagreements.md) rather than reading the reference and calling the ambiguity closed. A disagreement between two implementations is what the governance process exists to resolve, and an open one blocks version 1.0 by design.
