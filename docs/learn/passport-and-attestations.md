# Passport states and attestations

Passport history and attestations answer different questions. The passport records changes to the product record. An attestation states an issuer's claim about a product or event. Linking them does not establish the truth of the claim. Verifiable Supply Chain (VSC) is a separate credential profile.

## Choose which thing to create

Use a passport update when the product record itself changes. Use an attestation when an issuer makes a claim that should be retained and checked independently, such as a repair assessment. One business event can produce both, but they have different signatures and verification paths.

The public payload is the product data carried with a passport state. An industry profile, such as battery or textile, selects the data vocabulary. Restricted evidence is retained separately; publishing a digest does not publish or recover the document it identifies.

For example, a repair can update the product's recorded condition and produce a signed repair claim. Finding the updated passport does not establish that the repair claim was retrieved or checked. The reader's report makes those separate results visible.

## See the distinction

After [setup](../quick-start.md#prepare-the-checkout), run:

```sh
node examples/lifecycle-v2.mjs
node examples/verify-attestation-anchor.mjs
```

The lifecycle example exercises changes to token records. The attestation example checks the separate claim and anchor fixture. Both use synthetic data. Continue with the [writer](../implement/roles/passport-writer.md) for records or the [issuer](../implement/roles/attestation-issuer.md) for claims.

## Source definitions

| Implementing | Source |
|---|---|
| Passport encoding, signing and transitions | [Record model](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/record-model.md), [record model version 2](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/record-model-v2.md) |
| Native claims and their commitments | [Attestation rules](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/rules.md) |
| Historical anchor records | [Historical format](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/legacy-uora-anchor-v3.md) |
| Credential representations | [VSC profile](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/vsc-profile.md), [external credential profile](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/external-credential-profile.md) |

A record's format selects the source to read; the [fixture guide](../implement/fixture-runner.md) names unresolved source differences, including the native payload description.

Historical issuer widening: open; see [TD-12](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L209).

Continue with [identifiers](../identifiers.md) and [evidence limits](evidence-and-freshness.md).
