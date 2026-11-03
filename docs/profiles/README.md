# Choose an industry profile

Passport writers and readers can use this page to choose an industry profile and validate product data. A profile defines fields, meanings, allowed readers and applicability. Payload validation remains separate from passport verification and product qualification.

## Before you start

| Task | Input and source |
|---|---|
| Choose a profile | Product type, category and public or restricted data from the product owner |
| Run sample commands | Node.js 22 or later and a [checkout](../quick-start.md) at the reviewed example revision; run `npm ci` and `npm run build`, then run commands at its root |
| Validate in your own project | `@bsv/dpp-profiles` from the [package guide](../packages/dpp-profiles.md); a JSON Schema 2020-12 validator that asserts formats |
| Use the restricted-validation fragment | Ajv's 2020 build and `ajv-formats`, installed separately as shown below; the selected profile and restricted fields |

## Version names

`@bsv/dpp-profiles` publishes each profile as a manifest: a JSON field list from which it generates two JSON Schemas.

| Version kind | Meaning |
|---|---|
| Profile | `id@version`, such as `battery@2`; the number is the **profile version** |
| Record | the **record version** is version 1, 2 or 3 of the passport format; it fixes what an on-chain [state](../README.md#words-you-will-meet) holds |
| Manifest | The **manifest format**, `manifestVersion` (`1` or `2`), defines the manifest file's shape |

| Access tier | Storage and disclosure |
|---|---|
| `public` | Public payload on chain |
| `owner`, `legitimate`, `authority` | One restricted payload, encrypted once to the owner and held off chain; only its hash goes on chain |
| Disclosure of `legitimate` or `authority` fields | Re-encrypt entitled fields to the recipient's identity key; [the writer example](../packages/how-the-writer-works.md#the-owner-tier) shows owner encryption and disclosure |

## Choose a profile

| Your product | Profile page | Current version | Other versions | `category` values |
|---|---|---|---|---|
| A battery | [Battery](battery.md) | `battery@2` | Drafts `battery@3` and `battery@4` | `lmt` (light transport), `ev` (vehicle), `industrial`, `stationary` (stationary storage); a closed list |
| Clothing, footwear, home textiles and textile accessories | [Textile](textile.md) | `textile@2` | Drafts `textile@3` and `textile@4`; superseded `textile@1` | `apparel`, `footwear`, `home`, `accessory`; an open list |
| Anything else, such as a bicycle, watch, musical instrument, piece of furniture, luggage, jewellery, appliance, tool, sports equipment or artwork | [General](general.md) | `general@2` | Superseded `general@1` | `bicycle`, `watch`, `instrument`, `furniture`, `luggage`, `jewellery`, `appliance`, `sportsEquipment`, `artwork`; an open list |

1. **Write under the current version.** Select a draft by name only for evaluation; no conformance claim can rest on it ([version 4 drafts](version-4-drafts.md)). Superseded versions remain readable, but `checkSelection` refuses new writes under them.
2. **Set `category`.** Closed lists accept only listed values. Open lists accept any non-empty text, but other readers can label only listed values. Battery categories also determine applicable fields.
3. **Read the mapping's assessment status.** A mapping is not an assessment; each profile page states what remains unassessed.

| Profile | Regulation mapped |
|---|---|
| `battery@2` | Regulation (EU) 2023/1542 (Batteries Regulation), Annex XIII |
| `textile@2` | Regulation (EU) 2024/1781 (ecodesign) and Regulation (EU) 1007/2011 (textile fibre names and labelling) |
| `general@2` | Claims no regulation |

### If no profile fits

Use `general@2`, which fits any product and claims no regulation. Other applications cannot read your own profile until `@bsv/dpp-profiles` publishes it: readers accept only the fixed `PROFILE_IDS` list and refuse others with `"<identifier>" is not a published industry profile`. Follow [author and propose a profile](authoring.md) to add one.

## Check a payload

These commands use `general@2`; substitute your selected profile.

1. Generate a sample for a test or demonstration with no real product:

   ```sh
   node examples/sample-payload.mjs general@2 --demonstration > payload.json
   ```

   The sample fills exactly the public schema's required fields with correctly shaped placeholders. `--demonstration` adds `notice` first: `"notice": "Demonstration record: no real product stands behind this passport."`. Omit the flag for real products, which must not carry `notice`. [Identifiers](../identifiers.md) explains the accompanying demonstration prefix 952.
2. Replace all placeholders with product data. Keep `profile` and `profile_version` (`"general"` and `2`): every public payload requires both and must be read under that version, never a newer one.
3. Check the payload:

   ```sh
   node examples/sample-payload.mjs --check general@2 payload.json
   ```

   A valid payload prints `ok: payload.json is a valid general@2 public payload.` Otherwise the command prints one `FAIL:` line per problem and exits with status 1, for example:

   ```
   FAIL: the payload is missing the required field `name`.
   FAIL: the payload has a field the profile does not define: `colour`.
   ```
4. Before encryption, check the `owner`, `legitimate` and `authority` fields together against `readRestrictedPayloadSchema(profile)`. Check a tier disclosure, a subset of that object, against the same schema. Resolve validation failures before encryption.

In your own project, validate both parts with the generated schemas ([package guide](../packages/dpp-profiles.md)). For the restricted check, install the validator separately; the profiles package supplies no validator:

```sh
npm install --save-exact ajv@8.20.0 ajv-formats@3.0.1
```

For this fragment, import `Ajv2020` from `ajv/dist/2020.js`, `addFormats` from `ajv-formats` and `readRestrictedPayloadSchema` from `@bsv/dpp-profiles`. Set `PROFILE` to the selected profile and supply `fields` as the restricted object. Compile the schema as the writer does:

```js
const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
const validatorFor = (schema) => ajv.getSchema(schema.$id) ?? ajv.compile(schema)
const validate = validatorFor(readRestrictedPayloadSchema(PROFILE))
```

Call `validate(fields)`: `true` means the object passes; `false` means inspect `validate.errors`. `strict: false` permits schema annotations Ajv does not recognise; `addFormats` asserts formats. This checks shape only.

### Payload stamps

Besides its profile's public fields, every public schema accepts these five stamps and refuses all other properties:

| Stamp | Requirement and purpose |
|---|---|
| `profile` | Required profile identifier |
| `profile_version` | Required profile version |
| `notice` | Demonstration-only sentence, shown first |
| `object_did` | Optional physical-object DID |
| `dataCarrier` | Data-carrier identifier, such as a chip UID; an index can look it up beside the passport identifier |

Schema validity establishes shape, not truth, completeness or fulfilment of product obligations. Each profile page uses `fieldsFor` to list applicable fields and those needing human review. Keep passport verification, profile validation and product qualification separate.

## Read a stored payload under its profile

Read product data under its declared profile:

1. Read `profile` and `profile_version` from the public payload and join them, such as `battery@4`.
2. Check that the identifier is in `PROFILE_IDS`. `readManifest` and the schema readers throw for any other identifier, but `readManifestAny` checks only the `id@version` form, so make this check yourself before you call it.
3. Read the manifest with `readManifestAny`, which types both manifest formats, and label each value with its field's `label`.
4. Say so when the manifest's `status` is `draft`, and show `notice`, when the payload has one, before the product data.

[Read a record that declares a draft](version-4-drafts.md#read-a-record-that-declares-a-draft) provides a complete live example for any declared profile. Never substitute a newer version.

For reports from `@bsv/dpp-protocol`, set the policy's `payloadValidator` to `profilePayloadValidator(ajv)` to check `payload_public` against its declared profile. Otherwise `schema` reads `unknown`. Missing `profile` and `profile_version` stamps produce `unknown` with `profile-undeclared` either way ([known limitations](../operate/limitations.md)).

## Not defined yet

- No profile defines `event_data` properties for `UPDATE` or `RETIRE`, such as the reason for a retirement or whether an update was a repair, so there is no agreed name for them yet.
- Which parties count as having a legitimate interest, and how they establish it to the owner before a disclosure, is each deployment's to decide; the standard fixes only how a disclosure is encrypted and that it carries no field of a tier the reader is not entitled to.

Both are gaps in the standard ([known limitations](../operate/limitations.md)).

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
