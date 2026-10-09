# Conformance and the ledger

This page explains the requirement ledger, which records what the reference implementation claims and on what evidence, and the two commands that check it. It is for reviewers and auditors checking the reference's claims, and for implementers who want to see how a claim is traced; to report on your own implementation, go to [requirements and evidence reporting](../implement/reporting.md).

## Words used here

| Word | Meaning |
|---|---|
| Requirement | One rule from a specification, with its layer and the roles it binds. |
| Ledger | [`conformance/manifest.json`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json): every requirement with its source, the code and tests behind it, retained evidence and a status such as `tested`, `implemented`, `gap` or `unassessed`. Each source is pinned by its digest. |
| Baseline | One complete recommended selection of the current native formats, for example [`conformance/baseline-native-2.json`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/baseline-native-2.json). |
| Claim | A statement a release makes, such as "a passport reader conforms to `native-baseline@1`", which is true only if every requirement row it needs is tested or better. |
| Selection | The claims one release requires and the claims it withholds, for example `conformance/selections/dpp-release-2026-10-7.json` for the current release. |
| Withheld | A claim the release deliberately does not make, with the reason. Withheld claims are part of the result, not a failure. |

The [ledger schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.schema.json) defines the fields and statuses; the [conformance specification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/conformance.md) and [governance](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/GOVERNANCE.md#conformance-reporting) define how a claim is made and reported.

## Run the checks

From the root of the reviewed source checkout, after `npm ci` and `npm run build` ([get the code](../quick-start.md#get-the-code)):

```sh
node conformance/check.mjs
node conformance/qualify.mjs conformance/selections/dpp-release-2026-10-7.json
```

The first, the diagnostic, checks that the ledger, the baseline, the reports and the capability example are consistent with each other and with the sources they pin. It prints about 170 lines, one finding each, and ends:

```
The ledger, baseline, reports and capability example are consistent.
```

The second, the qualification gate, checks the named selection against the ledger. It prints one line per required claim, seven `withheld:` lines with their reasons (among them federated operation, European conformity, battery product qualification and version 1.0 readiness), and ends:

```
Selection dpp-release-2026-10-7 is qualified: every required claim can be made on the ledger's evidence. This is the ledger's answer, not a conformity certificate.
```

Both checks must exit 0 for the checkout being assessed. Each exits non-zero and names the finding when a check fails.

## Read the result

- The two commands answer different questions. A consistent ledger says the evidence records agree with their sources; a qualified selection says the release's required claims can be made on that evidence. Neither says anything about an implementation other than the reference, and neither replaces running that implementation's own tests against the fixtures.
- Read the withheld list as part of the result: a release can qualify while independent operation stays withheld.
- A source digest mismatch from the diagnostic means a pinned source changed after it was assessed. It does not by itself say the changed file is right or wrong; a reviewer confirms the assessment still holds and re-pins, as [how the standard changes](../contribute/README.md) describes.

Keep the command, the source revision and the output with any report that cites them. Next: [requirements and evidence reporting](../implement/reporting.md) for your own implementation, or [where things stand](../start/status.md) for the delivery overview.
