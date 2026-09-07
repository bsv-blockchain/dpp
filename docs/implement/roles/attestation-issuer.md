# Attestation issuer

An issuer signs a lifecycle claim, such as a repair assessment, without changing the passport's control. Prepare the product identifier, event information, selected claim/profile version and issuer signing adapter. Use the identifier of the product actually being assessed, not whichever record a lookup happened to return.

## Sign and check one claim

Run the [issuer quick start](../../quick-start.md#attestation-issuer). It loads an unsigned fixture claim, signs it using a published test key, compares the complete signed result with the fixture and checks the signature.

Expect the assertion checks to pass and the matching-claim message to print. The resulting object is a signed claim. Registry storage and blockchain commitment are subsequent operations.

## Add it to an application

For the native format, `signLifecycleClaim` receives the unsigned claim and a signing adapter. The fixture exposes `unsignedClaim` and `issuerPrivateKey` to make the test repeatable. An application supplies its own authorised signing access; it does not reuse the fixture key.

Preserve the secured representation returned by signing. Send it to the [verifier](attestation-verifier.md) and the [registry](registry.md) as required by the workflow. Reformatting or removing content after signing can change the bytes another component is expected to verify or commit to.

Use [external credentials](../../interoperability/external-credentials.md) when the receiver requires that representation. An issuer's identity and its authority to make the claim remain separate evidence questions. Live identity assurance is Ring 0; higher rings are absent.

## Exact implementation sources

- [spec/rules.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/rules.md)
- [spec/identity.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/identity.md)
- [fixtures/attestation-anchor-v1.json](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/fixtures/attestation-anchor-v1.json)

Use [evidence reporting](../reporting.md) for results. [Source gaps](../fixture-runner.md#source-gaps) remain open.
