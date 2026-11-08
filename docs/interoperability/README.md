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
| GS1 barcodes, or a GS1 resolver | Lets a scanned code lead to a passport and its evidence | `gs1-digital-link@1` | Parse and decompress Digital Links; build and read linksets (`@bsv/dpp-profiles`) | [`node examples/resolve-digital-link.mjs`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/examples/resolve-digital-link.mjs) | [GS1 discovery](gs1-discovery.md) |
| An EPCIS 2.0 event repository | Keeps supply-chain events, unchanged, as evidence beside a passport, and maps them to credentials | `epcis-json@1` to import, `epcis-vsc@1` (or the proposed `epcis-vsc@2`) to map | Parse, validate and map; never sign (`@bsv/dpp-credentials`) | [`node examples/import-epcis.mjs`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/examples/import-epcis.mjs) | [EPCIS source exchange](epcis.md) |
| Credentials from other issuers (VC Data Model 2.0, `did:web`) | Verifies them and folds the result into the passport report | `vc-di-ecdsa-rdfc-2019@1` | Verify only; there is no issuance (`@bsv/dpp-credentials/exchange`) | [`node examples/verify-external-credential.mjs`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/examples/verify-external-credential.mjs) | [External credentials](external-credentials.md) |
| Product data by model, batch and item | Computes a reproducible product view for a passport page | None: a projection is a data document, not an exchange profile | Project and check the digest (`@bsv/dpp-profiles`) | [`node examples/project-passport.mjs`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/examples/project-passport.mjs) | [Projections](projections.md) |

## What each route's output feeds

Imports and projections are separate from passport operations:

| Route | Output and next step |
|---|---|
| GS1 discovery | Link to a passport page or evidence. A [passport reader](../implement/roles/passport-reader.md) verifies the response against the scanned identifier. |
| EPCIS import | Retained source, per-event mapping result and possibly an unsigned SEAL. A separately authorised issuer may sign it and a [registry](../implement/roles/registry.md) may anchor it. Passport states remain untouched. |
| External credential verification | Shared-report findings: `externalCredentialProof`, `schema`, `credentialTime`, `credentialStatus`, `issuerAuthority` and `evidenceAvailability`. |
| Projection | Product view with its own digest for a passport page. |

Keep original sources and mapping results so participants can see what survived exchange. Agree representation and profile version with the receiving party before live exchange. The [interoperability profile schema](https://github.com/bsv-blockchain/dpp/blob/b245177be5efc8513e956ff110a69be53acc6d12/packages/dpp-profiles/schemas/interoperability-profile.schema.json) and [exchange source](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/exchange.md) define profile selection.

## Not available in this release

| Integration | Status and evidence |
|---|---|
| United Nations Transparency Protocol (UNTP) exchange | Proposed, outside this release. The published beta.4 [selection](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/selections/dpp-release-2026-10.json), now superseded by a candidate selecting the same claims, withholds `untp-0.7.0-pilot` with its reason. The [profile source](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/exchange) records the proposal. |
| European Standard (EN) 18223 serialisation and Union DPP Registry integration | Gaps in the [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json). An operator-supplied registration reference does not prove registration occurred. |

Next: open your route's page for its expected results and integration procedure.
