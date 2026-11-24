# Retired draft profiles

`battery@3`, `battery@4`, `textile@3` and `textile@4` were drafts under manifest format 2, proposed as successors to `battery@2` and `textile@2`. All four are retired from 14 November 2026, together with the versions they were to succeed. Reviewers and application owners can use this page to see what became of the drafts and what still reads them.

No draft is open today. For battery and textile data, use `eu-battery@2` and `eu-textile@2` on the [EU battery and textile bindings](eu-sector-bindings.md) page.

## What happened

| Date | Event |
|---|---|
| 18 September 2026 | Version 0.3.0-beta.2 of the profiles package first carried `battery@4` and `textile@4`, beside the earlier drafts `battery@3` and `textile@3`. The [beta.2 publication receipt](../reference/publication-history/beta-2-publication.md) records the source and package bytes |
| 12 November 2026 | `battery@3`, `textile@3` and `textile@4` were parked, with no byte of their manifests or generated files changed. `battery@4` stayed the one draft |
| 14 November 2026 | All four drafts were retired with `battery@2`, `textile@2` and `textile@1`. The bindings `eu-battery@1` and `eu-textile@1` replace them |

A draft was never selected by default and never supported a conformance claim. Publishing the drafts changed no other version, and retiring them changed no byte of theirs.

## What no longer works

| You do this | You get this |
|---|---|
| `node examples/sample-payload.mjs battery@4`, with or without `--check` | `profile-retired`, the replacement, and exit status 2 |
| `missingRequiredV2(manifest, payload, context)` with a retired manifest | A `ProfileRetiredError`, code `profile-retired` |
| `reviewProfileData('battery@4', payload)` or `reviewProfileData('textile@4', payload)` | A `ProfileRetiredError`. The cross-field review these two drafts had is gone, and no supported profile defines one |
| `checkSelection` with a draft as `industry` | The conflict `industry-retired`, for every purpose |
| Write a state that declares a draft | A refusal with `profile-retired` in the application starter, before anything is signed |

## What still reads a draft

The definitions stay published, byte for byte, at the digests the [frozen inventory](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/frozen.json) records. These read them as history and judge no payload:

| Function or command | What it gives |
|---|---|
| `readManifestAny('battery@4')` | The frozen manifest, in format 2. Its `status` still reads `draft`, because the file is immutable. `RETIRED_PROFILE_IDS` says it is retired |
| `fieldsForV2(manifest, context)` | Which fields the definition applies to a category, jurisdiction and date, and which it leaves unresolved |
| `compareProfiles('battery@2', 'battery@4')`, or `npm run changes -w @bsv/dpp-profiles -- battery@2 battery@4` in a checkout | The structural difference between two frozen manifests of one industry |
| The manifest's `succession` block | One migration outcome for each field of the version the draft followed, with the reason |

## A record that declares a draft

A stored record that declares a draft is not rewritten and cannot be erased. A reader built from this candidate checks its signatures, links and proofs as for any passport, and reports its payload under `schema` as `unknown` with `schema-unavailable` and the cause `profile-retired`. It does not label the values from the draft's manifest as if the profile were supported ([read a stored payload under its profile](README.md#read-a-stored-payload-under-its-profile)).

The hosted reference holds demonstration passports that declare `battery@4` and `textile@4` ([hosted reference](../deployment.md)). They stay on chain as written.

## Sources

| Material | Source |
|---|---|
| Retired battery drafts | [battery@3](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/battery@3.json), [battery@4](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/battery@4.json) |
| Retired textile drafts | [textile@3](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/textile@3.json), [textile@4](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/textile@4.json) |
| The retirement rule | [Profile specification](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/spec/profiles.md), in its section on versions, freezing, retirement and migration |

## Next

Application owners continue with [move off the retired sector profiles](../migration.md#move-off-the-retired-sector-profiles). To write battery or textile data, open the [EU battery and textile bindings](eu-sector-bindings.md).
