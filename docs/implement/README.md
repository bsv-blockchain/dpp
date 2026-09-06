# The implementer contract

**Audience:** a team implementing the DPP rules without the reference code. **Release:** `dpp-release-2026-09-3`; the bundle records the exact revision. **Prerequisites:** the implementer bundle, a secp256k1 library with ECDSA and a BRC-42 derivation, a SHA-256, a JSON Schema 2020-12 validator, and a way to parse Bitcoin transactions and merkle paths. **Canonical sources:** [`spec/conformance.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/conformance.md), [`conformance/baseline-native-2.json`](https://github.com/bsv-blockchain/dpp/blob/main/conformance/baseline-native-2.json), [`fixtures/README.md`](https://github.com/bsv-blockchain/dpp/blob/main/fixtures/README.md), [`GOVERNANCE.md`](https://github.com/bsv-blockchain/dpp/blob/main/GOVERNANCE.md).

This is the frozen starting contract for the independent implementation trial: what you receive, what you implement first, what you may share with the reference, how you show your work, and what your evidence will and will not establish. It is written so that a team can start without a conversation with the maintainers and without reading the reference source.

## What you receive

The implementer bundle, produced by `node scripts/implementer-bundle.mjs` from the standard's repository at the release revision and distributable as one archive:

| Directory | Contents | Status |
|---|---|---|
| `spec/` | Every normative document | Working draft, pinned by digest in the ledger |
| `contracts/` | The overlay, registry and interoperability OpenAPI contracts and every JSON schema | Versioned in each file |
| `fixtures/` | The bespoke JSON fixtures and the cross-language vector files, with their READMEs | Frozen; regenerated only by the reference tests and reviewed as a diff |
| `conformance/` | The two baselines, the requirement ledger and its schema, the selections and their schema, the example capability document, the licence record | Ledger updated 2026-09-06 |
| `profiles/` | The frozen profile manifests, schemas and generated documents, copied from the profiles package's data entry points | Immutable data |
| `docs/implement/` | These pages | Informative |
| `LICENSE`, `bundle-manifest.json` | The licence, and the manifest naming the release set, its digest, the source revision and the SHA-256 of every file in the bundle | |

The bundle carries no reference runtime code. Its manifest is how you and a reviewer agree on which bytes you implemented against; quote its release set, revision and digest in your report.

## What you implement, in order

1. **Passport reader** under `native-baseline@2`: decode both record versions, verify both signature preimages, hold a supplied history to the chain invariants including the version 2 control proof, retirement and upgrade, verify inclusion against a header source, and produce the verification report. Held to `record-v1`, `record-v2`, `chain-v1`, `chain-v2`, `managed-acceptance-v1`, `evidence-v1` and `evidence-v2`.
2. **Attestation verifier**: verify the native claim signature, decode the anchor strictly, check attribution by derivation and the digest and metadata binding, and produce the anchor and claim checks of the report. Held to `attestation-anchor-v1`, `anchor-v3` and the anchor cases of the report fixtures.
3. **Passport writer** and **attestation issuer**: build valid states of version 2 (and version 1 if you claim it), sign under the specified derivations, discharge the writer's duties, and sign claims. Held to the positive vectors, which publish their test keys so your bytes must match exactly, and to the writer self-report.
4. **Registry** and **overlay** as separately operated services, each with its own keys, database and policy, when the trial moves to provider independence.

Steps 1 and 2 need no funds, no service and no network. Step 3 is what makes exchange bidirectional. Step 4 is what makes a second provider.

## The independence rule

[Independence and shared dependencies](independence.md) states it in full. In one paragraph: you may share `@bsv/sdk` or any generic secp256k1, ECDSA, SHA-256, BRC-42, BEEF, merkle path, JSON Schema or RFC 8785 library, a BRC-100 wallet, and every data file in the bundle. You may not import, vendor, mirror, transpile, call as a service, or consult at runtime `@bsv/dpp-core`, `@bsv/dpp-overlay-topics`, `@dpp/service` or the programme's Python reader. You record who wrote each DPP module and what it depends on. You resolve an ambiguity by raising it, not by copying what the reference happens to do.

## How you show your work

One sentence per vector, refusals included, no score, as [claims and refusal reporting](reporting.md) describes. A capability document naming what you support and what you do not. The requirements-to-assertions matrix filled in for your roles, with the predicate that executed each row. For the exchange scenarios, the retained requests, responses, transactions and proofs [the demonstration](demonstration.md) names.

## What your evidence establishes

Passing every applicable fixture for a role establishes that your implementation of that role agrees with the reference on the bytes and the refusals the fixtures pin. Exchanging fresh records with the reference in both directions establishes interoperability for those roles under the pinned rules. Neither establishes writer behaviour beyond the self-report, operational independence (which needs separately operated services), or the organisational independence the governance milestone requires (which needs an implementing party other than this programme). The ledger's `independently-tested` status is reserved for that last case, and this trial's rows move to it only when that party is on record.
