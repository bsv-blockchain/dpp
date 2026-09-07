# @bsv/vsc

Verifiable Supply Chain (VSC) credential tooling. The [support table](support-table.md) identifies the Node runtime and data entry points.

## Select the representation first

A SEAL is the credential used by the local VSC profile to carry a signed event, its subjects and supporting references. Use the root entry point for this profile. Use `/exchange` for the separately selected external credential representation and `/epcis-source` to parse and validate EPCIS event documents. Selecting one does not mean the others were evaluated.

JSON for Linked Data (JSON-LD) uses context documents that identify the meaning of terms. Credential verification needs the selected contexts, key material and proof suite, plus any status or authority evidence required by the policy. A proof can verify while another check remains unknown.

For a first local exercise, follow [EPCIS source exchange](../interoperability/epcis.md). Its example parses a supplied fixture document and reports schema validation without a server or blockchain. For credentials, [external verification](../interoperability/external-credentials.md) explains the inputs and tests.

The package does not fund a wallet, transfer token control or find records through an overlay. Those tasks remain in the [writer](../implement/roles/passport-writer.md) and [reader](../implement/roles/passport-reader.md) routes.

## Package sources

| Entry point | Source |
|---|---|
| `@bsv/vsc` | [Selected credential profile](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/vsc-profile.md) |
| `@bsv/vsc/epcis-source` | [Source-event exchange](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/epcis-interoperability.md) |
| `@bsv/vsc/exchange` | [External credential profile](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/external-credential-profile.md) |
| `@bsv/vsc/artifacts/*` | [Retained schemas, contexts and notices](https://github.com/bsv-blockchain/dpp/tree/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/vsc/artifacts) |

Use the [package guide](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/vsc/README.md) for issuance, verification and adapter examples. [External credentials](../interoperability/external-credentials.md) and [source exchange](../interoperability/epcis.md) explain where each entry point fits.

The [release selection](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/selections/dpp-release-2026-09-3.json) withholds full upstream draft conformance. The package's selected subset does not establish product qualification or completion of the upstream suite.

Companion profile submission: open; see [D-CG1](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L184).

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).
