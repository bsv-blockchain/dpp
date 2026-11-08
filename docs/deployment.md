# The hosted reference

Readers, application teams and operators can use this page to select hosted services and verify sample records. The programme hosts one instance of each service for live lookups, reader tests and peering before you run your own. Check its access, versions and limits below.

For production, [choose your services](start/choose-components-and-services.md) and confirm provider access and operating commitments. This reference is no catalogue of generally available production providers. Public URLs and successful reads grant neither writes nor a service agreement.

[dpp.bsvb.net](https://dpp.bsvb.net) demonstrates the standard with mock brands, products and data; it serves no real products. Anyone can browse and verify its passports. Its three open sample brands write nothing to the blockchain. While publishing is open, anyone who signs up can create a brand whose passports are real BSV mainnet transactions marked as samples.

## Access and trust inputs

| Activity | Required input and source |
|---|---|
| Browse or read | Browser or HTTP client; public service URLs below need no read token. |
| Run the verification example | Node 22 or later and a [checkout after setup](quick-start.md#get-the-code), with `npm ci` and `npm run build`. Run from its root. A WhatsOnChain API key can be set as `WOC_API_KEY` if anonymous header checks are limited. |
| Write, deliver proofs or export | Destination-specific tokens from the operator, subject to the restrictions below. |
| Check policy or evidence signatures | Independently obtain the operator identity key; use the export signer and accepted anchoring key below for their respective checks. |

## Services

Read each service's `/capabilities` for what that deployment reports. The index and registry responses were checked on 28 October 2026 (UTC) after their redeployment; the application description reflects its 21 October deployment of the `dpp-release-2026-10-10` set, and the proof-page description remains the recorded operator information from 6 October. The application serves no capability document, and the registry response names a protocol rather than an implementation version. Reported capabilities do not establish operator identity or prove that a particular record is valid.

| Host | Serves | Runs |
|---|---|---|
| `https://dpp.bsvb.net` | The reference application: the brand console and, for every `/01/<gtin>/21/<serial>` it issued, the passport page that address leads a browser to | The `dpp-release-2026-10-10` set: `@bsv/dpp-protocol@0.3.0-beta.9`, `@bsv/dpp-profiles@0.3.0-beta.9`, `@bsv/dpp-overlay@0.4.0-beta.12` and `@bsv/dpp-credentials@0.2.0-beta.5` |
| `https://dpp-overlay.bsvb.net` | The index: `tm_dpp`, `tm_attestation` and the historical `tm_uora_dpp`, their lookups, `/history`, the bounded and complete exports, proof ingestion, the two synchronisation routes and its signed publisher policy | `@bsv/dpp-overlay@0.4.0-beta.12`, `single-operator@2` under publisher policy version 1, pulling all three topics from one peer run under the same administration, with discovery and advertising off |
| `https://dpp-resolver.bsvb.net` | The registry: claim validation, storage, anchoring and proofs | `attestation-registry/1` |
| `https://dpp-proof.bsvb.net` | The anchor proof page: the claims a registry holds, each compared with its anchor; the hosted registry unless you type another registry's address ([run your own](implement/roles/attestation-verifier.md#run-an-anchor-proof-page)) | A static page over a registry's showcase routes |

The index names peers statically. beta.12 supports opt-in discovery, advertising and left-behind retry, but discovery and advertising are off: capabilities report `static-peers` and unsupported `ship-slap-discovery`. The registry reports discovery and external credential policy as `not-configured`; its `resolver` hostname denotes this claim registry, not a hosted GS1 resolver.

## What is open and what needs a token

| Service | Route or operation | Access |
|---|---|---|
| Index | `POST /submit`, `POST /retract` | Operator's submit token |
| Index | `POST /arc-ingest` | Broadcaster's callback token |
| Index | `GET /evidence-export` | Export token |
| Index | Lookups, `/history`, `/capabilities`, `/publisher-policy`, `/evidence-package`, `/health`, synchronisation routes | Open |
| Registry | Store a claim or change a status list | Write token |
| Registry | Validation and reads | Open |

| Verification input | Value and use |
|---|---|
| Evidence-package and export-part signer | `02f8d12356e30c6063c4a666dcefb099d04369a3c41929687d04610fb1ec9c0116`; pass as `expectedSigner`. |
| Operator identity key | Establish independently to check a signed publisher policy, then check its key windows before announcing. |
| Publisher keys | The index admits public keys; it supplies no private countersigning capability. |

These are documented rules; the latest capability check did not exercise authenticated writes. Keep each token with its intended endpoint.

The operator does not distribute tokens for general use. To publish, [create an index](packages/create-dpp-index.md) or arrange access with a compatible provider. For a token or a hosted peer arrangement, [contact the programme](start/choose-your-path.md#contact-the-programme).

## Passports to try

Three live passports to look up with the [passport lookup](reference/contracts.md#find-passport-records):

| Passport | What it shows |
|---|---|
| `https://id.gs1.org/01/09506000134352/21/7AC18477503A` | A version 1 lineage of five states, repairs and a transfer |
| `https://id.gs1.org/01/09506000134352/21/345A8EAF501F` | A version 2 lineage: issue, update and a managed transfer, with three anchored claims |
| `https://dpp.bsvb.net/01/09522156492290/21/792B7797E3D8` | The newest shape: an identifier under the demonstration prefix 952 whose host leads a browser to the passport page. Its payload declares the draft `battery@4` |

Use these to test reading and verifying, not as payload examples. The first, a version 1 lineage under GS1's example GTIN, predates the demonstration `notice` rule and carries none; the other two carry one. None of their states satisfies the public schema of the profile it declares: each lacks required fields, such as `labelMeaning` and `separateCollectionSymbol`. A report made with the profiles package's payload validator reads `schema` as `fail` with `schema-invalid` for each of them, and one made without a validator reads `unknown`; every other check is unaffected ([the profiles package](packages/dpp-profiles.md#check-a-payload-against-its-profile)). Start your own payload from `node examples/sample-payload.mjs`.

To verify the first passport, run the existing reader from the checkout root:

```sh
node examples/verify-passport.mjs https://id.gs1.org/01/09506000134352/21/7AC18477503A https://dpp-overlay.bsvb.net
```

It reconstructs five states and should finish:

```text
The chain as a whole is valid.
Inclusion across the chain: verified.
```

This checks the supplied history, not freshness or profile validity. If header rate limits leave `inclusion pending`, retry or supply `WOC_API_KEY`.

## Where the hosted services fall short

The registry runs no GS1 resolver despite its `resolver` hostname: its capability document reads `"discovery": "not-configured"` and it serves no `/.well-known/gs1resolver`. A GS1-Conformant Resolver for the identifiers `dpp.bsvb.net` issued is being rolled out on that host, as [GS1 discovery](interoperability/gs1-discovery.md#do-you-need-a-resolver) recommends; until `https://dpp.bsvb.net/.well-known/gs1resolver` answers with a description file, expect that host to answer an identifier's path with its passport page whatever the `Accept` header asks for. The registry contract's `https://id.example.org` is a placeholder for the resolver origin a deployment configures, not a hosted service.

The application's check at `https://dpp.bsvb.net/verify` uses only the hosted index and accepts a state countersigned by any publisher key it names:

| Input or result | Behaviour |
|---|---|
| Full identifier under any host | Looks it up exactly as supplied. |
| Hostless `01/<gtin>/21/<serial>`, or an unfound address under one of the application's own hosts | Asks for every passport with that GS1 key under any host ([find passport records](reference/contracts.md#find-passport-records)). |
| One passport found | Checks that passport. |
| More than one host holds a passport | Lists them all and asks for the full address. |
| Passport only on your own index | Not found until the hosted index pulls from yours ([join the hosted reference](#join-the-hosted-reference)). Use your own reader as in step 1 of [build an application](packages/build-an-application.md). |
| Lifecycle claims | Not checked: the page reads no registry. Use the anchor proof page for claims. |

| Registry verification input | Requirement |
|---|---|
| Anchoring key | The capability document omits it. Every current anchor names `036564081bb854af4d049245f775f48495a5c4ffae830db5d3f1dbc05f9bf403e2` as `anchoredBy`. Accept that service key when checking claims, as `--anchoring-services` does for `examples/check-registry.mjs`; otherwise the verifier cannot establish which service wrote the anchor. |
| Anchor output and proof | Registry proofs omit `lockingScript`, `blockHeight` and `merklePath`. Read the output and merkle path from the chain, as `examples/check-registry.mjs` does. |

Every other known limit, of the hosted services and of the standard, is on [known limitations](operate/limitations.md).

## Overlays running now

The index below serves `tm_dpp`, `tm_attestation` and the historical `tm_uora_dpp`, which holds anchors in the format before the current one. Records move between two indexes only in the direction a node pulls, from the peers its operator names ([which way records flow](operate/federation.md#which-way-records-flow)).

| Index | Operator | Pulls from | Admits | Runs |
|---|---|---|---|---|
| `https://dpp-overlay.bsvb.net` | The programme, as the hosted reference | One peer run under the same administration, all three topics | States from `0325a17b2c87de853f7b2f54f82db80f49f189810379170693261dc6fa0a06da24`, the reference application, and `03c8850a79a6fba2ea48b9419d7490bae6b6dcf3521e1f75aa98ed4939d1cab89f`, a second application under the same administration; anchors from any anchoring service | `@bsv/dpp-overlay@0.4.0-beta.12`, `single-operator@2` |

Its one peer is run by the same administration, so the exchange between them demonstrates the mechanism, not separately administered operation.

## Join the hosted reference

Without operator involvement, anyone can read and verify held passports and anchors, fetch `GET /evidence-package` to [restore a passport's signed bounded package](operate/export-import-recovery.md#restore-a-passport-from-the-bounded-package) into their index, or pull records by naming the reference in `SYNC_PEERS` ([federation](operate/federation.md)).

Everything else is a setting only the reference's operator holds. Ask for it through the [contact form](start/choose-your-path.md#contact-the-programme), with what the table says to send:

| You want | The operator changes | Send |
|---|---|---|
| The reference to receive your records | Names your index in its `SYNC_PEERS` | Your index's public URL |
| The reference to admit your states | Adds your publisher key to its signed publisher policy, with an activation window | Your publisher key, and the timestamp of your oldest state, so the window covers it |
| The reference to hold the proofs of states it took from you | Gives you a callback token for its `POST /arc-ingest` | The address your proofs come from |
| A complete export of the reference's records | Gives you an export token for the time you need it | What you need it for and for how long |
| To know why one of your records did not arrive | Reads its log for that output | The transaction identifier and output index |

The programme decides each request as the reference's operator: it is an arrangement with one operator, not something the standard grants. Each token is one shared secret, so a token given to you is replaced once you no longer need it ([known limitations](operate/limitations.md#index-host)). Until indexes can advertise themselves and accept proofs without a token, joining any other operator takes the same arrangements ([known limitations](operate/limitations.md#synchronisation)).
