# Passport reader

A reader answers what the supplied passport history establishes about the product the caller asked for. It needs the expected identifier, the transaction history and the publisher/profile policy. Inclusion checks also need proofs and a header source. Missing evidence remains visible in the result.

## Run the reference exercise

After [setup](../../quick-start.md#prepare-the-checkout), run:

```sh
node examples/verify-passport.mjs --fixture --version=2 --report
```

Expect the valid history to pass, the refusal cases to be rejected and the expected reports to match. Synthetic inclusion remains pending. [Reading a report](../../learn/evidence-and-freshness.md) explains the checks, observations and limits.

## Build the reader

1. Parse the transaction and locate the passport output. Keep the output index; the passport output is not always the first output.
2. Decode the record under its own version and reproduce the signing inputs from the record fixture. Check signatures under the selected keys and policy.
3. Build the history from actual spent outpoints, then check transitions and control. Test a broken link and a changed controller as well as a valid history.
4. Compare the evidence with the independently supplied subject. Evaluate available proofs against the header source and keep latest-state observations separate.
5. Return the per-check report. Run the report fixtures before adding a user interface or an application decision.

Use `record-v2.json` for one output, `chain-v2.json` for history and refusals, and `evidence-v2.json` for reports. [The fixture harness](../fixture-runner.md) explains how to load them. Add version 1 and upgrade cases for mixed histories.

For live retrieval, use [the overlay request](../../reference/contracts.md#find-passport-records). The index supplies candidates; the reader still verifies what it receives.

## Exact implementation sources

- [spec/record-model.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/record-model.md)
- [spec/record-model-v2.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/record-model-v2.md)
- [spec/verification.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/verification.md)
- [fixtures/README.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/fixtures/README.md)

Use [evidence reporting](../reporting.md) for results. [Source gaps](../fixture-runner.md#source-gaps) remain open.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../../learn/identity-and-authority.md).
