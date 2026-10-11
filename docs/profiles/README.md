# Choose an industry profile

An industry profile defines the product data a passport carries: the fields, what each means, who may read it and when it applies. Use this page to choose the profile for your product and then to check a payload against it, whether you write passports or read them.

Each profile is published in `@bsv/dpp-profiles` as a manifest, a JSON file that lists every field, and the package generates two JSON Schemas from each manifest. A profile is named `id@version`, such as `battery@2`, and that number is the **profile version**. Two other version numbers are different things: the **record version** is version 1 or 2 of the passport record format, which fixes what an on-chain [state](../README.md#words-you-will-meet) holds, and the **manifest format** (`manifestVersion`, `1` or `2`) is the shape of the manifest file itself.

Each field has an access tier, which says who may read it: `public` fields go on chain in the public payload, and the `owner`, `legitimate` and `authority` tiers form the restricted payload, held off chain and encrypted, with only its hash on chain ([how the writer example works](../packages/how-the-writer-works.md#the-owner-tier) shows the encryption).

## Choose a profile

| Your product | Profile page | Current version | Other versions | `category` values |
|---|---|---|---|---|
| A battery | [Battery](battery.md) | `battery@2` | Drafts `battery@3` and `battery@4` | `lmt` (light transport), `ev` (vehicle), `industrial`, `stationary` (stationary storage); a closed list |
| Clothing, footwear, home textiles and textile accessories | [Textile](textile.md) | `textile@2` | Drafts `textile@3` and `textile@4`; superseded `textile@1` | `apparel`, `footwear`, `home`, `accessory`; an open list |
| Anything else, such as a bicycle, watch, musical instrument, piece of furniture, luggage, jewellery, appliance, tool, sports equipment or artwork | [General](general.md) | `general@2` | Superseded `general@1` | `bicycle`, `watch`, `instrument`, `furniture`, `luggage`, `jewellery`, `appliance`, `sportsEquipment`, `artwork`; an open list |

- **Write new records under the current version.** A draft is for evaluation: an application uses one only by naming it, and a conformance claim cannot rest on it ([evaluate the version 4 drafts](version-4-drafts.md)). A superseded version stays readable for the records that declare it, and the package's `checkSelection` refuses a new write under it.
- **Put one of the values in the payload's `category` field.** A closed list accepts only its values. An open list accepts any non-empty text, but other readers can label only the listed values. For a battery, the category also decides which fields apply.
- **What each profile maps.** `battery@2` is mapped to Regulation (EU) 2023/1542 (the Batteries Regulation), Annex XIII. `textile@2` is mapped to Regulation (EU) 2024/1781 (ecodesign) and Regulation (EU) 1007/2011 (textile fibre names and labelling). `general@2` claims no regulation. A mapping is not an assessment: each profile page says what is still unassessed.

### If no profile fits

Use `general@2`: it claims no regulation and fits any product. A profile of your own cannot be read by other applications until `@bsv/dpp-profiles` publishes it, because the package's readers accept only the identifiers in its fixed `PROFILE_IDS` list and refuse any other with `"<identifier>" is not a published industry profile`. To add one, follow [author and propose a profile](authoring.md).

## Check a payload

Run these in the root of a checkout of this repository at the reviewed example revision, after `npm ci` and `npm run build` ([quick start](../quick-start.md)). They use `general@2`; put your profile's identifier in its place.

1. Print a sample payload. For a test or demonstration record, one that describes no real product, add `--demonstration`:

   ```sh
   node examples/sample-payload.mjs general@2 --demonstration > payload.json
   ```

   The sample holds every field the public schema requires and nothing else, each with a placeholder of the right shape. With `--demonstration` it starts with `notice`, the sentence a person reads first: `"notice": "Demonstration record: no real product stands behind this passport."`. A record about a real product must not carry `notice`, so leave the flag out for a real product ([identifiers](../identifiers.md) explains the demonstration prefix 952 that goes with `notice`).
2. Replace every placeholder with the product's own data. Keep `profile` and `profile_version` as printed (`"general"` and `2`). Every public payload carries both, and a reader decodes the payload under that profile version, never under a newer one.
3. Check the payload:

   ```sh
   node examples/sample-payload.mjs --check general@2 payload.json
   ```

   A valid payload prints `ok: payload.json is a valid general@2 public payload.` Otherwise the command prints one `FAIL:` line per problem and exits with status 1, for example:

   ```
   FAIL: the payload is missing the required field `name`.
   FAIL: the payload has a field the profile does not define: `colour`.
   ```
4. Check the restricted payload, the `owner`, `legitimate` and `authority` fields together in one object, against `readRestrictedPayloadSchema(profile)` before you encrypt it. In your own project, without a checkout, validate both parts with the generated schemas, as [@bsv/dpp-profiles](../packages/dpp-profiles.md) shows.

Besides the profile's public fields, every public schema accepts five properties that the manifest calls stamps: `profile` and `profile_version`, which are required; `notice`; `object_did`, an optional physical-object DID; and `dataCarrier`, a data-carrier identifier such as a chip UID, which an index can look up beside the passport identifier. The schema refuses any other property.

A valid payload has the right shape, and that is all it shows. It does not show that the values are true, that every field which applies to the product is filled, or that the product meets its obligations. Each profile page runs `fieldsFor`, which lists the fields that apply to a category and those that need a person's review. Passport verification, profile validation and product qualification are three separate results.

## Read a stored payload under its profile

A reader shows product data under the profile the payload declares:

1. Read `profile` and `profile_version` from the public payload and join them, such as `battery@4`.
2. Check that the identifier is in `PROFILE_IDS`. `readManifest` and the schema readers throw for any other identifier, but `readManifestAny` checks only the `id@version` form, so make this check yourself before you call it.
3. Read the manifest with `readManifestAny`, which types both manifest formats, and label each value with its field's `label`.
4. Say so when the manifest's `status` is `draft`, and show `notice`, when the payload has one, before the product data.

Never read a payload under a newer version than the one it declares. [Read a record that declares a draft](version-4-drafts.md#read-a-record-that-declares-a-draft) is a complete example that reads a live passport this way; it works for any declared profile.

The passport verification report from `@bsv/dpp-protocol` does not check `payload_public` against its declared profile, so a reader that needs that check runs it itself, as [check a payload](#check-a-payload) shows ([known limitations](../operate/limitations.md)).

## Not defined yet

- No profile defines `event_data` properties for `UPDATE` or `RETIRE`, such as the reason for a retirement or whether an update was a repair, so there is no agreed name for them yet.
- How the `legitimate` and `authority` tiers reach the parties entitled to read them is not settled. Only the owner tier's encryption is defined.

Both are gaps in the standard rather than in these pages ([known limitations](../operate/limitations.md)).

## Other profile tasks

| Task | Page |
|---|---|
| Try a draft before it becomes current | [Evaluate the version 4 drafts](version-4-drafts.md) |
| Adopt a new profile version in an application | [Update profiles and consuming applications](updating-applications.md) |
| Compare a profile and an application with regulations, standards or an external validator | [Review profile and application readiness](reviewing-readiness.md) |
| Add or revise a profile | [Author and propose a profile](authoring.md) |
| Publish a profile package update (maintainers) | [Publish a profile package update](../reference/publishing-profile-updates.md) |
| Show one product view that combines model, batch and item sources | [Passport projections](../interoperability/projections.md) |

## Where the definitions live

The [profile specification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/profiles.md) defines the framework. The frozen manifests in `@bsv/dpp-profiles` are the definitions, and the [frozen inventory](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/frozen.json) records the digest of every versioned file. The [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) records what has been assessed. Who versions a profile, and where its canonical definition lives in the long run, is not decided yet.

## Next

Open your profile's page, [general](general.md), [battery](battery.md) or [textile](textile.md), to start from its sample and inspect its fields. Then put the payload in a passport with [build an application](../packages/build-an-application.md).
