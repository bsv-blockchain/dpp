# Wallet, broadcast and proofs

Writers and operators can use this page to retain transaction evidence and deliver proofs to readers' indexes. The reference writer uses a BRC-100 wallet; its wallet, broadcaster, index and header source have separate duties. Bitcoin Request for Comments (BRC) identifies an ecosystem protocol.

## Before a dry run or live write

| Mode | Required inputs and their source |
|---|---|
| Dry run | Node 22 or later; a checkout after [setup](../quick-start.md#get-the-code), `npm ci` and `npm run build`. No funded wallet needed. |
| Live example | A locally available BRC-100 wallet, unlocked and funded through its receive flow; the intended passport identifier from your application; your index's URL, submission token and callback token from its operator. |
| Proof delivery to several indexes | Each destination's URL and its own callback token, supplied by that index's operator. |
| Service-owned wallet | Secret root key, controlled SQLite/MySQL backend or wallet-storage address, network and funds; toolbox services for an ARC-compatible broadcaster, headers and a monitor attaching merkle paths. |

## Follow one write

1. Run `node examples/write-passport-v2.mjs --dry-run` before a funded operation ([dry run](../quick-start.md#write-a-passport-without-spending-anything), [write a passport](../packages/build-an-application.md#3-write-a-passport)). Stop and resolve any failed check before writing live. The live example writes a version 2 `ISSUE` and `UPDATE`; `examples/write-passport.mjs` does the same for a version 1 activation.
2. Follow the transaction through each component and retain its result:

| Step | Component and result to retain |
|---|---|
| Construct and sign | The wallet produces the unsent transaction; the writer checks it before sending. |
| Announce | The index evaluates the draft and returns its admission result. |
| Broadcast | The wallet or its configured broadcaster sends the transaction and reports the network response. |
| Obtain a proof | The writer retrieves the mined transaction's merkle path, or arranges the broadcaster callback. |
| Ingest the proof | `POST /arc-ingest` lets the index validate and associate the proof with its retained transaction. Each index guards the route with its own callback token. |
| Read again | The reader evaluates the supplied evidence against its header source. |

BEEF (Background Evaluation Extended Format) encodes transaction evidence. A merkle path connects a transaction to a block's merkle root; the header source checks that root in the selected chain.

3. Send each index only its own callback token. A token sent elsewhere is refused and exposes a secret to the wrong operator.
4. Keep the operation journal, retained transaction, its BEEF and retrieved proof. Check the evidence at the index readers actually query. Admission establishes neither broadcast nor mining; a later proof at one index does not establish that every peer has it.

Retain that evidence with either wallet arrangement. No mining window is promised.

## Choose a wallet

The writer needs a BRC-100 wallet. The standard names the interface, not a product, and two arrangements satisfy it.

| Arrangement | What it is | What it needs |
|---|---|---|
| Local wallet application | The example's `WalletClient('auto', 'localhost')` from `@bsv/sdk` finds a local BRC-100 wallet, such as BSV Desktop or BSV Browser, and requests the identity key, passport owner key, signatures and broadcast. | Live-example inputs above. The wallet holds keys and funds; the example holds neither. |
| Service-owned wallet | Hosted writers and anchoring registries run the BRC-100 library `@bsv/wallet-toolbox`, with in-process storage or `@bsv/wallet-toolbox-client` against a storage server such as the stack's wallet infrastructure reference. | Service-owned inputs above; storage stays under the service's control. |

| Compatibility or build requirement | Rule |
|---|---|
| Current release set | `@bsv/sdk` 2.8.10; `@bsv/wallet-toolbox` 2.14.3 and `@bsv/wallet-toolbox-client` 2.14.3 install beside that single version. |
| Earlier toolbox versions | Some declare an older SDK range but call methods introduced in SDK 2.8.0. Installation can succeed while sending or receiving fails. Choose the named version or check the toolbox's changes. |
| Module formats | `@bsv/wallet-toolbox` uses CommonJS and the SDK's CommonJS build. DPP packages use ES modules and its ES module build, so one process holds two SDK instances even with one installed version. `@bsv/wallet-toolbox-client` also ships an ES module build, loaded by an ES module application. |
| Values crossing the wallet boundary | Exchange transactions, BEEF, scripts and keys as bytes or hex, as BRC-100 does. Build SDK objects needed by DPP packages from the application's own `@bsv/sdk` import. |
| SQLite backend | Uses native `better-sqlite3`. In a slim Node container it compiles on install: provide Python, `make` and a C++ compiler in the build stage; the runtime can copy the result. |
| npm 11 install scripts | Approve the held-back script with `npm install-scripts approve better-sqlite3`. |

The reference deployment uses the client package against a storage server, with an environment-supplied root key. The standard requires the BRC-100 interface, not that arrangement. A root key alone is not a wallet backup; follow the toolbox's recovery guides.

| Source | Use |
|---|---|
| [BRC-100 wallet interface](https://bsv-blockchain.github.io/ts-stack/specs/brc-100-wallet/) | The methods the writer calls: `getPublicKey`, `createAction`, `signAction`, `listOutputs` |
| [Wallet-aware application guide](https://bsv-blockchain.github.io/ts-stack/guides/wallet-aware-app/) | Connecting to a local wallet through `WalletClient` |
| [Wallet toolbox](https://bsv-blockchain.github.io/ts-stack/packages/wallet/wallet-toolbox/) and its [README](https://github.com/bsv-blockchain/ts-stack/blob/83a7117b8a02aa16d5a364f186449292810adbd8/packages/wallet/wallet-toolbox/README.md) | Storage backends, services, monitor, funding and recovery |
| [Wallet infrastructure](https://bsv-blockchain.github.io/ts-stack/infrastructure/wallet-infra/) | The storage server a client-package wallet can use |

## Handle interruptions

| Interruption | Action |
|---|---|
| Admission refuses the draft | Do not broadcast. `X-Admission-Refusal` names the failed check; [admission refusal guidance](../packages/build-an-application.md#when-the-index-refuses-a-state) explains each code. |
| Transaction sent, indexing failed | Retry announcement of that same transaction. |
| Network refuses an admitted draft | Retract it with the request below. |
| Delayed proof | Find which service holds it and which operator still needs it, then deliver it there. |
| Refused spend or reorganisation | Follow the contract's retraction and verification behaviour. |

For retraction, send JSON to `POST /retract` using that index's submit bearer token:

| Required field | Value |
|---|---|
| `txid` | Transaction identifier, 64 lowercase hexadecimal characters. |
| `outputIndex` | Non-negative output index. |
| `reason` | The writer's account of the network response, 1 to 1000 characters; logged and echoed, not interpreted. |

An accepted request returns HTTP 200 with `status: retracted`; any predecessor becomes the tip again. The contract refuses retraction of a proven, network-known or spent output with 409 `retraction-refused`. It returns 503 `chain-tracker-unavailable` without applying the change if it cannot ask the network. A scripts-only development setting skips header verification and cannot establish inclusion; its retraction response has `networkChecked: false`.

## Source definitions

| Integration task | Source |
|---|---|
| Supply a wallet and invoke the writer | [Writer example](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/examples/write-passport.mjs) |
| Implement the writer's operational duties | [Writing source](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/writing.md) |
| Interpret admission, proof ingestion and retraction | [Overlay contract](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/contracts/overlay.yaml) |
| Interpret inclusion or unavailable headers | [Verification report](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/verification.md) |
