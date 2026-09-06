# Attestation verifier

**Audience:** an implementer of the verifier role. **Baseline:** `native-baseline@2`. **Prerequisites:** claim and anchor bytes; a policy naming trust inputs, or the decision to report authority unknown. **Network:** none for the fixtures; status and authority sources for live policy. **Canonical sources:** [`spec/rules.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/rules.md) §3 to §7, [`spec/legacy-uora-anchor-v3.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/legacy-uora-anchor-v3.md), [`spec/identity.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/identity.md) §2, [`spec/verification.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/verification.md) §4.

## Inputs and outputs

| Input | Output |
|---|---|
| A native claim as posted; an anchor output's locking script, or the whole transaction; optionally the exact secured bytes the anchor commits to; the expected subject; a policy naming anchoring services, status and authority sources; an observation time | The attestation checks of the report: `nativeAttestationSignature`, `anchorSignature`, `anchorKeyDerivation`, `anchorDigestAndMetadataBinding`, plus `subjectBinding`, `issuerAuthority` and `evidenceAvailability` as they apply |

## What you reproduce

1. **The canonical bytes** of a claim: a refusing subset of JCS (keys sorted by code unit, no whitespace, strings and safe integers only, anything else refused), the complete signed claim as the secured representation, and its SHA-256 as the digest the anchor commits to.
2. **The claim signature** under the claim's own derivation, verified against the issuer's `did:key`, which decodes to a compressed key or is refused.
3. **The anchor's exact layout**: the prefix `bsv-attestation-anchor-v1`, nine framed fields, the service signature over the length-framed preimage, exactly five `OP_2DROP`, the locking key equal to the service key's child for the anchor protocol and the attestation identifier. A shifted boundary, an uncompressed key, a malformed tail, an oversize field or a wrong tail is a refusal at the push.
4. **The binding**: the anchor's digest equals the digest of the supplied secured bytes, and its issuer, subject, type, representation and media type match the claim; a mismatch is `digest-mismatch` or `metadata-mismatch`; absent secured bytes are `secured-bytes-absent`, never a pass.
5. **The historical format** `uora-anchor-v3` under its own document, if you claim to read it, with its own digest contract and its own refusals, and `uora-anchor-v2` refused outright.
6. **The separation**: a valid anchor establishes the service's commitment; the truth of the claim, the issuer's authority and current status are separate checks with their own reasons.

## The minimal runnable path

Load `fixtures/attestation-anchor-v1.json`. Recompute the representation bytes of `claim` and check them against `representationBytes`; verify the claim signature under the issuer's key; decode `lockingScript` to the nine fields and the signature; verify the service signature and the derived locking key; check the digest and every metadata field against the claim. Then run the vectors under `fixtures/vectors/dpp/attestation-anchor/v1.json` (2 positive, 6 refusal: signature tampering, shifted boundaries, uncompressed key, malformed UTF-8, invalid tails). Then `fixtures/anchor-v3.json` and its 12 refusal vectors if you claim the historical format. Then the anchor and claim cases of `fixtures/evidence-v1.json`: the portable anchor with and without an authority policy, tampered secured bytes, mismatched metadata, an unsupported representation, absent secured bytes.

## Expected results

Every positive vector reproduces the pinned digest, preimage, locking key and script; every refusal is refused at the named point; the report's anchor checks equal the pinned reports. `issuerAuthority` is `unknown` with `policy-missing` when you were given no policy, and `credentialStatus` is `not-applicable` with `format-defines-no-status` for a native claim.

## What a verifier never does

Read attribution as authority. Read an anchor's existence as the claim's truth. Alias a historical prefix to the current format. Pass a check whose evidence was absent.
