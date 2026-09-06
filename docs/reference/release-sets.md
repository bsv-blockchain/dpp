# Release sets and package compatibility

**Canonical sources:** [`release/README.md`](https://github.com/bsv-blockchain/dpp/blob/main/release/README.md), [`release/release-set.schema.json`](https://github.com/bsv-blockchain/dpp/blob/main/release/release-set.schema.json), the set files under `release/`.

| Set | Status | Packages | Wire | What changed |
|---|---|---|---|---|
| `dpp-release-2026-09` | Superseded | core 0.3.0, overlay 0.3.0, profiles 0.2.0, vsc 0.1.1 | Records 1 and 2, overlay 0.5.0-draft | Record version 2, managed custody, the stack baseline (Node 22, sdk 2.4.2, overlay 2.3.1), the release set itself |
| `dpp-release-2026-09-2` | Superseded | core 0.3.0, overlay 0.3.0, profiles 0.3.0, vsc 0.2.0 | Unchanged; overlay 0.6.0-draft | The four interoperability profiles, the draft `battery@3` and `textile@3`, the `./exchange` and `./epcis-source` entry points |
| `dpp-release-2026-09-3` | **Candidate** | core 0.3.0, overlay 0.4.0, profiles 0.3.0, vsc 0.2.0 | Unchanged; overlay 0.7.0-draft | The complete export, the selected-claim qualification, and (in preparation) the support declarations and the bound release pipeline |

A set is a documentation and conformance selection: nothing in it changes a byte, and a changed wire contract or profile is a new identifier. A set moves to `released` only when its packages are published under the versions it names, and to `superseded` when a later set replaces it first; a superseded set keeps its recorded digests as history and is no longer held to the tree.

## What a set binds

The package versions to their manifests; the wire versions to what the reference exports; the runtime (Node, `@bsv/sdk`, `@bsv/overlay`, MongoDB, the application's wallet client) to what is installed; the custody profile the reference selects; the artefact digests of the baseline, contracts and frozen profiles; the support declaration of every entry point to the built code; the selection that qualifies it to the ledger; the image tag; and the consumers and the form in which they consume. `node conformance/check.mjs` holds all of it.

## Candidates

`node scripts/release-candidates.mjs` packs the four tarballs and records each one's SHA-256 and npm integrity beside the source revision, the set file's digest, the selection and the image tag, in `release/candidates.json`. `node scripts/consumer-check.mjs` holds the tarballs to that record before installing them in a clean project. The candidates of the current set at the reviewed revision are what the reference consumers are aligned to; the [support table](../packages/support-table.md) is what each entry point promises.
