# Release sets

Installers, implementers and reviewers can use this page to select a release set and reproduce its checks. A set declares package versions, wire and contract versions, profiles and a conformance selection as one compatibility target. Use the current candidate for source development, or a publication receipt to reproduce a published set.

## Prerequisites and choice of target

| Procedure | Inputs and source |
|---|---|
| Source development | Candidate declaration and package versions below; local archive instructions in the installation step. |
| Published verification | The selected receipt, approved plan and recorded source revision. Use Node 22, npm 11.19.0 and git, with npm registry access. |
| Historical beta.4 signature check | An empty directory. |
| Historical beta.4 integrity comparison | Checkout root on `main`, containing the archived approved plan. |
| Source reproduction | A fresh, clean checkout at the receipt's exact revision. Keep generated logs and other extra files outside it; files written inside change the plan. |

## The current set

| | `dpp-release-2026-11` |
|---|---|
| Declaration | `release/dpp-release-2026-11.json`; its source revision is recorded when a publication plan binds it |
| Status | Candidate. Nothing of it is published; the last published set is `dpp-release-2026-10-10`, under `latest` since 16 October 2026 ([beta.11 receipt](beta-11-publication.md)) |
| Main packages | `@bsv/dpp-protocol@0.3.0-beta.10`, `@bsv/dpp-overlay@0.4.0-beta.13`, `@bsv/dpp-profiles@0.3.0-beta.10`, `@bsv/dpp-credentials@0.2.0-beta.6`, on `@bsv/sdk@2.8.10` and Node 22 |
| Licence | Apache 2.0 |
| npm tag | `latest`; install exact versions and retain the lockfile |
| Receipt | None yet; the [beta.11 receipt](beta-11-publication.md) covers the last published set |
| Selection | `conformance/selections/dpp-release-2026-11.json`, retaining the claims required and withheld by the preceding candidate, except that it withholds the parked VSC compatibility profile and the EPCIS claims whose rows include its mappings, and requires the narrower `epcis-source-import-1` for the EPCIS source helpers ([conformance](conformance.md)) |

Compared with the superseded `dpp-release-2026-10-10`, this set carries the seven decisions of bsv-blockchain/dpp#177:

| Change | Fields, interfaces and effect |
|---|---|
| Token payload validation | The verification report checks every token payload against its declared profile through a caller-supplied validator. The profiles package provides `profilePayloadValidator(ajv)`; missing profile stamps produce `profile-undeclared`. |
| Restricted disclosure | `legitimate` and `authority` tiers reach each reader re-encrypted to that reader's key under the one owner commitment. |
| Acceptance evidence | Evidence packages carry acceptance records under `authority`; read them with `acceptanceRecordsInPackage`. |
| Managed custody | Each state locks to its controller key. After a committed transfer, a custodian writes for the holder only on a `dpp-managed-instruction@1` record committed in field 15. An index selecting `INSTRUCTION_COMMITMENT=required` refuses an absent commitment as `instruction-commitment-absent`. |
| Native claim | Names its state by outpoint in `recordId` and may carry evidence facets under `evidence`, with the canonical rule stated at every level; the anchor fixture is regenerated around the chain-v1 genesis. |
| Contracts | Index contract `0.14.0-draft` adds the refusal and `POST /register` for self-service publisher-key registration from the application's wallet. Registry contract `0.5.0` adds the claim schema. |
| Starters | Both pin the new set; the application starter signs claims with the outpoint. |

The preceding published set introduced record version 3, the token carrier: a seventeen-field body behind a BRC-162 token prefix, representing one unit ([the specification](https://github.com/bsv-blockchain/dpp/blob/647d6eb38ffe3eacab05b5784a2a4393f63a92e0/spec/token-carrier.md)). Versions 1 and 2 remain readable. It also added optional index discovery, advertising and retries ([federation](../operate/federation.md)), and the `single-operator@2` operator profile. Those changes remain part of this candidate; neither the package renames nor the overlay republication adds a wire-format change.

## Use the current set

1. Install the exact public versions, or [build and install the local candidate archives](../packages/README.md#use-the-renamed-source-candidate) to test unpublished source.
2. Record package versions, source revision and lockfile alongside the configuration of each service you run or use.
3. Review the [migration guide](../migration.md) before upgrading an existing deployment. Installing a new profile package does not activate a new writer profile ([updating applications](../profiles/updating-applications.md)).

These are experimental prereleases: APIs may change during testing. Package versions are separate from specification, wire-format and frozen profile versions. Publication and installation establish neither deployed interoperability nor production readiness.

## Verify a published release

The latest npm publication is the current set, `dpp-release-2026-10-10`: protocol and profiles beta.9, overlay beta.12 and credentials beta.5 under their new names, on `latest` since 16 October 2026. Its [beta.11 receipt](beta-11-publication.md) records the approved source revision `0e45ac32da351c1e877431d55e2e9c0c41f54c33`, original release-set input, archive digests and verification results.

Reproduce the published packages with the receipt's [verification steps](beta-11-publication.md#verification):

1. Use a clean checkout at `0e45ac32da351c1e877431d55e2e9c0c41f54c33` with the toolchain above.
2. Run the receipt's commands from that checkout's root:

```sh
npm ci
node scripts/release-candidates.mjs release/dpp-release-2026-10-10.json
node scripts/publish-candidates.mjs --verify-registry
node scripts/consumer-check.mjs --registry
```

3. Expect `Every npm tarball matches the candidate bytes.` and `Every sentence above holds.` Compare the generated `release/publication-plan.json` with the receipt's archived plan on the default branch; it is absent from the source revision's tree. Stop on differing bytes or a failed check. These commands neither publish nor change tags.

### Historical beta.4 reproduction

The worked example below reproduces the historical beta.4 publication. Its package versions and source revision belong to that archived set.

These steps check npm bytes against the approved plan and public source revision, then inspect ledger claims. Each step can be run alone with the historical prerequisites above.

1. **Check registry signatures and provenance.** Run:

   ```sh
   npm init -y
   npm install --save-exact @bsv/dpp-core@0.3.0-beta.4 @bsv/dpp-overlay-topics@0.4.0-beta.4 @bsv/dpp-profiles@0.3.0-beta.4 @bsv/vsc@0.2.0-beta.3
   npm audit signatures
   ```

   It printed `87 packages have verified registry signatures` and `17 packages have verified attestations`; the four DPP packages are among the attested ones, and nothing was reported invalid or missing.

2. **Compare each archive with the approved plan.** Print the registry's integrity for each package and the [approved plan](beta-4-publication-plan.json)'s recorded integrity:

   ```sh
   for p in @bsv/dpp-core@0.3.0-beta.4 @bsv/dpp-overlay-topics@0.4.0-beta.4 @bsv/dpp-profiles@0.3.0-beta.4 @bsv/vsc@0.2.0-beta.3; do echo "$p $(npm view "$p" dist.integrity)"; done
   node -e "for (const c of require('./docs/reference/beta-4-publication-plan.json').candidates) console.log(c.name + '@' + c.version, c.integrity)"
   ```

   The two lists must match line for line, starting `@bsv/dpp-core@0.3.0-beta.4 sha512-bSOxqRghWrxsrPY7…`.

3. **Rebuild the plan from the source revision.** Repack from the recorded revision, never from `main`: its packages have changed since publication, so their archives differ. Use the checkout prerequisites above:

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

The [release tooling](https://github.com/bsv-blockchain/dpp/blob/d7dc9bfa6d1ca7d11df446a9882dba4f0692c2d9/release/README.md) packs a set into candidate archives and writes a candidate record, `release/candidates.json`, with the source revision and each archive's digest; a set's name alone is not that revision. [Publish a package update](publishing-profile-updates.md) is the maintainer procedure from candidate to npm.

Next: install the current set with [install the selected release](../packages/README.md), or check what it claims on [conformance](conformance.md).
