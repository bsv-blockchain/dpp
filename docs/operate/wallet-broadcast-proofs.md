# Wallet, broadcast and proofs

A Bitcoin Request for Comments (BRC) identifies an ecosystem protocol. The reference writer uses a BRC-100 wallet interface. Its wallet, broadcaster, index and header source have separate roles.

| Integration task | Source |
|---|---|
| Supply a wallet and invoke the writer | [Writer example](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/examples/write-passport.mjs) |
| Implement the writer's operational duties | [Writing source](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/writing.md) |
| Interpret admission, proof ingestion and retraction | [Overlay contract](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/overlay.yaml) |
| Interpret inclusion or unavailable headers | [Verification report](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/verification.md) |

Use the [dry run](../quick-start.md#writer) before a funded operation. Keep the operation journal and the retrieved proof with the transaction evidence. An index accepting a draft does not establish broadcast or mining.

For a delayed proof, determine which service has the evidence and which operator still needs it. For a refused spend or a reorganisation, follow the contract's retraction and verification behaviour. The guide does not promise a mining window.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).
