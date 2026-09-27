# Wallet, broadcast and proofs

A Bitcoin Request for Comments (BRC) identifies an ecosystem protocol. The reference writer uses a BRC-100 wallet interface. Its wallet, broadcaster, index and header source have separate roles.

## Follow one write

| Step | Component and result to retain |
|---|---|
| Construct and sign | The wallet produces the unsent transaction; the writer checks it before sending. |
| Announce | The index evaluates the draft and returns its admission result. |
| Broadcast | The wallet or its configured broadcaster sends the transaction and reports the network response. |
| Obtain a proof | The writer retrieves the mined transaction's merkle path, or arranges the broadcaster callback. |
| Ingest the proof | `POST /arc-ingest` lets the index validate and associate the proof with its retained transaction. |
| Read again | The reader evaluates the supplied evidence against its header source. |

BEEF means Background Evaluation Extended Format, a transaction-evidence encoding used by these interfaces. A merkle path connects a transaction to a block's merkle root; the header source is needed to evaluate that root in the selected chain.

Start with `node examples/write-passport.mjs --dry-run` after [setup](../quick-start.md#prepare-the-checkout). The live example needs a locally available BRC-100 wallet, the intended passport identifier and index URL, plus the index's submission and callback credentials. It performs a version 1 activation; it is not a version 2 transfer recipe.

## Choose a wallet

The writer needs a BRC-100 wallet. The standard names the interface, not a product, and two arrangements satisfy it.

| Arrangement | What it is | What it needs |
|---|---|---|
| A wallet application on the developer's machine | The writer example constructs `WalletClient('auto')` from `@bsv/sdk`, which finds a BRC-100 wallet running locally, such as BSV Desktop or BSV Browser, and asks it for the identity key, the passport's owner key, the signatures and the broadcast. The wallet holds the keys and the funds; the example holds nothing. | The wallet installed, unlocked and funded through its own receive flow; the index address and credentials the example takes as arguments |
| A wallet the service owns | A hosted writer, and a registry that anchors, run `@bsv/wallet-toolbox`, a BRC-100 wallet as a library, with storage the service controls: SQLite or MySQL in process, or `@bsv/wallet-toolbox-client` against a wallet storage server such as the stack's wallet infrastructure reference. | A root key kept as a secret, the storage backend or storage address, the network, funds paid into that wallet, and the toolbox's services layer for an ARC-compatible broadcaster, headers and the monitor that attaches merkle paths |

The reference deployment uses the second arrangement: the client package against a storage server, with the root key supplied from the environment. Nothing in the standard requires that choice, only that the wallet answers the BRC-100 interface and that the writer keeps the retained transaction, its BEEF and its proof. A root key alone is not a wallet backup; the toolbox's recovery guides say what else to keep.

| Source | Use |
|---|---|
| [BRC-100 wallet interface](https://bsv-blockchain.github.io/ts-stack/specs/brc-100-wallet/) | The methods the writer calls: `getPublicKey`, `createAction`, `signAction`, `listOutputs` |
| [Wallet-aware application guide](https://bsv-blockchain.github.io/ts-stack/guides/wallet-aware-app/) | Connecting to a local wallet through `WalletClient` |
| [Wallet toolbox](https://bsv-blockchain.github.io/ts-stack/packages/wallet/wallet-toolbox/) and its [README](https://github.com/bsv-blockchain/ts-stack/blob/83a7117b8a02aa16d5a364f186449292810adbd8/packages/wallet/wallet-toolbox/README.md) | Storage backends, services, monitor, funding and recovery |
| [Wallet infrastructure](https://bsv-blockchain.github.io/ts-stack/infrastructure/wallet-infra/) | The storage server a client-package wallet can use |

## Handle interruptions

If admission refuses the draft, inspect the record and policy before broadcast. If a transaction was already sent but indexing failed, retry the announcement of that transaction. If the network refuses an admitted draft, retract it under the service contract.

A later proof arriving at one index does not establish that every peer has it. Check the operator the reader actually queries. A scripts-only development setting skips header verification and cannot establish inclusion.

## Source definitions

| Integration task | Source |
|---|---|
| Supply a wallet and invoke the writer | [Writer example](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/examples/write-passport.mjs) |
| Implement the writer's operational duties | [Writing source](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/writing.md) |
| Interpret admission, proof ingestion and retraction | [Overlay contract](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/overlay.yaml) |
| Interpret inclusion or unavailable headers | [Verification report](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/verification.md) |

Use the [dry run](../quick-start.md#writer) before a funded operation. Keep the operation journal and the retrieved proof with the transaction evidence. An index accepting a draft does not establish broadcast or mining.

For a delayed proof, determine which service has the evidence and which operator still needs it. For a refused spend or a reorganisation, follow the contract's retraction and verification behaviour. The guide does not promise a mining window.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).
