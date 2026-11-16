# EPCIS source exchange

Teams with EPCIS 2.0 events from manufacturing, logistics or traceability systems can use this guide to retain unchanged source evidence beside a passport. Imports never write passport states.

Electronic Product Code Information Services (EPCIS) is the GS1 standard for observations such as making, packing or shipping an item. The profiles:

| Profile | Result | Status |
|---|---|---|
| `epcis-json@1` | Retains EPCIS 2.0.1 JSON or JSON-LD exactly as received, with its validation findings, event digests and arrival classification. | Current |
| `epcis-vsc@1` | Maps events to unsigned SEALs, the Verifiable Supply Chain (VSC) profile's event credentials. A separately authorised issuer may sign them. | Parked |
| `epcis-vsc@2` | Maps the same way after deciding each CBV 2.0 disposition through a published crosswalk, refuses error declarations, and names why an event has no SEAL. | Parked, never current |
| `epcis-event-vc@1` | Signs an event as it stands, as a W3C credential keyed by its CBV 2.0 Event Hash ID, with the party's own key, for anchoring beside a passport. | Parked |

`@bsv/dpp-credentials` implements `epcis-json@1` in two entry points. `./epcis-source` holds the pure pieces: strict parsing, validation, digests and arrival classification. `./epcis-exchange` is the durable part: it imports a file into storage you supply, records how each event arrived, and exports the original bytes ([import, retain and export](#import-retain-and-export)). It also pulls pages of events from a source through the standard events query, and gives each page to the same import ([pull events from a source](#pull-events-from-a-source)). And it takes a store out as a recovery snapshot and restores it into another store ([move an exchange to another store](#move-an-exchange-to-another-store)). The two mapping profiles are parked with the VSC profile, and their manifests say so with the status `parked`: no release requires them, the programme does not currently develop them, and from `@bsv/dpp-credentials` 0.2.0-beta.6 their code is no longer in the package ([parked: map events to SEALs](#parked-map-events-to-seals)). The direct route, which signs an event without a mapping, is parked as well ([parked: sign an event](#parked-sign-an-event)).

The current candidate, `dpp-release-2026-11`, carries the `epcis-json@1` source helpers, which are strict parsing under the disclosed limits, validation against the pinned schema, event-body digests and arrival classification. From 12 November 2026 its selection claims no optional profile, so it withholds `epcis-source-import-1`, the claim on those helpers. The earlier `epcis-source-exchange-1`, whose rows also covered the parked `epcis-vsc@1` mapping, moved to the ledger archive the same day. The durable import record, the separation from token operations and the pull client are left out of `epcis-source-import-1`. From 14 November 2026 the package's `./epcis-exchange` tests exercise all three in public, the pull client against a fixture server the tests start on the local machine. Their ledger rows stay tested.

## Inputs and runtime

| Exercise | Input and source |
|---|---|
| All local commands | Node 22 or later, npm and a checkout with `npm ci` and `npm run build` completed through [setup](../quick-start.md#get-the-code). Run from its root. |
| Fixture exercises | Checkout fixture `fixtures/vectors/dpp/interoperability/epcis/v1.json`. Every identifier is synthetic; no keys are required. Nothing is signed or issued. |
| GS1 files | The pinned EPCIS 2.0.1 schema is GS1's and is not in the repository or the package. Obtain it once with `node packages/dpp-credentials/dist/gs1-artefacts-cli.js fetch`, which requests `https://ref.gs1.org/` and checks every byte against a pinned digest; later runs are offline. [GS1 files](../packages/dpp-credentials.md#gs1-files) covers the folder, the environment variable and the route without network access. |
| Own-document exercise | An EPCIS 2.0.1 `<document.json>` from your source system. |

## Parse and validate

1. Parse to establish what arrived and each event's location.
2. Validate structure against the pinned EPCIS 2.0.1 schema. If the schema has not been provisioned, validation throws `Gs1ArtefactUnavailableError` and returns no findings; the document is neither passed nor failed.

Run the fixture parse and validation:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseEpcisSource, validateEpcisDocument } from '@bsv/dpp-credentials/epcis-source'
const fixture = JSON.parse(readFileSync('fixtures/vectors/dpp/interoperability/epcis/v1.json', 'utf8'))
const vector = fixture.vectors.find(item => item.id === 'five-event-document')
const bytes = new TextEncoder().encode(JSON.stringify(vector.input.document))
const parsed = parseEpcisSource(bytes, { mediaType: vector.input.media_type })
assert.equal(parsed.ok, true)
const validation = validateEpcisDocument(parsed.document, { events: parsed.events })
assert.equal(validation.schema, 'pass')
console.table(parsed.events.map(({ pointer, type }) => ({ pointer, type })))
JS
```

| Expected output | Meaning |
|---|---|
| Schema validation passes | Document meets the pinned structural rules. |
| Seven table rows | JSON pointers and types, from `/epcisBody/eventList/0`, a `TransformationEvent`, to `/epcisBody/eventList/6`, an `ObjectEvent`. |
| Vector named `five-event-document` | Seven is still the expected count. |

This example encodes a synthetic fixture object. An importer must retain actual received bytes, rather than serialise a parsed object and call it the original.

The two calls above keep nothing. To retain a source, use the import below.

## Import, retain and export

`@bsv/dpp-credentials/epcis-exchange` imports one EPCIS file, keeps its exact bytes and a record of what it held, and gives the bytes back unchanged. Loading it starts nothing: it opens no database, reads no file and reaches no network. You hand each function the storage it works on. A page pulled from a source goes through this same import ([pull events from a source](#pull-events-from-a-source)).

| It does | It does not |
|---|---|
| Retain the exact bytes of a file under their SHA-256, with an import record | Run an EPCIS repository, or stand in for one |
| Classify each event against what the same source already holds | Capture events: it has no capture interface |
| Record a decision about a conflict without changing either body | Subscribe to a source, or crawl one. A pull is a bounded run that you start |
| Keep a rebuildable index from identifiers to events, with each role | Map an event to a credential, or publish one |
| Export the original bytes, byte for byte | Sign, issue, anchor, or write `ISSUE`, `UPDATE`, `TRANSFER` or `RETIRE` |

An import is data. A document that passes validation is a valid document. It proves nothing about who made it or who observed an event, and no result of this module says a source is signed or authentic.

### Import a file

Run this from the checkout root after `npm ci` and `npm run build`, with the GS1 files provisioned. It imports the fixture into memory, repeats the request, and exports the original:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createMemoryEpcisStorage, exportEpcisSource, importEpcisSource } from '@bsv/dpp-credentials/epcis-exchange'

const fixture = JSON.parse(readFileSync('fixtures/vectors/dpp/interoperability/epcis/v1.json', 'utf8'))
const vector = fixture.vectors.find(item => item.id === 'five-event-document')
const bytes = new TextEncoder().encode(JSON.stringify(vector.input.document, null, 2))

const storage = createMemoryEpcisStorage()
const request = {
  storage,
  sourceId: 'supplier-a',            // the configured origin the events are scoped under
  requestId: 'delivery-2026-03-10',  // your identifier for this request
  bytes,
  mediaType: vector.input.media_type,
  receivedAt: new Date().toISOString(),
  provenance: { kind: 'file', filename: 'events.jsonld' },
  policy: { policyId: 'example-policy@1' },
}
const first = await importEpcisSource(request)
assert.equal(first.outcome, 'retained')
assert.equal(first.record.documentValidity, 'valid')
console.table(first.record.events.map(({ eventType, identityKind, arrival }) => ({ eventType, identityKind, arrival })))

const again = await importEpcisSource(request)
assert.equal(again.replayed, true)
assert.equal(again.record.importId, first.record.importId)

const exported = await exportEpcisSource(storage, first.record.importId)
assert.deepEqual([...exported.bytes], [...bytes])
console.log(exported.kind, exported.sha256 === first.record.sha256)
JS
```

| Expected output | Meaning |
|---|---|
| Seven table rows, each `arrival` `new` | Every event was recorded as a first observation. Six carry an `eventID`; the last has a `local` identity. |
| `original true` | The export is the retained original, and its digest is the one the record holds. |

`importEpcisSource` answers one of three outcomes:

| Outcome | What happened | What is kept |
|---|---|---|
| `refused` | The bytes were unsafe to parse, over a limit or of another media type; or the request was malformed; or the pinned GS1 schema is not provisioned. `reason` names it, `limits` gives the limits in force, and `remedy` says how to provision. | Nothing. No bytes, no record, no side effect. |
| `request-conflict` | The `requestId` is already bound to other bytes under this `sourceId`. | Nothing new. The earlier import stands. |
| `retained` | The document parsed safely. `record.documentValidity` says whether it is `valid`. | The exact bytes and the import record. |

A document that parses safely and then fails the schema, an envelope check or an identifier check is retained as `invalid`, with its findings. It is evidence that was received. It is left out of the associations index and of anything described as valid. A refusal and a retained failure are different things: one leaves nothing, the other leaves the source and what was found in it. A record keeps at most 1000 findings. When a document produced more, validity was still decided on all of them, and the last finding kept says how many there were.

Refusals beyond those of [parse and validate](#parse-and-validate): `too-many-contexts` and `contexts-oversized` for the two context limits, `no-canonical-form` for a string with an unpaired surrogate, `gs1-artefact-unavailable`, and `invalid-request`. Nothing is fetched, so a context is counted as it is declared: each distinct one once, and an inline one by the bytes of its canonical form. The fetch and pull limits are recorded with the import and apply to nothing in a file import. Provenance is recorded as given, so the module accepts exactly two shapes and refuses an unknown member. A file has `kind: 'file'` and an optional file name, which is never an address or a query. A page of a query has `kind: 'query'`, the origin it was asked of, the standard query parameters that were sent and its page number. `pullEpcisEvents` writes the second; an import record of a page reads `complete: false`, because one page is never the whole answer.

### One request, one receipt

A `requestId` is unique within its `sourceId`. The record binds it to `requestDigest`: SHA-256 over the canonical form of the source identity, the media type, the exact length and the SHA-256 of the bytes. Receipt time, provenance and policy are not part of it.

| A request arrives | Answer |
|---|---|
| A `requestId` not seen under this `sourceId` | A new import |
| The same `requestId` with the same bytes and media type | The same import, `replayed: true`. Nothing is written again |
| The same `requestId` after an earlier call stopped part-way | The same import, finished, `resumed: true` |
| The same `requestId` with other bytes or another media type | `request-conflict` |
| The same bytes under another `requestId` | A second import of the same source. The bytes are held once, and its events are duplicates |

### How each event arrives

Every event has an identity within its source: its own `eventID`, or a local identity for an event that declares none. The two kinds are kept apart, so an `eventID` written to look like a local identity is still an `eventID`. Neither is a CBV Event Hash ID, and the module computes none. Two sources that use one `eventID` are never merged.

| `arrival` | When | What is written |
|---|---|---|
| `new` | The source holds nothing under the identity | An observation |
| `duplicate` | A held observation has this body, record time and error declaration | Nothing. The record names the observation it repeats |
| `new-observation` | A held observation has this body, with another record time or error declaration | A further observation. The earlier one is not replaced |
| `conflict` | No held observation has this body | A further observation. The import is `blocked` while the conflict is open |

Nothing overwrites a source. An error declaration arrives as a further observation of the event it repeats, and is retained exactly as written. It reads `resolved` only when every corrective event it names is held under the same source, in the same document or an earlier one.

`getEpcisConflict` lists the bodies, the observations and the decisions held under one identity. `resolveEpcisConflict` records a decision: what was decided, a disposition (`body-selected`, `all-retained` or `none-relied-on`), the time, and a reference to every competing observation. It changes and removes no observation and no source. A decision cannot be rebuilt from any source, so it is its own versioned record, appended and never edited. It covers the bodies held when it was made: a repeat of one of them stays settled, and a body that arrives later reopens the conflict.

### Find the events an identifier takes part in

`findEpcisAssociations` answers which events name an identifier, and in which role: an object list, an aggregation or association parent or child, a transaction parent or object, a transformation input or output, or the quantity list beside each. Ask for an `instance` or a `class`, and one never answers for the other: a quantity of a class is not an individual item taking part. An identifier is matched exactly as events write it, so the Digital Link and the URN of one item are two identifiers.

The index is derived. It holds only valid imports and nothing that is not in the import records and the retained bytes. `rebuildEpcisAssociations` rebuilds it from those, to exactly the index that was built as imports arrived.

### Export the original, or a labelled projection

| Call | Answers |
|---|---|
| `exportEpcisSource(storage, importId)` | `kind: 'original'`: the retained bytes exactly as received, their media type and digest. It answers the original or nothing, and throws if the stored bytes no longer match the recorded digest. |
| `deriveEpcisEventProjection(storage, importId)` | `kind: 'derived'`: a generated view of the events, labelled derived, naming the source it was made from and carrying its own digest. It is not an EPCIS envelope and is never returned in place of an original. |

### Storage

Storage is injected. `EpcisExchangeStorage` has six methods: `putBytes`, `getBytes` and `deleteBytes` for exact bytes under their digest, and `get`, `list` and `commit` for small JSON records. A `commit` is a batch that is applied completely or not at all, with expectations that refuse a stale write.

| Adapter | Use |
|---|---|
| `createMemoryEpcisStorage()` | Tests and trials. Everything is lost when the process ends. |
| `openFileEpcisStorage(folder)` | One process, one folder. Atomic file writes and a journal that is replayed when the folder is reopened. A reference adapter, not a database. |
| Your own | Any database that can keep the six promises. |

Records are filed under a kind and a key. The query pull keeps its state under two further kinds, `pull` and `pull-page`, and needed no new method.

The interface alone promises nothing about another database. A type cannot check that a batch is atomic or that a write is durable before it is answered. Each adapter must pass the shared adapter suite, which the package ships so that you can run it against yours:

```js
import { epcisStorageAdapterSuite } from '@bsv/dpp-credentials/epcis-exchange'

// open() is called again after each simulated crash and must then open the same durable state.
const harness = () => ({ open: () => openMyStore(), abandon: (store) => store.dropWithoutClosing(), destroy: () => removeMyStore() })
for (const test of epcisStorageAdapterSuite(harness)) it(test.name, test.run)
```

The suite holds an adapter to each promise, then runs imports, a conflict decision and an index rebuild over it. It stops the store before and after every durable call, reopens it, and checks that no acknowledged source was lost, that nothing is half recorded, and that finishing the work gives exactly the store an uninterrupted run gives. It uses `node:assert` and no test framework. `runEpcisStorageAdapterSuite` runs it from a script.

For an adapter over a database, the application starter carries one for MongoDB on a single node, where no multi-document transaction is available, and runs this suite against it ([the MongoDB storage adapter](../packages/create-dpp-app.md#the-mongodb-storage-adapter)).

### Recovery

An import takes these durable steps in order. Success is acknowledged only after the last.

| Step | What is durable | If the process stops here |
|---|---|---|
| 1. Intake noted | A journal entry. No bytes, no record | Nothing was acknowledged. Recovery discards the entry |
| 2. Bytes | The exact bytes under their digest | Nothing was acknowledged. Recovery removes the bytes, unless another import holds the same ones |
| 3. Receipt | The import record in state `received`, in one batch with its hold on the bytes | The source is held. Recovery, or the same request again, finishes it |
| 4. Event results | Every new observation and the record in state `evaluated` or `blocked`, in one batch | Recovery finishes the index |
| 5. Index entries | The associations, in bounded batches | Recovery writes them again, which changes nothing |
| 6. Journal cleared | Nothing is pending | The same request again answers the import |

Call `recoverEpcisExchange(storage)` when you open a store, before you accept an import. It finishes or discards what a stopped process left and reports each action. It assumes no other call is in flight on the store, and it is the only place bytes are ever removed: an import never deletes any, because another import may be about to hold them.

One process writes to a store at a time. Calls on one storage object are taken in turn, and the file adapter locks its folder. Every batch carries expectations, so two writers that do share a database cannot record contradictory results: the one that loses classifies again, or answers the other's import. Run recovery only while no writer is active. `checkEpcisExchangeInvariants(storage)` lists every breach of these promises, and lists none on a sound store.

Every durable record carries its own version and has a JSON Schema: the import record in `contracts/epcis-import.schema.json`, version 2, and the observations, decisions, index entries, journal, pull records, page records and the records of a restore in `contracts/epcis-exchange-records.schema.json`. A record stored under version 1 of the import contract validates under `contracts/epcis-import-v1.schema.json`.

### The complete exercise

[examples/import-epcis.mjs](https://github.com/bsv-blockchain/dpp/blob/588fbf7f23fd60122f515d47f2aa675d8a16f290/examples/import-epcis.mjs) imports a document with the module and reports one sentence per finding: the retained digest, the request digest, validity, and each event's identity, body digest and arrival. It then repeats the request, exports the original and shows the bytes are unchanged. It maps nothing. Run the fixture:

```sh
node examples/import-epcis.mjs
```

Or supply your EPCIS 2.0.1 document:

```sh
node examples/import-epcis.mjs <document.json>
```

Add `--store <folder>` to keep the import in a folder; a second run is then answered from the first. Without it the import is held in memory and is gone when the run ends.

It ends `No event was mapped`, naming the parked mapping and the `not-attempted` outcome the import record carries, then `Nothing was signed, issued, anchored or written to a token by this example. An import is data, and proves nothing about who observed an event.`

## Pull events from a source

`pullEpcisEvents` asks a source for events through the standard events query, `GET /events` of the GS1 EPCIS 2.0 REST binding, and retains what it is given. It is a client of that interface. It is not an EPCIS repository, it captures nothing, and it never says it holds the complete history of a source.

| It does | It does not |
|---|---|
| Make one bounded run each time you call it | Run in the background, subscribe or crawl |
| Hand every page to `importEpcisSource`, so a page is refused, retained and classified exactly as a file is | Parse or keep a page any other way |
| Move its checkpoint only after a page is retained | Point past a page it does not hold |
| Continue from its checkpoint after a restart or a crash | Start again as a new source |
| Say whether the source's pages were exhausted, a limit stopped the run or the run failed | Report a partial history as complete |

### Configure a source

A source is configuration on your server. Nothing in it comes from a request.

| Member | Meaning |
|---|---|
| `sourceId` | The name events are scoped under. Two sources that use one `eventID` are never merged. |
| `baseUrl` | The address the query is made under: `<baseUrl>/events`. No user information, query or fragment. Leave it out when no EPCIS link is known, and the run answers `source-link-missing`. |
| `permittedOrigins` | Every origin a request may be made to, the base address's own included. A redirect or a next page anywhere else is refused before it is requested. |
| `policy` | The named operator policy and the limits it sets ([limits and overrides](#limits-and-overrides)). |
| `credentials` | A function that obtains the credential, never the credential itself ([credentials](#credentials)). |
| `localTest` | Permits plain `http` and private addresses. For a source on your own machine only. Every result records it. |
| `wireVersions` | The values sent in `GS1-EPCIS-Version` and `GS1-CBV-Version`, when not the defaults ([what is sent](#what-is-sent-and-what-is-checked)). |
| `repeatListParameters` | Sends each value of a list as its own parameter. Off by default, and a recorded leniency when on ([what is sent](#what-is-sent-and-what-is-checked)). |

A pull is one configured query against one source. You name it with a `queryId`, unique within the `sourceId`, and the name is bound to the source, the base address, the query and the overlap margin. The same `queryId` with another definition is refused as `pull-conflict`. Limits, permitted origins, credentials, the versions sent and how a list is written are not part of the binding, so an operator can change them without making a new source.

```js
import { openFileEpcisStorage, pullEpcisEvents, recoverEpcisExchange } from '@bsv/dpp-credentials/epcis-exchange'

const storage = await openFileEpcisStorage('./epcis-store')
await recoverEpcisExchange(storage)

const result = await pullEpcisEvents({
  storage,
  source: {
    sourceId: 'supplier-a',
    baseUrl: 'https://events.example.org/epcis',
    permittedOrigins: ['https://events.example.org'],
    policy: { policyId: 'supplier-a-policy@1' },
    credentials: async () => ({ scheme: 'bearer', token: await readSecret('supplier-a') }),
  },
  queryId: 'pack-history',
  query: { matchAnyEPC: ['urn:epc:id:sgtin:9521234.012345.SER1'], recordTime: { from: '2026-03-01T00:00:00.000Z' } },
  fetch,
})
console.log(result.outcome, result.reason, result.completion, result.events)
```

The transport is handed in as `fetch`. The module never reaches for a transport of its own and opens no connection itself. `readSecret` stands for however your server keeps secrets.

| Query member | Sent as | Selects |
|---|---|---|
| `matchAnyEPC` | `MATCH_anyEPC` | Events that name any of these identifiers |
| `eventTypes` | `eventType` | Event types |
| `eventTime.from`, `eventTime.until` | `GE_eventTime`, `LT_eventTime` | Event time, from inclusive, until exclusive |
| `recordTime.from` | `GE_recordTime` | Events the source recorded at or after a time |
| `eventIds` | `EQ_eventID` | Exactly these events: an explicit refresh |
| `perPage` | `perPage` | Page size. The page event limit in force by default |

No other parameter is sent. The profile selects no upper bound on record time.

### Run the example

`examples/pull-epcis.mjs` starts a stand-in source on `127.0.0.1`, pulls the seven events of the fixture from it in pages of three, pulls again, and stops the stand-in. The stand-in is not an EPCIS repository. Run it from the checkout root after `npm ci` and `npm run build`:

```sh
node examples/pull-epcis.mjs
```

| Expected output | Meaning |
|---|---|
| Three pages, `3 new`, `3 new`, `1 new` | Every page was imported, with provenance `query` and its page number. |
| `Outcome: ok (exhausted)` | The source named no further page. The lines that follow still say why this is not complete history. |
| After `Pulling again`, three pages with `0 new` | The second run began the next pass and recognised what it held. The bytes were the same, so no second import was written. |

The example keeps the pull in memory, because its stand-in has a new address on every run and a pull is bound to the address of its source. With a durable store, as in the call above, a later run continues the same pull.

### What a run retains

| Record | Kept |
|---|---|
| The page | The exact bytes and an import record, through `importEpcisSource`. `sourceLocation` says `query`, the origin, the standard parameters sent and the page number. |
| The page record | One per acknowledged page, in order: the import that holds it, its digest, how its events arrived, the versions the source reported and any leniency it needed. |
| The pull record | The source scope without credentials, the query and its bounds, the limits in force and each override, the status, the pass under way, the checkpoint, the watermark and how the latest run ended. |

A run takes these durable steps in order.

| Step | What is durable | If the process stops here |
|---|---|---|
| 1. Run begun | The pull record, status `running` | The next run continues from the checkpoint |
| 2. Page noted | In the pull record: what was read and where the next page is. The bytes are still in memory | Nothing of the page is held. The next run asks for it again |
| 3. Import | The six steps of [recovery](#recovery) | With a receipt held, the next run finishes the page from the retained bytes and does not ask the source again |
| 4. Checkpoint | The page record and the pull record moved past the page, in one batch | The page is acknowledged. The next run asks for the page after it |
| 5. Run ended | The pull record, with the outcome | The same pull again begins or continues as its state says |

The checkpoint is step 4 alone, and it follows the import. So the pull record never points past a page that is not retained, and no page is acknowledged twice. `checkEpcisExchangeInvariants` lists a breach if it ever does.

### Passes, checkpoints and replay

A pull lives as long as you keep calling it. It moves in passes: one pass walks the source's pages for one window of the query, over as many bounded runs as that takes.

| You call `pullEpcisEvents` | It does |
|---|---|
| For a `queryId` not seen under the source | Begins pass 1 at the query's own bounds |
| While a pass is unfinished | Continues from the checkpoint. `run.resumed` is `true` |
| After a pass was exhausted | Begins the next pass. Its record-time bound is the watermark less the overlap margin |
| After a pass was exhausted, with `window: 'query-bounds'` | Begins the next pass at the query's own bounds again |

The watermark is the latest record time seen when a pass was exhausted. The overlap margin, `recordTimeOverlapSeconds`, is 300 seconds by default and at most one day. Events inside the margin are read again and recognised as duplicates. A watermark only bounds the next request. It is not evidence that every correction arrived: a source can record an error declaration with any time. To check the events that matter, refresh them by identifier, with a query of its own under the same `sourceId`:

```js
await pullEpcisEvents({ storage, source, queryId: 'refresh-2026-03-10', query: { eventIds: ['urn:uuid:00000000-0000-4000-8000-000000000003'] }, fetch })
```

A refresh keeps no watermark and asks for exactly its events every time. A changed record time or error declaration arrives as `new-observation`, and a changed body as `conflict`, as in [how each event arrives](#how-each-event-arrives).

A cursor is the next page as the source named it. When it cannot be reused, the pass is replayed from its retained bounds.

| The cursor | Replay reason |
|---|---|
| Is past the expiry the source stated in `GS1-Next-Page-Token-Expires` | `cursor-expired`. The expired cursor is not sent |
| Is answered with status 400, 404 or 410 | `cursor-rejected` |
| Is absent though pages were acknowledged | `cursor-missing` |

A replay is the same pull and the same pass, with `attempt` one higher. It asks the first page again and reads forward, so it never skips a page it had not acknowledged. What is already held is recognised: a page with the bytes of one the pull holds answers that import and writes no second one, and any other page is imported and its events are classified as duplicates. A run replays once. A second cursor that cannot be reused ends the run as `cursor-unusable`.

### Outcomes

Every run answers one of the eight source outcomes, a `reason` that names the cause, and a `completion`: `exhausted`, `stopped-at-limit` or `failed`. `exhausted` is true only when the source named no further page. `completenessLimits` is never empty: it lists every reason the retained events are not the complete history of the source.

| Outcome | Reason | When |
|---|---|---|
| `ok` | `exhausted` | The source named no further page. A query that matched nothing is `ok` with no events |
| `partial-history` | `page-limit`, `byte-limit`, `time-limit` | A run limit was reached and the source had more. Call again to continue |
| `partial-history` | `cursor-unusable` | A second cursor could not be reused in one run |
| `partial-history` | `pagination-malformed` | The next link could not be read, named two pages, or named a page already read. The page that carried it is retained |
| `partial-history` | `pagination-target-refused` | The next page is at an address that is not permitted. The page that named it is retained |
| `source-link-missing` | `no-base-address` | The source has no base address. Nothing was requested or written |
| `source-authentication-required` | `http-401` | The source demanded credentials, or refused the ones it was sent |
| `source-forbidden` | `http-403` | The source refused this caller |
| `source-unavailable` | `timeout`, `network-error`, `http-error` | The source did not answer in time, could not be reached, or answered another status than 200 |
| `source-unavailable` | `redirect-refused`, `redirect-limit`, `redirect-malformed` | A redirect led to an address that is not permitted, there were more than three, or one had no usable location |
| `source-unavailable` | `target-refused` | The base address is not permitted: plain `http`, a private address or an origin that is not listed |
| `unexpected-media-type` | `media-type`, `html-body` | The answer was not JSON or JSON-LD, or was an HTML page under a JSON media type. An HTML sign-in page with status 200 is this |
| `invalid-source` | `page-oversized` | The page passed the page byte limit and was abandoned while it was read |
| `invalid-source` | `wire-version-missing`, `wire-version-unsupported` | The source sent no `GS1-EPCIS-Version`, or named a version other than 2.0 |
| `invalid-source` | `credential-echoed` | The answer carried the credential the source was sent |
| `invalid-source` | `import-refused` | The import refused the page before retention. `importRefusal` names why, such as `malformed-json` or `too-many-events` |

A page that is refused leaves nothing: no bytes, no record, no observation. A request that is malformed is `refused` before anything is requested or written, as `invalid-request`, `pull-conflict`, `gs1-artefact-unavailable` or `credentials-unavailable`.

### Limits and overrides

| Limit | Default | Ceiling |
|---|---|---|
| `maxDocumentBytes`, a page | 2 MiB | 16 MiB |
| `maxEventsPerPage` | 100 | 1000 |
| `maxJsonDepth` | 64 | 128 |
| `maxContextDocuments` | 16 | 64 |
| `maxContextBytes` | 1 MiB | 4 MiB |
| `fetchTimeoutMs`, one page with its redirects and body | 10 seconds | 60 seconds |
| `maxPullPages`, a run | 10 | 100 |
| `maxPullBytes`, a run | 20 MiB | 200 MiB |
| `maxPullSeconds`, a run | 60 | 600 |

An operator sets a limit in `source.policy.limits`. A value past its ceiling is refused, not clamped. The ceilings are this package's own; the profile only says a raised limit is bounded. Every result carries `limits`, the limits in force, and `limitOverrides`, each limit set away from its default, and the pull record keeps both.

### Credentials

- `credentials` is a function. It is called once as a run begins, on your server, and the credential is held in memory for that run.
- It answers `{ scheme: 'bearer', token }`, `{ scheme: 'basic', username, password }` or `{ scheme: 'header', name, value }`.
- The credential is sent to the base address's origin and to no other. A second permitted origin is reached without it.
- It is written nowhere: no record, result, log entry, error message or export carries it. The pull record keeps only `credentialsConfigured`.
- Whatever a source sends back is searched for it. An answer that carries it, in a redirect, a next link or a body, is refused as `credential-echoed`.
- A secret shorter than eight characters is refused, because it cannot be told from ordinary text when an answer is searched.

### Hostile and broken sources

| The source | The run |
|---|---|
| Redirects | Follows at most three, by hand, and checks each address against the permitted origins before requesting it |
| Names a next page | Checks its address the same way, before recording it and again before using it |
| Sends a page past the limit, or a compressed page that expands past it | Counts the bytes as they arrive and abandons the page at the limit. A declared length past the limit is refused unread |
| Answers HTML with status 200 | `unexpected-media-type`, with nothing retained |
| Does not answer, or stops part-way | `timeout`, at the fetch limit |
| Names a host that resolves to a private address | Refused when you pass `resolveHost`. Without it only literal addresses and reserved names are caught, so list only origins whose names you trust, and have your transport connect to the address that was checked |

### What is sent and what is checked

| Header | Sent | Checked on the answer |
|---|---|---|
| `GS1-EPCIS-Version` | `2.0.1` | Required, and must name 2.0 or a patch of it. A document's `schemaVersion` is never read in its place |
| `GS1-CBV-Version` | `2.0.0` | Must name 2.0 or a patch of it when present |
| `Accept` | `application/ld+json, application/json` | The answer's media type must be one of the two |

The two versions are the ones this package pins, exported as `EPCIS_VERSION` and `CBV_VERSION`, each with three parts as GS1's interface description gives them. The files a page is validated against are those of EPCIS 2.0.1, so that is what a request names. Set `wireVersions.epcis` or `wireVersions.cbv` on a source that needs another value. The pull record keeps what was sent in `source.wireVersions`.

A list, such as two identifiers for `MATCH_anyEPC`, two event types for `eventType` or two identifiers for `EQ_eventID`, is sent as one parameter with its values separated by `|`. That is how GS1's interface description declares a list, and it is the default.

Some sources read only a repeated parameter, `eventType=ObjectEvent&eventType=AggregationEvent`, and answer a server error to the pipe-delimited form. For such a source set `repeatListParameters: true`:

```js
source: {
  sourceId: 'supplier-a',
  baseUrl: 'https://events.example.org/epcis',
  permittedOrigins: ['https://events.example.org'],
  policy: { policyId: 'operator@1' },
  repeatListParameters: true,
}
```

- The option is per source and off by default.
- It changes only how a list is written into the address of a query's first page. A next page is asked for at the address the source itself named.
- What is recorded keeps one form. The query, the pass and each page's provenance hold a list as one value separated by `|`, whatever was sent.
- The pull record says so in `source.repeatListParameters`, and each page and the result carry the leniency `list-parameters-repeated`.
- A query with one value in each list is sent the same either way, so it records no leniency.

### Leniencies

Sources differ in small ways. These departures from a strict reading are accepted, and each is recorded on the page record and in the result's `leniencies`.

| Leniency | Accepted | Why it weakens nothing |
|---|---|---|
| `link-relation-unquoted` | A `Link` header that writes `rel=next` without quotes | The target is read and checked exactly as a quoted one is |
| `next-page-token-numeric` | A next page token that is a bare number | A token is opaque to a client. It is sent back as it was given |
| `cbv-version-header-absent` | An answer without `GS1-CBV-Version` | The page is still validated against the pinned schema, and vocabulary values are retained as written |
| `empty-final-page` | A full last page followed by an empty page | The empty page is retained like any other, and the pass ends where the source said it ends |
| `cursor-expiry-unreadable` | A `GS1-Next-Page-Token-Expires` that is not a date | The cursor is used until the source rejects it, which leads to a replay |
| `list-parameters-repeated` | Nothing from the source: you configured `repeatListParameters`, and a list of two or more values was sent as repeated parameters | The same values select the same events. Only their spelling in the address differs, and the record keeps the one form |

The first five are met in what a source sends. The last is the one you switch on, for a source that reads only that form. None of them changes what is retained: every page is still held to the same limits, the same strict parse and the same schema, and its exact bytes are kept. An answer without `GS1-EPCIS-Version` is not accepted.

### Try it against your own endpoint

`scripts/epcis-pull-interop.mjs` runs one pull against an endpoint you name and writes a small JSON report. It is not part of `npm test`, and it refuses to run without an endpoint.

```sh
EPCIS_INTEROP_ENDPOINT=https://events.example.org/epcis EPCIS_INTEROP_BEARER_TOKEN=<token> node scripts/epcis-pull-interop.mjs
```

It prints the version headers the server reported, the query parameters exercised, the pages and events retrieved and the outcome, and writes `epcis-interop-report.json`. The head of the script lists every variable: the credential, the filters, the page size, the local-test option and where the report goes. The credential goes to the endpoint's origin only and is not written to the report. The script captures nothing, so the endpoint must already hold events the query matches.

## Move an exchange to another store

A store holds more than documents. Which request an import answers, how each event arrived, what was decided about a conflict and how far a pull got are records no source can rebuild. `exportEpcisRecovery` takes all of it out of one store as a **recovery snapshot**, and `restoreEpcisRecovery` puts it into another: a different folder, a different database or a different adapter. The identities, the receipt times, the decisions and the query bounds arrive as they were. Only where the bytes are kept changes.

| A recovery snapshot | It is not |
|---|---|
| Every retained original, in its exact bytes | Public evidence. It is for the operator authorised to run the exchange; [the public form](#the-public-form) is the other path |
| Every import record, observation, conflict decision, pull record and page record of the source scopes it covers | A second export format. It is files with one inventory entry each, for a `dpp-evidence-package@1` that the exporter assembles and signs |
| A descriptor, `epcis-recovery.json`, naming every file, the scopes, the boundary and what was left out | A carrier of credentials. None is in it, and you configure them again at the destination |
| Taken at one moment, with no unfinished work | The associations index, the retention entries or the journal. The first two are rebuilt at the destination and the journal is empty when a snapshot is taken |

### Take a snapshot

```js
import { exportEpcisRecovery } from '@bsv/dpp-credentials/epcis-exchange'

const snapshot = await exportEpcisRecovery({
  storage,
  // sourceIds: ['factory-a'],        // default: every source scope the store holds
  // cursors: 'include',              // default 'exclude': see "Credentials and cursors"
  // credentials: [configured],       // every exported byte is searched for each, and the export is refused if one is found
})
if (!snapshot.ok) throw new Error(`${snapshot.code}: ${snapshot.detail}`)

snapshot.files      // Map of path to exact bytes, the descriptor included
snapshot.inventory  // one entry per file: path, category, mediaType, byteLength, sha256, represents, representation
snapshot.descriptor // what epcis-recovery.json holds
snapshot.manifest   // what the carrying manifest says beside its inventory: disclosure, snapshots and withheld lines
```

The export changes nothing in the store. The same store gives the same bytes, apart from the time in the descriptor, and the snapshot's identity is the digest of what it carries.

| In the snapshot's folder, `epcis/` by default | Inventory category and `representation` | What it is |
|---|---|---|
| `originals/<sha256>` | `evidence`, `dpp-epcis-original@1` | One retained original, under the media type it arrived with. Bytes two imports share are carried once |
| `records/import/<name>.json` | `reports`, `dpp-epcis-import@2` | An import record: the request binding, the receipt time, the provenance, the policy and every event's result |
| `records/observation/<name>.json` | `reports`, `dpp-epcis-observation@1` | One observation of an event under its source scope |
| `records/resolution/<name>.json` | `reports`, `dpp-epcis-conflict-resolution@1` | A conflict decision. Every observation it names is carried with it |
| `records/pull/<name>.json` | `reports`, `dpp-epcis-pull@1` | A pull: its query and bounds, the limits, how the latest run ended, the pass, the watermark and the checkpoint |
| `records/pull-page/<name>.json` | `reports`, `dpp-epcis-pull-page@1` | One page a pull acknowledged, with the import that holds it |
| `epcis-recovery.json` | `reports`, `dpp-epcis-recovery@1` | The descriptor. Schema: `contracts/epcis-recovery.schema.json` |

Each record file is the record in RFC 8785 canonical JSON, under a name its own content gives. A reader never trusts the name: it works out where a record belongs from what the record says.

A package that carries a recovery snapshot declares disclosure `all-tiers` and `recoveryBackup: true`, which `snapshot.manifest.disclosure` gives you. Add the entries of `snapshot.inventory` to your manifest unchanged, one `completeness.snapshots` entry per source scope and the `withheld` lines, and sign the manifest as you sign any other ([portable evidence](https://github.com/bsv-blockchain/dpp/blob/3f11c0b35300fe2169d7eb9f84d40c7b64a94c55/spec/portable-evidence.md), section 2).

### The boundary

A snapshot must never hold a checkpoint without the imports it stands on, or a decision without the observations it decided between. The storage interface has no snapshot isolation, so the export gets there in three steps.

1. **It takes the store's turn.** No import, conflict decision, index rebuild or recovery of the same process runs while the export reads.
2. **It reads twice.** It reads every record it will carry, reads the retained bytes, and reads the records again. The reading stands only when no work is journalled at either reading and every record is at the same revision both times. A pull moves its checkpoint outside the store's turn, and another process shares none of it, so this is what catches a writer that got in between. The export reads again, up to four times, and then refuses as `store-unstable`.
3. **It checks what it is about to hand over.** The snapshot is laid out by itself and held to `checkEpcisExchangeInvariants`, the same check a store is held to.

It refuses as `unfinished-work` while anything is journalled, and does not finish or discard that work. Run `recoverEpcisExchange` first, as you do when a store is opened. Recovery removes bytes and must run with no other call in flight, which an export cannot promise.

What this assumes, plainly: one process writes to a store. The second reading detects another writer by revision, which every adapter that passes the shared suite keeps. It cannot detect a writer that changes records behind the module's back and puts a revision back where it was. A pull that is under way is not stopped. Its record is carried as it stood, and at the destination it resumes as an interrupted run does.

### Check and restore

```js
import { epcisRecoveryDirectory, restoreEpcisRecovery, verifyEpcisRecovery } from '@bsv/dpp-credentials/epcis-exchange'

const source = epcisRecoveryDirectory('/var/recovery/package')   // or epcisRecoveryFiles(map) for files in memory
const checked = await verifyEpcisRecovery(source, { inventory })  // `inventory`: the entries of the package's signed manifest
if (!checked.ok) throw new Error(`${checked.code}: ${checked.detail}`)

const restored = await restoreEpcisRecovery({ storage: destination, source, inventory })
if (!restored.ok) throw new Error(`${restored.code}: ${restored.detail}`)
restored.outcome      // 'restored', 'resumed' or 'unchanged'
restored.relocations  // where each original went
```

Verify the package's signature and inventory with `inspectEvidencePackage` first, as for any package. The restore then makes its own checks before it writes anything: the descriptor against that inventory, every file against its length and SHA-256, every record against its version and the place its content gives it, and the whole snapshot against the invariants. `verifyEpcisRecovery` makes the same checks with no destination.

The durable steps, in order:

| Step | What is durable | If the process stops here |
|---|---|---|
| 1. Journal `restore` | The store says a restore is unfinished | Run the restore again. `recoverEpcisExchange` reports `restore-pending` and leaves it; an export is refused |
| 2. Originals | Each put, read back from the destination and held to its digest, then its relocation record | The same |
| 3. Imports | Each import with its hold on the bytes and the observations it made, in one batch | The same |
| 4. Decisions | Every conflict decision | The same |
| 5. Pages, then pulls | Every page record, and only then the pull record that holds the checkpoint | The same |
| 6. Index | The associations, rebuilt from what the destination now holds | The same |
| 7. Restore record | Which snapshot was restored, written as the journal entry is cleared | The restore again answers `unchanged` |

A record the destination already holds and that equals the snapshot's is left alone, so a restore that stopped anywhere is run again with the same snapshot and finishes. Restore while nothing else writes to the destination, and accept imports and pulls once it has answered.

### What is preserved and what is relocated

Every logical identity is kept: `sourceId`, `importId`, `requestId`, `requestDigest`, each event's identity and every `resolutionId` and `pullId`. So are the receipt times, the provenance, each event's recorded result and the decisions. A restore re-evaluates nothing: a document is not validated again, and a record says what was recorded when the source arrived.

`bytesRef` is the one member that says where a store keeps bytes, and it is relocated through a checked mapping. Each reference in the snapshot is paired with exactly one original, and each original is given exactly one destination reference: `sha256:<hex>` by default, which is what an import into the destination writes, or what your `locate` function answers.

```js
await restoreEpcisRecovery({ storage: destination, source, inventory, locate: ({ sha256 }) => `vault-b:${sha256}` })
```

The snapshot is never changed. The destination keeps one `epcis-restore` record per snapshot and one `epcis-relocation` record per original, with the reference it was exported under, the file that carried it and the reference the restored records carry. `listEpcisRestores` and `listEpcisRelocations` read them.

### What is refused

Each refusal has its own `code`, and a refusal before step 1 has written nothing.

| `code` | The snapshot or the destination |
|---|---|
| `checkpoint-imports-omitted` | A pull's checkpoint stands on an import or a page record the snapshot does not hold |
| `resolution-observations-omitted` | A conflict decision names an observation the snapshot does not hold |
| `original-missing`, `original-altered` | An original is absent, or is not the bytes it is named by |
| `record-missing`, `record-altered` | A record is absent, changed, or not in the canonical form an export writes |
| `descriptor-inventory-mismatch` | The descriptor and the package's inventory do not name the same files with the same digests |
| `record-version-unknown` | A record is of a version this module does not read. It is never restored as if it were understood |
| `record-misfiled` | A record is of another type, or sits under a name that is not its own |
| `descriptor-missing`, `descriptor-invalid` | There is no descriptor, or it is not a format 1 descriptor |
| `not-a-recovery-snapshot` | The snapshot is the public form |
| `snapshot-inconsistent` | The snapshot breaks an invariant of the exchange when taken by itself; a record of one source scope stands on a record of another; the descriptor's account of a scope or a pull is not what the records say; or a record carries a cursor or a page token the descriptor says was left out, or a cursor whose address holds more than the standard query parameters |
| `relocation-invalid` | The mapping of byte references is not one to one |
| `destination-unfinished-work` | The destination has work journalled, or another restore pending |
| `reconciliation-required` | The destination holds a record that differs from the snapshot's under the same identity |
| `destination-original-unverified`, `destination-inconsistent` | An original did not read back as its digest, or the destination breaks an invariant after the restore. The restore is left unfinished |

`reconciliation-required` lists every collision and writes nothing. A destination that already acknowledged another document under the same source scope and request identifier collides as `request-bound-to-other-bytes`; any other difference is `record-differs`. Nothing is overwritten and nothing is merged: restore into an empty store, or reconcile each collision yourself. Records of another source scope in the destination are left alone, and two scopes are never merged because they use the same event identifier or the same endpoint. Two scopes read from one endpoint hold the same page bytes, each under its own import; a snapshot in which one scope's page names the other scope's import of those bytes, or one scope's observation names an import of the other, is refused as `snapshot-inconsistent`.

### Credentials and cursors

No credential is in a snapshot. A pull record holds only whether one was configured. Before you run a pull at the destination, configure the source there as you did before: its address, its permitted origins and the function that obtains its credential. Until you do, the source answers `source-authentication-required`, and nothing is lost by having asked.

A cursor is the address of the next page, and it may be sensitive. By default a snapshot carries none: not the cursor of a checkpoint, not the one a pending page named, and not the page token in the provenance of a page. That token is the one difference between a stored import record of a pulled page and the exported one. With `cursors: 'include'` they are carried for an operator who will resume against the same endpoint; a cursor whose address holds anything but the standard query parameters is left out even then, and the descriptor says so for that pull. The page tokens that pull's earlier pages were asked for with are standard parameters and are still carried in that mode; take the default if they are not to leave.

A restore holds the records to what the descriptor says of cursors. A snapshot whose descriptor says `excluded` and whose records carry a cursor or a page token is refused, and so is one that carries a cursor with a non-standard address, whatever its descriptor says. What you read in the descriptor before you store or send a snapshot is what the snapshot holds.

`credentials` is a last check, not the protection. Hand the export the credentials the deployment was configured with and it searches every exported byte for each, in the forms a source could echo one in, and refuses as `credential-in-snapshot` naming the file. A source document that quotes your credential is the case it catches.

### Carry on after the restore

- **A retry.** A client that never heard its answer sends the same request to the new store. It gets the same import, with its original receipt time, and no second receipt is written. The same `requestId` with other bytes is still `request-conflict`.
- **An interrupted pull.** Run the same `queryId` under the same `sourceId`. A page that was retained and not yet acknowledged is acknowledged from its receipt. Then the pull continues from its cursor, or, when the cursor was left out, has expired or is rejected by the source, replays the pass from its retained bounds and recognises the pages it already holds. No page is skipped and no new source is begun.
- **A carried cursor the destination does not permit.** A cursor is checked against the permitted origins of the source as you configured it at the destination, before every request. One that names another origin is never requested: the run ends as `partial-history` with the reason `pagination-target-refused`, and it ends that way again until you act. Declare the source's address and permitted origins with `remapEpcisSourceEndpoint`, which drops a cursor they do not permit even when the address is the one the pull is already bound to, and the next run replays the pass from its bounds.
- **A source at another address.** A query name is bound to the address it first ran against, so pointing it elsewhere is refused as `pull-conflict`. When it is the same source, say so once:

```js
import { remapEpcisSourceEndpoint } from '@bsv/dpp-credentials/epcis-exchange'

await remapEpcisSourceEndpoint({ storage, sourceId: 'factory-a', baseUrl: 'https://events.example/epcis', permittedOrigins: ['https://events.example'], remappedAt: new Date().toISOString(), remappedBy: 'operator' })
```

Every pull of the source is bound to the new address and records the change. The source scope, the pull, its pages and every import keep their identities, and each import still names the origin it was really read from. A cursor is kept only when its address is permitted under the new configuration; otherwise it is dropped and the pass replays. Declaring the address a pull is already bound to writes nothing, unless a cursor is not permitted under the origins you declare: then the cursor is dropped and the declaration is recorded. A different source takes its own `sourceId`.

### The public form

`exportEpcisPublicEvidence` gives what a public package may carry. You supply the access policy, because nothing in the module knows which sources you may publish.

```js
import { exportEpcisPublicEvidence } from '@bsv/dpp-credentials/epcis-exchange'

const open = await exportEpcisPublicEvidence({ storage, allow: (record) => publishable.has(record.importId) })
```

It carries each allowed original and its import record with `sourceLocation` reduced to its kind, so no file name, endpoint, query or page token leaves. It carries no observation, no decision and no pull state. Its descriptor says `public-evidence`, claims `bounded` and not recoverable, and a restore refuses it by name. The record still holds the `sourceId`, the `requestId` and the policy identifier: leave an import out with `allow` if those are not yours to publish.

### Limits

- A snapshot is held in memory as it is assembled and as it is restored, with one file and one inventory entry per record. Cover fewer source scopes at a time for a large store.
- A snapshot moves an exchange between stores of this module. Its records carry identifiers the module derives, so it is not a format another implementation of the exchange is expected to read.
- A restore checks records against their versions, their identities and the invariants. It does not run the JSON Schemas at run time; the package's tests hold every exported record to them.
- Nothing stops an import from being accepted while a restore is unfinished. Do not accept any until the restore has answered.

### Run the example

```sh
node examples/recover-epcis.mjs
```

It fills a store in memory with two source scopes that use one event identifier and a decided conflict, takes a snapshot, lists the snapshot's entries in the manifest of a `dpp-evidence-package@1` and signs and inspects that package with `@bsv/dpp-protocol`, restores the snapshot into a folder through the file-system adapter against the signed inventory, retries an acknowledged request there, and then shows the public form and three snapshots refused by name. It reaches no source and needs no credential, and it exits with a failure if any of those answers is not the one named.

## Keep the source with the result

Retain the exact source bytes and their findings with anything derived from them. Never invent a custody event or measurement to complete output.

| Boundary | Rule |
|---|---|
| Import and custody | Imports establish no custody or passport transfer. No import, pull, mapping or export writes `ISSUE`, `UPDATE`, `TRANSFER` or `RETIRE`. The module's tests hold its imports to reaching no signing, wallet or chain code. |
| Validity and origin | A valid document is not a signed one. An import says what arrived, never who observed it. |
| Later passport workflow | May cite retained source when requesting a state. The passport service independently checks tip, actor authority and recipient acceptance. |
| Event body digest | SHA-256 of the event's RFC 8785 canonical JSON without `recordTime` and `errorDeclaration`, together with sorted digests of the contexts used to read it ([specification](https://github.com/bsv-blockchain/dpp/blob/588fbf7f23fd60122f515d47f2aa675d8a16f290/spec/epcis-interoperability.md), section 2). The stripped event alone cannot reproduce it. |

## The application's HTTP routes

| Interface fact | Value |
|---|---|
| Import/pull routes | Reference application routes under `/api/interoperability/epcis`, documented by the reference application. The standard fixes no import routes ([specification](https://github.com/bsv-blockchain/dpp/blob/588fbf7f23fd60122f515d47f2aa675d8a16f290/spec/epcis-interoperability.md), section 4). |
| Availability and obligation | [Application service](../packages/application-service.md) source is private. These routes are not required by any conformance role. |
| Application starter | The source candidate of `@bsv/create-dpp-app` serves import, a configured pull, retrieval, exact export and conflict decisions under `/api/epcis`, by calling `@bsv/dpp-credentials/epcis-exchange` over a MongoDB storage adapter ([EPCIS exchange](../packages/create-dpp-app.md#epcis-exchange)). The generated project's `apps/api/API.md` lists the routes. They are that application's own and no conformance role requires them. |
| Own application | Design your own routes if offering EPCIS import over HTTP, and document them; what an import does is the specification's sections 1 to 3 and 7. |

## Parked: map events to SEALs

The `epcis-vsc@1` and `epcis-vsc@2` mapping profiles and the [VSC profile](../packages/dpp-credentials.md#parked-the-vsc-compatibility-profile) they map into are parked. `mapEpcisEvent` and `mapEpcisEventWithReport` left `@bsv/dpp-credentials` in 0.2.0-beta.6; the published 0.2.0-beta.5 still exports them under `epcis-vsc@1`, and commit [`8c82c5e`](https://github.com/bsv-blockchain/dpp/tree/8c82c5e6ca31cd991e701d1051047153c7395eae/packages/dpp-credentials) carries both mappings and their tests. The current candidate, `dpp-release-2026-11`, does not claim them; earlier sets, including the latest published `dpp-release-2026-10-10`, claimed `epcis-vsc@1` within `epcis-source-exchange-1`. An implementation that leaves them out records each event's mapping outcome as `not-attempted` in its import record.

The profiles themselves are unchanged. A mapping answers one of four outcomes per event, `lossless`, `transformed`, `unsupported` or `insufficient-data`, and never invents a custody event or measurement to reach a SEAL; `epcis-vsc@2` decides each CBV 2.0 disposition through the crosswalk its manifest publishes and refuses an event carrying an error declaration. The [specification](https://github.com/bsv-blockchain/dpp/blob/588fbf7f23fd60122f515d47f2aa675d8a16f290/spec/epcis-interoperability.md), sections 5 and 6, gives the rules and their reasons; `packages/dpp-profiles/manifests/interoperability/` holds both manifests, and the two mapping vectors of `fixtures/vectors/dpp/interoperability/epcis/v1.json` and all of `v2.json` pin every outcome, as published.

## Parked: sign an event

The directly signed EPCIS event profile, `epcis-event-vc@1`, is parked while its representation is reconsidered. The module stays in the repository and is no longer exported: `packages/dpp-protocol/src/epcisEvent.ts` keeps the code, its tests still run with the package's own, and `@bsv/dpp-protocol` exports none of it. No published version exported it, so no installed package changes. No release requires the profile, and an implementer need not support it. Its ledger rows, `EPEV-1-hash-id` to `EPEV-4-registry-intake`, and its claim, `epcis-event-signing-1`, are in the [ledger archive](../reference/parked/ledger-archive.json).

The profile itself is unchanged. Under it, a party that observed or performed a step signs the EPCIS event itself, without a mapping. The credential is a W3C Verifiable Credential 2.0 whose subject is the event exactly as the party holds it, whose `id` is the event's CBV 2.0 Event Hash ID, and whose proof is a compact JWS under ES256K signed by the party's one published credential key. A verifier recomputes the hash from the subject, checks the signature against the key the `kid` names and reports each finding separately; a registry anchors the exact JWS bytes once per hash ID and issuer. `spec/epcis-event-profile.md` gives the rules as they stood, `packages/dpp-profiles/manifests/exchange/epcis-event-vc@1.json` is the manifest, whose status reads `parked`, and `fixtures/vectors/dpp/interoperability/epcis/hash-v1.json` and `fixtures/vectors/dpp/exchange/epcis-event-vc/v1.json` pin the hash and the signed credentials, as published.

## Source definitions

| Task | Source |
|---|---|
| Select parsing and digest behaviour, and read the parked mapping | [EPCIS interoperability](https://github.com/bsv-blockchain/dpp/blob/588fbf7f23fd60122f515d47f2aa675d8a16f290/spec/epcis-interoperability.md) |
| Store an import record | [Import schema](https://github.com/bsv-blockchain/dpp/blob/d7dc9bfa6d1ca7d11df446a9882dba4f0692c2d9/contracts/epcis-import.schema.json), version 1 as that commit carries it, kept as `contracts/epcis-import-v1.schema.json`; version 2 is `contracts/epcis-import.schema.json` in this tree |
| Store observations, conflict decisions, index entries, the journal, pull records, page records and the records of a restore | `contracts/epcis-exchange-records.schema.json` |
| Read or write the descriptor of a recovery snapshot | `contracts/epcis-recovery.schema.json`; `packages/dpp-credentials/src/epcis-exchange/recovery.ts`; `examples/recover-epcis.mjs` |
| Pull from a source, or try the client against your own endpoint | `packages/dpp-credentials/src/epcis-exchange/pull.ts`; `examples/pull-epcis.mjs`; `scripts/epcis-pull-interop.mjs` |
| Use reference parsing and the durable import | [Credentials package](../packages/dpp-credentials.md) |
| Run every selected case; the parked mapping outcomes stay pinned beside them | [EPCIS vectors](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/vectors/dpp/interoperability/epcis/v1.json), and `fixtures/vectors/dpp/interoperability/epcis/v2.json` for `epcis-vsc@2` |
| Read the parked profile for directly signed events | `spec/epcis-event-profile.md`; `packages/dpp-protocol/src/epcisEvent.ts`, which the package no longer exports; `fixtures/vectors/dpp/interoperability/epcis/hash-v1.json` and `fixtures/vectors/dpp/exchange/epcis-event-vc/v1.json` |

The [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) records exercised import and pull outcomes. Next: [external credentials](external-credentials.md), to verify a partner's W3C credential beside the passport.
