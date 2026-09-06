# Documentation map

Every public guide and package README in the repository, with its audience, its authoritative source, its status and where it now lives. Prepared 2026-09-06 while the documentation was reconciled with the implementation; a page listed as retained is maintained where it is and linked from these pages rather than copied.

| Page | Audience | Authoritative for | Status | Path |
|---|---|---|---|---|
| Root `README.md` | Everyone arriving at the repository | The introduction and the map of the repository | Retained, corrected | `README.md` |
| `GOVERNANCE.md` | Contributors, implementing parties | How the standard changes, version 1.0 conditions, conformance reporting | Retained, normative process | `GOVERNANCE.md` |
| `CHANGELOG.md` | Everyone | Version history | Retained | `CHANGELOG.md` |
| `docs/quick-start.md` | Every role | The commands CI runs, by role | Retained, extended with the issuer and registry starts; in the packages group | `docs/quick-start.md` |
| `docs/deployment.md` | Operators and writers | The default arrangement and the lifecycle in order | Retained, corrected; in the operate group | `docs/deployment.md` |
| `docs/migration.md` | Deployments | The move to record version 2, the interoperability profiles and the complete export | Retained, extended; in the reference group | `docs/migration.md` |
| `docs/identifiers.md` | Writers and brands | GTIN allocation, hosts, prefix 952 | Retained; in the reference group | `docs/identifiers.md` |
| `docs/stack.md` | Integrators | Which BSV stack component meets which requirement | Retained, corrected; in the reference group | `docs/stack.md` |
| `release/README.md` | Release maintainers, consumers | The release set, candidates, consumer check, bundle and publication | Retained, rewritten | `release/README.md` |
| `fixtures/README.md` | Implementers | Every fixture and what it pins | Retained, canonical | `fixtures/README.md` |
| `fixtures/vectors/dpp/interoperability/README.md` and its four sub-READMEs | Implementers of the interoperability profiles | The interoperability vectors | Retained, canonical | `fixtures/vectors/dpp/interoperability/` |
| `conformance/independent/python/README.md` | Reviewers | What the Python reader covers and does not | Retained, coverage wording corrected | `conformance/independent/python/README.md` |
| `deploy/README.md` | Operators | The Compose preset, restart, backup, restore, the second operator | Retained, canonical for the preset | `deploy/README.md` |
| `packages/dpp-core/README.md` | Developers | The core package's modules and working on it | Retained, independence wording corrected | `packages/dpp-core/README.md` |
| `packages/overlay-topics/README.md` | Operators, developers | Configuration, the extension routes, synchronisation, the refused spend | Retained, route inventory corrected | `packages/overlay-topics/README.md` |
| `packages/dpp-profiles/README.md` | Developers, profile authors | The package's data and code, working on it | Retained, dependency statement corrected | `packages/dpp-profiles/README.md` |
| `packages/vsc/README.md` | Registries, issuers | The VSC profile, proofs, custody, EPCIS, exchange | Retained, canonical | `packages/vsc/README.md` |
| The pages under `docs/` in the groups of the navigation | By group | Explanation, sequencing and pointers; never a rule | New, 2026-09-06 | `docs/` |

## What was corrected on 2026-09-06

The root README said dedicated industry schemas and profile validation were not supplied, named the historical anchor as the format, called the registry contract pending, said peer synchronisation was not enabled and described only a configured publisher key; each statement now matches the implementation. The release guide and the quick start pointed at the superseded first candidate set and said the application mirrored three packages; both now name the current candidate and four. The overlay README listed four extension routes; the complete export makes five. The profiles package said it had no runtime dependency; the canonicaliser is one. The core README said its rules may be reimplemented nowhere else; that applies within the reference implementation, and an independent implementation reproduces them by design. The Python reader's coverage statement now matches its README's own limits. The stack map and the deployment guide no longer describe synchronisation as absent or advertising as present.
