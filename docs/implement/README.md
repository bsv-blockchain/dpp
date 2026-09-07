# Start an independent implementation

Start with the [native baseline](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/baseline-native-2.json), then [choose a role](../start/choose-a-role.md). A baseline selects the requirements and fixtures for that role. The [independence source](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/conformance.md) and [governance source](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/GOVERNANCE.md) determine what may be shared with the reference implementation.

## Obtain the source material

Use the [pinned checkout](../packages/README.md#source-access) for source material. To assemble a data-only bundle, run the [bundle assembler](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/scripts/implementer-bundle.mjs) from a repository checkout:

```sh
node scripts/implementer-bundle.mjs
```

The output is `release/implementer-bundle/`, with an archive beside it. `bundle-manifest.json` records the source revision, working-tree state, release selection and file digests. The linked source revision's assembler carries only the implementer pages. Keep its full checkout for the other guides.

| Material | Source |
|---|---|
| Rules and participation | [Specification index](../reference/specifications.md), [governance](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/GOVERNANCE.md) |
| Interfaces | [Contracts](../reference/contracts.md) |
| Bytes and test cases | [Fixtures](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/fixtures/README.md) |
| Selected requirements and evidence | [Ledger](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/manifest.json) |
| Profile data | [Frozen profiles](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-profiles/frozen.json) |

## Build and report

Set up [the fixture harness](fixture-runner.md), then follow the reader, verifier and other selected role guides. Record authorship, source revision and shared dependencies with [the results](reporting.md). Use [the trial](demonstration.md) after the component can exchange fresh records.

Source precedence and canonicalisation have [named gaps](fixture-runner.md#source-gaps).
