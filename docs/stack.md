# BSV stack integration

BSV means Bitcoin SV. The software development kit (SDK) supplies general blockchain primitives; DPP packages provide the passport-specific implementation. Installed versions are recorded in [the dependency ledger](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/licences.json) and [the release support table](packages/support-table.md).

| Integration task | Source |
|---|---|
| Scripts, keys, transactions and proofs | [Core package bindings](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-core/src/index.ts) |
| Wallet signing and broadcast | [Writer example](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/examples/write-passport.mjs), [writer duties](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/writing.md) |
| Topic admission, lookup and synchronisation | [Overlay package](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/overlay-topics/README.md), [stack components](https://github.com/bsv-blockchain/ts-stack/tree/83a7117b8a02aa16d5a364f186449292810adbd8/packages/overlays) |
| Credential verification | [VSC package](packages/vsc.md) |
| Reference dependency versions | [Locked dependencies](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/package-lock.json) |

Use the [stack source index](https://github.com/bsv-blockchain/ts-stack/blob/83a7117b8a02aa16d5a364f186449292810adbd8/README.md) to locate the selected component's documentation. An upstream capability does not establish that a DPP deployment uses it. The [operating limitations](operate/limitations.md) identify the reference host's discovery and proof-refresh gaps.

Object identifier derivation: open; see [D-CR2](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L181). Historical issuer formats: open; see [TD-12](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L209).
