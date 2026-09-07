# Author and propose a profile

Start from the [profile source](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/profiles.md) and the schema for the profile kind:

| Kind | Schema |
|---|---|
| Industry | [Industry manifest](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-profiles/schemas/profile-manifest-v2.schema.json) |
| Exchange | [Exchange profile](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-profiles/schemas/exchange-profile.schema.json) |
| Operator | [Operator profile](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-profiles/schemas/operator-profile.schema.json) |
| Interoperability | [Interoperability profile](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-profiles/schemas/interoperability-profile.schema.json) |

From the repository root, run the existing generation and test commands:

```sh
npm run build -w @bsv/dpp-profiles
npm run test -w @bsv/dpp-profiles
```

The [package guide](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-profiles/README.md) describes the manifest workflow. For a reviewed freeze change, its workspace command is `npm run refreeze -w @bsv/dpp-profiles`; the [workspace manifest](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-profiles/package.json) defines it.

Submit the manifest and its tests through the [governance process](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/GOVERNANCE.md). Keep source assessment and product claims in the [ledger](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/manifest.json). [Report disagreements](../contribute/disagreements.md) instead of inventing missing source requirements.

Profile repository home: open; see [D-CR5](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L182).
