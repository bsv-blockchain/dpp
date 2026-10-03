# Migration

Use this page when you move a running application or index to a new package release, start writing record version 2, or adopt a new industry profile. A package upgrade never rewrites records already written, so plan, rehearse and roll out each of these changes separately.

## Before you start

Write down what each running component uses now, and keep the old configuration and a recoverable copy of the data before you change anything ([fetch, check and restore an export](operate/export-import-recovery.md#restore-a-passport-from-the-complete-export)).

| What | Where to read it |
|---|---|
| Package versions | Your lockfile, or `npm ls @bsv/dpp-core @bsv/dpp-profiles @bsv/dpp-overlay-topics @bsv/vsc @bsv/sdk` in your project |
| The release set they belong to | [Release sets](reference/release-sets.md) |
| What an index runs and admits | Its `GET /capabilities`: `implementation`, `protocols`, the custody profile and `publisherPolicy` ([check a service before you connect](learn/versions-and-compatibility.md#check-a-service-before-you-connect)) |
| An index's settings | Its environment file: `SERVICE_IDENTITY_KEY`, `PUBLISHER_POLICY_FILE` or `PUBLISHER_POLICY_JSON`, `ACCEPTANCE_COMMITMENT`, `CONTROL_AUTHORITIES` ([run a service](operate/README.md)) |
| The record versions you hold | The operations the reader prints for each passport: version 2 uses `ISSUE`, `UPDATE`, `TRANSFER` and `RETIRE` |
| The profiles your records declare | The `profile` and `profile_version` in each state's public payload |

## Upgrade the packages

### From beta.8 to beta.9

The current set, `dpp-release-2026-10-6`, a candidate pending publication, carries `@bsv/dpp-overlay-topics@0.4.0-beta.9` beside the unchanged beta.7 core and profiles and beta.5 VSC. An index on it serves its signed publisher policy on `GET /publisher-policy` and speaks index contract `0.10.0-draft`. A reader that took publisher keys from `GET /capabilities` can verify them and their windows from the chain instead. No record, claim, anchor or acceptance format changed, and neither did the frozen or custody profiles.

### From beta.7 to beta.8

The set `dpp-release-2026-10-5`, now superseded, carries `@bsv/dpp-overlay-topics@0.4.0-beta.8` beside the unchanged beta.7 core and profiles and beta.5 VSC, published under `latest` on 2 October 2026 from source revision `a8db9b6018c61d933596e21797ce2d67ddb5a33e` ([receipt](reference/beta-8-publication.md)). An index on it finds a passport from a GS1 key without a host (`ls_dpp` with `gs1Key`) and speaks index contract `0.9.0-draft`; it rebuilds its records' GS1 keys once at its first start. The overlay package now depends on `@bsv/dpp-profiles`, so an application that embeds it installs both. No record, claim, anchor or acceptance format changed, and neither did the frozen or custody profiles.

### From beta.6 to beta.7

The set `dpp-release-2026-10-4`, now superseded, carries the beta.7 packages of core, overlay topics and profiles, with VSC unchanged at beta.5, published under `latest` on 2 October 2026 from source revision `25fabf755090442b98c6714abfae54ec48fee029` ([receipt](reference/beta-7-publication.md)). An index on beta.7 says why it refused a passport state, in an `X-Admission-Refusal` header beside `X-Admission`, and speaks index contract `0.8.0-draft`. A writer needs no change, and one that reads the new header can report the reason ([when the index refuses a state](packages/build-an-application.md#when-the-index-refuses-a-state)). `@bsv/dpp-core` adds `linkageReasonCode`, and the profiles package changes only its version. No record, claim, anchor or acceptance format changed, and neither did the frozen or custody profiles. The anchor fixture's `attestationId` now has the `urn:sha256:` form of a native claim's identifier, so a harness that pinned the fixture's bytes or its anchor script reads them again.

### From beta.5 to beta.6

The set `dpp-release-2026-10-3`, now superseded, carries the beta.6 packages (VSC beta.5), published under `latest` on 2 October 2026 from source revision `77d53611d884f7d9aa058fe063acb187f77ec9c7` ([receipt](reference/beta-6-publication.md)). The only change is the npm tag the packages publish to, `latest` instead of `next`; nothing in the code, the record formats or the index changed, so an application needs only the new versions.

### From beta.4 to beta.5

The set `dpp-release-2026-10-2`, now superseded, carries the beta.5 packages (VSC beta.4), published on 2 October 2026 from source revision `7292237376b8308ed67b11194fd7a00cbe313d82` ([receipt](reference/beta-5-publication.md)). The only change is the licence: the packages move from the Open BSV License Version 6 to Apache 2.0. No code, record, claim, anchor or acceptance format changed, so an application needs only the new versions and an index needs no change.

### From beta.3 to beta.4

The set `dpp-release-2026-10`, now superseded, carries the beta.4 packages, published on 1 October 2026 from source revision `f9d8e98658c7cf406702d49194ec5a8480cbca73` ([receipt](reference/beta-4-publication.md)). It replaced `dpp-release-2026-09-5`, now superseded. No record, claim, anchor or acceptance format changed, and neither did the index contract, the frozen profiles or the custody profile.

| Package, from and to | What changes for an application | What changes for an index operator |
|---|---|---|
| `@bsv/dpp-profiles@0.3.0-beta.3` to `0.3.0-beta.4` | The profile readers `readManifest`, `readPublicPayloadSchema`, `readRestrictedPayloadSchema`, `readConsumerDocument`, `readExchangeProfile`, `readOperatorProfile` and `readInteroperabilityProfile` now accept only identifiers the package publishes, and throw for any other before reading a file. Earlier versions did not check the identifier, so use 0.3.0-beta.4 or later. | Nothing |
| `@bsv/dpp-overlay-topics@0.4.0-beta.3` to `0.4.0-beta.4` | Nothing | The passport topic asks a synchronising peer for a state's predecessor only when the peer's walk reached that state through its passport output. Once it takes effect, a new passport funded from another passport's change is no longer left behind until it is mined. It has no effect yet: `@bsv/overlay`, up to 2.6.2, does not pass the topic the output its walk reached, so synchronisation behaves as on beta.3 until it does ([federation](operate/federation.md)) |
| `@bsv/dpp-core@0.3.0-beta.4` and `@bsv/vsc@0.2.0-beta.3` | Package documentation only; no code changed | Nothing |

To upgrade an application:

1. Install the exact new versions of the packages you use, for example in your project directory:

   ```sh
   npm install --save-exact @bsv/dpp-core@0.3.0-beta.4 @bsv/dpp-profiles@0.3.0-beta.4 @bsv/sdk@2.8.10
   ```

   Add `@bsv/vsc@0.2.0-beta.3` or `@bsv/dpp-overlay-topics@0.4.0-beta.4` if you use them. Always name the version.
2. Find every place that passes a profile identifier to a profile reader, typically one built from the `profile` and `profile_version` a record declares, such as `general@2`. Check the identifier against `PROFILE_IDS` from `@bsv/dpp-profiles` before you pass it, and handle the error the reader now throws for any other.
3. Rehearse against retained data ([below](#rehearse-against-retained-data)), then deploy.

To upgrade an index built with the Compose preset, check out the new source revision in your checkout, then rebuild and restart it with the same environment file and the `docker compose` command in [run a service](operate/README.md). Check that the `implementation` in its `GET /capabilities` now reads version `0.4.0-beta.4`.

### From earlier releases

Apply each step in turn from the release you run. All of these sets are superseded; [release sets](reference/release-sets.md) links each declaration.

| From and to | What changes for an application | What changes for an index operator |
|---|---|---|
| beta.2 to beta.3: `dpp-release-2026-09-4` to `dpp-release-2026-09-5` | Every package now needs `@bsv/sdk` 2.8.10, the version the current wallet toolbox requires. The first version of a publisher policy now governs the history dated before its own issue, through its key windows, so a beta.2 reader can refuse states that beta.3 admits. `@bsv/vsc` stays at 0.2.0-beta.2. No wire format changes | Synchronisation carries wallet-funded lineages: the index answers `POST /requestForeignGASPNode` for any output of a transaction it holds. Synchronisation holds its checkpoint where an offered output did not arrive, and leaves an output behind after five rounds, naming it once in the log. `PUBLISHER_POLICY_JSON` carries a policy inline. A synchronising node needs `WOC_API_KEY` |
| beta.1 to beta.2: `dpp-release-2026-09-3` to `dpp-release-2026-09-4`. npm's `latest` tag installed beta.1 until beta.6 | `@bsv/sdk` moves to 2.7.1, and to 2.8.10 with beta.3. The draft profiles `battery@4` and `textile@4` arrive beside the unchanged current ones, with `compareProfiles` and `reviewProfileData`. The canonicaliser upgrade changes how values outside JSON are handled, so do not recompute historical signatures over such JavaScript values. No wire format changes | Rebuild with the updated dependencies |
| The second set to the third: `dpp-release-2026-09-2` to `dpp-release-2026-09-3`, the first beta | A client of the index follows the new contract version; the on-chain record formats are unchanged | The HTTP and export interface changes: the index contract moves from `0.6.0-draft` to `0.7.0-draft`, and the index gains the complete export, `GET /evidence-export` |

The [changelog](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/CHANGELOG.md) records each change in full.

## Rehearse against retained data

Compare what your reader reports on the same evidence under the old release and the new one. An unchanged transaction must not acquire a different subject or a stronger finding because the software changed.

1. **Restore a copy into a scratch index.** Start a local index with the Compose preset ([run a service](operate/README.md)), admitting the same publisher keys as the live one, and restore your export into it ([fetch, check and restore an export](operate/export-import-recovery.md#restore-a-passport-from-the-complete-export)). It answers at `http://localhost:8080`.
2. **Run the reader at the old release.** `examples/verify-passport.mjs` uses the packages built in its own checkout, not packages installed in your project, so run it from a checkout at the old set's source revision. In an empty working directory:

   ```sh
   git clone https://github.com/bsv-blockchain/dpp.git dpp-beta-3
   cd dpp-beta-3
   git checkout 921a1d36e6a1888ef0d1b08aaf2cf7df54525d81
   npm ci
   npm run build
   node examples/verify-passport.mjs <passportId> http://localhost:8080 --report > ../report-beta-3.txt
   ```

3. **Run it at the new release**, the same way, from a second checkout at `f9d8e98658c7cf406702d49194ec5a8480cbca73`, writing `../report-beta-4.txt`.
4. **Compare.** From the working directory, `diff report-beta-3.txt report-beta-4.txt` should show only the `checked at` line. Explain any other difference before you switch: a changed subject, a check that changed its answer, or a missing state.

| Release set | Packages | Source revision |
|---|---|---|
| `dpp-release-2026-10-5` | beta.8 of overlay topics, beta.7 of core and profiles (VSC beta.5) | `a8db9b6018c61d933596e21797ce2d67ddb5a33e` |
| `dpp-release-2026-10-4` | beta.7 (VSC beta.5) | `25fabf755090442b98c6714abfae54ec48fee029` |
| `dpp-release-2026-10-3` | beta.6 (VSC beta.5) | `77d53611d884f7d9aa058fe063acb187f77ec9c7` |
| `dpp-release-2026-10-2` | beta.5 (VSC beta.4) | `7292237376b8308ed67b11194fd7a00cbe313d82` |
| `dpp-release-2026-10` | beta.4 (VSC beta.3) | `f9d8e98658c7cf406702d49194ec5a8480cbca73` |
| `dpp-release-2026-09-5` | beta.3 (VSC beta.2) | `921a1d36e6a1888ef0d1b08aaf2cf7df54525d81` |
| `dpp-release-2026-09-4` | beta.2 | `f54e750de4c7731a30563e5f1caad762adbfb737` |

To try the comparison before you have a scratch index, point both runs at the hosted index and its version 2 passport, `node examples/verify-passport.mjs https://id.gs1.org/01/09506000134352/21/345A8EAF501F https://dpp-overlay.bsvb.net --report`. On 2 October 2026 the two reports differed only in their `checked at` line.

An application that installs the packages from npm compares its own reader the same way: run it against the scratch index once with the old lockfile and once with the new, and compare the reports. The reader in [build an application](packages/build-an-application.md) step 1 prints one line per check.

Then exercise writing, verification, export and recovery against the scratch index before you switch live traffic.

## Start writing version 2

Change the parts in this order, so that nothing reads or admits a record it does not yet understand:

1. **Readers.** Every package release since the first set reads both record versions with the same call, so a reader on beta.4 needs no change. From a checkout, `node examples/verify-passport.mjs --fixture --version=2` checks the version 2 fixture and the upgrade of the version 1 fixture chain; no line should start `FAIL:`.
2. **The index.** Set `ACCEPTANCE_COMMITMENT=required` so it applies `managed-custody@1` (the Compose preset already does), and `CONTROL_AUTHORITIES` if you name control authorities. Check that `GET /capabilities` lists `managed-custody` version `1` with `acceptanceCommitment: required`.
3. **Writers.** New passports start with a version 2 `ISSUE` ([build an application](packages/build-an-application.md#3-write-a-passport)). Every later state proves control, and every `TRANSFER` commits to an acceptance record ([custody](learn/custody.md#how-a-managed-transfer-works)).

**Continue a version 1 passport.** Its next state is a version 2 `UPDATE` that spends the version 1 tip, keeps the controller key equal to the version 1 owner key, names the version 1 genesis as its lineage genesis, and proves control like any other `UPDATE` ([record model version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md#L94), "The upgrade"). It needs no acceptance record, because control does not change. A `TRANSFER` or `RETIRE` cannot spend a version 1 tip, and no version 1 state can follow a version 2 state. The packages have no call dedicated to this step: build it as any other version 2 `UPDATE`, with `completeState`. The reference application's own upgrade operation is not public.

## Change a profile selection

Installing a package and activating a successor profile are separate steps. A payload is read under the profile version it declares, so changing the profile you write is its own migration. Use [update profiles and consuming applications](profiles/updating-applications.md) to prepare the change report, notify application owners and track interface and backend readiness. [Battery](profiles/battery.md) and [textile](profiles/textile.md) link their current and draft manifests.

## Roll back

Keep the pre-change deployment and a recoverable copy of the data until the new release has run cleanly. A software rollback does not undo published transactions: states written under the new release stay on chain. Before you point an older reader at newer records, check that it supports their formats. Use [export and recovery](operate/export-import-recovery.md#back-up-and-restore-a-whole-index) to rehearse replacing a provider.

## Next

| You want to | Go to |
|---|---|
| Check what a service runs before you switch | [Versions and compatibility](learn/versions-and-compatibility.md#check-a-service-before-you-connect) |
| See every release set and its publication | [Release sets](reference/release-sets.md) |
| See what is still open | [Where things stand](start/status.md) and [known limitations](operate/limitations.md) |
