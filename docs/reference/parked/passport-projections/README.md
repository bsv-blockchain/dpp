# Parked: passport projections and the publication policy

**Out of the standard.** This folder keeps the specification of `passport-projection@1`, the deterministic derivation of one passport's fields from pinned model, batch and item sources, and of `publication-policy@1`, the policy that names which representation of a passport is current. Both were made reference-only on 12 November 2026. Nothing here is a requirement, no conformance claim covers them, and their ledger rows and their one claim are kept without a status in [the ledger archive](../ledger-archive.json).

The projection helpers stay in `@bsv/dpp-profiles` as reference code, because the reference application uses them: `projectPassport`, `projectionCommitment`, `projectionDigest` and `verifyProjectionCommitment`, with their schemas, now `packages/dpp-profiles/schemas/passport-source.schema.json` and `packages/dpp-profiles/schemas/passport-projection.schema.json`, and their vectors under `fixtures/vectors/dpp/interoperability/projection/`, which the package's tests still run. [Passport projections](../../../interoperability/projections.md) shows how to use them.

What version 4 industry profiles depend on moved into `spec/profiles.md` the same day. From the parked specification, the manifest format 2 rules of its section 6 went into `spec/profiles.md` section 2, the three-valued applicability evaluator into section 3, the shared shapes of its section 5 into section 3 with `contracts/profile-evidence.schema.json`, which stays a contract, and the additive freeze into section 4.

## What is here

| File | What it pins |
|---|---|
| [`passport-projections.md`](passport-projections.md) | The specification as it stood, once `spec/passport-projections.md`, with a parked note at the top. Its links to other documents point at the revision below. |

## The last working revision

Commit [`d8b912e`](https://github.com/bsv-blockchain/dpp/tree/d8b912e5a311137163bdf958673bff3f4e10558b/packages/dpp-profiles/src), the last commit on `main` before the rulings of 12 November 2026, carries the specification in the standard and its contracts at `contracts/passport-source.schema.json` and `contracts/passport-projection.schema.json`, and nothing after it changed the projection code, text, schemas or vectors before the specification was parked. At that revision:

- `packages/dpp-profiles/src/projections.ts` implements the derivation, `packages/dpp-profiles/src/evidence-shapes.ts` the shapes and `packages/dpp-profiles/src/applicability.ts` the evaluator, tested by `packages/dpp-profiles/test/projections.test.ts`, `evidence-shapes.test.ts`, `applicability.test.ts` and `packaging-fixture.test.ts`.
- The claim `passport-projection-1` required the rows `PROJ-1` to `PROJ-8` beside `PROF-2-manifest-version-2`, `PROF-3-applicability-evaluator` and `PROF-4-frozen-unchanged`. The three profile rows stay in the ledger under the claim `profile-governance`.
- The publication policy and the rendering presets of sections 7 and 8 were implemented and tested only by the reference application, never in this repository.

A profile that brings projections back into the standard starts from that revision and from `passport-projections.md`, as a new version of the projection profile.
