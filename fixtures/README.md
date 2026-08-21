# Conformance fixtures

**Status: the seed of the conformance suite, not the suite.** These files pin wire formats byte for byte, so that independent implementations that cannot import one another stay in agreement by testing against the same bytes. A fixture is not an elegant contract, but it is the kind that fails loudly: change a field order, a canonicalisation rule, a protocol string or a signing preimage anywhere, and a suite goes red with a diff you can read.

Two rules these files follow, and any future fixture must:

1. **Refusal vectors are part of the fixture.** A fixture with only positive vectors certifies that an implementation accepts what it should, and never that it refuses what it must. Every fixture that pins a signed layout carries variants a conforming reader is required to reject.
2. **Copies are verbatim.** Implementations vendor these files unchanged and assert against them in their own suites. Fixing a divergence means changing the implementation, never the fixture, unless the specification itself has changed, in which case the format's version identifier changes with it.

## `anchor-v3.json`

One complete `uora-anchor-v3` anchor, from the attestation claim through its canonical bytes, digest, derived locking key and full locking script, as [`../spec/rules.md`](../spec/rules.md) defines. The keys involved are test keys, published deliberately; nothing derived from them will ever hold value.

| Property | What it pins |
|---|---|
| `attestation` | The claim exactly as posted, signed properties included. |
| `canonical` | The canonical bytes of that claim, as a string (spec §4). |
| `digest` | SHA-256 of the canonical bytes: the anchor's field 2. |
| `issuerDid`, `issuerKey` | The claiming party's two names for one key. |
| `anchoredBy` | The anchoring service's identity key: field 7. |
| `lockingKey` | The BRC-42 child the output must lock to, reproducible from `anchoredBy` and the attestation id. |
| `lockingScript` | The whole output, hex. Deterministic: signatures use RFC 6979 nonces, so this is reproducible on any machine from the test keys. |
| `boundaryShifted` | Four re-cut variants of the same output with the signature bytes untouched. Every one must be refused. They all verified under the superseded layout, which is why the current one exists. |
| `uncompressedKey` | The same output with its locking key re-pushed in the 65-byte uncompressed spelling. Attribution still matches after decoding, which is exactly why a lenient reader admitted it invisibly; a conforming reader refuses it at the push. |
| `malformedTail` | The same output with its drop tail wrong three ways: one drop short, the right total in the wrong opcodes, and a trailing chunk after a correct tail. A conforming reader validates the tail exactly and refuses each. |

A conforming writer reproduces `lockingScript` from `attestation` and the test keys. A conforming reader parses `lockingScript` to the fields above, verifies the field-8 signature over the SHA-256 of the length-delimited preimage, checks the locking key, and refuses every script in `boundaryShifted`, `uncompressedKey` and `malformedTail`.
