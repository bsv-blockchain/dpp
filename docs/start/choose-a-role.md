# Choose a role

Select a guide by the component being built. The [role definitions](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/conformance.md) and [baseline](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/baseline-native-2.json) hold the obligations and test targets.

| Component | Guide |
|---|---|
| Read passport history | [Passport reader](../implement/roles/passport-reader.md) |
| Evaluate an attestation | [Attestation verifier](../implement/roles/attestation-verifier.md) |
| Write passport records | [Passport writer](../implement/roles/passport-writer.md) |
| Sign lifecycle claims | [Attestation issuer](../implement/roles/attestation-issuer.md) |
| Retain and serve attestations | [Registry](../implement/roles/registry.md) |
| Index and retrieve records | [Overlay](../implement/roles/overlay.md) |

Start with the reader and verifier fixture exercises before testing an exchange between services. A component can fill several roles. Use the selected baseline to identify their requirements, then [report the evidence](../implement/reporting.md).
