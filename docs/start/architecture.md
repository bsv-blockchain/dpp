# The passport model

A transaction output is a record another transaction can spend. A signature attributes bytes to a key. A digest is a fingerprint used to detect changed bytes. These are the building blocks of the passport and its separate attestations.

```
  Passport rail (token states)                    Attestation rail (anchors)

  ISSUE ──spend──▶ UPDATE ──spend──▶ TRANSFER ──▶ …     claim ──digest──▶ anchor output
  one output each, the next spends the last            signed off chain, committed on chain
  public data, keys, signatures, previous link         issuer, subject, type, representation,
  optional hash of encrypted owner data                digest, anchoring service key and signature
```

A reader evaluates passport history. An attestation verifier evaluates the separate claims. Writers create passport records; issuers sign claims; registries retain evidence; overlays make records findable. [Choose a role](choose-a-role.md) for the implementation routes.

An index can help a reader find evidence. Verification also needs the relevant bytes, proofs and header source. Recovery depends on what was retained; [durable independent publication remains a gap](status.md).

Application accounts are outside the record model. The [identity guide](../learn/identity-and-authority.md) separates accounts, keys and authority.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).

Continue with [passport states and attestations](../learn/passport-and-attestations.md). Sources: [spec/record-model.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/record-model.md), [spec/record-model-v2.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/record-model-v2.md), [spec/rules.md](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/rules.md).
