# EPCIS source exchange

Teams with EPCIS 2.0 events from manufacturing, logistics or traceability systems can use this guide to retain unchanged source evidence beside a passport. Imports never write passport states.

Electronic Product Code Information Services (EPCIS) is the GS1 standard for observations such as making, packing or shipping an item. The profiles:

| Profile | Result | Status |
|---|---|---|
| `epcis-json@1` | Retains EPCIS 2.0.1 JSON or JSON-LD exactly as received, with its validation findings, event digests and arrival classification. | Current |
| `epcis-vsc@1` | Maps events to unsigned SEALs, the Verifiable Supply Chain (VSC) profile's event credentials. A separately authorised issuer may sign them. | Parked |
| `epcis-vsc@2` | Maps the same way after deciding each CBV 2.0 disposition through a published crosswalk, refuses error declarations, and names why an event has no SEAL. | Parked, never current |
| `epcis-event-vc@1` | Signs an event as it stands, as a W3C credential keyed by its CBV 2.0 Event Hash ID, with the party's own key, for anchoring beside a passport (`@bsv/dpp-protocol`). | Proposed |

`@bsv/dpp-credentials` implements `epcis-json@1`. The two mapping profiles are parked with the VSC profile, and their manifests say so with the status `parked`: no release requires them, the programme does not currently develop them, and from `@bsv/dpp-credentials` 0.2.0-beta.6 their code is no longer in the package ([parked: map events to SEALs](#parked-map-events-to-seals)). [Sign an event](#sign-an-event) covers the direct route, which needs no mapping.

The current candidate, `dpp-release-2026-11`, claims `epcis-source-import-1`: the `epcis-json@1` source helpers, which are strict parsing under the disclosed limits, validation against the pinned schema, event-body digests and arrival classification. Its selection withholds the earlier `epcis-source-exchange-1`, whose rows also cover the parked `epcis-vsc@1` mapping. The durable import record, the separation from token operations and the pull client are left out of the new claim because only the reference application, whose source is private, exercises them; their ledger rows stay tested.

## Inputs and runtime

| Exercise | Input and source |
|---|---|
| All local commands | Node 22 or later, npm and a checkout with `npm ci` and `npm run build` completed through [setup](../quick-start.md#get-the-code). Run from its root. |
| Fixture exercises | Checkout fixture `fixtures/vectors/dpp/interoperability/epcis/v1.json`. Every identifier is synthetic; no keys or external service are required. Nothing is signed or issued. |
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

For the complete import exercise, [examples/import-epcis.mjs](https://github.com/bsv-blockchain/dpp/blob/bb82d30c988f7432e3157f8d60296855c7c935ba/examples/import-epcis.mjs) reports one sentence per finding: source digest, contexts, schema validation, and each event's identity and body digest. It maps nothing. Run the fixture:

```sh
node examples/import-epcis.mjs
```

Or supply your EPCIS 2.0.1 document:

```sh
node examples/import-epcis.mjs <document.json>
```

It ends `No event was mapped`, naming the parked mapping and the `not-attempted` outcome an import record would carry, then `Nothing was retained, issued, anchored or written to a token by this example.`

## Keep the source with the result

Retain the exact source bytes and their findings with anything derived from them. Never invent a custody event or measurement to complete output.

| Boundary | Rule |
|---|---|
| Import and custody | Imports establish no custody or passport transfer. No import, pull, mapping or export writes `ISSUE`, `UPDATE`, `TRANSFER` or `RETIRE`. |
| Later passport workflow | May cite retained source when requesting a state. The passport service independently checks tip, actor authority and recipient acceptance. |
| Event body digest | SHA-256 of the event's RFC 8785 canonical JSON without `recordTime` and `errorDeclaration`, together with sorted digests of the contexts used to read it ([specification](https://github.com/bsv-blockchain/dpp/blob/bb82d30c988f7432e3157f8d60296855c7c935ba/spec/epcis-interoperability.md), section 2). The stripped event alone cannot reproduce it. |

## The application's HTTP routes

| Interface fact | Value |
|---|---|
| Import/pull routes | Reference application routes under `/api/interoperability/epcis`, described by [contracts/interoperability.yaml](https://github.com/bsv-blockchain/dpp/blob/bb82d30c988f7432e3157f8d60296855c7c935ba/contracts/interoperability.yaml). |
| Availability and obligation | [Application service](../packages/application-service.md) source is private. These routes are not required by any conformance role. |
| Own application | Use the contract as a model if offering EPCIS import over HTTP. |

## Parked: map events to SEALs

The `epcis-vsc@1` and `epcis-vsc@2` mapping profiles and the [VSC profile](../packages/dpp-credentials.md#parked-the-vsc-compatibility-profile) they map into are parked. `mapEpcisEvent` and `mapEpcisEventWithReport` left `@bsv/dpp-credentials` in 0.2.0-beta.6; the published 0.2.0-beta.5 still exports them under `epcis-vsc@1`, and commit [`8c82c5e`](https://github.com/bsv-blockchain/dpp/tree/8c82c5e6ca31cd991e701d1051047153c7395eae/packages/dpp-credentials) carries both mappings and their tests. The current candidate, `dpp-release-2026-11`, does not claim them; earlier sets, including the latest published `dpp-release-2026-10-10`, claimed `epcis-vsc@1` within `epcis-source-exchange-1`. An implementation that leaves them out records each event's mapping outcome as `not-attempted` in its import record.

The profiles themselves are unchanged. A mapping answers one of four outcomes per event, `lossless`, `transformed`, `unsupported` or `insufficient-data`, and never invents a custody event or measurement to reach a SEAL; `epcis-vsc@2` decides each CBV 2.0 disposition through the crosswalk its manifest publishes and refuses an event carrying an error declaration. The [specification](https://github.com/bsv-blockchain/dpp/blob/bb82d30c988f7432e3157f8d60296855c7c935ba/spec/epcis-interoperability.md), sections 5 and 6, gives the rules and their reasons; `packages/dpp-profiles/manifests/interoperability/` holds both manifests, and the two mapping vectors of `fixtures/vectors/dpp/interoperability/epcis/v1.json` and all of `v2.json` pin every outcome, as published.

## Sign an event

A party that observed or performed a step can sign the EPCIS event itself, without a mapping, under the proposed exchange profile `epcis-event-vc@1` (`spec/epcis-event-profile.md`). The credential is a W3C Verifiable Credential 2.0 whose subject is the event exactly as the party holds it, whose `id` is the event's CBV 2.0 Event Hash ID, and whose proof is a compact JWS under ES256K signed by the party's one published credential key: the BRC-42 child of its identity key under `[1, 'dpp epcis event v1']` with key identifier `credential`. A verifier recomputes the hash from the subject, checks the signature against the key the `kid` names and reports each finding separately; a registry anchors the exact JWS bytes once per hash ID and issuer. Two parties signing one event are two attestations of one hash ID.

```js
import { PrivateKey, ProtoWallet } from '@bsv/sdk'
import {
  buildEpcisEventCredential, didKeyFromIdentityKey, epcisEventCredentialKey,
  signEpcisEventCredential, verifyEpcisEventCredential, epcisEventAnchorMetadata,
} from '@bsv/dpp-protocol'

const identity = PrivateKey.fromHex('7a'.repeat(32))            // a test scalar; a wallet holds the real one
const credentialKey = epcisEventCredentialKey(identity.toPublicKey().toString())
const issuer = didKeyFromIdentityKey(credentialKey)              // or your did:web, listing the key for assertion
const kid = `${issuer}#${issuer.slice('did:key:'.length)}`

const credential = buildEpcisEventCredential({ event, issuer, validFrom: new Date().toISOString() })
const jws = await signEpcisEventCredential(credential, { kid, signer: new ProtoWallet(identity) })

const result = await verifyEpcisEventCredential(jws, { checkedAt: new Date().toISOString() })
console.log(result.proof, result.time, result.hashId)
console.log(epcisEventAnchorMetadata(result))                    // the anchor fields a registry writes
```

`event` is one EPCIS 2.0.1 event object; extension members need their prefixes declared in `extensionContexts`, passed to `buildEpcisEventCredential`, and the pinned EPCIS context's own prefixes need no declaration. A BRC-100 wallet replaces the `ProtoWallet` and signs through `createSignature`; no private key reaches the profile's code. The writer refuses what it cannot hash: an event carrying `errorDeclaration`, an EPC scheme outside the subset the profile names, a Digital Link whose GTIN is not fourteen digits, an extension inside a sensor element, a vocabulary value spelled as a compact IRI, and a prefix no carried context declares, each by name. Where the hash algorithm's ratified text and the two independent reference generators part, the profile refuses rather than choosing: `fixtures/vectors/dpp/interoperability/epcis/hash-v1.json` records, for every positive case, what each generator answered and the clause the profile follows, and `fixtures/vectors/dpp/exchange/epcis-event-vc/v1.json` pins the signed credentials with published test scalars.

Status checking, DID document resolution and the EPCIS schema check are the caller's: `verifyEpcisEventCredential` takes `resolveKey` for issuers other than `did:key`, `statusVerifier` for a credential that carries `credentialStatus`, and `eventSchemaValidator` for the pinned schema; without them the status and schema findings stay `unknown`. `epcisEventCredentialVerifierFor(options)` returns the `credentialVerifier` the passport report takes. The profile is proposed and claimed by no release; the ledger rows are `EPEV-1-hash-id` to `EPEV-3-anchor-and-uniqueness`, with the registry's intake (`EPEV-4-registry-intake`) a gap.

## Source definitions

| Task | Source |
|---|---|
| Select parsing and digest behaviour, and read the parked mapping | [EPCIS interoperability](https://github.com/bsv-blockchain/dpp/blob/bb82d30c988f7432e3157f8d60296855c7c935ba/spec/epcis-interoperability.md) |
| Store an import record | [Import schema](https://github.com/bsv-blockchain/dpp/blob/d7dc9bfa6d1ca7d11df446a9882dba4f0692c2d9/contracts/epcis-import.schema.json) |
| Model an HTTP import service | [Interoperability HTTP contract](https://github.com/bsv-blockchain/dpp/blob/bb82d30c988f7432e3157f8d60296855c7c935ba/contracts/interoperability.yaml) |
| Use reference parsing | [Credentials package](../packages/dpp-credentials.md) |
| Run every selected case; the parked mapping outcomes stay pinned beside them | [EPCIS vectors](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/vectors/dpp/interoperability/epcis/v1.json), and `fixtures/vectors/dpp/interoperability/epcis/v2.json` for `epcis-vsc@2` |
| Sign and verify an event directly | `spec/epcis-event-profile.md`; `@bsv/dpp-protocol` (`epcisEvent.ts`); `fixtures/vectors/dpp/interoperability/epcis/hash-v1.json` and `fixtures/vectors/dpp/exchange/epcis-event-vc/v1.json` |

The [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) records exercised import and pull outcomes. Next: [external credentials](external-credentials.md), to verify a partner's W3C credential beside the passport.
