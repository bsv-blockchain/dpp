# Versions and compatibility

**Audience:** everyone. **Canonical sources:** [`GOVERNANCE.md`](https://github.com/bsv-blockchain/dpp/blob/main/GOVERNANCE.md), [`spec/conformance.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/conformance.md) §3 and §4, [`release/release-set.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/release/release-set.schema.json).

Several things carry a version, and they are different things. Confusing them is the commonest way to make a false claim, so here they are side by side.

| Identifier | What it versions | Current | Rule |
|---|---|---|---|
| Record version (`dpp/1`, `dpp/2`) | The on-chain state layout and its rules | Both current; version 2 is the recommended write | A reader selects by field count; an unknown version is a refusal, never a guess |
| Anchor prefix (`bsv-attestation-anchor-v1`) | The anchor output layout | v1 | `uora-anchor-v3` historical, `uora-anchor-v2` refused |
| Claim format (`dpp-lifecycle-v1`) | The native claim shape and canonical bytes | v1 | Signed into the claim |
| Acceptance record (`dpp-managed-acceptance@1`) | The custodian-signed acceptance | @1 | Committed to by digest in the transfer |
| Report version (`1`) | The verification report shape | 1 | A reader refuses any other value |
| Package and export formats (`dpp-evidence-package@1`, `dpp-evidence-export@1`, `dpp-publisher-policy@1`) | Portable evidence and policy documents | @1 | Named in the document |
| Overlay contract (`0.7.0-draft`) | The index's HTTP surface | 0.7.0-draft | Named in the capability document |
| Registry contract (`0.2.0`) | The registry's HTTP surface | 0.2.0 | Machine-checked against the reference registry's router |
| Profile version (`battery@2`, `battery@3`) | One industry, exchange, operator or interoperability profile | Named per profile | Independent of the core; a state is read under the version it declares forever |
| Package version (`@bsv/dpp-core 0.3.0`) | One npm package | Per package | Semantic versioning, pre-1.0 |
| Release set (`dpp-release-2026-09-3`) | One compatible set of packages, wire versions, custody profile, runtime and artefact digests | Candidate | A changed wire contract is a new set, never an edit |
| Baseline (`native-baseline@2`) | One recommended selection an implementer follows | @2 | A conformance and documentation selection; changes no byte |
| Standard version (pre-1.0) | The core as a whole | Working draft | Declared by governance under stated conditions |
| Programme milestone (v1.5) | The maintainers' work plan | Not a protocol version | Never presented as a released version of anything above |

## The rules that keep them apart

A layout change is a version change of the layout's own identifier, never a silent revision, and a reader meeting an identifier it does not know refuses rather than guesses: `decode-failed` for a record, `representation-unsupported` for a credential representation, `suite-unsupported` for a proof suite, `not-selected` for a profile the reader did not select. Industry profiles version independently of the core: a profile change does not bump the standard and the reverse. A state issued under a profile version is read under that version for as long as it exists and is never reinterpreted under a newer one.

A release set is a documentation and conformance selection: nothing in it changes a byte, and it is held to the repository by the checker (every package version to its manifest, every wire version to what the reference exports, every artefact digest to its file). Its status moves from candidate to released only when its packages are published under the versions it names, and to superseded when a later set replaces it before that.

## Compatibility a consumer can rely on

Within a release set the four packages are tested together against one runtime: Node 22 or later, `@bsv/sdk` 2.4.2, `@bsv/overlay` 2.3.1 for the index. `@bsv/dpp-overlay-topics` depends on `@bsv/dpp-core` by a caret range on the minor version, and the [support table](../packages/support-table.md) states which entry points exist, which are server-only and what each carries. Across sets, version 1 exports of the core have stayed unchanged since version 2 was added; the [migration guide](../migration.md) records what a consumer changed in code at each set.
