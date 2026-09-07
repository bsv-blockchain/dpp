# Run the interoperability trial

The [independent implementation trial](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/demonstrations/independent-implementation-2026-09.json) is defined; it has not been completed. Its scenario conditions and required evidence stay in that source.

Prepare the [selected components](README.md), their [fixture results](fixture-runner.md) and [provenance record](reporting.md). Then work through the source scenarios, retaining the inputs, responses and evidence each identifies.

Use the [service contracts](../reference/contracts.md) to drive the reference side. A driver supplies data to the independent implementation; it does not replace that implementation's verification.

## Prepare an exchange

Agree the roles, record and profile versions, endpoint addresses and publisher policies with the other participant. Each implementation first runs its own fixture checks and retains its authorship and dependency record.

Then exchange newly created records. One participant produces evidence; the other retrieves and verifies it using its own logic. Reverse the direction where both implement the role. Retain the requests, exact artefacts and per-check reports so a disagreement can be reproduced.

Exercise missing evidence and an unavailable provider as well as the successful path. A recovery exercise needs retained exports and a replacement service, not merely a second view of the first service's database.

The trial definition supplies the formal scenario selection. Its completion is still open. A successful local rehearsal is useful preparation and is reported as that.

| Preparation | Guide |
|---|---|
| Peer operation and its limits | [Federation](../operate/federation.md) |
| Export, replacement provider and key availability | [Recovery](../operate/export-import-recovery.md) |
| Wallet and proof handling | [Broadcast and proofs](../operate/wallet-broadcast-proofs.md) |
| Current delivery evidence | [Status](../start/status.md) |

Local synthetic exchanges do not establish separately administered operation or mined inclusion. The [ledger](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json) records the remaining evidence gaps.
