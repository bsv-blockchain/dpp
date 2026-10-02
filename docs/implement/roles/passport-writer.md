# Passport writer

A writer creates the next passport state, obtains wallet signatures, checks the resulting transaction and coordinates admission and broadcast. It needs the intended operation and payload, the preceding state for an existing passport, the selected custody/profile policy and a wallet that can perform the required action.

## Run without a wallet

After [setup](../../quick-start.md#get-the-code), run:

```sh
node examples/write-passport.mjs --dry-run
node examples/lifecycle-v2.mjs
```

The first command reproduces a version 1 fixture and refuses an invalid state before any network operation. The second exercises version 2 lifecycle behaviour. Neither funds or broadcasts a transaction.

## Connect the components

Validate the proposed payload under its selected industry profile. Obtain the prior record and confirm the operation is being built against the intended predecessor. Use the wallet to construct and sign, then run the reader's checks on the unsent result. [Choose a wallet](../../operate/wallet-broadcast-proofs.md#choose-a-wallet) names the wallets that satisfy the interface on a developer's machine and in a hosted service.

Keep admission, broadcast response and inclusion proof as separate entries in the operation journal. If an index is unavailable after a transaction was sent, retry indexing that transaction; creating another transaction would be a different action. If the network refuses an admitted draft, follow the retraction route for that draft.

Retain the transaction and the evidence needed to read it later. [Wallet, broadcast and proofs](../../operate/wallet-broadcast-proofs.md) explains the service sequence. [Custody](../../learn/custody.md) explains signing access and managed acceptance.

An independent writer implements its own construction and checks; a reference consumer uses the core package. In both cases, passing the fixture recipe leaves live wallet and service integration to exercise. [Build an application](../../packages/build-an-application.md#3-write-a-passport) writes each version 2 state with a BRC-100 wallet, from the issue to a managed transfer and a retirement, and [what a passport application offers](../../packages/what-an-application-offers.md) describes the screens and scheduled duties around the writer.

## Exact implementation sources

- [spec/writing.md](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/writing.md)
- [spec/record-model-v2.md](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/record-model-v2.md)
- [spec/custody.md](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/custody.md)
- [fixtures/README.md](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/fixtures/README.md)

Use [evidence reporting](../reporting.md) for results. [Source gaps](../fixture-runner.md#source-gaps) remain open.
