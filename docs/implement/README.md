# Start an independent implementation

This page is the starting kit for writing the DPP rules in your own code, in any language, without the `@bsv/dpp-*` packages: what you may reuse, what you must write, the order to build in and how you know you are done. If you would rather call the packages from JavaScript or TypeScript, [build an application](../packages/build-an-application.md) is the faster route.

## Before you start

- git, and a checkout of this repository at the [reviewed example revision](../quick-start.md#get-the-code). The specifications, contracts and fixtures are all in it. A fixture is a JSON file of inputs and expected results, including inputs your code must refuse.
- Node 22 and npm, to run the reference examples beside your own results. Your implementation does not need them.
- Python 3, to run the worked example reader. It uses the standard library only.
- A BSV SDK for your language, or your own code for the building blocks below.
- Nothing else for a reader: no account, wallet, funds or network. A writer later needs a BRC-100 wallet with funds and an index of its own.

To get the checkout, run this in the directory that should hold it:

```sh
git clone https://github.com/bsv-blockchain/dpp.git
cd dpp
npm ci
npm run build
```

`npm run build` builds the reference packages, which the reference examples import. Your own code never imports them.

## What you may reuse

The rule is in [conformance](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/conformance.md) section 6: an implementation counts as independently tested when it is written by another implementing party and "imports none of this repository's code for the property" it claims.

| You may use | You may not use for a property you claim |
|---|---|
| Any BSV SDK: `@bsv/sdk` for TypeScript, the [Go SDK](https://github.com/bsv-blockchain/go-sdk), the [Python SDK](https://github.com/bsv-blockchain/py-sdk) or another. None of them is this repository's code. | `@bsv/dpp-protocol`, `@bsv/dpp-profiles`, `@bsv/dpp-overlay-topics` or `@bsv/vsc`, or code copied or translated from them |
| Your language's standard library and general cryptography, JSON, HTTP and JSON Schema libraries | The reference service or a reference example deciding an answer for you: that runs the reference implementation behind your interface |
| The fixtures and vectors, copied unchanged as test data | A fixture edited to make a case pass |
| The specifications, contracts and schemas | |

Write from the specification text, as the Python reader below was written.

## What you will implement

Each row is a building block a second implementation needs. The BSV SDKs named above each carry BRC-42 derivation, a PushDrop template, BEEF and merkle paths; check the version you use. BRC numbers refer to the [BSV Requests for Comment](https://bsv.brc.dev/).

| Building block | Standard | Where the rule is | From a BSV SDK? |
|---|---|---|---|
| secp256k1 keys, SHA-256, ECDSA with DER signatures. Deterministic (RFC 6979) nonces let your signatures reproduce the fixture bytes. | | [Record model](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md) section 5 | Yes |
| Key derivation. Every verification key is a child of a published key for an invoice number such as `1-dpp token v2-<passport_id>`, or `1-dpp token v3-<passport_id>` for a carried version 3 state, with counterparty `anyone`, so anyone can recompute it. | [BRC-42](https://bsv.brc.dev/key-derivation/0042), [BRC-43](https://bsv.brc.dev/key-derivation/0043) | [Record model](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md) section 5, [version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md) section 5, [rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md) sections 3 and 5 | Yes |
| The control proof: a 32-byte scalar showing that one key derives from another (`child = parent + scalar × G`) | [BRC-69](https://bsv.brc.dev/key-derivation/0069) | [Version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md) section 6, [custody](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/custody.md) section 4 | The point arithmetic, yes; the rule, no |
| The output layout: a locking key, `OP_CHECKSIG`, the fields as pushes, then a drop tail (`OP_2DROP` per pair of fields, plus `OP_DROP` for an odd count); for version 3 the same seventeen-field body behind a token prefix, the token id or `OP_0`, `OP_1` and `OP_2DROP` (`spec/token-carrier.md` sections 2 and 3) | [BRC-48](https://bsv.brc.dev/scripts/0048) (PushDrop); BRC-162 for the version 3 prefix | [Record model](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md) sections 2 and 3, [version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md) sections 2 and 3, [rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md) section 5 for the anchor | To build an output, yes. To read one, no: a general PushDrop decoder accepts outputs a conforming reader must refuse, so the strict reading rules are your own code |
| Signature preimages: plain concatenation for version 1; for version 2 and the anchor, a domain tag and then every item prefixed with its length as a Bitcoin VarInt; for version 3 the version 2 framing under its own tags | | The same sections | No |
| Restricted canonical JSON for the native claim: property names sorted, no whitespace, only string and safe-integer values, duplicate keys refused | | [Rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md) section 4; the nested form for the acceptance record is in [managed custody](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/managed-custody.md) section 3 | No |
| Transactions and BEEF (Background Evaluation Extended Format), the binary form in which an index or a wallet hands you transactions with their ancestors and proofs | [BRC-62](https://bsv.brc.dev/transactions/0062) | [Record model](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md) section 8 | Yes |
| Merkle paths in BUMP (BSV Unified Merkle Path) form, checked against block headers by a header source that answers "valid", "not valid" or "no answer" | [BRC-74](https://bsv.brc.dev/transactions/0074) | [Record model](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md) section 8 | Paths, yes. Headers come from a header service or your own node |
| Chain invariants: the genesis rules, spends of the tip (the newest state), the predecessor and genesis outpoints a version 2 state names, which operation may change which field, nothing after a retirement; for version 3 the carrier's own, a genesis that is a deploy at output 0 and a token id on every later state naming it (`spec/token-carrier.md` section 6) | | [Record model](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md) section 6, [version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md) section 6 | No |
| The verification report: sixteen checks in a fixed order, four statuses, shared reason codes | | [Verification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md), [report schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/verification-report.schema.json) | No |
| Index requests, to submit a transaction and look records up: only for reading live passports, writing, or the index role | [BRC-22](https://bsv.brc.dev/overlays/0022), [BRC-24](https://bsv.brc.dev/overlays/0024) | [Overlay contract](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/overlay.yaml) | Clients, yes |
| Wallet calls to sign, fund and send: only for a writer | [BRC-100](https://bsv.brc.dev/wallet/0100) | [Writing lifecycle](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/writing.md) | Use any BRC-100 wallet; [choose a wallet](../operate/wallet-broadcast-proofs.md#choose-a-wallet) |

A reader handles all three record versions, because one passport's history can hold versions 1 and 2 together and a version 3 lineage stands on its own: it counts the fields of a bare output, fourteen for version 1 and seventeen for version 2, reads a seventeen-field body behind a token prefix as version 3, and reads each state under its own version.

## Build in this order

Steps 2 to 5 make a passport reader. Start there whatever you build: every other role checks what it makes or receives with the reader's rules.

1. **See what passing looks like.** At the root of the checkout, run the reference reader and the Python reader:

   ```sh
   node examples/verify-passport.mjs --fixture --version=2 --report
   python3 conformance/independent/python/dpp_verify.py
   ```

   No line starts with `FAIL`, and the Python reader ends with `Every sentence above holds.`
2. **Decode one record.** Read `fixtures/record-v2.json`. Your inputs are `lockingScript` and `custodianKey`, the publisher's identity key. Your code must reproduce `state` (the fifteen data fields), `actorPreimage` and `publisherPreimage` byte for byte, derive `actorVerificationKey` and `publisherVerificationKey`, verify `actorSignature` and `publisherSignature` under them, and refuse all ten scripts in `refusals`. Then do the same for `fixtures/record-v1.json`, whose fourteen fields sign `userPreimage` and `serverPreimage`, and for `fixtures/record-v3.json`, whose two outputs sit behind a token prefix and whose twelve refusals include the prefix's own.
3. **Verify a history.** Read `fixtures/chain-v2.json` and `fixtures/chain-v1.json`: accept the valid states in order and refuse each broken link (22 and 16 cases). Then `fixtures/chain-v3.json`, a carried lineage: accept its five states with their token id, refuse its 12 broken links and read its burn.
4. **Bind an acceptance record.** Read `fixtures/managed-acceptance-v1.json`, the signed record a custodian keeps for a transfer under `managed-custody@1`.
5. **Produce the report.** Read `fixtures/evidence-v2.json` (13 cases), `fixtures/evidence-v1.json` (21 cases) and `fixtures/evidence-v3.json` (9 cases) and produce, for each, a report that matches on the parts [run the fixtures](fixture-runner.md#what-a-matching-report-is) lists.
6. **Add the other roles you need**, from the table below.
7. **Report what you did**, as [reporting](reporting.md) describes.
8. **Exchange fresh records** with the reference in [the trial](demonstration.md).

Keep the harness in your own language, and record the case, the expected result and your result for every case. [Run the fixtures](fixture-runner.md) says what each file gives as input, what must match, and the four rules whose texts do not yet agree ([source gaps](fixture-runner.md#source-gaps)).

## A worked example: the Python reader

[`conformance/independent/python/dpp_verify.py`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/independent/python/dpp_verify.py) is a reader written from the specification text with the Python standard library alone: secp256k1 arithmetic, strict DER, ECDSA verification, BRC-42 derivation, the PushDrop layout and its refusals, both signature preimages, the chain invariants, the native claim and the anchor. Read it to see how each rule becomes code. Run it at the root of the checkout:

```sh
python3 conformance/independent/python/dpp_verify.py
```

It prints one sentence per check, 252 lines starting `ok:`, and ends with `Every sentence above holds.` (`npm run conformance:independent` runs the same command.) It covers the record, chain, anchor and acceptance fixtures and the record, chain, anchor, acceptance, publisher policy and evidence package vectors. It does not produce verification reports for `evidence-v1.json` or `evidence-v2.json`, and it signs nothing, so it is no example for the report or for a writer.

It was written by the same programme as the reference, so it is engineering evidence that the specification is complete enough, not the organisationally independent implementation version 1.0 needs. [Its README](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/independent/python/README.md) says exactly what it covers.

## Pick your role

The [baseline](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/baseline-native-2.json), `native-baseline@2`, is the recommended selection of current formats. For each role it lists the required ledger rows under `roles.<role>.requires` and the tests under `testTargets`; the table below copies the tests. The ledger, [`conformance/manifest.json`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json), lists every requirement with its source clause, the roles it binds and its status.

| Role | What it does | Fixtures and tests | Page |
|---|---|---|---|
| Passport reader | Rebuilds a passport's history from transaction bytes and reports what it establishes | `record-v1.json`, `chain-v1.json`, `evidence-v1.json`, `record-v2.json`, `chain-v2.json`, `managed-acceptance-v1.json`, `evidence-v2.json`, `record-v3.json`, `chain-v3.json`, `evidence-v3.json` | [Passport reader](roles/passport-reader.md) |
| Attestation verifier | Checks a signed claim and its on-chain anchor | `attestation-anchor-v1.json`, the anchor cases of `evidence-v1.json`, and the historical `anchor-v3.json` | [Attestation verifier](roles/attestation-verifier.md) |
| Attestation issuer | Signs a claim about a product, such as a repair | `attestation-anchor-v1.json` | [Attestation issuer](roles/attestation-issuer.md) |
| Passport writer | Builds each new state, checks it, announces it, sends it, proves it and keeps it | The record and chain vectors, which publish their test keys so your writer reproduces the pinned bytes; then a self-report, one sentence per rule of [writing](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/writing.md) section 11 | [Passport writer](roles/passport-writer.md) |
| Registry | Validates, stores and serves signed claims | `contracts/registry.yaml`, `attestation-anchor-v1.json` | [Registry](roles/registry.md) |
| Index (the overlay role) | Admits passport and anchor transactions and answers lookups | `contracts/overlay.yaml`, `attestation-anchor-v1.json`, `chain-v2.json`, the files under `fixtures/vectors/` | [Overlay](roles/overlay.md) |

One program can fill several roles; each role is claimed separately. The fixture files are in [`fixtures/`](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures).

## When you are done

For each role you claim:

1. Every fixture case of the role gives its expected result from your own code, refusals included ([run the fixtures](fixture-runner.md)).
2. A writer also has one sentence per rule of writing section 11 ([passport writer](roles/passport-writer.md#prove-it-the-writers-self-report)).
3. A capability document says what you support and what you do not ([declare what you support](reporting.md#declare-what-you-support)).
4. A report gives one sentence per check, with no score, and goes where [send it](reporting.md#send-it) says.
5. Optionally, [the trial](demonstration.md) exchanges fresh records with the reference.

## Where the material is

| Material | Source |
|---|---|
| Rules and participation | [Specification index](../reference/specifications.md), [governance](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/GOVERNANCE.md) |
| Interfaces | [Contracts](../reference/contracts.md) |
| Bytes and test cases | [Fixture guide](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/README.md) |
| Requirements and their status | [Ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) |
| Industry profile data | [Frozen profiles](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/frozen.json) |

To take the material somewhere without the code, assemble the data-only bundle at the root of the checkout:

```sh
node scripts/implementer-bundle.mjs
```

It prints one line naming the number of files, the release set `dpp-release-2026-10-6`, the source revision with `(committed)` when the working tree was clean, and the archive's SHA-256. The output is `release/implementer-bundle/`, with the archive beside it. The bundle holds the specifications, contracts, fixtures in both forms, baselines, ledger, schemas, selections, an example capability document, the frozen profile data, these docs and the licence. It has no README at its root: start with `bundle-manifest.json`, which records the source revision, working-tree state, release selection and the digest of every file, then open `docs/implement/README.md`, this page. It carries no runtime code, examples or Python reader, so keep the checkout to run those.

Next: [run the fixtures](fixture-runner.md).
