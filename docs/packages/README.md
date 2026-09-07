# Install the selected release

The [selected release](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/release/dpp-release-2026-09-3.json) is a candidate. Use its packed artefacts; repository publication remains open. The [support table](support-table.md) identifies entry points and runtimes.

## Source access

These guides reference source revision `b8434452892b0c22a191c5bc08a7e0fc54717258`. A reader with repository access can obtain it with:

```sh
git clone https://github.com/bsv-blockchain/dpp.git
cd dpp
git checkout --detach b8434452892b0c22a191c5bc08a7e0fc54717258
npm ci
```

With that revision in a local checkout, read a pinned source without opening GitHub:

```sh
git show b8434452892b0c22a191c5bc08a7e0fc54717258:spec/record-model.md
```

Use the path following the commit hash in each source URL. Links to another repository need access to that repository. The [BSV Association contact page](https://bsvassociation.org/contact/) handles access enquiries; publication remains open.

## Pack and check

From that checkout:

```sh
node scripts/release-candidates.mjs
node scripts/consumer-check.mjs
```

The [candidate tooling](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/scripts/release-candidates.mjs) writes the source revision and artefact digests to `release/candidates.json`. The [consumer check](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/scripts/consumer-check.mjs) installs and exercises those tarballs in a separate project.

Install the tarballs needed by the application, using their paths from the candidate record. Preserve the resulting lockfile. Use [quick starts](../quick-start.md) from the repository checkout, or select a package:

| Task | Package |
|---|---|
| Passport records and shared evidence | [Core](dpp-core.md) |
| Product profiles and projections | [Profiles](dpp-profiles.md) |
| Credentials and source events | [VSC](vsc.md) |
| Index services | [Overlay](dpp-overlay-topics.md) |

The [application service](application-service.md) is maintained separately from this release set.
