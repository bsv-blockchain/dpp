# Requirements and evidence reporting

This page is for implementers who have run the fixtures and now need to report what their implementation does, so a reviewer can rerun every result. It gives the rules a report follows, what it contains, how to declare what you support, and where to send it.

## The rules

1. **One sentence per check, zeros included.** Each check answers in its own sentence, including the checks that did not pass. There is no aggregate verdict and no score: [governance](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/GOVERNANCE.md#conformance-reporting) says a report that says "12 of 13" invites exactly the argument a conformance suite exists to end.
2. **Writers add one sentence per writing rule.** No byte vector can show that a state was checked before it was sent or that its proof was kept. Writer conformance is therefore self-reported, one sentence per rule that [writing](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/writing.md) section 11 lists, and a report that passes every fixture says nothing about a writer until those sentences stand beside it. [Passport writer](roles/passport-writer.md#prove-it-the-writers-self-report) lists the six rules.
3. **Say what kind of evidence each sentence is.** A local fixture result, a fresh-record exchange with another implementation and a deployed service are different facts.
4. **Claim only what the test shows.** A passing native-signature test is evidence about that signature check. It does not establish issuer authority, inclusion or an independent deployment. If a run had no header source, say so beside the checks that passed.

## What a report contains

| Field | What to record |
|---|---|
| Implementation | Its name, the commit it was built from, and the language |
| Authorship and dependencies | Who wrote it, and every third-party library with its version. Say that no `@bsv/dpp-*` code is used for the properties you claim ([what you may reuse](README.md#what-you-may-reuse)). |
| Release and baseline | The release set and baseline you implemented, such as `dpp-release-2026-10-4` and `native-baseline@2`, and the revision of the fixtures you ran |
| Roles and profiles | The roles you claim, such as `passport-reader`, and the profiles you select, such as `managed-custody@1` |
| Per case | The requirement identifier (a ledger row), the fixture file and case identifier or the digest of a fresh input, the policy applied (publisher keys, profile options, authority lists, header source or none), the command that ran it, the expected result and your result |
| Open questions | For a source conflict, both readings and the input that makes the difference observable ([source gaps](fixture-runner.md#source-gaps)) |

Three sentences in the house style, for a fictional reader called `example-reader`:

- `RM2-5-signatures`: for `fixtures/record-v2.json`, `example-reader` at commit `3f2c1e9` builds `actorPreimage` and `publisherPreimage` byte for byte and verifies both signatures under the keys it derives (`go test ./record -run TestRecordV2`).
- `VER-4-checks`: for case `v2-control-not-proven` of `fixtures/evidence-v2.json`, `example-reader` gives all sixteen checks the pinned status and reason code, including `linkage` `fail` `control-not-proven` at state index 2; no header source was configured, so `inclusion` reads `unknown` `proof-absent`.
- `VER-4-checks`: for case `anchor-and-claim` of `fixtures/evidence-v1.json`, `example-reader` does not match the pinned report: it does not decode anchors, so it reports every anchor check `unknown` where the fixture pins `pass`.

## Find the requirements

1. Open the selected role in the [baseline](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/baseline-native-2.json) and read `roles.<role>.requires`.
2. Follow each requirement identifier into the [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json), the list of every requirement with its source clause, the roles it binds and its status.
3. Follow each row's declared source, implementation, test and evidence references. Record the predicate your implementation actually executed. An absent assertion stays missing; a shared source document is not evidence that one fixture exercises every row.
4. Assemble the conformance claim (a named set of ledger rows), the capability document below and your results, as [conformance](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/conformance.md) sections 4 and 6 and [governance](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/GOVERNANCE.md#conformance-reporting) describe.

The [ledger schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.schema.json) defines the status vocabulary. A reference ledger status is not the status of the implementation being reported.

## Declare what you support

A capability document is a JSON file, conforming to the [capabilities schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/capabilities.schema.json), that says what an implementation supports and, required, what it does not. It is a claim of support that a reviewer checks against the ledger, not proof of conformance ([conformance](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/conformance.md) section 4). An index serves it at `GET /capabilities`; a library or a tool publishes it with its report. The required fields are `capabilitiesVersion`, `implementation`, `roles`, `protocols`, `profiles`, `representations`, `proofSuites`, `anchorFormats` and `unsupported`. A service also fills `topics`, `services`, `publisherPolicy`, `synchronisation` and `limits` where they apply, as the [reference index's document](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/examples/capabilities-reference-node.json) does.

A reader that verifies passport history and acceptance records, but neither anchors nor external credentials, could declare:

```json
{
  "capabilitiesVersion": "1",
  "implementation": { "name": "example-reader", "version": "0.1.0", "sourceRevision": "3f2c1e9", "baselineId": "native-baseline@2" },
  "roles": ["passport-reader"],
  "protocols": [
    { "id": "dpp-record", "version": "1" },
    { "id": "dpp-record", "version": "2" },
    { "id": "verification-report", "version": "1" }
  ],
  "profiles": [
    { "id": "managed-custody", "version": "1", "kind": "custody" }
  ],
  "representations": [
    { "id": "dpp-managed-acceptance-v1", "mediaType": "application/json", "verification": "content" }
  ],
  "proofSuites": [],
  "anchorFormats": [],
  "unsupported": [
    { "id": "bsv-attestation-anchor", "reason": "Anchors are not decoded; every anchor check reads unknown." },
    { "id": "vc-di-ecdsa-rdfc-2019@1", "reason": "External credentials are not verified; the report names them unsupported and never passes them." }
  ]
}
```

To check yours, save it as `capabilities.json` at the root of the checkout and run:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
import Ajv from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)
const validate = ajv.compile(JSON.parse(readFileSync('contracts/capabilities.schema.json', 'utf8')))
const document = JSON.parse(readFileSync('capabilities.json', 'utf8'))
console.log(validate(document) ? 'valid' : validate.errors)
JS
```

It prints `valid`, or the list of fields that break the schema. For a registry, which document `GET /capabilities` answers with is not settled yet ([registry](roles/registry.md)).

## Send it

Publish the report and its commands where a reviewer can rerun them, then send it by the route on [report a disagreement](../contribute/disagreements.md): an issue on the [repository issue tracker](https://github.com/bsv-blockchain/dpp/issues) for a non-sensitive technical report, which needs only a GitHub account. To take part in the trial, or to arrange an exchange with the hosted reference, use the [BSV Association contact form](https://bsvassociation.org/contact/) ([implementing parties](../contribute/implementing-parties.md)). A security problem goes privately, never in an issue, as the [security policy](https://github.com/bsv-blockchain/dpp/security/policy) describes.

## Disagreements

Keep refusals and unresolved cases visible in the report. For a disagreement with the fixtures or the reference, retain the input, both outcomes and their source references, then use [the reporting route](../contribute/disagreements.md). An unresolved ambiguity stays open even when one implementation currently accepts the input.

[Conformance review](../reference/conformance.md) explains the diagnostic and the selection gate. Next: [the trial](demonstration.md), for evidence from a fresh-record exchange.
