# Reference deployment

The [operator start](operate/README.md) runs the supplied Compose preset. It is a reference arrangement. Shared deployment remains open; see [D-CR7](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L183).

## Place each component

The reference deployment contains an index and MongoDB. A client or application service supplies wallet operations, submits records and asks the index for evidence. An attestation registry is a separate service. A header source supplies the block-header evidence used for inclusion checks.

The index holds the publisher's public identity key. A writer's wallet holds signing access. An optional export key signs the archive produced by this operator; it does not sign passport states. Keep those roles separate when configuring a deployment.

## Deploy in steps

Start the index using [the Compose instructions](operate/README.md), check its capabilities and make a lookup. Next connect a writer on the same network and under the expected publisher policy. Exercise admission, broadcast response and later proof ingestion before relying on the record being retrievable with inclusion evidence.

Add a registry only when the workflow needs stored claims. Add peers after one operator can admit, retrieve and export the intended records. [Federation](operate/federation.md) covers the second instance and [recovery](operate/export-import-recovery.md) covers the retained evidence needed to replace one.

The MongoDB volume is service storage; it is not itself an independently administered replica. Header-storage size, mining delay and synchronisation latency are unmeasured here.

## Configuration sources

| Configure | Source |
|---|---|
| Index and database containers | [Compose preset](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/deploy/compose.yml) |
| Environment and policy files | [Environment example](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/deploy/operator.env.example), [host configuration](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/overlay-topics/src/index.ts) |
| Wallet, broadcast and proof retrieval | [Integration guide](operate/wallet-broadcast-proofs.md) |
| Another operator | [Federation](operate/federation.md) |
| Retention and replacement provider | [Recovery](operate/export-import-recovery.md) |

Check health and capabilities after starting the service, then exercise submission and retrieval under the selected contract. Keep the observed results separate from the deployment's configuration.

Header-storage size, mining delay and synchronisation latency are unmeasured here. The [ledger](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json) records local tests and the remaining deployment evidence gaps. [Durable publication](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json#L3769) has ledger status `gap`.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](learn/identity-and-authority.md).
