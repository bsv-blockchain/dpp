# Parked: the Python reader

**Out of the conformance machinery.** This folder keeps `dpp_verify.py`, a reader of the fixtures written in standard-library Python from the specification text and sharing no code with the reference packages. It was parked on 12 November 2026. CI no longer runs it, the `conformance:independent` script is gone, and no ledger row cites it: each row that cited it beside a TypeScript test keeps its status on that test. The same programme wrote it and the reference, so it was engineering evidence that the specification suffices to reproduce the bytes, never the organisationally independent implementation `GOVERNANCE.md` asks for before version 1.0. The ledger row `GOV-independent-implementation`, which cited only this reader, is a gap until such an implementation appears.

## What is here

| File | What it is |
|---|---|
| `dpp_verify.py` | The reader as it last stood, once `conformance/independent/python/dpp_verify.py`, byte for byte. It reads the fixtures by their paths at the revision below, among them the vector files removed from `fixtures/vectors/dpp/` the same day, so it runs only against that revision. |

## The last working revision

Commit [`c678cf9`](https://github.com/bsv-blockchain/dpp/tree/c678cf9281168179d16d599e5fdb3846ddbbaf61/conformance/independent/python), the last commit on `main` before the reader was parked, carries it passing, and CI ran it on every change until then. From a checkout of that commit, `python3 conformance/independent/python/dpp_verify.py` prints 282 sentences starting `ok:` and ends `Every sentence above holds.` A second reader that comes back starts from that revision, and from the fixtures as they then stand.

## The reader as it stood

This is the reader's own description, once `conformance/independent/python/README.md`, unchanged but for its heading.

`dpp_verify.py` reads the conformance fixtures with an implementation that shares no code with the reference packages: secp256k1 arithmetic, strict DER, ECDSA verification, the BRC-42 child derivation, the PushDrop layout and its refusals, the two signature preimages, the chain invariants and the version 2 control proof, the native claim and the generic anchor, all written from the specification text. It uses the Python standard library only.

```
python3 conformance/independent/python/dpp_verify.py
```

It prints one sentence per check and never a score, as `GOVERNANCE.md` requires of every conformance surface, and exits 0 only when every sentence holds. It covers the reader roles: it verifies and refuses, and does not sign, so the writer-side vectors are read for what a reader can check in them (the transaction hashes to its identifier and carries one state at the pinned index). For the publisher policy vectors it recomputes every version's canonical JSON preimage and digest, verifies every authorisation and countersignature, follows the digest chain and the version and time order, names the keys active at each probed instant, and re-derives six of the refusal conditions (a bad signature or countersignature, a missing or mismatched supersedes, time order, version order); the remaining policy-rule refusals are checked to name a version in the chain, not re-implemented. For the evidence package vectors it recomputes the manifest preimage, the signature verdict and the inventory verdict (digests, lengths, unlisted files and the path rules), and leaves the structure verdict to the reference.

What this is and is not. It is engineering evidence that the specification is complete enough for a second implementation to reproduce every pinned byte of the record, chain, anchor and acceptance fixtures and refuse every refusal vector of those files without reading the reference code. Its coverage of the publisher policy and evidence package vectors is the narrower one stated above: six of the eleven policy refusals are re-derived and the rest are checked to name a version in the chain, and the evidence package structure verdict is left to the reference. It is a reader only; it signs nothing, and it says nothing about writer, registry or overlay behaviour. It was written by the same programme as the reference, so it is not the organisationally independent implementation `GOVERNANCE.md` asks for before version 1.0; the ledger row `GOV-independent-implementation` records that distinction, and an independent implementer does not use this reader as a runtime oracle.
