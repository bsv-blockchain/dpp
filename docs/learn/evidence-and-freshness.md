# Evidence, inclusion, freshness and completeness

**Audience:** reader and verifier implementers, and anyone presenting a verification result. **Canonical sources:** [`spec/verification.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/verification.md), [`spec/portable-evidence.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/portable-evidence.md), [`spec/services.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/services.md).

## The one report

Every verification surface, whether an API, an embedded view or a standalone tool, produces the same report: a version, the observation time it evaluated against, the subject it was asked about and where that expectation came from, the supplied tip, the policy it applied, sixteen named checks in a fixed order, its observations of the latest state, and sentences stating its limits. Each check answers **pass**, **fail**, **unknown** or **not-applicable** with a shared reason code from the schema's vocabulary. There is no aggregate verdict and no score.

| Group | Checks |
|---|---|
| Token rail | `recordEncoding`, `actorSignatures`, `publisherSignatures`, `linkage`, `inclusion` |
| Attestation rail | `nativeAttestationSignature`, `anchorSignature`, `anchorKeyDerivation`, `anchorDigestAndMetadataBinding` |
| Credentials | `externalCredentialProof`, `subjectBinding`, `issuerAuthority`, `schema`, `credentialTime`, `credentialStatus` |
| Availability | `evidenceAvailability` |

The report fixtures pin the exact report for thirty-four cases built from the chain and anchor fixtures, so two implementations are compared on the same bytes and the same words.

## Inclusion is verified, never assumed

A state's inclusion is checked from its merkle path against a header source the verifier chooses. No proof means **unknown** with `proof-absent`; a proof the header source contradicts means **fail** with `proof-refuted`; an unreachable header source means **unknown** with `header-source-unavailable`. An index's answer that a state is admitted is not inclusion, and neither is a broadcaster's acknowledgement. The reference distinguishes four states of a written record and a writer reports them in those words: prepared locally, admitted by an index, accepted by the network, and included in a block with a verified proof.

## Freshness is an observation

A verifier may ask a source whether the supplied tip is unspent. The answer is an observation, recorded with its source and time, and it is never a proof: a source can be stale, partitioned or lying, and the report says which source said what. Supplied-history validity never establishes that no later state exists. A status list is as fresh as its signed `validFrom` and no fresher; a re-fetched old list does not become current.

## Completeness is relative to a snapshot

A bounded lookup returns the newest five hundred records and stops; it is a lookup, not an export. An export answers in pages over a stable snapshot, each page naming the snapshot, its sequence range and whether it is the last, so a reader detects a missing or repeated page from the ranges alone. The evidence package is a signed manifest over content-addressed files; its signature says that this exporter assembled these bytes and nothing more, and its completeness declaration is relative to the source snapshot it names. The complete export tiles one snapshot with signed coverage records, and a reader joins the parts only from records whose signature verifies and whose digest binds the package it received. An export complete for one source can still miss what another source holds; snapshot completeness is not global freshness, and a reader that has joined a complete export still verifies every transaction, proof and claim inside it.

## What a surface may show

A surface shows each check by a short label and keeps the findings, references and reasons behind an inspection view. It never shows a badge, a seal or a single colour that the check set did not earn, and a check that was not run is **unknown** with `not-inspected`, never a pass by omission.
