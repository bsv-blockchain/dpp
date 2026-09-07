# @bsv/dpp-overlay-topics

Reference topic managers, lookup services and an HTTP host. Use the [support table](support-table.md) for versions and runtime dependencies.

| Integration | Source |
|---|---|
| Embed passport and attestation indexing | [Library exports](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/overlay-topics/src/lib.ts) |
| Run the HTTP service | [Host and configuration](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/overlay-topics/src/index.ts) |
| Serve or consume its interface | [Overlay contract](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/overlay.yaml) |
| Select storage and service adapters | [Package guide](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/overlay-topics/README.md) |

Importing the library does not start the host. Begin service setup at [Operate](../operate/README.md); use the [overlay role](../implement/roles/overlay.md) when building an independent implementation.

Read [operating limitations](../operate/limitations.md) before relying on synchronisation or recovery. New proof-bearing states and later proof updates to already-held states follow different paths in the reference host.
