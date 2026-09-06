# Specification index

Every normative document, kept canonical in Git and pinned by digest in the ledger. Links point at the repository's main branch; the revision the current release set was packed from is recorded in `release/candidates.json` and in the implementer bundle's manifest, and the ledger refuses a claim whose source digest has moved. Status of every document: working draft, pre-1.0.

| Document | What it defines | Layer |
|---|---|---|
| [`spec/record-model.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/record-model.md) | Record version 1: the fourteen fields, operations, the two signatures, chain invariants, the owner tier, what a verifier checks | Core |
| [`spec/record-model-v2.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/record-model-v2.md) | Record version 2: seventeen fields, framed preimages, control proof, retirement, authorisation commitment, the upgrade | Core |
| [`spec/identity.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/identity.md) | Identified entities and roles, native keys and derivations, VSC actor and physical-object identity, wallets and privacy | Core |
| [`spec/custody.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/custody.md) | The four keys, the owner key, the lock, the owner-signed transfer, the three arrangements, recovery | Core and profile |
| [`spec/managed-custody.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/managed-custody.md) | `managed-custody@1`: the acceptance record, the transfer, verification, control authorities, what a deployment declares | Profile |
| [`spec/rules.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/rules.md) | Independent evidence, the native lifecycle vocabulary and conditional mapping, the native claim, secured bytes, the anchor, verification and discovery, compatibility | Core |
| [`spec/legacy-uora-anchor-v3.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/legacy-uora-anchor-v3.md) | The historical `uora-anchor-v3` under its own rules | Historical |
| [`spec/writing.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/writing.md) | The writer's duties: verify, announce, one writer, broadcast, proof, retain, reorganisations, personal wallets | Role |
| [`spec/services.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/services.md) | No exclusive operator, the publisher policy, the overlay index, the registry, verification surfaces, identifier resolution, operator conformance | Role |
| [`spec/verification.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/verification.md) | The one report: expected subject, sixteen checks, observations, limits, surfaces | Core |
| [`spec/portable-evidence.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/portable-evidence.md) | Pages of a snapshot, the evidence package, the complete export, replicas and recovery | Role |
| [`spec/conformance.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/conformance.md) | Layers, roles, the baselines, profiles and capabilities, the identity vocabulary, the ledger and the claim gate | Core |
| [`spec/profiles.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/profiles.md) | What a profile is, the manifest, fields, freezing and migration, identifiers, generated consumers | Core |
| [`spec/exchange.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/exchange.md) | Named representations, exchange profile manifests, the four artefacts kept apart, signers, the native evidence extension, exact-byte anchoring | Core |
| [`spec/vsc-profile.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/vsc-profile.md) | `vsc-draft-compat/0.1.0`: sources, structure, contexts and proofs, status and authority, custody, EPCIS, roles and qualification | Profile |
| [`spec/external-credential-profile.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/external-credential-profile.md) | `vc-di-ecdsa-rdfc-2019@1` | Profile |
| [`spec/gs1-discovery.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/gs1-discovery.md) | `gs1-digital-link@1` | Profile |
| [`spec/epcis-interoperability.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/epcis-interoperability.md) | `epcis-json@1`, `epcis-vsc@1` | Profile |
| [`spec/passport-projections.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/passport-projections.md) | `passport-projection@1`, source revisions, relationships, shared shapes, manifest version 2 | Profile |
| [`spec/design-rationale.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/design-rationale.md) | Why the design is as it is | Informative |

Each document ends with a section named "Normative and implementation" that says what a conforming party reproduces and what is a build's own. Where a document and these pages disagree, the document wins.
