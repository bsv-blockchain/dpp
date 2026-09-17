# Review profile and application readiness

A profile review should answer which product information the application can represent, which obligations apply, what evidence supports the values and whether the deployed system handles the required interactions. A green schema check answers only part of that question.

Use this process when an industry profile changes, a source is revised or an application adopts a new release. Keep unresolved findings visible until the relevant evidence is available.

## Establish the comparison baseline

Record the exact profile and package versions, generated schema digests, application revision and evaluation date. For each external source, record its edition, retrieval date and role: legislation, standard, guidance, proposal or test-tool implementation. Publication, legal application and software deployment dates can differ.

Check the source artefacts as well as their documentation. A hosted validator's help page can describe a different schema revision from its downloadable repository. Pin the files actually compared and record the schema selected for each hosted run. If that selection cannot be verified, leave equivalence with the local check unconfirmed.

For batteries, review the relevant product classification and use case before selecting a category-specific schema. Do not assume every industrial battery has the same capacity, management system or reporting duties. For textiles, review the sources applicable to the selected product and market; do not transfer battery-specific obligations into a textile profile.

## Build a cross-reference in both directions

Create a row for each external requirement or data attribute, including fields nested inside records. Record:

| Review dimension | Question to resolve |
|---|---|
| Meaning and subject | Does the value describe the same product, model, batch or individual item? |
| Shape and units | Do types, precision, units, code lists and measurement conditions agree? |
| Applicability | Does it apply to this category, jurisdiction, date and lifecycle state? |
| Disclosure | Who may read and update it, for which purpose and with what evidence? |
| Source and evidence | Is this a declaration, measurement, calculation or assessment, and what supports it? |
| Implementation | Is the information in the profile, another record, an application service or still missing? |

Then reverse the comparison: account for every field in the selected profile, including application additions and fields without an external equivalent. Distinguish an exact mapping, a transformation, additional evidence needed, a confirmed gap and an unresolved interpretation. Similar labels alone do not establish equivalence.

An external field absent from the battery or textile manifest may belong to passport identity, operator information or publication context. Inspect those existing mechanisms before adding duplicate fields or new infrastructure. [Projections](../interoperability/projections.md) explain how multiple sources can contribute to a view while retaining their provenance.

## Separate representation from missing information

Some differences can be handled by an explicit export mapping. A mass stored in kilograms can be wrapped in the target's value/unit object without changing its meaning. Other differences require new evidence: one power value cannot establish two measurements taken at different states of charge.

Do not round away precision, invent a manufacturing day, substitute a brand name for a verified operator identifier or expose restricted data merely to make an external validator pass. Record the mismatch and its resolution owner. The external schema's required list is an implementation constraint; establish its regulatory basis separately. Conversely, an optional field can still be conditionally required for a particular product.

An export adapter should validate the declared input profile, apply reviewed transformations, retain source references and validate the resulting target representation. It should report unmapped or unsupported values explicitly. Such an adapter must be implemented and tested for the chosen external format; loading a profile does not provide one automatically.

## Gather four distinct kinds of evidence

| Check | What a successful result establishes | What still needs assessment |
|---|---|---|
| Schema validation | A payload meets the selected structural rules | Truth, completeness of legal coverage and authority |
| Applicability and evidence review | Named requirements have supported decisions for this product | Unreviewed sources, exemptions or lifecycle events |
| Interface and scenario testing | An identified deployment handled the exercised interactions | Untested roles, failure paths and operational conditions |
| Regulatory and standards assessment | The stated scope has been reviewed against identified sources | Anything outside that scope or changed since the assessment |

Use synthetic fixtures first, including missing evidence, boundary values, unsupported categories and unauthorised access. Exercise actual application authorisation, update, recovery and history behaviour separately from data-file validation. Access annotations inside a schema do not enforce a server's permissions.

Retain the input digest, selected schema digest, evaluator version, scenario, result and known exclusions for each run. A test-tool pass should be reported with that scope, without turning it into a broader certification claim. [Requirements and evidence reporting](../implement/reporting.md) explains how to preserve the distinction between a claim and its evidence.

## Turn findings into a reviewed successor

Assign each finding to the source reviewer, profile maintainer or application owner who can resolve it. Confirm the interpretation before changing types, applicability or access. Add representative fixtures and document what existing consumers must change.

Follow [profile authoring](authoring.md) for generation and freezing, then [consumer adoption](updating-applications.md) for notification, UI/backend integration and activation. Keep historical definitions available and retain unresolved assessment findings. Reopen affected rows when the law, standard, guidance, external test schema or implementation changes, and review them again before promoting a successor.
