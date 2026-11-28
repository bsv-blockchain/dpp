# The hosted reference

Readers, application teams and operators can use this page to select hosted services and verify sample records. The programme hosts a mainnet reference application and registry, a mainnet index for their records and separate testnet and mainnet indexes for registering applications. Check its access, versions and limits below.

For production, [choose your services](start/choose-components-and-services.md) and confirm provider access and operating commitments. This reference is no catalogue of generally available production providers. Public URLs and successful reads grant neither writes nor a service agreement.

[dpp.bsvb.net](https://dpp.bsvb.net) demonstrates the standard with mock brands, products and data; it serves no real products. Anyone can browse and verify its passports. Its three open sample brands write nothing to the blockchain. While publishing is open, anyone who signs up can create a brand whose passports are real BSV mainnet transactions marked as samples.

## Access and trust inputs

| Activity | Required input and source |
|---|---|
| Browse or read | Browser or HTTP client; public service URLs below need no read token. |
| Run the verification example | Node 22 or later and a [checkout after setup](quick-start.md#get-the-code), with `npm ci` and `npm run build`. Run from its root. A WhatsOnChain API key can be set as `WOC_API_KEY` if anonymous header checks are limited. |
| Write, deliver proofs or export | For the November indexes, register your publisher key to obtain its two write tokens. The reference index has separate access arrangements. [Registration and operator keys](#registration-and-operator-keys) |
| Check policy or evidence signatures | Independently obtain the operator identity key; use the export signer and accepted anchoring key below for their respective checks. |

## Services

Read each service's `/capabilities` for what that deployment reports. The three indexes were checked on 26 November 2026 (UTC). The registry response was checked on 28 October 2026 (UTC). The application description reflects its 21 October deployment of the `dpp-release-2026-10-10` set, and the proof-page description remains the recorded operator information from 6 October. The application serves no capability document, and the registry response names a protocol rather than an implementation version. Reported capabilities do not establish operator identity or prove that a particular record is valid.

| Host | Serves | Runs |
|---|---|---|
| `https://dpp.bsvb.net` | The reference application: the brand console, a GS1-Conformant Resolver at `/01/...` for the identifiers it issued, and each passport page at `/passport/01/<gtin>/21/<serial>` | The `dpp-release-2026-10-10` set: `@bsv/dpp-protocol@0.3.0-beta.9`, `@bsv/dpp-profiles@0.3.0-beta.9`, `@bsv/dpp-overlay@0.4.0-beta.12` and `@bsv/dpp-credentials@0.2.0-beta.5` |
| `https://dpp-overlay.bsvb.net` | The index: `tm_dpp`, `tm_attestation` and the historical `tm_uora_dpp`, their lookups, `/history`, the bounded and complete exports, proof ingestion, the two synchronisation routes and its signed publisher policy | `@bsv/dpp-overlay@0.4.0-beta.12`, `single-operator@2` under publisher policy version 1, pulling all three topics from one peer run under the same administration, with discovery and advertising off |
| `https://dpp-overlay-testnet.bsvb.net` | BSV testnet, open registration for state publishers | `@bsv/dpp-overlay@0.4.0-beta.13`, `managed-custody@2` |
| `https://dpp-overlay-mainnet.bsvb.net` | BSV mainnet, registration subject to operator approval | `@bsv/dpp-overlay@0.4.0-beta.13`, `managed-custody@2` |
| `https://dpp-resolver.bsvb.net` | The registry: claim validation, storage, anchoring and proofs | `attestation-registry/1` |
| `https://dpp-proof.bsvb.net` | The anchor proof page: the claims a registry holds, each compared with its anchor; the hosted registry unless you type another registry's address ([run your own](implement/roles/attestation-verifier.md#run-an-anchor-proof-page)) | A static page over a registry's showcase routes |

The beta.12 reference index names peers statically. beta.12 supports opt-in discovery, advertising and left-behind retry, but discovery and advertising are off: capabilities report `static-peers` and unsupported `ship-slap-discovery`. The registry reports discovery and external credential policy as `not-configured`; its `resolver` hostname denotes this claim registry, not a hosted GS1 resolver.

## Registration and operator keys

Use the testnet or mainnet beta.13 host above with a starter that writes `managed-custody@2`. Check the network at `GET /health` and the custody profile and registration mode at `GET /capabilities`. The published starter, `@bsv/create-dpp-app@0.1.0-beta.2`, is one. The earlier beta.1 starter writes `managed-custody@1` and uses different setup. [Starter network setup](packages/create-dpp-app.md#run-on-testnet-or-mainnet)

The November starter’s `npm run go-live` sends a wallet-signed `POST /register` request. Testnet returns HTTP 201 and two credentials on acceptance. Mainnet returns HTTP 202 for a new request. After operator approval, run the command again to sign a fresh request and collect the credentials. Each host accepts up to ten registration requests per source address per hour and returns HTTP 429 above that limit.

Registration admits the key to publish states on that index. Keep the submit token for `POST /submit` and `POST /retract` and the callback token for `POST /arc-ingest`. The operator separately selects anchoring services. Both beta.13 hosts reported bounded evidence packages and complete exports unavailable at the check date. Registration carries no service or retention commitment.

| Network | Policy operator | Public identity key |
|---|---|---|
| Testnet | BSV Blockchain | `027c509b2252910db65734fddecb54387f2e89e33e0ed8f13248cfd0f58643209e` |
| Mainnet (beta.13) | BSV Blockchain Mainnet | `022b577299011ad5e0b25600a83bc72839474a05fef6a09da8949cc7e6b84192e7` |

Use the key for the selected network with `verifyPolicyChain` from `@bsv/dpp-protocol` to verify the response from `GET /publisher-policy`. Versions 1 to 3 on each host verified against its configured operator key on 26 November 2026 (UTC). The operator can run `dpp-index registrations revoke --publisher <key>` to retire a publisher in a new signed policy version and revoke its tokens. Earlier signed policy versions retain the publisher’s admission history. [Index configuration](operate/README.md#what-to-prepare)

## What is open and what needs a token

The index entries in the following tables apply to the beta.12 reference at `dpp-overlay.bsvb.net`. Use that index for the existing reference application’s passports. On the check date, the beta.12 index returned 14 history entries across the four sample passports listed below. The beta.13 mainnet index returned an empty history for each. Its policy listed a different set of state publishers.

| Service | Route or operation | Access |
|---|---|---|
| Index | `POST /submit`, `POST /retract` | Operator's submit token |
| Index | `POST /arc-ingest` | Broadcaster's callback token |
| Index | `GET /evidence-export` | Export token |
| Index | Lookups, `/history`, `/capabilities`, `/publisher-policy`, `/evidence-package`, `/health`, synchronisation routes | Open |
| Registry | Store a claim or register a certification | Write token |
| Registry | Validation and reads | Open |

| Verification input | Value and use |
|---|---|
| Evidence-package and export-part signer | `02f8d12356e30c6063c4a666dcefb099d04369a3c41929687d04610fb1ec9c0116`, the raw key of the release the index runs; pass as `expectedSigner`. From the November release an index signs each passport's packages with the child of its exporter identity key, named as `exporterIdentityKey` in its capability document; packages signed with this key still inspect with it. |
| Operator identity key | Establish independently to check a signed publisher policy, then check its key windows before announcing. |
| Publisher keys | The index admits public keys; it supplies no private countersigning capability. |

These are documented rules; the latest capability check did not exercise authenticated writes. Keep each token with its intended endpoint.

The beta.12 reference operator does not distribute tokens for general use. To publish, [run your own index](operate/README.md) or arrange access with a compatible provider. For a token or a hosted peer arrangement, [contact the programme](start/choose-your-path.md#contact-the-programme).

## Run the same services yourself

The reference application uses the October packages. The registration indexes run the November overlay, `0.4.0-beta.13`. The same index is delivered two ways, as the npm package `@bsv/dpp-overlay` with its `dpp-index` command and as the `dpp-overlay` image, and they are the same runtime.

| You want | Use | Leaves out |
|---|---|---|
| The record library only | `@bsv/dpp-protocol` from npm | Every other package, any database and the validator service |
| An index in your own host | `@bsv/dpp-overlay` from npm | The validator service and its engine libraries |
| An index as an operator | The [Compose preset](operate/README.md), starting the `overlay` service by name | The validator service |
| An index and a validator service | The whole [Compose preset](operate/README.md) | Your application, which calls both over the network |

The preset pulls each image by digest. The images of the current set are not published yet, so today the preset [builds them from source](operate/README.md#build-from-source). The preset's database is MongoDB Community Server under the Server Side Public License, which is not this repository's licence ([the operator preset](contribute/licence.md#the-operator-preset)).

## Passports to try

Two live passports to look up with the [passport lookup](reference/contracts.md#find-passport-records). Each identifier is under the demonstration prefix 952 at `dpp.bsvb.net`, a host that resolves it: a 307 to the passport page, or the linkset on request.

| Passport | What it shows |
|---|---|
| `https://dpp.bsvb.net/01/09529530005688/21/E18E296BB180` | A version 2 lineage: issue, a repair and a managed transfer, with three anchored claims. Its payload declares the draft `textile@4`, retired from 14 November 2026 |
| `https://dpp.bsvb.net/01/09522156492290/21/792B7797E3D8` | A version 2 lineage: issue and two updates recording installation and a firmware repair, with three anchored claims. Its payload declares the draft `battery@4`, retired from the same day |

Use these to test reading and verifying, not as payload examples. Both carry the demonstration `notice`, and both declare a profile that is retired ([retired profiles](profiles/README.md#retired-profiles)). They stay on chain as written. A report made with the November profiles package's payload validator reads `schema` as `unknown` with `schema-unavailable` and the cause `profile-retired` for each of them, never `pass` and never `fail`, and one made without a validator reads `unknown` as well; every other check is unaffected ([the profiles package](packages/dpp-profiles.md#retired-profiles)). Start your own payload from `node examples/sample-payload.mjs general@2`, or from a product document under `eu-battery@2` or `eu-textile@2` ([EU battery and textile bindings](profiles/eu-sector-bindings.md)).

To verify the first passport, run the existing reader from the checkout root:

```sh
node examples/verify-passport.mjs https://dpp.bsvb.net/01/09529530005688/21/E18E296BB180 https://dpp-overlay.bsvb.net
```

It reconstructs three states and should finish:

```text
The chain as a whole is valid.
Inclusion across the chain: verified.
```

This checks the supplied history, not freshness or profile validity. If header rate limits leave `inclusion pending`, retry or supply `WOC_API_KEY`.

### Legacy identifiers

The hosted index also holds passports minted before the demonstration prefix rule, under `https://id.gs1.org/01/09506000134352/`. That GTIN is GS1's own documentation example, not a demonstration number, and `id.gs1.org` answers these identifiers with a 307 to a product page of GS1's fictitious demonstration brand, never to a passport. Their states cannot be withdrawn, so they stay readable. Use them only to test a reader against older records, such as a version 1 lineage, and never as the pattern for a new identifier ([identifiers](identifiers.md)):

| Legacy passport | What it shows |
|---|---|
| `https://id.gs1.org/01/09506000134352/21/7AC18477503A` | A version 1 lineage of five states, repairs and a transfer, from before the demonstration `notice` rule |
| `https://id.gs1.org/01/09506000134352/21/345A8EAF501F` | A version 2 lineage: issue, update and a managed transfer, with three anchored claims |

## Where the hosted services fall short

The registry runs no GS1 resolver despite its `resolver` hostname: its capability document reads `"discovery": "not-configured"` and it serves no `/.well-known/gs1resolver`. The hosted application at `dpp.bsvb.net` is the GS1-Conformant Resolver for the identifiers minted under that host, as [GS1 discovery](interoperability/gs1-discovery.md#do-you-need-a-resolver) recommends: it publishes `/.well-known/gs1resolver`, answers an identifier with a 307 to its passport page at `/passport/01/<gtin>/21/<serial>`, the item's `gs1:dpp` default, and answers `Accept: application/linkset+json` with the JSON linkset. On 8 November 2026 it passed the checks of GS1's resolver test suite 1.2.1 for `/01/09522156492290/21/792B7797E3D8` except the trailing-slash form, which the suite only warns about. Since then it answers that path with a trailing slash as it answers the path without one, and decodes a compressed Digital Link that carries an EPC binary string, both observed on 22 November 2026; GS1's general Digital Link compression is not decoded. The registry contract's `https://id.example.org` is a placeholder for the resolver origin a deployment configures, not a hosted service.

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

The beta.12 reference index below serves `tm_dpp`, `tm_attestation` and the historical `tm_uora_dpp`, which holds anchors in the format before the current one. Records move between two indexes only in the direction a node pulls, from the peers its operator names ([which way records flow](operate/federation.md#which-way-records-flow)).

| Index | Operator | Pulls from | Admits | Runs |
|---|---|---|---|---|
| `https://dpp-overlay.bsvb.net` | The programme, as the hosted reference | One peer run under the same administration, all three topics | States from `0325a17b2c87de853f7b2f54f82db80f49f189810379170693261dc6fa0a06da24`, the reference application, and `03c8850a79a6fba2ea48b9419d7490bae6b6dcf3521e1f75aa98ed4939d1cab89f`, a second application under the same administration; anchors from any anchoring service | `@bsv/dpp-overlay@0.4.0-beta.12`, `single-operator@2` |

Its one peer is run by the same administration, so the exchange between them demonstrates the mechanism, not separately administered operation.

## Join the hosted reference

To request a listing for another provider on this page, send the programme your public index URL, network, operator identity and access terms through the [programme contact form](start/choose-your-path.md#contact-the-programme). A listing and a peering arrangement are separate requests.

On the beta.12 reference, anyone can read and verify held passports and anchors, fetch `GET /evidence-package` to [restore a passport's signed bounded package](operate/export-import-recovery.md#restore-a-passport-from-the-bounded-package) into their index, or pull records by naming the reference in `SYNC_PEERS` ([federation](operate/federation.md)).

For these arrangements, send the beta.12 reference operator the details in the table through the [contact form](start/choose-your-path.md#contact-the-programme).

| You want | The operator changes | Send |
|---|---|---|
| The reference to receive your records | Names your index in its `SYNC_PEERS` | Your index's public URL |
| The reference to admit your states | Adds your publisher key to its signed publisher policy, with an activation window | Your publisher key, and the timestamp of your oldest state, so the window covers it |
| The reference to hold the proofs of states it took from you | Gives you a callback token for its `POST /arc-ingest` | The address your proofs come from |
| A complete export of the reference's records | Gives you an export token for the time you need it | What you need it for and for how long |
| To know why one of your records did not arrive | Reads its log for that output | The transaction identifier and output index |

The programme decides each request as the reference's operator: it is an arrangement with one operator, not something the standard grants. Each token is one shared secret, so a token given to you is replaced once you no longer need it ([known limitations](operate/limitations.md#index-host)). Until indexes can advertise themselves and accept proofs without a token, joining any other operator takes the same arrangements ([known limitations](operate/limitations.md#synchronisation)).
