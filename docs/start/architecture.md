# The passport model

A transaction output is a record another transaction can spend. A signature attributes bytes to a key. A digest is a fingerprint used to detect changed bytes. An outpoint identifies one output by its transaction identifier and output index. These are the building blocks of the passport and its separate attestations.

A secured claim is the claim together with its signature or proof. An anchor is a separate blockchain output committing to that secured representation. The word secured does not mean the contents are encrypted.

```
  Passport rail (token states)                    Attestation rail (anchors)

  ISSUE ──spend──▶ UPDATE ──spend──▶ TRANSFER ──▶ …     claim ──digest──▶ anchor output
  one output each, the next spends the last            signed off chain, committed on chain
  public data, keys, signatures, previous link         issuer, subject, type, representation,
  optional hash of encrypted owner data                digest, anchoring service key and signature
```

## Follow one product

1. A writer creates the product's first passport record with its identifier and public payload. A wallet supplies signatures and transaction handling.
2. The writer submits the transaction to an overlay for admission and sends it through the wallet's broadcast path. Those are separate operations: an index accepting a record does not mean it was mined.
3. A later update spends the preceding passport output. The resulting chain is the product's recorded history, also called its lineage.
4. An issuer can sign a separate lifecycle claim. A registry retains that secured claim; a separate service commits to its complete secured bytes in a separate output.
5. A reader obtains history from an overlay and claim evidence from a registry. It evaluates the signatures, links, subject binding and available inclusion evidence separately.

The separation lets a repairer provide evidence without taking control of the passport. It also lets another reader recheck retained evidence without depending on the original application's account database.

The [offline example](../quick-start.md) exercises the record and report parts. [Run a service](../operate/README.md) adds index lookup and storage after those checks are understood.

[Choose a role](choose-a-role.md) for the implementation route matching the component being built.

An index can help a reader find evidence. Verification also needs the relevant bytes, proofs and header source. Recovery depends on what was retained; [durable independent publication remains a gap](status.md).

Application accounts are outside the record model. The [identity guide](../learn/identity-and-authority.md) separates accounts, keys and authority.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).

Continue with [passport states and attestations](../learn/passport-and-attestations.md). Sources: [spec/record-model.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/record-model.md), [spec/record-model-v2.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/record-model-v2.md), [spec/rules.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/rules.md).
