# Where things stand

**Updated 3 November 2026.** The standard remains a working draft before version 1.0, with experimental packages under the Apache 2.0 licence. You can build passport applications, readers, writers and indexes today, and implement a registry against the published contract. Published packages, changes merged into source and hosted deployments are at different versions.

This update checks [the merged source](https://github.com/bsv-blockchain/dpp/tree/08bdfa0a056d970c64b1749064b92bd1e6ae9d67), npm package versions and the hosted services' capability documents on that date.

## Published and in development

The latest published runtime set is **`dpp-release-2026-10-10`**, on npm under `latest` since 16 October 2026. It is superseded as the source development target, but remains the set to install from npm. The [publication receipt](../reference/beta-11-publication.md) records its source revision, archive digests and verification results.

| Package | Published on npm | November source candidate |
|---|---|---|
| `@bsv/dpp-protocol` | `0.3.0-beta.9` | `0.3.0-beta.10` |
| `@bsv/dpp-profiles` | `0.3.0-beta.9` | `0.3.0-beta.10` |
| `@bsv/dpp-overlay` | `0.4.0-beta.12` | `0.4.0-beta.13` |
| `@bsv/dpp-credentials` | `0.2.0-beta.5` | `0.2.0-beta.6` |
| `@bsv/create-dpp-app` | `0.1.0-beta.1` | `0.1.0-beta.2` |
| `@bsv/create-dpp-index` | `0.1.0-beta.1` | `0.1.0-beta.2` |

Both starters were published on 20 October and generate projects pinned to the published runtime set. The current source candidate is **`dpp-release-2026-11`**; its runtime packages and the updated starters are not yet published. Pin exact versions and use [release sets](../reference/release-sets.md) and the [migration guide](../migration.md) when choosing or upgrading a set.

## Works today

- **Create an application or index** with the published [application starter](../packages/create-dpp-app.md) or [index starter](../packages/create-dpp-index.md). The application includes an offline lifecycle exercise; live writing needs a funded wallet and access to an index.
- **Read and verify passports** in record versions 1, 2 and 3, with a report covering encoding, signatures, linkage, inclusion, subject binding, claims, anchors and evidence. Missing evidence remains explicit in the report ([quick start](../quick-start.md#read-a-live-passport)).
- **Write passports** in record versions 1, 2 and 3 with a BRC-100 wallet, announce them to an index before sending, and push their proofs. Version 3 adds the BRC-162 token carrier ([build an application](../packages/build-an-application.md)).
- **Run an index** with Docker: lookups, history, evidence packages and complete exports, proof ingestion, and synchronisation with configured peers. SHIP peer discovery, SHIP/SLAP advertising and retries for outputs left behind are available as operator settings ([federation](../operate/federation.md)).
- **Sign, anchor and validate claims** about a passport, kept apart from the passport itself ([passport states and attestations](../learn/passport-and-attestations.md)).
- **Carry product data** under the current `general@2`, `battery@2` and `textile@2` profiles, with version 4 drafts to evaluate ([profiles](../profiles/README.md)).
- **Connect other standards**: GS1 Digital Link identifiers and discovery, EPCIS 2.0.1 event import, selected W3C credential formats and passport projections ([interoperability](../interoperability/README.md)).
- **Try it hosted**: the [demonstration and hosted services](../deployment.md). The index's capability document still reports `@bsv/dpp-overlay@0.4.0-beta.12`, `managed-custody@1` and static peers. Discovery and advertising are off; its peer is under the same administration. These observations do not establish independently operated federation.

## Merged into source, not yet published

The November candidate includes these changes beyond the published set:

- **Profile validation in the verification report.** A reader can check each token payload against its declared profile by supplying `profilePayloadValidator(ajv)` from `@bsv/dpp-profiles`. Without a validator, the schema result remains `unknown`; a payload without profile stamps reports `profile-undeclared` ([payload validation](../packages/dpp-profiles.md#check-a-payload-against-its-profile)).
- **Revised managed custody.** `managed-custody@2` signs acceptance and instruction records with derived keys through a BRC-100 wallet. Version 1 acceptance records remain readable but are no longer written. Acceptance records can travel in evidence packages, and an index selecting the instruction rule requires a committed holder instruction for a custodian's subsequent update or retirement. The second implementing party's written acceptance of the version 2 signed shape remains outstanding ([custody specification](https://github.com/bsv-blockchain/dpp/blob/08bdfa0a056d970c64b1749064b92bd1e6ae9d67/spec/managed-custody.md)).
- **Per-publisher write tokens.** The index can issue and revoke submit and callback tokens bound to one publisher or anchoring key and one use, and refuses writes for a different key. Complete export still uses the operator's shared export token ([run a service](../operate/README.md)).
- **Publisher registration.** An operator can enable `POST /register` for wallet-signed requests, either open or subject to approval. Accepted requests append a signed publisher-policy version and return the publisher's write tokens. Registration is off by default and the policy is limited to 256 publisher entries, including retired entries ([index limits](../operate/limitations.md#index-host)).
- **Evidence and claim rules.** Restricted tiers have a specified disclosure to each authorised reader, managed outputs lock to the state's controller key, and native lifecycle claims identify the state by transaction outpoint and may carry structured evidence facets ([release details](../reference/release-sets.md)).

These changes are available to build from source. They do not imply an npm publication, a hosted upgrade or completed interoperability testing with another implementing party.

## Not working or not settled yet

[Known limitations and open questions](../operate/limitations.md) gives the operational detail. Match each limit to the version you use; the source changes above do not upgrade an installed package or hosted service. The main remaining gaps are:

- nothing tells a reader which index or registry holds a publisher's records;
- a later proof does not follow synchronisation;
- published readers do not yet have the November candidate's token-payload schema check, and candidate readers must opt in with a validator;
- identity assurance in the reference application is Ring 0: an account and brand name do not establish a verified legal identity;
- no public registry implementation package or operator image is published, and the hosted registry does not serve a complete export;
- independently administered replication, deployment recovery objectives and Union DPP Registry integration remain unproven or unimplemented.

## Conformance evidence

The ledger records implementation and evidence for each requirement. Read the [ledger at the reviewed source](https://github.com/bsv-blockchain/dpp/blob/08bdfa0a056d970c64b1749064b92bd1e6ae9d67/conformance/manifest.json) beside the [November candidate selection](https://github.com/bsv-blockchain/dpp/blob/08bdfa0a056d970c64b1749064b92bd1e6ae9d67/conformance/selections/dpp-release-2026-11.json). For installed packages, use their publication receipt and selection instead. These conformance claims are separate from the lifecycle claims a passport carries.

| Evidence | Ledger status | What remains |
|---|---|---|
| `GOV-independent-implementation` | implemented | Organisational independence remains an open gate; the Python reader was written by the same programme. |
| `EXPORT-4-complete-export` | tested | Local tests cover multipart export, refusal cases and restoration. Retained hosted interruption, expiry and restore evidence remains outstanding; the registry does not serve a complete export. |
| `EXPORT-3-durable-publication` | gap | An independently administered replica and deployment recovery objectives have not been demonstrated. |
| `READY-2-eu-registry` | gap | No Union DPP Registry integration. |

The [independent implementation trial](https://github.com/bsv-blockchain/dpp/blob/08bdfa0a056d970c64b1749064b92bd1e6ae9d67/conformance/demonstrations/independent-implementation-2026-09.json) has no recorded completion of the full trial; its custody scenario still names version 1 pending the second party's acceptance of version 2. The selection continues to withhold federated operation, full VSC compatibility, the UNTP pilot, European conformity, battery product qualification and version 1.0 readiness. Use [conformance review](../reference/conformance.md) to inspect the evidence. Passing reference tests or publishing packages does not establish these outcomes.

## Open decisions

| Decision | State, and what it means for an implementer |
|---|---|
| Profile governance | Open: who versions a profile and where its canonical definition lives. Until settled, the frozen manifests in `@bsv/dpp-profiles` are the definitions. |
| Object identifier derivation | Declined for now: a physical-object DID stays optional and is never derived from the passport identifier ([identity](https://github.com/bsv-blockchain/dpp/blob/08bdfa0a056d970c64b1749064b92bd1e6ae9d67/spec/identity.md) section 3). |
| Issuer formats of the older anchor | Open: whether the issuer field of the historical `uora-anchor-v3` anchor admits `did:web` as well as `did:key`. Today it admits `did:key` only; new anchors use `bsv-attestation-anchor-v1`, which this does not affect. |
| Hosting of the reference index | Open: where the hosted index runs in the long term. Today it is a standalone container reached by its URL. |
| Companion profile submission | Open: whether to propose the anchoring profile as a formal companion document. No effect on implementations. |
| Brand self-custody | The reference application and app starter still use platform-managed identities. The standard permits owner-held keys, but publishing a starter or supporting managed-custody records does not deliver brand-controlled identity migration. |
