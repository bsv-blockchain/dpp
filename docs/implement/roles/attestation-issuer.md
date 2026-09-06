# Attestation issuer

**Audience:** an implementer of the issuer role. **Baseline:** `native-baseline@2`. **Prerequisites:** the signing capability the format requires; retained evidence for what the claim asserts; never a token spend. **Network:** none. **Canonical sources:** [`spec/rules.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/rules.md) §2 to §4, [`spec/identity.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/identity.md) §2, [`spec/exchange.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/exchange.md) for other representations.

## Inputs and outputs

| Input | Output |
|---|---|
| The passport identifier, the event type, the payload with its evidence facets, the issuer's identity key and its derivation capability | A signed `dpp-lifecycle-v1` claim, its canonical secured bytes and their digest, handed to an anchoring service or a registry |

## What you reproduce

1. **The claim shape**: `claimFormat` `dpp-lifecycle-v1`, the passport identifier, the event type from the native vocabulary (Origin, Transfer, Transformation, Disposition), the issuer as a `did:key`, the timestamp, the payload, and the signature, which covers the claim format and the event type.
2. **The canonical bytes** of `spec/rules.md` §4 and the refusal of anything the subset does not admit: a float, a nested value the profile forbids, a key order the canonicaliser did not produce.
3. **The signature** under the claim's derivation from the issuer's identity key.
4. **The evidence facets**: a claim that maps an operation to an external event carries the facets the mapping asks for by name (`facility`, `time`, `responsibleParty`; `source` and `destination` or a `custodyRecord`; `workDone`, `performedBy`, `performedAt`; `dispositionKind` and `outputs`), each a reference to a record and never a bare flag. A claim without them is evidence-only and the mapping says `insufficient-data`.
5. **The separation**: signing establishes attribution to a key. Authority is the verifier's policy and the registry's authority evidence, not anything the issuer asserts about itself.

## The minimal runnable path

Reproduce the signed claim of `fixtures/attestation-anchor-v1.json` from its unsigned fields and the published issuer key (`77` repeated for the anchor fixtures' keys; the fixture states which key signs what), compare the canonical bytes with `representationBytes` and the digest with the anchor's field 2. Then sign a fresh claim about the fixture's passport, hand it to the reference verifier and to your own, and show both accept it; then alter one byte of the canonical form and show both refuse the signature.

## Expected results

Byte-identical representation bytes and digest for the fixture; a fresh claim accepted by both verifiers with `nativeAttestationSignature` pass; a tampered claim refused with `signature-invalid`.

## What an issuer never does

Spend the passport token. Assert authority in the claim and expect a verifier to believe it. Manufacture a location, an actor or a predecessor event to satisfy a mapping.
