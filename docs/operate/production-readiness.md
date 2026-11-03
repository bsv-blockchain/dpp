# Prepare for production

Platform and service owners can use this checklist to decide whether to release for real users and products. Record the supporting evidence and name each operating responsibility before making that decision.

This planning checklist adds no requirements to the open standard and certifies no product, organisation or deployment. Readiness depends on your chosen scope.

## Before you start

| Input | Source and use |
|---|---|
| Product scope | [Your platform brief](../start/plan-your-platform.md): users, actions, products, volumes, retention and service commitments |
| Selected release and profiles | Your installed package versions, configuration and selected contracts |
| Representative product data | Your data suppliers; use the exact selected profile |
| Authority, access and service owners | Your organisation and providers; include identifier entitlement, key responsibilities and named operating owners |
| Operational evidence | Your application's tests, journals, exports and recovery exercises |
| Standard status | Before version 1.0; check [current status](../start/status.md) and [known limitations](limitations.md) |

## Confirm the product and data scope

1. Complete the platform brief with the users, actions, products, volumes, retention periods and service commitments you will support.
2. Check representative data against the selected profile. Use [profile and application readiness](../profiles/reviewing-readiness.md) to assess field coverage, source quality and application handling.
3. Confirm control of the identifier domain and entitlement to the identifiers used for real products. Preserve the complete identifier, including its host, throughout the application. The [identifier guide](../identifiers.md) covers resolution and ambiguous matches.

Transaction verification does not currently validate a payload against its declared profile. A passing cryptographic report is therefore not enough to accept product data.

## Confirm authority, custody and keys

| Record | Required distinction or evidence |
|---|---|
| Permission to issue, update, countersign, make claims and accept custody | Account membership is separate from legal identity and signing authority |
| Key protection, backup and rotation | Name the responsible party for each key and how authorised operations continue after staff or provider changes |
| Managed custody | Retain required acceptance evidence; review [custody](../learn/custody.md) and its open questions before offering transfers |

## Confirm services and access

For each external service, record the provider agreement and tested access. For services you operate, record equivalent internal responsibilities.

| Service fact | Record |
|---|---|
| Endpoint and compatibility | Base URL, network, selected release/contracts and required profiles |
| Trust and admission | Trusted operator identity, admitted publisher or anchoring keys, policy validity windows |
| Access | Read, submission, callback and export permissions; credentials scoped to intended destinations |
| Operating commitments | Retention, capacity, availability, incident response and support ownership |
| Evidence delivery | Responsibility for later proofs, missing claims and unavailable sources |

Use [component selection](../start/choose-components-and-services.md) and the [hosted reference](../deployment.md). A public endpoint or successful capability request establishes no production service commitment.

## Demonstrate reliable operations

Exercise the operations your product offers, including failure and recovery.

| Exercise | Evidence to retain |
|---|---|
| For writers: concurrent attempts, interrupted broadcasts and retries | Show that intended operations cannot be silently lost or conflicting state concealed; keep the journal and evidence needed to resolve uncertainty |
| Pending transaction through mining | Show how it becomes verifiable and how every relevant index receives later proofs |
| Peer operation | Verify actual record flow and admission agreement; two endpoints under one operator do not demonstrate independent operation |
| Restore a representative export in isolation | Verify recovered evidence; distinguish a bounded evidence package from complete history |
| Recovery boundaries | Check snapshot expiry, export-signing trust and separate recovery of keys, claim bytes, product data and restricted evidence |

Use [wallet and proofs](wallet-broadcast-proofs.md) and [recovery](export-import-recovery.md) for the procedures.

## Demonstrate honest user-facing results

| Result to present | What the user must understand |
|---|---|
| `pass`, `fail`, `unknown`, `not-applicable` | Present each with its reasons |
| Missing evidence, uncertain freshness or unavailable service | These are not successful verification |
| Valid signature | Separate this finding from authority, product authenticity and regulatory assessment |

| Failure scenario to test | Review |
|---|---|
| Invalid profile payload | How the application reports invalid product data |
| Unauthorised issuer | How authority is distinguished from signature validity |
| Ambiguous identifier | How the intended passport is selected |
| Refused write | How the refusal reaches the user |
| Missing proof or claim bytes | How missing evidence is shown |

## Record the release decision

1. Complete a decision record:

| Field | Fill in |
|---|---|
| Deployed versions and configuration | |
| Completed checks and evidence locations | |
| Operating owner for each service | |
| Unresolved issue, owner and effect on scope | |
| Agreed release criteria and decision | |
| Upgrade, recovery and maintenance owner | |

2. Where an unresolved standard question affects a promised feature, obtain the necessary decision or adjust the scope before release.
3. Accept only against agreed criteria. Document the upgrade and recovery path, including [migration](../migration.md), and assign a person or team to maintain the launched service.
