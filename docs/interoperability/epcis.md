# EPCIS source exchange

Teams with EPCIS 2.0 events from manufacturing, logistics or traceability systems can use this guide to retain unchanged source evidence beside a passport. Imports never write passport states.

Electronic Product Code Information Services (EPCIS) is the GS1 standard for observations such as making, packing or shipping an item. `@bsv/dpp-credentials` implements these profiles:

| Profile | Result | Status |
|---|---|---|
| `epcis-json@1` | Retains EPCIS 2.0.1 JSON or JSON-LD exactly as received, with its validation findings, event digests and arrival classification. | Current |
| `epcis-vsc@1` | Maps events to unsigned SEALs, the Verifiable Supply Chain (VSC) profile's event credentials. A separately authorised issuer may sign them. | Parked |
| `epcis-vsc@2` | Maps the same way after deciding each CBV 2.0 disposition through a published crosswalk, refuses error declarations, and names why an event has no SEAL. | Parked, proposed |

The two mapping profiles are parked with the VSC profile: they are still built and tested, but no release requires them and the programme does not currently develop them. [Parked: map events to SEALs](#parked-map-events-to-seals) keeps their procedures for existing users.

The current candidate, `dpp-release-2026-11`, makes no EPCIS conformance claim: the ledger's only EPCIS claim, `epcis-source-exchange-1`, also covers the parked `epcis-vsc@1` mapping, so its selection withholds it. `epcis-json@1` itself is not parked, and its rows stay tested.

## Inputs and runtime

| Exercise | Input and source |
|---|---|
| All local commands | Node 22 or later, npm and a checkout with `npm ci` and `npm run build` completed through [setup](../quick-start.md#get-the-code). Run from its root. |
| Fixture exercises | Checkout fixture `fixtures/vectors/dpp/interoperability/epcis/v1.json`. The issuer, status entry and custody chain are synthetic; no issuer keys or external service are required. Nothing is signed or issued. |
| Own-document exercise | An EPCIS 2.0.1 `<document.json>` from your source system. |

## Parse and validate

1. Parse to establish what arrived and each event's location.
2. Validate structure against the pinned EPCIS 2.0.1 schema.

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

## Keep the source with the result

Retain the exact source bytes and their findings with anything derived from them. Never invent a custody event or measurement to complete output.

| Boundary | Rule |
|---|---|
| Import and custody | Imports establish no custody or passport transfer. No import, pull, mapping or export writes `ISSUE`, `UPDATE`, `TRANSFER` or `RETIRE`. |
| Later passport workflow | May cite retained source when requesting a state. The passport service independently checks tip, actor authority and recipient acceptance. |
| Event body digest | SHA-256 of the event's RFC 8785 canonical JSON without `recordTime` and `errorDeclaration`, together with sorted digests of the contexts used to read it ([specification](https://github.com/bsv-blockchain/dpp/blob/fc73e35145d19c802c4cd566b4396f5a2b79a75b/spec/epcis-interoperability.md), section 2). The stripped event alone cannot reproduce it. |

## The application's HTTP routes

| Interface fact | Value |
|---|---|
| Import/pull routes | Reference application routes under `/api/interoperability/epcis`, described by [contracts/interoperability.yaml](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/interoperability.yaml). |
| Availability and obligation | [Application service](../packages/application-service.md) source is private. These routes are not required by any conformance role. |
| Own application | Use the contract as a model if offering EPCIS import over HTTP. |

## Parked: map events to SEALs

The `epcis-vsc@1` and `epcis-vsc@2` mapping profiles and the [VSC profile](../packages/dpp-credentials.md#parked-the-vsc-compatibility-profile) they map into are parked. The mapping functions stay in the root `@bsv/dpp-credentials` with unchanged behaviour. The current candidate, `dpp-release-2026-11`, does not claim them; earlier sets, including the latest published `dpp-release-2026-10-10`, claimed `epcis-vsc@1` within `epcis-source-exchange-1`. An implementation that leaves them out records each event's mapping outcome as `not-attempted` in its import record.

### Map the events

Call `mapEpcisEventWithReport(event, options, { sourceReference, validation })` from the root `@bsv/dpp-credentials` for one event:

| Outcome | Retained output | Next action |
|---|---|---|
| `lossless` | Unsigned SEAL retaining all event information | Keep source reference and findings with the credential. |
| `transformed` | SEAL plus meaning preserved only in the round-trip extension, named by `unmapped` | Retain and review that extension. |
| `unsupported` | `missing` names an event the profile cannot express or a missing mapping decision | Resolve the decision or retain the source without a credential. |
| `insufficient-data` | `missing` names source inputs the mapper will not invent | Obtain the inputs or retain source evidence alone. |

A valid source may remain evidence without a credential. `mapEpcisEvent` performs plain mapping without a report. Under `epcis-vsc@1`, an inspection, repair or sensor reading recorded as an `OBSERVE` event or a `TransformationEvent` that reports the disposition `active` is `unsupported` with the reason `maintenance-observation`, because it records no custody step. Both mapping functions come from the root package; `@bsv/dpp-credentials/epcis-source` supplies parsing functions and artefacts.

Map every event in the same fixture:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
import { mapEpcisEventWithReport } from '@bsv/dpp-credentials'
import { epcisSourceReference, parseEpcisSource, pinnedContextDigests, validateEpcisDocument } from '@bsv/dpp-credentials/epcis-source'
const fixture = JSON.parse(readFileSync('fixtures/vectors/dpp/interoperability/epcis/v1.json', 'utf8'))
const vector = fixture.vectors.find(item => item.id === 'five-event-document')
const parsed = parseEpcisSource(new TextEncoder().encode(JSON.stringify(vector.input.document)), { mediaType: vector.input.media_type })
const validation = validateEpcisDocument(parsed.document, { events: parsed.events })
const contexts = pinnedContextDigests(parsed.context.document).digests
const issuer = 'did:web:issuer.example'
const options = {
  issuer, assertionMethod: `${issuer}#key-1`, actorRole: 'importer', jurisdiction: 'AU', issuedAt: '2026-10-01T00:00:00Z',
  credentialStatus: { id: 'https://issuer.example/status/1#0', type: 'BitstringStatusListEntry', statusPurpose: 'revocation', statusListIndex: '0', statusListCredential: 'https://issuer.example/status/1' },
  chainOfCustody: { chainId: 'urn:uuid:00000000-0000-4000-8000-00000000c0de', sequenceNumber: 1, parentSeals: [], topology: 'linear' },
}
for (const { pointer, type, index, eventId } of parsed.events) {
  const event = parsed.document.epcisBody.eventList[index]
  const sourceReference = epcisSourceReference({ sourceSha256: parsed.sha256, mediaType: parsed.mediaType, pointer, contextDigests: contexts, ...(eventId ? { eventId } : {}) })
  const report = mapEpcisEventWithReport(event, { ...options, id: `urn:uuid:example-${index}` }, { sourceReference, validation })
  console.log(pointer, type, report.mapping, [...report.missing, ...report.unmapped].join(', '))
}
JS
```

Expect one line per event:

| Events | Outcome and reason |
|---|---|
| Two `TransformationEvent`s | `unsupported`: transformations have no EPCIS action, and these options supply no `transformationAction` decision. |
| First `ObjectEvent` | `lossless` |
| Remaining events | `transformed`, naming meaning retained only in the round-trip extension, such as `multi-product-event` or `business-transactions, source-destination-parties`. |

For the complete exercise, [examples/import-epcis.mjs](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/examples/import-epcis.mjs) sets `transformationAction` to `ADD`. It reports one sentence per finding: source digest, contexts, schema validation, each event's identity and body digest, and mapping outcome. Run the fixture:

```sh
node examples/import-epcis.mjs
```

Or supply your EPCIS 2.0.1 document:

```sh
node examples/import-epcis.mjs <document.json>
```

It ends `Nothing was retained, issued, anchored or written to a token by this example.`

### Map under the CBV disposition crosswalk

Pass `{ profile: 'epcis-vsc@2' }` as the third argument to decide each disposition through the crosswalk in the `epcis-vsc@2` profile manifest before a SEAL is built. The result depends on the event type and action as well as the disposition: only an `ObjectEvent` whose action is `ADD` commissions its objects, while `ADD` on an aggregation, association or transaction adds objects that already exist. A source reference must name the same profile, through `epcisSourceReference({ ..., mappingProfile: 'epcis-vsc@2' })`.

| CBV disposition | Result under `epcis-vsc@2` |
|---|---|
| `active` on an `ObjectEvent` whose action is `ADD` (commissioning) | Carried verbatim: the custody origin. |
| `in_transit`, `returned` | Carried verbatim: in transit. |
| `dispensed`, `destroyed` | Carried verbatim: terminal. |
| `active` on any other event, a transformation included; `conformant`, `non_conformant`, `damaged`, `needs_replacement`, `in_progress`, `sellable_accessible`, `recalled` and the other conditions; no disposition on an `OBSERVE` event | `unsupported`, `custody-neutral`: the event records no custody state a SEAL can carry, and none is substituted. |
| Any of those at a `receiving` or `accepting` step | `unsupported`, `custody-destination-unnamed`: a hand-over at the destination, whose only VSC term, `received`, is not a CBV disposition. |
| A transit or terminal disposition on an `ObjectEvent` whose action is `ADD`; a transit disposition on one whose action is `DELETE` | `unsupported`, `lifecycle-conflict`: commissioned objects can only start at the origin, and decommissioned ones are not in transit. |
| `retail_sold`, `partially_dispensed`, `disposed`, `inactive`, `stolen` | `unsupported`, `custody-transition-unnamed`: a custody change for which no VSC term is a CBV value. |
| Anything that is not a CBV 2.0 disposition, including `stored`, `transshipped`, `transformed` and `received` | `unsupported`, `non-cbv-disposition`. |
| Any event carrying an `errorDeclaration` | `unsupported`, `error-declaration`: it says an earlier event was wrong, so a SEAL would assert a step the source retracted. |

Each `unsupported` reason starts with the limit id in the table. An `ADD` or `DELETE` event without a disposition stays `insufficient-data`. Retain refused events as evidence; the VSC custody rules are never bent to give one a SEAL. The [specification](https://github.com/bsv-blockchain/dpp/blob/fc73e35145d19c802c4cd566b4396f5a2b79a75b/spec/epcis-interoperability.md), section 5, gives the reasons. The vector file `fixtures/vectors/dpp/interoperability/epcis/v2.json` pins every outcome.

Run the package mapping tests:

```sh
npm run test -w @bsv/dpp-credentials -- test/epcis.test.ts test/epcis-source.test.ts test/epcis-report.test.ts
```

Expected result: 61 tests, all passing.

## Source definitions

| Task | Source |
|---|---|
| Select parsing and digest behaviour, and the parked mapping | [EPCIS interoperability](https://github.com/bsv-blockchain/dpp/blob/fc73e35145d19c802c4cd566b4396f5a2b79a75b/spec/epcis-interoperability.md) |
| Store an import record | [Import schema](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/epcis-import.schema.json) |
| Model an HTTP import service | [Interoperability HTTP contract](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/interoperability.yaml) |
| Use reference parsing, and the parked mapping | [Credentials package](../packages/dpp-credentials.md) |
| Run every selected case, including the parked mapping outcomes | [EPCIS vectors](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/vectors/dpp/interoperability/epcis/v1.json), and `fixtures/vectors/dpp/interoperability/epcis/v2.json` for `epcis-vsc@2` |

The [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) records exercised import and pull outcomes. Next: [external credentials](external-credentials.md), to verify a partner's W3C credential beside the passport.
