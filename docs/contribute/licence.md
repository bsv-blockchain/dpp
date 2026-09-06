# Licence and reuse

**Canonical source:** [`LICENSE`](https://github.com/bsv-blockchain/dpp/blob/main/LICENSE), the Open BSV License version 4, copyright 2026 BSV Association. This page describes it; it does not modify it.

## What the licence says

The licence grants, free of charge, the rights to use, copy, modify, merge, publish, distribute, sublicense and sell copies of the software and associated documentation files, on two conditions. The copyright and permission notice must be included in all copies or substantial portions. And the software, and any software derived from it or parts of it, can only be used on the Bitcoin SV blockchains the licence defines: the chain containing block 556767 with the hash the licence names and the longest persistent chain of blocks valid under the Bitcoin white paper's rules and accepted by the software, plus the test chains defined the same way. The software is provided as is, without warranty.

## What it applies to here

The whole repository is under this one licence file, and every package declares `SEE LICENSE IN LICENSE` and carries the file in its tarball. That covers the reference packages, the examples, the container image's sources and, as "associated documentation files", the specifications under `spec/`, the contracts and schemas under `contracts/`, the fixtures under `fixtures/`, the conformance material and these pages. A package with no BSV runtime dependency, such as `@bsv/vsc`, is not thereby unrestricted open source: the BSV usage condition attaches to the licence, not to a dependency list, and the conformance licence record says so.

## Third-party material

Some pinned artefacts are other parties' work and carry their own terms, recorded in notice files beside them: the GS1 resolver schemas under `packages/dpp-profiles/schemas/gs1/`, the EPCIS 2.0.1 schema and context under `packages/vsc/artifacts/epcis/`, and the W3C credentials context under `packages/vsc/artifacts/w3c/`. The runtime dependencies of each package and the licence each declares are recorded in `conformance/licences.json` and checked against what is installed. The VSC Community Group draft the credential profile targets is referenced by revision and not reproduced.

## Reuse questions the maintainers have still to settle

Stated so that nobody assumes an answer. Whether the specifications, schemas and fixtures should carry a separate, more permissive documentation or data licence so that an implementation for another purpose may read them without the BSV usage condition, has not been decided; today they are under the same licence as the software. Whether contributions are accepted under a contributor licence agreement or under the inbound-equals-outbound rule has not been written down. Whether a future public release of the repository changes any of this is for the maintainers to decide at that time. None of this changes by assumption in this documentation, and an adopter with a question asks the maintainers rather than inferring an answer.

## Public availability

A candidate package and a draft specification do not establish public availability. The repository is private while the draft is prepared for publication, the packages are not on a public registry, and this documentation is prepared for a site that has not been connected. Statements here about what is available describe the artefacts as they exist, not a promise of when they will be published.
