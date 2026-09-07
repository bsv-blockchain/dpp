# Passport states and attestations

Passport history and attestations answer different questions. The passport records changes to the product record. An attestation states an issuer's claim about a product or event. Linking them does not establish the truth of the claim. Verifiable Supply Chain (VSC) is a separate credential profile.

| Implementing | Source |
|---|---|
| Passport encoding, signing and transitions | [Record model](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/record-model.md), [record model version 2](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/record-model-v2.md) |
| Native claims and their commitments | [Attestation rules](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/rules.md) |
| Historical anchor records | [Historical format](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/legacy-uora-anchor-v3.md) |
| Credential representations | [VSC profile](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/vsc-profile.md), [external credential profile](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/external-credential-profile.md) |

A record's format selects the source to read; the [fixture guide](../implement/fixture-runner.md) names unresolved source differences, including the native payload description.

Historical issuer widening: open; see [TD-12](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L209).

Continue with [identifiers](../identifiers.md) and [evidence limits](evidence-and-freshness.md).
