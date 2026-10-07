# The passport model

How a passport, the claims about it and the services around it fit together. Read this before the code if you want the model first; the [words used here](glossary.md) page defines every term.

## Two rails

A passport is kept on two separate chains of transactions, called rails:

- **The passport rail** holds the passport's own states. Each state is one transaction output, and each new state spends the one before it, so the history has one order and cannot be quietly rewritten.
- **The claim rail** holds anchors for claims. A claim, such as a repair or a recycling, is signed off chain; its anchor is a small output that commits to the claim's exact bytes by their digest.

Each rail can be checked without the other, and a party can make a claim without controlling the passport.

```
  Passport rail (states)                          Claim rail (anchors)

  ISSUE ──spend──▶ UPDATE ──spend──▶ TRANSFER ──▶ …     claim ──digest──▶ anchor output
  one output each, the next spends the last            signed off chain, committed on chain
  public data, keys, signatures, previous link         issuer, subject, type, representation,
  optional hash of encrypted owner data                digest, anchoring service key and signature
```

## Follow one product

1. A writer creates the product's first state, its genesis, with the passport identifier and public data. A wallet signs and builds the transaction.
2. The writer announces the transaction to an index, which admits or refuses it, and sends it through the wallet. These are separate steps: an index admitting a state does not mean it was mined.
3. Each later state spends the passport's tip, its latest state. The chain from genesis to tip is the passport's lineage.
4. An issuer signs a claim about the product. A registry keeps the signed claim, and an anchoring service commits to its exact bytes on the claim rail.
5. A reader gets the lineage from an index and the claim from a registry, and checks the signatures, the links, the subject and the proofs of inclusion itself.

The index and the registry only find and keep records. A reader believes nothing because a service said it: it checks the transaction bytes against block headers from a source it chooses.

## The building blocks

| Term | Meaning |
|---|---|
| Output | A record in a transaction that a later transaction can spend |
| Outpoint | One output, named by its transaction identifier and output index |
| Signature | Attributes bytes to a key |
| Digest | A fingerprint of bytes, used to detect any change |
| Secured claim | The claim together with its signature or proof, the exact bytes an anchor commits to. Secured does not mean encrypted |
| Anchor | A separate output committing to a secured claim's exact bytes |

## Where next

| To | Read |
|---|---|
| See it run | [Quick start](../quick-start.md) |
| Find the path for your task | [Choose your path](choose-your-path.md) |
| Learn what a state and a claim each carry | [Passport states and attestations](../learn/passport-and-attestations.md) |
| See how accounts, keys and authority differ | [Identity and authority](../learn/identity-and-authority.md) |
| Know what is not settled | [Known limitations](../operate/limitations.md) |

Sources: [record model version 1](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md), [record model version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md), [rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md).
