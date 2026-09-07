# Choose an industry profile

An industry profile describes product data separately from the passport record format. Read the selected manifest and its generated schemas before validating a payload.

## Select and evaluate a payload

Choose the product family and declared profile version before validating data. Keep public product fields separate from restricted documents or evidence. A field being present does not establish that its value is supported by evidence or that every applicability question is settled.

Use [the profiles example](../packages/dpp-profiles.md#inspect-applicable-fields) to load a battery manifest, inspect the fields applying to an industrial battery and list missing captured fields. Then validate the intended payload against that profile's generated public or restricted schema.

Review unresolved applicability separately. Preserve the selected profile identifier with stored data so another reader can use the same definition. A draft successor is an explicit selection, not an automatic reinterpretation of existing payloads.

Use [projections](../interoperability/projections.md) when the displayed product view combines model, batch or item sources. A projection still needs its own evidence and field findings.

## Choose a profile

| Product data | Guide |
|---|---|
| General | [General](general.md) |
| Battery | [Battery](battery.md) |
| Textile | [Textile](textile.md) |
| A new or revised profile | [Authoring](authoring.md) |

The [profile source](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/profiles.md) defines the framework. The [frozen inventory](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/dpp-profiles/frozen.json) locates the versioned files, and the [ledger](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json) records assessment status. Core verification, profile validation and product qualification are separate results.

Profile repository home: open; see [D-CR5](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L182).
