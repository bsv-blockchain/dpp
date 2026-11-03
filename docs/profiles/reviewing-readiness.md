# Review profile and application readiness

Compliance reviewers, profile maintainers and application owners can use this five-stage review to compare a profile and application with applicable regulations, standards or external validators. The result records what the application can represent, which obligations apply, evidence for its values and whether the deployment handles required interactions. A schema pass answers only part of this question.

Use the process when a profile changes, a source is revised or an application adopts a release. Keep unresolved findings visible until evidence is available. This page describes the review; linked guides explain the commands it relies on.

## Review inputs

| Input | Source and scope |
|---|---|
| Profile baseline | Exact version, such as `battery@2`, and generated schema digests from its manifest; the [frozen inventory](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/frozen.json) records digests for every version. Record the installed package version too. |
| Application baseline | Application revision and evaluation date from the deployment being assessed. |
| External sources | Each source's edition, retrieval date and role: legislation, standard, guidance, proposal or test-tool implementation. Obtain the actual compared files and hosted-run schema selection as well as documentation. |
| Product scope | Product classification, use case and market that determine applicability. |
| Changed-profile review | Checkout containing both versions and its change report; see [evaluate the version 4 drafts](version-4-drafts.md#try-a-draft-in-your-application). |

## Establish the comparison baseline

**Stage 1: record the comparison baseline.** Publication, legal application and software deployment dates can differ. Pin each source artefact actually compared: a hosted validator's help page may describe a different schema revision from its downloadable repository. Record the schema selected for each hosted run. If you cannot verify that selection, leave equivalence with the local check unconfirmed.

| Product | Applicability check |
|---|---|
| Batteries | Review classification and use case before choosing a category-specific schema. Industrial batteries can differ in capacity, management system and reporting duties. |
| Textiles | Review sources for the selected product and market. Do not transfer battery-specific obligations into the profile. |

The stage ends with a dated baseline naming the files, deployment and product scope, including unconfirmed equivalence.

## Build a cross-reference in both directions

**Stage 2: build the comparison record.** Start from the generated mapping inventory, such as [battery@2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/generated/mapping/battery@2.md): one row per field, including semantic field, legal basis, applicability and access tier.

For a changed profile, also run `npm run changes -w @bsv/dpp-profiles -- battery@2 battery@4` in the checkout to list every added, changed and removed field:

```sh
npm run changes -w @bsv/dpp-profiles -- battery@2 battery@4
```

Create a row for each external requirement or data attribute, including nested fields. Copy this row template:

| External requirement or attribute | Profile field and legal basis | Meaning and subject | Shape and units | Applicability | Disclosure | Source and evidence | Implementation | Mapping outcome |
|---|---|---|---|---|---|---|---|---|
| Source reference | Semantic field, including nested fields | Product, model, batch or item | Type, precision, units, code list, measurement conditions | Category, jurisdiction, date, lifecycle state | Read/update permissions, purpose, evidence, access tier | Declaration, measurement, calculation or assessment; supporting evidence | Profile, other record, application service or missing | Exact mapping, transformation, evidence needed, confirmed gap or unresolved interpretation |

Reverse the comparison and account for every selected-profile field, including application additions and fields without an external equivalent. Similar labels do not establish equivalence.

Before adding duplicate fields or infrastructure, check whether an external field absent from a battery or textile manifest belongs to passport identity, operator information or publication context. [Projections](../interoperability/projections.md) combine sources while retaining provenance. The stage ends with both directions accounted for in the comparison record.

## Separate representation from missing information

**Stage 3: classify each mismatch and assign its resolution owner.**

| Difference | Treatment |
|---|---|
| Representation only | An explicit export mapping can wrap kilograms in a target value/unit object without changing meaning. |
| Missing evidence | One power value cannot establish two measurements at different states of charge. Obtain the evidence. |
| Unsupported substitution | Do not round away precision, invent a manufacturing day, replace a verified operator identifier with a brand name or expose restricted data to pass validation. Record the mismatch. |
| Required or optional field | An external schema's required list is an implementation constraint; assess its regulatory basis separately. An optional field can still be conditionally required for a product. |

An export adapter should validate the declared input profile, apply reviewed transformations, retain source references and validate the target representation. It should explicitly report unmapped or unsupported values. Implement and test it for the chosen format; loading a profile does not provide an adapter. Retain the classified mismatches and owners as this stage's output.

## Gather four distinct kinds of evidence

**Stage 4: collect evidence within its stated scope.**

| Check | What a successful result establishes | What still needs assessment |
|---|---|---|
| Schema validation | A payload meets the selected structural rules | Truth, completeness of legal coverage and authority |
| Applicability and evidence review | Named requirements have supported decisions for this product | Unreviewed sources, exemptions or lifecycle events |
| Interface and scenario testing | An identified deployment handled the exercised interactions | Untested roles, failure paths and operational conditions |
| Regulatory and standards assessment | The stated scope has been reviewed against identified sources | Anything outside that scope or changed since the assessment |

Start with synthetic fixtures covering missing evidence, boundary values, unsupported categories and unauthorised access. Separately exercise application authorisation, update, recovery and history behaviour. Schema access annotations do not enforce server permissions.

For each run, retain input digest, selected schema digest, evaluator version, scenario, result and known exclusions. Report a test-tool pass with that scope, without a broader certification claim. The output is scoped run evidence; [requirements and evidence reporting](../implement/reporting.md) explains how to distinguish claims from evidence.

## Turn findings into a reviewed successor

**Stage 5: assign and resolve findings before promotion.**

1. Assign each finding to a source reviewer, profile maintainer or application owner.
2. Confirm interpretations before changing types, applicability or access. Add representative fixtures and document required consumer changes.
3. Follow [profile authoring](authoring.md) for generation and freezing, then [consumer adoption](updating-applications.md) for notification, UI/backend integration and activation.
4. Keep historical definitions and unresolved assessment findings. Reopen affected rows when law, standards, guidance, external test schemas or implementation change, and review them before promoting a successor.

The result is a reviewed successor with consumer changes documented and outstanding findings retained.
