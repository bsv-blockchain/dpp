# Specification index

Implementers can use this index to select rules for their release. For an introduction, use the [passport model](../start/architecture.md), [quick start](../quick-start.md) or [implementer start](../implement/README.md).

## Before selecting a source

| Target | Source to use |
|---|---|
| Reviewed November source candidate | Links below describe `dpp-release-2026-11`, not yet published |
| Installed package | Specification and contract revisions in its [release set and publication receipt](release-sets.md) |
| Published October set | Still selects `managed-custody@1` |

## What is normative

| Rule | Meaning |
|---|---|
| Normative material | Once published, `spec/`, `contracts/` and `fixtures/` are normative: an implementation conforms or does not ([governance](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/GOVERNANCE.md#what-is-normative)) |
| Document status | Working draft before version 1.0 unless the document says otherwise |
| Text/code disagreement before 1.0 | Reference implementation breaks the tie, except where the specification names a defect |

The [contracts page](contracts.md) maps machine-readable interfaces; [conformance](conformance.md) explains the requirement ledger.

If a fixture disagrees with text, retain the input, both readings and selected revision; [report the disagreement](../contribute/disagreements.md). The [fixture guide](../implement/fixture-runner.md#source-gaps) lists known conflicts. Documentation does not silently choose a new rule.

## The documents

| Group | Document | Read when |
|---|---|---|
| Records | [record-model-v2.md](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/record-model-v2.md), the record model, version 2 | You write new passports: version 2 is the seventeen-field layout new states use. |
| Records | [token-carrier.md](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/token-carrier.md), the token carrier, record version 3 | You write passports a generic token reader can follow: the version 2 body behind a BRC-162 token prefix, found by its token id, for new lineages only. |
| Records | [record-model.md](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/record-model.md), the record model, version 1 | You read existing passports: readers still verify version 1, and version 2 builds on it. |
| Records | [writing.md](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/writing.md), the writer's lifecycle | You write states: the order of check, announce and send, and the duties to prove and keep. |
| Records | [verification.md](https://github.com/bsv-blockchain/dpp/blob/fc73e35145d19c802c4cd566b4396f5a2b79a75b/spec/verification.md), one verification contract | You read passports: the report's checks and the four answers each can give. |
| Records | [services.md](https://github.com/bsv-blockchain/dpp/blob/fc73e35145d19c802c4cd566b4396f5a2b79a75b/spec/services.md), service roles and verification boundaries | You run or call an index or registry: publisher policy, admission and synchronisation. |
| Claims | [rules.md](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/rules.md), attestations and complete-representation anchors | You sign, anchor or verify a lifecycle claim. |
| Claims | [legacy-uora-anchor-v3.md](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/legacy-uora-anchor-v3.md), historical native claims and anchor v3 | You read claims written in the historical format. Status: historical; new writes use the current rules. |
| Custody | [custody.md](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/custody.md), where the keys may live | You decide who holds a passport's keys, or support the owner-signed transfer. |
| Custody | [managed-custody.md](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/managed-custody.md), the `managed-custody@2` profile | A custodian holds the keys for the parties and a recipient accepts without a wallet. |
| Identity | [identity.md](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/identity.md), identity, control and application boundaries | You separate product identity, signing keys and control authority. |
| Profiles | [profiles.md](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/profiles.md), profiles and identifiers | You choose, check or publish an industry profile, or relate model, batch and item identifiers. |
| Profiles | [passport-projections.md](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/passport-projections.md), sources, projections and publication | You derive a passport's facts from source records under a named policy. |
| Interoperability | [gs1-discovery.md](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/gs1-discovery.md), the `gs1-digital-link@1` profile | You resolve a GS1 Digital Link to a passport. Status: proposed. |
| Interoperability | [exchange.md](https://github.com/bsv-blockchain/dpp/blob/fc73e35145d19c802c4cd566b4396f5a2b79a75b/spec/exchange.md), exchange profiles | You carry passport evidence in a credential format beside the native record. |
| Interoperability | [external-credential-profile.md](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/external-credential-profile.md), `vc-di-ecdsa-rdfc-2019@1` | You verify a W3C credential another party issued and committed on chain. |
| Interoperability | [epcis-interoperability.md](https://github.com/bsv-blockchain/dpp/blob/fc73e35145d19c802c4cd566b4396f5a2b79a75b/spec/epcis-interoperability.md), EPCIS source exchange and the parked mapping to SEALs | You take in GS1 EPCIS 2.0.1 event data. |
| Interoperability | [vsc-profile.md](https://github.com/bsv-blockchain/dpp/blob/fc73e35145d19c802c4cd566b4396f5a2b79a75b/spec/vsc-profile.md), the VSC draft compatibility profile | You use the Verifiable Supply Chain (VSC) credential subset. Status: implementation draft, not a W3C standard; parked, required by no release. |
| Evidence | [portable-evidence.md](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/portable-evidence.md), complete pages and packages | You page through a history, export a passport or restore it elsewhere. |
| Conformance | [conformance.md](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/conformance.md), layers, roles, the baseline and the ledger | You declare what an implementation supports or make a conformance claim. |
| Background | [design-rationale.md](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/design-rationale.md), design rationale | You want the reasons behind a settled design before proposing a change. Status: informative. |

Next: open the [contracts and schemas](contracts.md) for the interfaces these rules use, or [run the fixtures](../implement/fixture-runner.md) against your own implementation.
