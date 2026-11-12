# Requirements and evidence reporting

Implementers who have run the fixtures can use this page to report their results, declare supported capabilities and give reviewers enough evidence to rerun every result. A conformance claim names a set of requirements; it is separate from a product's signed lifecycle claim.

## Gather the report inputs

| Input | Source |
|---|---|
| Fixture results and revision | Your retained run, including refusals and missing evidence. |
| Implementation identity | Build commit, language, authorship record and dependency names with exact versions. |
| Scope | Selected release, baseline, roles, profiles and applied policy. |
| Capability validation | Node.js 22 or later, npm and git; complete [checkout setup](../quick-start.md#get-the-code), including `npm ci` and `npm run build`. Save your declaration at the checkout root as described below. |

## The rules

1. **One sentence per check, zeros included.** Include checks that did not pass. Give no aggregate verdict or score: [governance](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/GOVERNANCE.md#conformance-reporting) says a report that says "12 of 13" invites exactly the argument a conformance suite exists to end.
2. **Writers add one sentence per writing rule.** Vectors cannot show that a state was checked before sending or its proof retained. Writers self-report each rule that [writing](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/writing.md) section 11 lists. Passing every fixture says nothing about a writer without those sentences. [Passport writer](roles/passport-writer.md#prove-it-the-writers-self-report) lists the seven rules.
3. **Say what kind of evidence each sentence is.** A local fixture result, a fresh-record exchange with another implementation and a deployed service are different facts.
4. **Claim only what the test shows.** A passing native-signature test is evidence about that signature check. It does not establish issuer authority, inclusion or an independent deployment. If a run had no header source, say so beside the checks that passed.

## What a report contains

| Field | What to record |
|---|---|
| Implementation | Its name, the commit it was built from, and the language |
| Authorship and dependencies | Who wrote it, and every third-party library with its version. Say that no `@bsv/dpp-*` code is used for the properties you claim ([what you may reuse](README.md#what-you-may-reuse)). |
| Release and baseline | The release set and baseline you implemented, such as `dpp-release-2026-10-6` and `native-baseline@2`, and the revision of the fixtures you ran |
| Roles and profiles | The roles you claim, such as `passport-reader`, and the profiles you select, such as `managed-custody@2` |
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

A capability document declares supported and unsupported features as JSON under the [capabilities schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/capabilities.schema.json). Reviewers check this support claim against the ledger; it is not proof of conformance ([conformance](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/conformance.md) section 4). An index serves it at `GET /capabilities`; a library or tool publishes it with its report.

| Requiredness | Fields |
|---|---|
| Required | `capabilitiesVersion`, `implementation`, `roles`, `protocols`, `profiles`, `representations`, `proofSuites`, `anchorFormats`, `unsupported` |
| Services, where applicable | `topics`, `services`, `publisherPolicy`, `synchronisation`, `limits` |

The [reference index's document](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/examples/capabilities-reference-node.json) shows service fields.

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

Expect `valid`. If it prints fields that break the schema, fix them and rerun before publishing the declaration. For a registry, which document `GET /capabilities` answers with is not settled yet ([registry](roles/registry.md)).

## Send it

Publish the report and commands where reviewers can rerun them, then select the [reporting route](../contribute/disagreements.md):

| Report or request | Destination |
|---|---|
| Non-sensitive technical report | [Repository issue tracker](https://github.com/bsv-blockchain/dpp/issues); requires only a GitHub account. |
| Trial or hosted-reference exchange | [BSV Association contact form](https://bsvassociation.org/contact/) ([implementing parties](../contribute/implementing-parties.md)). |
| Security problem | Private route in the [security policy](https://github.com/bsv-blockchain/dpp/security/policy), never an issue. |

## Disagreements

Keep refusals and unresolved cases visible in the report. For a disagreement with the fixtures or the reference, retain the input, both outcomes and their source references, then use [the reporting route](../contribute/disagreements.md). An unresolved ambiguity stays open even when one implementation currently accepts the input.

[Conformance review](../reference/conformance.md) explains the diagnostic and the selection gate. Next: [the trial](demonstration.md), for evidence from a fresh-record exchange.
