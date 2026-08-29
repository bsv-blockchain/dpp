# Conformance fixtures

**Status: the seed of the conformance suite, not the suite.** These files pin wire formats byte for byte, so that independent implementations that cannot import one another stay in agreement by testing against the same bytes. A fixture is not an elegant contract, but it is the kind that fails loudly: change a field order, a canonicalisation rule, a protocol string or a signing preimage anywhere, and a suite goes red with a diff you can read.

Two rules these files follow, and any future fixture must:

1. **Refusal vectors are part of the fixture.** A fixture with only positive vectors certifies that an implementation accepts what it should, and never that it refuses what it must. Every fixture that pins a signed layout carries variants a conforming reader is required to reject.
2. **Copies are verbatim.** Implementations vendor these files unchanged and assert against them in their own suites. Fixing a divergence means changing the implementation, never the fixture, unless the specification itself has changed, in which case the format's version identifier changes with it.

## Two forms, one set of bytes

The two files at the top of this directory are the bespoke form: one object per format, every pinned value a property, refusal variants beside them. `vectors/` holds the same bytes in the BSV stack's cross-language conformance vector format (`conformance/VECTOR-FORMAT.md` and `conformance/schema/vector.schema.json` in `bsv-blockchain/ts-stack`): a file with a stable dotted identifier, a version, the reference implementation that produced it and a parity class, holding vectors that each carry an identifier, an input, an expected result and tags. Positive vectors are tagged `happy-path`, refusals `error-case`, and binary is lower-case hex under keys ending `_hex`. Any runner that reads the stack's corpus reads these, and the stack's structural runner validates them as they stand: `node conformance/runner/src/runner.js --validate-only --vectors <this directory>/vectors` from a checkout of `ts-stack` with the runner's dependencies installed, exit code 0 clean, 2 malformed.

Until the reference implementation's tests generate both forms, the bespoke files are the source and the vectors are generated from them, never edited by hand; a difference between the two is a generation defect, fixed by regenerating. The vector files carry two things the bespoke files do not. The synthetic test private keys are published in the positive vectors (`11`, `22` and `33` repeated to 32 bytes for the record; `77` and `88` for the anchor), so a writer in any language reproduces the pinned bytes rather than only checking them; nothing derived from these keys will ever hold value. And the anchor vectors carry four refusals the bespoke file lacks: one over each of the three length bounds in [`../spec/rules.md`](../spec/rules.md) §5, and a claim whose `passportId` exceeds the bound §3 sets. Vector identifiers are permanent once published and files are append-only: a corrected expectation is a new vector, and the old one is marked skipped with a reason, which is the stack's rule and now this directory's.

A conformance report over these vectors is presented as [`../GOVERNANCE.md`](../GOVERNANCE.md) requires: one sentence per vector, refusals included, and no aggregate score. The runner's per-vector output is the data; the sentences are the presentation.

## `anchor-v3.json`

One complete `uora-anchor-v3` anchor, from the attestation claim through its canonical bytes, digest, derived locking key and full locking script, as [`../spec/rules.md`](../spec/rules.md) defines. The leading copy is [`../packages/overlay-topics/test/anchor-v3-fixture.ts`](../packages/overlay-topics/test/anchor-v3-fixture.ts); this JSON is regenerated verbatim from it, and a test in that package holds the two identical. The keys involved are test keys, published deliberately; nothing derived from them will ever hold value.

| Property | What it pins |
|---|---|
| `attestation` | The claim exactly as posted, signed properties included. |
| `canonical` | The canonical bytes of that claim, as a string (spec §4). |
| `digest` | SHA-256 of the canonical bytes: the anchor's field 2. |
| `issuerDid`, `issuerKey` | The claiming party's two names for one key. |
| `anchoredBy` | The anchoring service's identity key: field 7. |
| `lockingKey` | The BRC-42 child the output must lock to, reproducible from `anchoredBy` and the attestation id. |
| `lockingScript` | The whole output, hex. Deterministic: signatures use RFC 6979 nonces, so this is reproducible on any machine from the test keys. |
| `boundaryShifted` | Four re-cut variants of the same output with the signature bytes untouched. Every one must be refused. They all verified under the superseded layout, which is why the current one exists. |
| `uncompressedKey` | The same output with its locking key re-pushed in the 65-byte uncompressed spelling. Attribution still matches after decoding, which is exactly why a lenient reader admitted it invisibly; a conforming reader refuses it at the push. |
| `malformedTail` | The same output with its drop tail wrong three ways: one drop short, the right total in the wrong opcodes, and a trailing chunk after a correct tail. A conforming reader validates the tail exactly and refuses each. |

A conforming writer reproduces `lockingScript` from `attestation` and the test keys. A conforming reader parses `lockingScript` to the fields above, verifies the field-8 signature over the SHA-256 of the length-delimited preimage, checks the locking key, and refuses every script in `boundaryShifted`, `uncompressedKey` and `malformedTail`.

## `record-v1.json`

One complete DPP record-model v1 output, from the posted state through its signing preimages, signatures, derived verification keys and full locking script, as [`../spec/record-model.md`](../spec/record-model.md) defines. The leading copy is [`../packages/dpp-core/test/record-v1-fixture.ts`](../packages/dpp-core/test/record-v1-fixture.ts), whose neighbouring tests rebuild every pinned byte from `state` and the test keys; this JSON is regenerated verbatim from it, and a test in that package holds the two identical. The keys involved are test keys, published deliberately; nothing derived from them will ever hold value.

| Property | What it pins |
|---|---|
| `state` | The twelve data fields exactly as posted. |
| `ownerBlob` | The off-chain owner-tier blob whose SHA-256 is field 11 (spec §7). |
| `userPreimage`, `serverPreimage` | The two signing preimages: fields 1 to 12 concatenated raw, then the same followed by the user signature bytes (spec §5). |
| `userSignature`, `serverSignature` | DER ECDSA over SHA-256 of the preimages. Deterministic: RFC 6979 nonces, so both are reproducible on any machine from the test keys. |
| `userVerificationKey`, `serverVerificationKey` | The BRC-42 children the signatures verify under, re-derivable from on-chain data plus the published service identity (spec §5). |
| `lockingKey`, `lockingScript` | The whole output: key push, `OP_CHECKSIG`, fourteen minimal pushes, seven `OP_2DROP` (spec §2). |
| `uncompressedKey` | The same output with its locking key re-pushed in the 65-byte uncompressed spelling; a conforming reader refuses it at the push. |
| `malformedTail` | The drop tail wrong three ways: one drop short, the right drop total in the wrong opcodes, and a trailing chunk after a correct tail. A conforming reader validates the tail exactly and refuses each. |
| `rolledTimestamp` | Field 5 as `2026-02-30T00:00:00Z`, a date the calendar does not contain; hosts that roll it into March accepted it invisibly. Refused at decode. |
| `mangledUtf8` | `payload_public` as the bytes `22 ff 22`: invalid UTF-8 whose lossy decode is the valid JSON string `"�"`. Refused at the bytes, not after them. |
| `nulPassportId` | `passport_id` pushed non-minimally as the single byte `0x00`, which no field may be: minimal writing spells that value `OP_0`, and `OP_0` reads back as the empty field. Refused. |
| `emptyPushdata` | `event_data`'s `OP_0` re-encoded as a zero-length `PUSHDATA1`; `OP_0` is the only accepted encoding of the empty field. Refused. |
| `overlongPassportId` | `passport_id` at 513 bytes, one over the bound spec §3 sets because the field is a BRC-42 key identifier and a conforming wallet has a ceiling. Refused at decode, before any signature is checked. |

A conforming writer reproduces `lockingScript` from `state` and the test keys. A conforming reader parses `lockingScript` back to the state, verifies the user signature under `userVerificationKey`, and refuses every script in `uncompressedKey`, `malformedTail`, `rolledTimestamp`, `mangledUtf8`, `nulPassportId`, `emptyPushdata` and `overlongPassportId`.

## `chain-v1.json`

One complete DPP record-model v1 passport chain, four states long, and the broken links a verifier must refuse, as [`../spec/record-model.md`](../spec/record-model.md) §6 defines. `record-v1.json` pins one output; this pins what holds outputs together. The leading copy is [`../packages/dpp-core/test/chain-v1-fixture.ts`](../packages/dpp-core/test/chain-v1-fixture.ts), whose neighbouring test rebuilds every transaction from `states[].data` and the test keys; this JSON is regenerated verbatim from it, and a test in that package holds the two identical. The keys are the record fixture's three plus `44` repeated for the second owner; test keys, published deliberately.

| Property | What it pins |
|---|---|
| `makerKey`, `serverKey`, `owner1Key`, `owner2Key`, `lockingKey` | The four test identities and the custody-neutral locking key (the maker's throughout). |
| `states[]` | Four states in chain order: `ACTIVATE` by the maker, `SOLD` by the maker, `TRANSFER` to the second owner signed by the first, `REPAIRED` by the second owner. Each carries `data` (the twelve posted fields), both signatures, `txid`, `outputIndex`, the output's `lockingScript`, and the complete `rawTx`. The `SOLD` transaction carries its DPP output at index 1 behind an `OP_RETURN`, so outpoint tracking is tested rather than assumed. |
| `refusals[]` | Nine transactions, each extending a prefix of the valid chain (`appendAfter` names the last valid state kept; `-1` means the vector stands alone as a genesis) and breaking exactly one invariant: a genesis that is not `ACTIVATE`, a genesis carrying `previous_txid`, two DPP outputs in one transaction, `ACTIVATE` after genesis, `previous_txid` naming a transaction other than the one spent, spending a different output of the right transaction, a changed `passport_id`, an owner change off `TRANSFER`, a payload change off `ACTIVATE`/`EDIT`/`TRANSFER`. Each names the `error` a conforming verifier reports. |

A conforming verifier parses every `rawTx`, needs no source transactions hydrated (the spend is checked from the input's own outpoint), accepts the four-state chain with every user signature valid and every link satisfied, verifies every server signature against `serverKey` when configured with it, and reports each refusal vector's chain invalid for the pinned reason.
