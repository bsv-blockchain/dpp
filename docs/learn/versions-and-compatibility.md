# Versions and compatibility

Several parts of a DPP deployment carry their own version: the packages, the record, claim and anchor formats, the index contract, the custody profile and the industry profiles. This page lists each one with its current value and shows where to read it, so you can check that two parts match before you connect to a service or upgrade.

## What carries a version

A release set is one tested combination of all these parts, declared in a file under `release/` ([release sets](../reference/release-sets.md)). The current set is `dpp-release-2026-10-6`, a candidate declared in `release/dpp-release-2026-10-6.json`; the published beta.8 set before it, [`dpp-release-2026-10-5`](https://github.com/bsv-blockchain/dpp/blob/a8db9b6018c61d933596e21797ce2d67ddb5a33e/release/dpp-release-2026-10-5.json), is now superseded. The table gives each part's value in that set, the field of the release-set file that declares it, and the field of an index's `GET /capabilities` answer that advertises it. The two spell some names differently, so the last column gives the exact spelling to look for.

| Part | Current value | Release-set field | Index capability field |
|---|---|---|---|
| Packages | `@bsv/dpp-core@0.3.0-beta.7`, `@bsv/dpp-profiles@0.3.0-beta.7`, `@bsv/dpp-overlay-topics@0.4.0-beta.9`, `@bsv/vsc@0.2.0-beta.5` | `packages` | `implementation`: the index's own package and version |
| Runtime | Node 22 or later, `@bsv/sdk` 2.8.10 | `runtime` | Not advertised |
| Passport records | Version 1 (14 fields) and version 2 (17 fields) | `wire.records` | `protocols`: `dpp-record` version `1` and version `2` |
| Native claim | `dpp-lifecycle-v1` | `wire.nativeClaim` | `representations`: `dpp-lifecycle-json-v1`, the claim's anchored form |
| Anchor | `bsv-attestation-anchor-v1` | `wire.anchor` | `protocols`: `bsv-attestation-anchor` version `1`; `anchorFormats` lists it as `current` |
| Acceptance record | `dpp-managed-acceptance@1` | `wire.acceptanceRecord` | Implied by the custody profile |
| Verification report | Version `1` | `wire.verificationReport` | Not advertised; each report carries `reportVersion` |
| Index contract | `0.9.0-draft` | `wire.overlayContract` | `protocols`: `overlay-http` version `0.9.0-draft` |
| Custody profile | `managed-custody@1` | `custody.selected` | `profiles`: the entry of kind `custody`, id `managed-custody`, version `1`, with its options |
| Industry profiles | Current: `general@2`, `battery@2`, `textile@2`. Drafts: `battery@3`, `battery@4`, `textile@3`, `textile@4` | The frozen manifests in `@bsv/dpp-profiles` | Not advertised by an index; each state's payload declares its own `profile` and `profile_version` |

These numbers move independently. A package prerelease version is not a specification, wire-format or profile version: installing a new package never selects a new record format or industry profile, and never rewrites a stored record. A reader may need both record decoders even when every package it installs comes from one release set, and selecting a draft battery profile does not select a different blockchain format.

## Record versions 1 and 2

| | Version 1 | Version 2 |
|---|---|---|
| Fields | 14 | 17 |
| Operations | Seven lifecycle names: `ACTIVATE`, `SOLD`, `RESOLD`, `REPAIRED`, `RECYCLED`, `EDIT`, `TRANSFER` | Four: `ISSUE`, `UPDATE`, `TRANSFER`, `RETIRE` |
| Control | Proven on a `TRANSFER` only where a profile selects the owner-signed transfer | Proven on every state after the first, for every reader |
| Each state names | The transaction it spends | The output it spends and the lineage's first state |
| Ending a passport | No terminal operation | `RETIRE`, after which nothing can follow |
| Commitment to an authorisation record | None | Field 15, which `managed-custody@1` requires on every `TRANSFER` |

Readers read both with the same call, including a lineage that began as version 1 and continued as version 2. Writers write version 2 for new passports. A version 1 passport continues as version 2 through one `UPDATE` that keeps its controller key, and no version 1 state can ever follow a version 2 state ([migration](../migration.md#start-writing-version-2)).

## Check a service before you connect

Ask the index for its capability document and compare it with what your client reads and writes. This runs anywhere with Node.js 22 or later and network access; set `INDEX_URL` to the index you will use:

```sh
INDEX_URL=https://dpp-overlay.bsvb.net node --input-type=module <<'JS'
const capabilities = await (await fetch(new URL('/capabilities', process.env.INDEX_URL))).json()
const { name, version } = capabilities.implementation
console.log('implementation', name, version)
for (const p of capabilities.protocols) console.log('protocol', p.id, p.version)
for (const p of capabilities.profiles.filter((p) => p.kind === 'custody')) console.log('custody', p.id, p.version, JSON.stringify(p.options))
JS
```

Against an index on the current release, deployed for managed custody (`ACCEPTANCE_COMMITMENT=required`), it prints:

```
implementation @bsv/dpp-overlay-topics 0.4.0-beta.9
protocol dpp-record 1
protocol dpp-record 2
protocol bsv-attestation-anchor 1
protocol overlay-http 0.9.0-draft
custody managed-custody 1 {"acceptanceCommitment":"required","controlAuthorities":[]}
```

Read it this way:

- **Record versions and index contract.** The protocols must include every record version you write and the `overlay-http` version your client speaks.
- **Custody.** `managed-custody` with `acceptanceCommitment: required` refuses a version 2 `TRANSFER` without an acceptance commitment. An index that admits version 2 without one declares `record-model-baseline@2` instead.
- **Implementation.** A service can run an older package release than the current set. The hosted index ran `@bsv/dpp-overlay-topics@0.4.0-beta.3` on 2 October 2026: it reads and writes the same record formats, but it speaks the index contract before this one, so it does not say why it refused a state. Compare what a service advertises, not the release set's name.
- **Publisher keys.** Before you write, check that `publisherPolicy.publisherKeys` names the key your states are countersigned with.

A reachable server can still lack the history, export or profile operation your client needs. [Contracts](../reference/contracts.md) describes the capability request and the operations behind it.

A registry's `GET /capabilities` does not answer this document yet. The hosted registry answers the registry contract's own document, whose `protocol` field reads `attestation-registry/1`, and which document a registry should serve is not settled ([known limitations](../operate/limitations.md)). Read the registry's `protocol` field to check its contract.

## Find the exact definition

| Comparing | Source |
|---|---|
| Record or claim bytes | [Specification index](../reference/specifications.md) |
| A service request or response | [Contracts](../reference/contracts.md) |
| Product fields or a selected profile | [Industry profiles](../profiles/README.md), [interoperability profiles](../interoperability/README.md) |
| Package entry points and runtimes | [Support table](../packages/support-table.md) |
| A complete release selection | [Release sets](../reference/release-sets.md) |

The [conformance source](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/conformance.md) defines the selection and compatibility requirements.

## Next

| You want to | Go to |
|---|---|
| Upgrade packages, start writing version 2, or roll back | [Migration](../migration.md) |
| Adopt a changed industry profile | [Update profiles and consuming applications](../profiles/updating-applications.md) |
| Install the current packages | [Build an application](../packages/build-an-application.md) |
| Implement the formats yourself | [Start an independent implementation](../implement/README.md) |
