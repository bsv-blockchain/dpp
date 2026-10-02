# The hosted reference

The programme hosts one instance of each service, so you can look up and verify live records, test a reader, or use the hosted index as a peer before you run your own. This page says what each one runs, what is open to anyone, which passports to try and where the hosted services fall short.

[dpp.bsvb.net](https://dpp.bsvb.net) is a demonstration of the standard, not a service for real products. Anyone can browse it and verify its passports, and anyone who signs up can issue and update passports there for its sample brands. Every passport it writes is a real transaction on the BSV mainnet, but the brands, products and data are mock demonstration data.

## Services

Each service's `/capabilities` answer is authoritative; the table records what they ran on 30 September 2026.

| Host | Serves | Runs |
|---|---|---|
| `https://dpp.bsvb.net` | The reference application: the brand console and a passport page at every `/01/<gtin>/21/<serial>` it issued | The beta.2 packages |
| `https://dpp-overlay.bsvb.net` | The index: `tm_dpp` and `tm_attestation`, their lookups, `/history`, the bounded and complete exports, proof ingestion and the two synchronisation routes | `@bsv/dpp-overlay-topics@0.4.0-beta.3`, `single-operator@1` under publisher policy version 1, pulling from one peer run under the same administration |
| `https://dpp-resolver.bsvb.net` | The attestation registry: validation, storage, anchoring and proofs | `attestation-registry/1` |
| `https://dpp-proof.bsvb.net` | The anchor proof page: the claims a registry holds, each compared with its anchor; the hosted registry unless you type another registry's address ([run your own](implement/roles/attestation-verifier.md#run-an-anchor-proof-page)) | A static page over a registry's showcase routes |

## What is open and what needs a token

On the index, `POST /submit` and `POST /retract` need the operator's submit token, `POST /arc-ingest` needs the broadcaster's callback token and `GET /evidence-export` needs the export token. The index signs its evidence packages and export parts with `02f8d12356e30c6063c4a666dcefb099d04369a3c41929687d04610fb1ec9c0116`; pass it as `expectedSigner` when you check one. Lookups, `/history`, `/capabilities`, `/evidence-package`, `/health` and the synchronisation routes are open. On the registry, storing a claim and changing a status list need its write token; validation and reads are open.

The tokens belong to the hosted reference's operator and are not handed out for general use: to publish your own passports, [run your own index](operate/README.md). To ask for a token or for the hosted index to name yours as a peer, [contact the programme](start/choose-your-path.md#contact-the-programme).

## Passports to try

Three live passports to look up with the [passport lookup](reference/contracts.md#find-passport-records):

| Passport | What it shows |
|---|---|
| `https://id.gs1.org/01/09506000134352/21/7AC18477503A` | A version 1 lineage of five states, repairs and a transfer |
| `https://id.gs1.org/01/09506000134352/21/345A8EAF501F` | A version 2 lineage: issue, update and a managed transfer, with three anchored claims |
| `https://dpp.bsvb.net/01/09522156492290/21/792B7797E3D8` | The newest shape: an identifier under the demonstration prefix 952 whose host answers with the passport page. Its payload declares the draft `battery@4` |

Use these to test reading and verifying, not as payload examples. The first, a version 1 lineage under GS1's example GTIN, predates the demonstration `notice` rule and carries none; the other two carry one. None of their states satisfies the public schema of the profile it declares: each lacks required fields, such as `labelMeaning` and `separateCollectionSymbol`. They still verify because the report does not check a payload against its profile; check payloads yourself, as the [profiles package](packages/dpp-profiles.md#check-a-payload-against-its-profile) shows, and start your own from `node examples/sample-payload.mjs`.

## Where the hosted services fall short

None of the three runs a GS1 resolver. No host serves `/.well-known/gs1resolver`, the registry's capability document reads `"discovery": "not-configured"`, and `dpp.bsvb.net` answers an identifier's path with its passport page whatever the `Accept` header asks for. The registry contract's `https://id.example.org` is a placeholder for the resolver origin a deployment configures, not a hosted service.

The application's check at `https://dpp.bsvb.net/verify` reads only identifiers under `dpp.bsvb.net` and `id.gs1.org` for now: it drops the host from the identifier it is given and looks the path up under those two. A passport minted under another host, which the [identifiers page](identifiers.md) tells a second writer to use, reads as not found there even when the index holds it. Check such a passport with a reader of your own, as step 1 of [build an application](packages/build-an-application.md) shows.

Every other known limit, of the hosted services and of the standard, is on [known limitations](operate/limitations.md).

## Overlays running now

The index below serves `tm_dpp` and `tm_attestation`. Records move between two indexes only in the direction a node pulls, from the peers its operator names ([which way records flow](operate/federation.md#which-way-records-flow)).

| Index | Operator | Pulls from | Admits states from | Runs |
|---|---|---|---|---|
| `https://dpp-overlay.bsvb.net` | The programme, as the hosted reference | One peer run under the same administration | `0325a17b2c87de853f7b2f54f82db80f49f189810379170693261dc6fa0a06da24`, the reference application; `03c8850a79a6fba2ea48b9419d7490bae6b6dcf3521e1f75aa98ed4939d1cab89f`, a second application under the same administration | `@bsv/dpp-overlay-topics@0.4.0-beta.3`, `single-operator@1` |

Its one peer is run by the same administration, so the exchange between them demonstrates the mechanism, not separately administered operation.

## Join the hosted reference

Without its operator, anyone can read and verify every passport and anchor the hosted reference holds, take a passport's signed evidence package from `GET /evidence-package` and restore it into their own index ([restore from the bounded package](operate/export-import-recovery.md#restore-a-passport-from-the-bounded-package)), and pull the reference's records into their own index by naming it in `SYNC_PEERS` ([federation](operate/federation.md)).

Everything else is a setting only the reference's operator holds. Ask for it through the [contact form](start/choose-your-path.md#contact-the-programme), with what the table says to send:

| You want | The operator changes | Send |
|---|---|---|
| The reference to receive your records | Names your index in its `SYNC_PEERS` | Your index's public URL |
| The reference to admit your states | Adds your publisher key to its signed publisher policy, with an activation window | Your publisher key, and the timestamp of your oldest state, so the window covers it |
| The reference to hold the proofs of states it took from you | Gives you a callback token for its `POST /arc-ingest` | The address your proofs come from |
| A complete export of the reference's records | Gives you an export token for the time you need it | What you need it for and for how long |
| To know why one of your records did not arrive | Reads its log for that output | The transaction identifier and output index |

The programme decides each request as the reference's operator: it is an arrangement with one operator, not something the standard grants. Each token is one shared secret, so a token given to you is replaced once you no longer need it ([known limitations](operate/limitations.md#index-host)). Until indexes can advertise themselves and accept proofs without a token, joining any other operator takes the same arrangements ([known limitations](operate/limitations.md#synchronisation)).
