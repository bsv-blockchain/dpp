# @bsv/dpp-core

Reference functions for passport records and shared evidence. Use the [support table](support-table.md) for the selected version and runtime; browser use is untested.

| Task | Entry points | Source |
|---|---|---|
| Read or construct a record | `parseDppOutput`, `findDppOutputs`, `buildLockingScript` | [Codec](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-core/src/codec.ts) |
| Evaluate history | `verifyChain`, `inspectChain`, `chainFromBeef` | [Chain verification](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-core/src/verifyChain.ts) |
| Produce a report | `verifyPassportEvidence` | [Evidence API](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-core/src/evidence.ts) |
| Sign or inspect a native claim | `signLifecycleClaim`, `verifyLifecycleClaim` | [Claim API](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-core/src/attestation.ts) |
| Inspect managed acceptance or exports | Acceptance and portable-evidence helpers | [Exports](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-core/src/index.ts) |

Start with the [reader and issuer examples](../quick-start.md). The [package guide](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-core/README.md) lists the remaining exports.

The caller supplies header, credential, status and authority adapters. Read the [report source](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/verification.md) for the distinction between missing evidence and a check that does not apply. Source disagreements are listed in the [fixture guide](../implement/fixture-runner.md).

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).
