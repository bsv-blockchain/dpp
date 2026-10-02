# Evidence and its limits

Your reader returns a report, not a yes or a no. This page explains how to read that report: what each of the sixteen checks means, what `unknown` and its reason tell you, and why a history that verifies may still not be the latest state.

## The shape of a report

`verifyPassportEvidence` in `@bsv/dpp-core` returns one JSON object, and so does every reader that follows the [verification report](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md) specification:

| Property | What it holds |
|---|---|
| `reportVersion` | `1` |
| `checkedAt` | The time the report was made |
| `expectedSubject` | The passport you asked about, and where that expectation came from ([below](#supply-the-expected-subject)) |
| `suppliedTip` | The newest state in the history you supplied |
| `policyId` | The policy the reader applied, or `none` |
| `checks` | Sixteen entries, one per check, always in the same order |
| `observations` | What the sources you asked said about the latest state ([below](#is-this-the-latest-state)) |
| `limits` | Sentences saying what this report does not establish |

Each entry in `checks` has a `name` and a `status`, a `reasonCode` whenever the status is not `pass`, and `evidenceRefs` naming what was checked, such as outpoints (a transaction identifier and output index), digests and policy identifiers. When a check ran over several states or artefacts, `scope` and `detail` say which one a finding is about.

## The four answers

| Status | How to read it |
|---|---|
| `pass` | The check ran on the evidence and held. |
| `fail` | The check ran and did not hold. |
| `unknown` | The evidence, source or policy needed to complete the check was missing or unavailable. The `reasonCode` says which. |
| `not-applicable` | The selected profile or policy defines that check as not applying. Missing evidence alone is never this case. |

No property sums the checks up into one word. To decide something, such as whether to show a passport as checked, name the checks your use needs and decide on those. Show people each finding, not a single badge: a single success label hides the checks that did not run.

## The sixteen checks

The checks fall into four groups. The second column is the short label `@bsv/dpp-core` gives each check in `EVIDENCE_CHECK_LABELS`, which the examples print; it says what `pass` means.

**The passport's states**

| Check | Passes when | Otherwise, usually |
|---|---|---|
| `recordEncoding` | Every entry is a well-formed record: each state decodes as record version 1 or 2, with one passport output per transaction | `fail` `decode-failed`; the next four checks then read `unknown` `decode-failed` |
| `actorSignatures` | Every entry was signed by whoever wrote it | `fail` `signature-invalid` |
| `publisherSignatures` | Every entry was countersigned by the named publisher, a key your policy names | `not-applicable` `publisher-not-selected` when you named no publisher keys; `fail` `signature-invalid`, or `publisher-not-authorised` for a key used outside its policy window; `unknown` `publisher-policy-invalid` |
| `linkage` | No step is missing from the middle: each state spends the one before it and follows the chain rules, including the control proof and, under `managed-custody@1`, the acceptance commitment on every version 2 `TRANSFER` | `fail` with `link-broken`, `lineage-retired`, `control-not-proven`, `version-transition-invalid`, `consent-not-proven` or `acceptance-commitment-absent` |
| `inclusion` | Every entry is in a block: each state's merkle path checks against block headers | `unknown` `proof-absent` when a state carries no proof; `unknown` `header-source-unavailable` when the header source did not answer; `unknown` `not-selected` when no header source was given; `fail` `proof-refuted` |

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
| `externalCredentialProof` | Every credential verifies under its own proof suite | `not-applicable` `no-external-credential` when you supplied none; `unknown` `verifier-not-supplied` |
| `credentialTime` | Every credential is within its validity period | `unknown` `no-evidence` |
| `credentialStatus` | No credential is revoked or suspended | `not-applicable` `format-defines-no-status` for native claims; `unknown` `no-evidence` |

**Across all the evidence**

| Check | Passes when | Otherwise, usually |
|---|---|---|
| `subjectBinding` | Everything concerns the passport that was asked about | `unknown` `subject-not-independent` when the subject came from the evidence; `fail` `subject-mismatch`; `unknown` `genesis-ambiguous` when two valid first states share the identifier |
| `issuerAuthority` | Every issuer held the authority the policy requires: the first state's actor, each claim's issuer, each anchoring service and each acceptance custodian is one your policy accepts | `unknown` `policy-missing` when you gave no `authority` option; `fail` or `unknown` `authority-unconfirmed` ([identity and authority](identity-and-authority.md#accept-the-parties-you-trust)) |
| `schema` | Every payload matches its declared profile: each claim and credential validates against the profile it names | `unknown` `schema-unavailable` when you gave no profile validator; `unknown` `no-evidence` |
| `evidenceAvailability` | Everything the evidence points at was available, including the acceptance record a managed `TRANSFER` commits to | `unknown` `referenced-artefact-unavailable` when something referenced was not supplied; `fail` `referenced-artefact-mismatch` when it was supplied and does not match |

A pass on the passport's states says nothing about its claims, and the other way round. A report whose state checks all pass and whose claim checks read `unknown` is a report about the passport record, not about its lifecycle claims. The report does not check a state's `payload_public` against its industry profile; do that yourself with `node examples/sample-payload.mjs --check <profile@version> <file>` from a checkout.

## Results you will see first

| You see | It means |
|---|---|
| `inclusion` `unknown` `proof-absent` | A state carries no merkle proof yet: test data, or a state whose proof has not reached the index. The reader example prints this as `inclusion pending`; the two are the same finding. `pending` can also mean `header-source-unavailable` (the header source refused or timed out: run again, or set `WOC_API_KEY`) or `not-selected` (no header source was given). |
| Claim and anchor checks `unknown` `no-evidence` | You supplied no claims or anchors. The passport may have none, or you did not fetch them from its registry ([gather a passport's evidence](../packages/dpp-core.md#gather-a-passports-evidence)). |
| `issuerAuthority` `unknown` `policy-missing` | You gave no `authority` option, so nobody is accepted or refused. |
| `schema` `unknown` `schema-unavailable` | You supplied native claims and no profile validator. |
| `evidenceAvailability` `unknown` `referenced-artefact-unavailable` on a passport with a managed transfer | Its `TRANSFER` commits to an acceptance record that you did not supply. The custodian keeps it and no index or registry route serves it yet, so a reader on another stack sees this for every managed transfer it did not write ([custody](custody.md#not-settled-yet), [known limitations](../operate/limitations.md)). |

## Is this the latest state?

A history that verifies shows that the states you were given are valid and in order. It does not show that nobody has added a later state: the index you asked may not hold it yet, or may not return it. A valid older part of a history is still valid after a newer state exists.

To ask, pass `observers` in the policy: sources that are asked whether the tip, the newest state you checked, is still unspent. Each answers `unspent`, `spent`, `not-found`, `unavailable` or `conflicting`, and the report's `observations.latestState` then reads:

| `latestState` | Meaning |
|---|---|
| `observed` | The sources that answered said the tip is unspent. This means "latest as far as these sources know", never proof that no later state exists. A retired tip reported unspent is `observed`: the passport has ended. |
| `superseded` | The sources reported a later state spending the tip. Fetch the newer states and verify again. |
| `conflicting` | The sources disagreed, or two valid next states spend the same state (a fork). Every candidate is listed in `candidateOutpoints`; the report never picks one. |
| `unknown` | No source was asked, or none answered. This is what you get without `observers`. |

`sources` lists each source asked, with its answer and the time, and `queryScope` says in words what was asked (`no source asked` when nothing was). Whenever `latestState` is not `unknown`, `limits` says the observation is not a proof. [Gather a passport's evidence](../packages/dpp-core.md#gather-a-passports-evidence) shows an observer that asks the index again for a later state.

## Supply the expected subject

Take the passport identifier you expect from the scan, the label or the request, before you load any evidence, and pass it as the second argument of `verifyPassportEvidence`. This fragment shows only the call; the complete reader is step 1 of [build an application](../packages/build-an-application.md):

```js
const report = await verifyPassportEvidence(evidence, { passportId, source: 'request-context' }, policy)
```

`subjectBinding` then compares every state, claim, anchor and credential with that identifier. If you took the identifier from the evidence instead, a valid record for another product would verify against its own identifier and look convincing. Use `source: 'established-binding'` when the expectation comes from something you verified earlier, such as a first state you checked before. With `source: 'none'`, which says you had no expectation and took the identifier from the evidence, `subjectBinding` reads `unknown` with `subject-not-independent` and every other check runs as usual: the report still says whether the evidence is valid, though not that it concerns the passport you meant. Optional `expectedGenesisOutpoint`, `expectedStateOutpoint`, `expectedIssuer` and `productIdentifier` narrow the expectation further.

## Inspect a stored report

From the root of a checkout, after `npm ci` and `npm run build`, this prints one expected report from the version 2 report fixture. It shows the structure; it does not run verification:

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

It prints the subject with `request-context`, then sixteen lines: the first four checks and `subjectBinding` read `pass`; `inclusion` reads `unknown proof-absent`; `nativeAttestationSignature`, the three anchor checks, `schema`, `credentialTime` and `credentialStatus` read `unknown no-evidence`; `externalCredentialProof` reads `not-applicable no-external-credential`; `issuerAuthority` reads `unknown policy-missing`; and `evidenceAvailability` reads `unknown referenced-artefact-unavailable`, because this lineage has a managed `TRANSFER` and the case supplies no acceptance record. Then `latest state unknown | no source asked`, and thirteen `limit:` lines. Run it again with `CASE=v2-retired-tip-observed` in front to see `latest state observed`, from one index that reported the retired tip unspent.

To produce these reports with the implementation rather than read them, run `node examples/verify-passport.mjs --fixture --version=2 --report` from the same place ([quick start](../quick-start.md#check-the-test-passports-offline)); each case prints a line starting `ok:` that says `this verifier's report is the pinned one`.

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
| Interpret each check and its reason | [Verification report](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md), [report schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/verification-report.schema.json) |
| Evaluate supplied passport history | [Record verification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md), [record model version 2](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model-v2.md) |
| Evaluate claims and commitments | [Attestation verification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md) |
| Inspect an export's coverage | [Portable evidence](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/portable-evidence.md), [complete export](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/exchange.md) |

## Next

| You are | Go to |
|---|---|
| Building with the packages | [Gather a passport's evidence](../packages/dpp-core.md#gather-a-passports-evidence): claims, anchors, an observer and the parties you accept, in one reader |
| Implementing a reader yourself | [Passport reader](../implement/roles/passport-reader.md), then [run the fixtures](../implement/fixture-runner.md) |
| Moving retained evidence elsewhere | [Export and recovery](../operate/export-import-recovery.md) |
