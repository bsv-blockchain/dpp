# @bsv/dpp-credentials

Application developers verifying W3C Verifiable Credentials that partners issue in the supported external profile, reading GS1 EPCIS supply-chain event documents, or signing an EPCIS event as a lifecycle claim, can use `@bsv/dpp-credentials`. Readers and writers using only passports and native claims do not need it.

**Experimental prerelease:** `@bsv/dpp-credentials` 0.2.0-beta.6 is intended for implementation and interoperability testing. APIs may change significantly before a stable release; production readiness is not established.

## Preconditions

| Procedure | Input and source |
|---|---|
| Installed examples | Node 22 or later, ECMAScript modules and this package; release status is in Install. |
| First EPCIS call | The included document and the three pinned GS1 files, obtained once from `https://ref.gs1.org/` ([GS1 files](#gs1-files)); no key or checkout. |
| External credential verification | The credential's exact received bytes; issuer `did:web` documents, status evidence and an authority policy from configured evidence sources, never self-asserted trust. |
| Checkout exercises | Repository checkout; run `npm ci` and `npm run build` before commands at its root. |

## What it is and whether you need it

**A W3C Verifiable Credential** names an issuer and a subject and secures its claims with a proof a recipient can check. This package verifies credentials other parties issue in the external passport format, `vc-di-ecdsa-rdfc-2019@1`: VC Data Model 2.0 with an `ecdsa-rdfc-2019` proof from a `did:web` issuer. It parses the exact bytes strictly, then checks the proof and the issuer's key binding, validity times, status through an authenticated Bitstring Status List, authority under your policy and the subject, and reports each finding separately. It issues nothing under that profile. [Verifiable credentials](../learn/verifiable-credentials.md) explains the formats and how they relate to DIDs.

It also reads GS1 EPCIS 2.0.1 event documents under `epcis-json@1`: exact received bytes, validation against the pinned schema, event digests and arrival classification. It can keep them too: `./epcis-exchange` imports a file into storage you supply and exports the original bytes unchanged ([durable EPCIS import](#durable-epcis-import)), and pulls pages of events from a source through the standard events query ([EPCIS query pull](#epcis-query-pull)). The schema is GS1's and is not in the package: you obtain it once ([GS1 files](#gs1-files)).

| You want to | Need this package? |
|---|---|
| Read, verify or write passports, or sign native claims | No: use [@bsv/dpp-protocol](dpp-protocol.md) |
| Verify a W3C credential in the external passport format, or feed one into a passport's verification report | Yes, `@bsv/dpp-credentials/exchange` |
| Read and validate an EPCIS 2.0.1 event document | Yes, `@bsv/dpp-credentials/epcis-source` |
| Retain EPCIS documents, tell a repeat from a change, and export them unchanged | Yes, `@bsv/dpp-credentials/epcis-exchange` |
| Pull events from an EPCIS 2.0 query interface, within limits, and retain each page | Yes, `pullEpcisEvents` in `@bsv/dpp-credentials/epcis-exchange` |
| Sign one EPCIS event as a lifecycle claim bound to its passports, or verify one | Yes, `@bsv/dpp-credentials/epcis-lifecycle`, which also needs `@bsv/dpp-protocol` and `@bsv/sdk` ([the EPCIS lifecycle claim](add-a-claim.md#the-epcis-lifecycle-claim)) |
| Run an EPCIS repository, capture events or subscribe to a source | No: the package does none of these |
| Issue or verify SEALs, or map EPCIS events to SEALs | No: the parked VSC compatibility profile and its mappings left the package in 0.2.0-beta.6 ([parked profile](#parked-the-vsc-compatibility-profile)) |

Wallet funding, passport movement and index lookups stay with [@bsv/dpp-protocol](dpp-protocol.md) and your wallet. Only `./epcis-lifecycle` imports `@bsv/dpp-protocol` and `@bsv/sdk`, which the package declares as dependencies for it; no other entry point loads either.

## Install

With Node 22 or later, install the published version from npm:

```sh
npm install --save-exact @bsv/dpp-credentials@0.2.0-beta.5
```

For the November examples, [pack the candidate archives](README.md#use-the-renamed-source-candidate), then install credentials and its protocol dependency together in your project:

```sh
npm install --save-exact /absolute/path/to/dpp/release/candidates/bsv-dpp-credentials-0.2.0-beta.6.tgz /absolute/path/to/dpp/release/candidates/bsv-dpp-protocol-0.3.0-beta.10.tgz
```

| Release fact | Value |
|---|---|
| Package | `@bsv/dpp-credentials` 0.2.0-beta.6 |
| Current source candidate | `dpp-release-2026-11`; the [release page](../reference/release-sets.md) distinguishes it from the latest published set. |
| Change | The parked VSC compatibility profile and the EPCIS-to-SEAL mappings leave the package, with the Ed25519 and BBS suites they used ([removed names](#removed-names)). External credential verification is unchanged; the EPCIS source helpers lose only `readEpcisSourceReference` and `EPCIS_MAPPING_PROFILES`, which served the mappings. |
| Other candidate packages | Protocol and profiles beta.10; overlay beta.13. Each package numbers its own prereleases. |
| Runtime | Node only, ECMAScript modules; artefact files are plain data ([support table](support-table.md)). |

A bare `npm install @bsv/dpp-credentials` selects `latest`, the newest beta. Pin the exact version so upgrades are your choice, and keep the lockfile.

## Entry points and their main functions

| Entry point | Main functions | A runnable call |
|---|---|---|
| `@bsv/dpp-credentials/exchange` | `verifyExternalCredential` verifies a VC Data Model 2.0 credential under `ecdsa-rdfc-2019`; `parseExternalCredentialBytes` reads its exact bytes strictly; `verifyBitstringStatus` checks status; `createExternalDocumentLoader` serves pinned contexts and resolves `did:web` within allowed origins; `externalCredentialVerifierFor` adapts it as the `credentialVerifier` of a verification report | [Prepare the verifier inputs](../interoperability/external-credentials.md#verify-the-vector-files-credentials) |
| `@bsv/dpp-credentials/epcis-source` | `parseEpcisSource` reads an EPCIS document's exact bytes under disclosed limits; `validateEpcisDocument` checks it against the pinned EPCIS 2.0.1 schema, read from the provisioned folder; `epcisEventBodyDigest` and `classifyEventArrival` tell a repeat from a change | The call below, and [EPCIS source exchange](../interoperability/epcis.md) |
| `@bsv/dpp-credentials/epcis-exchange` | `importEpcisSource` retains a file's exact bytes and an import record in storage you supply; `exportEpcisSource` returns the original; `resolveEpcisConflict` records a decision; `findEpcisAssociations` and `rebuildEpcisAssociations` read and rebuild the index; `recoverEpcisExchange` finishes or discards interrupted work; `createMemoryEpcisStorage`, `openFileEpcisStorage` and `epcisStorageAdapterSuite` are the two adapters and the suite every adapter must pass; `pullEpcisEvents` makes one bounded run against a source's standard events query, and `getEpcisPull` and `listEpcisPullPages` read its state; `exportEpcisRecovery` takes a store out as a recovery snapshot, `verifyEpcisRecovery` and `restoreEpcisRecovery` check one and put it into another store, `exportEpcisPublicEvidence` gives what a public package may carry, and `remapEpcisSourceEndpoint` declares that a source is reached at another address | [Import a file](../interoperability/epcis.md#import-a-file) and [run the example](../interoperability/epcis.md#run-the-example) |
| `@bsv/dpp-credentials/epcis-lifecycle` | `buildEpcisLifecycleClaim` makes the claim `dpp-epcis-lifecycle@1` from one EPCIS 2.0.1 event and its bindings; `signEpcisLifecycleClaim` requires a passing event and product check and supported authority before the wallet signs its RFC 8785 bytes; `parseEpcisLifecycleClaim` reads exact bytes strictly; `verifyEpcisLifecycleClaim` reports each finding on its own; `buildEpcisLifecycleAnchors` builds one anchor per bound passport; `epcisLifecycleCredentialVerifierFor` adapts it as the `credentialVerifier` of a verification report; `jcsString`, `jcsBytes`, `parseStrictJcsJson` and `parseCanonicalJcs` are the RFC 8785 functions it uses. The only entry point that imports `@bsv/dpp-protocol` and `@bsv/sdk` | [The EPCIS lifecycle claim](add-a-claim.md#the-epcis-lifecycle-claim) |
| `@bsv/dpp-credentials` | Re-exports every `/epcis-source` function, `createDidWebResolver`, `parseStrictJsonBytes` and `verifyTemporal`, with the shared credential and check types, and exports `provisionGs1Artefacts`, `verifyGs1Artefacts`, `readGs1Artefact` and `gs1ArtefactsDir` ([GS1 files](#gs1-files)); it loads no proof suite | `npm run test -w @bsv/dpp-credentials -- test/strict-json.test.ts test/temporal.test.ts` in a checkout |
| `@bsv/dpp-credentials/artifacts/*` | The retained schemas, contexts and notices, as files, including the owned context and schemas the parked VSC manifests pin. No GS1 file is among them. | |
| `dpp-gs1-artefacts` (executable) | `fetch`, `verify` and `path` for the GS1 files | [GS1 files](#gs1-files) |

For qualified issuance, supply the event schema validator, product comparison evidence, any required extension rules and an authority resolver as the third argument to `signEpcisLifecycleClaim`. It checks the issuer identity and key, role, purpose and scoped passports at the EPCIS event time. For a correction of another issuer's original, supply that signed original as `corrects`. The generated starter's operator configuration covers each bound passport. [Configure lifecycle issuance grants](../migration.md#configure-lifecycle-issuance-grants).

## GS1 files

GS1 publishes the EPCIS schemas and context under its own terms. This repository and its packages do not redistribute them. Each deployment obtains them from GS1 and the package checks every byte against a pinned digest. After that, validation runs offline from a local folder.

| File | GS1 address | SHA-256 | Bytes |
|---|---|---|---|
| `epcis-json-schema-2.0.1.json` | `https://ref.gs1.org/standards/epcis/2.0.1/epcis-json-schema.json` | `0f46ff694efffd8d8ce840a33dfde84228add11b516b8b258f3200740ae210af` | 55680 |
| `epcis-context-2.0.1.jsonld` | `https://ref.gs1.org/standards/epcis/2.0.1/epcis-context.jsonld` | `5056c65f991425b1d3a35e35edf4f7d0c7ff56cf688c2912b930f93494713737` | 20690 |
| `query-schema-2.0.1.json` | `https://ref.gs1.org/standards/epcis/2.0.1/query-schema.json` | `4b5583c9a0a715324594617f3cf6744f4f930568484f7df8fb7aa81819355341` | 27229 |

The same facts are the exported table `EPCIS_GS1_ARTEFACTS`. Only the JSON schema is read by the package today, by `validateEpcisDocument`.

| Way | What to do |
|---|---|
| The command | `npx dpp-gs1-artefacts fetch` once per deployment. `npx dpp-gs1-artefacts verify` checks the folder without the network, and `npx dpp-gs1-artefacts path` prints it. Each takes `--dir <folder>`. `fetch` and `verify` exit 1 when a file is missing or does not match. |
| The function | `await provisionGs1Artefacts()` from `@bsv/dpp-credentials`, before the first validation. It returns `{ ok, dir, files }`, where each file is `present`, `fetched` or `failed` with a reason. `verifyGs1Artefacts()` is the check without the network. |
| The folder | `--dir` or the `dir` option, else the environment variable `DPP_GS1_ARTEFACTS_DIR`, else `$XDG_CACHE_HOME/dpp/gs1`, else `~/.cache/dpp/gs1`. In a container, point `DPP_GS1_ARTEFACTS_DIR` at a mounted volume and provision when the container starts, not when the image is built, so no image layer holds the files. |
| Without network access | Download the three files from the addresses above on a machine that has access, place them in the folder under the file names above, then run `npx dpp-gs1-artefacts verify`. `provisionGs1Artefacts({ offline: true })` and `fetch --offline` do the same check and never fetch. |

Nothing is fetched when the package installs or when a module loads. Provisioning only requests `https://ref.gs1.org/`, refuses a redirect that leaves it, keeps nothing that fails its length or digest, and never parses or runs what it fetched.

**When a file is absent or altered**, `validateEpcisDocument` throws `Gs1ArtefactUnavailableError`, with `code` `gs1-artefact-unavailable`, the artefact's `artefactId`, the `dir` it looked in and a `remedy` sentence. It returns no findings. Treat it as a refusal with no side effect, like a transport refusal: the document was neither passed nor failed, and nothing was skipped. `validateEpcisDocument(document, { artefactsDir })` names the folder for one call.

## First call

1. Save this complete file as `epcis-first.mjs` in your installed project. It obtains the GS1 files if the folder does not hold them yet, then parses and validates one EPCIS document of the kind a supplier sends:

```js
import { provisionGs1Artefacts } from '@bsv/dpp-credentials'
import { parseEpcisSource, validateEpcisDocument } from '@bsv/dpp-credentials/epcis-source'

// Once per deployment: obtain GS1's files and check every byte. Later runs find them and use no network.
const artefacts = await provisionGs1Artefacts()
if (!artefacts.ok) throw new Error(`GS1 files unavailable in ${artefacts.dir}: ${artefacts.files.filter(f => f.outcome === 'failed').map(f => `${f.fileName} (${f.reason})`).join(', ')}`)

// One EPCIS 2.0.1 document with one event, as a supplier's system might send it.
const document = {
  '@context': ['https://ref.gs1.org/standards/epcis/2.0.1/epcis-context.jsonld'],
  type: 'EPCISDocument',
  schemaVersion: '2.0',
  creationDate: '2026-10-01T09:00:00.000Z',
  epcisBody: {
    eventList: [{
      type: 'ObjectEvent',
      eventTime: '2026-10-01T08:00:00.000Z',
      eventTimeZoneOffset: '+00:00',
      eventID: 'urn:uuid:00000000-0000-4000-8000-000000000001',
      epcList: ['urn:epc:id:sgtin:9521234.022222.CELL-A'],
      action: 'OBSERVE',
      bizStep: 'inspecting',
    }],
  },
}

// Parse the exact bytes received, then validate against the pinned EPCIS schema.
const bytes = new TextEncoder().encode(JSON.stringify(document))
const parsed = parseEpcisSource(bytes, { mediaType: 'application/ld+json' })
if (!parsed.ok) throw new Error(`refused: ${parsed.reason}`)
const validation = validateEpcisDocument(parsed.document, { events: parsed.events })
console.log('events:', parsed.events.map(({ pointer, type }) => `${type} at ${pointer}`).join(', '))
console.log('schema:', validation.schema, '; findings:', validation.findings.length)
```

2. Run `node epcis-first.mjs`. Expected output:

```
events: ObjectEvent at /epcisBody/eventList/0
schema: pass ; findings: 0
```

3. Retain exact received bytes, without reserialising the parsed object. Stop on parse refusal or schema findings before treating it as validated. `importEpcisSource` does the retaining for you ([durable EPCIS import](#durable-epcis-import)).

| Command | Expected result |
|---|---|
| `node epcis-first.mjs` | One `ObjectEvent` at `/epcisBody/eventList/0`; schema `pass`, zero findings |
| `node examples/import-epcis.mjs` | In a checkout: provisions the GS1 files on first use, imports the seven-event fixture into memory, prints each event's identity, body digest and arrival, repeats the request and exports the original bytes unchanged; it maps nothing. |

To verify a partner's credential instead, follow [external credential verification](../interoperability/external-credentials.md), which runs the vector file's credentials through `verifyExternalCredential`.

## Durable EPCIS import

Only a complete `EPCISDocument` or `EPCISQueryDocument` supplies durable events. A standalone event can be interpreted by `parseEpcisSource` when the caller supplies its original envelope type and context declarations. A standalone upload to the durable exchange can retain its original bytes and invalid receipt, including after replay.

`@bsv/dpp-credentials/epcis-exchange` is the durable part of `epcis-json@1`. Loading it starts nothing: it opens no database, reads no file and reaches no network. You hand each function the storage it works on.

| Question | Answer |
|---|---|
| What it does | Retains a file's exact bytes under their SHA-256 with an import record; classifies each event against what the same source already holds; records conflict decisions; keeps a rebuildable index from identifiers to events; exports the original bytes. |
| What it does not do | It is not an EPCIS repository. It does not capture events, subscribe to a source or crawl one. It signs, issues and anchors nothing, and writes no passport state. |
| What an import proves | Nothing about origin. An import is data: a valid document is not a signed one, and no result says who observed an event. |
| Storage | `EpcisExchangeStorage`, six methods: exact bytes under their digest, and JSON records written in batches that apply completely or not at all. `createMemoryEpcisStorage()` is for tests; `openFileEpcisStorage(folder)` is durable, for one process and one folder. |
| Other databases | The interface alone promises nothing about them. An adapter is fit only when it passes `epcisStorageAdapterSuite`, which the package ships so that you can run it against your own. |
| Idempotency | A `requestId` is unique within its `sourceId` and is bound to a digest of the request. The same request again answers the same import and writes no second record; the same `requestId` with other bytes is `request-conflict`. |
| Refused | Bytes that are unsafe to parse, over a limit or of another media type, a malformed request, and any import while the pinned GS1 schema is not provisioned. Nothing is kept and nothing changes. |
| Retained | Every document that parses safely, valid or not. An invalid one keeps its findings and is left out of the index and of anything described as valid. |
| Export | `exportEpcisSource` returns the retained original, byte for byte, or nothing. `deriveEpcisEventProjection` returns a generated view labelled `derived` with its own digest, and is never returned in place of an original. |
| After a crash | `recoverEpcisExchange(storage)`, called when the store is opened, finishes or discards what was interrupted and reports it. No acknowledged source is lost and nothing is left half recorded. |

[Import, retain and export](../interoperability/epcis.md#import-retain-and-export) has a runnable import, the outcomes, how each event arrives, conflict decisions, the storage promises and the durable steps with what recovery does at each. Every durable record carries its own version: `contracts/epcis-import.schema.json` is version 2 of the import record, which now requires `requestDigest`, and `contracts/epcis-exchange-records.schema.json` holds the rest.

## EPCIS query pull

`pullEpcisEvents`, in the same entry point, is a client of the standard events query of the GS1 EPCIS 2.0 REST binding, `GET /events`. Each call is one bounded run. It hands every page it reads to `importEpcisSource`, so a page is refused, retained and classified exactly as a file is. It is not an EPCIS repository and promises no complete history.

| Question | Answer |
|---|---|
| A source | `sourceId`, `baseUrl`, `permittedOrigins`, the `policy` with its limits, and `credentials`, a function that obtains the credential. `localTest` permits plain `http` and private addresses and is recorded in every result. |
| A query | `matchAnyEPC`, `eventTypes`, `eventTime.from` and `until`, `recordTime.from`, `eventIds` and `perPage`, sent as `MATCH_anyEPC`, `eventType`, `GE_eventTime`, `LT_eventTime`, `GE_recordTime`, `EQ_eventID` and `perPage`. Nothing else is sent. |
| Versions and lists | `GS1-EPCIS-Version: 2.0.1` and `GS1-CBV-Version: 2.0.0` by default, the pinned `EPCIS_VERSION` and `CBV_VERSION`, each configurable through `wireVersions`. A list is one pipe-delimited parameter, as GS1's interface description declares. `repeatListParameters` on a source sends one parameter per value, for a source that reads only that form. |
| The transport | Handed in as `fetch`. The module never reaches for a transport of its own and opens no connection. Redirects are followed by hand, at most three. |
| What a run retains | Each page as an import with `query` provenance, one page record per acknowledged page, and the pull record: scope, query, limits, status, checkpoint and watermark. |
| The checkpoint | Moved only in the batch that records a page, and only after that page's import is durable. It never points past what is retained. |
| After a restart or a crash | The same call continues from the checkpoint. A page that was imported and not yet acknowledged is finished from its receipt and is not asked for again. |
| A cursor that cannot be reused | Expired, rejected or missing: the pass is replayed from its retained bounds, once a run, and what is held is recognised as it arrives again. |
| A later pass | Begins at the watermark less `recordTimeOverlapSeconds`, 300 by default. A watermark is no evidence that every correction arrived, so refresh known events with `eventIds`. |
| Outcomes | One of the eight source outcomes, with a `reason` and a `completion` of `exhausted`, `stopped-at-limit` or `failed`. A run that stopped early never reads as complete. |
| Limits | 2 MiB and 100 events a page, depth 64, 16 contexts totalling 1 MiB, a 10 second fetch timeout, and 10 pages, 20 MiB and 60 seconds a run. An override is refused past its ceiling and is recorded in the result. |
| Credentials | Sent to the base address's origin only, held in memory for one run, and written to no record, result, log entry or error. An answer that carries the credential is refused. |
| Leniencies | An unquoted `rel=next`, a numeric page token, a missing `GS1-CBV-Version`, an empty page after a full last page and an unreadable cursor expiry are accepted and recorded. A list sent as repeated parameters is the one leniency an operator configures, recorded as `list-parameters-repeated` and in the pull record's `source.repeatListParameters`. None changes what is retained. |

[Pull events from a source](../interoperability/epcis.md#pull-events-from-a-source) has the configuration, a runnable example, the durable steps, every outcome with its reasons, the limits with their ceilings and each leniency with the reason it weakens nothing. `scripts/epcis-pull-interop.mjs` runs one pull against an endpoint you name and writes a report; it is not part of `npm test`.

## EPCIS recovery

The same entry point moves an exchange from one store to another. It is the authorised path, for the operator who runs the exchange, and it is separate from public evidence.

| Question | Answer |
|---|---|
| What a snapshot carries | Every retained original in its exact bytes, and every import record, observation, conflict decision, pull record and page record of the source scopes it covers. `exportEpcisRecovery({ storage })` returns them as files with one `dpp-evidence-package@1` inventory entry each, beside a descriptor, `epcis-recovery.json`. |
| What it leaves out | The associations index and the retention entries, which the destination rebuilds; the journal, which is empty when a snapshot is taken; every credential; and, unless you pass `cursors: 'include'`, every cursor and page token. The descriptor lists each omission. |
| The boundary | No unfinished work is journalled, and every record carried was read twice at the same revision, inside the store's turn. The export refuses as `unfinished-work` or `store-unstable` otherwise and changes nothing. It assumes one process writes to the store. |
| Before a restore writes | `restoreEpcisRecovery` checks the descriptor against the package's inventory, every file against its digest, every record against its version and its own identity, and the snapshot against the invariants of the exchange. `verifyEpcisRecovery` makes the same checks with no destination. |
| What is preserved | `sourceId`, `importId`, `requestId`, `requestDigest`, event identities, receipt times, provenance, recorded results, decisions and query bounds. Only `bytesRef` is relocated, through a checked one-to-one mapping that the destination records. |
| What is refused | A checkpoint without its imports, a decision without its observations, a missing or altered original or record, a descriptor that does not match the inventory, an unknown record version, a record of one source scope that stands on a record of another, records that carry a cursor the descriptor says was left out, and a public form, each by its own `code`. |
| A destination that holds records | Equal records are left alone, so a restore is safe to run again after a crash at any step. A record that differs is never overwritten: the restore writes nothing and answers `reconciliation-required` with every collision. |
| After the restore | A retry of an acknowledged request answers the same import with no new receipt. An interrupted pull continues, or replays from its bounds when its cursor was left out or has expired. A carried cursor at an origin the destination does not permit is never requested. `remapEpcisSourceEndpoint` binds a source's pulls to a new address without changing an identity, and drops a cursor the declared origins do not permit. |
| The public form | `exportEpcisPublicEvidence({ storage, allow })` carries the originals your access policy allows and their import records without provenance. It carries no operational record and cannot be restored. |
| Other databases | `epcisStorageAdapterSuite` now also takes a snapshot of a store, restores it into a second store of the same adapter, and stops that restore before and after every durable call. |

[Move an exchange to another store](../interoperability/epcis.md#move-an-exchange-to-another-store) has the layout of a snapshot, the durable steps of a restore, every refusal and a runnable example. The descriptor's schema is `contracts/epcis-recovery.schema.json`.

## Parked: the VSC compatibility profile

**Verifiable Supply Chain (VSC)** is the W3C Verifiable Supply Chain Community Group's draft for supply-chain event credentials. `vsc-draft-compat/0.1.0` is a selected subset of it, against revision `c279de3debcd6eab94a77034584d1750f5d65e6a`. It is not a W3C standard.

**A SEAL** is a VSC credential for one signed event: products (`what`), when, where, who acted and how, linked to earlier SEALs in the product's custody chain. This W3C credential uses an `Ed25519Signature2020` or `bbs-2023` proof, a different format from `@bsv/dpp-protocol`'s native lifecycle claim.

The profile and the EPCIS-to-SEAL mappings `epcis-vsc@1` and `epcis-vsc@2` are parked: optional compatibility profiles that no release requires and that the programme does not currently develop. From 0.2.0-beta.6 their code is no longer part of this package: SEAL issuance, parsing and verification, the two proof suites, custody chains and corrections, and `mapEpcisEvent` and `mapEpcisEventWithReport`. The owned context and schemas their manifests pin stay under `artifacts/`, and their vectors stay as published.

| If you | Then |
|---|---|
| Import any of the [removed names](#removed-names) | Stay on the published `0.2.0-beta.5`, which exports the profile and `epcis-vsc@1`, or take the code from the repository history at commit [`8c82c5e`](https://github.com/bsv-blockchain/dpp/tree/8c82c5e6ca31cd991e701d1051047153c7395eae/packages/dpp-credentials), which also carries `epcis-vsc@2` and the tests. |
| Verify credentials other parties issue | Use `@bsv/dpp-credentials/exchange`, which is not parked. |
| Import EPCIS events | Use `@bsv/dpp-credentials/epcis-exchange`, which records each event's mapping outcome as `not-attempted`; `@bsv/dpp-credentials/epcis-source` holds the parsing and validation it runs on. |

The current candidate's selection, `conformance/selections/dpp-release-2026-11.json`, withholds `epcis-source-import-1`, the claim on the source helpers, from 12 November 2026, because it claims no optional profile, and the claims of the profile and both mappings moved to the ledger archive the same day, with `epcis-source-exchange-1`, whose rows included the `epcis-vsc@1` mapping; earlier sets, including the latest published `dpp-release-2026-10-10`, claimed the implemented subset and `epcis-vsc@1`. A credential's own claim that its issuer is trusted is never enough; the [package guide](https://github.com/bsv-blockchain/dpp/blob/588fbf7f23fd60122f515d47f2aa675d8a16f290/packages/dpp-credentials/README.md) of an earlier commit shows the SEAL calls with each policy.

### Removed names

These names left the root `@bsv/dpp-credentials` in 0.2.0-beta.6. The three marked `./epcis-source` also left that subpath; nothing else left it, and `./exchange` exports what it did.

| Kind | Names |
|---|---|
| Functions | `verifySeal`, `issueSealEd25519`, `issueSealBbs`, `parseSealBytes`, `signCredentialEd25519`, `verifyCredentialProof`, `verifyCredentialStatus`, `verifyIssuerAuthority`, `validateSealStructure`, `validateSealPresentationStructure`, `extractSealMetadata`, `deriveSealPresentation`, `verifySealPresentation`, `presentationHeader`, `createDocumentLoader`, `mapEpcisEvent`, `mapEpcisEventWithReport`, `extractEpcisEvent`, and `readEpcisSourceReference` (`./epcis-source`) |
| Constants | `sealSchema`, `disclosureSchema`, `PROFILE_ID`, `UPSTREAM_REVISION`, `CONTEXT_URL`, `PROFILE_CONTEXT`, `SEAL_CONTEXTS`, `ALWAYS_DISCLOSED`, `EPCIS_TYPES`, `EPCIS_VOCABULARY`, `CBV_DISPOSITION_CROSSWALK`, and `EPCIS_MAPPING_PROFILES` (`./epcis-source`) |
| Types | `Seal`, `SigningKey`, `ProductIdentifier`, `Topology`, `PresentationBinding`, `AuthorityPolicy`, `VerificationOptions`, `VerificationResult`, `EpcisMappingOptions`, `EpcisMappingOutcome`, `EpcisMappingReport`, `CbvCustodyEffect`, and `EpcisMappingProfile` (`./epcis-source`) |

## Limits

| Limit | Meaning |
|---|---|
| Parked VSC subset | Not in this package from 0.2.0-beta.6, and not claimed by the current candidate, `dpp-release-2026-11`; earlier sets, including the latest published `dpp-release-2026-10-10`, claimed the implemented subset on the tests of that time. Whole-draft conformance was never claimed, because the upstream context and test suite were unavailable for comparison ([earlier release selection](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/selections/dpp-release-2026-10.json)). Passing tests is not product qualification. |
| Ring 0 identity | A passing proof identifies the signing key, not the claimed issuer. Only the platform account vouches for the key holder ([identity and authority](../learn/identity-and-authority.md)). |

[Known limitations](../operate/limitations.md) lists the reference services' other open gaps.

## Sources

| Entry point | Source |
|---|---|
| `@bsv/dpp-credentials/exchange` | [External credential profile](https://github.com/bsv-blockchain/dpp/blob/b60cfb8eb2a71a82765c64ade9e10cb42c3b2af1/spec/external-credential-profile.md) |
| `@bsv/dpp-credentials/epcis-source` | [Source-event exchange](https://github.com/bsv-blockchain/dpp/blob/588fbf7f23fd60122f515d47f2aa675d8a16f290/spec/epcis-interoperability.md) |
| The parked VSC profile, no longer in the package | [Parked credential profile](https://github.com/bsv-blockchain/dpp/blob/bb82d30c988f7432e3157f8d60296855c7c935ba/spec/vsc-profile.md) |
| `@bsv/dpp-credentials/epcis-exchange` | The same specification, sections 1, 2, 3, 6, 7 and 8; `packages/dpp-credentials/src/epcis-exchange.ts`; `contracts/epcis-import.schema.json`, `contracts/epcis-exchange-records.schema.json` and `contracts/epcis-recovery.schema.json` |
| `@bsv/dpp-credentials/epcis-lifecycle` | `spec/epcis-lifecycle-claim.md`; `packages/dpp-credentials/src/epcis-lifecycle.ts`; `fixtures/vectors/dpp/epcis-lifecycle/v1.json` |
| `@bsv/dpp-credentials/artifacts/*` | [Retained schemas, contexts and notices](https://github.com/bsv-blockchain/dpp/tree/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/packages/dpp-credentials/artifacts) |
| GS1 files and `dpp-gs1-artefacts` | [Provisioning module](https://github.com/bsv-blockchain/dpp/blob/588fbf7f23fd60122f515d47f2aa675d8a16f290/packages/dpp-credentials/src/gs1-artefacts.ts) |

## Next

| To | Go to |
|---|---|
| Verify an external credential and add it to a report | [External credential verification](../interoperability/external-credentials.md) |
| Import EPCIS events | [EPCIS source exchange](../interoperability/epcis.md) |
| Choose between a credential and a native claim | [Passport states and attestations](../learn/passport-and-attestations.md) |
