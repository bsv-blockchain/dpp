# Export, import and recovery

Index operators and teams replacing a provider can use this guide to back up an index or restore one passport's evidence to a replacement. Choose the archive below, restore it, then verify what it recovered.

## Recovery prerequisites

| Procedure | Inputs and where to get them |
|---|---|
| Whole-index backup or restore | Operator access to the Docker host, the Compose checkout and its `deploy/operator.env`; an empty destination volume for restoration |
| Passport restoration, either route | Passport identifier and source URL from the publisher; replacement URL and submit token from its operator; a built [checkout](../quick-start.md#get-the-code) or the package specified below |
| Trust and admission, either route | Export signer from the source operator; replacement settings that admit the passport's publisher keys through `SERVICE_IDENTITY_KEY` or a [signed publisher policy](federation.md#3-sign-a-publisher-policy) |
| Bounded package | Source index with an export key; no source token. Use only for a passport with no more than 500 states. |
| Complete export | Source index's `EXPORT_TOKEN` and export signer from [enable exports](#enable-exports-on-your-index). The hosted token is not public; its operator names recipients [on request](../deployment.md#join-the-hosted-reference). |

## What each archive recovers

| Archive | What it holds | What it lacks | Who can fetch it |
|---|---|---|---|
| A backup of the index's MongoDB volume | Everything the index admitted: outputs, transactions, the passport and anchor indexes and the synchronisation checkpoints | Keys, registry claims, restricted tiers | The operator, on the host |
| The bounded package, `GET /evidence-package` | One passport's newest 500 states: each raw transaction, its BEEF with the merkle path once the index has one, the publisher policy chain, spend observations and a report, inventoried in a signed manifest | States beyond the newest 500, which it declares absent; restricted tiers | Anyone, from an index that sets `EXPORT_SIGNING_KEY` (otherwise 503) |
| The complete export, `GET /evidence-export` | Every state of one passport, in signed parts over one snapshot | Restricted tiers; the report, which the reader produces over the joined parts | Anyone holding the source index's `EXPORT_TOKEN` when it sets one. The hosted reference sets one and does not give it to outsiders, so use this route on your own index or ask the source operator |
| A registry export | The claims a registry holds and their evidence, under the [registry contract](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/registry.yaml) | Token history, restricted material, keys | Depends on the registry |
| The custody keys | The ability to spend or update the passport, which restoring public evidence does not recover | | Only their holder: no export recovers a lost key |

| Term or limit | Meaning |
|---|---|
| BEEF | Encoding of a transaction, its ancestors and their proofs; [words you will meet](../README.md#words-you-will-meet) defines a proof |
| Snapshot | Point in the index's history fixed by an export's first request |
| Snapshot lifetime | Ten minutes: `limits.historySnapshotTtlSeconds` is `600` in the capability document |
| Coverage record | Signed statement in each complete-export part naming the passport, snapshot, part index, sequence range and final-part status |

## Back up and restore a whole index

The Compose preset backs up its MongoDB volume. Its [restart, back up and restore recipe](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/deploy/README.md#restart-back-up-restore) uses these steps from the checkout root:

1. Stop the index so files cannot change during copying.
2. Copy the volume to `mongo-data.tgz`.
3. Start the index again:

```sh
docker compose -f deploy/compose.yml --env-file deploy/operator.env stop
docker run --rm -v dpp-overlay_mongo-data:/data -v "$PWD":/out mongo:7 tar czf /out/mongo-data.tgz /data
docker compose -f deploy/compose.yml --env-file deploy/operator.env start
```

### Restore and verify the volume

1. Stop the destination index. Prepare an empty volume before its first start.
2. Extract `mongo-data.tgz`, restoring the archived contents of `/data` to the empty volume's root. The first preset uses `dpp-overlay_mongo-data`; the second uses `dpp-overlay-b_mongo-b-data`.
3. Start the index with the corresponding preset and environment file.
4. Look up retained passports and follow [check the result](#check-the-result). Stop if the recovered history or evidence differs unexpectedly.

A volume backup is not a copy another operator can check. Hand over a package or export for that purpose.

## Enable exports on your index

The export signing key identifies the index that assembled a package. It is the index's own private key, never the publisher key, and establishes nothing about admission. Neither export route works without it.

1. Generate the key from the checkout root:

```sh
node --input-type=module -e "import { PrivateKey } from '@bsv/sdk'; const key = PrivateKey.fromRandom(); console.log('EXPORT_SIGNING_KEY=' + key.toHex()); console.log('export signer: ' + key.toPublicKey().toString())"
```

2. Put the first line in `deploy/operator.env`. Add `EXPORT_TOKEN=` followed by a secret from `openssl rand -hex 32`; without `EXPORT_TOKEN`, anyone can fetch the complete export.
3. Apply both with `docker compose -f deploy/compose.yml --env-file deploy/operator.env up -d`.
4. Check `GET /capabilities`: under `limits`, expect `"evidencePackageExport": "available"` and `"evidenceExport": "bearer"`.

5. Publish the second line, the export signer, where readers can find it. They pass it as `expectedSigner`; the capability document does not carry it yet. The [hosted reference page](../deployment.md) lists its signer as `02f8d12356e30c6063c4a666dcefb099d04369a3c41929687d04610fb1ec9c0116`.

## Restore a passport from the bounded package

The hosted reference supports this route. Its passports require the replacement to admit `0325a17b2c87de853f7b2f54f82db80f49f189810379170693261dc6fa0a06da24` and `03c8850a79a6fba2ea48b9419d7490bae6b6dcf3521e1f75aa98ed4939d1cab89f`.

1. Save this as `restore-package.mjs` at the checkout root, or in a project with the [protocol candidate archive](../packages/README.md#use-the-renamed-source-candidate) installed:

```js
// Copy one passport from an index's bounded evidence package into another index.
import { inspectEvidencePackage } from '@bsv/dpp-protocol'

const source = process.env.SOURCE_INDEX ?? 'https://dpp-overlay.bsvb.net'
const replacement = process.env.REPLACEMENT_INDEX ?? 'http://localhost:8080'
const passportId = process.env.PASSPORT_ID ?? 'https://id.gs1.org/01/09506000134352/21/7AC18477503A'
// The key the source index signs its packages with. This default is the hosted reference's.
const expectedSigner = process.env.EXPORT_SIGNER ?? '02f8d12356e30c6063c4a666dcefb099d04369a3c41929687d04610fb1ec9c0116'

const response = await fetch(`${source}/evidence-package?${new URLSearchParams({ passportId })}`)
if (!response.ok) throw new Error(`GET /evidence-package answered ${response.status}: ${await response.text()}`)
const envelope = await response.json()
const files = new Map(Object.entries(envelope.files).map(([path, b64]) => [path, [...Buffer.from(b64, 'base64')]]))

const inspection = inspectEvidencePackage(envelope.manifest, files, { expectedPassportId: passportId, expectedSigner })
if (inspection.failures.length > 0) throw new Error(`package refused: ${inspection.failures.map((f) => f.reason).join(', ')}`)
if (!envelope.manifest.completeness.snapshots[0].completeForSnapshot) {
  throw new Error('the package stops at its 500-state bound and lacks the oldest states: use the complete export instead')
}
console.log(`package checked: signed by ${expectedSigner}, complete for its snapshot`)

for (const [path, bytes] of files) {
  if (!path.startsWith('proofs/')) continue
  const answer = await fetch(`${replacement}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Topics': '["tm_dpp"]', Authorization: `Bearer ${process.env.SUBMIT_TOKEN}` },
    body: new Uint8Array(bytes),
  })
  if (!answer.ok) throw new Error(`POST /submit answered ${answer.status} for ${path}: ${await answer.text()}`)
  console.log(path, answer.status, answer.headers.get('x-admission'))
}
```

2. Run it with the replacement's submit token. Set `REPLACEMENT_INDEX` if it is not `http://localhost:8080`:

```sh
SUBMIT_TOKEN=<replacement submit token> node restore-package.mjs
```

3. Check the admission results. Against the hosted reference and a local index admitting the reference application's key, it printed:

```
package checked: signed by 02f8d12356e30c6063c4a666dcefb099d04369a3c41929687d04610fb1ec9c0116, complete for its snapshot
proofs/1730153134890f8c1223d92850ec5a9d4c9cc84242fdf56d05e08e407aadaada.beef 200 tm_dpp=admitted
proofs/79d3f93d3b6c517ea67c411f775887f489ac5f915b0b5e92e494f59184b6fab4.beef 200 tm_dpp=admitted
proofs/1dea31ba2fdf78aedc6ce0692485e6309b38f8116703081d371939319461154c.beef 200 tm_dpp=admitted
proofs/2a2693e6fa39bad3f2cf9d2acd21e161111759cba9f5aad86140d45f811ce528.beef 200 tm_dpp=admitted
proofs/1947027e0cd40613795bc2ec005defff03ada9695c1f1e323da26797b9bf4150.beef 200 tm_dpp=admitted
```

The package lists states oldest first, so `proofs/` files restore each predecessor before its successor.

| Result | Meaning and action |
|---|---|
| `tm_dpp=duplicate` | The replacement already holds the state; rerunning produces this on each line. |
| `tm_dpp=none` | The replacement refused the state, most often because it does not admit its publisher key; the reason is only in the replacement's log. Stop and inspect that log. |
| `signatureValid` | The manifest was signed by the key it names. This alone does not check the expected signer. |
| `failures` containing `signer-unexpected` | The signer differs from the expected key. Check `failures`, not only `signatureValid`, and do not restore a refused package. |

## Restore a passport from the complete export

Use this above 500 states or whenever you need a coverage check. Join every part before trusting the history: one part is a genuine signed package that could be presented as the whole export. `joinEvidenceExport` from `@bsv/dpp-overlay` reports `complete: true` only after checking:

- each coverage signature under the exporter's key and its package binding;
- one passport and snapshot, with no repeated part index;
- sequence ranges covering the snapshot without gaps or overlaps;
- a signed final flag on the last part.

Without the hosted export token, use its open [bounded package](#restore-a-passport-from-the-bounded-package) for one passport within the bound.

1. Save this as `restore-export.mjs` at the checkout root, or in a project with `@bsv/dpp-overlay@0.4.0-beta.9` installed:

```js
// Fetch a passport's complete export from one index, check that the parts join, and restore it into another index.
import { joinEvidenceExport } from '@bsv/dpp-overlay'

const source = process.env.SOURCE_INDEX ?? 'http://localhost:8080'
const replacement = process.env.REPLACEMENT_INDEX ?? 'http://localhost:8081'
const passportId = process.env.PASSPORT_ID ?? 'https://id.gs1.org/01/09506000134352/21/7AC18477503A'
const expectedSigner = process.env.EXPORT_SIGNER
if (!expectedSigner) throw new Error('set EXPORT_SIGNER to the public key the source index signs exports with')

const parts = []
let cursor = null
do {
  const query = new URLSearchParams({ passportId, ...(cursor ? { cursor } : {}) })
  const response = await fetch(`${source}/evidence-export?${query}`, { headers: { Authorization: `Bearer ${process.env.EXPORT_TOKEN}` } })
  if (!response.ok) throw new Error(`GET /evidence-export answered ${response.status}: ${await response.text()}`)
  const part = await response.json()
  parts.push(part)
  cursor = part.nextCursor
} while (cursor)

// The coverage check: every part signed by the expected key, ranges that tile the snapshot, the final part last.
const joined = joinEvidenceExport(parts, { expectedPassportId: passportId, expectedSigner })
if (!joined.complete) throw new Error(`the export does not join:\n${joined.problems.join('\n')}`)
console.log(`export joined: ${parts.length} part(s) of snapshot ${joined.snapshotId}, complete`)

for (const [path, bytes] of joined.files) {
  if (!path.startsWith('proofs/')) continue
  const answer = await fetch(`${replacement}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Topics': '["tm_dpp"]', Authorization: `Bearer ${process.env.SUBMIT_TOKEN}` },
    body: new Uint8Array(bytes),
  })
  if (!answer.ok) throw new Error(`POST /submit answered ${answer.status} for ${path}: ${await answer.text()}`)
  console.log(path, answer.status, answer.headers.get('x-admission'))
}
```

2. Run with the source's export token and signer, and the replacement's submit token and URL:

```sh
EXPORT_TOKEN=<source export token> EXPORT_SIGNER=<source export signer> SUBMIT_TOKEN=<replacement submit token> REPLACEMENT_INDEX=http://localhost:8081 node restore-export.mjs
```

3. Check the joined result and admission lines. Between two local indexes, the example printed `export joined: 1 part(s) of snapshot <id>, complete` and the same five `200 tm_dpp=admitted` lines as the package restore.

| Failure | Cause | Retry or stop |
|---|---|---|
| `GET /evidence-export answered 401: {"status":"error","error":"export-unauthorised",...}` | Missing or wrong token; the hosted reference answers this to everyone without its token | Obtain the source's token before retrying. |
| `the export does not join:` | One sentence per coverage problem, such as `part 1: signed by <key>, not the expected <key>` or `part 2 is the last part received and is not final` | Do not restore. Fetch again from the start. |
| `GET /evidence-export answered 410` (`snapshot-expired`) or `400` (`cursor-invalid`) | Snapshot older than ten minutes, or a source restart invalidated every cursor | Start again without a cursor. Never mix snapshots: that archive was complete at neither point. |

## Check the result

1. Use the [passport lookup](../reference/contracts.md#find-passport-records) with `INDEX_URL` set to the replacement.
2. Verify the returned bytes:

```sh
node examples/verify-passport.mjs https://id.gs1.org/01/09506000134352/21/7AC18477503A http://localhost:8081
```

For the restored passport above, the last lines were:

```
State 5 (TRANSFER, 1947027e0cd4): user signature verifies; linkage holds; inclusion verified.
The chain as a whole is valid.
Inclusion across the chain: verified.
```

3. Compare with the same command against the source while it remains available. The restored history should read the same. Stop on an unexplained difference. A state now reading `inclusion` pending arrived without its proof; the source still needs to deliver it to the replacement's `POST /arc-ingest`.

## What no archive recovers

- Keep custody keys in the recovery plan separately.
- An export cannot recover evidence the source did not retain, and a package or export never carries the restricted tiers.
- Registry claims are a separate archive with no token history, restricted material or keys, so replacing a provider can need an index export, a registry export and separately kept custody access.

The [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) marks the complete index export tested and durable independent publication a gap; its evidence is local and synthetic. Other known limits are on [known limitations](limitations.md).

## Sources

| Recovering | Source |
|---|---|
| One passport within the package bound | [Package operation](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/overlay.yaml), [package schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/evidence-package.schema.json) |
| A longer history across parts | [Complete-export operation](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/overlay.yaml), [part schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/evidence-export.schema.json), the [overlay package's description](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/packages/dpp-overlay/README.md#get-evidence-packagepassportid) |
| Registry-held claims | [Registry contract](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/registry.yaml) |
| The reference's own restore | [Package tests](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/packages/dpp-overlay/test/evidenceExport.test.ts), [complete-export tests](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/packages/dpp-overlay/test/evidenceExportParts.test.ts), which walk 505 states through two parts |

The [portable-evidence requirements](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/portable-evidence.md) and [exchange requirements](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/exchange.md) define packages, exports and how a reader joins them.

Next: to move a whole deployment to a new release, rehearse against a restored copy as [migration](../migration.md) describes; to keep a second index in step continuously instead, see [federation](federation.md).
