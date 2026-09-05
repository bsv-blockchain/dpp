# The DPP Standard

**Status: working draft, pre-1.0.** Everything here is subject to change until version 1.0 is declared, and breaking changes are expected while the draft is assembled. This repository is private while that happens; when it opens, its history opens with it.

A standard for digital product passports on the BSV blockchain. It defines how passport records and the services around them must behave: a published specification, conformance fixtures seeding a test suite anyone can run against their own implementation, and a reference implementation proving the specification can be built and operated.

## The idea

A product passport lives on chain as a chain of token states, each state spending the one before, so its history is ordered by the chain itself and a rewrite is detectable rather than quiet. Separately, every lifecycle attestation about the product is digest-anchored on chain. The two rails never share an output: stop either and the other still verifies.

A reader can verify supplied native token history from transaction bytes and public block-header evidence without an application account. Credential authority, status, physical facts and observed latest state require their own evidence. Product identifiers, actor DIDs, controllers, wallets and application accounts are separate concepts.

## What lives here

| Part | What it covers | State |
|---|---|---|
| `spec/` | The record model, the rules (anchoring, lifecycle vocabulary, canonical bytes), identity, custody (where the keys may live, and the owner's consent to a transfer), writing (what a writer owes the record: checked, announced, sent, proven, kept), the services, verification (the one report every surface produces), conformance (layers, roles, the baseline and the claim ledger), profiles (industry profiles as frozen manifests, and the identifiers a passport relates), exchange (credential representations beside the native record), portable evidence (complete pages of a snapshot, and the signed evidence package), and the design rationale behind them | Working drafts, including VSC compatibility and historical format rules |
| `contracts/` | The service interfaces as OpenAPI documents, and the JSON schemas of the verification report, the capability document, the native evidence extension, the history page, the evidence package manifest and the publisher key policy | Versioned overlay and registry implementation profiles |
| `conformance/` | The requirement ledger, the recommended native baseline and the checker that validates both and gates every claim on them | First draft, seeded conservatively |
| `fixtures/` | Conformance fixtures, the seed of the test suite, in two forms held to the same bytes: the bespoke files and the BSV stack's cross-language vectors, the industrial-battery demonstration lifecycle, and vectors for the publisher key policy and the evidence package | Landed, for both rails |
| `packages/` | The reference implementation | Landed |
| `GOVERNANCE.md` | How changes are proposed and agreed | Second draft: roles, thresholds, the conditions for 1.0 |
| `CHANGELOG.md` | What changed, and which pull request changed it | Kept from the first commit |
| `docs/` | Informative material: the quick starts by role with the conformance commands, the map from the standard to the ecosystem stack, the deployment that follows the standard's defaults, the identifier a record carries and how a brand obtains the number inside it, and its integration boundaries. Never normative | First draft |

## The reference implementation

Four packages provide independently testable implementation roles:

- **`@bsv/dpp-core`** (`packages/dpp-core`) is the record model and what both rails share: the 14-field codec, the canonical signature preimages, chain verification including SPV and the optional owner-consent check, the native lifecycle claim, the generic anchor's build and strict decode, the canonical bytes an attestation is signed and hashed over, `verifyPassportEvidence`, the one verification report of `spec/verification.md`, the publisher key policy chain a state is checked against at its own time, and the evidence package manifest that carries a passport's evidence between operators. Reference consumers reuse these functions. Independent implementations reproduce the specified rules and portable fixtures.
- **`@bsv/dpp-overlay-topics`** (`packages/overlay-topics`) is the index: the `tm_dpp` and `tm_attestation` topic managers and the `ls_dpp` and `ls_attestation` lookup services, with separately named historical UORA interfaces, usable as a library or as an HTTP service speaking exactly the wire `contracts/overlay.yaml` pins, including the capability document, publisher key policy enforcement, history pages over a snapshot, the signed evidence package export and the guarded retraction. Its Dockerfile builds the deployable index node from this repository alone, so an adopter can run their own index:

- **`@bsv/dpp-profiles`** (`packages/dpp-profiles`) is the canonical home of the industry data profiles: `battery@2`, `textile@2` and `general@2` and their superseded predecessors as immutable, digest-frozen manifests, the payload schemas and consumer documents generated from them, the conditional lifecycle mapping with its four-valued result, and the GS1 identifier helpers a writer uses. Applications and registries consume it; nothing edits it. See [the profiles specification](spec/profiles.md).

- **`@bsv/vsc`** (`packages/vsc`) implements the pinned VSC draft compatibility profile with owned context/schema artefacts, genuine Ed25519 and BBS credential proofs, scoped verification and EPCIS mappings. It verifies credentials independently of the additional BSV anchor. This is documented draft compatibility, not W3C certification. See [the profile](spec/vsc-profile.md).

```
npm ci && npm run build && npm test
docker build -f packages/overlay-topics/Dockerfile -t dpp-overlay .
```

The files in `fixtures/` are regenerated verbatim from modules inside these packages' test suites, and the suites hold the two identical: editing either side alone goes red in CI. CI runs the build, the type checks, all workspace suites and the container image on every change.

## Check a record yourself

The property the standard protects is not a claim to take on trust. `examples/verify-passport.mjs` does what the specification says a stranger can do: it asks an index only for the bytes, then verifies every signature, every link and every merkle proof against public block headers, and reports one sentence per check, never a score.

```
npm ci && npm run build
node examples/verify-passport.mjs 'https://id.gs1.org/01/09506000134352/21/7883451B01B6'
node examples/verify-passport.mjs --fixture     # the chain fixture, offline, as CI runs it
node examples/verify-passport.mjs --fixture --owner-consent   # the same under the owner-signed transfer: its refusals too
node examples/verify-passport.mjs --fixture --report          # the sixteen-check report for every case of fixtures/evidence-v1.json
node examples/verify-passport.mjs '<passportId>' --report      # the same report for a live record
node examples/verify-attestation-anchor.mjs     # current secured-representation anchor
node examples/verify-anchor.mjs                 # historical native anchor v3
```

The writer's side is runnable too. `examples/write-passport.mjs` walks the lifecycle `spec/writing.md` sets out, from one BRC-100 wallet under possession: check the unsent state as a verifier would, announce it, send it and report only the network's answer, wait for the proof and push it to the index. Its dry run, which CI runs, rebuilds the fixture's first state byte for byte and shows the writer's own check refusing a state the record model forbids before it could be sent.

```
node examples/write-passport.mjs --dry-run                                 # no wallet, no network, as CI runs it
node examples/write-passport.mjs <passportId> [indexUrl] --wait-proof=30    # a live write from the wallet on this machine
```

## A working implementation

The standard is developed against a live demonstration: a multi-industry passport application publishing real records to BSV mainnet, with a public verification surface at [dpp.bsvb.net/verify](https://dpp.bsvb.net/verify) that anyone can run against a record in their own browser. Its source is [bsv-blockchain-demos/dpp-app](https://github.com/bsv-blockchain-demos/dpp-app), the first consuming application built on this standard (private today). A consuming application is not part of the standard: no service or frontend is mandatory, and any compatible provider can operate the same services or build alternatives.

## Licence

[Open BSV License version 4](LICENSE).
