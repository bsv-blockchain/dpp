# Migration

Application teams and index operators can use this guide to rehearse and roll out a package upgrade, record version 2 writes or a new industry profile. Treat each as a separate migration: package upgrades never rewrite existing records.

## Before you start

Record the running configuration and obtain these inputs before changing it:

| Input | Source |
|---|---|
| Recoverable data and old configuration | Retain the environment and lockfiles; [fetch, check and restore an export](operate/export-import-recovery.md#restore-a-passport-from-the-complete-export). |
| Rehearsal environment | A scratch index admitting the live publisher keys; separate old/new source checkouts in an empty working directory. Examples use their own checkout builds. |
| Tools for source commands | Node 22 or later, npm and git; install and build the selected checkout before running examples. Historical reproduction uses the specified revisions, not the current source. |
| Package versions | Your lockfile, or `npm ls @bsv/dpp-protocol @bsv/dpp-core @bsv/dpp-profiles @bsv/dpp-overlay @bsv/dpp-credentials @bsv/sdk` in your project |
| The release set they belong to | [Release sets](reference/release-sets.md) |
| What an index runs and admits | Its `GET /capabilities`: `implementation`, `protocols`, the custody profile and `publisherPolicy` ([check a service before you connect](learn/versions-and-compatibility.md#check-a-service-before-you-connect)) |
| An index's settings | Its environment file: `SERVICE_IDENTITY_KEY`, `PUBLISHER_POLICY_FILE` or `PUBLISHER_POLICY_JSON`, `ACCEPTANCE_COMMITMENT`, `CONTROL_AUTHORITIES` ([run a service](operate/README.md)) |
| The record versions you hold | The operations the reader prints for each passport: version 2 uses `ISSUE`, `UPDATE`, `TRANSFER` and `RETIRE` |
| The profiles your records declare | The `profile` and `profile_version` in each state's public payload |

## Test the November source candidate

`dpp-release-2026-11` is unpublished. Test it with [local candidate archives](packages/README.md#use-the-renamed-source-candidate); the published October set retains its [receipt's versions](reference/beta-11-publication.md).

| Candidate component | Version |
|---|---|
| Protocol and profiles | `0.3.0-beta.10` |
| Overlay | `0.4.0-beta.13` |
| Credentials | `0.2.0-beta.6` |
| Both source starters | `0.1.0-beta.2` |

1. **Upgrade readers first.** Verify `dpp-managed-acceptance@1` with its original direct-signature rule and `@2` with derived keys. Keep historical records and commitments unchanged.
2. **Change custodian signing.** Supply a BRC-100 wallet to `signManagedAcceptance` and `signManagedInstruction` through the state-signing `DataSigner` interface, replacing direct identity-key signing. Acceptance writes only version 2. Both writers use `[1, 'dpp managed record v1']`, `requestId` and counterparty `anyone`. With `ACCEPTANCE_COMMITMENT=required`, the index declares `managed-custody@2`.
3. **Retain authorisation evidence.** Include acceptance and instruction records in evidence packages. Enable `INSTRUCTION_COMMITMENT=required` only when every writer commits to holder instructions for updates/retirement after a committed transfer. Selecting readers and indexes refuse missing commitments. Rehearse transfer, update and retirement using the candidate exercises below.
4. **Update claims and policy.** Native `recordId` is an outpoint, `<txid>:<outputIndex>`; claims may include structured evidence facets. Supply `profilePayloadValidator(ajv)` as the report's `payloadValidator`. Schema checks can fail where published readers returned `unknown`.
5. **Choose write access.** Per-publisher tokens and optional `POST /register` are candidate features. The published index starter copies operator-wide tokens; the source starter issues per-publisher tokens. Review generated configuration, helpers and runtime dependencies ([index starter](packages/create-dpp-index.md#testing-the-source-candidate)).

From the built candidate checkout root, run the [offline exercises](quick-start.md#check-the-test-passports-offline):

```sh
node examples/verify-passport.mjs --fixture --version=2 --report
node examples/lifecycle-v2.mjs
```

Expect no `FAIL:` or `FAILS:` lines and exit status 0. The lifecycle exercise ends `Every sentence above holds.` No wallet, funds or network is needed; fixture inclusion remains pending or `unknown`. Stop on an unexpected failure before changing the deployment.

The [managed-custody specification](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/spec/managed-custody.md) records the signature rules and compatibility boundary. The second implementing party's written acceptance of the version 2 signed shape remains outstanding. Testing these changes does not upgrade the hosted services or establish a completed cross-implementation trial.

## Rename dpp-overlay-topics to dpp-overlay, and vsc to dpp-credentials

The candidate `dpp-release-2026-10-9` renames two packages without behaviour changes:

| Former name and version | New name and version | Unchanged interfaces |
|---|---|---|
| `@bsv/dpp-overlay-topics@0.4.0-beta.11` | `@bsv/dpp-overlay@0.4.0-beta.11`, named for its overlay service | `./server`, `dpp-index`, every export |
| `@bsv/vsc@0.2.0-beta.5` | `@bsv/dpp-credentials@0.2.0-beta.5`, named for credentials it issues/verifies | `./exchange`, `./epcis-source`; wire profile identifiers such as `vsc-draft-compat/0.1.0` |

1. Replace `@bsv/dpp-overlay-topics` with `@bsv/dpp-overlay` and `@bsv/vsc` with `@bsv/dpp-credentials` in dependencies and imports, retaining versions. A generated `@bsv/create-dpp-index` project changes its one dependency.
2. Apply the publication exception: pin overlay beta.12. The names were [published on 16 October 2026](reference/beta-11-publication.md), but the `0.4.0-beta.11` overlay archive differed from approved bytes by one file mode. `dpp-release-2026-10-10` republished the same source as `@bsv/dpp-overlay@0.4.0-beta.12`; no set names beta.11.

Old npm names retain their historical versions, with deprecation notices once new names are published.

## Rename dpp-core to dpp-protocol

The shared library became `@bsv/dpp-protocol@0.3.0-beta.9` in candidate `dpp-release-2026-10-8`. Set `dpp-release-2026-10-10` [published it on 16 October 2026](reference/beta-11-publication.md). Its name covers passport tokens, custody, native lifecycle claims, anchors and evidence verification; implementation moved to `packages/dpp-protocol`.

This breaking rename has no compatibility wrapper: the active release contains only `@bsv/dpp-protocol`. Both starters select it, but generating a project never updates existing projects. Existing generated applications need the same migration as other consumers:

1. Install the selected exact version from npm or [local candidate archives](packages/README.md#use-the-renamed-source-candidate), with matching SDK and DPP versions.
2. Replace `from '@bsv/dpp-core'` with `from '@bsv/dpp-protocol'`, including dynamic imports. Use `@bsv/dpp-protocol/schemas/*` for schemas.
3. Check types, schema loading and passport/claim verification. Retain the lockfile and any local archives.
4. Find remaining consumers with `npm ls --all @bsv/dpp-core`. Upgrade those dependencies; remove direct `@bsv/dpp-core` only when imports no longer use it.

Earlier `@bsv/dpp-core` publications retain their names and bytes; pinned consumers keep them. The rename changes only the package name and dependency graph. Wire bytes, signing protocol identifiers, topics, profiles, passport identifiers and database records stay unchanged. Apply earlier protocol migrations below when upgrading older implementations.

## Upgrade the packages

### From beta.9 to beta.10

| Historical release fact | Value |
|---|---|
| Set | `dpp-release-2026-10-7`, the last published under former names |
| Packages | `@bsv/dpp-core@0.3.0-beta.8` (before [renaming to protocol](#rename-dpp-core-to-dpp-protocol) `@bsv/dpp-protocol`), `@bsv/dpp-profiles@0.3.0-beta.8`, `@bsv/dpp-overlay-topics@0.4.0-beta.10`; unchanged beta.5 VSC |
| Publication/source | `latest`, 9 and 10 October 2026; `1b7a922616f5943f884ec07a39e8b966ecc8a42d` ([receipt](reference/beta-10-publication.md)). Same code under new names since 16 October 2026 ([receipt](reference/beta-11-publication.md)). |
| Protocol change | Reads/writes record version 3, the [token carrier](https://github.com/bsv-blockchain/dpp/blob/1b7a922616f5943f884ec07a39e8b966ecc8a42d/spec/token-carrier.md). `DppState` adds a version; `parseDppOutput` returns the carrier beside the state; `verifyChain` inspections name the token id. |
| Application action | Existing calls compile unchanged. Narrow version 2 and 3 separately where carried lineages arrive (`SeventeenFieldState` covers both): treating every non-2 state as version 1 misreads version 3. Writers stay on version 2 until explicitly building version `3`. |
| Index change | Admits version 3, supports token-id lookup, contract `0.11.0-draft`; declares `single-operator@2` when pulling under a one-operator policy. Discovery, advertising and left-behind retries are [opt-in](operate/federation.md). |
| Dependencies | Protocol and overlay topics pin `@bsv/sdk@2.8.10` exactly. Pin 2.8.10: another SDK creates two copies with incompatible types. Profiles beta.8 adds the `single-operator@2` manifest. |
| Unchanged | Industry, frozen and custody profiles; claim, anchor and acceptance formats |

### From beta.8 to beta.9

| Historical release fact | Value |
|---|---|
| Set/packages | Superseded `dpp-release-2026-10-6`: `@bsv/dpp-overlay-topics@0.4.0-beta.9`; unchanged beta.7 core/profiles and beta.5 VSC |
| Publication/source | `latest`, 3 October 2026; `488baaefb5bda535e360fd1c1895124387408816` ([receipt](reference/beta-9-publication.md)) |
| Change/action | Index contract `0.10.0-draft`; `GET /publisher-policy` serves the signed chain. Readers using `GET /capabilities` keys can now verify those keys and windows. |
| Unchanged | Record, claim, anchor and acceptance formats; frozen and custody profiles |

### From beta.7 to beta.8

| Historical release fact | Value |
|---|---|
| Set/packages | Superseded `dpp-release-2026-10-5`: `@bsv/dpp-overlay-topics@0.4.0-beta.8`; unchanged beta.7 core/profiles and beta.5 VSC |
| Publication/source | `latest`, 2 October 2026; `a8db9b6018c61d933596e21797ce2d67ddb5a33e` ([receipt](reference/beta-8-publication.md)) |
| Index change | An index on it finds a passport from a GS1 key without a host (`ls_dpp` with `gs1Key`); contract `0.9.0-draft`. First start rebuilds stored GS1 keys once. |
| Application action | Embedded overlay now depends on `@bsv/dpp-profiles`; install both. |
| Unchanged | Record, claim, anchor and acceptance formats; frozen and custody profiles |

### From beta.6 to beta.7

| Historical release fact | Value |
|---|---|
| Set/packages | Superseded `dpp-release-2026-10-4`: beta.7 core, overlay topics and profiles; unchanged beta.5 VSC |
| Publication/source | `latest`, 2 October 2026; `25fabf755090442b98c6714abfae54ec48fee029` ([receipt](reference/beta-7-publication.md)) |
| Change/action | Contract `0.8.0-draft`; refused passport states return `X-Admission-Refusal` beside `X-Admission`. Writers need no change but can [report the reason](packages/build-an-application.md#when-the-index-refuses-a-state). `@bsv/dpp-core` adds `linkageReasonCode`; profiles changes only version. |
| Fixture action | Anchor fixture `attestationId` now uses native `urn:sha256:` form. Reread bytes/scripts pinned by a harness. |
| Unchanged | Record, claim, anchor and acceptance formats; frozen and custody profiles |

### From beta.5 to beta.6

| Historical release fact | Value |
|---|---|
| Set/packages | Superseded `dpp-release-2026-10-3`: beta.6 packages, VSC beta.5 |
| Publication/source | `latest`, 2 October 2026; `77d53611d884f7d9aa058fe063acb187f77ec9c7` ([receipt](reference/beta-6-publication.md)) |
| Change/action | Only the publication tag changes, from `next` to `latest`. Install new versions; code, record formats and index are unchanged. |

### From beta.4 to beta.5

| Historical release fact | Value |
|---|---|
| Set/packages | Superseded `dpp-release-2026-10-2`: beta.5 packages, VSC beta.4 |
| Publication/source | 2 October 2026; `7292237376b8308ed67b11194fd7a00cbe313d82` ([receipt](reference/beta-5-publication.md)) |
| Change/action | Only the licence changes: Open BSV License Version 6 to Apache 2.0. Applications need new versions; indexes need no change. Code, record, claim, anchor and acceptance formats are unchanged. |

### From beta.3 to beta.4

| Historical release fact | Value |
|---|---|
| Set/packages | Superseded `dpp-release-2026-10`: beta.4 packages, replacing superseded `dpp-release-2026-09-5` |
| Publication/source | 1 October 2026; `f9d8e98658c7cf406702d49194ec5a8480cbca73` ([receipt](reference/beta-4-publication.md)) |
| Unchanged | Record, claim, anchor and acceptance formats; index contract, frozen and custody profiles |

| Package, from and to | What changes for an application | What changes for an index operator |
|---|---|---|
| `@bsv/dpp-profiles@0.3.0-beta.3` to `0.3.0-beta.4` | Readers `readManifest`, `readPublicPayloadSchema`, `readRestrictedPayloadSchema`, `readConsumerDocument`, `readExchangeProfile`, `readOperatorProfile` and `readInteroperabilityProfile` throw for any identifier the package does not publish before reading files. Earlier readers did not check: use 0.3.0-beta.4 or later. | Nothing |
| `@bsv/dpp-overlay-topics@0.4.0-beta.3` to `0.4.0-beta.4` | Nothing | Predecessors are requested only when a peer's walk reaches the passport output. Once effective, this removes the mining wait for passports funded by another passport's change. It has no effect yet: `@bsv/overlay` up to 2.6.2 omits the reached output, so synchronisation still behaves as beta.3 ([federation](operate/federation.md)). |
| `@bsv/dpp-core@0.3.0-beta.4` and `@bsv/vsc@0.2.0-beta.3` | Package documentation only; no code changed | Nothing |

To upgrade an application:

1. Install the exact new versions of the packages you use, for example in your project directory:

   ```sh
   npm install --save-exact @bsv/dpp-core@0.3.0-beta.4 @bsv/dpp-profiles@0.3.0-beta.4 @bsv/sdk@2.8.10
   ```

   Add `@bsv/vsc@0.2.0-beta.3` or `@bsv/dpp-overlay-topics@0.4.0-beta.4` if you use them. Always name the version.
2. Check each supplied profile identifier, often built from `profile` and `profile_version` such as `general@2`, against `PROFILE_IDS` from `@bsv/dpp-profiles`. Handle the error for other identifiers.
3. Rehearse against retained data ([below](#rehearse-against-retained-data)), then deploy.

For a Compose index, check out the new revision; rebuild/restart with the existing environment and [run a service](operate/README.md)'s `docker compose` command. Verify `GET /capabilities` reports `implementation` version `0.4.0-beta.4`.

### From earlier releases

Apply each step in turn from the release you run. All of these sets are superseded; [release sets](reference/release-sets.md) links each declaration.

| From and to | What changes for an application | What changes for an index operator |
|---|---|---|
| beta.2 to beta.3: `dpp-release-2026-09-4` to `dpp-release-2026-09-5` | Every package now needs `@bsv/sdk` 2.8.10, the version the current wallet toolbox requires. The first version of a publisher policy now governs the history dated before its own issue, through its key windows, so a beta.2 reader can refuse states that beta.3 admits. `@bsv/dpp-credentials` stays at 0.2.0-beta.2. No wire format changes | Synchronisation carries wallet-funded lineages: the index answers `POST /requestForeignGASPNode` for any output of a transaction it holds. Synchronisation holds its checkpoint where an offered output did not arrive, and leaves an output behind after five rounds, naming it once in the log. `PUBLISHER_POLICY_JSON` carries a policy inline. A synchronising node needs `WOC_API_KEY` |
| beta.1 to beta.2: `dpp-release-2026-09-3` to `dpp-release-2026-09-4`. npm's `latest` tag installed beta.1 until beta.6 | `@bsv/sdk` moves to 2.7.1, and to 2.8.10 with beta.3. The draft profiles `battery@4` and `textile@4` arrive beside the unchanged current ones, with `compareProfiles` and `reviewProfileData`. The canonicaliser upgrade changes how values outside JSON are handled, so do not recompute historical signatures over such JavaScript values. No wire format changes | Rebuild with the updated dependencies |
| The second set to the third: `dpp-release-2026-09-2` to `dpp-release-2026-09-3`, the first beta | A client of the index follows the new contract version; the on-chain record formats are unchanged | The HTTP and export interface changes: the index contract moves from `0.6.0-draft` to `0.7.0-draft`, and the index gains the complete export, `GET /evidence-export` |

The [changelog](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/CHANGELOG.md) records each change in full.

## Rehearse against retained data

Compare old and new readers on identical evidence. Unchanged transactions must not acquire different subjects or stronger findings merely because software changed. The worked commands below reproduce beta.3 to beta.4; choose the appropriate revisions for another migration.

1. **Restore a copy into a scratch index.** Start a local index with the Compose preset ([run a service](operate/README.md)), admitting the same publisher keys as the live one, and restore your export into it ([fetch, check and restore an export](operate/export-import-recovery.md#restore-a-passport-from-the-complete-export)). It answers at `http://localhost:8080`.
2. **Run the old reader.** `examples/verify-passport.mjs` uses its checkout builds, not your project's installed packages. From the empty working directory:

   ```sh
   git clone https://github.com/bsv-blockchain/dpp.git dpp-beta-3
   cd dpp-beta-3
   git checkout 921a1d36e6a1888ef0d1b08aaf2cf7df54525d81
   npm ci
   npm run build
   node examples/verify-passport.mjs <passportId> http://localhost:8080 --report > ../report-beta-3.txt
   ```

3. **Run it at the new release**, the same way, from a second checkout at `f9d8e98658c7cf406702d49194ec5a8480cbca73`, writing `../report-beta-4.txt`.
4. **Compare.** `diff report-beta-3.txt report-beta-4.txt` from the working directory should show only `checked at`. Stop and explain changed subjects, findings or missing states before switching.

| Release set | Packages | Source revision |
|---|---|---|
| `dpp-release-2026-10-7` | beta.10 of overlay topics, beta.8 of the protocol library (published as dpp-core) and profiles (VSC beta.5) | `1b7a922616f5943f884ec07a39e8b966ecc8a42d` |
| `dpp-release-2026-10-6` | beta.9 of overlay topics, beta.7 of core and profiles (VSC beta.5) | `488baaefb5bda535e360fd1c1895124387408816` |
| `dpp-release-2026-10-5` | beta.8 of overlay topics, beta.7 of core and profiles (VSC beta.5) | `a8db9b6018c61d933596e21797ce2d67ddb5a33e` |
| `dpp-release-2026-10-4` | beta.7 (VSC beta.5) | `25fabf755090442b98c6714abfae54ec48fee029` |
| `dpp-release-2026-10-3` | beta.6 (VSC beta.5) | `77d53611d884f7d9aa058fe063acb187f77ec9c7` |
| `dpp-release-2026-10-2` | beta.5 (VSC beta.4) | `7292237376b8308ed67b11194fd7a00cbe313d82` |
| `dpp-release-2026-10` | beta.4 (VSC beta.3) | `f9d8e98658c7cf406702d49194ec5a8480cbca73` |
| `dpp-release-2026-09-5` | beta.3 (VSC beta.2) | `921a1d36e6a1888ef0d1b08aaf2cf7df54525d81` |
| `dpp-release-2026-09-4` | beta.2 | `f54e750de4c7731a30563e5f1caad762adbfb737` |

To try the comparison before you have a scratch index, point both runs at the hosted index and a version 2 passport it holds, `node examples/verify-passport.mjs https://dpp.bsvb.net/01/09529530005688/21/E18E296BB180 https://dpp-overlay.bsvb.net --report`. On 2 October 2026, for the version 2 passport then listed on the hosted reference page, the two reports differed only in their `checked at` line.

An application that installs the packages from npm compares its own reader the same way: run it against the scratch index once with the old lockfile and once with the new, and compare the reports. The reader in [build an application](packages/build-an-application.md) step 1 prints one line per check.

Then exercise writing, verification, export and recovery against the scratch index before you switch live traffic.

## Start writing version 2

Change the parts in this order, so that nothing reads or admits a record it does not yet understand:

1. **Readers.** Every package release since the first set reads both record versions with the same call, so a reader on beta.4 needs no change. From a checkout, `node examples/verify-passport.mjs --fixture --version=2` checks the version 2 fixture and the upgrade of the version 1 fixture chain; no line should start `FAIL:`.
2. **The index.** Set `ACCEPTANCE_COMMITMENT=required` (the Compose preset already does), and `CONTROL_AUTHORITIES` if you name control authorities. The published October runtime declares `managed-custody` version `1`; the November source candidate declares version `2`. On the candidate, add `INSTRUCTION_COMMITMENT=required` only once every writer commits to the holder's instruction on each update or retirement after a hand on. Check that `GET /capabilities` names the profile version and options you selected ([candidate migration](#test-the-november-source-candidate)).
3. **Writers.** New passports start with a version 2 `ISSUE` ([build an application](packages/build-an-application.md#3-write-a-passport)). Every later state proves control, and every `TRANSFER` commits to an acceptance record ([custody](learn/custody.md#how-a-managed-transfer-works)).

**Continue a version 1 passport.** Its next state is a version 2 `UPDATE` that spends the version 1 tip, keeps the controller key equal to the version 1 owner key, names the version 1 genesis as its lineage genesis, and proves control like any other `UPDATE` ([record model version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md#L94), "The upgrade"). It needs no acceptance record, because control does not change. A `TRANSFER` or `RETIRE` cannot spend a version 1 tip, and no version 1 state can follow a version 2 state. The packages have no call dedicated to this step: build it as any other version 2 `UPDATE`, with `completeState`. The reference application's own upgrade operation is not public.

## Change a profile selection

Installing definitions does not activate a successor. Read every payload under its declared version and migrate writes separately:

1. Prepare the change report, notify application owners and track interface/backend readiness with [update profiles and consuming applications](profiles/updating-applications.md).
2. Implement readers for retained and proposed versions, update writers and interfaces, and rehearse with representative data.
3. Deploy and verify compatible readers first. Then explicitly enable the selected writer profile through the server and record the activation decision.

[Battery](profiles/battery.md) and [textile](profiles/textile.md) link current and draft manifests.

## Roll back

Keep the pre-change deployment and a recoverable copy of the data until the new release has run cleanly. A software rollback does not undo published transactions: states written under the new release stay on chain. Before you point an older reader at newer records, check that it supports their formats. Use [export and recovery](operate/export-import-recovery.md#back-up-and-restore-a-whole-index) to rehearse replacing a provider.

## Next

| You want to | Go to |
|---|---|
| Check what a service runs before you switch | [Versions and compatibility](learn/versions-and-compatibility.md#check-a-service-before-you-connect) |
| See every release set and its publication | [Release sets](reference/release-sets.md) |
| See what is still open | [Where things stand](start/status.md) and [known limitations](operate/limitations.md) |
