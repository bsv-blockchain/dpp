# Export, import and recovery

This page is for index operators and for anyone replacing an index provider: it shows how to back up a whole index, how to copy one passport's evidence out of one index and into another, and what each kind of archive cannot recover. Start with the table, pick the archive you need, then follow its section.

## What each archive recovers

| Archive | What it holds | What it lacks | Who can fetch it |
|---|---|---|---|
| A backup of the index's MongoDB volume | Everything the index admitted: outputs, transactions, the passport and anchor indexes and the synchronisation checkpoints | Keys, registry claims, restricted tiers | The operator, on the host |
| The bounded package, `GET /evidence-package` | One passport's newest 500 states: each raw transaction, its BEEF with the merkle path once the index has one, the publisher policy chain, spend observations and a report, inventoried in a signed manifest | States beyond the newest 500, which it declares absent; restricted tiers | Anyone, from an index that sets `EXPORT_SIGNING_KEY` (otherwise 503) |
| The complete export, `GET /evidence-export` | Every state of one passport, in signed parts over one snapshot | Restricted tiers; the report, which the reader produces over the joined parts | Anyone holding the source index's `EXPORT_TOKEN` when it sets one. The hosted reference sets one and does not give it to outsiders, so use this route on your own index or ask the source operator |
| A registry export | The claims a registry holds and their evidence, under the [registry contract](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/registry.yaml) | Token history, restricted material, keys | Depends on the registry |
| The custody keys | The ability to spend or update the passport | | Only their holder: no export recovers a lost key |

Words used below: BEEF is the encoding in which an index serves a transaction together with its ancestors and their proofs ([words you will meet](../README.md#words-you-will-meet) defines a proof). A snapshot is the point in an index's history that an export reads, fixed by its first request; it expires after ten minutes (`limits.historySnapshotTtlSeconds` is `600` in the capability document). A coverage record is the signed statement in each part of a complete export naming the passport, the snapshot, the part's index and sequence range, and whether it is the final part.

## Back up and restore a whole index

The MongoDB volume is the backup unit of the Compose preset. Follow the [restart, back up and restore recipe](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/deploy/README.md#restart-back-up-restore) in the preset's README. From the root of the checkout, stop the index so its files do not change while they are copied, copy the volume to `mongo-data.tgz`, and start it again:

```sh
docker compose -f deploy/compose.yml --env-file deploy/operator.env stop
docker run --rm -v dpp-overlay_mongo-data:/data -v "$PWD":/out mongo:7 tar czf /out/mongo-data.tgz /data
docker compose -f deploy/compose.yml --env-file deploy/operator.env start
```

Restoring is the reverse, into an empty volume before the index first starts on it. The second preset's volume is `dpp-overlay-b_mongo-b-data`. A volume backup is not a copy anyone else can check; to hand evidence to another operator, use a package or an export.

## Enable exports on your index

An index serves neither export route until it has an export signing key, a private key of its own that says which index assembled a package. It is never the publisher key, and it says nothing about admission. From the root of the checkout, make one:

```sh
node --input-type=module -e "import { PrivateKey } from '@bsv/sdk'; const key = PrivateKey.fromRandom(); console.log('EXPORT_SIGNING_KEY=' + key.toHex()); console.log('export signer: ' + key.toPublicKey().toString())"
```

Put the first line in `deploy/operator.env`, add `EXPORT_TOKEN=` followed by a secret from `openssl rand -hex 32`, and apply both with `docker compose -f deploy/compose.yml --env-file deploy/operator.env up -d`. Without `EXPORT_TOKEN`, anyone can fetch the complete export. Then `GET /capabilities` reads `"evidencePackageExport": "available"` and `"evidenceExport": "bearer"` under `limits`.

Give the export signer, the second line, to anyone who will check your packages: they pass it as `expectedSigner`. The capability document does not carry the export signer yet, so publish it where your readers will find it. The hosted reference's export signer is `02f8d12356e30c6063c4a666dcefb099d04369a3c41929687d04610fb1ec9c0116`, on [the hosted reference page](../deployment.md).

## Restore a passport from the bounded package

Use this when the passport has no more than 500 states. It works against any index with an export key, the hosted reference included, and needs no token from the source. The replacement index must admit the passport's publisher keys, through `SERVICE_IDENTITY_KEY` or a publisher policy that names them ([sign a publisher policy](federation.md#3-sign-a-publisher-policy)); for the hosted reference's passports, those are `0325a17b2c87de853f7b2f54f82db80f49f189810379170693261dc6fa0a06da24` and `03c8850a79a6fba2ea48b9419d7490bae6b6dcf3521e1f75aa98ed4939d1cab89f`.

Save this as `restore-package.mjs` at the root of the checkout, or in a project with `@bsv/dpp-core@0.3.0-beta.7` installed:

```js
// Copy one passport from an index's bounded evidence package into another index.
import { inspectEvidencePackage } from '@bsv/dpp-core'

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

Run it with the replacement's submit token, and `REPLACEMENT_INDEX` if it is not `http://localhost:8080`:

```sh
SUBMIT_TOKEN=<replacement submit token> node restore-package.mjs
```

Against the hosted reference and a local index admitting the reference application's key, it printed:

```
package checked: signed by 02f8d12356e30c6063c4a666dcefb099d04369a3c41929687d04610fb1ec9c0116, complete for its snapshot
proofs/1730153134890f8c1223d92850ec5a9d4c9cc84242fdf56d05e08e407aadaada.beef 200 tm_dpp=admitted
proofs/79d3f93d3b6c517ea67c411f775887f489ac5f915b0b5e92e494f59184b6fab4.beef 200 tm_dpp=admitted
proofs/1dea31ba2fdf78aedc6ce0692485e6309b38f8116703081d371939319461154c.beef 200 tm_dpp=admitted
proofs/2a2693e6fa39bad3f2cf9d2acd21e161111759cba9f5aad86140d45f811ce528.beef 200 tm_dpp=admitted
proofs/1947027e0cd40613795bc2ec005defff03ada9695c1f1e323da26797b9bf4150.beef 200 tm_dpp=admitted
```

The package lists its states oldest first, so its `proofs/` files restore the lineage predecessor first. Run again, each line reads `tm_dpp=duplicate`. A line reading `tm_dpp=none` means the replacement refused that state, most often because it does not admit the state's publisher key; the reason is only in the replacement's log. Check `failures`, not only `signatureValid`: `signatureValid` says the manifest was signed by the key it names, and only `failures` reports `signer-unexpected` when that is not the key you expected.

## Restore a passport from the complete export

Use this for a passport with more than 500 states, or whenever you want the coverage check: the parts of a complete export must be joined before they are trusted, because each part on its own is a genuine signed package that could be handed over as if it were the whole history. `joinEvidenceExport` from `@bsv/dpp-overlay-topics` does that check. It verifies each part's coverage signature under the exporter's key and the binding of its package, then requires one passport and one snapshot, part indexes with no repeat, sequence ranges that tile the snapshot with no gap or overlap, and the signed final flag on the last part. Only then does it report `complete: true`.

You need the source index's `EXPORT_TOKEN` and its export signer. On your own index those are the values from [enable exports](#enable-exports-on-your-index). The hosted reference's export token is not public: anyone can restore a single passport from its open [bounded package](#restore-a-passport-from-the-bounded-package), and a complete export goes to the parties its operator names, on request ([join the hosted reference](../deployment.md#join-the-hosted-reference)). Save this as `restore-export.mjs` at the root of the checkout, or in a project with `@bsv/dpp-overlay-topics@0.4.0-beta.7` installed:

```js
// Fetch a passport's complete export from one index, check that the parts join, and restore it into another index.
import { joinEvidenceExport } from '@bsv/dpp-overlay-topics'

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

Run it with four values: the source's export token and export signer, and the replacement's submit token and URL:

```sh
EXPORT_TOKEN=<source export token> EXPORT_SIGNER=<source export signer> SUBMIT_TOKEN=<replacement submit token> REPLACEMENT_INDEX=http://localhost:8081 node restore-export.mjs
```

From one local index holding the passport above to a second, it printed `export joined: 1 part(s) of snapshot <id>, complete` and the same five `200 tm_dpp=admitted` lines as the package restore. What a failure looks like:

- `GET /evidence-export answered 401: {"status":"error","error":"export-unauthorised",...}`: the token is missing or wrong. The hosted reference answers this to everyone without its token.
- `the export does not join:` followed by one sentence per problem, such as `part 1: signed by <key>, not the expected <key>` or `part 2 is the last part received and is not final`: do not restore. Fetch the export again from the start.
- `GET /evidence-export answered 410` (`snapshot-expired`) or `400` (`cursor-invalid`): the snapshot is older than ten minutes, or the source restarted, which invalidates every cursor. Start again without a cursor. Never mix parts from two snapshots: such an archive was never complete at either point.

## Check the result

Look the passport up on the replacement with the [passport lookup](../reference/contracts.md#find-passport-records) and `INDEX_URL` set to it, then verify it from the bytes:

```sh
node examples/verify-passport.mjs https://id.gs1.org/01/09506000134352/21/7AC18477503A http://localhost:8081
```

For the restored passport above, the last lines were:

```
State 5 (TRANSFER, 1947027e0cd4): user signature verifies; linkage holds; inclusion verified.
The chain as a whole is valid.
Inclusion across the chain: verified.
```

Compare that with the same command against the source while it is still available. A restored history should read the same; a state that now reads `inclusion` pending arrived without its proof, which the source still has to deliver to the replacement's `POST /arc-ingest`.

## What no archive recovers

- Restoring publicly retrievable evidence does not restore the ability to spend or update the passport. Keep custody keys in the recovery plan separately.
- An export cannot recover evidence the source did not retain, and a package or export never carries the restricted tiers.
- Registry claims are a separate archive with no token history, restricted material or keys, so replacing a provider can need an index export, a registry export and separately kept custody access.

The [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) marks the complete index export tested and durable independent publication a gap; its evidence is local and synthetic. Other known limits are on [known limitations](limitations.md).

## Sources

| Recovering | Source |
|---|---|
| One passport within the package bound | [Package operation](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/overlay.yaml), [package schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/evidence-package.schema.json) |
| A longer history across parts | [Complete-export operation](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/overlay.yaml), [part schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/evidence-export.schema.json), the [overlay package's description](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/overlay-topics/README.md#get-evidence-packagepassportid) |
| Registry-held claims | [Registry contract](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/registry.yaml) |
| The reference's own restore | [Package tests](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/overlay-topics/test/evidenceExport.test.ts), [complete-export tests](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/overlay-topics/test/evidenceExportParts.test.ts), which walk 505 states through two parts |

The [portable-evidence requirements](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/portable-evidence.md) and [exchange requirements](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/exchange.md) define packages, exports and how a reader joins them.

Next: to move a whole deployment to a new release, rehearse against a restored copy as [migration](../migration.md) describes; to keep a second index in step continuously instead, see [federation](federation.md).
