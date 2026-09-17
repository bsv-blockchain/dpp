# Evaluate the version 4 drafts

The working checkout adds `battery@4` and `textile@4` as explicit draft selections. They are included in the `@bsv/dpp-profiles@0.3.0-beta.2` release candidate; npm publication is pending. Installing `0.3.0-beta.1` does not obtain them. Version 2 remains current, and every version 3 manifest and generated artefact remains unchanged. A package release and application activation require separate decisions.

## Battery changes

| Change | Migration and application work |
|---|---|
| `manufacturingMonth` becomes required; `manufacturingDate` becomes optional | Derive the month from a valid recorded day when available. Accept a month-only source without inventing a day. If both are present, check they agree. |
| `manufacturerAddress.addressLine` becomes required | Obtain the actual postal delivery address or post-office box. City and country alone cannot supply it. A successful shape check does not verify deliverability. |
| `originalPowerCapability` captures power at 20% and 80% state of charge for EV and industrial categories | Capture both measurements, conditions, method and evidence. The legacy scalar remains the LMT representation. Never duplicate one scalar into both measurements. |
| New `*AtStatusChange` measurement arrays | Record individual power, resistance, efficiency and fade values with their item, method, time and evidence. Keep model baselines and state-of-health applicability separate. |
| `relatedDocuments` carries supporting metadata in the restricted payload | Resolve document content, media type, retention and audience before constructing external exports. This optional field does not satisfy all document obligations. |
| Due-diligence and proposal provenance corrected | The enacted future due-diligence date is distinct from an unadopted act. Scope and exemptions remain unresolved. Instructions-for-use proposal provenance does not establish enactment. |

The paired power measurements use the reference conditions in DIN DKE SPEC 99100:2025-02 clause 6.7.3.2. Their JSON representation is a profile choice. The measurement additions separate Annex XIII 4(a) individual performance from Article 14 state-of-health data. Neither addition proves that an operator has supplied all legally applicable lifecycle evidence.

## Textile changes

The draft separates anticipated textile passport requirements from existing labelling duties and application field choices. Framework provisions no longer imply that every named passport field is already legally mandatory. Care codes, origin information, expected lifetime, collection instructions and supporting chemical documents retain their application purpose without an unsupported claim that the cited provision mandates that exact field.

`componentFibres` now identifies Article 11 of Regulation (EU) 1007/2011 as its existing basis. Its applicability remains unresolved until the product's components and exceptions have been assessed. Do not replace required component declarations with a whole-product average. The cross-field helper reports unresolved component references and component share totals needing reconciliation; it does not decide legal exemptions or analytical tolerances.

Sustainability-label metadata records the certification-scheme and public-authority alternatives, the relevant consumer-directive provisions and their application date. It does not require every textile to obtain certification. Guarantee information remains conditional on the actual offer and applicable national measures. The model identity now references `modelIdentifier`; a display name is not an identifier.

## Integrate the draft deliberately

Build the working checkout using [the setup instructions](../quick-start.md#prepare-the-checkout). Generate the report for the version the application actually uses:

```sh
npm run changes -w @bsv/dpp-profiles -- battery@2 battery@4
npm run changes -w @bsv/dpp-profiles -- textile@3 textile@4
```

The same operation is available as `compareProfiles(from, to)` from the package's Node entry point. The report includes manifest digests, field changes and top-level changes such as identity rules. It can be attached to an upgrade proposal; delivery to consumer owners remains a separate workflow.

Validate payload structure against the exact generated public or restricted schema. Then evaluate applicability and run the additional cross-field review:

```js
import { readManifestAny, missingRequiredV2, reviewProfileData } from '@bsv/dpp-profiles'

const manifest = readManifestAny('battery@4')
const context = { category: 'ev', jurisdiction: 'EU', asOf: '2027-02-18' }
const registration = missingRequiredV2(manifest, payload, context)
const dataFindings = reviewProfileData('battery@4', payload)
```

Here `payload` is the application's data, already validated against the selected schema. Treat `invalid` findings as rejected data and retain `needs-review` findings for evidence review. Registration, applicability and cross-field results are separate. An empty findings list does not certify readiness; unsupported profile versions are refused by this helper.

Update the consumer's capture forms, adapters, backend checks and exports before enabling draft writes. [Consumer adoption](updating-applications.md) describes the rollout and history requirements. These changes do not automatically activate dpp-app or any other consumer.

## Assessment work still open

The drafts do not include a complete external-format export adapter, hosted readiness-test result, full current-law reconciliation, licensed-standard assessment or deployed actor/access evidence. Additional identity context, category classification, evidence qualification and measurement semantics still need review. [Readiness review](reviewing-readiness.md) explains how to collect that evidence before considering promotion.
