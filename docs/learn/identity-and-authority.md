# Identity and authority

**Audience:** application designers and verifier implementers. **Canonical sources:** [`spec/identity.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/identity.md), [`spec/conformance.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/conformance.md) §5, [`spec/services.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/services.md) §1.

## Seven terms, kept apart

The standard does not define an application account as a person, a brand, an organisation, a wallet, a DID or a controller, and it does not require any one-to-one mapping among them. Its normative text uses these terms, each scoped to the operation at hand:

| Term | Names | Does not by itself establish |
|---|---|---|
| Identified entity | What an identifier refers to | That it is a person, organisation or brand |
| Record or claim subject | What a state or an assertion is about | That it is the signer, the controller or an account |
| Actor or issuer | The entity acting or asserting, as bound to the signing evidence | Permission, or any party it claims to represent |
| Signing key | The key a signature verifies against, with its required derivation | Legal identity, or authority to act |
| DID controller | The entity authorised to control a DID under its method | Control of the subject, the account or the token |
| Key custodian | Whoever holds or operates a role's signing keys | The identity the key represents |
| Service operator | Whoever runs a wallet service, registry, overlay or other component | Control of any identity, or permission to issue for it |

A verifier never infers authority from an account name, a brand label or an administrator role. One account administering several identities, one identity reached through several authorised accounts, and an automated actor with no account at all are all permitted arrangements, and none of them supplies a missing rule.

## Keys, derivations and what a matching key proves

Native identity keys are compressed secp256k1 keys, spelled as `did:key` with the multicodec prefix when a DID is wanted, and a decoder round-trips them exactly or refuses. The actor's identity key is a BRC-42 parent; the signature verifies under its child for the record protocol and the passport identifier. The owner key is the owner's root derived under the owner protocol with the passport identifier as key identifier and counterparty `self`. The anchoring service's locking key is its identity's child for the anchor protocol and the attestation identifier. The claim signature has its own derivation. A verifier distinguishes the parent from every child, and a matching derivation establishes a key relationship: this signature was made by whoever holds this root. It establishes no accredited identity and no authority to make a physical claim.

## Publishers, policies and time

A publisher countersigns admitted states and anchors. A publisher is not an operator, and its keys are a bounded, versioned set: a publisher policy names each key with a role, an activation time and, once retired, a retirement time, each version names the digest of the one it supersedes, and each version carries an authorisation the previous version's rules accept. A reader checks a state's countersignature against the key active at the state's own time, so a retired key still authenticates what it signed while active and a new key authenticates nothing before its activation. A handover of publishing is a signed policy version; it never edits a list and it never moves the token's spending key.

## Authority is evidence, not association

Whether an issuer may assert an event, whether a custodian may accept on a recipient's behalf, whether a transfer authority may recover a passport: each is decided by the selected method or profile's explicit authorisation rules, with thresholds and effective times, and by verified authorisation evidence. A list of controllers is not a threshold. A DID document that resolves is an identity source, not accreditation. A credential's own statement that its issuer is trusted is not a trust anchor. The verification report keeps issuer authority as its own check, with `policy-missing`, `authority-unconfirmed` and `authority-not-required` among its named reasons, so a surface can never show a green badge that authority did not earn.
