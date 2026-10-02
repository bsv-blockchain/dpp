# Author and propose a profile

This page is for contributors who add an industry profile, or a new version of one, to this repository, and for the maintainers who review the change. A profile you add is readable by other applications only once `@bsv/dpp-profiles` publishes it, because the package's readers accept only the identifiers in its fixed `PROFILE_IDS` list.

## Before you start

- A checkout of this repository on `main`, Node 22 or later and npm, with `npm ci` and `npm run build` run in its root ([quick start](../quick-start.md)). Every command on this page runs in that root.
- The [profile specification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/profiles.md), which sets the rules every manifest follows.
- Two version numbers you will set, which are different things. The **profile version** is the number after `@` in the identifier, such as `widget@1`. The **manifest format** (`manifestVersion`) is the shape of the manifest file: format 1, which the current profiles use, validates against [`profile-manifest.schema.json`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/schemas/profile-manifest.schema.json); format 2 adds a requirement status per field and a succession record, validates against [`profile-manifest-v2.schema.json`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/schemas/profile-manifest-v2.schema.json), and is what every successor to a frozen profile uses. Neither is the record version of the passport format.

Before you write the manifest, list what the profile must express. For each field, write down its meaning, value shape, unit or code list, access tier, applicability and the source that asks for it. Leave an unresolved source question visible rather than inventing a required value.

## Add an industry profile

The steps use a new profile called `widget@1`; put your own identifier in its place.

1. Write the manifest as `packages/dpp-profiles/manifests/widget@1.json`. For a new industry, copy `general@2.json`, which gives you a format 1 manifest to edit. Set:
   - `"id": "widget"`, `"version": 1`, `"profile": "widget@1"` and `"status": "draft"`;
   - the `const` of the `profile` and `profile_version` stamps to `"widget"` and `1`, because the generated schema requires exactly those values in every payload;
   - `schemaUri` to `generated/payload-schema/widget@1.public.schema.json` and `restrictedSchemaUri` to `generated/payload-schema/widget@1.restricted.schema.json`;
   - your own `title`, `description`, `regulatoryLine`, `applicability` categories and `fields`; the field reference on [@bsv/dpp-profiles](../packages/dpp-profiles.md) describes each field property.

   Leave out `schemaDigest` and `restrictedSchemaDigest`; the generator computes them.
2. Run `npm run build -w @bsv/dpp-profiles`. It reports the manifest as new and not yet frozen, and stops:

   ```
   DEFECT: widget@1 is a new manifest that frozen.json does not list yet; review it and run node scripts/build.mjs --freeze-new, which records its schema digests and refuses to move any existing digest.
   DEFECT: 5 entries are not yet frozen (manifest widget@1, generated/payload-schema/widget@1.public.schema.json, generated/payload-schema/widget@1.restricted.schema.json, generated/consumer/widget-v1.json, generated/mapping/widget@1.md); review them and run --freeze-new, which refuses to move any existing digest.
   2 defects.
   ```
3. Review the manifest and the five generated files the defect names, then run `npm run freeze-new -w @bsv/dpp-profiles`. It records the new digests, refuses to move any existing one and reports `froze 5 new entries in frozen.json (...); every existing digest is unchanged.`
4. Add `'widget@1'` to `PROFILE_IDS` in `packages/dpp-profiles/src/index.ts`. Until it is there, `readManifest('widget@1')` throws `"widget@1" is not a published industry profile`, while `readManifestAny('widget@1')` reads it. Once it is there, the package's manifest tests run against it.
5. Add `'widget@1'` to the sorted list of frozen manifests in test `(j)` of `packages/dpp-profiles/test/successors.test.ts`, the line `expect(Object.keys(frozen.manifests).sort()).toEqual([...])`. `freeze-new` has already updated `frozen.json`; this list is the test's own copy, and until you add to it, test `(j)` is the one that fails. Then build and test again:

   ```sh
   npm run build -w @bsv/dpp-profiles
   npm run test -w @bsv/dpp-profiles
   ```

   The build ends `nothing drifted from frozen.json.` and every test passes: 206 of 206 when this page was checked with `widget@1` added.
6. Add payload tests in `packages/dpp-profiles/test/`: a valid payload, one that lacks required data, a field that does not apply to a category and a case that needs review. `node examples/sample-payload.mjs widget@1` now prints a valid sample to start from.

## Change an existing profile

A frozen manifest never changes. A corrected mandatory field, a changed meaning or an incompatible validation rule is a new profile version. Write it as a draft in manifest format 2, with a `succession` block that names the version it succeeds and gives one migration outcome per predecessor field (`unchanged`, `renamed`, `retyped`, `split`, `new`, `withdrawn` or `relabelled`) with the reason. Then follow steps 2 to 6 above. Existing payloads keep declaring the version they were written under.

A freeze error from the build means the generated bytes differ from the recorded inventory. Inspect that difference first. `npm run refreeze -w @bsv/dpp-profiles` is only for a reviewed change to the generator's output for an existing version: it rewrites the recorded digests, the diff it produces is the review, and it does not establish that the profile is correct.

## Other kinds of profile

| Kind | Schema | Manifests | Identifier list in `src/index.ts` |
|---|---|---|---|
| Exchange | [Exchange profile](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/schemas/exchange-profile.schema.json) | `manifests/exchange/` | `EXCHANGE_PROFILE_IDS` |
| Operator | [Operator profile](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/schemas/operator-profile.schema.json) | `manifests/operator/` | `OPERATOR_PROFILE_IDS` |
| Interoperability | [Interoperability profile](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/schemas/interoperability-profile.schema.json) | `manifests/interoperability/` | `INTEROPERABILITY_PROFILE_IDS` |

These kinds have no generated schemas and no freeze step, and there is no worked procedure for them yet. The package tests validate exchange and operator manifests against their schemas.

## What a profile cannot express yet

- **Lifecycle details.** The manifest schemas have no property for `event_data`, so no profile can yet name the reason for an `UPDATE` or `RETIRE`, or the finer repair-versus-edit vocabulary of record version 1.
- **Restricted tiers.** How the `legitimate` and `authority` tiers are encrypted, and to whom, is not settled.
- **Evidence on claims.** A native claim has no payload, so it cannot carry the evidence facets a profile's event mappings ask for.

These are gaps in the standard. Say in your proposal if your profile needs one of them ([known limitations](../operate/limitations.md)).

## Propose it

Open a pull request through [the contribution route](../contribute/README.md), under the [governance process](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/GOVERNANCE.md). Include together:

- the manifest, its generated files, the `frozen.json` change and the tests;
- for a new version, the change report from `npm run changes -w @bsv/dpp-profiles -- <old> <new>`, such as `battery@2 battery@4`, and what consuming applications must change in their forms, backend, access decisions and stored records ([update profiles and consuming applications](updating-applications.md));
- the migration effect and the source questions you have left open.

Keep source assessments and product claims in the [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json). [Report a disagreement](../contribute/disagreements.md) instead of inventing a missing source requirement. The [package guide](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/README.md) describes the package's scripts, which its [workspace manifest](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/package.json) defines.

Who decides on a profile, who versions it and where its canonical definition lives is not decided yet. Until it is, the frozen manifests in `@bsv/dpp-profiles` are the definitions.

## Next

Compare the profile with its sources using [the readiness review](reviewing-readiness.md). Maintainers then [publish a profile package update](../reference/publishing-profile-updates.md), and application owners adopt it with [update profiles and consuming applications](updating-applications.md).
