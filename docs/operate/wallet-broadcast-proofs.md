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
