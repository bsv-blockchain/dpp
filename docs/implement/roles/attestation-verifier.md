# Attestation verifier

An attestation verifier checks a signed claim about a product and, when supplied, the blockchain commitment to that claim. It needs the secured claim, its expected subject and the selected representation. Anchor checks additionally need the anchor output and exact secured bytes. Authority, status and inclusion need their own evidence sources.

## Run the reference exercise

After [setup](../../quick-start.md#prepare-the-checkout), run:

```sh
node examples/verify-attestation-anchor.mjs
```

Expect separate checks for the native claim and its anchor, with altered inputs refused. This is synthetic evidence. It does not establish that the issuer has authority or that the claimed event happened.

## Build the verifier

Keep the received secured bytes before decoding the claim. Select the verifier by representation; native claims and external credentials do not use interchangeable proof rules. Compare the independently expected product identifier with the signed subject.

Check the claim signature, then evaluate the supplied anchor and its binding to the secured representation. Keep each result separate. A valid claim without an anchor is not a completed anchor check; a valid anchor without the claim cannot establish its contents.

Run the native fixture's altered-signature, altered-metadata and altered-bytes cases. Then use the report fixtures to test missing evidence and subject substitution. Add [external credentials](../../interoperability/external-credentials.md) only for the representations the implementation supports.

Present the [individual report findings](../../learn/evidence-and-freshness.md), including unknown authority or inclusion. The application can apply its policy to those findings without hiding them.

## Exact implementation sources

- [spec/rules.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/rules.md)
- [spec/identity.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/identity.md)
- [spec/verification.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/verification.md)
- [fixtures/attestation-anchor-v1.json](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/fixtures/attestation-anchor-v1.json)

Use [evidence reporting](../reporting.md) for results. [Source gaps](../fixture-runner.md#source-gaps) remain open.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../../learn/identity-and-authority.md).
