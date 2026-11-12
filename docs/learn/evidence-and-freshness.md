# Evidence and its limits

Readers and application teams can use this page to interpret a report's sixteen checks, `unknown` results and freshness limits, then decide whether the evidence meets their needs.

## Before you start

| Task | Input and source |
|---|---|
| Bind a report to the intended passport | Exact identifier from the scan, label, request or earlier verified binding, obtained before loading evidence |
| Inspect or reproduce fixture reports | Node.js 22 or later and a [source checkout](../quick-start.md), prepared with `npm ci` and `npm run build`; run shell commands at its root |
| Add the call fragment to a reader | Evidence, expected subject and policy from [build an application](../packages/build-an-application.md) |
| Observe freshness | Sources supplied as the policy's `observers`; without them, latest-state knowledge stays `unknown` |

## The shape of a report

`verifyPassportEvidence` in `@bsv/dpp-protocol` and every conforming reader return one JSON object, defined by the [verification report](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/spec/verification.md) specification:

| Property | What it holds |
|---|---|
| `reportVersion` | `2` |
| `checkedAt` | The time the report was made |
| `expectedSubject` | The passport you asked about, and where that expectation came from ([below](#supply-the-expected-subject)) |
| `suppliedTip` | The newest state in the history you supplied |
| `policyId` | The policy the reader applied, or `none` |
| `checks` | Sixteen entries, one per check, always in the same order |
| `observations` | What the sources you asked said about the latest state ([below](#is-this-the-latest-state)) |
| `limits` | Sentences saying what this report does not establish |

| Check property | Meaning |
|---|---|
| `name`, `status` | Check and its result |
| `reasonCode` | Required whenever the result is not `pass` |
| `evidenceRefs` | Checked outpoints (transaction identifier and output index), digests or policy identifiers |
| `scope`, `detail` | State or artefact a finding concerns when several were checked |

## The four answers

| Status | How to read it |
|---|---|
| `pass` | The check ran on the evidence and held. |
| `fail` | The check ran and did not hold. |
| `unknown` | The evidence, source or policy needed to complete the check was missing or unavailable. The `reasonCode` says which. |
| `not-applicable` | The selected profile or policy defines that check as not applying. Missing evidence alone is never this case. |

The report has no overall verdict. Select the checks your decision needs and show each finding; one success badge hides checks that did not run.

## The sixteen checks

The checks form four groups. The second column uses the short labels from `@bsv/dpp-protocol`'s `EVIDENCE_CHECK_LABELS`, printed by the examples, to explain `pass`.

**The passport's states**

| Check | Passes when | Otherwise, usually |
|---|---|---|
| `recordEncoding` | Well-formed records: each state decodes as record version 1 or 2, with one passport output per transaction | `fail` `decode-failed`; the next four checks then read `unknown` `decode-failed` |
| `actorSignatures` | Every entry was signed by whoever wrote it | `fail` `signature-invalid` |
| `publisherSignatures` | Every entry was countersigned by its named publisher, whose key your policy names | `not-applicable` `publisher-not-selected` without selected keys; `fail` `signature-invalid`, or `publisher-not-authorised` outside a key's policy window; `unknown` `publisher-policy-invalid` |
| `linkage` | Each state spends its predecessor without a missing middle step and follows chain rules, including control proof and, under managed custody, an acceptance commitment on every version 2 `TRANSFER` | `fail` with `link-broken`, `lineage-retired`, `control-not-proven`, `version-transition-invalid` or `acceptance-commitment-absent` |
| `inclusion` | Each state's merkle path checks against block headers, establishing block inclusion | `unknown` `proof-absent` without proof; `unknown` `header-source-unavailable` without a header-source answer; `unknown` `not-selected` without a header source; `fail` `proof-refuted` |

**Claims and their anchors**

| Check | Passes when | Otherwise, usually |
|---|---|---|
| `nativeAttestationSignature` | Every lifecycle claim was signed by its issuer | `unknown` `no-evidence` when you supplied no claims; `fail` `signature-invalid` |
| `anchorSignature` | Every anchor was signed by its anchoring service | `unknown` `no-evidence` when you supplied no anchors; `fail` `signature-invalid` |
| `anchorKeyDerivation` | Every anchor is locked to the key its service derives for that claim | `unknown` `no-evidence`; `fail` `key-derivation-mismatch` |
| `anchorDigestAndMetadataBinding` | Every anchor commits to the exact bytes and names what they say | `unknown` `secured-bytes-absent` when an anchor came without its claim's bytes; `unknown` `representation-unsupported`; `fail` `digest-mismatch` or `metadata-mismatch` |

**Credentials in other formats**

| Check | Passes when | Otherwise, usually |
|---|---|---|
| `externalCredentialProof` | Every credential verifies under its own proof suite | `not-applicable` `no-external-credential` when you supplied none; `unknown` `verifier-not-supplied`; for a signed EPCIS event, `fail` `event-hash-mismatch`, `event-hash-unsupported` or `error-declaration-unsupported` when the subject does not hash to the credential's `id` |
| `credentialTime` | Every credential is within its validity period | `unknown` `no-evidence` |
| `credentialStatus` | No credential is revoked or suspended | `not-applicable` `format-defines-no-status` for native claims; `unknown` `no-evidence` |

**Across all the evidence**

| Check | Passes when | Otherwise, usually |
|---|---|---|
| `subjectBinding` | Everything concerns the passport that was asked about | `unknown` `subject-not-independent` when the subject came from the evidence; `fail` `subject-mismatch`; `unknown` `genesis-ambiguous` when two valid first states share the identifier |
| `issuerAuthority` | Your authority policy accepts the first state's actor, each claim's issuer, each anchoring service and each acceptance custodian | `unknown` `policy-missing` when you gave no `authority` option; `fail` or `unknown` `authority-unconfirmed` ([identity and authority](identity-and-authority.md#accept-the-parties-you-trust)) |
| `schema` | Every payload matches its declared profile: each claim and credential validates against the profile it names | `unknown` `schema-unavailable` when you gave no profile validator; `unknown` `no-evidence` |
| `evidenceAvailability` | Everything the evidence points at was available, including the acceptance record a managed `TRANSFER` commits to | `unknown` `referenced-artefact-unavailable` when something referenced was not supplied; `fail` `referenced-artefact-mismatch` when it was supplied and does not match |

State and claim results are independent. Passing state checks with `unknown` claim checks establishes findings about the passport record only.

| Payload evidence | `schema` result |
|---|---|
| Declared profile and caller-supplied payload validator, such as `profilePayloadValidator(ajv)` from `@bsv/dpp-profiles` | Checks the state's `payload_public` against its industry profile |
| No payload validator | `unknown` with `schema-unavailable` |
| Payload declares no profile | `unknown` with `profile-undeclared`, with or without a validator |

## Results you will see first

| You see | It means |
|---|---|
| `inclusion` `unknown` `proof-absent` | A state lacks a merkle proof: test data, or proof not yet at the index. The reader prints `inclusion pending` for this finding. `pending` also covers `header-source-unavailable` (refusal or timeout: retry or set `WOC_API_KEY`) and `not-selected` (no header source). |
| Claim and anchor checks `unknown` `no-evidence` | No claims or anchors supplied: none exist, or you have not fetched them from the registry ([gather a passport's evidence](../packages/dpp-protocol.md#gather-a-passports-evidence)). |
| `issuerAuthority` `unknown` `policy-missing` | You gave no `authority` option, so nobody is accepted or refused. |
| `schema` `unknown` `schema-unavailable` | You supplied native claims and no profile validator. |
| `evidenceAvailability` `unknown` `referenced-artefact-unavailable` on a passport with a managed transfer | Its `TRANSFER` commits to an acceptance record that you did not supply. The custodian keeps it and no index or registry route serves it yet, so a reader on another stack sees this for every managed transfer it did not write ([custody](custody.md#not-settled-yet), [known limitations](../operate/limitations.md)). |

## Is this the latest state?

A verified history establishes that the supplied states are valid and ordered. The index may lack or omit a later state. An older valid history remains valid after a newer state exists.

Pass `observers` in the policy to ask sources whether the supplied tip remains unspent. Each answers `unspent`, `spent`, `not-found`, `unavailable` or `conflicting`. The report combines those answers in `observations.latestState`:

| `latestState` | Meaning |
|---|---|
| `observed` | Answering sources reported the tip unspent: latest to their knowledge, never proof that no later state exists. An unspent retired tip is `observed`: the passport has ended. |
| `superseded` | The sources reported a later state spending the tip. Fetch the newer states and verify again. |
| `conflicting` | Sources disagreed, or two valid next states spend the same state (a fork). `candidateOutpoints` lists every candidate; the report never picks one. |
| `unknown` | No source asked or none answered; the result without `observers`. |

`sources` lists each source, answer and time. `queryScope` states the question, or `no source asked`. Whenever `latestState` is not `unknown`, `limits` states that observation is not proof. [Gather a passport's evidence](../packages/dpp-protocol.md#gather-a-passports-evidence) shows an observer asking the index for a later state.

## Supply the expected subject

1. Obtain the expected identifier before loading evidence. Taking it from the evidence lets another product's valid record verify against itself.
2. Pass the identifier and its source as the second argument of `verifyPassportEvidence`. This fragment shows the call; step 1 of [build an application](../packages/build-an-application.md) provides the complete reader:

```js
const report = await verifyPassportEvidence(evidence, { passportId, source: 'request-context' }, policy)
```

3. Read `subjectBinding`, which compares every state, claim, anchor and credential with that expectation. Stop short of claiming the intended subject was verified if the result is `unknown` or `fail`.

| Expectation source | Use and result |
|---|---|
| `source: 'request-context'` | Identifier from the scan, label or request |
| `source: 'established-binding'` | Earlier verified binding, such as a previously checked first state |
| `source: 'none'` | No independent expectation; identifier taken from the evidence. `subjectBinding` reads `unknown` with `subject-not-independent`. Other checks still run and assess validity, but cannot establish that this is the intended passport |

These optional fields narrow the expectation further:

| Field | Expected value |
|---|---|
| `expectedGenesisOutpoint` | First state's transaction identifier and output index |
| `expectedStateOutpoint` | Exact state's transaction identifier and output index |
| `expectedIssuer` | Exact issuer identifier for the first state or claim under test |
| `productIdentifier` | Exact product identifier when independently known or different from the passport identifier |

## Inspect a stored report

1. Run this command to inspect one expected report from the version 2 fixture. It prints stored data and does not run verification:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
const fixture = JSON.parse(readFileSync('fixtures/evidence-v2.json', 'utf8'))
const { report } = fixture.cases.find((c) => c.id === (process.env.CASE ?? 'v2-valid-lineage'))
console.log('subject', report.expectedSubject.passportId, report.expectedSubject.source)
for (const check of report.checks) console.log(check.name, check.status, check.reasonCode ?? '')
console.log('latest state', report.observations.latestState, '|', report.observations.queryScope)
for (const limit of report.limits) console.log('limit:', limit)
JS
```

2. Compare the output with these expected findings. After the subject line, the fixture prints sixteen checks:

| Output | Expected finding |
|---|---|
| Subject | Identifier and `request-context` |
| First four checks; `subjectBinding` | `pass` |
| `inclusion` | `unknown proof-absent` |
| `nativeAttestationSignature`; three anchor checks | `unknown no-evidence` |
| Other evidence checks | `schema`, `credentialTime` and `credentialStatus` read `unknown no-evidence` |
| `externalCredentialProof` | `not-applicable no-external-credential` |
| `issuerAuthority` | `unknown policy-missing` |
| `evidenceAvailability` | `unknown referenced-artefact-unavailable`: the lineage has a managed `TRANSFER` without its acceptance record |

The report ends with `latest state unknown | no source asked` and thirteen `limit:` lines.

3. Run again with `CASE=v2-retired-tip-observed` in front. Expect `latest state observed`: one index reported the retired tip unspent.
4. To produce reports with the implementation, run `node examples/verify-passport.mjs --fixture --version=2 --report` from the same checkout ([quick start](../quick-start.md#check-the-test-passports-offline)). Each case prints `ok:` followed by `this verifier's report is the pinned one`.

## What a report never says

- That the product is what its record says, or that a claim is true. An anchor proves its anchoring service committed to the claim's bytes, nothing more.
- Who holds the product today, or that no later state exists.
- That a signer is who an application says it is ([Ring 0](identity-and-authority.md#ring-0)).
- That an index's answer covers every index. A service's answer is evidence from that service.
- That a credential's status is fresher than the source it was read from.

A complete export covers the history one index held at one snapshot ([export and recovery](../operate/export-import-recovery.md)); it does not supply evidence that index never had.

## Source definitions

| Reader task | Source |
|---|---|
| Interpret each check and its reason | [Verification report](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/spec/verification.md), [report schema](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/contracts/verification-report.schema.json) |
| Evaluate supplied passport history | [Record verification](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/spec/record-model.md), [record model version 2](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/spec/record-model-v2.md) |
| Evaluate claims and commitments | [Attestation verification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md) |
| Inspect an export's coverage | [Portable evidence](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/portable-evidence.md), [complete export](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/exchange.md) |

## Next

| You are | Go to |
|---|---|
| Building with the packages | [Gather a passport's evidence](../packages/dpp-protocol.md#gather-a-passports-evidence): claims, anchors, an observer and the parties you accept, in one reader |
| Implementing a reader yourself | [Passport reader](../implement/roles/passport-reader.md), then [run the fixtures](../implement/fixture-runner.md) |
| Moving retained evidence elsewhere | [Export and recovery](../operate/export-import-recovery.md) |
