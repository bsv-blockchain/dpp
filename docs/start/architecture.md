# The passport model

Platform planners and implementers can use this model to understand how passport records, claims and services fit together before reading code. The [glossary](glossary.md) defines the terms.

## Before you start

No software, credentials or prior implementation are required.

## Two rails

A passport uses two separate transaction chains, called rails:

- **The passport rail** holds states, one transaction output each. Each new state spends its predecessor, giving the history one order that cannot be quietly rewritten.
- **The claim rail** holds anchors. A repair or recycling claim is signed off chain. Its anchor commits to those exact bytes by their digest in a small output.

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

Indexes and registries find and keep records. Readers check transaction bytes against block headers from a chosen source; a service response is not proof.

## The building blocks

| Term | Meaning |
|---|---|
| Output | A record in a transaction that a later transaction can spend |
| Outpoint | One output, named by its transaction identifier and output index |
| Signature | Attributes bytes to a key |
| Digest | A fingerprint of bytes, used to detect any change |
| Claim with proof (secured claim) | The claim and its signature or proof: the exact bytes committed by an anchor. Secured does not mean encrypted. |
| Anchor | Separate output committing to the exact bytes of a claim with its proof |

## Where next

| To | Read |
|---|---|
| See it run | [Quick start](../quick-start.md) |
| Find the path for your task | [Choose your path](choose-your-path.md) |
| Learn what a state and a claim each carry | [Passport states and attestations](../learn/passport-and-attestations.md) |
| See how accounts, keys and authority differ | [Identity and authority](../learn/identity-and-authority.md) |
| Know what is not settled | [Known limitations](../operate/limitations.md) |

Sources: [record model version 1](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md), [record model version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md), [rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md).
