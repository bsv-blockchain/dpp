# Prepare for production

Use this page when your team is preparing its own platform or service for real users and products. The output is a release decision supported by evidence and named operating responsibilities.

This is a platform planning checklist. It does not add requirements to the open standard or certify a product, organisation or deployment. The standard is before version 1.0, and readiness depends on your chosen scope.

## Confirm the product and data scope

Complete [your platform brief](../start/plan-your-platform.md). Identify the users, actions, products, volumes, retention periods and service commitments you will support.

Check representative product data against the exact selected profile. Assess field coverage, source quality and the application's handling of that data using [profile and application readiness](../profiles/reviewing-readiness.md). Transaction verification does not currently validate a payload against its declared profile. A passing cryptographic report is therefore not enough to accept product data.

Confirm control of the identifier domain and entitlement to the identifiers used for real products. Preserve the complete passport identifier, including its host, throughout the application. Use the [identifier guide](../identifiers.md) for resolution and ambiguous matches.

## Confirm authority, custody and keys

Document who may issue, update, countersign, make claims and accept custody. Keep account membership separate from legal identity and signing authority.

Record who protects, backs up and rotates each key, and how authorised operations continue after staff or provider changes. For managed custody, retain the required acceptance evidence. Review [custody](../learn/custody.md) and its open questions before offering transfer behaviour to users.

## Confirm services and access

For every external service, record the actual provider agreement and tested access. For services you operate, record the equivalent internal responsibilities. Include:

- Base URL, network, selected release/contracts and required profiles.
- Trusted operator identity, admitted publisher or anchoring keys and policy validity windows.
- Read, submission, callback and export permissions, with credentials scoped to their intended destinations.
- Retention, capacity, availability, incident response and support ownership.
- Responsibility for later proofs, missing claims and unavailable evidence sources.

Use [component selection](../start/choose-components-and-services.md) and the [hosted reference](../deployment.md). A public endpoint or a successful capability request does not establish a production service commitment.

## Demonstrate reliable operations

Exercise the operations your product offers, including failure and recovery. For a writer, show that concurrent attempts, interrupted broadcasts and retries cannot silently lose the intended operation or conceal conflicting state. Keep the journal and evidence needed to resolve uncertainty.

Show how a pending transaction becomes a verifiable mined transaction and how each relevant index receives later proofs. With peers, verify the actual record flow and admission agreement. Two endpoints run by the same operator do not demonstrate independent operation.

Restore a representative export into an isolated environment and verify the recovered evidence. Distinguish a bounded evidence package from complete history. Check snapshot expiry, export signing trust and the separate recovery of keys, claim bytes, product data and restricted evidence. See [wallet and proofs](wallet-broadcast-proofs.md) and [recovery](export-import-recovery.md).

## Demonstrate honest user-facing results

Present `pass`, `fail`, `unknown` and `not-applicable` with reasons. Show users when evidence is missing, freshness is uncertain or a required service is unavailable. Avoid presenting those situations as successful verification.

Test an invalid profile payload, an unauthorised issuer, an ambiguous identifier, a refused write and missing proof or claim bytes. Explain signature validity separately from authority, product authenticity and any regulatory assessment.

## Record the release decision

Keep a short record of the deployed versions, configuration, completed checks, evidence locations, operating owners and unresolved issues. Review [known limitations](limitations.md) and [current status](../start/status.md). Where an unresolved standard question affects a promised feature, obtain the necessary decision or adjust the scope before release.

Accept a release only against your agreed criteria. Document the upgrade and recovery path, including [migration](../migration.md), and assign a person or team to maintain the service after launch.
