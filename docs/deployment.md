# Reference deployment

The [operator start](operate/README.md) runs the supplied Compose preset. It is a reference arrangement. Shared deployment remains open; see [D-CR7](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L183).

| Configure | Source |
|---|---|
| Index and database containers | [Compose preset](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/deploy/compose.yml) |
| Environment and policy files | [Environment example](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/deploy/operator.env.example), [host configuration](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/overlay-topics/src/index.ts) |
| Wallet, broadcast and proof retrieval | [Integration guide](operate/wallet-broadcast-proofs.md) |
| Another operator | [Federation](operate/federation.md) |
| Retention and replacement provider | [Recovery](operate/export-import-recovery.md) |

Check health and capabilities after starting the service, then exercise submission and retrieval under the selected contract. Keep the observed results separate from the deployment's configuration.

Header-storage size, mining delay and synchronisation latency are unmeasured here. The [ledger](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/manifest.json) records local tests and the remaining deployment evidence gaps. [Durable publication](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/manifest.json#L3769) has ledger status `gap`.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](learn/identity-and-authority.md).
