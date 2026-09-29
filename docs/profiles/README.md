# Choose an industry profile

An industry profile describes product data separately from the passport record format. Read the selected manifest and its generated schemas before validating a payload.

## Select and evaluate a payload

Choose the product family and declared profile version before validating data. Keep public product fields separate from restricted documents or evidence. A field being present does not establish that its value is supported by evidence or that every applicability question is settled.

Use [the profiles example](../packages/dpp-profiles.md#inspect-applicable-fields) to load a battery manifest, inspect the fields applying to an industrial battery and list missing captured fields. Then validate the intended payload against that profile's generated public or restricted schema: `node examples/sample-payload.mjs <profile@version>` prints a minimal valid public payload to start from, and `--check` checks yours.

Review unresolved applicability separately. Preserve the selected profile identifier with stored data so another reader can use the same definition. A draft successor is an explicit selection, not an automatic reinterpretation of existing payloads.

Use [projections](../interoperability/projections.md) when the displayed product view combines model, batch or item sources. A projection still needs its own evidence and field findings.

## Choose a profile

| Product data | Guide |
|---|---|
| General | [General](general.md) |
| Battery | [Battery](battery.md) |
| Textile | [Textile](textile.md) |
| A new or revised profile | [Authoring](authoring.md) |
| Adopt a changed profile in an application | [Updates and consumer adoption](updating-applications.md) |
| Compare requirements, schemas and implementation evidence | [Readiness review](reviewing-readiness.md) |
| Evaluate the unreleased battery and textile revisions | [Version 4 drafts](version-4-drafts.md) |

The [profile source](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/profiles.md) defines the framework. The [frozen inventory](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/packages/dpp-profiles/frozen.json) locates the versioned files, and the [ledger](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/conformance/manifest.json) records assessment status. Core verification, profile validation and product qualification are separate results.

Profile governance: open. Who versions a profile and where its canonical definition lives is undecided; until it is settled, the frozen manifests in `@bsv/dpp-profiles` are the definitions.
