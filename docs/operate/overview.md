# Deploy and operate

Start by deciding which services your organisation owns and which it obtains from a provider. You can operate one standard role without operating every other role.

[Choose packages and services](../start/choose-components-and-services.md) explains those responsibilities. The [hosted reference](../deployment.md) gives the existing endpoints and access restrictions. Public read access does not imply submission, callback or export access.

| Task | Guide | Check before moving on |
|---|---|---|
| Run a new reference index | [Create an index](../packages/create-dpp-index.md), with the runtime included | Network, admitted keys, trusted policy, tokens, persistent storage and evidence checking |
| Make live writes and proof delivery reliable | [Wallet, broadcast and proofs](wallet-broadcast-proofs.md) | Funding, operation recovery and responsibility for sending later proofs to every relevant index |
| Exchange records with another index | [Federation](federation.md) | Direction of synchronisation, compatible admission, record agreement and operator independence |
| Retain and recover evidence | [Export, import and recovery](export-import-recovery.md) | Complete rather than bounded history, snapshot expiry, trust keys and separate recovery of restricted data and secrets |
| Supply a registry | [Registry implementation](../implement/roles/registry.md) | The complete selected role, including storage and retrieval; no released registry image is available |
| Prepare a production release | [Production readiness](production-readiness.md) | Evidence for the chosen product and operating model, with owners for outstanding dependencies |

The starter handles the index runtime dependency; you do not separately install `@bsv/dpp-overlay-topics`. Its guide records the publication prerequisite. Direct installation and the repository's deployment recipe are [advanced alternatives](../packages/dpp-overlay-topics.md).

Check [known limitations](limitations.md) against the exact package release or source revision you deploy. A feature on `main` may not be in a published package or running on a hosted service.

When upgrading, use the [migration guide](../migration.md) and the evidence for the [selected release](../reference/release-sets.md).
