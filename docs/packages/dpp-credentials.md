# @bsv/dpp-credentials

Application developers exchanging SEALs or other W3C verifiable credentials with partners can use `@bsv/dpp-credentials` to issue and verify credentials, or read GS1 EPCIS supply-chain event documents. Readers and writers using only passports and native claims do not need it.

**Experimental prerelease:** `@bsv/dpp-credentials` 0.2.0-beta.6 is intended for implementation and interoperability testing. APIs may change significantly before a stable release; production readiness is not established.

## Preconditions

| Procedure | Input and source |
|---|---|
| Installed examples | Node 22 or later, ECMAScript modules and this package; release status is in Install. |
| First EPCIS call | The included document; no network, key or checkout. |
| SEAL issuance | Application's unsigned event credential and issuer key; contexts through `createDocumentLoader`. |
| SEAL verification | Contexts, issuer DID documents, status resolver and authority policy from configured evidence sources, never self-asserted trust. |
| Checkout exercises | Repository checkout; run `npm ci` and `npm run build` before commands at its root. |

## What it is and whether you need it

**Verifiable Supply Chain (VSC)** is the W3C Verifiable Supply Chain Community Group's draft for supply-chain event credentials. This package implements a selected subset as `vsc-draft-compat/0.1.0`, against revision `c279de3debcd6eab94a77034584d1750f5d65e6a`. It is not a W3C standard; the package claims no W3C certification.

**A SEAL** is a VSC credential for one signed event: products (`what`), when, where, who acted and how, linked to earlier SEALs in the product's custody chain. This W3C credential uses an `Ed25519Signature2020` or `bbs-2023` proof, a different format from `@bsv/dpp-protocol`'s native lifecycle claim. [Verifiable credentials](../learn/verifiable-credentials.md) explains the formats and how they relate to DIDs.

| You want to | Need this package? |
|---|---|
| Read, verify or write passports, or sign native claims | No: use [@bsv/dpp-protocol](dpp-protocol.md) |
| Issue or verify SEALs | Yes, the root entry point |
| Verify a W3C credential in the external passport format, or feed one into a passport's verification report | Yes, `@bsv/dpp-credentials/exchange` |
| Import EPCIS 2.0.1 event documents, or map their events to SEALs | Yes, `@bsv/dpp-credentials/epcis-source` and the root |

Wallet funding, passport movement and index lookups stay with [@bsv/dpp-protocol](dpp-protocol.md) and your wallet. This package has no BSV runtime dependency.

## Install

In your project, with Node 22 or later:

```sh
npm install --save-exact @bsv/dpp-credentials@0.2.0-beta.6
```

| Release fact | Value |
|---|---|
| Package | `@bsv/dpp-credentials` 0.2.0-beta.6 |
| Current source candidate | `dpp-release-2026-11`; the [release page](../reference/release-sets.md) distinguishes it from the latest published set. |
| Change | Under `epcis-vsc@1`, an inspection, repair or sensor reading reporting `active` is now refused as `maintenance-observation`, as the published profile says; the proposed `epcis-vsc@2` mapping profile is added |
| Other candidate packages | Protocol and profiles beta.10; overlay beta.13. Each package numbers its own prereleases. |
| Runtime | Node only, ECMAScript modules; artefact files are plain data ([support table](support-table.md)). |

A bare `npm install @bsv/dpp-credentials` selects `latest`, the newest beta. Pin the exact version so upgrades are your choice, and keep the lockfile.

## Entry points and their main functions

| Entry point | Main functions | A runnable call |
|---|---|---|
| `@bsv/dpp-credentials` | `issueSealEd25519` and `issueSealBbs` issue a SEAL; `verifySeal` verifies one, with its proof, status, issuer authority and custody chain; `parseSealBytes` reads received bytes strictly; `createDocumentLoader` supplies the pinned contexts; `mapEpcisEventWithReport` maps an EPCIS event to an unsigned SEAL under `epcis-vsc@1`, or under `epcis-vsc@2` with its CBV disposition crosswalk. The root also re-exports every `/epcis-source` function | `npm run test -w @bsv/dpp-credentials -- test/crypto.test.ts test/verification.test.ts` in a checkout, from [verifiable credentials](../learn/verifiable-credentials.md#run-the-credential-exercises) |
| `@bsv/dpp-credentials/exchange` | `verifyExternalCredential` verifies a VC Data Model 2.0 credential under `ecdsa-rdfc-2019`; `externalCredentialVerifierFor` adapts it as the `credentialVerifier` of a verification report | [Prepare the verifier inputs](../interoperability/external-credentials.md#verify-the-vector-files-credentials) |
| `@bsv/dpp-credentials/epcis-source` | `parseEpcisSource` reads an EPCIS document's exact bytes under disclosed limits; `validateEpcisDocument` checks it against the pinned EPCIS 2.0.1 schema; `epcisEventBodyDigest` and `classifyEventArrival` tell a repeat from a change | The call below, and [EPCIS source exchange](../interoperability/epcis.md) |
| `@bsv/dpp-credentials/artifacts/*` | The retained schemas, contexts and notices, as files | |

## First call

1. Save this complete file as `vsc-first.mjs` in your installed project. It parses and validates one EPCIS document of the kind a supplier sends:

```js
import { parseEpcisSource, validateEpcisDocument } from '@bsv/dpp-credentials/epcis-source'

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

2. Run `node vsc-first.mjs`. Expected output:

```
events: ObjectEvent at /epcisBody/eventList/0
schema: pass ; findings: 0
```

3. Retain exact received bytes, without reserialising the parsed object. Stop on parse refusal or schema findings before treating it as validated.

| Command | Expected result |
|---|---|
| `node vsc-first.mjs` | One `ObjectEvent` at `/epcisBody/eventList/0`; schema `pass`, zero findings |
| `node examples/import-epcis.mjs` | Maps the seven-event fixture to unsigned SEALs; prints `lossless`, `transformed` or `unsupported`, with what was lost. |

### Select issuance or verification inputs

| Step | Inputs and call | Output or decision |
|---|---|---|
| 1. Prepare | Configured documents to `createDocumentLoader` | Loader for pinned contexts and issuer DID documents |
| 2. Issue | Unsigned SEAL, issuer key and loader to `issueSealEd25519` or `issueSealBbs` | SEAL signed with the selected suite |
| 3. Read | Exact bytes to `parseSealBytes`; retain bytes separately | Strictly parsed credential |
| 4. Verify | Credential, loader, status resolver, authority policy and custody-chain evidence to `verifySeal` | Proof, status, issuer authority and custody findings; inspect each before reliance. |

A credential's own claim that its issuer is trusted is never enough. The [package guide](https://github.com/bsv-blockchain/dpp/blob/b245177be5efc8513e956ff110a69be53acc6d12/packages/dpp-credentials/README.md) shows the calls with each policy.

## Limits

| Limit | Meaning |
|---|---|
| Selected VSC subset | The release does not claim whole-draft conformance. The upstream context and test suite were unavailable for comparison ([release selection](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/selections/dpp-release-2026-10.json)). Passing tests is not product qualification. |
| Ring 0 identity | A passing proof identifies the signing key, not the claimed issuer. Only the platform account vouches for the key holder ([identity and authority](../learn/identity-and-authority.md)). |

[Known limitations](../operate/limitations.md) lists the reference services' other open gaps.

## Sources

| Entry point | Source |
|---|---|
| `@bsv/dpp-credentials` | [Selected credential profile](https://github.com/bsv-blockchain/dpp/blob/b245177be5efc8513e956ff110a69be53acc6d12/spec/vsc-profile.md) |
| `@bsv/dpp-credentials/epcis-source` | [Source-event exchange](https://github.com/bsv-blockchain/dpp/blob/b245177be5efc8513e956ff110a69be53acc6d12/spec/epcis-interoperability.md) |
| `@bsv/dpp-credentials/exchange` | [External credential profile](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/external-credential-profile.md) |
| `@bsv/dpp-credentials/artifacts/*` | [Retained schemas, contexts and notices](https://github.com/bsv-blockchain/dpp/tree/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/packages/dpp-credentials/artifacts) |

## Next

| To | Go to |
|---|---|
| Verify an external credential and add it to a report | [External credential verification](../interoperability/external-credentials.md) |
| Import EPCIS events | [EPCIS source exchange](../interoperability/epcis.md) |
| Choose between a SEAL and a native claim | [Passport states and attestations](../learn/passport-and-attestations.md) |
