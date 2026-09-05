# Quick starts, by role

Each start below is complete for one role and needs nothing from another role unless it says so. The commands are the ones CI runs, so a start that stops working is a red build, not a stale page. `npm ci && npm run build` at the repository root is the only preparation; the pinned lockfile is the dependency contract.

## Reader: verify a passport from fixtures, with no account, wallet or service

```
node examples/verify-passport.mjs --fixture
node examples/verify-passport.mjs --fixture --report
node examples/verify-passport.mjs --fixture --owner-consent
node examples/verify-anchor.mjs
node examples/verify-attestation-anchor.mjs
```

The first command replays `fixtures/chain-v1.json` through the reference reader and prints each finding. The second reports the same evidence as the one verification report of `spec/verification.md`, then materialises every case of `fixtures/evidence-v1.json` and compares the reports byte for byte. The third adds the owner-signed transfer check. The two anchor commands verify the historical `uora-anchor-v3` fixture and the generic `bsv-attestation-anchor-v1` fixture: layout, key derivation and signature, then the refusal vectors. A live read is `node examples/verify-passport.mjs <passportId> [indexUrl] --report`; it asks the index for the history and verifies it locally against block headers, and a missing or unreachable index is reported as unavailable evidence, never as validity.

What a reader implementation reproduces, and what it may leave to a build, is `spec/conformance.md` §2; the requirement ids for the reader role are in `conformance/baseline-native-1.json`.

## Verifier: check an attestation without trusting the registry

```
node examples/verify-attestation-anchor.mjs [file]
python3 conformance/independent/python/dpp_verify.py
```

The second command is a second reader in standard-library Python that shares no code with the reference: it recomputes every preimage, derived key, digest and script the fixtures pin and refuses every refusal vector. It is engineering evidence that the specification is complete enough to implement from, written within this programme, so it is not the independent implementation `GOVERNANCE.md` requires before 1.0.

## Writer: produce a state without spending anything

```
node examples/write-passport.mjs --dry-run
node examples/write-passport.mjs <passportId> [indexUrl] [--wait-proof=<minutes>] [--payload=<json>]
```

The dry run builds and checks a record with no wallet and no network. The live form needs a funded BRC-100 wallet, follows `spec/writing.md` (check, announce, send, prove, keep) and stops with a named reason at the first step that cannot be completed. Identifier discipline for the payload is `spec/profiles.md` §4 and the GS1 helpers in `@bsv/dpp-profiles`; a syntactically valid GTIN is never proof that it was allocated.

## Profile author: freeze, generate, prove no drift

```
npm run build -w @bsv/dpp-profiles
npm test -w @bsv/dpp-profiles
node packages/dpp-profiles/scripts/build.mjs --refreeze
```

The generator regenerates every payload schema, consumer document and mapping inventory from the frozen manifests and fails on any drift from `frozen.json`. A re-freeze is a reviewed diff of digests, and a changed meaning or rule is a new profile version, never an edit to a frozen one.

## Operator: run the index and say what it supports

The reference index node builds from `packages/overlay-topics/Dockerfile` and follows the defaults `docs/deployment.md` describes; `GET /health` lists the topics and services it serves and `GET /capabilities` serves its capability document in the shape of `contracts/capabilities.schema.json`. Under the reference configuration that document equals `conformance/examples/capabilities-reference-node.json`, which states `single-operator@1` with discovery off and no peers, so the node does not claim to be independently replicated. Publisher keys come from `PUBLISHER_POLICY_FILE` under `contracts/publisher-policy.schema.json`, separate from the operator's own identity; without one the single identity key is the implicit policy. `GET /history` pages a passport's history over a fixed snapshot, `GET /evidence-package` exports it as a signed package once `EXPORT_SIGNING_KEY` is set, and `POST /retract` withdraws an admitted output the network refused, behind the submit bearer.

## Choosing capabilities, and what happens on a mismatch

A reader compares a service's capability document with the baseline and profiles it requires. A required protocol version, profile digest, representation or proof suite that the document does not list is a named result, `unsupported` or `unknown` with a shared reason code from `contracts/verification-report.schema.json`, and it blocks the checks that depend on it; it is never a pass by omission and never a silent downgrade to an older version. An extension a reader does not understand leaves the check that needs it at `unknown` with `not-inspected`, while every check that does not need it proceeds. A state decodes under the profile version it declares; nothing reinterprets it under a newer one.

## Custody arrangements and accounts

`spec/custody.md` §5 and §6 name the custody modes, their authority, recovery, fee and operator-dependence boundaries, and distinguish custodian signing from independent signing; the writer example runs unchanged under either arrangement because it only ever asks a BRC-100 wallet to sign. `spec/identity.md` §1 and `spec/conformance.md` §5 fix the vocabulary an application maps its accounts onto: an account is never defined as a person, brand, organisation, wallet, DID or controller, and one account may hold several issuer identities while one identity may span several accounts.

## Conformance commands

```
npm ci
npm run build
npm test                         # every workspace, then the ledger checker
npm run conformance:check        # the ledger, the baseline, the pinned reports and the capability example
npm run conformance:independent  # the Python reader over every fixture and vector
node examples/verify-passport.mjs --fixture --report
REGENERATE_FIXTURES=1 npm test   # rewrite every published fixture from its generator, then hold it identical
```

`npm run conformance:pin` re-records source digests after a reviewed change to a normative file; the checker refuses a claim whose sources have moved or whose required rows are unassessed.
