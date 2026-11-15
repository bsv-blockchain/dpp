# Export, import and recovery

Index operators and teams replacing a provider can use this guide to back up an index or restore one passport's evidence to a replacement. Choose the archive below, restore it, then verify what it recovered.

## Recovery prerequisites

| Procedure | Inputs and where to get them |
|---|---|
| Whole-index backup or restore | Operator access to the Docker host, the Compose checkout and its `deploy/operator.env`; an empty destination volume for restoration |
| Passport restoration, either route | Passport identifier and source URL from the publisher; replacement URL and a submit token from its operator, operator-wide or issued for the passport's publisher key; a built [checkout](../quick-start.md#get-the-code) or the package specified below |
| Trust and admission, either route | The source index's exporter identity key, or for an index on an earlier release its export signer, from the source operator; replacement settings that admit the passport's publisher keys through `SERVICE_IDENTITY_KEY` or a [signed publisher policy](federation.md#3-sign-a-publisher-policy) |
| Bounded package | Source index with `EXPORTER_PRIVATE_KEY` set, or an earlier release's export key; no source token. Use only for a passport with no more than 500 states. |
| Complete export | Source index's `EXPORT_TOKEN` and exporter identity key from [enable exports](#enable-exports-on-your-index). A feature of the reference index package, outside the standard. The hosted token is not public; its operator names recipients [on request](../deployment.md#join-the-hosted-reference). |

## What each archive recovers

| Archive | What it holds | What it lacks | Who can fetch it |
|---|---|---|---|
| A backup of the index's MongoDB volume | Everything the index admitted: outputs, transactions, the passport and anchor indexes and the synchronisation checkpoints | Keys, registry claims, restricted tiers | The operator, on the host |
| The bounded package, `GET /evidence-package` | One passport's newest 500 states: each raw transaction, its BEEF with the merkle path once the index has one, the publisher policy chain, spend observations and a report, inventoried in a signed manifest | States beyond the newest 500, which it declares absent; restricted tiers | Anyone, from an index that sets `EXPORTER_PRIVATE_KEY` (otherwise 503) |
| The complete export, `GET /evidence-export`, a reference package feature | Every state of one passport, in signed parts over one snapshot | Restricted tiers; the report, which the reader produces over the joined parts | Anyone holding the source index's `EXPORT_TOKEN` when it sets one. The hosted reference sets one and does not give it to outsiders, so use this route on your own index or ask the source operator |
| A registry export | The claims a registry holds and their evidence, under the [registry contract](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/contracts/registry.yaml) | Token history, restricted material, keys | Depends on the registry |
| An EPCIS recovery snapshot | Everything an EPCIS exchange holds for the source scopes it covers: every retained original, and the import records, observations, conflict decisions and pull state that no source can rebuild | Credentials, which the replacement's operator configures again; by default every cursor, so an unfinished pull replays from its bounds; token history, which is the index's | The operator of the application that runs the exchange, through `exportEpcisRecovery` |
| The custody keys | The ability to spend or update the passport, which restoring public evidence does not recover | | Only their holder: no export recovers a lost key |

| Term or limit | Meaning |
|---|---|
| BEEF | Encoding of a transaction, its ancestors and their proofs; [words you will meet](../README.md#words-you-will-meet) defines a proof |
| Snapshot | Point in the index's history fixed by an export's first request |
| Snapshot lifetime | Ten minutes: `limits.historySnapshotTtlSeconds` is `600` in the capability document |
| Coverage record | Signed statement in each complete-export part naming the passport, snapshot, part index, sequence range and final-part status |

## Back up and restore a whole index

The Compose preset backs up its MongoDB volume. Its [restart, back up and restore recipe](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/deploy/README.md#restart-back-up-restore) uses these steps from the checkout root:

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

`EXPORTER_PRIVATE_KEY` is the index's exporter identity key, a key of its own: it is never the publisher key, and it is set apart from `OPERATOR_SIGNING_KEY`, so exporting does not need the key that signs publisher-policy versions on the host. The index signs each passport's package with that key's BRC-42 child for `[1, 'dpp evidence package v1']` and the passport identifier, as every exporter does ([portable evidence](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/spec/portable-evidence.md) section 2), and names its public key as `exporterIdentityKey` in the capability document, so a reader derives the signer for any passport from one key. It establishes nothing about admission. Neither export route works without it.

1. Generate the key from the checkout root. If an earlier release of your index signed with `EXPORT_SIGNING_KEY`, you can instead move that value to `EXPORTER_PRIVATE_KEY`, which keeps the identity readers already hold:

```sh
node --input-type=module -e "import { PrivateKey } from '@bsv/sdk'; const key = PrivateKey.fromRandom(); console.log('EXPORTER_PRIVATE_KEY=' + key.toHex()); console.log('exporter identity key: ' + key.toPublicKey().toString())"
```

2. Put the first line in `deploy/operator.env` and remove any `EXPORT_SIGNING_KEY`, which an earlier release signed with directly and this one refuses to boot with. Add `EXPORT_TOKEN=` followed by a secret from `openssl rand -hex 32`; without `EXPORT_TOKEN`, anyone can fetch the complete export.
3. Apply both with `docker compose -f deploy/compose.yml --env-file deploy/operator.env up -d`.
4. Check `GET /capabilities`: under `limits`, expect `"evidencePackageExport": "available"` and `"evidenceExport": "bearer"`, and expect `exporterIdentityKey` to be the second line.

5. Publish the second line, the exporter identity key, where readers can find it. A reader compares it with the capability document and passes `evidencePackageSigner(key, passportId)` from `@bsv/dpp-protocol` as `expectedSigner`. If you served packages under an earlier release's `EXPORT_SIGNING_KEY`, keep publishing that key's public half too: a package it signed names it as both `exporter.id` and `signature.signer` and still inspects with it as `expectedSigner`. The [hosted reference page](../deployment.md) lists the raw signer of the release it runs, `02f8d12356e30c6063c4a666dcefb099d04369a3c41929687d04610fb1ec9c0116`.

## Restore a passport from the bounded package

The hosted reference supports this route. Its passports require the replacement to admit `0325a17b2c87de853f7b2f54f82db80f49f189810379170693261dc6fa0a06da24` and `03c8850a79a6fba2ea48b9419d7490bae6b6dcf3521e1f75aa98ed4939d1cab89f`.

1. Save this as `restore-package.mjs` at the checkout root, or in a project with the [protocol candidate archive](../packages/README.md#use-the-renamed-source-candidate) installed:

```js
// Copy one passport from an index's bounded evidence package into another index.
import { evidencePackageSigner, inspectEvidencePackage } from '@bsv/dpp-protocol'

const source = process.env.SOURCE_INDEX ?? 'https://dpp-overlay.bsvb.net'
const replacement = process.env.REPLACEMENT_INDEX ?? 'http://localhost:8080'
const passportId = process.env.PASSPORT_ID ?? 'https://dpp.bsvb.net/01/09529530005688/21/E18E296BB180'
// The key this passport's package is signed by: the child of the exporter identity key the source operator gives you
// (EXPORTER_IDENTITY_KEY), or for an index on an earlier release its raw export key (EXPORT_SIGNER), by default the hosted reference's.
const expectedSigner = process.env.EXPORTER_IDENTITY_KEY
  ? evidencePackageSigner(process.env.EXPORTER_IDENTITY_KEY, passportId)
  : process.env.EXPORT_SIGNER ?? '02f8d12356e30c6063c4a666dcefb099d04369a3c41929687d04610fb1ec9c0116'

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

2. Run it with a submit token for the replacement: its operator-wide `SUBMIT_TOKEN`, or a token its operator issued for the passport's publisher key with `dpp-index tokens issue --publisher <key> --use submit`. Set `REPLACEMENT_INDEX` if it is not `http://localhost:8080`:

```sh
SUBMIT_TOKEN=<replacement submit token> node restore-package.mjs
```

3. Check the admission results. Against the hosted reference and a local index admitting the reference application's key, it printed:

```
package checked: signed by 02f8d12356e30c6063c4a666dcefb099d04369a3c41929687d04610fb1ec9c0116, complete for its snapshot
proofs/debfc9c9125a490cb6642669fcc1da49ece52aff06ad52715abef1ca0c0091e2.beef 200 tm_dpp=admitted
proofs/52d31ed5272b874f1036712f55e32e5a075d3278027ed9ea7df87f1a4d26161c.beef 200 tm_dpp=admitted
proofs/122bb72c201f115c81ab2313058ab164ba3ba7f4a09ecb360431afabc311221d.beef 200 tm_dpp=admitted
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

1. Save this as `restore-export.mjs` at the checkout root:

```js
// Fetch a passport's complete export from one index, check that the parts join, and restore it into another index.
import { evidencePackageSigner } from '@bsv/dpp-protocol'
import { joinEvidenceExport } from '@bsv/dpp-overlay'

const source = process.env.SOURCE_INDEX ?? 'http://localhost:8080'
const replacement = process.env.REPLACEMENT_INDEX ?? 'http://localhost:8081'
const passportId = process.env.PASSPORT_ID ?? 'https://dpp.bsvb.net/01/09529530005688/21/E18E296BB180'
const expectedSigner = process.env.EXPORTER_IDENTITY_KEY
  ? evidencePackageSigner(process.env.EXPORTER_IDENTITY_KEY, passportId)
  : process.env.EXPORT_SIGNER
if (!expectedSigner) throw new Error('set EXPORTER_IDENTITY_KEY to the source index\'s exporter identity key, or EXPORT_SIGNER to the raw key an index on an earlier release signs with')

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

2. Run with the source's export token and exporter identity key, and the replacement's submit token and URL:

```sh
EXPORT_TOKEN=<source export token> EXPORTER_IDENTITY_KEY=<source exporter identity key> SUBMIT_TOKEN=<replacement submit token> REPLACEMENT_INDEX=http://localhost:8081 node restore-export.mjs
```

3. Check the joined result and admission lines. Between two local indexes, the example printed `export joined: 1 part(s) of snapshot <id>, complete` and the same three `200 tm_dpp=admitted` lines as the package restore.

| Failure | Cause | Retry or stop |
|---|---|---|
| `GET /evidence-export answered 401: {"status":"error","error":"export-unauthorised",...}` | Missing or wrong token; the hosted reference answers this to everyone without its token | Obtain the source's token before retrying. |
| `the export does not join:` | One sentence per coverage problem, such as `part 1: signed by <key>, not the expected <key>` or `part 2 is the last part received and is not final` | Do not restore. Fetch again from the start. |
| `GET /evidence-export answered 410` (`snapshot-expired`) or `400` (`cursor-invalid`) | Snapshot older than ten minutes, or a source restart invalidated every cursor | Start again without a cursor. Never mix snapshots: that archive was complete at neither point. |

## Move an EPCIS exchange to another store

An application that imports or pulls EPCIS events through `@bsv/dpp-credentials/epcis-exchange` holds records an index does not: which request each import answers, how each event arrived, what was decided about a conflict and how far each pull got. They leave as a recovery snapshot and arrive through a restore. This is an authorised path for the operator of the exchange. A public evidence package never carries these records.

1. **Quiesce the source.** Stop accepting imports and starting pulls. Run `recoverEpcisExchange(storage)`, which finishes or discards interrupted work. An export refuses as `unfinished-work` while anything is journalled.
2. **Export.** `exportEpcisRecovery({ storage })` returns the files, one inventory entry for each and a descriptor. It refuses a store that is not consistent and names what is wrong. Pass the credentials the deployment was configured with as `credentials` and the export also refuses if any exported byte holds one.
3. **Carry it.** Put the files in a `dpp-evidence-package@1` whose disclosure is `all-tiers` and which declares itself a recovery backup, list the entries in its manifest and sign it. Keep the package where you keep other restricted backups: it holds every source document and the operational history of the exchange.
4. **Restore into an empty store.** At the replacement, verify the package as any package, then call `restoreEpcisRecovery({ storage, source, inventory })`. It checks the snapshot before it writes, reads every original back and holds it to its digest, rebuilds the index and checks the invariants of the exchange. If the process stops, run the same call again: it resumes.
5. **Provision credentials and endpoints.** No credential is in a snapshot. Configure each source at the replacement: its address, its permitted origins and how its credential is obtained. If the same source is reached at another address there, declare it with `remapEpcisSourceEndpoint`.
6. **Resume.** Accept imports again and run each pull with its own `queryId`. A retry of a request the old store acknowledged answers the same import. An interrupted pull continues, or replays from its retained bounds, and skips no page. A carried cursor at an origin you did not permit at the replacement is never requested: the run ends as `partial-history`, `pagination-target-refused`, until you declare the source's address and permitted origins with `remapEpcisSourceEndpoint`, which drops that cursor.

| If the restore answers | Do this |
|---|---|
| `reconciliation-required` | The destination already holds a record that differs under the same identity. Nothing was written. Restore into an empty store, or reconcile each listed collision yourself; nothing is overwritten for you |
| `destination-unfinished-work` | Run `recoverEpcisExchange` on the destination, or finish the restore that is pending there |
| `checkpoint-imports-omitted`, `resolution-observations-omitted`, `original-missing`, `record-missing` | The snapshot is incomplete. Ask the source operator for a new export; a missing record cannot be rebuilt from the documents |
| `original-altered`, `record-altered`, `descriptor-inventory-mismatch` | The package is not what its exporter assembled. Do not restore it |
| `snapshot-inconsistent`, `record-misfiled` | The snapshot does not hold together: a record of one source scope stands on a record of another, the descriptor says something the records do not, or cursor material is carried that the descriptor says was left out. Do not restore it |
| `not-a-recovery-snapshot` | You were given the public form. It restores nothing; ask for a recovery snapshot |

The default snapshot leaves every cursor out. A snapshot taken with `cursors: 'include'` lets a pull resume without replaying, against the same endpoint, and holds page tokens: treat it as you treat the credentials it is used with. [Move an exchange to another store](../interoperability/epcis.md#move-an-exchange-to-another-store) has the layout, every refusal and a runnable example.

The module's tests export from each of its two storage adapters and restore into the other, with the restore stopped before and after every durable call. No exit between two independently operated deployments has been exercised yet, and the starter application does not serve these calls over HTTP.

## Check the result

1. Use the [passport lookup](../reference/contracts.md#find-passport-records) with `INDEX_URL` set to the replacement.
2. Verify the returned bytes:

```sh
node examples/verify-passport.mjs https://dpp.bsvb.net/01/09529530005688/21/E18E296BB180 http://localhost:8081
```

For the restored passport above, the last lines were:

```
State 3 (TRANSFER, 122bb72c201f): user signature verifies; linkage holds; inclusion verified.
The chain as a whole is valid.
Inclusion across the chain: verified.
```

3. Compare with the same command against the source while it remains available. The restored history should read the same. Stop on an unexplained difference. A state now reading `inclusion` pending arrived without its proof; the source still needs to deliver it to the replacement's `POST /arc-ingest`.

## What no archive recovers

- Keep custody keys in the recovery plan separately.
- An export cannot recover evidence the source did not retain, and a package or export never carries the restricted tiers.
- Registry claims are a separate archive with no token history, restricted material or keys, so replacing a provider can need an index export, a registry export and separately kept custody access.
- An index's package and export do not hold what an EPCIS exchange retained. The application that runs the exchange exports that as [a recovery snapshot](#move-an-epcis-exchange-to-another-store), and no snapshot carries a credential.
- An index's package and export hold token history. They do not hold the files that define a profile held by a binding, which a reader needs to validate a payload under that profile. An application carries those as a [profile bundle](../packages/dpp-profiles.md#carry-a-profile-to-another-deployment) in a package it assembles, and the replacement registers them against its own trusted binding digests.

The complete export is a feature of the reference index package, outside the standard, and its tests are local and synthetic. The [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) marks durable independent publication a gap. Other known limits are on [known limitations](limitations.md).

## Sources

| Recovering | Source |
|---|---|
| One passport within the package bound | [Package operation](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/contracts/overlay.yaml), [package schema](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/contracts/evidence-package.schema.json) |
| A longer history across parts | [Complete-export operation](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/packages/dpp-overlay/README.md), [part schema](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/packages/dpp-overlay/schemas/evidence-export.schema.json), the [overlay package's description](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/packages/dpp-overlay/README.md#get-evidence-packagepassportid) |
| An EPCIS exchange | `spec/epcis-interoperability.md` section 8; `contracts/epcis-recovery.schema.json`; `packages/dpp-credentials/test/epcis-recovery.test.ts` |
| Registry-held claims | [Registry contract](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/contracts/registry.yaml) |
| The reference's own restore | [Package tests](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/packages/dpp-overlay/test/evidenceExport.test.ts), [complete-export tests](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/packages/dpp-overlay/test/evidenceExportParts.test.ts), which walk 505 states through two parts |

The [portable-evidence requirements](https://github.com/bsv-blockchain/dpp/blob/ace901659baf2e4f6ec1d2ff610454eb63bc6faf/spec/portable-evidence.md) and [exchange requirements](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/exchange.md) define packages; the overlay package's description covers the complete export and how a reader joins its parts.

Next: to move a whole deployment to a new release, rehearse against a restored copy as [migration](../migration.md) describes; to keep a second index in step continuously instead, see [federation](federation.md).
