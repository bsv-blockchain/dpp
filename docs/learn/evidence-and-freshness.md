# Evidence and its limits

A signature attributes bytes. An inclusion proof connects a transaction to a block. A latest-state observation describes what the queried sources returned. A complete export covers a declared source and snapshot. None supplies missing evidence for the other questions.

| Reader task | Source |
|---|---|
| Interpret each check and its reason | [Verification report](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/verification.md), [report schema](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/verification-report.schema.json) |
| Evaluate supplied passport history | [Record verification](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/record-model.md) |
| Evaluate claims and commitments | [Attestation verification](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/rules.md) |
| Inspect an export's coverage | [Portable evidence](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/portable-evidence.md), [complete export](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/exchange.md) |

Missing evidence stays visible in the report. A verified historical prefix can still omit a later state. A service's answer is evidence from that service, not a view of every provider.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](identity-and-authority.md).

Use [the reader exercise](../implement/roles/passport-reader.md) to produce a report and [recovery](../operate/export-import-recovery.md) to inspect an export.
