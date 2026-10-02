# Release sets

A release set is a declared combination of package versions, the wire and contract versions they implement, the profiles they carry and a conformance selection: one compatibility target you can pin and check. This page names the current set, shows how to use it and how to verify that the published packages are the approved ones, and lists the earlier sets.

## The current set

| | `dpp-release-2026-10-5` |
|---|---|
| Declaration | `release/dpp-release-2026-10-5.json` |
| Status | Candidate; publication of the overlay package is pending |
| Packages | `@bsv/dpp-core@0.3.0-beta.7`, `@bsv/dpp-overlay-topics@0.4.0-beta.8`, `@bsv/dpp-profiles@0.3.0-beta.7`, `@bsv/vsc@0.2.0-beta.5`, on `@bsv/sdk@2.8.10` and Node 22 |
| Licence | Apache 2.0 |
| npm tag | `latest`, so once it is published a plain install gets these versions; `next` stays at the beta.5 set. Install exact versions all the same |
| Selection | `conformance/selections/dpp-release-2026-10-5.json`, the claims this release requires and withholds ([conformance](conformance.md)) |

Compared with the published beta.7 set `dpp-release-2026-10-4`, an index finds a passport from a GS1 key without a host: `ls_dpp` answers `gs1Key` with every passport whose identifier names that key under any host, under index contract `0.9.0-draft`, and the overlay package now depends on the profiles package for the GS1 parse. Only the overlay package takes a new version. No record, claim, anchor or acceptance format, frozen profile or custody profile changed.

## Use the current set

1. Install the exact versions, as [install from npm](../packages/README.md#install-from-npm) shows, and keep your lockfile. Together they identify the bytes you installed.
2. Before pointing a client at a running service, compare the service's `GET /capabilities` with what the client expects: `implementation.version`, the protocol versions and the profiles. Installing a release does not upgrade any running service, the hosted ones included; each service's capability document says what it runs.
3. To move from an earlier set, rehearse against retained data as [migration](../migration.md) describes, and adopt successor industry profiles separately ([update profiles and consuming applications](../profiles/updating-applications.md)).

These are experimental prereleases: APIs may change significantly during testing, so read the changelog before upgrading. Published versions are immutable, so every change takes a new version. Package versions are separate from the specification, wire-format and frozen profile versions they implement, and installing them establishes neither live interoperability nor production readiness.

## Verify a published release

These steps check that the packages on npm are the bytes the approved plan names, built from a public source revision, and what the ledger claims for them. They need Node 22, npm 11.19.0 and git; each step can be run alone.

1. **Check registry signatures and provenance.** In an empty directory:

   ```sh
   npm init -y
   npm install --save-exact @bsv/dpp-core@0.3.0-beta.4 @bsv/dpp-overlay-topics@0.4.0-beta.4 @bsv/dpp-profiles@0.3.0-beta.4 @bsv/vsc@0.2.0-beta.3
   npm audit signatures
   ```

   It printed `87 packages have verified registry signatures` and `17 packages have verified attestations`; the four DPP packages are among the attested ones, and nothing was reported invalid or missing.

2. **Compare each archive with the approved plan.** From the root of a checkout on `main`, print the registry's integrity for each package and the integrity the [approved plan](beta-4-publication-plan.json) recorded:

   ```sh
   for p in @bsv/dpp-core@0.3.0-beta.4 @bsv/dpp-overlay-topics@0.4.0-beta.4 @bsv/dpp-profiles@0.3.0-beta.4 @bsv/vsc@0.2.0-beta.3; do echo "$p $(npm view "$p" dist.integrity)"; done
   node -e "for (const c of require('./docs/reference/beta-4-publication-plan.json').candidates) console.log(c.name + '@' + c.version, c.integrity)"
   ```

   The two lists must match line for line, starting `@bsv/dpp-core@0.3.0-beta.4 sha512-bSOxqRghWrxsrPY7…`.

3. **Rebuild the plan from the source revision.** Repack from the recorded revision, never from `main`: the packages on `main` have changed since publication, so their archives differ from the published ones. In a fresh clone, and keeping the checkout clean, since any file written inside it changes the plan:

   ```sh
   git clone https://github.com/bsv-blockchain/dpp.git dpp-beta-4
   cd dpp-beta-4
   git checkout --detach f9d8e98658c7cf406702d49194ec5a8480cbca73
   npm ci
   node scripts/release-candidates.mjs release/dpp-release-2026-10.json
   node scripts/publish-candidates.mjs --verify-registry
   node scripts/consumer-check.mjs --registry
   ```

   `publish-candidates.mjs --verify-registry` writes `release/publication-plan.json` and prints `Publication plan SHA-256: ecf6151b4f4dfaba47f9579426fcc3dcb58324b3517cbd36cc4be52c6dff3b51`, the digest the receipt records, then `already-published` for each package and `Every npm tarball matches the candidate bytes.` The written plan is byte-identical to the archived one. `consumer-check.mjs --registry` installs the public versions into a separate project and ends `Every sentence above holds.` None of these commands publishes anything or moves a tag.

4. **Read what the ledger claims.** Run the two checks on [conformance](conformance.md). The selection qualifies and withholds seven claims, among them federated operation, European conformity, battery product qualification and version 1.0 readiness.

The steps above use the values of the published beta.4 set, `dpp-release-2026-10`; to verify another published set, use its receipt, plan and source revision. The receipts of earlier publications have their own verification sections with the same commands at their own revisions.

## Earlier sets

Each earlier set is superseded, and each link opens its JSON at a recorded revision. For the beta.2 to beta.7 sets that is the source revision their approved plans bound, the revision to reproduce those plans from.

| Set | State | Receipt |
|---|---|---|
| [dpp-release-2026-10-4](https://github.com/bsv-blockchain/dpp/blob/25fabf755090442b98c6714abfae54ec48fee029/release/dpp-release-2026-10-4.json) | Superseded; its beta.7 packages (VSC beta.5) were published under `latest` on 2 October 2026 | [Beta.7 publication receipt](beta-7-publication.md) |
| [dpp-release-2026-10-3](https://github.com/bsv-blockchain/dpp/blob/77d53611d884f7d9aa058fe063acb187f77ec9c7/release/dpp-release-2026-10-3.json) | Superseded; its beta.6 packages (VSC beta.5) were published under `latest` on 2 October 2026, the first to `latest` | [Beta.6 publication receipt](beta-6-publication.md) |
| [dpp-release-2026-10-2](https://github.com/bsv-blockchain/dpp/blob/7292237376b8308ed67b11194fd7a00cbe313d82/release/dpp-release-2026-10-2.json) | Superseded; its beta.5 packages (VSC beta.4), the first under Apache 2.0, were published under `next` on 2 October 2026 | [Beta.5 publication receipt](beta-5-publication.md) |
| [dpp-release-2026-10](https://github.com/bsv-blockchain/dpp/blob/f9d8e98658c7cf406702d49194ec5a8480cbca73/release/dpp-release-2026-10.json) | Superseded; its beta.4 packages (VSC beta.3) were published under `next` on 1 October 2026 | [Beta.4 publication receipt](beta-4-publication.md) |
| [dpp-release-2026-09-5](https://github.com/bsv-blockchain/dpp/blob/921a1d36e6a1888ef0d1b08aaf2cf7df54525d81/release/dpp-release-2026-09-5.json) | Superseded; its beta.3 packages were published under `next` on 27 September 2026, with the VSC package unchanged at beta.2 | [Beta.3 publication receipt](beta-3-publication.md) |
| [dpp-release-2026-09-4](https://github.com/bsv-blockchain/dpp/blob/f54e750de4c7731a30563e5f1caad762adbfb737/release/dpp-release-2026-09-4.json) | Superseded; its four beta.2 packages were published under `next` on 18 September 2026 | [Beta.2 publication receipt](beta-2-publication.md) |
| [dpp-release-2026-09-3](https://github.com/bsv-blockchain/dpp/blob/a85a695e584eae6c2b159ccbb542e8ecc7a28f48/release/dpp-release-2026-09-3.json) | Superseded; its beta.1 versions are on npm, published on 10 September 2026; the `latest` tag named them until beta.6 | |
| [dpp-release-2026-09-2](https://github.com/bsv-blockchain/dpp/blob/a85a695e584eae6c2b159ccbb542e8ecc7a28f48/release/dpp-release-2026-09-2.json) | Superseded; its versions were never published | |
| [dpp-release-2026-09](https://github.com/bsv-blockchain/dpp/blob/a85a695e584eae6c2b159ccbb542e8ecc7a28f48/release/dpp-release-2026-09.json) | Superseded; its versions were never published | |

The publications up to beta.5 went to `next` and left `latest` at beta.1; beta.6 was the first to publish to `latest`, as each set's `distTag` now names, `latest` before version 1.0; none promoted the draft industry profiles or declared broader release readiness. Each set's record links its package versions, interfaces, profiles and conformance selection, and keeps its own historical declarations; the [support table](../packages/support-table.md) is generated from the current record.

## How a set is made

The [release tooling](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/release/README.md) packs a set into candidate archives and writes a candidate record, `release/candidates.json`, with the source revision and each archive's digest; a set's name alone is not that revision. [Publish a package update](publishing-profile-updates.md) is the maintainer procedure from candidate to npm.

Next: install the current set with [install the selected release](../packages/README.md), or check what it claims on [conformance](conformance.md).
