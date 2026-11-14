# EPCIS source exchange

Teams with EPCIS 2.0 events from manufacturing, logistics or traceability systems can use this guide to retain unchanged source evidence beside a passport. Imports never write passport states.

Electronic Product Code Information Services (EPCIS) is the GS1 standard for observations such as making, packing or shipping an item. The profiles:

| Profile | Result | Status |
|---|---|---|
| `epcis-json@1` | Retains EPCIS 2.0.1 JSON or JSON-LD exactly as received, with its validation findings, event digests and arrival classification. | Current |
| `epcis-vsc@1` | Maps events to unsigned SEALs, the Verifiable Supply Chain (VSC) profile's event credentials. A separately authorised issuer may sign them. | Parked |
| `epcis-vsc@2` | Maps the same way after deciding each CBV 2.0 disposition through a published crosswalk, refuses error declarations, and names why an event has no SEAL. | Parked, never current |
| `epcis-event-vc@1` | Signs an event as it stands, as a W3C credential keyed by its CBV 2.0 Event Hash ID, with the party's own key, for anchoring beside a passport. | Parked |

`@bsv/dpp-credentials` implements `epcis-json@1` in two entry points. `./epcis-source` holds the pure pieces: strict parsing, validation, digests and arrival classification. `./epcis-exchange` is the durable part: it imports a file into storage you supply, records how each event arrived, and exports the original bytes ([import, retain and export](#import-retain-and-export)). The two mapping profiles are parked with the VSC profile, and their manifests say so with the status `parked`: no release requires them, the programme does not currently develop them, and from `@bsv/dpp-credentials` 0.2.0-beta.6 their code is no longer in the package ([parked: map events to SEALs](#parked-map-events-to-seals)). The direct route, which signs an event without a mapping, is parked as well ([parked: sign an event](#parked-sign-an-event)).

The current candidate, `dpp-release-2026-11`, carries the `epcis-json@1` source helpers, which are strict parsing under the disclosed limits, validation against the pinned schema, event-body digests and arrival classification. From 12 November 2026 its selection claims no optional profile, so it withholds `epcis-source-import-1`, the claim on those helpers. The earlier `epcis-source-exchange-1`, whose rows also covered the parked `epcis-vsc@1` mapping, moved to the ledger archive the same day. The durable import record, the separation from token operations and the pull client are left out of `epcis-source-import-1`. From 14 November 2026 the package's `./epcis-exchange` tests exercise the first two in public; the pull client is exercised only by the reference application. Their ledger rows stay tested.

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

`@bsv/dpp-credentials/epcis-exchange` imports one EPCIS file, keeps its exact bytes and a record of what it held, and gives the bytes back unchanged. Loading it starts nothing: it opens no database, reads no file and reaches no network. You hand each function the storage it works on.

| It does | It does not |
|---|---|
| Retain the exact bytes of a file under their SHA-256, with an import record | Run an EPCIS repository, or stand in for one |
| Classify each event against what the same source already holds | Capture events: it has no capture interface |
| Record a decision about a conflict without changing either body | Query or pull from an EPCIS endpoint. Querying is a later change |
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

Refusals beyond those of [parse and validate](#parse-and-validate): `too-many-contexts` and `contexts-oversized` for the two context limits, `no-canonical-form` for a string with an unpaired surrogate, `gs1-artefact-unavailable`, and `invalid-request`. Nothing is fetched, so a context is counted as it is declared: each distinct one once, and an inline one by the bytes of its canonical form. The fetch and pull limits are recorded with the import and apply to nothing in a file import. Provenance is recorded as given, so the module accepts a file name only and refuses an address, a query or an unknown member.

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

Records are filed under a kind and a key. A later feature, such as the checkpoints of a query client, adds its records under a new kind and needs no new method.

The interface alone promises nothing about another database. A type cannot check that a batch is atomic or that a write is durable before it is answered. Each adapter must pass the shared adapter suite, which the package ships so that you can run it against yours:

```js
import { epcisStorageAdapterSuite } from '@bsv/dpp-credentials/epcis-exchange'

// open() is called again after each simulated crash and must then open the same durable state.
const harness = () => ({ open: () => openMyStore(), abandon: (store) => store.dropWithoutClosing(), destroy: () => removeMyStore() })
for (const test of epcisStorageAdapterSuite(harness)) it(test.name, test.run)
```

The suite holds an adapter to each promise, then runs imports, a conflict decision and an index rebuild over it. It stops the store before and after every durable call, reopens it, and checks that no acknowledged source was lost, that nothing is half recorded, and that finishing the work gives exactly the store an uninterrupted run gives. It uses `node:assert` and no test framework. `runEpcisStorageAdapterSuite` runs it from a script.

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

Every durable record carries its own version and has a JSON Schema: the import record in `contracts/epcis-import.schema.json`, version 2, and the observations, decisions, index entries and journal in `contracts/epcis-exchange-records.schema.json`. A record stored under version 1 of the import contract validates under `contracts/epcis-import-v1.schema.json`.

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
| Store observations, conflict decisions, index entries and the journal | `contracts/epcis-exchange-records.schema.json` |
| Use reference parsing and the durable import | [Credentials package](../packages/dpp-credentials.md) |
| Run every selected case; the parked mapping outcomes stay pinned beside them | [EPCIS vectors](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/vectors/dpp/interoperability/epcis/v1.json), and `fixtures/vectors/dpp/interoperability/epcis/v2.json` for `epcis-vsc@2` |
| Read the parked profile for directly signed events | `spec/epcis-event-profile.md`; `packages/dpp-protocol/src/epcisEvent.ts`, which the package no longer exports; `fixtures/vectors/dpp/interoperability/epcis/hash-v1.json` and `fixtures/vectors/dpp/exchange/epcis-event-vc/v1.json` |

The [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) records exercised import and pull outcomes. Next: [external credentials](external-credentials.md), to verify a partner's W3C credential beside the passport.
