# Requirements to assertions

**Generated** from [`conformance/manifest.json`](https://github.com/bsv-blockchain/dpp/blob/main/conformance/manifest.json) (ledger updated 2026-09-07) and [`conformance/baseline-native-2.json`](https://github.com/bsv-blockchain/dpp/blob/main/conformance/baseline-native-2.json) by `node scripts/render-requirements-matrix.mjs`; edit the ledger, not this page. Vector counts are read from the fixture files.

For every role of `native-baseline@2`: each mandatory and optional requirement row, the clause it binds, its layer and its status in the ledger today, the fixtures that exercise it with their positive and refusal counts, and whether an independent implementer executes it as a predicate. A row an implementer does not implement stays visible as not implemented; a role not claimed is not reported. Statuses are the ledger's (`tested` is the reference suite; `independently-tested` needs another implementing party) and none of them is the implementer's to change.

## Specified outcomes an implementer must reproduce

| Situation | Specified outcome | Reason code |
|---|---|---|
| A record version, anchor prefix or claim format the reader does not know | Refused, never guessed | `decode-failed` |
| A credential representation or proof suite not supported or not selected | Named result that blocks what depended on it | `representation-unsupported`, `suite-unsupported`, `not-selected` |
| A merkle path absent, refuted by the header source, or the source unreachable | Inclusion `unknown` or `fail`, never pass | `proof-absent`, `proof-refuted`, `header-source-unavailable` |
| No authority policy supplied, authority unconfirmed or unavailable | Issuer authority `unknown` | `policy-missing`, `authority-unconfirmed`, `authority-unavailable` |
| Status unset, revoked, suspended, stale, unauthenticated or unknown | The named status result; a native claim `not-applicable` | `status-*`, `format-defines-no-status` |
| Secured bytes absent, digest or metadata mismatch | The binding check fails or is unknown | `secured-bytes-absent`, `digest-mismatch`, `metadata-mismatch` |
| Control not proven, lineage retired, commitment absent under the profile, invalid version transition | Linkage fails | `control-not-proven`, `lineage-retired`, `acceptance-commitment-absent`, `version-transition-invalid` |
| Subject not independently expected, mismatched, ambiguous genesis | Subject binding unknown or fails | `subject-not-independent`, `subject-mismatch`, `genesis-ambiguous`, `genesis-mismatch` |
| A check the verifier was not asked to run, or a resource limit reached | `unknown` | `not-inspected`, `resource-limit` |

## passport-reader

Decode and verify supplied token history of either record version and report the scope of the finding. Test targets: `fixtures/record-v1.json`, `fixtures/chain-v1.json`, `fixtures/evidence-v1.json`, `examples/verify-passport.mjs --fixture --report`, `fixtures/record-v2.json`, `fixtures/chain-v2.json`, `fixtures/managed-acceptance-v1.json`, `fixtures/evidence-v2.json`, `examples/verify-passport.mjs --fixture --version=2 --report`.

| Requirement | Clause | Layer | Ledger status | Fixtures and vectors | Independent predicate |
|---|---|---|---|---|---|
| `RM-2-script` | spec/record-model.md §2 | core | tested | `record-v1` (2 positive, 9 refusal), `chain-v1` (9 positive, 16 refusal), `evidence-v1` (21 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM-2-minimal-push` | spec/record-model.md §2 | core | tested | `record-v1` (2 positive, 9 refusal), `chain-v1` (9 positive, 16 refusal), `evidence-v1` (21 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM-3-fields` | spec/record-model.md §3 | core | tested | `record-v1` (2 positive, 9 refusal), `chain-v1` (9 positive, 16 refusal), `evidence-v1` (21 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM-4-operations` | spec/record-model.md §4 | core | tested | `record-v1` (2 positive, 9 refusal), `chain-v1` (9 positive, 16 refusal), `evidence-v1` (21 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM-5-signatures` | spec/record-model.md §5 | core | tested | `record-v1` (2 positive, 9 refusal), `chain-v1` (9 positive, 16 refusal), `evidence-v1` (21 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM-6-invariants` | spec/record-model.md §6 | core | tested | `record-v1` (2 positive, 9 refusal), `chain-v1` (9 positive, 16 refusal), `evidence-v1` (21 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM-7-owner-tier` | spec/record-model.md §7 | core | tested | `record-v1` (2 positive, 9 refusal), `chain-v1` (9 positive, 16 refusal), `evidence-v1` (21 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM-8-verifier` | spec/record-model.md §8 | core | tested | `record-v1` (2 positive, 9 refusal), `chain-v1` (9 positive, 16 refusal), `evidence-v1` (21 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `VER-2-report` | spec/verification.md §2 | core | tested | `evidence-v1` (21 report cases), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `VER-3-expected-subject` | spec/verification.md §3 | core | tested | `evidence-v1` (21 report cases), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `VER-4-checks` | spec/verification.md §4 | core | tested | `evidence-v1` (21 report cases), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `VER-5-observations` | spec/verification.md §5 and §6 | core | tested | `evidence-v1` (21 report cases), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `CONF-2-reader-quickstart` | spec/conformance.md §2 | role | tested | contract or suite named by the row | Yes, against the contract or fixture named |
| `RM2-2-script` | spec/record-model-v2.md §2 | core | tested | `record-v2` (2 positive, 9 refusal), `chain-v2` (10 positive, 25 refusal), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM2-3-fields` | spec/record-model-v2.md §3 | core | tested | `record-v2` (2 positive, 9 refusal), `chain-v2` (10 positive, 25 refusal), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM2-4-operations` | spec/record-model-v2.md §4 | core | tested | `record-v2` (2 positive, 9 refusal), `chain-v2` (10 positive, 25 refusal), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM2-5-signatures` | spec/record-model-v2.md §5 | core | tested | `record-v2` (2 positive, 9 refusal), `chain-v2` (10 positive, 25 refusal), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM2-6-invariants` | spec/record-model-v2.md §6 | core | tested | `record-v2` (2 positive, 9 refusal), `chain-v2` (10 positive, 25 refusal), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM2-6-control-proof` | spec/record-model-v2.md §6 | core | tested | `record-v2` (2 positive, 9 refusal), `chain-v2` (10 positive, 25 refusal), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM2-8-commitment` | spec/record-model-v2.md §8 | core | tested | `record-v2` (2 positive, 9 refusal), `chain-v2` (10 positive, 25 refusal), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM2-9-verifier` | spec/record-model-v2.md §9 | core | tested | `record-v2` (2 positive, 9 refusal), `chain-v2` (10 positive, 25 refusal), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `VER-4-version-2-findings` | spec/verification.md §4 | core | tested | `evidence-v1` (21 report cases), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `CUST-4-owner-consent` (optional) | spec/custody.md §4 | profile | tested | `chain-v1` (9 positive, 16 refusal) | Yes, when the profile is selected |
| `MC-3-acceptance-record` (optional) | spec/managed-custody.md §3 | profile | tested | `managed-acceptance-v1` (2 positive, 6 refusal), `chain-v2` (10 positive, 25 refusal), `evidence-v2` (13 report cases) | Yes, when the profile is selected |
| `MC-4-transfer-binding` (optional) | spec/managed-custody.md §4 | profile | tested | `managed-acceptance-v1` (2 positive, 6 refusal), `chain-v2` (10 positive, 25 refusal), `evidence-v2` (13 report cases) | Yes, when the profile is selected |
| `MC-5-verification-report` (optional) | spec/managed-custody.md §5 | profile | tested | `managed-acceptance-v1` (2 positive, 6 refusal), `chain-v2` (10 positive, 25 refusal), `evidence-v2` (13 report cases) | Yes, when the profile is selected |

## attestation-verifier

Verify supplied claim signatures, anchor attribution, digest and metadata binding, and the selected authority and status evidence, reporting what could not be checked. Test targets: `fixtures/attestation-anchor-v1.json`, `fixtures/anchor-v3.json`, `fixtures/evidence-v1.json`, `examples/verify-attestation-anchor.mjs`.

| Requirement | Clause | Layer | Ledger status | Fixtures and vectors | Independent predicate |
|---|---|---|---|---|---|
| `RULES-3-native-claim` | spec/rules.md §3 | core | tested | `attestation-anchor-v1` (2 positive, 6 refusal), `evidence-v1` (21 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RULES-4-representation-bytes` | spec/rules.md §4 | core | tested | `attestation-anchor-v1` (2 positive, 6 refusal), `evidence-v1` (21 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RULES-5-anchor` | spec/rules.md §5 | core | tested | `attestation-anchor-v1` (2 positive, 6 refusal), `evidence-v1` (21 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RULES-6-verification` | spec/rules.md §6 | core | tested | `attestation-anchor-v1` (2 positive, 6 refusal), `evidence-v1` (21 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RULES-7-compatibility` | spec/rules.md §7 | core | tested | `attestation-anchor-v1` (2 positive, 6 refusal), `evidence-v1` (21 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `VER-2-report` | spec/verification.md §2 | core | tested | `evidence-v1` (21 report cases), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `VER-4-checks` | spec/verification.md §4 | core | tested | `evidence-v1` (21 report cases), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `ID-2-did-key` | spec/identity.md §2 | core | tested | `attestation-anchor-v1` (2 positive, 6 refusal), `record-v1` (2 positive, 9 refusal) | Yes: reproduce the rule and refuse every refusal vector |
| `VSC-2-structure` (optional) | https://w3c-cg.github.io/vsc/specs/vsc-core.html SEAL structure and event vector, as selected in spec/vsc-profile.md §2 | profile | tested | contract or suite named by the row | Yes, when the profile is selected |
| `VSC-3-proofs` (optional) | https://w3c-cg.github.io/vsc/specs/vsc-core.html proof requirements, as selected in spec/vsc-profile.md §3 | profile | tested | contract or suite named by the row | Yes, when the profile is selected |
| `VSC-4-status` (optional) | https://www.w3.org/TR/vc-bitstring-status-list/ validate algorithm, as selected in spec/vsc-profile.md §4 | profile | tested | contract or suite named by the row | Yes, when the profile is selected |
| `VSC-4-authority` (optional) | https://w3c-cg.github.io/vsc/specs/vsc-requirements.html trust and authority, as selected in spec/vsc-profile.md §4 | profile | tested | contract or suite named by the row | Yes, when the profile is selected |
| `VSC-5-custody` (optional) | https://w3c-cg.github.io/vsc/specs/vsc-core.html custody chain, forks, merges, corrections, as selected in spec/vsc-profile.md §5 | profile | tested | contract or suite named by the row | Yes, when the profile is selected |

## passport-writer

Construct valid states and discharge the broadcast, serialisation, announcement, proof and retention duties. Test targets: `examples/write-passport.mjs --dry-run`, `writer self-report, one sentence per rule (GOVERNANCE.md)`, `examples/lifecycle-v2.mjs`.

| Requirement | Clause | Layer | Ledger status | Fixtures and vectors | Independent predicate |
|---|---|---|---|---|---|
| `RM-2-script` | spec/record-model.md §2 | core | tested | `record-v1` (2 positive, 9 refusal), `chain-v1` (9 positive, 16 refusal), `evidence-v1` (21 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM-3-fields` | spec/record-model.md §3 | core | tested | `record-v1` (2 positive, 9 refusal), `chain-v1` (9 positive, 16 refusal), `evidence-v1` (21 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM-5-signatures` | spec/record-model.md §5 | core | tested | `record-v1` (2 positive, 9 refusal), `chain-v1` (9 positive, 16 refusal), `evidence-v1` (21 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM-6-invariants` | spec/record-model.md §6 | core | tested | `record-v1` (2 positive, 9 refusal), `chain-v1` (9 positive, 16 refusal), `evidence-v1` (21 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `WR-2-verify-before-send` | spec/writing.md §2 | role | tested | contract or suite named by the row | Self-report, one sentence, plus the demonstration |
| `WR-4-one-writer` | spec/writing.md §4 | role | implemented | contract or suite named by the row | Self-report, one sentence, plus the demonstration |
| `WR-5-broadcast` | spec/writing.md §5 | role | implemented | contract or suite named by the row | Self-report, one sentence, plus the demonstration |
| `WR-6-announce-retry` | spec/writing.md §6 | role | implemented | contract or suite named by the row | Self-report, one sentence, plus the demonstration |
| `WR-7-proof` | spec/writing.md §7 | role | implemented | contract or suite named by the row | Self-report, one sentence, plus the demonstration |
| `WR-8-retain` | spec/writing.md §8 | role | implemented | contract or suite named by the row | Self-report, one sentence, plus the demonstration |
| `RM2-2-script` | spec/record-model-v2.md §2 | core | tested | `record-v2` (2 positive, 9 refusal), `chain-v2` (10 positive, 25 refusal), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM2-3-fields` | spec/record-model-v2.md §3 | core | tested | `record-v2` (2 positive, 9 refusal), `chain-v2` (10 positive, 25 refusal), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM2-4-operations` | spec/record-model-v2.md §4 | core | tested | `record-v2` (2 positive, 9 refusal), `chain-v2` (10 positive, 25 refusal), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM2-5-signatures` | spec/record-model-v2.md §5 | core | tested | `record-v2` (2 positive, 9 refusal), `chain-v2` (10 positive, 25 refusal), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM2-6-invariants` | spec/record-model-v2.md §6 | core | tested | `record-v2` (2 positive, 9 refusal), `chain-v2` (10 positive, 25 refusal), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM2-6-control-proof` | spec/record-model-v2.md §6 | core | tested | `record-v2` (2 positive, 9 refusal), `chain-v2` (10 positive, 25 refusal), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RM2-8-commitment` | spec/record-model-v2.md §8 | core | tested | `record-v2` (2 positive, 9 refusal), `chain-v2` (10 positive, 25 refusal), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `WR-3-announce-before-send` (optional) | spec/writing.md §3 | role | implemented | contract or suite named by the row | Self-report, one sentence, plus the demonstration |
| `RM-3-gs1-allocation` (optional) | spec/record-model.md §3, the paragraph after the field table | role | implemented | `record-v1` (2 positive, 9 refusal), `chain-v1` (9 positive, 16 refusal), `evidence-v1` (21 report cases) | Yes, against the contract or fixture named |
| `GS1-check-digit-written` (optional) | https://ref.gs1.org/standards/genspecs/ GTIN check digit calculation | role | tested | contract or suite named by the row | Yes, against the contract or fixture named |
| `GS1-952-demonstration` (optional) | https://ref.gs1.org/standards/genspecs/ GS1 prefix 952 for demonstrations and examples | role | implemented | contract or suite named by the row | Yes, against the contract or fixture named |
| `MC-3-acceptance-record` (optional) | spec/managed-custody.md §3 | profile | tested | `managed-acceptance-v1` (2 positive, 6 refusal), `chain-v2` (10 positive, 25 refusal), `evidence-v2` (13 report cases) | Yes, when the profile is selected |
| `MC-4-transfer-binding` (optional) | spec/managed-custody.md §4 | profile | tested | `managed-acceptance-v1` (2 positive, 6 refusal), `chain-v2` (10 positive, 25 refusal), `evidence-v2` (13 report cases) | Yes, when the profile is selected |
| `MC-4-offer-lifecycle` (optional) | spec/managed-custody.md §4 | role | implemented | `managed-acceptance-v1` (2 positive, 6 refusal), `chain-v2` (10 positive, 25 refusal), `evidence-v2` (13 report cases) | Yes, against the contract or fixture named |

## attestation-issuer

Sign attributable lifecycle claims under the declared format and profile, without spending the passport token. Test targets: `fixtures/attestation-anchor-v1.json`.

| Requirement | Clause | Layer | Ledger status | Fixtures and vectors | Independent predicate |
|---|---|---|---|---|---|
| `RULES-3-native-claim` | spec/rules.md §3 | core | tested | `attestation-anchor-v1` (2 positive, 6 refusal), `evidence-v1` (21 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RULES-4-representation-bytes` | spec/rules.md §4 | core | tested | `attestation-anchor-v1` (2 positive, 6 refusal), `evidence-v1` (21 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `ID-2-did-key` | spec/identity.md §2 | core | tested | `attestation-anchor-v1` (2 positive, 6 refusal), `record-v1` (2 positive, 9 refusal) | Yes: reproduce the rule and refuse every refusal vector |
| `VSC-2-structure` (optional) | https://w3c-cg.github.io/vsc/specs/vsc-core.html SEAL structure and event vector, as selected in spec/vsc-profile.md §2 | profile | tested | contract or suite named by the row | Yes, when the profile is selected |
| `VSC-3-proofs` (optional) | https://w3c-cg.github.io/vsc/specs/vsc-core.html proof requirements, as selected in spec/vsc-profile.md §3 | profile | tested | contract or suite named by the row | Yes, when the profile is selected |

## registry

Apply declared intake and status policies; retain and return exact secured bytes and scoped verification reports. Test targets: `contracts/registry.yaml`, `fixtures/attestation-anchor-v1.json`.

| Requirement | Clause | Layer | Ledger status | Fixtures and vectors | Independent predicate |
|---|---|---|---|---|---|
| `SVC-3-registry-bytes` | spec/services.md §3 | role | tested | contract or suite named by the row | Yes, against the contract or fixture named |
| `RULES-4-representation-bytes` | spec/rules.md §4 | core | tested | `attestation-anchor-v1` (2 positive, 6 refusal), `evidence-v1` (21 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RULES-5-anchor` | spec/rules.md §5 | core | tested | `attestation-anchor-v1` (2 positive, 6 refusal), `evidence-v1` (21 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `RULES-6-verification` | spec/rules.md §6 | core | tested | `attestation-anchor-v1` (2 positive, 6 refusal), `evidence-v1` (21 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `STATUS-validate-algorithm` | https://www.w3.org/TR/vc-bitstring-status-list/ validate algorithm | core | tested | contract or suite named by the row | Yes: reproduce the rule and refuse every refusal vector |
| `REG-contract-routes` | contracts/registry.yaml paths | role | tested | contract or suite named by the row | Yes, against the contract or fixture named |
| `VER-2-report` | spec/verification.md §2 | core | tested | `evidence-v1` (21 report cases), `evidence-v2` (13 report cases) | Yes: reproduce the rule and refuse every refusal vector |
| `VSC-4-status` (optional) | https://www.w3.org/TR/vc-bitstring-status-list/ validate algorithm, as selected in spec/vsc-profile.md §4 | profile | tested | contract or suite named by the row | Yes, when the profile is selected |
| `VSC-4-authority` (optional) | https://w3c-cg.github.io/vsc/specs/vsc-requirements.html trust and authority, as selected in spec/vsc-profile.md §4 | profile | tested | contract or suite named by the row | Yes, when the profile is selected |
| `VSC-5-custody` (optional) | https://w3c-cg.github.io/vsc/specs/vsc-core.html custody chain, forks, merges, corrections, as selected in spec/vsc-profile.md §5 | profile | tested | contract or suite named by the row | Yes, when the profile is selected |
| `SVC-3-legacy-intake` (optional) | spec/services.md §3 | profile | tested | contract or suite named by the row | Yes, when the profile is selected |

## overlay

Admit and serve evidence under published policy, including the selected synchronisation profile. Test targets: `contracts/overlay.yaml`, `fixtures/attestation-anchor-v1.json`, `fixtures/vectors/`, `fixtures/chain-v2.json`.

| Requirement | Clause | Layer | Ledger status | Fixtures and vectors | Independent predicate |
|---|---|---|---|---|---|
| `SVC-2-passport-admission` | spec/services.md §2 | role | tested | contract or suite named by the row | Yes, against the contract or fixture named |
| `SVC-2-anchor-admission` | spec/services.md §2 | role | tested | contract or suite named by the row | Yes, against the contract or fixture named |
| `SVC-2-cursor-lookup` | spec/services.md §2 | role | tested | contract or suite named by the row | Yes, against the contract or fixture named |
| `SVC-2-proof-ingest` | spec/services.md §2 | role | tested | contract or suite named by the row | Yes, against the contract or fixture named |
| `SVC-6-idempotent-admission` | spec/services.md §6 | role | tested | contract or suite named by the row | Yes, against the contract or fixture named |
| `OVL-contract-must` | contracts/overlay.yaml x-dpp-profile.must | role | tested | contract or suite named by the row | Yes, against the contract or fixture named |
| `SVC-2-version-2-admission` | spec/services.md §2 | role | tested | contract or suite named by the row | Yes, against the contract or fixture named |
| `SVC-1-discovery-sync` (optional) | spec/services.md §1 | profile | tested | contract or suite named by the row | Yes, when the profile is selected |
| `CONF-4-overlay-capabilities` (optional) | spec/conformance.md §4 | role | tested | contract or suite named by the row | Yes, against the contract or fixture named |
| `CUST-4-owner-consent` (optional) | spec/custody.md §4 | profile | tested | `chain-v1` (9 positive, 16 refusal) | Yes, when the profile is selected |
| `MC-7-declaration` (optional) | spec/managed-custody.md §7 | role | tested | `managed-acceptance-v1` (2 positive, 6 refusal), `chain-v2` (10 positive, 25 refusal), `evidence-v2` (13 report cases) | Yes, against the contract or fixture named |

## Fixture inventory

| Fixture | Vector file identifier | Positive | Refusal |
|---|---|---|---|
| `record-v1` | `dpp.record.v1` (`fixtures/vectors/dpp/record/v1.json`) | 2 | 9 |
| `record-v2` | `dpp.record.v2` (`fixtures/vectors/dpp/record/v2.json`) | 2 | 9 |
| `chain-v1` | `dpp.chain.v1` (`fixtures/vectors/dpp/chain/v1.json`) | 9 | 16 |
| `chain-v2` | `dpp.chain.v2` (`fixtures/vectors/dpp/chain/v2.json`) | 10 | 25 |
| `anchor-v3` | `dpp.anchor.v3` (`fixtures/vectors/dpp/anchor/v3.json`) | 2 | 12 |
| `attestation-anchor-v1` | `dpp.attestation-anchor.v1` (`fixtures/vectors/dpp/attestation-anchor/v1.json`) | 2 | 6 |
| `managed-acceptance-v1` | `dpp.managedacceptance.v1` (`fixtures/vectors/dpp/managed-acceptance/v1.json`) | 2 | 6 |
| `publisher-policy-v1` | `dpp.publisherpolicy.v1` (`fixtures/vectors/dpp/publisher-policy/v1.json`) | 0 | 0 |
| `evidence-package-v1` | `dpp.evidencepackage.v1` (`fixtures/vectors/dpp/evidence-package/v1.json`) | 0 | 0 |
| `evidence-v1` | `fixtures/evidence-v1.json` | 21 report cases | included |
| `evidence-v2` | `fixtures/evidence-v2.json` | 13 report cases | included |

The bespoke JSON files carry the same bytes with their refusal variants beside them, and the chain fixtures' refusals name the prefix each extends and the option under which it is refused; [running the fixtures](fixture-runner.md) says how a harness reads both forms.

