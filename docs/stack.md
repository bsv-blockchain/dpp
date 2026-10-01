# BSV stack integration

BSV means Bitcoin SV. The software development kit (SDK) supplies general blockchain primitives; DPP packages provide the passport-specific implementation. Installed versions are recorded in [the dependency ledger](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/conformance/licences.json) and [the release support table](packages/support-table.md).

## Connect the layers

Use the SDK for general transaction, key and proof primitives. Use the DPP core package for passport-specific encoding and checks. Use a wallet for signing and broadcast access, the overlay package for indexing, and the profile or credential packages for the selected product and exchange formats.

For the first run, [the quick start](quick-start.md) builds those packages and exercises them locally. A service integration then adds an index URL, publisher policy and header source. [Wallet and proofs](operate/wallet-broadcast-proofs.md) shows where those components participate in one write. Any BRC-100 wallet serves: a wallet application on the developer's machine for the examples, or the wallet toolbox with storage the service controls for a hosted writer. [Choose a wallet](operate/wallet-broadcast-proofs.md#choose-a-wallet) sets out both.

An application account system can sit above these layers, but it does not establish which key signed or which authority policy applies. [Identity](learn/identity-and-authority.md) explains that boundary. Live identity assurance is Ring 0; higher rings are absent.

## Component sources

| Integration task | Source |
|---|---|
| Scripts, keys, transactions and proofs | [Core package bindings](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/packages/dpp-core/src/index.ts) |
| Wallet signing and broadcast | [Writer example](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/examples/write-passport.mjs), [writer duties](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/writing.md), [wallet toolbox](https://bsv-blockchain.github.io/ts-stack/packages/wallet/wallet-toolbox/) |
| Resolvable issuer identity | [BSV DID method and resolution](learn/dids.md) |
| Topic admission, lookup and synchronisation | [Overlay package](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/packages/overlay-topics/README.md), [stack components](https://github.com/bsv-blockchain/ts-stack/tree/83a7117b8a02aa16d5a364f186449292810adbd8/packages/overlays) |
| Credential verification | [VSC package](packages/vsc.md) |
| Reference dependency versions | [Locked dependencies](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/package-lock.json) |

Use the [stack source index](https://github.com/bsv-blockchain/ts-stack/blob/83a7117b8a02aa16d5a364f186449292810adbd8/README.md) to locate the selected component's documentation. An upstream capability does not establish that a DPP deployment uses it. The [operating limitations](operate/limitations.md) identify the reference host's discovery and proof-refresh gaps.

Object identifier derivation: declined for now; a physical-object DID stays optional and is never derived from the passport identifier. Historical issuer formats: open; the historical anchor admits `did:key` issuers only, while the current anchor carries any issuer identifier.
