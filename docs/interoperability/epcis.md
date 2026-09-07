# EPCIS source exchange

Electronic Product Code Information Services (EPCIS) documents supply source events. Retain the received document through the import workflow before mapping it into a passport or credential view.

| Task | Source |
|---|---|
| Select parsing, digest and mapping behaviour | [EPCIS interoperability](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/epcis-interoperability.md) |
| Store an import record | [Import schema](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/epcis-import.schema.json) |
| Integrate the application service | [HTTP contract](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/interoperability.yaml) |
| Use reference parsing and mapping | [VSC package](../packages/vsc.md) |
| Run every selected case, including mapping outcomes | [EPCIS vectors](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/fixtures/vectors/dpp/interoperability/epcis/v1.json) |

Use the source's digest preimage; a digest of the stripped event alone does not reproduce it. Imports do not establish custody or perform a passport transfer. The [ledger](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/manifest.json) records which import and pull outcomes have been exercised.
