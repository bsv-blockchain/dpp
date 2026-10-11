# @bsv/vsc

`@bsv/vsc` issues and verifies supply-chain credentials in W3C formats, and reads supply-chain event documents in the GS1 EPCIS format. Use it if your application exchanges SEALs or other W3C verifiable credentials with partners, or imports EPCIS events; a passport reader or writer that uses only passports and native claims does not need it.

**Experimental prerelease:** `@bsv/vsc` 0.2.0-beta.5 is intended for implementation and interoperability testing. APIs may change significantly before a stable release; production readiness is not established.

## What it is and whether you need it

**Verifiable Supply Chain (VSC)** is a draft of the W3C Verifiable Supply Chain Community Group for credentials that record supply-chain events. This package implements a selected subset of it as its own profile, `vsc-draft-compat/0.1.0`, against the draft at revision `c279de3debcd6eab94a77034584d1750f5d65e6a`. It is not a W3C standard and the package claims no W3C certification.

**A SEAL** is the VSC credential for one signed event: which products (`what`), when, where, who acted and how, with links to the earlier SEALs in the product's chain of custody. It is a W3C verifiable credential, secured with an `Ed25519Signature2020` or `bbs-2023` proof, and it is a different format from the native lifecycle claim that `@bsv/dpp-protocol` signs. [Verifiable credentials](../learn/verifiable-credentials.md) explains the formats and how they relate to DIDs.

| You want to | Need this package? |
|---|---|
| Read, verify or write passports, or sign native claims | No: use [@bsv/dpp-protocol](dpp-protocol.md) |
| Issue or verify SEALs | Yes, the root entry point |
| Verify a W3C credential in the external passport format, or feed one into a passport's verification report | Yes, `@bsv/vsc/exchange` |
| Import EPCIS 2.0.1 event documents, or map their events to SEALs | Yes, `@bsv/vsc/epcis-source` and the root |

The package does not fund a wallet, move a passport or find records through an index; those stay with [@bsv/dpp-protocol](dpp-protocol.md) and your own wallet. It has no BSV runtime dependency.

## Install

In your project, with Node 22 or later:

```sh
npm install --save-exact @bsv/vsc@0.2.0-beta.5
```

Each package numbers its own prereleases. `@bsv/vsc` 0.2.0-beta.5 is unchanged in the current source candidate, `dpp-release-2026-10-8`, beside protocol and profiles beta.9 and overlay topics beta.11. The [release page](../reference/release-sets.md) distinguishes that candidate from the latest published set. A bare `npm install @bsv/vsc` installs the `latest` tag, the newest beta; name the exact version all the same, so an upgrade is your choice. Keep the lockfile. The package runs in Node only, as ECMAScript modules; its artefact files are plain data ([support table](support-table.md)).

## Entry points and their main functions

| Entry point | Main functions | A runnable call |
|---|---|---|
| `@bsv/vsc` | `issueSealEd25519` and `issueSealBbs` issue a SEAL; `verifySeal` verifies one, with its proof, status, issuer authority and custody chain; `parseSealBytes` reads received bytes strictly; `createDocumentLoader` supplies the pinned contexts; `mapEpcisEventWithReport` maps an EPCIS event to an unsigned SEAL. The root also re-exports every `/epcis-source` function | `npm run test -w @bsv/vsc -- test/crypto.test.ts test/verification.test.ts` in a checkout, from [verifiable credentials](../learn/verifiable-credentials.md#run-the-credential-exercises) |
| `@bsv/vsc/exchange` | `verifyExternalCredential` verifies a VC Data Model 2.0 credential under `ecdsa-rdfc-2019`; `externalCredentialVerifierFor` adapts it as the `credentialVerifier` of a verification report | [Prepare the verifier inputs](../interoperability/external-credentials.md#verify-the-vector-files-credentials) |
| `@bsv/vsc/epcis-source` | `parseEpcisSource` reads an EPCIS document's exact bytes under disclosed limits; `validateEpcisDocument` checks it against the pinned EPCIS 2.0.1 schema; `epcisEventBodyDigest` and `classifyEventArrival` tell a repeat from a change | The call below, and [EPCIS source exchange](../interoperability/epcis.md) |
| `@bsv/vsc/artifacts/*` | The retained schemas, contexts and notices, as files | |

## First call

This parses and validates one EPCIS document, the kind of event file a supplier's system sends. It needs no network, key or checkout. Save it as `vsc-first.mjs` in a project with the package installed:

```js
import { parseEpcisSource, validateEpcisDocument } from '@bsv/vsc/epcis-source'

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

`node vsc-first.mjs` prints:

```
events: ObjectEvent at /epcisBody/eventList/0
schema: pass ; findings: 0
```

In an importer, keep the bytes exactly as received rather than serialising a parsed object again. To go further, run `node examples/import-epcis.mjs` at the root of a checkout, after `npm ci` and `npm run build`: it maps each event of a seven-event fixture to an unsigned SEAL and prints the outcome, `lossless`, `transformed` or `unsupported`, with what was lost.

To issue or verify SEALs, a verifier supplies the contexts, the issuer's DID documents, a status resolver and an authority policy; a credential's own claim that its issuer is trusted is never enough. The [package guide](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/vsc/README.md) shows the issuance and verification calls with each policy.

## Limits

- The release does not claim conformance with the whole upstream VSC draft. It implements and tests a selected subset, and the upstream context and test suite were unavailable to check against ([release selection](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/selections/dpp-release-2026-10.json)). Passing its tests is not product qualification.
- A passing proof says which key signed, not that the issuer is who it claims to be: identity is at Ring 0, where only the platform account vouches for who holds a key ([identity and authority](../learn/identity-and-authority.md)).
- [Known limitations](../operate/limitations.md) collects the other open gaps of the reference services.

## Sources

| Entry point | Source |
|---|---|
| `@bsv/vsc` | [Selected credential profile](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/vsc-profile.md) |
| `@bsv/vsc/epcis-source` | [Source-event exchange](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/epcis-interoperability.md) |
| `@bsv/vsc/exchange` | [External credential profile](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/external-credential-profile.md) |
| `@bsv/vsc/artifacts/*` | [Retained schemas, contexts and notices](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/vsc/artifacts) |

## Next

| To | Go to |
|---|---|
| Verify an external credential and add it to a report | [External credential verification](../interoperability/external-credentials.md) |
| Import EPCIS events | [EPCIS source exchange](../interoperability/epcis.md) |
| Choose between a SEAL and a native claim | [Passport states and attestations](../learn/passport-and-attestations.md) |
