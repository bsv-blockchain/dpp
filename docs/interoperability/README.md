# Choose an interoperability profile

Teams with GS1 Digital Links, EPCIS events, W3C Verifiable Credentials or product data split by model, batch and item can use this page to choose a passport integration route. Each route provides an example and a guide; none writes a passport state.

## Before running an example

| Input | Source and requirement |
|---|---|
| Runtime and checkout | Node 22 or later, npm and git; obtain the checkout through [setup](../quick-start.md#get-the-code). |
| Completed build | Run `npm ci` and `npm run build` in the checkout root. Setup needs network access. |
| Example execution | Run the selected `node examples/<name>.mjs` command below from that root. Examples need no network or wallet. |

| You already have | What the route does | Profile | What the packages do | Example | Page |
|---|---|---|---|---|---|
| GS1 barcodes, or a GS1 resolver | Lets a scanned code lead to a passport and its evidence | `gs1-digital-link@1` | Parse and decompress Digital Links; build and read linksets (`@bsv/dpp-profiles`) | [`node examples/resolve-digital-link.mjs`](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/examples/resolve-digital-link.mjs) | [GS1 discovery](gs1-discovery.md) |
| An EPCIS 2.0 event repository | Keeps supply-chain events, unchanged, as evidence beside a passport | `epcis-json@1` | Parse, validate, digest and classify each arrival; never sign (`@bsv/dpp-credentials/epcis-source`) | [`node examples/import-epcis.mjs`](https://github.com/bsv-blockchain/dpp/blob/bb82d30c988f7432e3157f8d60296855c7c935ba/examples/import-epcis.mjs) | [EPCIS source exchange](epcis.md) |
| Credentials from other issuers (VC Data Model 2.0, `did:web`) | Verifies them and folds the result into the passport report | `vc-di-ecdsa-rdfc-2019@1` | Verify only; there is no issuance (`@bsv/dpp-credentials/exchange`) | [`node examples/verify-external-credential.mjs`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/examples/verify-external-credential.mjs) | [External credentials](external-credentials.md) |
| Your own EPCIS 2.0 events, to sign and anchor | Signs each event as the party that observed it, keyed by its CBV 2.0 Event Hash ID, and anchors the exact credential bytes | `epcis-event-vc@1` (proposed) | Build, sign and verify the credential with a BRC-100 wallet or a `ProtoWallet`; status and DID resolution stay caller-supplied (`@bsv/dpp-protocol`) | No example yet; `fixtures/vectors/dpp/exchange/epcis-event-vc/v1.json` carries signed cases with published test scalars | [Sign an event](epcis.md#sign-an-event) |
| Product data by model, batch and item | Computes a reproducible product view for a passport page | None: a projection is a data document and a reference feature of the package, outside the standard | Project and check the digest (`@bsv/dpp-profiles`) | [`node examples/project-passport.mjs`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/examples/project-passport.mjs) | [Projections](projections.md) |

The current candidate, `dpp-release-2026-11`, carries the EPCIS route's strict parsing, schema validation, event digests and arrival classification. From 12 November 2026 its selection claims no optional profile, so it withholds `epcis-source-import-1`, the claim on that route. The earlier `epcis-source-exchange-1`, which also covered the parked mapping, moved to the ledger archive the same day.

## What each route's output feeds

Imports and projections are separate from passport operations:

| Route | Output and next step |
|---|---|
| GS1 discovery | Link to a passport page or evidence. A [passport reader](../implement/roles/passport-reader.md) verifies the response against the scanned identifier. |
| EPCIS import | Retained source with each event's validation findings, body digest and arrival classification. Passport states remain untouched. |
| External credential verification | Shared-report findings: `externalCredentialProof`, `schema`, `credentialTime`, `credentialStatus`, `issuerAuthority` and `evidenceAvailability`. |
| Projection | Product view with its own digest for a passport page. |

Keep original sources and mapping results so participants can see what survived exchange. Agree representation and profile version with the receiving party before live exchange. The [interoperability profile schema](https://github.com/bsv-blockchain/dpp/blob/bb82d30c988f7432e3157f8d60296855c7c935ba/packages/dpp-profiles/schemas/interoperability-profile.schema.json) and [exchange source](https://github.com/bsv-blockchain/dpp/blob/bb82d30c988f7432e3157f8d60296855c7c935ba/spec/exchange.md) define profile selection.

## Not available in this release

| Integration | Status and evidence |
|---|---|
| United Nations Transparency Protocol (UNTP) exchange | Proposed, outside this release. The published beta.4 [selection](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/selections/dpp-release-2026-10.json), now superseded, withholds `untp-0.7.0-pilot` with its reason, and the current candidate's selection withholds it too. The [profile source](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/exchange) records the proposal. |
| European Standard (EN) 18223 serialisation and Union DPP Registry integration | Not implemented, and the standard makes no European system conformance claim. An operator-supplied registration reference does not prove registration occurred. |

## Parked: compatibility profiles

| Integration | Status and evidence |
|---|---|
| Verifiable Supply Chain (VSC) SEALs, `vsc-draft-compat/0.1.0`, and mapping EPCIS events to SEALs, `epcis-vsc@1` and `epcis-vsc@2` | Parked: optional compatibility profiles that no release requires and the programme does not currently develop. From `@bsv/dpp-credentials` 0.2.0-beta.6 their code is no longer in the package; [EPCIS source exchange](epcis.md#parked-map-events-to-seals) and the [credentials package](../packages/dpp-credentials.md#parked-the-vsc-compatibility-profile) say where it is kept. A mapped SEAL is unsigned until a separately authorised issuer signs it, and a [registry](../implement/roles/registry.md) refuses a new one as `unsupported` with `representation-unsupported` while SEALs it stored before stay readable; passport states remain untouched. |

Next: open your route's page for its expected results and integration procedure.
