# BSV stack integration

Application integrators can use this page to connect BSV and DPP components, assigning transaction, signing, indexing and verification responsibilities. BSV means Bitcoin SV. The software development kit (SDK) supplies general blockchain primitives; DPP packages implement passport rules.

## Selected integration inputs

| Input | Source and selection |
|---|---|
| Package versions and runtime | [Dependency ledger](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/conformance/licences.json) and [release support table](packages/support-table.md). The source candidate uses Node 22 or later and `@bsv/sdk@2.8.10`; select exact DPP versions through [release sets](reference/release-sets.md). |
| Service access | Index URL and publisher policy from your selected operator; header source for inclusion evidence. |
| Writer signing | BRC-100 wallet with access authorised for the intended write. |
| Product or exchange format | Selected profile or credential format from your application requirements. |

## Connect the layers

1. Build and exercise the packages locally with [the quick start](quick-start.md).
2. Use the SDK for general transaction, key and proof primitives. Use the DPP core package for passport-specific encoding and checks.
3. Connect a wallet for signing and broadcast access. Any BRC-100 wallet serves: a wallet application on the developer's machine for examples, or the wallet toolbox with service-controlled storage for a hosted writer. [Choose a wallet](operate/wallet-broadcast-proofs.md#choose-a-wallet) covers both.
4. Add the index URL, publisher policy and header source. The overlay package indexes records; readers use the returned evidence and headers for checks. [Wallet and proofs](operate/wallet-broadcast-proofs.md) places these components in one write.
5. Add profile or credential packages for the selected product and exchange formats.

Stop before relying on a capability without deployment evidence: upstream support does not establish that a DPP deployment uses it.

An application account system can sit above these layers, but it does not establish which key signed or which authority policy applies. [Identity](learn/identity-and-authority.md) explains that boundary. Live identity assurance is Ring 0; higher rings are absent.

## Component sources

The pinned `dpp-core` paths are historical source for the protocol library.

| Integration task | Source |
|---|---|
| Scripts, keys, transactions and proofs | [Core package bindings](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/packages/dpp-core/src/index.ts) |
| Wallet signing and broadcast | [Writer example](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/examples/write-passport.mjs), [writer duties](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/writing.md), [wallet toolbox](https://bsv-blockchain.github.io/ts-stack/packages/wallet/wallet-toolbox/) |
| Resolvable issuer identity | [BSV DID method and resolution](learn/dids.md) |
| Topic admission, lookup and synchronisation | [Overlay package](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/packages/dpp-overlay/README.md), [stack components](https://github.com/bsv-blockchain/ts-stack/tree/83a7117b8a02aa16d5a364f186449292810adbd8/packages/overlays) |
| Credential verification | [Credentials package](packages/dpp-credentials.md) |
| Reference dependency versions | [Locked dependencies](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/package-lock.json) |

Use the [stack source index](https://github.com/bsv-blockchain/ts-stack/blob/83a7117b8a02aa16d5a364f186449292810adbd8/README.md) to locate component documentation. The [operating limitations](operate/limitations.md) identify the reference host's discovery and proof-refresh gaps.

| Decision | Status and effect |
|---|---|
| Object identifier derivation | Declined for now. A physical-object DID stays optional and is never derived from the passport identifier. |
| Historical issuer formats | Open. The historical anchor admits `did:key` issuers only; the current anchor carries any issuer identifier. |
