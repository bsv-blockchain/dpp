# Conformance and the ledger

Reviewers, auditors and implementers can trace the reference implementation's conformance claims to evidence and run two ledger checks. For your own implementation, use [requirements and evidence reporting](../implement/reporting.md).

## Before running the checks

For optional execution:

| Input | Source or requirement |
|---|---|
| Reviewed source checkout | [Get the code](../quick-start.md#get-the-code); run from its root. |
| Installed dependencies and build | Run `npm ci` and `npm run build` in that checkout before the checks. |
| Selection | Current release's `conformance/selections/dpp-release-2026-11.json` in the checkout. |

## Words used here

| Word | Meaning |
|---|---|
| Requirement | One rule from a specification, with its layer and the roles it binds. |
| Ledger | [`conformance/manifest.json`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json): every requirement with its source, the code and tests behind it, retained evidence and a status such as `tested`, `implemented`, `gap` or `unassessed`. Each source is pinned by its digest. |
| Baseline | One complete recommended selection of the current native formats, for example [`conformance/baseline-native-2.json`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/baseline-native-2.json). |
| Claim | A release's conformance statement, separate from a signed product claim, such as "a passport reader conforms to `native-baseline@1`", which is true only if every requirement row it needs is tested or better. |
| Selection | The claims one release requires and the claims it withholds, for example `conformance/selections/dpp-release-2026-11.json` for the current release. |
| Withheld | A claim the release deliberately does not make, with the reason. Withheld claims are part of the result, not a failure. |

The [ledger schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.schema.json) defines the fields and statuses; the [conformance specification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/conformance.md) and [governance](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/GOVERNANCE.md#conformance-reporting) define how a claim is made and reported.

## Run the checks

1. Run the diagnostic and qualification gate:

```sh
node conformance/check.mjs
node conformance/qualify.mjs conformance/selections/dpp-release-2026-11.json
```

2. Read the expected outputs:

| Check | Output and conclusion |
|---|---|
| Diagnostic, first command | About 170 lines, one finding each. Checks the ledger, baseline, reports and capability example against one another and their pinned sources. |
| Qualification gate, second command | One line per required claim and seven `withheld:` lines with reasons, including federated operation, European conformity, battery product qualification and version 1.0 readiness. Checks the named selection against the ledger. |

The diagnostic ends:

```
The ledger, baseline, reports and capability example are consistent.
```

The qualification gate ends:

```
Selection dpp-release-2026-11 is qualified: every required claim can be made on the ledger's evidence. This is the ledger's answer, not a conformity certificate.
```

3. Confirm both exit 0 for the assessed checkout. Stop if either exits non-zero; it names the failed finding.

## Read the result

| Result | Meaning and limit |
|---|---|
| Consistent ledger | Evidence records agree with their sources. |
| Qualified selection | The release's required claims can be made on that evidence. Read withheld claims as part of the result: a release can qualify while independent operation stays withheld. |
| Diagnostic source digest mismatch | A pinned source changed after assessment. This alone does not show whether the file is right or wrong. A reviewer confirms the assessment still holds and re-pins, as [how the standard changes](../contribute/README.md) describes. |

Neither check assesses another implementation or replaces running its own tests against the fixtures. Keep the command, source revision and output with any report citing them.

Next: [requirements and evidence reporting](../implement/reporting.md) for your own implementation, or [where things stand](../start/status.md) for the delivery overview.
