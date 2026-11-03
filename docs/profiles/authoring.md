# Author and propose a profile

Contributors and maintainers can use this procedure to prepare and review an industry profile: a draft manifest, generated files and tests. Other applications can read it only once `@bsv/dpp-profiles` publishes it, because the package's readers accept only identifiers in the fixed `PROFILE_IDS` list.

## Before you start

| Input | Source and requirement |
|---|---|
| Built checkout | Reviewed example revision, Node 22 or later and npm; run `npm ci` and `npm run build` in the root ([quick start](../quick-start.md)). Run every command below there. |
| Manifest rules | [Profile specification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/profiles.md). |
| Field requirements | From the sources asking for each field: meaning, value shape, unit or code list, access tier and applicability. Keep unresolved source questions visible; do not invent required values. |
| Profile version | Number after `@`, such as `widget@1`. Separate from the manifest format and passport record version. |
| Manifest format | `manifestVersion`: format 1, used by current profiles, follows [profile-manifest.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/schemas/profile-manifest.schema.json). Format 2 adds field requirement status and succession records, follows [profile-manifest-v2.schema.json](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/schemas/profile-manifest-v2.schema.json), and is required for every successor to a frozen profile. |

## Add an industry profile

Replace the example identifier `widget@1` with your own.

1. Copy `general@2.json` to `packages/dpp-profiles/manifests/widget@1.json`. This gives a new industry a format 1 manifest. Set these fields:

   | Field | Value and effect |
   |---|---|
   | Identity and status | `"id": "widget"`, `"version": 1`, `"profile": "widget@1"`, `"status": "draft"`. |
   | Payload stamps | Set the `const` of `profile` and `profile_version` to `"widget"` and `1`. Generated schemas require those exact values in every payload. |
   | `schemaUri` | `generated/payload-schema/widget@1.public.schema.json` |
   | `restrictedSchemaUri` | `generated/payload-schema/widget@1.restricted.schema.json` |
   | Content | Your `title`, `description`, `regulatoryLine`, `applicability` categories and `fields`; see the [field reference](../packages/dpp-profiles.md). |
   | Computed digests | Omit `schemaDigest` and `restrictedSchemaDigest`; the generator computes them. |

2. Run `npm run build -w @bsv/dpp-profiles`. It identifies the new, unfrozen manifest and stops:

   ```
   DEFECT: widget@1 is a new manifest that frozen.json does not list yet; review it and run node scripts/build.mjs --freeze-new, which records its schema digests and refuses to move any existing digest.
   DEFECT: 5 entries are not yet frozen (manifest widget@1, generated/payload-schema/widget@1.public.schema.json, generated/payload-schema/widget@1.restricted.schema.json, generated/consumer/widget-v1.json, generated/mapping/widget@1.md); review them and run --freeze-new, which refuses to move any existing digest.
   2 defects.
   ```

3. Review the manifest and the five generated files the defect names. Run `npm run freeze-new -w @bsv/dpp-profiles`. It records new digests, refuses to move existing ones and reports `froze 5 new entries in frozen.json (...); every existing digest is unchanged.`
4. Add `'widget@1'` to `PROFILE_IDS` in `packages/dpp-profiles/src/index.ts`. Until then, `readManifest('widget@1')` throws `"widget@1" is not a published industry profile`, while `readManifestAny('widget@1')` reads it. Adding it includes it in the package's manifest tests.
5. Add `'widget@1'` to the sorted frozen-manifest list in test `(j)` of `packages/dpp-profiles/test/successors.test.ts`: `expect(Object.keys(frozen.manifests).sort()).toEqual([...])`. `freeze-new` updates `frozen.json`, but this separate test list still fails test `(j)` until updated. Build and test again:

   ```sh
   npm run build -w @bsv/dpp-profiles
   npm run test -w @bsv/dpp-profiles
   ```

   Expect `nothing drifted from frozen.json.` and all tests passing: 206 of 206 when checked with `widget@1` added.
6. Add payload tests in `packages/dpp-profiles/test/`: a valid payload, missing required data, a field inapplicable to a category and a case needing review. `node examples/sample-payload.mjs widget@1` now prints a valid starting sample.

## Change an existing profile

A frozen manifest never changes. A corrected mandatory field, changed meaning or incompatible validation rule needs a new profile version.

1. Write a format 2 draft with a `succession` block naming its predecessor.
2. Give one migration outcome per predecessor field, with a reason: `unchanged`, `renamed`, `retyped`, `split`, `new`, `withdrawn` or `relabelled`.
3. Follow steps 2 to 6 above. Existing payloads retain their declared version.

Stop at a freeze error and inspect the difference between generated bytes and the recorded inventory. Use `npm run refreeze -w @bsv/dpp-profiles` only for a reviewed generator-output change to an existing version. It rewrites recorded digests; its diff is the review, and does not establish profile correctness.

## Other kinds of profile

| Kind | Schema | Manifests | Identifier list in `src/index.ts` |
|---|---|---|---|
| Exchange | [Exchange profile](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/schemas/exchange-profile.schema.json) | `manifests/exchange/` | `EXCHANGE_PROFILE_IDS` |
| Operator | [Operator profile](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/schemas/operator-profile.schema.json) | `manifests/operator/` | `OPERATOR_PROFILE_IDS` |
| Interoperability | [Interoperability profile](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/schemas/interoperability-profile.schema.json) | `manifests/interoperability/` | `INTEROPERABILITY_PROFILE_IDS` |

These kinds have no generated schemas, freeze step or worked procedure yet. Package tests validate exchange and operator manifests against their schemas.

## What a profile cannot express yet

| Area | Limitation |
|---|---|
| Lifecycle details | Manifest schemas have no `event_data` property. Profiles cannot name the reason for an `UPDATE` or `RETIRE`, or record version 1's finer repair-versus-edit vocabulary. |
| Restricted tiers | How the `legitimate` and `authority` tiers are encrypted, and to whom, is not settled. |
| Evidence on claims | A native claim has no payload, so it cannot carry the evidence facets a profile's event mappings ask for. |

These are gaps in the standard. State which your proposal needs ([known limitations](../operate/limitations.md)).

## Propose it

Open a pull request through [the contribution route](../contribute/README.md) under the [governance process](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/GOVERNANCE.md), including:

| Review input | Include |
|---|---|
| Implementation | Manifest, generated files, `frozen.json` change and tests. |
| New version | Change report from `npm run changes -w @bsv/dpp-profiles -- <old> <new>`, such as `battery@2 battery@4`; required changes to application forms, backend, access decisions and stored records ([consumer adoption](updating-applications.md)). |
| Decisions | Migration effect and unresolved source questions. |

Keep source assessments and product claims in the [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json). [Report disagreements](../contribute/disagreements.md); do not invent missing source requirements. The [package guide](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/README.md) describes scripts defined by the [workspace manifest](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/package.json).

Who decides on profiles, versions them and holds their canonical definitions remains undecided. Until settled, the frozen manifests in `@bsv/dpp-profiles` are the definitions.

## Next

Use [readiness review](reviewing-readiness.md) to compare the profile with its sources. Maintainers then [publish the package update](../reference/publishing-profile-updates.md); application owners [adopt it](updating-applications.md).
