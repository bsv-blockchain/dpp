# Install the selected release

**Audience:** a team consuming the reference packages. **Release:** `dpp-release-2026-09-3`, a candidate. **Prerequisites:** Node.js 22 or later, npm. **Canonical source:** [`release/dpp-release-2026-09-3.json`](https://github.com/bsv-blockchain/dpp/blob/main/release/dpp-release-2026-09-3.json) and [`release/README.md`](https://github.com/bsv-blockchain/dpp/blob/main/release/README.md).

## What you install

| Package | Version | Use it when you |
|---|---|---|
| `@bsv/dpp-core` | 0.3.0 | Read, verify or build records of either version, verify claims and anchors, produce the verification report, check publisher policy, or inspect an evidence package |
| `@bsv/dpp-profiles` | 0.3.0 | Validate product data against an industry profile, map operations to lifecycle events, mint or parse GS1 identifiers, resolve Digital Links, or project a passport from versioned sources |
| `@bsv/dpp-overlay-topics` | 0.4.0 | Run or embed an index: admission, lookup, capabilities, history, export, retraction and synchronisation. Server only |
| `@bsv/vsc` | 0.2.0 | Issue or verify VSC credentials under the pinned draft profile, read EPCIS documents, or verify external `ecdsa-rdfc-2019` credentials. Server only |

All four pin `@bsv/sdk` 2.4.2; the index pins `@bsv/overlay` 2.3.1 and uses MongoDB 7 as its replaceable reference persistence. The [support table](support-table.md) states, per entry point, what runs where and what the tarball carries.

## Before publication: the packed candidates

The packages are not yet on a public registry. Until they are, install the exact candidates the release scripts pack. From a checkout of the standard at the revision the release set names:

```sh
npm ci
node scripts/release-candidates.mjs          # builds and packs the four tarballs into release/candidates/
node scripts/consumer-check.mjs              # verifies their digests, then installs and exercises them in a clean project
```

`release/candidates.json` records each tarball's SHA-256 and npm integrity beside the source revision, the release set's own digest and the selection that qualifies it. Install them into your project by path and let your lockfile record the integrity, so a later `npm ci` holds you to the same bytes:

```sh
npm install ./release/candidates/bsv-dpp-core-0.3.0.tgz \
            ./release/candidates/bsv-dpp-profiles-0.3.0.tgz
```

A tarball whose SHA-256 differs from the record is not the candidate, whatever its filename says; compare before you install, as the consumer check does.

## After publication

Once the set's status is `released`, install the versions it names from npm and pin them exactly. A caret range across a pre-1.0 minor version is not a compatibility promise; the release set is.

```sh
npm install @bsv/dpp-core@0.3.0 @bsv/dpp-profiles@0.3.0
```

## What to read next

- [Quick starts, by role](../quick-start.md): the commands CI runs for each role, from the checkout.
- The package pages: [core](dpp-core.md), [overlay](dpp-overlay-topics.md), [profiles](dpp-profiles.md), [VSC](vsc.md).
- [The application service](application-service.md): the reference application's `PassportService` and durable writer, which consume these packages and are not part of the set.
- [Versions and compatibility](../learn/versions-and-compatibility.md): which identifier means what.

## What installing does not establish

Installing the packages and passing the consumer check shows the packages are consumable. It says nothing about the application you build on them: your writer's behaviour, your custody arrangement and your operator's policy are yours to test and to state. And an application built on these packages is a reference consumer, not an independent implementation of the rules, however it is deployed.
