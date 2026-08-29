# The stack this standard is built against

**Status: informative, never normative.** This document maps each rule in the standard to the component of the BSV TypeScript stack that implements or consumes it, so that an implementer knows what to reuse and what they must write themselves. Where this document and the normative text disagree, the normative text wins, as [`../GOVERNANCE.md`](../GOVERNANCE.md) says of everything outside `spec/`, `contracts/` and `fixtures/`. The review's findings have all landed in the normative documents; what it left behind, the shape the reference implementation should take and the follow-ups that belong in other repositories, is in the last two sections.

Paths in this document are relative to the two repositories named, at the commits the review was made against: [`bsv-blockchain/ts-stack`](https://github.com/bsv-blockchain/ts-stack) at `83a7117b8` (2026-06-26) and the reference implementation `bsv-blockchain-demos/dpp-app` at `ea54152` (2026-08-23). Line numbers are avoided on purpose; function and class names are cited instead because they survive edits.

## Reference links

| Resource | Link |
|---|---|
| Stack documentation site | https://bsv-blockchain.github.io/ts-stack/ |
| Stack, as read by DeepWiki | https://deepwiki.com/bsv-blockchain/ts-stack |
| Stack source | https://github.com/bsv-blockchain/ts-stack |
| BRC standards | https://github.com/bsv-blockchain/BRCs |
| Package map, all seven domains | https://bsv-blockchain.github.io/ts-stack/packages/ |
| `@bsv/sdk` | https://bsv-blockchain.github.io/ts-stack/packages/sdk/bsv-sdk/ |
| Overlay packages | https://bsv-blockchain.github.io/ts-stack/packages/overlays/ |
| `@bsv/overlay-topics`, the home of canonical topics | https://bsv-blockchain.github.io/ts-stack/packages/overlays/overlay-topics/ |
| `@bsv/overlay-express` | https://bsv-blockchain.github.io/ts-stack/packages/overlays/overlay-express/ |
| `@bsv/overlay-discovery-services`, SHIP and SLAP advertising | https://bsv-blockchain.github.io/ts-stack/packages/overlays/overlay-discovery-services/ |
| Helper packages | https://bsv-blockchain.github.io/ts-stack/packages/helpers/ |
| `@bsv/did`, `did:key` and SD-JWT VC | https://bsv-blockchain.github.io/ts-stack/packages/helpers/did/ |
| `@bsv/did-client`, the DID token overlay (not a resolvable DID method) | https://bsv-blockchain.github.io/ts-stack/packages/helpers/did-client/ |
| `@bsv/templates`, the home of script templates | https://bsv-blockchain.github.io/ts-stack/packages/helpers/templates/ |
| `@bsv/wallet-toolbox`, the BRC-100 wallet | https://bsv-blockchain.github.io/ts-stack/packages/wallet/wallet-toolbox/ |
| Overlay HTTP contract (BRC-22 submit, BRC-24 lookup) | https://bsv-blockchain.github.io/ts-stack/specs/overlay-http/ |
| UHRP, content-addressed storage (BRC-26) | https://bsv-blockchain.github.io/ts-stack/specs/uhrp/ |
| BRC-100 wallet interface | https://bsv-blockchain.github.io/ts-stack/specs/brc-100-wallet/ |
| GASP, sync between overlay nodes | https://bsv-blockchain.github.io/ts-stack/specs/gasp-sync/ |
| Merkle service | https://bsv-blockchain.github.io/ts-stack/specs/merkle-service/ |
| Stack layers | https://bsv-blockchain.github.io/ts-stack/architecture/layers/ |
| BEEF and SPV | https://bsv-blockchain.github.io/ts-stack/architecture/beef/ |
| Identity architecture | https://bsv-blockchain.github.io/ts-stack/architecture/identity/ |
| BRC index | https://bsv-blockchain.github.io/ts-stack/reference/brc-index/ |
| Conformance vectors | https://bsv-blockchain.github.io/ts-stack/conformance/ |
| Running an overlay node | https://bsv-blockchain.github.io/ts-stack/guides/run-overlay-node/ |
| `chaintracks-server`, a self-hosted header service | https://bsv-blockchain.github.io/ts-stack/infrastructure/chaintracks-server/ |

## How to read the map

Each table row names a rule in the standard, the stack component that implements or consumes it, the BRC the component follows where there is one, and where the component lives in `ts-stack`. "Consumes" matters as much as "implements": the standard's signatures are not made by a DPP library, they are made by any BRC-100 wallet, and that is the property that lets a record be produced by software the standard's authors have never seen.

## The record model ([`../spec/record-model.md`](../spec/record-model.md))

| Rule | Stack component | BRC | Where in `ts-stack` |
|---|---|---|---|
| §2, the output script: a key, `OP_CHECKSIG`, fourteen minimal pushes, seven `OP_2DROP` | The `PushDrop` script template with `lockPosition: 'before'` and `includeSignature: false`. The two signatures are ordinary fields, not PushDrop's appended signature | BRC-48 | `packages/sdk/src/script/templates/PushDrop.ts` |
| §2, minimal-push encoding and its three special cases | `createMinimallyEncodedScriptChunk`, module-local in the same file. The reference copies it verbatim because it is not exported | BRC-48 | same file; `packages/dpp-core/src/codec.ts` `minimalChunk` in the reference |
| §2, reading `OP_0` as the empty field | Not the SDK decoder: `PushDrop.decode` maps `OP_0` to the single byte `0x00`, stops at the first drop opcode without checking the tail, and accepts a 65-byte key push. It is a discovery tool for PushDrop outputs in general, not a conformance reader for this layout, as `record-model.md` §2 now says | | `PushDrop.decode` |
| §3, fields 6 and 7 must be canonical SEC1 | `PublicKey.fromString` then compare the re-encoding: the SDK reduces an out-of-range x coordinate rather than refusing it, so the round trip is the check | | `packages/sdk/src/primitives/PublicKey.ts`, `Point.ts`; `identityKeyHex` in the reference codec |
| §5, the child key both signatures use | `KeyDeriver` and `CachedKeyDeriver`: invoice number `${securityLevel}-${protocolName}-${keyID}`, counterparty `anyone` is the public key of the private key `1`, key identifiers are 1 to 800 characters, protocol names 5 to 400 lower-case alphanumerics and spaces | BRC-42, BRC-43 | `packages/sdk/src/wallet/KeyDeriver.ts`, `computeInvoiceNumber` |
| §5, making a signature | BRC-100 `createSignature({ data, protocolID, keyID, counterparty: 'anyone' })`, served by `ProtoWallet` over a root key on a server or by `WalletClient` against a user's wallet; the hash is SHA-256 of `data`, the key is `derivePrivateKey` | BRC-100 | `packages/sdk/src/wallet/ProtoWallet.ts`, `WalletClient.ts` |
| §5, verifying a signature with no secret | `new KeyDeriver('anyone').derivePublicKey(protocolID, keyID, parentKey)` then `PublicKey.verify` over the SHA-256 of the preimage | BRC-42 | same, and `packages/dpp-core/src/signatures.ts` in the reference |
| Spending a state | `PushDrop.unlock`, which signs the transaction with the same protocol, key identifier and counterparty | BRC-48 | `PushDrop.ts` |
| §6, walking a chain | `Transaction.inputs[].sourceTransaction`, `Beef.findTxid`; `Historian` is an optional generic history walker over input ancestry | | `packages/sdk/src/transaction/Beef.ts`, `packages/sdk/src/overlay-tools/Historian.ts` |
| §7, the owner tier's off-chain home | UHRP: field 11 is exactly the content address. `StorageUtils.getURLForHash` turns it into a `uhrp://` URL, `StorageDownloader` fetches and checks the hash, `StorageUploader` publishes to one or more hosts, `tm_uhrp` and `ls_uhrp` make hosts findable | BRC-26 | `packages/sdk/src/storage/`, `packages/overlays/topics/src/uhrp` |
| §7, the owner tier's encryption | `SymmetricKey` (AES-256-GCM) under a key from `KeyDeriver.deriveSymmetricKey`, or BRC-100 `encrypt` and `decrypt`, which are the same operation behind the wallet boundary | BRC-2 | `packages/sdk/src/primitives/SymmetricKey.ts`, `KeyDeriver.deriveSymmetricKey` |
| §8, inclusion against block headers | `MerklePath.verify(txid, chainTracker)` for one state, `Beef.verify(chainTracker)` for every root in a BEEF at once; the header source is the `ChainTracker` interface, `isValidRootForHeight(root, height)` | BRC-74 (BUMP), BRC-62 (BEEF) | `packages/sdk/src/transaction/MerklePath.ts`, `Beef.ts`, `ChainTracker.ts` |
| §8, header sources | `WhatsOnChain` (the SDK default), `BlockHeadersService`, and a self-hostable `chaintracks-server`, so a verifier need not depend on any third party | | `packages/sdk/src/transaction/chaintrackers/`, `infra/chaintracks-server` |
| §9, what is a build's own choice | `createAction` with a `basket`, fee models, broadcasters (ARC) | BRC-100 | `packages/sdk/src/transaction/broadcasters/`, `fee-models/` |

## The rules ([`../spec/rules.md`](../spec/rules.md))

| Rule | Stack component | BRC | Where in `ts-stack` |
|---|---|---|---|
| §3, the attestation signature | BRC-100 `createSignature` with `data` set to the canonical bytes, protocol `[1, 'dpp attestation v1']`, key identifier `passportId`, counterparty `anyone` | BRC-42, BRC-100 | as above |
| §4, canonical bytes | None. The stack has no JCS implementation and the standard's deliberate subset is its own. `MandalaAdmin.canonicalize` in `@bsv/templates` is a comparable sorted-keys subset, useful as a reference only | | `packages/helpers/ts-templates/src/MandalaAdmin.ts` |
| §5, the anchor output | `PushDrop` again, `includeSignature: false`, with the signature carried as field 8 over the length-delimited preimage the standard defines, because PushDrop's own appended signature commits to no field boundaries | BRC-48 | `PushDrop.ts` |
| §5, the varint in the signing preimage | The Bitcoin VarInt, `Utils.Writer.writeVarIntNum` and `Utils.Reader.readVarIntNum` | | `packages/sdk/src/primitives/utils.ts` |
| §5, the locking derivation | `KeyDeriver.derivePublicKey` with protocol `[1, 'uora anchor v3']`, key identifier the attestation id, counterparty `anyone` | BRC-42 | `KeyDeriver.ts` |
| §7, conformance fixtures | The cross-language conformance corpus: a JSON schema, stable dotted identifiers, refusal vectors tagged `error-case`, hex-only encoding, an append-only rule and a runner contract | | `conformance/VECTOR-FORMAT.md`, `conformance/schema/vector.schema.json`, `conformance/runner/src/runner.js` |

## Identity ([`../spec/identity.md`](../spec/identity.md))

| Rule | Stack component | BRC | Where in `ts-stack` |
|---|---|---|---|
| §1, `did:key` for a compressed secp256k1 key | `@bsv/did`: `BsvDid.fromPublicKey`, `publicKeyToDidKey` and `decodeDidKey`, the same `0xe7 0x01` multicodec prefix and base58btc `z` marker, so the two encodings are byte-identical. `@bsv/did` does not apply §1's canonical-key refusal: `normalizePublicKey` round-trips through `PublicKey.fromDER`, which reduces rather than refuses, so a build on it adds the check itself | did:key | `packages/helpers/did/src/did/BsvDid.ts`, `packages/helpers/did/src/utils/multibase.ts` |
| §2, parent to child | `KeyDeriver.derivePublicKey` with root `anyone`, as in the record model | BRC-42, BRC-43 | `KeyDeriver.ts` |
| §3, a resolvable method beside the offline one | Outside the stack. The reference has exercised `did:bsv` (an on-chain, versioned document with a universal resolver) and `did:web` (a served document carrying key history). `@bsv/did-client` and the `tm_did` topic are a different thing: a registry of DID tokens by serial number, not a DID method a resolver answers | | `packages/helpers/did-client`, `packages/overlays/topics/src/did` |
| Credentials about the actor | BRC-52 identity certificates: `Certificate`, `MasterCertificate`, `VerifiableCertificate`, whose `subject` is the compressed identity key, resolved through `IdentityClient` and the `tm_identity` topic; or SD-JWT VC through `@bsv/did`, whose issuer and holder binding are the same key as a `did:key`. Either way the credential names the parent and §2 reaches the signing child | BRC-52, BRC-53 | `packages/sdk/src/auth/certificates/`, `packages/sdk/src/identity/`, `packages/overlays/topics/src/identity` |

## The services ([`../spec/services.md`](../spec/services.md), [`../contracts/overlay.yaml`](../contracts/overlay.yaml))

| Rule | Stack component | BRC | Where in `ts-stack` |
|---|---|---|---|
| §2, the index | The overlay `Engine`, the `TopicManager` and `LookupService` interfaces, and `OverlayExpress` as the HTTP host. The upstream wire contract is `specs/overlay/overlay-http.yaml` | BRC-22, BRC-24 | `packages/overlays/overlay/src/Engine.ts`, `TopicManager.ts`, `LookupService.ts`; `packages/overlays/overlay-express` |
| §2, where a first-class topic lives | `@bsv/overlay-topics`, which exports every canonical topic manager and lookup service (`tm_did`, `tm_uhrp`, `tm_identity`, `tm_kvstore`, `tm_mandala` and the rest) with Markdown documentation returned by `getDocumentation()` | | `packages/overlays/topics/src/index.ts` |
| §2, announcing a transaction to an index | `TopicBroadcaster` (also exported as `SHIPBroadcaster`) with an `HTTPSOverlayBroadcastFacilitator`; the request is `POST /submit` with `X-Topics` and a BEEF body, the answer is a STEAK | BRC-22 | `packages/sdk/src/overlay-tools/SHIPBroadcaster.ts` |
| §1, finding an index at all | `LookupResolver`, which asks SLAP trackers which hosts serve a lookup service, or is pinned to a host with `hostOverrides`. It requests `X-Aggregation: yes` and accepts either the binary aggregated answer or the JSON `output-list` by content type, times out at two seconds by default, and refuses plain HTTP on the mainnet preset | BRC-24 | `packages/sdk/src/overlay-tools/LookupResolver.ts` |
| §1, making an index findable | SHIP advertisements for topics and SLAP advertisements for lookup services, created by `WalletAdvertiser` with a funded BRC-100 wallet, and served by the Engine's `syncAdvertisements` | | `packages/overlays/overlay-discovery-services` |
| Keeping two indexes in agreement | GASP, run by the Engine's `startGASPSync` and the `/requestSyncResponse` and `/requestForeignGASPNode` routes | | `packages/overlays/gasp-core`, `Engine.ts` |
| Learning that a transaction was mined | `/arc-ingest` on `OverlayExpress`, which takes the merkle path from an ARC callback and updates the stored output | | `packages/overlays/overlay-express/src/OverlayExpress.ts` |
| §4, a verification surface in a browser | The same `@bsv/sdk` primitives: it is the stack's one zero-dependency package and runs unchanged in a browser | | `packages/sdk` |
| §5, identifier resolution | Outside the stack by design: the resolver for a resolvable DID method is operated independently of any passport service | | |

## The fixtures ([`../fixtures/`](../fixtures/))

| Rule | Stack component | Where in `ts-stack` |
|---|---|---|
| Byte-for-byte pinning, refusal vectors as part of the fixture | The conformance corpus format: a file is `{ id, name, brc, version, reference_impl, parity_class, vectors }`, a vector is `{ id, description, input, expected, tags }`, binary is lower-case hex, identifiers are permanent and files are append-only after publication | `conformance/VECTOR-FORMAT.md`, `conformance/schema/vector.schema.json`, `conformance/META.json` |
| Running a suite | The structural runner and its CLI contract: `--validate-only`, `--filter`, `--report`, exit codes 0, 1 and 2 | `conformance/runner/src/runner.js` |

## The reference implementation, when `packages/` arrives

Recorded because `packages/` has not yet arrived and its shape is about to be decided. The stack has a settled shape for a token standard's code, and Mandala is its most recent instance; the delivery shape transfers, the token semantics do not.

**Script templates.** One `ScriptTemplate` class per output, `DppRecord` and `UoraAnchor`, each with `lock`, `unlock` and a static `decode` that refuses anything but the exact layout, published to `@bsv/templates` (`ts-stack/packages/helpers/ts-templates`) beside `PushDrop` and the Mandala templates. Today the reference exposes the same operations as free functions in `dpp-core` (`buildLockingScript`, `tryParseDppOutput`, the signature helpers) and re-implements minimal-push encoding because the SDK does not export it; as a template class the encoding is inherited and the shape is discoverable by any tool that knows `ScriptTemplate`.

**Topics.** `tm_dpp`, `ls_dpp`, `tm_uora_dpp` and `ls_uora_dpp` in `@bsv/overlay-topics`, with `*Docs.md.ts` documentation, mounted on `OverlayExpress` rather than a hand-written host, so GASP, ARC ingestion, documentation routes, health probes and advertising come with the mount.

**One version, two consumers.** The application and the overlay deployment consume the templates and topics as versioned dependencies pinned to the same version, because a writer and a reader on different encodings is the one failure a fixture cannot catch at runtime (Mandala's `docs/PROJECT-STATE.md` §1 states the rule and the reason).

**Vectors from the reference.** The conformance vectors are generated by the reference implementation's tests, never edited by hand, and a port in another language is accepted when it passes them (Mandala's Go overlay, `overlay-go/testdata`).

**Where DPP deliberately differs.** Mandala dropped its on-chain marker byte and classifies outputs by script shape alone, because it committed to discovery through an overlay and peer-to-peer delivery only (`mandala/docs/superpowers/specs/2026-06-26-mandala-p2pkh-no-marker-design.md`). A passport keeps `dpp` and `1` in fields 1 and 2 because its records are meant to be found by a stranger scanning the chain with no overlay at all. Mandala's admin outputs derive their locking key with counterparty `self`, which only the issuer's wallet can reproduce; the anchor derives with counterparty `anyone`, which any stranger can reproduce, because attribution by a stranger is the point of the anchor. Both are the right choice for their standard and neither should be imported into the other.

## Follow-ups outside this repository

Each of these is an external write and needs explicit approval before anything is posted.

- **ts-stack, `PushDrop.decode`.** The template's encoder maps both the empty field and the single byte `0x00` to `OP_0`, and its decoder returns `[0x00]`, so decode is not the inverse of encode for empty fields. An issue proposing either that `decode` return the empty array for `OP_0` or that it take an option, with this standard as the motivating consumer.
- **ts-stack, BRC index.** `docs/reference/brc-index.md` gives BRC-22 and BRC-24 one-line titles that do not match the stack's own overlay contract, which uses those numbers for submission and lookup. A documentation fix.
- **ts-stack, contributions.** `tm_uora_dpp` and `ls_uora_dpp` to `@bsv/overlay-topics` first (already dependency-clean), `tm_dpp` and `ls_dpp` once the token core is a template in `@bsv/templates`.
- **dpp-app.** Mount the overlay on `@bsv/overlay-express`; add SHIP and SLAP advertising with a funded wallet; delete the PushDrop-reader warning from `docs/PROTOCOL_COMPATIBILITY.md`, since `record-model.md` §2 now carries it; add a test that the codec refuses `overlongPassportId` and regenerate the fixture from the tests so the leading copy carries the vector too.

## What the stack does not provide

Three things the standard needs are outside the stack and stay the standard's own: the canonical bytes of an attestation (the stack has no JCS), the resolvable DID methods a deployment may use beside `did:key` (`did:bsv` and `did:web` are implemented elsewhere), and the attestation registry's query interface, which is maintained jointly with the second implementing workstream and joins `contracts/` when both parties accept it.
