# Design rationale

**Status: informative.** The normative requirements are in the other specification documents and contracts. These choices explain the separation of native token history, credential exchange, anchoring and industry profiles.

## Independent token and attestation histories

Spending the previous token state establishes the order of native passport operations. Independent lifecycle attestations need not spend that token. This lets manufacturers, repairers, assessors and other authorised issuers contribute evidence without sharing token custody. An overlay operator indexes that evidence under public admission rules; several independently administered operators can serve the same records.

A native token signature proves who signed an operation. A credential proof proves who signed a claim under the selected identity rules. An anchor proves that its anchoring service signed a commitment, and a mining proof establishes transaction inclusion. Physical truth, accreditation, current status and evidence completeness require additional checks. Keeping these findings separate prevents a valid transaction from being mistaken for a verified supply-chain claim.

## Versioned commitments and credential formats

The current generic anchor commits to the complete secured representation, including its signature or proof. It names the representation and media type so a reader selects the correct verifier. Native lifecycle claims use the small restricted canonical JSON format; external credentials use their own proof suites and preserve exact issued bytes for commitment. Historical UORA-named anchors retain their original byte contract.

A supply-chain event is signed by the party that observed it, not translated into a custody vocabulary first. The signed EPCIS event representation keys the credential on the event's CBV 2.0 Event Hash ID, so two parties signing one event produce two attestations of one identifier, and carries the event as a W3C credential so a verifier outside this stack checks the signature with a JOSE library and no knowledge of BSV key derivation. Where the hash algorithm's ratified text and its reference implementations part, the profile refuses the input by name rather than choosing silently, because a hash two implementations compute differently identifies nothing.

Compatibility with an external credential format is a separately versioned exchange profile, whose sources, local resolutions, contexts, tests and unsupported requirements are explicit. Product and regulatory extensions sit above those common exchange rules. A recommended configuration can reduce implementation decisions without redefining application accounts, forcing every actor to manage a wallet, or implying that all deployments share one authority policy.

## Public metadata and restricted evidence

Encrypted owner-tier evidence remains off chain with its ciphertext digest in the token. Anchors also carry public issuer, subject, type and service metadata. Those identifiers, actor keys, timestamps and transaction relationships can reveal associations. Per-passport owner keys reduce direct correlation from owner-key reuse, but do not promise anonymity. Each profile must define which evidence can be public and which needs controlled disclosure.

## Control and custody

The native version-1 output uses one compressed key and OP_CHECKSIG. Wallet custody, DID document control, credential signing authority and application access are separate roles. A single-key script does not implement threshold custody or a second recovery path. Record version 2 proves control on every state after the genesis, with control authorities as the named recovery path; an application must describe its actual recovery authority and key custody accurately.

An account may administer multiple entities and keys, and several authorised accounts may administer one entity. These mappings belong to the application. Managed signing reduces onboarding requirements; independent signing and portable evidence support deployments that need greater operational independence. Neither arrangement changes the shared verification rules.

## Carried states

Record version 3, the token carrier, is parked outside the standard ([`../docs/reference/parked/token-carrier/`](../docs/reference/parked/token-carrier/README.md)).

## Availability and implementation guidance

No named platform is the exclusive source of record validity. Nevertheless, verifiers need the relevant bytes and authenticated evidence. Writers must retain transactions, proofs and secured credentials, and operators must report unavailable status or identity evidence explicitly. A local overlay index cannot prove global latest state or complete availability.

The reference implementation supplies a usable starting configuration and declares its limits. Alternative implementations may use other storage, wallets, hosting and trust policies while reproducing the selected byte and verification contracts. Broader compatibility claims require evidence against the corresponding clauses, not merely use of the same field names.
