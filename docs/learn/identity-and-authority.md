# Identity and authority

The subject identifies what a record concerns. The actor or issuer is associated with the signing key. Authority is the evidence that permits that party to act in a particular role. An application account can associate these things without proving the association.

A decentralised identifier (DID) names an identity under a method. [BSV DIDs](dids.md) explains the method and provides a resolution exercise. Resolving a key and establishing the issuer's authority remain separate steps. The [identity source](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/identity.md) defines the terms and method-specific checks.

## Keep these identities separate

| Term | Meaning in an integration |
|---|---|
| Subject | The product or record the caller intends to inspect. |
| Actor | The party whose key signs a passport state. |
| Issuer | The party making a lifecycle or credential claim. |
| Controller | The key identified by the passport's control model. |
| Custodian | A party holding or operating signing access for another party. |
| Publisher | The service whose signature is evaluated under the selected publisher policy. |
| Operator | The party running an index or evidence service. |

One deployment can combine these roles. Keep them separate in the application's data and policy: knowing who logged in does not establish which key signed, and knowing which key signed does not establish the party's authority to make a particular claim.

## Supply the expected subject

Take the expected passport identifier from the scan or request before loading the evidence. Pass that expectation into verification. Otherwise a valid record for another product can appear convincing because it is being compared with its own identifier.

For issuer authority, supply the evidence and policy the intended use requires. A repairer's signature establishes attribution to a key; acceptance as a repair authority needs a separate basis. The [report guide](evidence-and-freshness.md) explains how missing authority evidence appears. The [source gap](../implement/fixture-runner.md#source-gaps) concerning a missing independent subject remains open.

## Source definitions

| Question | Source |
|---|---|
| Which key signs a passport state? | [Record signatures](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/record-model.md), [version 2 signatures](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/record-model-v2.md) |
| How is a native claim attributed? | [Claim verification](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/rules.md) |
| Which publisher keys apply? | [Publisher policy](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/services.md) |
| Which authority evidence does the verifier need? | [Verification report](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/verification.md) |

Live identity assurance is Ring 0: the platform vouches for the account and brand label. Ring 1 would bind a brand's DID to a legal entity through an external instrument, such as a qualified electronic seal. Ring 2 would certify a party's role for a claim type, such as a notified body for a conformity claim. Neither is live.

Continue with [custody](custody.md) or the [attestation verifier](../implement/roles/attestation-verifier.md).
