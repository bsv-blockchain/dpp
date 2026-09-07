# @bsv/vsc

Verifiable Supply Chain (VSC) credential tooling. The [support table](support-table.md) identifies the Node runtime and data entry points.

| Entry point | Source |
|---|---|
| `@bsv/vsc` | [Selected credential profile](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/vsc-profile.md) |
| `@bsv/vsc/epcis-source` | [Source-event exchange](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/epcis-interoperability.md) |
| `@bsv/vsc/exchange` | [External credential profile](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/external-credential-profile.md) |
| `@bsv/vsc/artifacts/*` | [Retained schemas, contexts and notices](https://github.com/bsv-blockchain/dpp/tree/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/vsc/artifacts) |

Use the [package guide](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/vsc/README.md) for issuance, verification and adapter examples. [External credentials](../interoperability/external-credentials.md) and [source exchange](../interoperability/epcis.md) explain where each entry point fits.

The [release selection](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/selections/dpp-release-2026-09-3.json) withholds full upstream draft conformance. The package's selected subset does not establish product qualification or completion of the upstream suite.

Companion profile submission: open; see [D-CG1](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L184).

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).
