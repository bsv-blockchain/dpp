# Run the interoperability trial

The [independent implementation trial](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/demonstrations/independent-implementation-2026-09.json) is defined; it has not been completed. Its scenario conditions and required evidence stay in that source.

Prepare the [selected components](README.md), their [fixture results](fixture-runner.md) and [provenance record](reporting.md). Then work through the source scenarios, retaining the inputs, responses and evidence each identifies.

Use the [service contracts](../reference/contracts.md) to drive the reference side. A driver supplies data to the independent implementation; it does not replace that implementation's verification.

| Preparation | Guide |
|---|---|
| Peer operation and its limits | [Federation](../operate/federation.md) |
| Export, replacement provider and key availability | [Recovery](../operate/export-import-recovery.md) |
| Wallet and proof handling | [Broadcast and proofs](../operate/wallet-broadcast-proofs.md) |
| Current delivery evidence | [Status](../start/status.md) |

Local synthetic exchanges do not establish separately administered operation or mined inclusion. The [ledger](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/manifest.json) records the remaining evidence gaps.
