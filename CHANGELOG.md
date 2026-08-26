# Changelog

**Pre-1.0.** Everything below is the working draft assembling itself. Breaking changes are expected and are recorded here without apology until version 1.0 is declared, as `GOVERNANCE.md` states. Entries name the pull request that landed them; a change to a wire format names the fixture that moved with it, because the two are never allowed to drift apart.

## Unreleased

### 2026-08-26

- `fixtures/chain-v1.json`: the chain invariants join the conformance seed. A four-state pinned chain with the DPP output moving to index 1 mid-chain, and nine refusal vectors, one per broken invariant, each readable from raw transaction hex alone.
- `CHANGELOG.md` begins, seeded from the first commit, and the fixtures README links each file's leading copy (#21).
- `GOVERNANCE.md` second draft: roles, acceptance thresholds, the conditions for 1.0, security reporting (#22, in review).
- The README describes the repository as it is: present tense, the five spec documents named, both fixtures landed, CI stated (#19).
- The design rationale states reasons for the two rails staying separate and claims nothing about how the decision was reached (#20).

### 2026-08-24

- The reference implementation moves in: `packages/dpp-core` and `packages/overlay-topics` under the public names `@bsv/dpp-core` and `@bsv/dpp-overlay-topics`, the Dockerfile that builds the index node from this repository alone, CI running both suites and the image, and two tests holding `fixtures/*.json` byte-identical to the modules that generate them. Every reference to a private document was remapped to `spec/` and `contracts/` (#17).
- `spec/design-rationale.md`: why the settled choices are what they are, hung off the one property the standard protects (#18).

### 2026-08-23

- `contracts/overlay.yaml` matches the served wire: `X-Topics` optional and defaulting to `tm_dpp`, the `X-Includes-Off-Chain-Values` header, the 413 refusal at 8 MiB, `/health`'s singular probe fields, and `coinsRemoved` present only when the mutation phase ran (#16).

### 2026-08-22

- `spec/record-model.md` states its refusals exactly: non-minimal pushes accepted for non-empty fields only, `OP_0` the sole encoding of the empty field, the single byte `0x00` refused, UTF-8 fields must round-trip, rolled-over dates and the legacy `24:00` refused, and `failed` covers a proof that refutes itself (#14).
- `fixtures/record-v1.json`: the record rail joins the conformance seed, positive vectors and seven refusal vectors (#15).

### 2026-08-21

- The shape of the standard: README, `GOVERNANCE.md`, Open BSV License version 4.
- `spec/record-model.md` (#1), `spec/rules.md` (#2), `spec/identity.md` and `spec/services.md` (#8); corrections from adversarial verification (#11).
- `contracts/overlay.yaml`, the index as OpenAPI (#3); lookup selector floors from live verification (#10).
- `fixtures/anchor-v3.json`, the anchor byte for byte (#4); refusal vectors for the reader leniencies (#13).
- README names the first consuming application (#9).
