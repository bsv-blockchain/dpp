# Parked: record version 3, the token carrier

**Out of the standard.** This folder keeps record version 3, the token carrier: the seventeen-field body of record version 2 carried as one output of a BRC-162 token of one unit, so that a reader of the token protocol could follow a lineage by its token id. It was parked on 12 November 2026, after a read-only scan of mainnet found no DPP carrier state on chain. Nothing here is a requirement, no conformance claim covers it, its ledger rows and its one claim are kept without a status in [the ledger archive](../ledger-archive.json), and no package in this repository reads or writes it.

What the standard says in its place is one sentence in `spec/record-model.md`, `spec/record-model-v2.md`, `spec/services.md`, `spec/writing.md` and `spec/design-rationale.md`: record version 3 is parked. A reader decodes record versions 1 and 2 only. An output behind the token prefix is no DPP output, refused at its locking key, and a seventeen-field output whose version field reads `3` is refused as an unsupported version. The verification report moved to version 2 the same day, without the two reason codes the carrier added.

## What is here

| File | What it pins |
|---|---|
| `token-carrier.md` | The specification as it stood, once `spec/token-carrier.md`, with a parked note at the top. Its links to the fixtures point at the copies in this folder, and its links to other documents at the revision below. |
| `record-v3.json` | One carried genesis and one value output with thirteen refusals |
| `chain-v3.json` | A five-state carried lineage, twelve refusals and the burn |
| `evidence-v3.json` | The verification report for nine carried cases, under report version 1 |
| `vectors-record-v3.json`, `vectors-chain-v3.json` | The same bytes in the stack's vector format, `dpp.record.v3` (seventeen vectors) and `dpp.chain.v3` (twenty-two), once `fixtures/vectors/dpp/record/v3.json` and `fixtures/vectors/dpp/chain/v3.json` |
| `baseline-native-3.json` | The proposed `native-baseline@3`, once `conformance/baseline-native-3.json`, with the fixture digests it last recorded |
| `lifecycle-v3.mjs` | The carried lifecycle example, once `examples/lifecycle-v3.mjs`. It imports exports the current packages no longer have, so it runs only against the revision below. |

The files were moved as they last stood and are not regenerated. `evidence-v3.json` and `baseline-native-3.json` are the copies of 12 November 2026: the custody change of that day dropped `ownerConsentValid` from the per-state detail of every report and the owner-signed transfer rows from every baseline, and moved the digests the baseline records for the version 1 and 2 fixtures it regenerated. The baseline's fixture paths are those of the revision below.

## The last working revision

Commit [`d8b912e`](https://github.com/bsv-blockchain/dpp/tree/d8b912e5a311137163bdf958673bff3f4e10558b/packages/dpp-protocol/src), the last commit on `main` before the rulings of 12 November 2026, carries record version 3 working, and nothing after it changed the carrier's code, text or fixtures before they were parked. At that revision:

- `@bsv/dpp-protocol` reads and writes the carrier: `src/carrier.ts` (`checkCarrier`, `CARRIER_REFUSALS`, `tokenIdOf`), the prefix in `src/codec.ts` (`parseDppOutput` returning the `carrier`, `buildLockingScript` with its optional carrier, `carrierPrefixChunks`, `carrierPrefixFor`, `tokenIdWireBytes`, `tokenIdFromWireBytes`, `fieldsToStateV3`), the version 3 constants (`STANDARD_VERSION_V3`, `DPP_PROTOCOL_ID_V3`, `RECORD_V3_ACTOR_TAG`, `RECORD_V3_PUBLISHER_TAG`, `FIELD_COUNT_V3`, `CARRIER_TOKEN_ID_BYTES`, `CARRIER_AMOUNT`, `CARRIER_DEPLOY_OUTPUT_INDEX`), the version 3 preimages in `src/signatures.ts`, the version 3 transition rules, the `tokenId` of each state in `verifyChain` and the report, and the version 3 limits sentence in `verifyPassportEvidence`.
- The generators and tests are under `packages/dpp-protocol/test/`: `record-v3-fixture.ts`, `record-v3-vectors.ts`, `record-v3.test.ts`, `chain-v3-fixture.ts`, `chain-v3-vectors.ts`, `chain-v3.test.ts`, `evidence-v3-fixture.ts` and `helpers-v3.ts`.
- `@bsv/dpp-overlay` admits carried states and indexes them: `checkCarrier` in `tm_dpp` with the `carrier-prefix-invalid` and `token-id-mismatch` refusals, the `tokenId` stored by `ls_dpp` and its lookup by token id, the capability `dpp-record` version `3`, and `packages/dpp-overlay/test/tmDppV3.test.ts`.
- `contracts/overlay.yaml` carries the version 3 text of `tm_dpp`, the two refusal codes and the `tokenId` lookup selector; `contracts/verification-report.schema.json` carries the two reason codes under report version 1; `examples/verify-passport.mjs --fixture --version=3` verifies the carried fixtures.

A profile that brings the carrier back starts from that revision and from `token-carrier.md`, as a new record version, and the report it needs is a new report version with the two reason codes restored.
