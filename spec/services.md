# Service roles and verification boundaries

**Status: working draft, pre-1.0.** This document defines service roles around native records, secured attestations and independent overlays. It separates cryptographic verification from retrieval, identity, authority and current-status evidence.

## 1. No exclusive service operator

Native supplied-history verification uses transaction bytes and public block-header evidence. Credential verification additionally needs the selected proof, identity, status and authority material. Services may provide that material, but no named platform is a universal trust dependency. Missing evidence produces an explicit unavailable or indeterminate check; it does not establish validity or invalidity by itself.

A retained token tip and a transaction source can recover native predecessor transactions. They do not recover off-chain credential bodies or prove no later state exists. Readers MUST distinguish supplied-history validity, observed latest state and complete evidence availability.

An operator MAY run one or several roles. Independent operators MAY serve the same topics and immutable evidence. Public overlays SHOULD advertise through SHIP/SLAP; clients MAY pin hosts. Peer discovery, synchronisation and retention policies must be declared and tested before claiming a deployment is independently replicated. The reference HTTP node's default configuration does not enable peer synchronisation.

A publisher is not an operator. The keys that countersign admitted states and anchors are a bounded, versioned set declared in a publisher key policy ([`../contracts/publisher-policy.schema.json`](../contracts/publisher-policy.schema.json), `dpp-publisher-policy@1`): each key has a role, an activation time and, once retired, a retirement time, and each policy version names the digest of the version it supersedes and carries an authorisation that the superseded version's rules accept: the first version is signed by an operator's identity key, a rotation by a key active under the superseded version and, in a federation, countersigned by another operator, a handover by such a key and countersigned by an incoming operator, all over the policy's canonical JSON without its signature values. A reader checks a state's publisher signature against the key that was active at the state's time, so a retired key still authenticates what it signed while active and a new key authenticates nothing before its activation. Retirement is therefore not revocation: a key compromised after its retirement can still countersign a state dated inside its window, and an operator that needs to close that window applies an admission-time bound on how far a state's timestamp may lag its arrival, or names the compromise in a policy version that revokes the key's window. A handover of publishing to another operator is a signed policy version, with the old key's evidence preserved; the token spending key, if it must move at all, moves only through the custody or transfer mechanism of [`custody.md`](custody.md), never by editing a list. Operators of one federation share one policy scope and one policy history, and none of them can authorise a key alone once the scope names more than one operator.

## 2. The overlay index

The current passport topic/service are tm_dpp and ls_dpp. The current attestation commitment topic/service are tm_attestation and ls_attestation. The legacy tm_uora_dpp and ls_uora_dpp interfaces serve historical anchor v3 separately. [The overlay contract](../contracts/overlay.yaml) extends the BRC-22/BRC-24 interfaces with these admission and lookup rules.

Passport admission checks the native state and selected custody policy. Generic anchor admission checks its exact script, framed metadata signature and anchoring-service key derivation. It does not validate a VSC credential that is not present in the transaction. Returned BEEF enables independent transaction and inclusion verification; an index's response is not a global completeness or latest-state proof.

Current anchor lookup uses exact metadata selectors and an outpoint cursor. Callers retrieving history MUST continue through all pages. An operator may limit request size, but cannot silently describe a truncated result as complete.

Announcement failure changes discoverability, not transaction inclusion. Retry the same announcement rather than rebuilding an already submitted transaction. A mined transaction SHOULD be served with its Merkle proof. Pushed proofs MUST be checked against the transaction and the index's block-header source before storage. Unavailable headers defer proof acceptance.

## 3. The attestation registry

The registry stores immutable secured bytes, evaluates the selected representation and trust policy, and may anchor accepted evidence. Issuer, registry, anchoring service and overlay are separate roles. New submissions select either the native claim format or the VSC representation explicitly. Invalid or unsupported full credentials MUST NOT fall through to legacy intake.

[The registry contract](../contracts/registry.yaml) defines the implementation profile's intake, validation, history, proof and capability routes. It is our service contract, not a claim that VSC standardises these paths. Native records retain an explicit tokenRecordId for token-history assembly. A VSC credential does not acquire a fabricated token state merely by being stored.

Store the complete original bytes, media type, representation, digest, verified metadata and scoped verification report. Corrections and projections create new records and retain their source relationships. Unauthenticated status lists and self-asserted authority do not satisfy active credential validation.

A registry records the relations between claims independently of token spending: `supersedes`, `revokes`, `suspends`, `expires` and `disputes` are relations between attestations, and none is implied by a passport state changing hands. A claim can be historically authentic and currently superseded. An observation about a product does not automatically compete with every other observation about that product: competing custody claims, input-consuming transformations and independent assessments have distinct conflict rules, and the historical authority precedence applies only between claims under one comparable named trust framework. Otherwise the registry returns an unresolved conflict rather than a winner. Antecedents are resolved by their expected identifier and verified content under bounded traversal, with a shared ancestor in a diamond valid and a true cycle refused; a missing or mismatched ancestor stays unresolved with its reason. An external lifecycle event records its identifier, product references, event time, claimant, evidence, quantities and units, facility references where relevant, predecessor and related claims and its mapping profile and version; it binds to a passport state where one exists and may otherwise reference the stable product identifier without any token spend.

Legacy intake is disabled by default. Historical native and SD-JWT representations retain their original identifiers and reported assurance. Enabling a compatibility intake path cannot grant it current VSC conformance.

## 4. Verification surfaces

Report native signature, token linkage, anchor attribution, representation digest, VSC proof, issuer identity, authority, credential status, event time, custody graph, corrections and inclusion separately where applicable. An unavailable required check prevents dependent acceptance. A native proof result cannot be reused as a VSC proof result. [The verification contract](verification.md) fixes the report every surface produces: sixteen named checks with four answers each, an independently expected subject, and an observation of the latest state that is never a proof.

An aggregate operation outcome MAY decide intake only when its required check set and policy are explicit. User-facing output MUST retain the per-check findings and must not label an anchor-only result as a verified physical claim. A derived disclosure presentation is verified with its own suite and challenge binding; matching visible fields does not prove equality with anchored full credential bytes.

## 5. Identifier resolution

[Identity](identity.md) separates physical-object DIDs, actor DIDs, credential ids, token keys and application accounts. Resolve only under declared method and security policies. A nomination inside untrusted data is not automatically an accepted trust anchor. Offline verification can use retained authenticated resolution evidence and must report its time/scope; it cannot infer current control or revocation state from historical evidence alone.

## 6. Operator conformance

Operators declare implemented roles, formats, versions and limits. Replay of an admitted outpoint is idempotent. Reorganisation eviction and recovery use the same exact evidence rules. Deployment policy may restrict who submits or which anchoring services are accepted, but cannot relax signature or byte rules while advertising the same conformance profile.

Operational availability, independently replicated overlays, credential-format compatibility and industry applicability are separate claims. The VSC profile records local resolutions of draft ambiguities and cannot be described as upstream certification.
