# Reference deployment

The [operator start](operate/README.md) runs the supplied Compose preset. It is a reference arrangement. Where the hosted index runs in the long term is still open: today it is a standalone container, and an implementer reaches it by its URL either way.

## The hosted reference

The programme runs one instance of each service. Use them to look up and verify live records, to test a reader, or as a peer. Each service's `/capabilities` answer is authoritative; the table records what they ran on 28 September 2026.

| Host | Serves | Runs |
|---|---|---|
| `https://dpp.bsvb.net` | The reference application: the brand console and a passport page at every `/01/<gtin>/21/<serial>` it issued | The beta.2 packages |
| `https://dpp-overlay.bsvb.net` | The index: `tm_dpp` and `tm_attestation`, their lookups, `/history`, the bounded and complete exports, proof ingestion and the two synchronisation routes | `@bsv/dpp-overlay-topics` 0.4.0-beta.3, `single-operator@1` under publisher policy version 1 |
| `https://dpp-resolver.bsvb.net` | The attestation registry: validation, storage, anchoring and proofs | `attestation-registry/1` |

On the index, `POST /submit` and `POST /retract` need the operator's submit token, `POST /arc-ingest` needs the broadcaster's callback token and `GET /evidence-export` needs the export token. The index signs its evidence packages and export parts with `02f8d12356e30c6063c4a666dcefb099d04369a3c41929687d04610fb1ec9c0116`; pass it as `expectedSigner` when you check one. Lookups, `/history`, `/capabilities`, `/evidence-package`, `/health` and the synchronisation routes are open. On the registry, storing a claim and changing a status list need its write token; validation and reads are open.

Three live passports to look up with the [passport lookup](reference/contracts.md#find-passport-records):

| Passport | What it shows |
|---|---|
| `https://id.gs1.org/01/09506000134352/21/7AC18477503A` | A version 1 lineage of five states, repairs and a transfer |
| `https://id.gs1.org/01/09506000134352/21/345A8EAF501F` | A version 2 lineage: issue, update and a managed transfer, with three anchored claims |
| `https://dpp.bsvb.net/01/09522156492290/21/792B7797E3D8` | The newest shape: an identifier under the demonstration prefix 952 whose host answers with the passport page |

## Place each component

The reference deployment contains an index and MongoDB. A client or application service supplies wallet operations, submits records and asks the index for evidence. An attestation registry is a separate service. A header source supplies the block-header evidence used for inclusion checks.

The index holds the publisher's public identity key. A writer's wallet holds signing access. An optional export key signs the archive produced by this operator; it does not sign passport states. Keep those roles separate when configuring a deployment.

## Deploy in steps

Start the index using [the Compose instructions](operate/README.md), check its capabilities and make a lookup. Next connect a writer on the same network and under the expected publisher policy. Exercise admission, broadcast response and later proof ingestion before relying on the record being retrievable with inclusion evidence.

Add a registry only when the workflow needs stored claims. Add peers after one operator can admit, retrieve and export the intended records. [Federation](operate/federation.md) covers the second instance and [recovery](operate/export-import-recovery.md) covers the retained evidence needed to replace one.

The MongoDB volume is service storage; it is not itself an independently administered replica. Header-storage size, mining delay and synchronisation latency are unmeasured here.

## Configuration sources

| Configure | Source |
|---|---|
| Index and database containers | [Compose preset](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/deploy/compose.yml) |
| Environment and policy files | [Environment example](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/deploy/operator.env.example), [host configuration](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/packages/overlay-topics/src/index.ts) |
| Wallet, broadcast and proof retrieval | [Integration guide](operate/wallet-broadcast-proofs.md) |
| Another operator | [Federation](operate/federation.md) |
| Retention and replacement provider | [Recovery](operate/export-import-recovery.md) |

Check health and capabilities after starting the service, then exercise submission and retrieval under the selected contract. Keep the observed results separate from the deployment's configuration.

Header-storage size, mining delay and synchronisation latency are unmeasured here. The [ledger](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/conformance/manifest.json) records local tests and the remaining deployment evidence gaps. [Durable publication](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/conformance/manifest.json#L3769) has ledger status `gap`.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](learn/identity-and-authority.md).
