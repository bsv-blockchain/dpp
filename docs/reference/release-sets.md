# Release sets

A release set is a declared combination of package versions, wire and contract versions, profiles and a conformance selection: one compatibility target you can pin and check. Use the current candidate for source development, or a publication receipt to reproduce an already published set.

## The current set

| | `dpp-release-2026-10-8` |
|---|---|
| Declaration | `release/dpp-release-2026-10-8.json`; its source revision is recorded when a publication plan binds it |
| Status | Candidate. The renamed protocol package, compatibility wrapper and changed consumers are not yet published |
| Main packages | `@bsv/dpp-protocol@0.3.0-beta.9`, `@bsv/dpp-overlay-topics@0.4.0-beta.11`, `@bsv/dpp-profiles@0.3.0-beta.9`, `@bsv/vsc@0.2.0-beta.5`, on `@bsv/sdk@2.8.10` and Node 22 |
| Compatibility package | `@bsv/dpp-core@0.3.0-beta.9`, which re-exports the protocol library and retains the old schema paths |
| Licence | Apache 2.0 |
| Intended npm tag | `latest` when published; install exact versions and retain the lockfile |
| Source revision | Recorded at publication |
| Receipt | None for this candidate. The [beta.9 receipt](beta-9-publication.md) records the last complete publication documented here |
| Selection | `conformance/selections/dpp-release-2026-10-8.json`, retaining the claims required and withheld by the preceding candidate ([conformance](conformance.md)) |

Compared with the superseded `dpp-release-2026-10-7`, this set renames the shared library to `@bsv/dpp-protocol`, adds the `@bsv/dpp-core` compatibility wrapper and updates the consuming packages. It keeps the same record versions, signing rules, claim and anchor formats, profiles and index contract `0.11.0-draft`. See [migrate the package name](../migration.md#rename-dpp-core-to-dpp-protocol).

The preceding candidate introduced record version 3, the token carrier: a seventeen-field body behind a BRC-162 token prefix, representing one unit ([the specification](https://github.com/bsv-blockchain/dpp/blob/647d6eb38ffe3eacab05b5784a2a4393f63a92e0/spec/token-carrier.md)). Versions 1 and 2 remain readable. It also added optional index discovery, advertising and retries ([federation](../operate/federation.md)), and the `single-operator@2` operator profile. Those changes remain part of this candidate; the package rename adds no wire-format change.

## Use the current set

1. [Build and install the local candidate archives](../packages/README.md#use-the-renamed-source-candidate). The new name is not yet on npm.
2. Record package versions, source revision and lockfile alongside the configuration of each service you run or use.
3. Review the [migration guide](../migration.md) before upgrading an existing deployment. Installing a new profile package does not activate a new writer profile ([updating applications](../profiles/updating-applications.md)).

These are experimental prereleases: APIs may change during testing. Package versions are separate from specification, wire-format and frozen profile versions. Publication and installation establish neither deployed interoperability nor production readiness.

## Verify a published release

For a published set, follow its [publication receipt's verification steps](beta-9-publication.md#verification), using the recorded source revision and toolchain. The current candidate has no publication receipt yet.

The worked example below reproduces the historical beta.4 publication. Its package versions and source revision belong to that archived set.

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

[Release history](release-history.md) lists the superseded sets and links to their publication receipts, approved plans and recorded source revisions. Use those records when checking an older installation or reproducing an earlier publication.

## How a set is made

The [release tooling](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/release/README.md) packs a set into candidate archives and writes a candidate record, `release/candidates.json`, with the source revision and each archive's digest; a set's name alone is not that revision. [Publish a package update](publishing-profile-updates.md) is the maintainer procedure from candidate to npm.

Next: install the current set with [install the selected release](../packages/README.md), or check what it claims on [conformance](conformance.md).
