# Deploy and operate

Operators can use this page to plan service ownership, provider access, deployment and recovery. You can operate one standard role without operating every role.

## Deployment inputs

| Input | Obtain from |
|---|---|
| Intended operations and service owners | Your application's operating plan; [choose packages and services](../start/choose-components-and-services.md) explains the choices. |
| Service URLs, network, trusted keys and access settings | Each service's operator; the [hosted reference](../deployment.md) lists existing endpoints and restrictions. |
| Package or source selection | Exact installed versions, publication receipt or checkout revision in [release sets](../reference/release-sets.md). |
| Deployment evidence | The service's capability document and the provider's operating commitments. |

Public read access does not imply submission, callback or export access.

## Record services and access

1. Assign each required responsibility. One organisation may supply several.

| Service | Minimum responsibility |
|---|---|
| Index | Admit records under its policy, answer lookups, retain evidence and protect write routes. |
| Wallet and broadcaster | Hold signing keys and funds, construct and send transactions, and arrange later proof delivery. |
| Registry | Validate, store and retrieve claims and their exact bytes; validation alone is not the full role. |
| Header source | Supply block headers for checking merkle paths, with credentials and quota suited to the workload. |

2. Record the selected version at each boundary.

| Boundary | Record |
|---|---|
| Source | Checkout revision and candidate release. A feature on `main` may be unpublished. |
| Published | Exact package versions and publication evidence. |
| Deployed | Service URL, reported version, enabled features and access. Publication does not establish a hosted upgrade. |

3. Confirm ownership, access and recovery duties with each provider. Stop before deployment if a required owner, trusted key or credential is unresolved.
4. Follow the relevant guide below and retain its completion evidence.

| Task | Guide | Check before moving on |
|---|---|---|
| Run a new reference index | [Create an index](../packages/create-dpp-index.md), with the runtime included | Network, admitted keys, trusted policy, tokens, persistent storage and evidence checking |
| Make live writes and proof delivery reliable | [Wallet, broadcast and proofs](wallet-broadcast-proofs.md) | Funding, operation recovery and responsibility for sending later proofs to every relevant index |
| Exchange records with another index | [Federation](federation.md) | Direction of synchronisation, compatible admission, record agreement and operator independence |
| Retain and recover evidence | [Export, import and recovery](export-import-recovery.md) | Complete rather than bounded history, snapshot expiry, trust keys and separate recovery of restricted data and secrets |
| Supply a registry | [Registry implementation](../implement/roles/registry.md) | The complete selected role, including storage and retrieval; no released registry image is available |
| Prepare a production release | [Production readiness](production-readiness.md) | Evidence for the chosen product and operating model, with owners for outstanding dependencies |

The starter handles the index runtime dependency; you do not separately install `@bsv/dpp-overlay`. Its guide records the publication prerequisite. Direct installation and the repository's deployment recipe are [advanced alternatives](../packages/dpp-overlay.md).

Check [known limitations](limitations.md) against the deployed release or source revision; source features may be absent from hosted services.

When upgrading, use the [migration guide](../migration.md) and the evidence for the [selected release](../reference/release-sets.md).
