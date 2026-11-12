# Where things stand

Application teams and operators can use this page to choose a release and identify build or deployment limits. Published packages, merged source and hosted services run at different versions.

| Status fact | Value |
|---|---|
| Updated | **3 November 2026** |
| Evidence checked on that date | [Merged source](https://github.com/bsv-blockchain/dpp/tree/08bdfa0a056d970c64b1749064b92bd1e6ae9d67), npm versions and hosted capability documents. |
| Standard and packages | Working draft before version 1.0; experimental packages under the Apache 2.0 licence. |
| Available work | Build passport applications, readers, writers and indexes; implement a registry against the published contract. |

## Before you start

| What you are assessing | Required identity and source |
|---|---|
| Installed packages | Versions and release from your installation; its publication receipt and conformance selection. |
| Hosted deployment | Service version and features from its capability document. |

Source changes do not upgrade installed packages or hosted services.

## Published and in development

Install **`dpp-release-2026-10-10`** from npm: the latest published runtime set has been under `latest` since 16 October 2026. It is superseded as the source development target. Its [publication receipt](../reference/publication-history/beta-11-publication.md) records the source revision, archive digests and verification results.

| Package | Published on npm | November source candidate |
|---|---|---|
| `@bsv/dpp-protocol` | `0.3.0-beta.9` | `0.3.0-beta.10` |
| `@bsv/dpp-profiles` | `0.3.0-beta.9` | `0.3.0-beta.10` |
| `@bsv/dpp-overlay` | `0.4.0-beta.12` | `0.4.0-beta.13` |
| `@bsv/dpp-credentials` | `0.2.0-beta.5` | `0.2.0-beta.6` |
| `@bsv/create-dpp-app` | `0.1.0-beta.1` | `0.1.0-beta.2` |
| `@bsv/create-dpp-index` | `0.1.0-beta.1` | Retired: run the index from the Compose preset |

Both starters were published on 20 October and pin generated projects to the published runtimes. The index starter is retired: its published version stays on npm and a new index runs from the [Compose preset](../operate/README.md) ([what replaces it](../packages/create-dpp-index.md)). The current source candidate is **`dpp-release-2026-11`**; its runtimes and updated application starter are not yet published. Pin exact versions; consult [release sets](../reference/release-sets.md) and [migration](../migration.md) when choosing or upgrading.

## Works today

- **Create an application:** the published [application starter](../packages/create-dpp-app.md). It has an offline lifecycle exercise; live writes need a funded wallet and index access.
- **Read and verify** record versions 1 and 2. Reports cover encoding, signatures, linkage, inclusion, subject binding, claims, anchors and evidence, explicitly showing missing evidence ([quick start](../quick-start.md#read-a-live-passport)).
- **Write** record version 2 with a BRC-100 wallet, and continue a version 1 passport through the version 2 upgrade; a new passport never starts at version 1. Announce to an index before sending and push proofs ([build an application](../packages/build-an-application.md)). Record version 3, the token carrier, is [parked](../reference/parked/token-carrier/README.md).
- **Run an index** with Docker from the [Compose preset](../operate/README.md): lookups, history, evidence packages, complete exports, proof ingestion and configured-peer synchronisation. Operators can select SHIP peer discovery, SHIP/SLAP advertising and retries for outputs left behind ([federation](../operate/federation.md)).
- **Sign, anchor and validate claims** about a passport, kept apart from the passport itself ([passport states and attestations](../learn/passport-and-attestations.md)).
- **Carry product data** under the current `general@2`, `battery@2` and `textile@2` profiles, with the `battery@4` draft to evaluate and the parked drafts `battery@3`, `textile@3` and `textile@4` still readable ([profiles](../profiles/README.md)).
- **Connect other standards**: GS1 Digital Link identifiers and discovery, EPCIS 2.0.1 event import and selected W3C credential formats, with passport projections as a reference feature of the profiles package ([interoperability](../interoperability/README.md)).
- **Try hosted services:** [demonstration and deployments](../deployment.md). Index capabilities still report `@bsv/dpp-overlay@0.4.0-beta.12`, `managed-custody@1` and static peers. Discovery and advertising are off. Its peer shares its administration, so these observations do not establish independent federation.

## Merged into source, not yet published

These features require a build from the November source candidate. They establish neither npm publication, a hosted upgrade nor completed interoperability testing with another implementing party.

| Feature | Behaviour | Default, limit or remaining evidence |
|---|---|---|
| Profile validation in the report | A reader can check each token payload against its declared profile by supplying `profilePayloadValidator(ajv)` from `@bsv/dpp-profiles`. | Without a validator, schema remains `unknown`; a payload without profile stamps reports `profile-undeclared` ([payload validation](../packages/dpp-profiles.md#check-a-payload-against-its-profile)). |
| Revised managed custody | `managed-custody@2`, the one custody profile, signs acceptance records with derived keys through a BRC-100 wallet. Acceptance records can travel in evidence packages. The holder instruction record is parked, and the owner-signed transfer for version 1 lineages is removed. | Version 1 acceptance records remain readable but are no longer written. The second implementing party's written acceptance of the version 2 signed shape remains outstanding ([custody specification](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/spec/managed-custody.md)). |
| Per-publisher write tokens | The index can issue and revoke submit and callback tokens bound to one publisher or anchoring key and one use, and refuses writes for a different key. `dpp-index connection` issues an application's pair and prints its connection file. | Complete export still needs the operator's shared export token ([run a service](../operate/README.md)). |
| **Publisher registration.** An operator can enable `POST /register` | Wallet-signed requests can be open or subject to approval. Acceptance appends a signed publisher-policy version and returns the publisher's write tokens. | Off by default; policy limit: 256 publisher entries, including retired entries ([index limits](../operate/limitations.md#index-host)). |
| Evidence and claim rules | Restricted tiers have a specified disclosure to each authorised reader, managed outputs lock to the state's controller key, and native lifecycle claims identify the state by transaction outpoint and carry no evidence facets. | See [release details](../reference/release-sets.md). |
| Directly signed EPCIS events | A party signs an EPCIS 2.0 event as a W3C credential keyed by its CBV 2.0 Event Hash ID with its own key (`epcis-event-vc@1`, `@bsv/dpp-protocol`); a verifier recomputes the hash and checks the signature; a registry anchors the exact bytes once per hash ID and issuer ([sign an event](../interoperability/epcis.md#sign-an-event)). | Proposed and claimed by no release. The hash algorithm's scope is fixed where its ratified text and the two reference generators part; the registry intake and a second implementation are outstanding. |

## Not working or not settled yet

Match these gaps to your version using [known limitations and open questions](../operate/limitations.md):

- nothing tells a reader which index or registry holds a publisher's records;
- a later proof does not follow synchronisation;
- published readers do not yet have the November candidate's token-payload schema check, and candidate readers must opt in with a validator;
- identity assurance in the reference application is Ring 0: an account and brand name do not establish a verified legal identity;
- no public registry implementation package or operator image is published, and the hosted registry does not serve a complete export;
- independently administered replication, deployment recovery objectives and Union DPP Registry integration remain unproven or unimplemented.

## Conformance evidence

The [reviewed ledger](https://github.com/bsv-blockchain/dpp/blob/08bdfa0a056d970c64b1749064b92bd1e6ae9d67/conformance/manifest.json) records implementation and evidence per requirement; read it with the [November candidate selection](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/conformance/selections/dpp-release-2026-11.json). Conformance claims are separate from passport lifecycle claims.

| Evidence | Ledger status | What remains |
|---|---|---|
| `GOV-independent-implementation` | implemented | Organisational independence remains an open gate; the Python reader was written by the same programme. |
| `EXPORT-4-complete-export` | archived | The complete export left the standard on 12 November 2026 and is a reference feature of the index package, with its local tests; the row is in the ledger archive. |
| `EXPORT-3-durable-publication` | gap | An independently administered replica and deployment recovery objectives have not been demonstrated. |

The [independent implementation trial](https://github.com/bsv-blockchain/dpp/blob/08bdfa0a056d970c64b1749064b92bd1e6ae9d67/conformance/demonstrations/independent-implementation-2026-09.json) has no recorded full completion, and its plan was parked on 12 November 2026, to be rewritten against the slimmed standard when an independent implementer appears. From the same day the selection requires one claim per role under `native-baseline@2`, the one baseline a claim names, with `gs1-identifier-discipline` and `profile-governance`, and withholds every other claim with its reason: the claims scoped to `native-baseline@1`, now historical, the optional custody, exchange and EPCIS profiles, the parked VSC compatibility profile and mappings, the status service and version 1.0 readiness. The standard makes no European system conformance or product-compliance claim. Inspect evidence through [conformance review](../reference/conformance.md). Passing tests or publishing packages does not establish these outcomes.

## Open decisions

| Decision | State, and what it means for an implementer |
|---|---|
| Profile governance | Open: who versions profiles and where canonical definitions live. Until settled, frozen manifests in `@bsv/dpp-profiles` define them. |
| Object identifier derivation | Declined for now: a physical-object DID stays optional and is never derived from the passport identifier ([identity](https://github.com/bsv-blockchain/dpp/blob/08bdfa0a056d970c64b1749064b92bd1e6ae9d67/spec/identity.md) section 3). |
| Issuer formats of the older anchor | Open: whether historical `uora-anchor-v3` issuers admit `did:web` alongside `did:key`. Today only `did:key` is admitted. New `bsv-attestation-anchor-v1` anchors are unaffected. |
| Hosting of the reference index | Open: long-term hosting. Today the index is a standalone container reached by URL. |
| Companion profile submission | Open: whether to propose the anchoring profile as a formal companion document. No effect on implementations. |
| Brand self-custody | The reference application and app starter use platform-managed identities. The standard permits owner-held keys; starter publication and managed-custody support do not deliver brand-controlled identity migration. |
