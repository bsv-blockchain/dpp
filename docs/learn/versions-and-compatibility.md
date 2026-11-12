# Versions and compatibility

Application developers and service operators can use this page to compare DPP versions before connecting or upgrading. Check packages, record, claim and anchor formats, the index contract, custody and industry profiles separately; the tables show each value and where to find it.

## Before you start

| Input | Where to get it |
|---|---|
| Client versions and operations | Your installed packages, selected release and application configuration: what the client reads and writes. |
| Target index URL | The operator of the index you will use. Set it in `INDEX_URL`; the example supplies the hosted reference URL. |
| Runtime for the capability check | Node.js 22 or later and network access, from any directory. |

## What carries a version

A [release set](../reference/release-sets.md) is one tested combination, declared under `release/`.

| Scope | Set and source |
|---|---|
| Current source candidate | `dpp-release-2026-11`, declared in `release/dpp-release-2026-11.json`; not yet published. |
| Last published set | `dpp-release-2026-10-10`, published on 16 October 2026. The [beta.11 receipt](../reference/publication-history/beta-11-publication.md) preserves its approved plan and source revision. |

The candidate inventory below gives each release-set field and the exact spelling in an index's `GET /capabilities` answer.

| Part | Current value | Release-set field | Index capability field |
|---|---|---|---|
| Packages | `@bsv/dpp-protocol@0.3.0-beta.10`, `@bsv/dpp-profiles@0.3.0-beta.10`, `@bsv/dpp-overlay@0.4.0-beta.13`, `@bsv/dpp-credentials@0.2.0-beta.6` | `packages` | `implementation`: the index's own package and version |
| Runtime | Node 22 or later, `@bsv/sdk` 2.8.10 | `runtime` | Not advertised |
| Passport records | Version 1 (14 fields) and version 2 (17 fields); version 3, the token carrier, is [parked](../reference/parked/token-carrier/README.md) | `wire.records` | `protocols`: `dpp-record` version `1` and version `2` |
| Native claim | `dpp-lifecycle-v1` | `wire.nativeClaim` | `representations`: `dpp-lifecycle-json-v1`, the claim's anchored form |
| Anchor | `bsv-attestation-anchor-v1` | `wire.anchor` | `protocols`: `bsv-attestation-anchor` version `1`; `anchorFormats` lists it as `current` |
| Acceptance record | `dpp-managed-acceptance@2`; a reader also reads `dpp-managed-acceptance@1` under its superseded rule | `wire.acceptanceRecord` | Implied by the custody profile |
| Verification report | Version `2`; the published sets name version `1` | `wire.verificationReport` | Not advertised; each report carries `reportVersion` |
| Index contract | `0.14.0-draft` | `wire.overlayContract` | `protocols`: `overlay-http` version `0.14.0-draft` |
| Custody profile | `managed-custody@2`; the published October set selects `managed-custody@1` | `custody.selected` | `profiles`: the entry of kind `custody`, id `managed-custody`, version `2`, with its options |
| Industry profiles | Current: `general@2`, `battery@2`, `textile@2`. Draft: `battery@4`. Parked drafts, still readable: `battery@3`, `textile@3`, `textile@4` | The frozen manifests in `@bsv/dpp-profiles` | Not advertised by an index; each state's payload declares its own `profile` and `profile_version` |

Versions move independently. Installing a package never selects a record format or industry profile, or rewrites stored records. Its prerelease number is not a specification, wire-format or profile version. A reader may need both record decoders within one release set; a draft battery profile does not select a different blockchain format.

## Record versions 1 and 2

| | Version 1 | Version 2 |
|---|---|---|
| Fields | 14 | 17 |
| Operations | Seven lifecycle names: `ACTIVATE`, `SOLD`, `RESOLD`, `REPAIRED`, `RECYCLED`, `EDIT`, `TRANSFER` | Four: `ISSUE`, `UPDATE`, `TRANSFER`, `RETIRE` |
| Control | Not proven: a `TRANSFER` that spends the tip is valid whoever signs it | Proven on every state after the first, for every reader |
| Each state names | The transaction it spends | The output it spends and the lineage's first state |
| Ending a passport | No terminal operation | `RETIRE`, after which nothing can follow |
| Commitment to an authorisation record | None | Field 15, which the managed custody profile requires on every `TRANSFER` |

The same reader call handles versions 1 and 2, including a lineage that changes from version 1 to 2. Record version 3, the token carrier, is parked outside the standard ([parked material](../reference/parked/token-carrier/README.md)). Writers write version 2 for new passports. Continue a version 1 passport as version 2 through one `UPDATE` that keeps its controller key. No version 1 state can follow version 2 ([migration](../migration.md#start-writing-version-2)).

## Check a service before you connect

1. Set `INDEX_URL` to your target and request its capability document:

```sh
INDEX_URL=https://dpp-overlay.bsvb.net node --input-type=module <<'JS'
const capabilities = await (await fetch(new URL('/capabilities', process.env.INDEX_URL))).json()
const { name, version } = capabilities.implementation
console.log('implementation', name, version)
for (const p of capabilities.protocols) console.log('protocol', p.id, p.version)
for (const p of capabilities.profiles.filter((p) => p.kind === 'custody')) console.log('custody', p.id, p.version, JSON.stringify(p.options))
JS
```

Against an index built from the current checkout, deployed for managed custody (`ACCEPTANCE_COMMITMENT=required`), it prints:

```
implementation @bsv/dpp-overlay 0.4.0-beta.13
protocol dpp-record 1
protocol dpp-record 2
protocol bsv-attestation-anchor 1
protocol overlay-http 0.14.0-draft
custody managed-custody 2 {"acceptanceCommitment":"required","controlAuthorities":[]}
```

2. Compare the advertised capabilities with your client. Stop before using an operation that does not match.

| Check | Match required | Mismatch or limit |
|---|---|---|
| Record versions and contract | Protocols include every record version you write and your client's `overlay-http` version. | An index on a published overlay from beta.10 to beta.12 also prints `dpp-record` version `3`, the token carrier, which is now parked: write no version 3 state to it. The published beta.9 index prints an earlier contract. |
| Custody | Match your transfer workflow to the selected profile. | `managed-custody` with `acceptanceCommitment: required` refuses a version 2 `TRANSFER` without an acceptance commitment. An index admitting version 2 without one declares `record-model-baseline@2`. |
| Publisher key | Before writing, find your countersigning key in `publisherPolicy.publisherKeys`. | A missing key blocks this write workflow. |
| Implementation | Compare advertised capabilities, not the release-set name. | Services can run older packages. Until 3 October 2026, the hosted `@bsv/dpp-overlay@0.4.0-beta.3` read and wrote the same record formats but used an earlier contract: no refusal reasons or GS1 key lookup. |

3. Check required history, export and profile operations in [Contracts](../reference/contracts.md). Reachability alone does not establish support; that guide defines the capability request and operations.

For a registry, read `protocol` to check its contract. Its `GET /capabilities` does not yet return the index document: the hosted registry returns its own contract document with `attestation-registry/1`. Which document a registry should serve remains unsettled ([known limitations](../operate/limitations.md)).

## Find the exact definition

| Comparing | Source |
|---|---|
| Record or claim bytes | [Specification index](../reference/specifications.md) |
| A service request or response | [Contracts](../reference/contracts.md) |
| Product fields or a selected profile | [Industry profiles](../profiles/README.md), [interoperability profiles](../interoperability/README.md) |
| Package entry points and runtimes | [Support table](../packages/support-table.md) |
| A complete release selection | [Release sets](../reference/release-sets.md) |

The [conformance source](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/spec/conformance.md) defines the selection and compatibility requirements.

## Next

| You want to | Go to |
|---|---|
| Upgrade packages, start writing version 2, or roll back | [Migration](../migration.md) |
| Adopt a changed industry profile | [Update profiles and consuming applications](../profiles/updating-applications.md) |
| Install the current packages | [Build an application](../packages/build-an-application.md) |
| Implement the formats yourself | [Start an independent implementation](../implement/README.md) |
