# The DPP Standard

**Status: working draft, pre-1.0.** Everything here is subject to change until version 1.0 is declared, and breaking changes are expected while the draft is assembled. This repository is private while that happens; when it opens, its history opens with it.

A standard for digital product passports on the BSV blockchain. It will define how passport records and the services around them must behave: a published specification, a conformance test suite anyone can run against their own implementation, and a reference implementation proving the specification can be built and operated.

## The idea

A product passport lives on chain as a chain of token states, each state spending the one before, so its history is ordered by the chain itself and a rewrite is detectable rather than quiet. Separately, every lifecycle attestation about the product is digest-anchored on chain. The two rails never share an output: stop either and the other still verifies.

The property the standard protects: a stranger can check a record with the transaction bytes and public block headers alone. No account, no credential from any operator, and no service that has to stay online for the record to remain true.

## What will live here

| Part | What it covers | State |
|---|---|---|
| `spec/` | The record model, the rules (anchoring, lifecycle vocabulary, canonical bytes), the service interfaces | Drafting |
| `contracts/` | The service interfaces as OpenAPI documents | Drafting |
| `fixtures/` | Conformance fixtures: the seed of the test suite | Arriving |
| `packages/` | The reference implementation | Arrives when the current operator's extraction completes |
| `GOVERNANCE.md` | How changes are proposed and agreed | First draft |

## A working implementation

The standard is developed against a live demonstration: a multi-industry passport application publishing real records to BSV mainnet, with a public verification surface at [dpp.bsvb.net/verify](https://dpp.bsvb.net/verify) that anyone can run against a record in their own browser. The demonstration is one consuming application, not part of the standard: no service or frontend is mandatory, and any compatible provider can operate the same services or build alternatives.

## Licence

[Open BSV License version 4](LICENSE).
