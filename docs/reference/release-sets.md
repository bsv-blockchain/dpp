# Release sets

A release set is a declared combination of package versions, the wire and contract versions they implement, the profiles they carry and a conformance selection: one compatibility target you can pin and check. This page names the current set, shows how to use it and how to verify that the published packages are the approved ones, and links to the release history.

## The current set

| | `dpp-release-2026-10-7` |
|---|---|
| Declaration | [`release/dpp-release-2026-10-7.json`](https://github.com/bsv-blockchain/dpp/blob/1b7a922616f5943f884ec07a39e8b966ecc8a42d/release/dpp-release-2026-10-7.json), as the approved publication plan bound it |
| Status | Published to npm under the `latest` tag on 9 October 2026. The JSON keeps `status: candidate` because its exact digest was approved; the receipt records the publication |
| Packages | `@bsv/dpp-core@0.3.0-beta.8`, `@bsv/dpp-overlay-topics@0.4.0-beta.10`, `@bsv/dpp-profiles@0.3.0-beta.8`, `@bsv/vsc@0.2.0-beta.5`, on `@bsv/sdk@2.8.10` and Node 22 |
| Licence | Apache 2.0 |
| npm tag | `latest`, so a plain install gets these versions; `next` stays at the beta.5 set. Install exact versions all the same |
| Source revision | `1b7a922616f5943f884ec07a39e8b966ecc8a42d` |
| Receipt | [Beta.10 publication receipt](beta-10-publication.md): the approved plan, archive digests and registry verification |
| Selection | `conformance/selections/dpp-release-2026-10-7.json`, the claims this release requires and withholds ([conformance](conformance.md)); it adds the version 3 passport reader claim |

Compared with the published beta.9 set `dpp-release-2026-10-6`, the core and overlay packages read and write record version 3, the token carrier: the seventeen-field body carried behind a BRC-162 token prefix as a token of one unit ([the specification](https://github.com/bsv-blockchain/dpp/blob/647d6eb38ffe3eacab05b5784a2a4393f63a92e0/spec/token-carrier.md)), under index contract `0.11.0-draft`. Versions 1 and 2 are read as before. The overlay package also finds peers through the overlay discovery protocols when configured, advertises itself from a separate advertiser key when configured, and asks again for outputs it left behind ([federation](../operate/federation.md)); the profiles package carries the operator profile `single-operator@2`, which an index declares when one administration pulls from named or discovered peers. No claim, anchor or acceptance format, frozen profile or custody profile changed.

## Use the current set

1. Install the exact versions, as [install from npm](../packages/README.md#install-from-npm) shows, and keep your lockfile. Together they identify the bytes you installed.
2. Before pointing a client at a running service, compare the service's `GET /capabilities` with what the client expects: `implementation.version`, the protocol versions and the profiles. Installing a release does not upgrade any running service, the hosted ones included; each service's capability document says what it runs.
3. To move from an earlier set, rehearse against retained data as [migration](../migration.md) describes, and adopt successor industry profiles separately ([update profiles and consuming applications](../profiles/updating-applications.md)).

These are experimental prereleases: APIs may change significantly during testing, so read the changelog before upgrading. Published versions are immutable, so every change takes a new version. Package versions are separate from the specification, wire-format and frozen profile versions they implement, and installing them establishes neither live interoperability nor production readiness.

## Verify a published release

For the current set, follow the [latest publication receipt's verification steps](beta-9-publication.md#verification), using its recorded source revision and toolchain.

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
