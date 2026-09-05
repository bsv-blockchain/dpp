# The stack this standard is built against

**Status: informative, never normative.** This document maps each rule in the standard to the component of the BSV TypeScript stack that implements or consumes it, so that an implementer knows what to reuse and what they must write themselves. Where this document and the normative text disagree, the normative text wins, as [`../GOVERNANCE.md`](../GOVERNANCE.md) says of everything outside `spec/`, `contracts/` and `fixtures/`. The review's findings have all landed in the normative documents; what it left behind, the shape the reference implementation should take and the follow-ups that belong in other repositories, is in the last two sections.

Paths in this document are relative to the repository named, at the commits the review was made against: [`bsv-blockchain/ts-stack`](https://github.com/bsv-blockchain/ts-stack) at `83a7117b8` (2026-06-26); this repository's `packages/`, the reference implementation, which moved in from the consuming application while the review was under way; and the consuming application `bsv-blockchain-demos/dpp-app` at `ea54152` (2026-08-23) for its service layer, cited as `dpp-app/...`. Line numbers are avoided on purpose; function and class names are cited instead because they survive edits.

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
| ARC broadcast API, the ARC-compatible broadcast interface | https://bsv-blockchain.github.io/ts-stack/specs/arc-broadcast/ |
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
| §3, field 6, the owner key | `getPublicKey({ protocolID: [1, 'dpp owner v1'], keyID: passport_id, counterparty: 'self' })` on any BRC-100 wallet, `KeyDeriver.derivePublicKey` with counterparty `self` where a server holds the root; the two `forSelf` branches give the same point, root plus `s·G`, and with `self` no third party can compute or confirm the child | BRC-42, BRC-43 | `packages/sdk/src/wallet/ProtoWallet.ts` `getPublicKey`, `KeyDeriver.ts` `derivePublicKey`; `ownerKeyFor` in the reference `packages/dpp-core/src/owner.ts` |
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

## Custody ([`../spec/custody.md`](../spec/custody.md))

The custody document's one constraint on the standard, that every key role is fillable by a BRC-100 wallet with one derivation from its root and no key export, is a statement about this table: every row is a wallet operation, and none needs a raw key.

| Rule | Stack component | BRC | Where in `ts-stack` |
|---|---|---|---|
| §1, where an owner's wallet is reached | `WalletClient` in a browser or an application, against the user's own BRC-100 wallet; `@bsv/wallet-relay` for a phone paired by QR code over an encrypted relay, where the keys never leave the phone; `ProtoWallet` over a root key a server holds, which is what a custodian runs. All three expose the same operations, so the same record comes out of each | BRC-100 | `packages/sdk/src/wallet/WalletClient.ts`, `packages/wallet/ts-wallet-relay`, `ProtoWallet.ts` |
| §3, spending a tip locked to the owner key | `PushDrop.unlock([1, 'dpp owner v1'], passportId, 'self')` through `createAction` and `signAction`; `unlock().sign` only calls `createSignature`, so a `ProtoWallet` produces the same deterministic unlocking script, which is how the fixture's sixth state is spent | BRC-48, BRC-100 | `packages/sdk/src/script/templates/PushDrop.ts`; `spendAsOwner` in the reference `packages/dpp-core/test/helpers.ts` |
| §4, `owner_linkage` | `revealSpecificKeyLinkage({ counterparty, verifier, protocolID, keyID })`, which returns `KeyDeriver.revealSpecificSecret`, the HMAC scalar `s` that `PublicKey.deriveChild` adds as `s·G`, encrypted to the verifier under `[2, 'specific linkage revelation 1 dpp owner v1']`; the verifier decrypts with the prover as counterparty, and the standard then carries `s` in the clear because on chain the verifier is everyone. The wire types the counterparty as a public key, so a caller passes its own identity key, which `normalizeCounterparty` makes the same point as `self` | BRC-69, BRC-42 | `ProtoWallet.ts` `revealSpecificKeyLinkage`, `KeyDeriver.ts` `revealSpecificSecret`, `packages/sdk/src/primitives/PublicKey.ts` `deriveChild`; `owner.ts` in the reference |
| §4, checking the linkage with no secret | `PublicKey.fromString(actor).add(new Curve().g.mul(new BigNumber(bytes)))` compared with the previous field 6: one point addition, mirroring `deriveChild`, with the scalar reduced modulo the curve order as `Point.mul` does | BRC-42 | `PublicKey.ts`, `Point.ts`; `verifyOwnerLinkage` in the reference |
| §6, recovery of a key | Nothing this standard depends on. How a wallet backs up and restores its root is the wallet's design, and the standard says so rather than naming one | | |

## Writing ([`../spec/writing.md`](../spec/writing.md))

The writing document states duties as outcomes and names no service; this table is where the services are named. Every row is something the stack already does, which is why the document could avoid naming them.

| Rule | Stack component | BRC | Where in `ts-stack` |
|---|---|---|---|
| §2, the check before sending | `chainFromBeef` on the tip's BEEF plus the candidate, then `verifyChain` with `chainTracker: 'scripts only'` and the service key: the reader's whole recipe with the header check off, because nothing is mined. A genesis is checked alone | | `verifyChain.ts` in the reference; `examples/write-passport.mjs` |
| §3, building unsent and sending later | `createAction` with `options.noSend: true` returns a complete, signed AtomicBEEF and spends nothing; a later `createAction` with no inputs or outputs and `options.sendWith: [txid]` sends it, the send-only terminator the stack's own `nosend` example uses, with `noSendChange` threading change between chained unsent actions | BRC-100 | `packages/sdk/src/wallet/Wallet.interfaces.ts` (`CreateActionOptions`), `packages/wallet/wallet-toolbox-examples/docs/nosend.md` |
| §3 and §6, announcing | `TopicBroadcaster` with an `HTTPSOverlayBroadcastFacilitator`, or a plain `POST /submit` with `X-Topics` and the BEEF; the reference index's `X-Admission` header answers admitted, duplicate or none | BRC-22 | `packages/sdk/src/overlay-tools/SHIPBroadcaster.ts`; `index.ts` in the reference |
| §4, the network's answer and nothing sooner | `acceptDelayedBroadcast: false`, which every stack example passes: the call returns when the network has answered, and a failure arrives as `WERR_REVIEW_ACTIONS` carrying `reviewActionResults` and `competingTxs`. `SendWithResult.status` in the standard's words: `unproven` is accepted and pending, `sending` is not yet an answer, `failed` never existed. The toolbox's `proven_tx_req` statuses (`nosend`, `unsent`, `sending`, `unmined`, `doubleSpend`, `invalid`, `completed`) are the finer record behind those three | BRC-100 | `packages/sdk/src/wallet/WERR_REVIEW_ACTIONS.ts`, `Wallet.interfaces.ts` (`SendWithResultStatus`); `packages/wallet/wallet-toolbox/src/utility/aggregateResults.ts`, `src/sdk/types.ts` |
| §4, one writer per passport | Nothing in the stack serialises writes to one passport: that is the application's compare-and-set on its own tip record, and the reference application's lack of one is under follow-ups | | |
| §5, broadcasting through more than one door | `Services.postBeef` in `UntilSuccess` mode over the ARC-compatible endpoints it is configured with (`arcUrl` and `arcConfig`, callback URL and token included; GorillaPool on mainnet, then TAAL, Bitails and WhatsOnChain by default), treating `alreadyKnown` as success and demoting a failing provider; the SDK's `ARC` class speaks the same wire for a bare transaction. The association's ARC-compatible gateway is ARCADE: `POST /tx`, `GET /tx/:txid` returning the merkle path once mined (per instance: 404 for a transaction that instance never saw), `/policy` in the ARC schema, webhooks and an SSE stream | | `packages/wallet/wallet-toolbox/src/services/Services.ts`, `createDefaultWalletServicesOptions.ts`, `providers/ARC.ts`; `packages/sdk/src/transaction/broadcasters/ARC.ts` |
| §5, fee policy from the endpoint | `GET /policy` on any ARC-compatible endpoint, in the ARC schema (`miningFee`, the size limits) | | `specs/broadcast/arc.yaml` |
| §5, the wallet's monitoring process | The toolbox `Monitor`: `TaskSendWaiting` pursues broadcast, `TaskCheckForProofs` seeks proofs once `TaskNewHeader` has seen a header a minute old (which keeps orphaned blocks out), `TaskArcadeSSE` takes MINED from an ARCADE stream and fetches the path from `GET /tx/:txid`, `TaskReviewDoubleSpends` and `TaskUnFail` revisit verdicts. One Monitor per storage: two race | | `packages/wallet/wallet-toolbox/src/monitor/Monitor.ts`, `tasks/TaskCheckForProofs.ts`, `tasks/TaskNewHeader.ts`, `tasks/TaskArcSSE.ts` |
| §7, obtaining the proof | The broadcaster's callback (`X-CallbackUrl` and `X-CallbackToken` at submission; the body is `ArcMerkleCallback`: `txid`, `merklePath` as BUMP hex, `blockHeight`), the SSE stream, or `GET /tx/:txid`; the toolbox stores what it obtains in `proven_txs` (`merklePath`, `rawTx`, `height`, `blockHash`, `merkleRoot`) and serves it inside the BEEF that `listOutputs` returns with `include: 'entire transactions'` | BRC-74 | `specs/broadcast/arc.yaml` (`ArcMerkleCallback`), `packages/wallet/wallet-toolbox/src/storage/schema/tables/TableProvenTx.ts` |
| §7, offering the proof to an index | `POST /arc-ingest` with that same body, which the reference index verifies against its header source before `Engine.handleNewMerkleProof` rewrites the stored BEEF and its lineage; `OverlayExpress` serves the same route for its own broadcaster's callback. Re-announcing does nothing: `Engine.submit` skips a txid it already holds before any storage write, and GASP moves proofs only for outputs the receiver does not have | | `packages/overlays/overlay/src/Engine.ts` (`submit`, `handleNewMerkleProof`, `updateMerkleProof`), `packages/overlays/overlay-express/src/OverlayExpress.ts`; `index.ts` in the reference |
| §8, retaining the bytes | The wallet's storage is the store under possession, `proven_txs` and the transaction tables, read back as BEEF through `listOutputs` and `listActions`; a deployment writing through its own infrastructure holds the same in the toolbox storage server it runs | BRC-100 | `TableProvenTx.ts`; `packages/wallet/wallet-toolbox/src/storage` |
| §9, reorganisations | `TaskReorg` and the one-minute lag above; the header source's answer flips a proof to refuted and back, and the record model's three outcomes are what a verifier reports meanwhile | | `packages/wallet/wallet-toolbox/src/monitor/tasks/TaskReorg.ts` |
| §10, a personal wallet's share | `WalletClient` against the user's own wallet does §5, §7 and §8 by being a wallet; the application does the rest through the same interface, which is what `examples/write-passport.mjs` shows from one wallet | BRC-100 | `packages/sdk/src/wallet/WalletClient.ts` |

## The services ([`../spec/services.md`](../spec/services.md), [`../contracts/overlay.yaml`](../contracts/overlay.yaml))

| Rule | Stack component | BRC | Where in `ts-stack` |
|---|---|---|---|
| §2, the index | The overlay `Engine`, the `TopicManager` and `LookupService` interfaces, and `OverlayExpress` as the HTTP host. The upstream wire contract is `specs/overlay/overlay-http.yaml` | BRC-22, BRC-24 | `packages/overlays/overlay/src/Engine.ts`, `TopicManager.ts`, `LookupService.ts`; `packages/overlays/overlay-express` |
| §2, where a first-class topic lives | `@bsv/overlay-topics`, which exports every canonical topic manager and lookup service (`tm_did`, `tm_uhrp`, `tm_identity`, `tm_kvstore`, `tm_mandala` and the rest) with Markdown documentation returned by `getDocumentation()` | | `packages/overlays/topics/src/index.ts` |
| §2, announcing a transaction to an index | `TopicBroadcaster` (also exported as `SHIPBroadcaster`) with an `HTTPSOverlayBroadcastFacilitator`; the request is `POST /submit` with `X-Topics` and a BEEF body, the answer is a STEAK | BRC-22 | `packages/sdk/src/overlay-tools/SHIPBroadcaster.ts` |
| §1, finding an index at all | `LookupResolver`, which asks SLAP trackers which hosts serve a lookup service, or is pinned to a host with `hostOverrides`. It requests `X-Aggregation: yes` and accepts either the binary aggregated answer or the JSON `output-list` by content type, times out at two seconds by default, and refuses plain HTTP on the mainnet preset | BRC-24 | `packages/sdk/src/overlay-tools/LookupResolver.ts` |
| §1, making an index findable | SHIP advertisements for topics and SLAP advertisements for lookup services, created by `WalletAdvertiser` with a funded BRC-100 wallet, and served by the Engine's `syncAdvertisements` | | `packages/overlays/overlay-discovery-services` |
| Keeping two indexes in agreement | GASP, run by the Engine's `startGASPSync` and the `/requestSyncResponse` and `/requestForeignGASPNode` routes | | `packages/overlays/gasp-core`, `Engine.ts` |
| §2, serving a mined state with its proof | `Engine.handleNewMerkleProof(txid, proof, blockHeight)` rewrites the stored BEEF, its in-BEEF ancestors and its `consumedBy` descendants. It is reached through `/arc-ingest`, which `OverlayExpress` serves for its own broadcaster's callback and the reference index serves for a writer's push, verified against the header source first. Nothing else feeds it: `submit` skips a held txid before any storage write, and GASP carries proofs only for outputs the receiver lacks | BRC-74 | `Engine.ts`, `OverlayExpress.ts`; `index.ts` in the reference |
| §4, a verification surface in a browser | The same `@bsv/sdk` primitives: it is the stack's one zero-dependency package and runs unchanged in a browser | | `packages/sdk` |
| §5, identifier resolution | Outside the stack by design: the resolver for a resolvable DID method is operated independently of any passport service | | |

## The fixtures ([`../fixtures/`](../fixtures/))

| Rule | Stack component | Where in `ts-stack` |
|---|---|---|
| Byte-for-byte pinning, refusal vectors as part of the fixture | The conformance corpus format: a file is `{ id, name, brc, version, reference_impl, parity_class, vectors }`, a vector is `{ id, description, input, expected, tags }`, binary is lower-case hex, identifiers are permanent and files are append-only after publication | `conformance/VECTOR-FORMAT.md`, `conformance/schema/vector.schema.json`, `conformance/META.json` |
| Running a suite | The structural runner and its CLI contract: `--validate-only`, `--filter`, `--report`, exit codes 0, 1 and 2 | `conformance/runner/src/runner.js` |

## The reference implementation's next shape

Recorded because `packages/` arrived as free functions and a hand-written HTTP host while this review was under way, and the shape it should grow into is already settled elsewhere in the ecosystem. The stack has a settled shape for a token standard's code, and Mandala is its most recent instance; the delivery shape transfers, the token semantics do not.

**Script templates.** One `ScriptTemplate` class per output, `DppRecord` and `UoraAnchor`, each with `lock`, `unlock` and a static `decode` that refuses anything but the exact layout, published to `@bsv/templates` (`ts-stack/packages/helpers/ts-templates`) beside `PushDrop` and the Mandala templates. Today the reference exposes the same operations as free functions in `dpp-core` (`buildLockingScript`, `tryParseDppOutput`, the signature helpers) and re-implements minimal-push encoding because the SDK does not export it; as a template class the encoding is inherited and the shape is discoverable by any tool that knows `ScriptTemplate`.

**Topics.** `tm_dpp`, `ls_dpp`, `tm_uora_dpp` and `ls_uora_dpp` in `@bsv/overlay-topics`, with `*Docs.md.ts` documentation, mounted on `OverlayExpress` rather than a hand-written host, so GASP, ARC ingestion, documentation routes, health probes and advertising come with the mount.

**One version, two consumers.** The application and the overlay deployment consume the templates and topics as versioned dependencies pinned to the same version, because a writer and a reader on different encodings is the one failure a fixture cannot catch at runtime (Mandala's `docs/PROJECT-STATE.md` §1 states the rule and the reason).

**Vectors from the reference.** The conformance vectors are generated by the reference implementation's tests, never edited by hand, and a port in another language is accepted when it passes them (Mandala's Go overlay, `overlay-go/testdata`).

**Where DPP deliberately differs.** Mandala dropped its on-chain marker byte and classifies outputs by script shape alone, because it committed to discovery through an overlay and peer-to-peer delivery only (`mandala/docs/superpowers/specs/2026-06-26-mandala-p2pkh-no-marker-design.md`). A passport keeps `dpp` and `1` in fields 1 and 2 because its records are meant to be found by a stranger scanning the chain with no overlay at all. Mandala's admin outputs derive their locking key with counterparty `self`, which only the issuer's wallet can reproduce; the anchor derives with counterparty `anyone`, which any stranger can reproduce, because attribution by a stranger is the point of the anchor. Both are the right choice for their standard and neither should be imported into the other.

## Follow-ups outside this repository

Each of these is an external write and needs explicit approval before anything is posted.

- **ts-stack, `PushDrop.decode`.** The template's encoder maps both the empty field and the single byte `0x00` to `OP_0`, and its decoder returns `[0x00]`, so decode is not the inverse of encode for empty fields. An issue proposing either that `decode` return the empty array for `OP_0` or that it take an option, with this standard as the motivating consumer.
- **ts-stack, BRC index.** `docs/reference/brc-index.md` gives BRC-22 and BRC-24 one-line titles that do not match the stack's own overlay contract, which uses those numbers for submission and lookup, and labels BRC-69 "Key derivation for encryption" where the BRC is "Revealing Key Linkages". A documentation fix.
- **ts-stack, `Engine.updateMerkleProof`.** When the stored transaction already carries a merkle path, the method replaces it in memory and returns before `updateTransactionBEEF` and before walking `consumedBy`, so a re-proof after a reorganisation is never persisted and never reaches descendants. An issue with the two missing steps.
- **ts-stack, the callback body.** `docs/specs/arc-broadcast.md` sketches the callback as `{ txid, merkleProof, blockHash, blockHeight }` where `specs/broadcast/arc.yaml` (`ArcMerkleCallback`) and `/arc-ingest` say `merklePath`. A documentation fix.
- **ts-stack, contributions.** `tm_uora_dpp` and `ls_uora_dpp` to `@bsv/overlay-topics` first (already dependency-clean), `tm_dpp` and `ls_dpp` once the token core is a template in `@bsv/templates`.
- **This repository, `packages/overlay-topics`.** Mount the index on `@bsv/overlay-express`, which serves the documentation routes the overlay profile requires, and add SHIP and SLAP advertising with a funded wallet.
- **This repository, `fixtures/`.** Every pinned passport identifier carries `09506000134352`, GS1's live Dal Giardino number, which [`../spec/record-model.md`](../spec/record-model.md) §3 now forbids a demonstration to use. Move the fixture modules to a number under GS1 prefix 952, in GS1's own documented example form on `id.gs1.org`, regenerate with `REGENERATE_FIXTURES=1` once the vector generators have landed, and re-vendor the copies ts-stack and dpp-app hold verbatim.
- **dpp-app, the identifier.** `EXAMPLE_GTIN` in `packages/dpp-service/src/digital-link.ts` is `09506000134352` and `PASSPORT_ID_ROOT` is `id.gs1.org`, a host that will never answer for a demonstration number. Hold the GTIN on the brand's workspace, validated on creation, and the host as a setting, so a licensed number replaces a demonstration one without a code change; mint one 952 GTIN per demonstration model under `dpp.bsvb.net`, as `record-model.md` §3 requires and [`identifiers.md`](identifiers.md) explains; states already published under the old number stay as they are, because a state is permanent.
- **dpp-app.** Delete the PushDrop-reader warning from `docs/PROTOCOL_COMPATIBILITY.md`, since `record-model.md` §2 now carries it, and pick up the codec's `passport_id` and `actor_keyID` bounds with the next `@bsv/dpp-core`.
- **dpp-app, writing.** Its write path meets none of `writing.md`'s duties: no check before `createAction`, broadcast before announce, no compare-and-set on the tip (its own `GO_LIVE_PLAN.md` P1.12, deferred), `acceptDelayedBroadcast: true` so success is reported before the network answers, proofs pulled on the read path and never pushed to the index, so its index answers read `pending` for life (its `docs/OVERLAY_SERVICE.md` says so). In order of repair: `acceptDelayedBroadcast: false` and the network's answer as what is reported; `verifyChain` on the candidate before `createAction`; a compare-and-set on `updateTip`; `noSend`, announce, then `sendWith`; a push of each proof to `/arc-ingest` once `proveMinedStates` has it; and in the wallet-infra deployment behind `WALLET_STORAGE_URL`, ARCADE as `arcUrl` with a callback token so `TaskArcadeSSE` attaches proofs as they are mined.
- **dpp-app, custody.** Its actor and owner keys derive two levels deep from one root (`[1, 'dpp identity v1']` from the server root in `packages/dpp-service/src/identities.ts`, then `[1, 'dpp owner v1']` from that child), a hierarchy only raw keys can produce and the shape `custody.md` §1 names as custody by construction. When accounts move onto BRC-100 wallets, `ownerKeyFor` in `@bsv/dpp-core` is what each wallet produces for field 6, one level from its own root, and `StateCheck.ownerConsentValid` is a new required property of every verification result. The treasury lock under `[1, 'dpp lock v1']` needs no change: it is operator custody, permitted and invisible to a verifier.

## What the stack does not provide

Three things the standard needs are outside the stack and stay the standard's own: the canonical bytes of an attestation (the stack has no JCS), the resolvable DID methods a deployment may use beside `did:key` (`did:bsv` and `did:web` are implemented elsewhere), and the attestation registry's query interface, which is maintained jointly with the second implementing workstream and joins `contracts/` when both parties accept it.
