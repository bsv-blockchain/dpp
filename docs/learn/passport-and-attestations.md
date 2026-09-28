# Passport states and attestations

Passport history and attestations answer different questions. The passport records changes to the product record. An attestation states an issuer's claim about a product or event. Linking them does not establish the truth of the claim. Verifiable Supply Chain (VSC) is a separate credential profile.

[Verifiable credentials](verifiable-credentials.md) explains the available credential formats, their relationship to DIDs and the issuance and verification exercises.

## Choose which thing to create

Use a passport update when the product record itself changes. Use an attestation when an issuer makes a claim that should be retained and checked independently, such as a repair assessment. One business event can produce both, but they have different signatures and verification paths.

The public payload is the product data carried with a passport state. An industry profile, such as battery or textile, selects the data vocabulary. Restricted evidence is retained separately; publishing a digest does not publish or recover the document it identifies.

For example, a repair can update the product's recorded condition and produce a signed repair claim. Finding the updated passport does not establish that the repair claim was retrieved or checked. The reader's report makes those separate results visible.

## See the distinction

After [setup](../quick-start.md#get-the-code), run:

```sh
node examples/lifecycle-v2.mjs
node examples/verify-attestation-anchor.mjs
```

The lifecycle example exercises changes to token records. The attestation example checks the separate claim and anchor fixture. Both use synthetic data. Continue with the [writer](../implement/roles/passport-writer.md) for records or the [issuer](../implement/roles/attestation-issuer.md) for claims.

## Source definitions

| Implementing | Source |
|---|---|
| Passport encoding, signing and transitions | [Record model](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/record-model.md), [record model version 2](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/record-model-v2.md) |
| Native claims and their commitments | [Attestation rules](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/rules.md) |
| Historical anchor records | [Historical format](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/legacy-uora-anchor-v3.md) |
| Credential representations | [VSC profile](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/vsc-profile.md), [external credential profile](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/external-credential-profile.md) |

A record's format selects the source to read; the [fixture guide](../implement/fixture-runner.md) names unresolved source differences, including the native payload description.

Historical issuer widening: open. The historical anchor admits `did:key` issuers only; the current `bsv-attestation-anchor-v1` carries any issuer identifier.

Continue with [identifiers](../identifiers.md) and [evidence limits](evidence-and-freshness.md).
