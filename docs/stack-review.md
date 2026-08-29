# Stack-alignment review of the standard

**Status: open findings, dated 2026-08-30. Nothing here is normative.** Each item below names a gap between the standard's text and what the BSV TypeScript stack already provides, or a place where the text is wrong or has gone stale, with the evidence and the change proposed to the normative documents. No normative text was edited in the pass that produced this document: findings first, edits after, one pull request per component, and each item is deleted from this file when its change lands. The durable result of the same review, the map from every rule to the stack component behind it, is [`stack.md`](stack.md).

**Method.** Every document in `spec/`, `contracts/` and `fixtures/` was read against the stack's source and documentation ([`bsv-blockchain/ts-stack`](https://github.com/bsv-blockchain/ts-stack) at commit `83a7117b8`, 2026-06-26, and its site at https://bsv-blockchain.github.io/ts-stack/ ), against the reference implementation that runs the standard today (`bsv-blockchain-demos/dpp-app` at `ea54152`, 2026-08-23), and, for delivery patterns only, against the Mandala regulated-stablecoin work ([`bsv-blockchain/mandala`](https://github.com/bsv-blockchain/mandala)), whose templates and overlay topics are published inside the stack. Mandala's token semantics have nothing to do with a passport and nothing of them is proposed here; where its delivery shape solves a problem this standard has not yet addressed, it is cited as a reference implementation and no more. Paths below are relative to those repositories, and functions are named rather than line numbers because line numbers do not survive edits.

**Three decisions were taken before this document was written** and are recorded as the agreed direction rather than as open questions: the overlay contract becomes a profile of the stack's upstream contract (§4.1); the fixtures gain additive vectors in the stack's conformance format while the existing files stay verbatim (§5.1); and the record model recommends, without requiring, UHRP hosting and BRC-2 style encryption for the owner tier (§1.6).

**Landed so far.** The record model (former §1, seven findings) landed in `spec/record-model.md`, with an `overlongPassportId` refusal vector added to `fixtures/record-v1.json`.

**How each item is written.** *Gap* says what is missing or wrong. *Evidence* says where to look. *Proposed change* says what the normative text should say, precisely enough to draft from. *Status* is `proposed` until a pull request lands, at which point the item goes.

## 2. The rules (`spec/rules.md`)

### 2.1 A paragraph the reference has outgrown

*Gap.* §5 says: "Two places the reference reader is today more lenient than this text ... it parses a 65-byte uncompressed locking push beside the 33-byte compressed one, and it stops at the first drop opcode without validating the tail." Neither is true of the reference any more, and the fixture proves it.

*Evidence.* `dpp-app/packages/overlay-topics/src/uoraAnchor.ts`: the parser returns `null` unless the key push is exactly 33 bytes, with a comment that the 65-byte push "used to parse here", and validates the drop tail exactly as the record codec does ("floor(n/2) OP_2DROPs, one OP_DROP when n is odd, and nothing at all after"). `fixtures/anchor-v3.json` carries `uncompressedKey` and three `malformedTail` refusal vectors, added in the commit "The fixture gains the refusals the leniencies hid".

*Proposed change.* Delete the paragraph. The rule it protected stays: a conforming writer emits the compressed push and the exact tail, a conforming reader refuses anything else. The "deliberate exception to the pre-1.0 tiebreaker" sentence goes with it, since there is no longer a disagreement to except.

*Status.* proposed.

### 2.2 The anchor is a PushDrop too

*Gap.* As `record-model.md` §2 did before it landed, §5 defines the anchor from opcodes upward. It is a BRC-48 PushDrop with the key first and no appended PushDrop signature; the signature is field 8 over the length-delimited preimage the section defines.

*Evidence.* `uoraAnchor.ts` says so in its own commentary: the resolver "locks with `includeSignature: false`" and "`PushDrop.lock`'s own signature is not used and cannot be made to serve here: it has no option to commit to boundaries". The v2 lesson the section already tells is precisely the property PushDrop's built-in signature lacks.

*Proposed change.* §5 states the anchor is a BRC-48 PushDrop output with the locking key first, and keeps the existing explanation of why the template's own signature is not used, now framed as the reason a conforming writer sets `includeSignature` false and signs the preimage itself.

*Status.* proposed.

### 2.3 Invoice numbers, a bound, and the word varint

*Gap.* Three small precision gaps for a cross-language implementer. §3 and §5 name protocol identifiers and key identifiers without the invoice number string. §3's `passportId` is a BRC-42 key identifier with no upper bound (the bound `record-model.md` §3 now sets, on this rail). §5 says fields are serialised "as varint length followed by field bytes" without saying which varint.

*Evidence.* `KeyDeriver.computeInvoiceNumber`; `record-model.md` §5 now spells the construction out. The anchor's attestation id is bounded at 256, inside BRC-42's 800; the subject at 512. `uoraAnchor.ts` builds the preimage with `Utils.Writer.writeVarIntNum`, the Bitcoin variable-length integer.

*Proposed change.* §3 states the invoice number `1-dpp attestation v1-<passportId>` and bounds `passportId` at 512 bytes. §5 states `1-uora anchor v3-<attestation id>` for the locking derivation and says the length prefix is the Bitcoin VarInt (one byte below 253, then `0xfd`, `0xfe`, `0xff` markers with little-endian widths), citing the SDK's `Writer.writeVarIntNum` as one implementation.

*Status.* proposed.

### 2.4 Canonical bytes: nothing to borrow, and that is the right outcome

*Gap.* None in the text. Recorded so the question is not reopened: the stack has no JCS implementation, and the standard's deliberate subset of RFC 8785 with refusals is its own.

*Evidence.* No canonicaliser in `ts-stack/packages/sdk`. Mandala's `MandalaAdmin.canonicalize` (`ts-stack/packages/helpers/ts-templates/src/MandalaAdmin.ts`) takes the same approach, sorted keys and `JSON.stringify` for scalars, and lacks the safe-integer refusal §4 has. The DPP subset is the stricter of the two and there is nothing to import.

*Proposed change.* None to the rule. One sentence in §4 may note that no ecosystem library is required to produce the bytes, which is a feature: a canonicaliser this small is written in an afternoon in any language and the fixture checks it.

*Status.* proposed (informative sentence only).

### 2.5 The attestation signature is a wallet operation

*Gap.* §3 describes the signature precisely and does not say that it is the BRC-100 `createSignature` call with `data` set to the canonical bytes, so an issuer's wallet signs attestations without exporting a key. Same property `record-model.md` §5 now states, second rail.

*Evidence.* As for the record model; the reference's `dpp-app/packages/dpp-service/src/attestation.ts` signs through the same interface.

*Proposed change.* One sentence in §3 after the signature paragraph.

*Status.* proposed.

## 3. Identity (`spec/identity.md`)

### 3.1 `@bsv/did` encodes the same `did:key`, and skips one refusal

*Gap.* §1 defines the `did:key` encoding from first principles and does not mention that the stack ships it. It should, because implementers will reach for `@bsv/did`, and they need to know one thing about it: it does not apply §1's canonical-key refusal.

*Evidence.* `ts-stack/packages/helpers/did/src/utils/multibase.ts`: `publicKeyToDidKey` prepends the same `[0xe7, 0x01]` multicodec prefix and base58btc `z` marker, so the output is byte-identical to §1 and to the reference's `packages/dpp-core/src/did.ts`. `normalizePublicKey` round-trips the input through `PublicKey.fromDER(bytes).toDER()`, and `decodeDidKey` checks the prefix and the 33-byte length and calls `PublicKey.fromDER` for validity; neither compares the re-encoding to the input, so a non-canonical 33-byte encoding is silently turned into the DID of the reduced key, which is exactly the failure §1's first refusal rule exists to prevent. The reference re-implements the fifteen lines rather than depend on `@bsv/did`, to keep a `qrcode` dependency out of a package that promises a two-command clone-to-running (`did.ts`, comment "No new dependency").

*Proposed change.* §1 cites `@bsv/did` as the ecosystem implementation of the same encoding, states that a conforming implementation built on it must add the canonical round-trip check before encoding and after decoding, and records that the encoding is small enough to reproduce where the dependency is unwanted.

*Status.* proposed.

### 3.2 The invoice number, again

*Gap.* §2 describes the parent-to-child step in words. Add the invoice number and the `anyone` key, as `record-model.md` §5 now does, so the identity document is self-sufficient for a credential verifier who has never read the record model.

*Proposed change.* One sentence: the child is the BRC-42 child of the parent for invoice number `1-dpp token v1-<actor_keyID>` with the `anyone` private key `1` as the deriving secret.

*Status.* proposed.

### 3.3 Name the resolvable methods the reference has run, and the one thing they are not

*Gap.* §3 allows "a resolvable DID method" beside `did:key` and names none. Two have been exercised by the reference and a third thing in the stack is easily mistaken for one.

*Evidence.* `dpp-app/packages/dpp-service/src/did-bsv.ts` implements `did:bsv`, an on-chain method with a versioned document and a universal resolver, decoded from the method's own mainnet transactions and written up in `dpp-app/docs/bsv-did/`; `did-web.ts` implements `did:web` for a deployment's identity with key history, which the UN Transparency Protocol's implementer register asks for. In the stack, `@bsv/did-client` (`packages/helpers/did-client`) and the `tm_did` topic (`packages/overlays/topics/src/did`) mint, find and revoke DID tokens by serial number on an overlay; that is a registry of tokens, not a DID method a resolver answers, and its name invites the confusion.

*Proposed change.* §3 gains a non-normative paragraph naming `did:bsv` and `did:web` as resolvable methods the reference has used, each with the property it was chosen for (a versioned on-chain document; a served document with key history), and one sentence distinguishing the stack's DID-token overlay from a DID method.

*Status.* proposed.

### 3.4 Two credential mechanisms, one derivation step

*Gap.* §2 speaks of "a credential issued about the party behind a record" without saying what a credential is in this ecosystem. There are two mechanisms, and the standard is compatible with both because both name the parent key.

*Evidence.* `ts-stack/packages/sdk/src/auth/certificates/Certificate.ts`: a BRC-52 identity certificate whose `subject` is the compressed identity key in hex, signed by a `certifier`, with a `revocationOutpoint`, resolved through `IdentityClient` (`packages/sdk/src/identity`) and the `tm_identity` topic. `@bsv/did` issues SD-JWT verifiable credentials whose issuer and holder binding are the same key as a `did:key`. The reference uses the SD-JWT route. In either case the credential names the parent, and §2's single derivation reaches the child that signed.

*Proposed change.* §2 gains an informative paragraph naming both mechanisms and stating that the derivation step is the same for either.

*Status.* proposed.

## 4. The services and the overlay contract (`spec/services.md`, `contracts/overlay.yaml`)

### 4.1 The contract should be a profile of the upstream wire (agreed direction)

*Gap.* `contracts/overlay.yaml` describes itself as "the BSV ecosystem's standard overlay wire (BRC-22 submission, BRC-24 lookup)" and then restates that wire in its own words, so a reader cannot tell what is the ecosystem's and what is this standard's. Restating also drifts: the stack's contract has grown routes the DPP document does not know about, and the SDK's client behaves in ways the DPP document does not describe.

*Evidence.* The upstream contract is `ts-stack/specs/overlay/overlay-http.yaml`, documented at the overlay HTTP page of the site and served by `packages/overlays/overlay-express/src/OverlayExpress.ts`. Divergences: (a) `/getDocumentationForTopicManager` and `/getDocumentationForLookupServiceProvider` are absent from the DPP contract although `DppTopicManager` and `DppLookupService` implement `getDocumentation()` (`dpp-app/packages/overlay-topics/src/tmDpp.ts`, `lsDpp.ts`); (b) the SDK's `LookupResolver` sends `X-Aggregation: yes` by default and accepts either the binary aggregated answer or the JSON `output-list` by content type; the DPP index serves only the JSON form, which works and is nowhere written down; (c) `/health/live` and `/health/ready` are absent; (d) GASP (`/requestSyncResponse`, `/requestForeignGASPNode`) and `/arc-ingest` exist upstream and the DPP contract is silent on whether an index may implement them; (e) the mainnet preset of `LookupResolver` refuses plain HTTP and times out at two seconds by default, both of which an operator must know. The reference's HTTP host is a hand-written `node:http` server (`packages/overlay-topics/src/index.ts`) with its own engine storage (`engineStorage.ts`); every canonical topic in the stack is instead mounted on `OverlayExpress`, which provides all of the above, and the site's "Run an overlay node" guide is the recipe.

*Proposed change.* `contracts/overlay.yaml` is rewritten as a profile: it declares conformance to the upstream overlay HTTP contract by reference, and specifies only what this standard adds or fixes: the two topics (`tm_dpp`, `tm_uora_dpp`) and two lookup services (`ls_dpp`, `ls_uora_dpp`) with their query schemas and answer bounds; the admission rules each topic applies, by reference to the record model and the rules; the `X-Admission` response header and the optional bearer token on submission as extensions; the additional `/health` fields; a statement that a DPP index MUST serve the documentation routes, MAY serve the binary aggregated lookup answer and MUST serve the JSON `output-list` answer, MAY implement GASP and `/arc-ingest`, and SHOULD be reachable over HTTPS. `services.md` §2 points at the upstream contract as the wire and at the profile as what is DPP-specific, and adds a non-normative sentence that mounting the topics on `@bsv/overlay-express` satisfies the whole profile.

*Status.* proposed.

### 4.2 Interchangeable copies with no way to find them

*Gap.* `services.md` §1 says "an operator's copy and a stranger's copy are interchangeable". Nothing in the standard says how a reader finds a stranger's copy, so in practice every reader is configured with one operator's URL and the interchangeability is theoretical.

*Evidence.* The stack has the mechanism: SHIP advertisements for topics and SLAP advertisements for lookup services, created by `WalletAdvertiser` in `ts-stack/packages/overlays/overlay-discovery-services` with a funded BRC-100 wallet and served by the Engine's `syncAdvertisements`; readers use `LookupResolver` (`packages/sdk/src/overlay-tools/LookupResolver.ts`), which asks SLAP trackers which hosts serve a named lookup service and merges their answers, or pins a host with `hostOverrides`; writers announce with `TopicBroadcaster` to every SHIP-advertised host of a topic. The reference omits the advertiser on purpose: its host's header comment says advertising "would need this service to hold a funded wallet of its own", which is a limitation of that deployment, not of the standard.

*Proposed change.* `services.md` §1 or §2 gains a paragraph: a public index SHOULD advertise its topics and lookup services through SHIP and SLAP so that a reader who knows only the service name finds it; a reader MAY pin a known host instead; the discovery mechanism is the ecosystem's and is not redefined here. The reference's omission is recorded here, not in the standard.

*Status.* proposed.

### 4.3 Two valid orders of announce and broadcast

*Gap.* `services.md` §2 requires that "a conforming writer must not fail a record over a failed announcement", which assumes the writer broadcasts first and announces after. There is a second order with a property worth having: submit to the index first with the transaction unsent, broadcast only on admission, and abort otherwise. Because a topic manager runs the same checks a verifier runs, an invalid state then never reaches the chain.

*Evidence.* Mandala's client does this: `createAction` with `noSend`, `POST /submit`, then `createAction` with `sendWith` on a non-empty admission and `abortAction` on rejection (`mandala/lib/README.md`; `mandala/docs/superpowers/specs/2026-07-07-go-overlay-port-appendix-b-wire-contract.md` §1). The DPP topic manager applies the record model's decode rules, both signatures and the transition rules (`tmDpp.ts`), so admission is a verifier's verdict.

*Proposed change.* §2 keeps the existing rule for broadcast-first writers and adds a MAY: a writer may announce before broadcasting and treat refusal as a reason not to broadcast; a writer that does so still must not treat an unreachable index as a refusal. Reference only; no Mandala vocabulary enters the text.

*Status.* proposed.

### 4.4 Admission must be idempotent

*Gap.* Nothing in `services.md` §6 says what happens when an index sees the same output twice. It will: GASP re-synchronisation and reorganisation replay both re-admit outputs, and a lookup service that appends a row per admission double-counts.

*Evidence.* Mandala's robustness audit found exactly this in its own lookup service (`mandala/docs/overlay-topics-robustness-patches.md`, item 4: "Admin-history rows duplicate on re-admit"). The reference already gets it right: `dpp-app/packages/overlay-topics/src/storage.ts` and `anchorStorage.ts` upsert on a unique `(txid, outputIndex)` index, so a second admission is a no-op. That is a property of one implementation, and it should be a rule.

*Proposed change.* §6 adds: admitting an output the index already holds is a no-op, and a conforming index produces the same answers after any replay of its inputs. One sentence, with the reason.

*Status.* proposed.

### 4.5 The topics belong in `@bsv/overlay-topics`

*Gap.* `services.md` §2 describes the index's two topics without saying where their canonical implementations should live. The stack has one place for first-class topics, and being there is what makes a topic mountable by any overlay operator with one import.

*Evidence.* `ts-stack/packages/overlays/topics/src/index.ts` exports every canonical topic manager and lookup service (`tm_did`, `tm_uhrp`, `tm_identity`, `tm_kvstore`, `tm_mandala` and the rest), each with Markdown documentation in a `*Docs.md.ts` file returned by `getDocumentation()`. The reference's `tm_uora_dpp` already depends only on `@bsv/sdk` and `@bsv/overlay` so that it can be contributed there without dragging the token core along (`uoraAnchor.ts`, "Why this file imports nothing of ours"; dpp-app decision D-CR7). The reference's `getDocumentation()` returns a few joined lines rather than a document.

*Proposed change.* §2 names `@bsv/overlay-topics` as the intended home of `tm_dpp`, `ls_dpp`, `tm_uora_dpp` and `ls_uora_dpp`, so that "anyone may operate them" has a concrete path, and says a topic's `getDocumentation()` returns the admission rules in Markdown, since the upstream contract exposes it to operators.

*Status.* proposed.

### 4.6 Lookup answer shape: intentional omissions

*Gap.* None. Recorded so nobody "fixes" it: the upstream `LookupAnswer` allows optional `context` and `txid` on each output; the DPP schema omits both. A DPP answer carries everything a verifier needs inside the BEEF, and the client re-derives the txid.

*Proposed change.* One sentence in the profile (4.1) saying the omission is deliberate.

*Status.* proposed.

## 5. The fixtures (`fixtures/`)

### 5.1 Additive conformance vectors in the stack's format (agreed direction)

*Gap.* The fixtures are bespoke JSON with the right intent (byte-for-byte pinning, refusal vectors as part of the fixture, verbatim copies). The stack has a language-neutral conformance format with a JSON schema, stable identifiers, a runner and a cross-language contract, and every SDK in the ecosystem is expected to run it. A DPP fixture in that format is runnable by tooling that already exists.

*Evidence.* `ts-stack/conformance/VECTOR-FORMAT.md` and `conformance/schema/vector.schema.json`: a file requires `id`, `name`, `version`, `reference_impl`, `parity_class` and `vectors`; a vector requires `id`, `description`, `input` and `expected`, with optional `tags`, `skip` and `skip_reason`; binary is lower-case hex; identifiers are permanent and files are append-only after publication; deterministic nonces are required, which the fixtures already have (RFC 6979). `fixtures/README.md` rule 2 requires copies to be verbatim, and `dpp-app/packages/dpp-core/test/fixture.test.ts` regenerates the current files from the test keys, so the existing files must not change shape.

*Proposed change.* Add `fixtures/vectors/dpp/record/v1.json` (`id: dpp.record.v1`) and `fixtures/vectors/dpp/anchor/v3.json` (`id: dpp.anchor.v3`), generated from the existing files: `brc` lists BRC-42, BRC-43 and BRC-48; `reference_impl` names `dpp-core@0.1.0`; `parity_class` is `required`; positive vectors carry `happy-path`, refusal vectors carry `error-case` with an `expected` that names the refusal. The existing `anchor-v3.json` and `record-v1.json` stay verbatim. `fixtures/README.md` describes both forms and names the bespoke files as the source the vectors are generated from until the reference implementation's test suite generates both.

*Status.* proposed.

### 5.2 The runner contract and generation

*Gap.* The standard promises "a conformance test suite anyone can run" and has not said what running it means.

*Evidence.* `ts-stack/conformance/runner/src/runner.js` and the CLI contract in `VECTOR-FORMAT.md`: `--validate-only`, `--filter`, `--report`, exit codes 0, 1 and 2. Mandala's Go overlay port is checked against `overlay-go/testdata/vectors.json` generated from the TypeScript templates by `overlay-go/testdata/gen/gen.mjs`, which is the same discipline the fixture README describes and a demonstration that it carries across languages.

*Proposed change.* `fixtures/README.md` states that the suite's runner will honour the stack's CLI contract, and that vectors are generated from the reference implementation's tests and never edited by hand. GOVERNANCE's per-check reporting rule (sentences, no aggregate score) is compatible with the runner's per-vector report and should be stated as the presentation layer over it.

*Status.* proposed.

## 6. The reference implementation's shape

Not a finding against the normative text, and recorded here because `packages/` has not yet arrived and its shape is about to be decided. The stack has a settled shape for a token standard's code, and Mandala is its most recent instance; the delivery shape transfers, the token semantics do not.

**Script templates.** One `ScriptTemplate` class per output, `DppRecord` and `UoraAnchor`, each with `lock`, `unlock` and a static `decode` that refuses anything but the exact layout, published to `@bsv/templates` (`ts-stack/packages/helpers/ts-templates`) beside `PushDrop` and the Mandala templates. Today the reference exposes the same operations as free functions in `dpp-core` (`buildLockingScript`, `tryParseDppOutput`, the signature helpers) and re-implements minimal-push encoding because the SDK does not export it; as a template class the encoding is inherited and the shape is discoverable by any tool that knows `ScriptTemplate`.

**Topics.** `tm_dpp`, `ls_dpp`, `tm_uora_dpp` and `ls_uora_dpp` in `@bsv/overlay-topics`, with `*Docs.md.ts` documentation, mounted on `OverlayExpress` rather than a hand-written host, so GASP, ARC ingestion, documentation routes, health probes and advertising come with the mount.

**One version, two consumers.** The application and the overlay deployment consume the templates and topics as versioned dependencies pinned to the same version, because a writer and a reader on different encodings is the one failure a fixture cannot catch at runtime (Mandala's `docs/PROJECT-STATE.md` §1 states the rule and the reason).

**Vectors from the reference.** The conformance vectors are generated by the reference implementation's tests, never edited by hand, and a port in another language is accepted when it passes them (Mandala's Go overlay, `overlay-go/testdata`).

**Where DPP deliberately differs.** Mandala dropped its on-chain marker byte and classifies outputs by script shape alone, because it committed to discovery through an overlay and peer-to-peer delivery only (`mandala/docs/superpowers/specs/2026-06-26-mandala-p2pkh-no-marker-design.md`). A passport keeps `dpp` and `1` in fields 1 and 2 because its records are meant to be found by a stranger scanning the chain with no overlay at all. Mandala's admin outputs derive their locking key with counterparty `self`, which only the issuer's wallet can reproduce; the anchor derives with counterparty `anyone`, which any stranger can reproduce, because attribution by a stranger is the point of the anchor. Both are the right choice for their standard and neither should be imported into the other.

## 7. Follow-ups outside this repository

Each of these is an external write and needs explicit approval before anything is posted.

- **ts-stack, `PushDrop.decode`.** The template's encoder maps both the empty field and the single byte `0x00` to `OP_0`, and its decoder returns `[0x00]`, so decode is not the inverse of encode for empty fields. An issue proposing either that `decode` return the empty array for `OP_0` or that it take an option, with this standard as the motivating consumer.
- **ts-stack, BRC index.** `docs/reference/brc-index.md` gives BRC-22 and BRC-24 one-line titles that do not match the stack's own overlay contract, which uses those numbers for submission and lookup. A documentation fix.
- **ts-stack, contributions.** `tm_uora_dpp` and `ls_uora_dpp` to `@bsv/overlay-topics` first (already dependency-clean), `tm_dpp` and `ls_dpp` once the token core is a template in `@bsv/templates`.
- **dpp-app.** Mount the overlay on `@bsv/overlay-express`; add SHIP and SLAP advertising with a funded wallet; delete the PushDrop-reader warning from `docs/PROTOCOL_COMPATIBILITY.md`, since `record-model.md` §2 now carries it; add a test that the codec refuses `overlongPassportId` and regenerate the fixture from the tests so the leading copy carries the vector too.

## 8. Suggested order of work

One pull request per component, in the order the findings are numbered: the rules (2.1 to 2.5), identity (3.1 to 3.4), the services and the overlay profile (4.1 to 4.6), the fixtures (5.1 and 5.2). The record model landed first; findings 2.2, 2.3 and 3.2 reuse sentences from its §2 and §5 and should copy them so the three documents say the same thing in the same words. Each pull request deletes its items from this file; when the file holds only §6 and §7, those move to `stack.md` and this file is removed.
