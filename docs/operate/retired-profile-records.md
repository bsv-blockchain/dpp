# Clear retired-profile demonstration records

Operators can use this procedure to clear demonstration records that were issued under a retired profile from their own application and their own index. It lists what would be affected first, and removes only what you then name.

Nothing here is required. The software never removes these records by itself, and a record under a retired profile does no harm where it is: it stays readable, and its profile is reported as retired. Use this page only for records that describe no real product and that you no longer want to hold or show.

## What this procedure is

| It does | It does not |
|---|---|
| Name each store the application and the index keep such records in, and what else shares it | Run anything for you. Every command is one you type |
| List the affected records before anything is removed | Remove by profile. Removal takes the list of passport identifiers you reviewed |
| Remove journal entries and index rows from your own databases | Erase anything from the blockchain. A transaction that was mined stays there for good |
| Leave keys, wallets, sign-in, tokens, policies, imported EPCIS documents and other passports alone | Reach another operator's index or a registry |

The retired profiles are `battery@2`, `battery@3`, `battery@4`, `textile@1`, `textile@2`, `textile@3` and `textile@4` ([retired profiles](../profiles/README.md#retired-profiles)).

The listing and removal commands for both databases are run by the repository's tests, taken from this page as written, against databases seeded with retired records and with everything that shares their stores (`packages/dpp-overlay/test/retired-profile-reset.test.ts`). The Compose commands around them are not part of that run, and neither is `mongosh` itself: the tests run the shell blocks in a stand-in that makes the same calls through the MongoDB driver.

## Before you start

| Input | Source |
|---|---|
| The application's project and its `.env` | The project `@bsv/create-dpp-app` generated. `MONGO_URL` and `MONGO_DB` name its database; the default database is `dpp_app` |
| The index's checkout and `deploy/operator.env` | The Compose preset from [run an index from source](README.md). `MONGO_DB` names its database; the default is `dpp` |
| `mongosh` | Inside the `mongo` container of each Compose project, as the commands below use it. For a managed database, your own `mongosh` with its connection string |
| A backup of both databases | [Back up a whole index](export-import-recovery.md#back-up-and-restore-a-whole-index). The application's volume is `dpp-platform_mongo-data`: stop its MongoDB and copy the volume the same way |
| A decision for each record | Whether it is a demonstration record. Keep any record of a real product |

Take the backups before the removal step. A removed journal entry cannot be rebuilt from the chain: the restricted part of a passport and its acceptance records are held nowhere else.

## Where the records are

### The application

An application from the starter keeps its records in one MongoDB database. Without MongoDB it keeps them in memory and forgets them at restart, so there is nothing to clear.

| Store | What it holds for a passport | What else shares it | This procedure |
|---|---|---|---|
| Collection `passports` | The journal: one document per passport, with its `profile`, every state's transaction and public payload, the sealed restricted part and the acceptance records | Every passport of every brand, under every profile | Removes the documents you list |
| Collection `offers` | Hand-on offers, by `passportId` | Offers for every other passport | Removes those of the listed passports |
| Collection `claims` | Signed lifecycle claims, by `passportId` | Claims about every other passport | Removes those of the listed passports |
| Collection `brands` | Nothing per passport: the brands themselves | Every passport of the brand | Leaves it |
| Collection `spends` | One row per transaction sent, for the daily spend cap | The spend accounting of the whole platform | Leaves it |
| Collections `epcis_log`, `epcis_records`, `epcis_bytes` and `epcis_chunks`, or the folder `EPCIS_STORAGE_DIR` names when `EPCIS_STORAGE` is `file` | Nothing under a profile: the EPCIS documents the application imported or pulled, byte for byte, with the import records and associations derived from them. An association can name a passport | Every source the application exchanges events with, and every passport an event was associated with | Leaves them: out of scope, as explained below |
| The sign-in collections in the same database | Nothing per passport: users, sessions and organisations, kept by the sign-in library under its own names | Every user and brand | Leaves them |
| `WALLET_FILE`, by default `local/wallet.sqlite` | The platform wallet: its funds, and the token output of each passport's newest state | Every passport and all funds | Leaves it. Never delete this file |
| `.env`: `WALLET_ROOT_KEY`, `BRAND_ROOT_SECRET`, `MANAGED_IDENTITY_SECRET`, `AUTH_SECRET` | The secrets every brand, holder and passport key is derived from | Every key of the platform | Leaves it. Never remove or change a secret to clear a record |
| The index in the application's own process | A stand-in index used until the application has joined one, held in memory | Nothing | Nothing to clear: it forgets everything at restart |

EPCIS exchange records are outside this procedure. An imported EPCIS document is a source document from another party's system: it declares no profile, so retiring a profile retires nothing in it, and one document can describe many products. No command on this page reads or removes those collections. An association that names a passport you remove stays as a record of what was imported, and then names a passport the application no longer holds. To move an exchange and its documents, see [move an EPCIS exchange to another store](export-import-recovery.md#move-an-epcis-exchange-to-another-store).

### The index

An index from the Compose preset keeps everything it admitted in one MongoDB database. Without `MONGO_URL` it keeps it in memory and forgets it at restart.

| Store | What it holds for a passport | What else shares it | This procedure |
|---|---|---|---|
| Collection `dppRecords` | One row per admitted state, by `passportId`, `txid` and `outputIndex`. It is what a lookup answers from. It has no profile column | Every passport of every publisher | Removes the rows of the listed passports |
| Collection `overlayOutputs` | One row per admitted output, with its script, under the topic `tm_dpp` | Outputs of every passport, and the anchors under `tm_attestation` and `tm_uora_dpp` | Removes the `tm_dpp` rows of the listed transactions |
| Collection `overlayTransactions` | The transaction bytes, once per `txid` | A transaction that also carries an output of another topic | Removes a listed transaction only when no other output of it is still indexed |
| Collection `overlayAppliedTransactions` | A marker per transaction and topic, so a transaction is admitted once | Markers of every topic | Removes the `tm_dpp` markers of the listed transactions |
| Collection `dppCounters` | Nothing per passport: the sequence counter that orders history pages | Every passport | Leaves it. A removed row's sequence stays assigned |
| Collections `attestationAnchorsV1` and `uoraAnchors` | Anchors of claims, some with a passport as `subject`. Each is a transaction of its own, written by a registry | Every claim's anchor | Lists them and leaves them |
| Collection `overlayInteractions` | Nothing per passport: synchronisation checkpoints per peer | Every peer | Leaves it |
| Collections `publisherTokensV1`, `publisherPolicyVersionsV1` and `registrationsV1`, or the files `PUBLISHER_TOKENS_FILE` and `PUBLISHER_POLICY_FILE` name | Nothing per passport: write tokens, the publisher policy and registrations | Every publisher | Leaves them |

Neither the application nor the index keeps a cache of passport records. What each caches is in memory and holds no record: compiled schemas and a binding's code lists in the application, and peer discovery answers in the index. A registry is a separate service: a claim you sent to one is held and anchored by that registry, and this procedure does not reach it.

## List what would be affected

Nothing in this section changes anything.

### In the application

1. Open a shell on the application's database. From the project root, with the bundled MongoDB, and with your own database name in place of `dpp_app` if `MONGO_DB` differs:

```sh
docker compose -f deploy/compose.yml --env-file .env exec mongo mongosh dpp_app --quiet
```

2. List the passports whose journal names a retired profile:

```js
var RETIRED = ['battery@2', 'battery@3', 'battery@4', 'textile@1', 'textile@2', 'textile@3', 'textile@4']
db.passports.find({ profile: { $in: RETIRED } }, { _id: 0, passportId: 1, profile: 1, brandId: 1, status: 1, createdAt: 1 }).sort({ createdAt: 1 }).forEach(printjson)
```

3. Count what belongs to them, and list their transactions for the index step:

```js
var ids = db.passports.distinct('passportId', { profile: { $in: RETIRED } })
printjson({ passports: ids.length, offers: db.offers.countDocuments({ passportId: { $in: ids } }), claims: db.claims.countDocuments({ passportId: { $in: ids } }) })
db.passports.aggregate([{ $match: { profile: { $in: RETIRED } } }, { $unwind: '$states' }, { $project: { _id: 0, passportId: 1, op: '$states.op', txid: '$states.txid', network: '$states.network' } }]).forEach(printjson)
```

The application's brand page shows the same passports with their profile. A state whose `network` is `accepted` was sent to the network and is on the blockchain, or will be.

### In the index

The index holds no profile column, so the profile is read from each state's own payload. This script only reads.

1. Save this as `list-retired-records.mjs` at the root of the built checkout:

```js
// Read-only: lists the passports in an index's database whose states declare a retired profile.
import { MongoClient } from 'mongodb'
import { LockingScript, Utils } from '@bsv/sdk'
import { parseDppOutput } from '@bsv/dpp-protocol'
import { isRetiredProfile } from '@bsv/dpp-profiles'

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017')
await client.connect()
const outputs = client.db(process.env.MONGO_DB ?? 'dpp').collection('overlayOutputs')
const passports = new Map()
let read = 0
for await (const output of outputs.find({ topic: 'tm_dpp' }, { projection: { _id: 0, txid: 1, outputIndex: 1, outputScript: 1 } })) {
  read += 1
  try {
    const { state } = parseDppOutput(LockingScript.fromBinary(Utils.toArray(output.outputScript, 'base64')))
    const payload = JSON.parse(state.payloadPublic)
    const declared = `${payload.profile}@${payload.profile_version}`
    if (!isRetiredProfile(declared)) continue
    const entry = passports.get(state.passportId) ?? { passportId: state.passportId, profiles: new Set(), states: [] }
    entry.profiles.add(declared)
    entry.states.push(`${output.txid}:${output.outputIndex}`)
    passports.set(state.passportId, entry)
  } catch {
    // Not a state this reader decodes, or a payload that is not JSON: it declares no retired profile.
  }
}
await client.close()
for (const { passportId, profiles, states } of passports.values()) console.log(JSON.stringify({ passportId, profiles: [...profiles], states }))
console.log(`${read} tm_dpp outputs read; passports that declare a retired profile: ${passports.size}. Nothing was changed.`)
```

2. Run it where the database is reachable. The preset's bundled MongoDB is reachable only from its own containers, so pipe the script into the index container, which has the same packages and the database settings:

```sh
docker compose -f deploy/compose.yml --env-file deploy/operator.env exec -T overlay node --input-type=module - < list-retired-records.mjs
```

With a managed database, run `MONGO_URL=<connection string> MONGO_DB=<database> node list-retired-records.mjs` from the checkout instead.

3. Open a shell on the index's database, with your own database name in place of `dpp` if `MONGO_DB` differs, and list every row of those passports. Paste the identifiers the script printed into `IDS`:

```sh
docker compose -f deploy/compose.yml --env-file deploy/operator.env exec mongo mongosh dpp --quiet
```

```js
var IDS = [
  // one passport identifier per line, in quotes, from the listing
]
db.dppRecords.find({ passportId: { $in: IDS } }, { _id: 0, passportId: 1, op: 1, txid: 1, outputIndex: 1, spent: 1, timestamp: 1 }).sort({ sequence: 1 }).forEach(printjson)
var txids = db.dppRecords.distinct('txid', { passportId: { $in: IDS } })
printjson({
  records: db.dppRecords.countDocuments({ passportId: { $in: IDS } }),
  outputs: db.overlayOutputs.countDocuments({ topic: 'tm_dpp', txid: { $in: txids } }),
  outputsOfOtherTopics: db.overlayOutputs.countDocuments({ topic: { $ne: 'tm_dpp' }, txid: { $in: txids } }),
  transactions: db.overlayTransactions.countDocuments({ txid: { $in: txids } }),
  appliedMarkers: db.overlayAppliedTransactions.countDocuments({ topic: 'tm_dpp', txid: { $in: txids } }),
  anchorsAboutThem: db.attestationAnchorsV1.countDocuments({ subject: { $in: IDS } }),
})
```

A passport is listed whole: every state of its lineage, a state that declares another profile included. Removing part of a lineage would leave the rest pointing at nothing, so the removal below takes whole passports.

## Decide

Compare the two listings with what you know of each record. Stop here if any listed passport describes a real product, if you are unsure of one, or if the counts are not what you expect.

| Finding | Action |
|---|---|
| A passport you want to keep is listed | Leave it out of the list you paste below. It stays indexed and readable |
| `outputsOfOtherTopics` is not zero | Expected only for a transaction that carries an anchor as well. Its bytes are kept |
| `anchorsAboutThem` is not zero | Claims about these passports were anchored. The anchors stay: they are a registry's records |
| The index is not yours | Stop. Ask its operator. An index's retraction route refuses a state the network took, so no request of yours removes one |
| Your index exchanges records with peers | Clear each of your own indexes. A peer that still holds a state offers it again at the next synchronisation round |

## Remove the listed records

This is a separate step, and it cannot be undone except from the backups. Run it only after the listings and the decision above, with the identifiers you reviewed.

### From the index

1. Stop the index and leave its MongoDB running, so no request races the removal:

```sh
docker compose -f deploy/compose.yml --env-file deploy/operator.env stop overlay
```

2. In the database shell from the listing step, `IDS` must hold only the passports you decided to remove. If you took one off the list, paste the `IDS` block of the listing step again with the shorter list: the shell blocks on this page declare their names with `var`, so a block pasted again in the same shell replaces what it declared before. Then run:

```js
(() => {
  if (IDS.length === 0) throw new Error('IDS is empty: paste the reviewed passport identifiers first')
  const txids = db.dppRecords.distinct('txid', { passportId: { $in: IDS } })
  const removed = {
    records: db.dppRecords.deleteMany({ passportId: { $in: IDS } }).deletedCount,
    outputs: db.overlayOutputs.deleteMany({ topic: 'tm_dpp', txid: { $in: txids } }).deletedCount,
    appliedMarkers: db.overlayAppliedTransactions.deleteMany({ topic: 'tm_dpp', txid: { $in: txids } }).deletedCount,
  }
  // The bytes of a transaction are kept while another output of it is still indexed.
  const stillIndexed = db.overlayOutputs.distinct('txid', { txid: { $in: txids } })
  removed.transactions = db.overlayTransactions.deleteMany({ txid: { $in: txids.filter((txid) => !stillIndexed.includes(txid)) } }).deletedCount
  printjson(removed)
})()
```

3. Start the index again:

```sh
docker compose -f deploy/compose.yml --env-file deploy/operator.env start overlay
```

### From the application

In the application's database shell, paste the same reviewed identifiers. The block refuses a passport that does not declare a retired profile:

```js
var RETIRED = ['battery@2', 'battery@3', 'battery@4', 'textile@1', 'textile@2', 'textile@3', 'textile@4']
var REVIEWED = [
  // one passport identifier per line, in quotes
]
;(() => {
  if (REVIEWED.length === 0) throw new Error('REVIEWED is empty: paste the reviewed passport identifiers first')
  const others = db.passports.countDocuments({ passportId: { $in: REVIEWED }, profile: { $nin: RETIRED } })
  if (others > 0) throw new Error(`${others} listed passports do not declare a retired profile: take them off the list`)
  printjson({
    claims: db.claims.deleteMany({ passportId: { $in: REVIEWED } }).deletedCount,
    offers: db.offers.deleteMany({ passportId: { $in: REVIEWED } }).deletedCount,
    passports: db.passports.deleteMany({ passportId: { $in: REVIEWED }, profile: { $in: RETIRED } }).deletedCount,
  })
})()
```

The application needs no restart. It reads its journal at each request.

## Check the result

1. Run both listings again. The application's lists none of the removed passports, and the script ends with a count that no longer includes them.
2. Look one up on your index. `POST /lookup` for its identifier returns no outputs:

```sh
curl -s -X POST http://localhost:8080/lookup -H 'Content-Type: application/json' -d '{"service":"ls_dpp","query":{"passportId":"<passport identifier>"}}'
```

3. Look up a passport you kept. It answers as before.

Stop and restore from the backups if a kept passport no longer answers or a count differs from the listing.

## What cannot be removed

| What | Why |
|---|---|
| The transactions on the blockchain | A mined transaction is permanent. Clearing your stores makes a record no longer indexed and no longer shown by you. Anyone who holds its transactions can still decode and verify it |
| Copies other parties hold | Another index, a peer, an exported evidence package or a registry keeps what it was given |
| The identifiers | A passport identifier that was issued is used. Do not issue it again under another profile |
| The retired definitions | The manifests and schemas stay in `@bsv/dpp-profiles`, byte for byte, so a record that declares one can always be named for what it is |

## Next

Write new battery and textile passports under `eu-battery@1` and `eu-textile@1` ([EU battery and textile bindings](../profiles/eu-sector-bindings.md)), and finish the upgrade with [move off the retired sector profiles](../migration.md#move-off-the-retired-sector-profiles).
