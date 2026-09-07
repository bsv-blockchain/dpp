# Passport projections

A projection combines selected source revisions into a product-data view. Start with the source records and policy the intended projection uses.

| Input or output | Source |
|---|---|
| Source revisions | [Source schema](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/passport-source.schema.json) |
| Projection identity and output | [Projection schema](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/passport-projection.schema.json) |
| Commitment and precedence rules | [Projection source](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/passport-projections.md) |
| Reference implementation | [Projection helper](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-profiles/src/projections.ts) |
| Test cases | [Projection vectors](https://github.com/bsv-blockchain/dpp/tree/b8434452892b0c22a191c5bc08a7e0fc54717258/fixtures/vectors/dpp/interoperability) |

The commitment has an explicit exclusion list in the source. Do not infer it from the projection identifier alone. A projection supplies no missing signature or custody evidence. [Source exchange](epcis.md) covers imported event data.
