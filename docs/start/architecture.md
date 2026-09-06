# The model in ten minutes

**Audience:** anyone new to the standard. **Canonical sources:** [`spec/record-model.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/record-model.md), [`spec/record-model-v2.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/record-model-v2.md), [`spec/rules.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/rules.md), [`spec/services.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/services.md), [`spec/verification.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/verification.md).

## Two rails

A passport is two kinds of blockchain record that never share an output.

```
  Passport rail (token states)                    Attestation rail (anchors)

  ISSUE ──spend──▶ UPDATE ──spend──▶ TRANSFER ──▶ …     claim ──digest──▶ anchor output
  one output each, the next spends the last            signed off chain, committed on chain
  public data, keys, signatures, previous link         issuer, subject, type, representation,
  optional hash of encrypted owner data                digest, anchoring service key and signature
```

The **passport state** is one transaction output carrying the whole record: the public product data, the event, the actor and owner keys, two signatures, and the identity of the state it spends. Each new state spends the previous state's output, so the chain itself orders the history and a conflicting update is a double spend the network refuses. Version 1 has fourteen fields; version 2 has seventeen, adding an explicit lineage genesis and predecessor outpoint, a control proof on every operation, a terminal retirement and an authorisation commitment a custody profile can require.

The **attestation anchor** binds a signed lifecycle claim to the chain by digest. The claim stays off chain and is signed by its issuer; the anchor carries the digest, the identifiers, the representation and media type, and the anchoring service's key and signature. An anchor never spends the passport token, so a repairer, a recycler or a certifier can say something about a product without holding its spending key.

Neither rail needs the other to verify its own checks. A token history verifies from its bytes and headers; an anchor verifies from its bytes and the claim it commits to.

## Who does what

| Role | Owes | Never does |
|---|---|---|
| Passport reader | Decode and verify supplied token history and say what it could not check | Trust an index's word |
| Attestation verifier | Verify claim signatures, anchor attribution and digest binding, and the selected status and authority evidence | Treat a valid anchor as a true claim |
| Passport writer | Build a valid state, verify it before sending, announce it, have a wallet broadcast it, obtain the proof and keep the evidence | Rebuild a state because an announcement failed |
| Attestation issuer | Sign an attributable claim under the declared format and profile | Spend the passport token |
| Registry | Apply declared intake and status policy, keep exact secured bytes and produce scoped reports | Let an unsupported credential fall through to a legacy path |
| Overlay | Admit and serve evidence under published policy, including the selected synchronisation profile | Claim that its answer is the latest state or the whole history |

One program may fill several roles; a conformance claim is made role by role.

## What verification establishes

A verifier holding transaction bytes, proofs and a header source establishes who signed which bytes, whether each state spends the one before it, whether each state is included at a chain position, and whether an anchor commits to the claim it names. It reports sixteen named checks, each **pass**, **fail**, **unknown** or **not applicable**, with a shared reason code, and it carries sentences stating its limits. It does not establish current ownership, the physical product, the truth of a claim, the issuer's authority or the absence of a later state; those are separate evidence, and the report says so in as many words.

## What a provider is, and is not

An index makes records findable and serves their bytes and proofs. A registry keeps claims and credentials and reports on them. A wallet signs and broadcasts. A header source says which blocks exist. None of them is load-bearing for verification: a passport whose bytes, proofs and off-chain content have been retained stays verifiable after every one of them disappears, and the evidence package and complete export exist so that retention is portable. Continuing to **update** a passport also needs its spending key, and where that key lives is the custody arrangement, chosen by the deployment and never inferred by a verifier.

## Where accounts fit

Nowhere in the standard. An application maps its accounts onto subjects, actors, issuers, keys, controllers, custodians and operators as it sees fit; the standard defines those terms separately and a verifier infers authority from none of them. [Identity and authority](../learn/identity-and-authority.md) has the vocabulary.
