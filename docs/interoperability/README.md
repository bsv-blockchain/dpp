# Choose an interoperability profile

This page is for teams whose existing systems already speak GS1 Digital Link, EPCIS or W3C Verifiable Credentials, or hold product data split by model, batch and item, and who want to connect them to passports. Find the row for what you already have: each route has a runnable example and a page, and none of them writes a passport state.

| You already have | What the route does | Profile | What the packages do | Example | Page |
|---|---|---|---|---|---|
| GS1 barcodes, or a GS1 resolver | Lets a scanned code lead to a passport and its evidence | `gs1-digital-link@1` | Parse and decompress Digital Links; build and read linksets (`@bsv/dpp-profiles`) | [`resolve-digital-link.mjs`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/examples/resolve-digital-link.mjs) | [GS1 discovery](gs1-discovery.md) |
| An EPCIS 2.0 event repository | Keeps supply-chain events, unchanged, as evidence beside a passport, and maps them to credentials | `epcis-json@1` to import, `epcis-vsc@1` to map | Parse, validate and map; never sign (`@bsv/vsc`) | [`import-epcis.mjs`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/examples/import-epcis.mjs) | [EPCIS source exchange](epcis.md) |
| Credentials from other issuers (VC Data Model 2.0, `did:web`) | Verifies them and folds the result into the passport report | `vc-di-ecdsa-rdfc-2019@1` | Verify only; there is no issuance (`@bsv/vsc/exchange`) | [`verify-external-credential.mjs`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/examples/verify-external-credential.mjs) | [External credentials](external-credentials.md) |
| Product data by model, batch and item | Computes a reproducible product view for a passport page | None: a projection is a data document, not an exchange profile | Project and check the digest (`@bsv/dpp-profiles`) | [`project-passport.mjs`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/examples/project-passport.mjs) | [Projections](projections.md) |

Each example runs with `node examples/<name>.mjs` at the root of a checkout, after [setup](../quick-start.md#get-the-code), and needs no network or wallet.

## What each route's output feeds

An import or projection is separate from a passport operation:

- **GS1 discovery** finds where a passport's page and evidence live. Its output is a link; a [passport reader](../implement/roles/passport-reader.md) then verifies what that link serves, against the identifier the scan gave.
- **EPCIS import** produces a retained source document and, per event, a mapping result and possibly an unsigned SEAL credential. A separately authorised issuer may sign that credential and a [registry](../implement/roles/registry.md) may anchor it; the passport's own states are untouched.
- **External credential verification** produces findings for the shared passport report: `externalCredentialProof`, `schema`, `credentialTime`, `credentialStatus`, `issuerAuthority` and `evidenceAvailability`.
- **A projection** produces a product view with its own digest, for a passport page.

Keep the original source and the mapping result, so another participant can see what survived the exchange, and agree the representation and profile version with the receiving party before exchanging live data. The [interoperability profile schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/schemas/interoperability-profile.schema.json) and [exchange source](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/exchange.md) define how a profile is selected.

## Not available in this release

The United Nations Transparency Protocol (UNTP) exchange profile is proposed but not part of this release: the [release selection](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/selections/dpp-release-2026-10.json) lists its claim, `untp-0.7.0-pilot`, as withheld with the reason, and its [profile source](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/manifests/exchange) records the proposal.

European Standard (EN) 18223 serialisation and Union DPP Registry integration remain gaps in the [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json). An operator-supplied registration reference is not evidence that registration occurred.

Next: open the page for your row in the table above.
