# Design rationale

**Status: informative.** The normative requirements are in the other specification documents and contracts. These choices explain the separation of native token history, credential exchange, anchoring and industry profiles.

## Independent token and attestation histories

Spending the previous token state establishes the order of native passport operations. Independent lifecycle attestations need not spend that token. This lets manufacturers, repairers, assessors and other authorised issuers contribute evidence without sharing token custody. An overlay operator indexes that evidence under public admission rules; several independently administered operators can serve the same records.

A native token signature proves who signed an operation. A credential proof proves who signed a claim under the selected identity rules. An anchor proves that its anchoring service signed a commitment, and a mining proof establishes transaction inclusion. Physical truth, accreditation, current status and evidence completeness require additional checks. Keeping these findings separate prevents a valid transaction from being mistaken for a verified supply-chain claim.

## Versioned commitments and credential formats

The current generic anchor commits to the complete secured representation, including its signature or proof. It names the representation and media type so a reader selects the correct verifier. Native lifecycle claims use the small restricted canonical JSON format; VSC credentials use their actual Data Integrity suites and preserve exact issued bytes for commitment. Historical UORA-named anchors retain their original byte contract.

VSC compatibility is a separately versioned capability. The source drafts, local resolutions, contexts, tests and unsupported requirements are explicit. Product and regulatory extensions sit above those common exchange rules. A recommended configuration can reduce implementation decisions without redefining application accounts, forcing every actor to manage a wallet, or implying that all deployments share one authority policy.

## Public metadata and restricted evidence

Encrypted owner-tier evidence remains off chain with its ciphertext digest in the token. Anchors also carry public issuer, subject, type and service metadata. Those identifiers, actor keys, timestamps and transaction relationships can reveal associations. Per-passport owner keys reduce direct correlation from owner-key reuse, but do not promise anonymity. Each profile must define which evidence can be public and which needs controlled disclosure.

## Control and custody

The native version-1 output uses one compressed key and OP_CHECKSIG. Wallet custody, DID document control, credential signing authority and application access are separate roles. A single-key script does not implement threshold custody or a second recovery path. The custody specification defines the optional owner-consent predicate; an application must describe its actual recovery authority and key custody accurately.

An account may administer multiple entities and keys, and several authorised accounts may administer one entity. These mappings belong to the application. Managed signing reduces onboarding requirements; independent signing and portable evidence support deployments that need greater operational independence. Neither arrangement changes the shared verification rules.

## Availability and implementation guidance

No named platform is the exclusive source of record validity. Nevertheless, verifiers need the relevant bytes and authenticated evidence. Writers must retain transactions, proofs and secured credentials, and operators must report unavailable status or identity evidence explicitly. A local overlay index cannot prove global latest state or complete availability.

The reference implementation supplies a usable starting configuration and declares its limits. Alternative implementations may use other storage, wallets, hosting and trust policies while reproducing the selected byte and verification contracts. Broader compatibility claims require evidence against the corresponding clauses, not merely use of the same field names.
