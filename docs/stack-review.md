# Stack-alignment review of the standard

**Status: open findings, dated 2026-08-30. Nothing here is normative.** Each item below names a gap between the standard's text and what the BSV TypeScript stack already provides, or a place where the text is wrong or has gone stale, with the evidence and the change proposed to the normative documents. No normative text was edited in the pass that produced this document: findings first, edits after, one pull request per component, and each item is deleted from this file when its change lands. The durable result of the same review, the map from every rule to the stack component behind it, is [`stack.md`](stack.md).

**Method.** Every document in `spec/`, `contracts/` and `fixtures/` was read against the stack's source and documentation ([`bsv-blockchain/ts-stack`](https://github.com/bsv-blockchain/ts-stack) at commit `83a7117b8`, 2026-06-26, and its site at https://bsv-blockchain.github.io/ts-stack/ ), against the reference implementation that runs the standard today (`bsv-blockchain-demos/dpp-app` at `ea54152`, 2026-08-23), and, for delivery patterns only, against the Mandala regulated-stablecoin work ([`bsv-blockchain/mandala`](https://github.com/bsv-blockchain/mandala)), whose templates and overlay topics are published inside the stack. Mandala's token semantics have nothing to do with a passport and nothing of them is proposed here; where its delivery shape solves a problem this standard has not yet addressed, it is cited as a reference implementation and no more. Paths below are relative to those repositories, and functions are named rather than line numbers because line numbers do not survive edits.

**Three decisions were taken before this document was written** and are recorded as the agreed direction rather than as open questions: the overlay contract becomes a profile of the stack's upstream contract (§4.1); the fixtures gain additive vectors in the stack's conformance format while the existing files stay verbatim (§5.1); and the record model recommends, without requiring, UHRP hosting and BRC-2 style encryption for the owner tier (§1.6).

**Landed so far.** The record model (former §1, seven findings) landed in `spec/record-model.md`, with an `overlongPassportId` refusal vector added to `fixtures/record-v1.json`. The rules (former §2, five findings) landed in `spec/rules.md`. Identity (former §3, four findings) landed in `spec/identity.md`. The services and the overlay profile (former §4, six findings) landed in `spec/services.md` and a rewritten `contracts/overlay.yaml`.

**How each item is written.** *Gap* says what is missing or wrong. *Evidence* says where to look. *Proposed change* says what the normative text should say, precisely enough to draft from. *Status* is `proposed` until a pull request lands, at which point the item goes.

## 5. The fixtures (`fixtures/`)

### 5.1 Additive conformance vectors in the stack's format (agreed direction)

*Gap.* The fixtures are bespoke JSON with the right intent (byte-for-byte pinning, refusal vectors as part of the fixture, verbatim copies). The stack has a language-neutral conformance format with a JSON schema, stable identifiers, a runner and a cross-language contract, and every SDK in the ecosystem is expected to run it. A DPP fixture in that format is runnable by tooling that already exists.

*Evidence.* `ts-stack/conformance/VECTOR-FORMAT.md` and `conformance/schema/vector.schema.json`: a file requires `id`, `name`, `version`, `reference_impl`, `parity_class` and `vectors`; a vector requires `id`, `description`, `input` and `expected`, with optional `tags`, `skip` and `skip_reason`; binary is lower-case hex; identifiers are permanent and files are append-only after publication; deterministic nonces are required, which the fixtures already have (RFC 6979). `fixtures/README.md` rule 2 requires copies to be verbatim, and `dpp-app/packages/dpp-core/test/fixture.test.ts` regenerates the current files from the test keys, so the existing files must not change shape.

*Proposed change.* Add `fixtures/vectors/dpp/record/v1.json` (`id: dpp.record.v1`) and `fixtures/vectors/dpp/anchor/v3.json` (`id: dpp.anchor.v3`), generated from the existing files: `brc` lists BRC-42, BRC-43 and BRC-48; `reference_impl` names `dpp-core@0.1.0`; `parity_class` is `required`; positive vectors carry `happy-path`, refusal vectors carry `error-case` with an `expected` that names the refusal. The anchor vectors should also gain refusal cases the bespoke fixture does not carry: the three length bounds in `rules.md` §5 (attestation id, subject, type) and the claim's `passportId` bound. The existing `anchor-v3.json` and `record-v1.json` stay verbatim. `fixtures/README.md` describes both forms and names the bespoke files as the source the vectors are generated from until the reference implementation's test suite generates both.

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

The fixtures (5.1 and 5.2) remain; every other component has landed. Each pull request deletes its items from this file; when the file holds only §6 and §7, those move to `stack.md` and this file is removed.
