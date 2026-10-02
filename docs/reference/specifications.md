# Specification index

This page lists the specification documents, grouped by subject, with when to read each. It is for implementers who need the exact rules behind a guide; the guides themselves start from the [passport model](../start/architecture.md), the [quick start](../quick-start.md) and the [implementer start](../implement/README.md).

## What is normative

Once published, the contents of `spec/`, `contracts/` and `fixtures/` are normative: an implementation conforms to them or it does not ([governance](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/GOVERNANCE.md#what-is-normative)). Every document below is a working draft before version 1.0 unless its status says otherwise. While the draft is before 1.0, the reference implementation breaks ties between the text and the code, except where the specification names a defect. The [contracts page](contracts.md) maps the machine-readable interfaces, and [conformance](conformance.md) explains the requirement ledger.

If a fixture disagrees with the text, keep the failing input and both readings, and report it as [report a disagreement](../contribute/disagreements.md) describes. The [fixture guide](../implement/fixture-runner.md#source-gaps) lists the known conflicts; the documentation does not silently choose a new rule.

## The documents

| Group | Document | Read when |
|---|---|---|
| Records | [record-model-v2.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md), the record model, version 2 | You write new passports: version 2 is the seventeen-field layout new states use. |
| Records | [record-model.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md), the record model, version 1 | You read existing passports: readers still verify version 1, and version 2 builds on it. |
| Records | [writing.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/writing.md), the writer's lifecycle | You write states: the order of check, announce and send, and the duties to prove and keep. |
| Records | [verification.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md), one verification contract | You read passports: the report's checks and the four answers each can give. |
| Records | [services.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/services.md), service roles and verification boundaries | You run or call an index or registry: publisher policy, admission and synchronisation. |
| Claims | [rules.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md), attestations and complete-representation anchors | You sign, anchor or verify a lifecycle claim. |
| Claims | [legacy-uora-anchor-v3.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/legacy-uora-anchor-v3.md), historical native claims and anchor v3 | You read claims written in the historical format. Status: historical; new writes use the current rules. |
| Custody | [custody.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/custody.md), where the keys may live | You decide who holds a passport's keys, or support the owner-signed transfer. |
| Custody | [managed-custody.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/managed-custody.md), the `managed-custody@1` profile | A custodian holds the keys for the parties and a recipient accepts without a wallet. |
| Identity | [identity.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/identity.md), identity, control and application boundaries | You separate product identity, signing keys and control authority. |
| Profiles | [profiles.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/profiles.md), profiles and identifiers | You choose, check or publish an industry profile, or relate model, batch and item identifiers. |
| Profiles | [passport-projections.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/passport-projections.md), sources, projections and publication | You derive a passport's facts from source records under a named policy. |
| Interoperability | [gs1-discovery.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/gs1-discovery.md), the `gs1-digital-link@1` profile | You resolve a GS1 Digital Link to a passport. Status: proposed. |
| Interoperability | [exchange.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/exchange.md), exchange profiles | You carry passport evidence in a credential format beside the native record. |
| Interoperability | [external-credential-profile.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/external-credential-profile.md), `vc-di-ecdsa-rdfc-2019@1` | You verify a W3C credential another party issued and committed on chain. |
| Interoperability | [epcis-interoperability.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/epcis-interoperability.md), EPCIS source exchange and mapping | You take in or map GS1 EPCIS 2.0.1 event data. |
| Interoperability | [vsc-profile.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/vsc-profile.md), the VSC draft compatibility profile | You use the Verifiable Supply Chain (VSC) credential subset. Status: implementation draft, not a W3C standard. |
| Evidence | [portable-evidence.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/portable-evidence.md), complete pages and packages | You page through a history, export a passport or restore it elsewhere. |
| Conformance | [conformance.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/conformance.md), layers, roles, the baseline and the ledger | You declare what an implementation supports or make a conformance claim. |
| Background | [design-rationale.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/design-rationale.md), design rationale | You want the reasons behind a settled design before proposing a change. Status: informative. |

Next: open the [contracts and schemas](contracts.md) for the interfaces these rules use, or [run the fixtures](../implement/fixture-runner.md) against your own implementation.
