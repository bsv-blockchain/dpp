# BSV stack integration

**Status: informative.** The specification and contracts define the requirements. This map identifies reusable BSV components and the additional credential capability supplied by this repository.

The native packages pin `@bsv/sdk` 2.1.4 and the overlay host pins `@bsv/overlay` 2.0.3. The current stack source baseline reviewed for the generic attestation integration is `98734b07cf0845bff239e38b2f3a26177ee1ea12`. Package manifests and lockfiles select the versions actually used; availability in upstream source does not mean a deployed application has integrated a capability.

Use the [official stack documentation](https://bsv-blockchain.github.io/ts-stack/) for package boundaries and contracts, the [source repository](https://github.com/bsv-blockchain/ts-stack) for exact implementation behaviour, and [DeepWiki](https://deepwiki.com/bsv-blockchain/ts-stack) for supporting navigation. Verify method-specific identity and proof support against the selected component version.

| Requirement | Reusable component | DPP binding |
|---|---|---|
| Native token state encoding and verification | SDK Script, PublicKey, ECDSA, KeyDeriver, BEEF and MerklePath | `@bsv/dpp-core`; [record model](../spec/record-model.md) |
| Key custody and transaction writing | BRC-100 WalletClient, wallet-toolbox and compatible wallets | Native signing and spending through the selected wallet, without requiring an application account holder to operate one |
| Owner keys and optional consent | BRC-42 derivation and BRC-69 linkage evidence | [Custody](../spec/custody.md), with explicit recovery and disclosure limits |
| Generic attestation anchoring | SDK signatures, public child-key derivation and script primitives | Ten-field `bsv-attestation-anchor-v1`; [anchor rules](../spec/rules.md) |
| Topic admission and indexing | Overlay Engine, TopicManager and LookupService | `tm_dpp`/`ls_dpp`, current `tm_attestation`/`ls_attestation`, separate historical `tm_uora_dpp`/`ls_uora_dpp` |
| Submission and lookup | TopicBroadcaster, LookupResolver, BRC-22 and BRC-24 | [Overlay HTTP contract](../contracts/overlay.yaml); exact metadata selectors and bounded outpoint cursors for current anchors |
| Independent operator discovery | SHIP/SLAP advertisements and WalletAdvertiser | Available stack capability; requires deployment configuration and funded advertising |
| Operator synchronisation | Overlay Engine GASP interfaces | Available stack capability; the minimal host in this repository does not enable peer synchronisation |
| Inclusion evidence | BEEF, MerklePath, configurable ChainTracker, ARC-compatible broadcasters and header services | Proofs are verified before `/arc-ingest` updates stored transaction evidence |
| Off-chain encrypted content | BRC-2 encryption, BRC-42 symmetric derivation, UHRP storage tooling | Ciphertext hash binding remains independent of the storage provider |
| Native DID key names | Compressed secp256k1 did:key encoding | Parent keys and signing children remain distinct; a nominated key does not authenticate a resolvable issuer |
| VSC credential cryptography | Maintained Ed25519Signature2020 and bbs-2023 suites | `@bsv/vsc`; no BSV runtime dependency, with a separate explicit BSV anchor adapter |

The canonical generic topic components in the stack live under `packages/overlays/topics/src/attestation`. The DPP implementation exposes its corresponding components from `@bsv/dpp-overlay-topics`. [Portable fixtures](../fixtures/attestation-anchor-v1.json) pin the same signed metadata, secured bytes and script so separately built consumers can verify agreement. Select a release containing the current generic format explicitly; an older UORA topic export is not a format-compatible substitute.

Generic PushDrop decoding alone is insufficient for either native wire format. The DPP readers enforce the exact field count, UTF-8, key encoding, signature preimages and drop tail. Any alternative implementation must reproduce those checks and the refusal vectors.

BSV identity certificates, SD-JWT credentials and VSC Data Integrity credentials are separate formats. The presence of one in a stack component does not satisfy another format's proof requirements. The [VSC profile](../spec/vsc-profile.md) records its pinned sources, owned context, supported suites and unresolved upstream gates.

The reference host provides local or MongoDB persistence and standard submission/lookup. Independent multi-operator operation also needs configured discovery, synchronisation, proof refresh, retention and availability checks. A package test pass does not establish that those deployment arrangements are running or that an index has a globally complete history.
