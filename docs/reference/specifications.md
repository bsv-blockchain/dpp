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
| Normative material | Once published, `spec/`, `contracts/` and `fixtures/` are normative: an implementation conforms or does not ([governance](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/GOVERNANCE.md#what-is-normative)) |
| Document status | Working draft before version 1.0 unless the document says otherwise |
| Text/code disagreement before 1.0 | Reference implementation breaks the tie, except where the specification names a defect |

The [contracts page](contracts.md) maps machine-readable interfaces; [conformance](conformance.md) explains the requirement ledger.

If a fixture disagrees with text, retain the input, both readings and selected revision; [report the disagreement](../contribute/disagreements.md). The [fixture guide](../implement/fixture-runner.md#source-gaps) lists known conflicts. Documentation does not silently choose a new rule.

## The documents

| Group | Document | Read when |
|---|---|---|
| Records | [record-model-v2.md](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/spec/record-model-v2.md), the record model, version 2 | You write new passports: version 2 is the seventeen-field layout new states use. |
| Records | [record-model.md](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/record-model.md), the record model, version 1 | You read existing passports: readers still verify version 1, and version 2 builds on it. |
| Records | [writing.md](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/writing.md), the writer's lifecycle | You write states: the order of check, announce and send, and the duties to prove and keep. |
| Records | [verification.md](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/verification.md), one verification contract | You read passports: the report's checks and the four answers each can give. |
| Records | [services.md](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/services.md), service roles and verification boundaries | You run or call an index or registry: admission, the flat publisher key list and the signed registration request. The publisher policy chain, write tokens, registration operations and synchronisation are the overlay package's, documented with it. |
| Claims | [rules.md](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/rules.md), attestations and complete-representation anchors | You sign, anchor or verify a lifecycle claim. |
| Claims | [legacy-uora-anchor-v3.md](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/spec/legacy-uora-anchor-v3.md), historical native claims and anchor v3 | You read claims written in the historical format. Status: historical; new writes use the current rules. |
| Custody | [custody.md](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/custody.md), where the keys may live | You decide who holds a passport's keys. |
| Custody | [managed-custody.md](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/managed-custody.md), the `managed-custody@2` profile | A custodian holds the keys for the parties and a recipient accepts without a wallet. |
| Identity | [identity.md](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/identity.md), identity, control and application boundaries | You separate product identity, signing keys and control authority. |
| Profiles | [profiles.md](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/profiles.md), profiles and identifiers | You choose, check or publish an industry profile, or relate model, batch and item identifiers. |
| Interoperability | [gs1-discovery.md](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/spec/gs1-discovery.md), the `gs1-digital-link@1` profile | You mint or read GS1 Digital Link identifiers: the DPP identifier rules, citing GS1-Conformant Resolver 1.2.1 and GS1 Digital Link URI Syntax 1.7.0 for resolution, link types and linksets. Status: proposed. |
| Interoperability | [exchange.md](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/exchange.md), exchange profiles | You carry passport evidence in a credential format beside the native record. |
| Interoperability | [external-credential-profile.md](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/external-credential-profile.md), `vc-di-ecdsa-rdfc-2019@1` | You verify a W3C credential another party issued and committed on chain. |
| Interoperability | [epcis-interoperability.md](https://github.com/bsv-blockchain/dpp/blob/fc73e35145d19c802c4cd566b4396f5a2b79a75b/spec/epcis-interoperability.md), EPCIS source exchange and the parked mapping to SEALs | You take in GS1 EPCIS 2.0.1 event data. |
| Interoperability | `spec/epcis-event-profile.md`, `epcis-event-vc@1` | You sign the EPCIS events you observed, or verify and anchor another party's. Status: proposed. |
| Evidence | [portable-evidence.md](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/spec/portable-evidence.md), complete pages and packages | You page through a history, export a passport or restore it elsewhere. |
| Conformance | [conformance.md](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/conformance.md), layers, roles, the baseline and the ledger | You declare what an implementation supports or make a conformance claim. |
| Background | [design-rationale.md](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/design-rationale.md), design rationale | You want the reasons behind a settled design before proposing a change. Status: informative. |

## Parked: specifications outside the standard

These are kept for records written under them and for the material that names them. Nothing in them is a requirement.

| Group | Document | Status |
|---|---|---|
| Records | [token-carrier.md](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/token-carrier.md), the token carrier, record version 3 | Status: parked outside the standard on 12 November 2026; nothing reads or writes it, and the [parked material](parked/token-carrier/README.md) keeps the text and fixtures. |
| Profiles | [passport-projections.md](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/passport-projections.md), sources, projections and publication | Status: parked outside the standard on 12 November 2026; the projection helpers stay in `@bsv/dpp-profiles` as reference code, the manifest format 2 rules and shared shapes moved into `profiles.md`, and the [parked material](parked/passport-projections/README.md) keeps the text. |
| Interoperability | [vsc-profile.md](https://github.com/bsv-blockchain/dpp/blob/fc73e35145d19c802c4cd566b4396f5a2b79a75b/spec/vsc-profile.md), the VSC draft compatibility profile | Status: parked on 9 November 2026, required by no release, and out of `@bsv/dpp-credentials` from 0.2.0-beta.6; an implementation draft of the Verifiable Supply Chain (VSC) credential subset, not a W3C standard. It stays in `spec/` because frozen material names it. |

Next: open the [contracts and schemas](contracts.md) for the interfaces these rules use, or [run the fixtures](../implement/fixture-runner.md) against your own implementation.
