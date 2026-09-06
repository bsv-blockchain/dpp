# One verification contract

**Status: working draft, pre-1.0.** This document defines the report a verifier produces when it evaluates the evidence for one passport: the checks it names, the four answers each check may give, where the expected subject comes from, and how an observation of the latest state is reported without being mistaken for a proof. The low-level verifiers stay as they are: [`record-model.md`](record-model.md) §8 defines supplied-history verification of the token rail, [`rules.md`](rules.md) §6 defines anchor verification, and [`vsc-profile.md`](vsc-profile.md) §7 defines credential verification. This document defines the one shape every surface reports them in, so that an API, an embedded view and a standalone tool answer the same question with the same words.

## 1. Why one contract

A passport's evidence comes from two rails and several parties: token states ordered by spending, lifecycle claims signed by issuers, anchors written by anchoring services, credentials secured under their own suites, and status and authority material published by yet other parties. A verifier that checks some of these and reports one word invites the reader to assume the rest. The failures this document exists to prevent are concrete: a valid historical prefix presented as the current record, a validly signed record for one product substituted for another, a token signature read as proof that an attestation was checked, and an index's answer read as proof that no later state exists.

The rule is therefore that every check is reported separately, every check that was not run says so, and no aggregate verdict is derived. A consumer MAY decide an operation from a report, but only against an explicit required set of checks and a named policy, and its user-facing output MUST keep the per-check findings visible.

## 2. The report

A report is a JSON object. [`../contracts/verification-report.schema.json`](../contracts/verification-report.schema.json) is its schema; this section is the normative text and the schema follows it.

| Property | Requirement |
|---|---|
| `reportVersion` | The string `1`. A reader refuses any other value. |
| `checkedAt` | ISO 8601 date-time with a timezone: the observation time the verifier evaluated against. Injected by the caller where reproducibility matters; never silently the wall clock of a test. |
| `expectedSubject` | §3. |
| `suppliedTip` | The outpoint `{ txid, outputIndex }` of the newest supplied token state, or `null` when no token history was supplied. |
| `policyId` | The identifier of the trust and profile policy the verifier applied, or `none` when it applied only the byte rules. A policy names the accepted publisher keys, anchoring services, status and authority sources and selected profile options. |
| `checks` | §4. An array with exactly one entry per check name in §4, in the order given there. |
| `observations` | §5. |
| `limits` | An array of sentences stating what this report does not establish, at minimum the ones §6 requires. |

## 3. The expected subject

`expectedSubject` states what the verifier was asked about, and it MUST come from the trusted request context or from a binding established before the evidence under test was read: the identifier printed on the item, the identifier the caller resolved, or a previously verified genesis. It is never read from the evidence being tested, because evidence that names its own subject verifies against itself trivially, which is how a valid record for product B becomes proof about product A.

| Property | Requirement |
|---|---|
| `passportId` | The exact passport identifier expected. Required. |
| `source` | One of `request-context`, `established-binding` or `none`. `none` means the verifier had no independent expectation and took the identifier from the evidence; every subject-dependent check then reports `unknown` with reason `subject-not-independent`. |
| `productIdentifier` | Optional exact product identifier, when it differs from `passportId` or is known independently. |
| `expectedIssuer` | Optional exact issuer identifier for the genesis or the claim under test. |
| `expectedGenesisOutpoint` | Optional `{ txid, outputIndex }` of the genesis state the subject is bound to. |
| `expectedStateOutpoint` | Optional `{ txid, outputIndex }` of the exact state under test. |

A verifier compares every artefact it evaluates against the expectation: passport identifier, product identifier, issuer, genesis and state outpoints where given, and the digest a manifest or anchor named for it. Original signed strings are compared as signed; any normalisation for display or resolution is a separate layer and never rewrites what was signed. Two genesis records under one passport identifier are two candidates until an authority policy resolves them, and a verifier MUST NOT choose one because it is newer, returned first or held by the index it asked.

## 4. The checks

Each entry of `checks` is an object with `name`, `status`, `reasonCode`, `evidenceRefs`, optional `scope` and optional `detail`.

`status` is exactly one of four words. `pass` means the check ran on the evidence and held. `fail` means the check ran and did not hold. `unknown` means the check could not be completed: the evidence, source or policy it needed was missing or did not answer. `not-applicable` means the profile or policy in force defines the check as not applying here, and the reason names that definition; it is never the answer for evidence that was merely absent.

`reasonCode` is required whenever `status` is not `pass`, and MAY accompany a pass. Codes are lower-case words joined by hyphens. The codes in the schema are the shared vocabulary; an implementation MAY add codes under the prefix `x-` and MUST NOT reuse a shared code with a different meaning.

`evidenceRefs` names what was checked: outpoints as `txid:outputIndex`, digests as `sha256:<hex>`, credential identifiers, policy identifiers, header sources. An empty array is permitted only with `unknown` or `not-applicable`.

`scope` narrows the check to one artefact, digest, outpoint or state index when the check ran over several and one failed; the per-state findings of the token rail are carried in `detail`.

The sixteen checks, in report order:

| Name | What `pass` means | Rail |
|---|---|---|
| `recordEncoding` | Every supplied token state decodes under [`record-model.md`](record-model.md) §2 and §3 or, by its field count, under [`record-model-v2.md`](record-model-v2.md) §2 and §3, and each transaction carries exactly one DPP output. A version the verifier does not know is no DPP output at all. | Token |
| `actorSignatures` | Every state's actor signature verifies as §5 of its version's record model describes: the unframed preimage under `[1, 'dpp token v1']` for version 1, the framed and tagged preimage under `[1, 'dpp token v2']` for version 2. | Token |
| `publisherSignatures` | Every state's publisher signature verifies against the publisher key the policy names for that state. `not-applicable` with reason `publisher-not-selected` when the policy names none. | Token |
| `linkage` | Every link satisfies the chain invariants of §6 of its version's record model, including the control proof, the terminal retirement and the single upgrade transition of version 2; the owner-signed transfer where the policy selects it for version 1; and the acceptance commitment on every version 2 `TRANSFER` where the policy selects `managed-custody@1`. The reasons are `link-broken`, `lineage-retired`, `control-not-proven`, `version-transition-invalid`, `consent-not-proven` and `acceptance-commitment-absent`, and the per-state detail carries each state's version and whether its control was proven. | Token |
| `inclusion` | Every mined state's merkle path validated against the header source. `unknown` with `header-source-unavailable` when the source did not answer; `unknown` with `proof-absent` when a state carries no proof. | Token |
| `nativeAttestationSignature` | Every supplied native lifecycle claim verifies under [`rules.md`](rules.md) §3 against the key its issuer identifier names. | Attestation |
| `anchorSignature` | Every supplied anchor output decodes exactly under `rules.md` §5 and its service signature verifies. | Anchor |
| `anchorKeyDerivation` | Every anchor's locking key equals the derived child of its `anchoredBy` key for its attestation identifier. | Anchor |
| `anchorDigestAndMetadataBinding` | For every anchor with its secured representation supplied, the digest equals the SHA-256 of the complete secured bytes and every carried metadata field equals the verified content. `unknown` with `representation-unsupported` when the representation's rules are not implemented by this verifier. | Anchor |
| `externalCredentialProof` | Every supplied credential in a non-native representation verifies under its own suite and profile. `not-applicable` with `no-external-credential` when the evidence contains none. | Credential |
| `subjectBinding` | Every verified artefact names `expectedSubject.passportId` (and the product identifier, issuer and outpoints where the expectation gives them) as its subject. | All |
| `issuerAuthority` | Every issuer of a claim or credential held the authority the named policy requires at the claim's time, on verifiable evidence, and every custodian whose acceptance record a version 2 `TRANSFER` commits to is one the policy names under the role `acceptance-custodian`. `not-applicable` with `authority-not-required` only when the policy states that it requires none. | Attestation, Credential, Token |
| `schema` | Every credential and profile-bound payload validates against the schema its declared profile and version select. | Credential, Profile |
| `credentialTime` | Every credential's validity interval includes `checkedAt`, and claimed event times are well formed under the selected rules. | Credential |
| `credentialStatus` | For every credential with a status entry, an authenticated, authorised, fresh status document was read and the bit for the declared purpose is unset. The evidence object carries the purpose, the value `set`, `unset` or `unknown`, the list digest, issuer, index, retrieval time, signed validity and the freshness bound applied. | Credential |
| `evidenceAvailability` | Every artefact the supplied evidence referenced (predecessor states, anchored representations, status documents, DID documents, referenced credentials, and the acceptance record every version 2 `TRANSFER` with an authorisation commitment names) was available to the verifier. `fail` when a referenced artefact was fetched and did not match its reference, an acceptance record that does not bind to its `TRANSFER` included; `unknown` when it could not be fetched. | All |

Three rules span the table. A pass on the token rail says nothing about the attestation or anchor rails and vice versa: a report with every token check passing and every anchor check `unknown` is a report about a token, not about an attested lifecycle. A missing input yields `unknown`, never `not-applicable` and never `pass`. And no property of the report summarises the checks into one Boolean or one word; a consumer that needs a decision names the checks it requires and decides against them.

## 5. Observations

`observations` reports what the verifier learnt about the latest state from the sources it asked, distinctly from what it proved from the bytes.

| Property | Requirement |
|---|---|
| `latestState` | `observed`: every asked source reported the supplied tip unspent. `superseded`: at least one source reported a later state spending it, or a spend of it was seen on the accepted chain. `conflicting`: sources disagreed, or two unresolved candidates exist. `unknown`: no source was asked or none answered. |
| `sources` | One entry per source asked: `id`, `kind` (`overlay-lookup`, `spend-status`, `header-source`, `registry`, `other`), `observedAt`, the source's `result`, and `height` and `blockHash` when the source reported them. |
| `queryScope` | What was asked, in words: the topics, services or identifiers queried. |
| `observedAt` | When the observation was made. |
| `candidateOutpoints` | Every outpoint the sources returned as a possible tip, so a disagreement is visible rather than resolved. |

`observed` means latest within the declared method and sources. It MUST NOT be labelled a proof that no later spend exists, and the report's `limits` say so whenever `latestState` is not `unknown`. A height a peer reports is that peer's statement and not local header coverage. Confirmed competing spends are decided by accepted-chain spending evidence, never by counting sources. Two valid successors of one supplied state are a fork of one lineage and are reported as `conflicting` with both tips as candidates; two valid geneses under one identifier are rival records and are reported under `subjectBinding` as `genesis-ambiguous` unless the expectation names the genesis. A version 2 `RETIRE` reported unspent is `observed`: a retired tip is a valid tip.

## 6. Limits

Every report carries, in `limits`, the boundaries a reader would otherwise cross. At minimum: that supplied-history validity does not establish current ownership, authorised genesis or the absence of later states; that an anchor establishes its service's commitment and not the truth of the claim; that a status observation is as fresh as its source and no fresher; and, when `expectedSubject.source` is `none`, that the subject was not independently expected. When the history holds a version 1 state, that version 1 states sign an unframed preimage whose field boundaries are established by field validation and the chain rules, and that a version 1 `TRANSFER` proves control only where the owner-signed transfer is selected. When a version 2 `TRANSFER` carries an authorisation commitment, that the commitment binds the transfer to acceptance evidence the custodian retained and signed, custody-dependent evidence and not a signature made with a key the recipient controls. When two valid successors of one state were supplied, that which continuation is recognised is decided by accepted-chain spending evidence and never by the report. A verifier adds a sentence for every check it reported `unknown`.

## 7. Migration and surfaces

`verifyChain` and `ChainVerifyResult` remain as they are: a verifier of supplied history whose `valid` means exactly that. Consumers that exposed `valid` as a current or authorised status migrate to this report; consumers that only meant supplied-history validity may keep it. A surface presenting this report shows each check by a short label and keeps the technical findings, references and reasons behind an inspection view; it never shows a badge, seal or single colour that the check set did not earn.

The check names and reason codes are the contract; the words a surface shows beside them are the build's own, and `EVIDENCE_CHECK_LABELS` in the reference is one such vocabulary, not one to be shown verbatim. The reference implementation is `verifyPassportEvidence` in `@bsv/dpp-core`. Its representation-specific verifiers for credentials, status and authority are supplied by the caller, because the core is dependency-light and a VSC suite is not; a caller that supplies none gets `unknown` on those checks with the reasons that say why. [`../fixtures/evidence-v1.json`](../fixtures/evidence-v1.json) pins the report every conforming surface produces for a set of cases, including a stale prefix, a missing link, a signed substitution and a duplicate genesis, so an API, an embedded view and a standalone tool are compared on the same bytes. [`../fixtures/evidence-v2.json`](../fixtures/evidence-v2.json) pins the report for the version 2 cases under the same report version: a lineage under `managed-custody@1` with and without its acceptance record, a retired tip observed, a state after a `RETIRE`, a failed control proof, a `TRANSFER` without its commitment under the profile and with the profile off, a fork, a mismatched and an unauthorised acceptance record, the upgrade from the version 1 chain and its refusal, and a version this reader does not know.

## 8. Normative and implementation

What a conforming verifier reproduces: the report shape of §2, the source rule for the expected subject of §3, the sixteen check names with their four answers and shared reason codes of §4, the observation vocabulary and its limits of §5 and §6, and equivalent reports for the pinned fixture cases. What is a build's own: how it obtains evidence, which sources it asks, which policy it applies, how it labels the checks for a reader, and whether it decides an operation from the report at all.
