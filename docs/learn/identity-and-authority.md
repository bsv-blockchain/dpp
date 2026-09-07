# Identity and authority

The subject identifies what a record concerns. The actor or issuer is associated with the signing key. Authority is the evidence that permits that party to act in a particular role. An application account can associate these things without proving the association.

A decentralised identifier (DID) names an identity under a method. Resolving a key and establishing the issuer's authority remain separate steps. The [identity source](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/identity.md) defines the terms and method-specific checks.

| Question | Source |
|---|---|
| Which key signs a passport state? | [Record signatures](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/record-model.md), [version 2 signatures](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/record-model-v2.md) |
| How is a native claim attributed? | [Claim verification](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/rules.md) |
| Which publisher keys apply? | [Publisher policy](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/services.md) |
| Which authority evidence does the verifier need? | [Verification report](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/verification.md) |

Live identity assurance is Ring 0: the platform vouches for the account and brand label. Higher rings are absent. [Ring definitions](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/TRUST_DESIGN.md#L54-L91).

Continue with [custody](custody.md) or the [attestation verifier](../implement/roles/attestation-verifier.md).
