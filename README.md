# The DPP Standard

**Status: working draft, pre-1.0.** Everything here is subject to change until version 1.0 is declared, and breaking changes are expected while the draft is assembled. This repository is private while that happens; when it opens, its history opens with it.

A standard for digital product passports on the BSV blockchain. It defines how passport records and the services around them must behave: a published specification, conformance fixtures seeding a test suite anyone can run against their own implementation, and a reference implementation proving the specification can be built and operated.

## The idea

A product passport lives on chain as a chain of token states, each state spending the one before, so its history is ordered by the chain itself and a rewrite is detectable rather than quiet. Separately, every lifecycle attestation about the product is digest-anchored on chain. The two rails never share an output: stop either and the other still verifies.

The property the standard protects: a stranger can check a record with the transaction bytes and public block headers alone. No account, no credential from any operator, and no service that has to stay online for the record to remain true.

## What lives here

| Part | What it covers | State |
|---|---|---|
| `spec/` | The record model, the rules (anchoring, lifecycle vocabulary, canonical bytes), identity, custody (where the keys may live, and the owner's consent to a transfer), writing (what a writer owes the record: checked, announced, sent, proven, kept), the services, and the design rationale behind them | Working drafts, all seven documents |
| `contracts/` | The service interfaces as OpenAPI documents | The overlay contract is pinned; the registry's joins when the implementing parties accept it together |
| `fixtures/` | Conformance fixtures, the seed of the test suite, in two forms held to the same bytes: the bespoke files and the BSV stack's cross-language vectors | Landed, for both rails |
| `packages/` | The reference implementation | Landed |
| `GOVERNANCE.md` | How changes are proposed and agreed | Second draft: roles, thresholds, the conditions for 1.0 |
| `CHANGELOG.md` | What changed, and which pull request changed it | Kept from the first commit |
| `docs/` | Informative material: the map from the standard to the ecosystem stack, the deployment that follows the standard's defaults, and the follow-ups it leaves in other repositories. Never normative | First draft |

## The reference implementation

Two packages, to publish to npm when this repository opens:

- **`@bsv/dpp-core`** (`packages/dpp-core`) is the record model and what both rails share: the 14-field codec, the canonical signature preimages, chain verification including SPV and the optional owner-consent check, and the canonical bytes an attestation is signed and hashed over. Everything else asks this package whether a state is valid; nothing may reimplement it.
- **`@bsv/dpp-overlay-topics`** (`packages/overlay-topics`) is the index: the `tm_dpp` and `tm_uora_dpp` topic managers and the `ls_dpp` and `ls_uora_dpp` lookup services, usable as a library or as an HTTP service speaking exactly the wire `contracts/overlay.yaml` pins. Its Dockerfile builds the deployable index node from this repository alone, so an adopter can run their own index:

```
npm ci && npm run build && npm test
docker build -f packages/overlay-topics/Dockerfile -t dpp-overlay .
```

The files in `fixtures/` are regenerated verbatim from modules inside these packages' test suites, and the suites hold the two identical: editing either side alone goes red in CI. CI runs the build, the type checks, both suites and the container image on every change.

## Check a record yourself

The property the standard protects is not a claim to take on trust. `examples/verify-passport.mjs` does what the specification says a stranger can do: it asks an index only for the bytes, then verifies every signature, every link and every merkle proof against public block headers, and reports one sentence per check, never a score.

```
npm ci && npm run build
node examples/verify-passport.mjs 'https://id.gs1.org/01/09506000134352/21/7883451B01B6'
node examples/verify-passport.mjs --fixture     # the chain fixture, offline, as CI runs it
node examples/verify-passport.mjs --fixture --owner-consent   # the same under the owner-signed transfer: its refusals too
node examples/verify-anchor.mjs                 # the anchor rail: fixtures/anchor-v3.json, every check and every refusal
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
