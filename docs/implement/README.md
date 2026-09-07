# Start an independent implementation

An independent implementation reproduces the record and evidence behaviour in separately written code. Calling the reference service from a different interface still uses the reference implementation.

Start with a reader or verifier before adding a writer or service. This gives the implementation a way to inspect the records it later creates or receives. The [model](../start/architecture.md) explains the components; the [reader guide](roles/passport-reader.md) supplies the first exercise.

Start with the [native baseline](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/baseline-native-2.json), then [choose a role](../start/choose-a-role.md). A baseline selects the requirements and fixtures for that role. The [independence source](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/conformance.md) and [governance source](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/GOVERNANCE.md) determine what may be shared with the reference implementation.

## Obtain the source material

Use the [pinned checkout](../packages/README.md#source-access) for source material. To assemble a data-only bundle, run the [bundle assembler](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/scripts/implementer-bundle.mjs) from a repository checkout:

```sh
node scripts/implementer-bundle.mjs
```

The output is `release/implementer-bundle/`, with an archive beside it. `bundle-manifest.json` records the source revision, working-tree state, release selection and file digests. The current assembler includes all public guides alongside the specifications, contracts, fixtures and governance. A full checkout is needed to run the reference examples; the data-only bundle contains no runtime implementation.

| Material | Source |
|---|---|
| Rules and participation | [Specification index](../reference/specifications.md), [governance](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/GOVERNANCE.md) |
| Interfaces | [Contracts](../reference/contracts.md) |
| Bytes and test cases | [Fixtures](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/fixtures/README.md) |
| Selected requirements and evidence | [Ledger](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json) |
| Profile data | [Frozen profiles](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/dpp-profiles/frozen.json) |

## First milestone

Read `fixtures/record-v2.json` as test data. Build a decoder that reproduces its expected fields, then reproduce its actor and publisher signing inputs. A decoder succeeding on one output is only the starting point: the next fixture adds predecessor links and refusal cases.

Keep the harness in the implementation's own language. Record the input fixture, expected result and actual result for each case. The [fixture guide](fixture-runner.md) explains the progression from one record to complete evidence reports.

## Build and report

Set up [the fixture harness](fixture-runner.md), then follow the reader, verifier and other selected role guides. Record authorship, source revision and shared dependencies with [the results](reporting.md). Use [the trial](demonstration.md) after the component can exchange fresh records.

Source precedence and canonicalisation have [named gaps](fixture-runner.md#source-gaps).
