# @bsv/dpp-credentials

Application developers verifying W3C Verifiable Credentials that partners issue in the supported external profile, or reading GS1 EPCIS supply-chain event documents, can use `@bsv/dpp-credentials`. Readers and writers using only passports and native claims do not need it.

**Experimental prerelease:** `@bsv/dpp-credentials` 0.2.0-beta.6 is intended for implementation and interoperability testing. APIs may change significantly before a stable release; production readiness is not established.

## Preconditions

| Procedure | Input and source |
|---|---|
| Installed examples | Node 22 or later, ECMAScript modules and this package; release status is in Install. |
| First EPCIS call | The included document; no network, key or checkout. |
| External credential verification | The credential's exact received bytes; issuer `did:web` documents, status evidence and an authority policy from configured evidence sources, never self-asserted trust. |
| Checkout exercises | Repository checkout; run `npm ci` and `npm run build` before commands at its root. |

## What it is and whether you need it

**A W3C Verifiable Credential** names an issuer and a subject and secures its claims with a proof a recipient can check. This package verifies credentials other parties issue in the external passport format, `vc-di-ecdsa-rdfc-2019@1`: VC Data Model 2.0 with an `ecdsa-rdfc-2019` proof from a `did:web` issuer. It parses the exact bytes strictly, then checks the proof and the issuer's key binding, validity times, status through an authenticated Bitstring Status List, authority under your policy and the subject, and reports each finding separately. It issues nothing under that profile. [Verifiable credentials](../learn/verifiable-credentials.md) explains the formats and how they relate to DIDs.

It also reads GS1 EPCIS 2.0.1 event documents under `epcis-json@1`: exact received bytes, validation against the pinned schema, event digests and arrival classification.

| You want to | Need this package? |
|---|---|
| Read, verify or write passports, or sign native claims | No: use [@bsv/dpp-protocol](dpp-protocol.md) |
| Verify a W3C credential in the external passport format, or feed one into a passport's verification report | Yes, `@bsv/dpp-credentials/exchange` |
| Import EPCIS 2.0.1 event documents | Yes, `@bsv/dpp-credentials/epcis-source` |
| Issue or verify SEALs, or map EPCIS events to SEALs | Only for the parked VSC compatibility profile, through the root entry point ([parked profile](#parked-the-vsc-compatibility-profile)) |

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
| Change | Under `epcis-vsc@1`, an inspection, repair or sensor reading reporting `active` is now refused as `maintenance-observation`, as the published profile says; the `epcis-vsc@2` mapping profile is added. Both mapping profiles are parked with the VSC profile. |
| Other candidate packages | Protocol and profiles beta.10; overlay beta.13. Each package numbers its own prereleases. |
| Runtime | Node only, ECMAScript modules; artefact files are plain data ([support table](support-table.md)). |

A bare `npm install @bsv/dpp-credentials` selects `latest`, the newest beta. Pin the exact version so upgrades are your choice, and keep the lockfile.

## Entry points and their main functions

| Entry point | Main functions | A runnable call |
|---|---|---|
| `@bsv/dpp-credentials/exchange` | `verifyExternalCredential` verifies a VC Data Model 2.0 credential under `ecdsa-rdfc-2019`; `parseExternalCredentialBytes` reads its exact bytes strictly; `verifyBitstringStatus` checks status; `createExternalDocumentLoader` serves pinned contexts and resolves `did:web` within allowed origins; `externalCredentialVerifierFor` adapts it as the `credentialVerifier` of a verification report | [Prepare the verifier inputs](../interoperability/external-credentials.md#verify-the-vector-files-credentials) |
| `@bsv/dpp-credentials/epcis-source` | `parseEpcisSource` reads an EPCIS document's exact bytes under disclosed limits; `validateEpcisDocument` checks it against the pinned EPCIS 2.0.1 schema; `epcisEventBodyDigest` and `classifyEventArrival` tell a repeat from a change | The call below, and [EPCIS source exchange](../interoperability/epcis.md) |
| `@bsv/dpp-credentials` | Re-exports every `/epcis-source` function, `createDidWebResolver` and `parseStrictJsonBytes`. Still exports the parked VSC profile: `issueSealEd25519` and `issueSealBbs` issue a SEAL; `verifySeal` verifies one, with its proof, status, issuer authority and custody chain; `parseSealBytes` reads received bytes strictly; `createDocumentLoader` supplies the pinned contexts; `mapEpcisEventWithReport` maps an EPCIS event to an unsigned SEAL under `epcis-vsc@1`, or under `epcis-vsc@2` with its CBV disposition crosswalk | `npm run test -w @bsv/dpp-credentials -- test/crypto.test.ts test/verification.test.ts` in a checkout, from [verifiable credentials](../learn/verifiable-credentials.md#run-the-credential-exercises) |
| `@bsv/dpp-credentials/artifacts/*` | The retained schemas, contexts and notices, as files | |

## First call

1. Save this complete file as `epcis-first.mjs` in your installed project. It parses and validates one EPCIS document of the kind a supplier sends:

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

2. Run `node epcis-first.mjs`. Expected output:

```
events: ObjectEvent at /epcisBody/eventList/0
schema: pass ; findings: 0
```

3. Retain exact received bytes, without reserialising the parsed object. Stop on parse refusal or schema findings before treating it as validated.

| Command | Expected result |
|---|---|
| `node epcis-first.mjs` | One `ObjectEvent` at `/epcisBody/eventList/0`; schema `pass`, zero findings |
| `node examples/import-epcis.mjs` | Reads the seven-event fixture and prints each event's identity and body digest; it maps nothing. |
| `node examples/import-epcis.mjs --map-vsc` | Also prints, through the parked SEAL mapping, `lossless`, `transformed` or `unsupported` for each event, with what was lost. |

To verify a partner's credential instead, follow [external credential verification](../interoperability/external-credentials.md), which runs the vector file's credentials through `verifyExternalCredential`.

## Parked: the VSC compatibility profile

**Verifiable Supply Chain (VSC)** is the W3C Verifiable Supply Chain Community Group's draft for supply-chain event credentials. The root entry point implements a selected subset as `vsc-draft-compat/0.1.0`, against revision `c279de3debcd6eab94a77034584d1750f5d65e6a`. It is not a W3C standard; the package claims no W3C certification.

**A SEAL** is a VSC credential for one signed event: products (`what`), when, where, who acted and how, linked to earlier SEALs in the product's custody chain. This W3C credential uses an `Ed25519Signature2020` or `bbs-2023` proof, a different format from `@bsv/dpp-protocol`'s native lifecycle claim.

The profile and the EPCIS-to-SEAL mappings `epcis-vsc@1` and `epcis-vsc@2` are parked: optional compatibility profiles that no release requires and that the programme does not currently develop. They stay exported, built and tested, so existing callers keep working, and an implementer need not support them. The current candidate's selection, `conformance/selections/dpp-release-2026-11.json`, withholds them, together with `epcis-source-exchange-1`, whose rows include the `epcis-vsc@1` mapping, and requires the narrower `epcis-source-import-1` for the source helpers in its place; earlier sets, including the latest published `dpp-release-2026-10-10`, claimed the implemented subset and `epcis-vsc@1`.

### Select issuance or verification inputs

| Step | Inputs and call | Output or decision |
|---|---|---|
| 1. Prepare | Configured documents to `createDocumentLoader` | Loader for pinned contexts and issuer DID documents |
| 2. Issue | The application's unsigned SEAL, an issuer key and the loader to `issueSealEd25519` or `issueSealBbs` | SEAL signed with the selected suite |
| 3. Read | Exact bytes to `parseSealBytes`; retain bytes separately | Strictly parsed credential |
| 4. Verify | Credential, loader, issuer DID documents, status resolver, authority policy and custody-chain evidence from configured evidence sources to `verifySeal` | Proof, status, issuer authority and custody findings; inspect each before reliance. |

A credential's own claim that its issuer is trusted is never enough. The [package guide](https://github.com/bsv-blockchain/dpp/blob/fc73e35145d19c802c4cd566b4396f5a2b79a75b/packages/dpp-credentials/README.md) shows the calls with each policy.

## Limits

| Limit | Meaning |
|---|---|
| Parked VSC subset | The current candidate, `dpp-release-2026-11`, does not claim it; earlier sets, including the latest published `dpp-release-2026-10-10`, claimed the implemented subset. The current candidate's selection withholds the implemented subset as parked and whole-draft conformance as before, because the upstream context and test suite were unavailable for comparison ([earlier release selection](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/selections/dpp-release-2026-10.json)). Passing tests is not product qualification. |
| Ring 0 identity | A passing proof identifies the signing key, not the claimed issuer. Only the platform account vouches for the key holder ([identity and authority](../learn/identity-and-authority.md)). |

[Known limitations](../operate/limitations.md) lists the reference services' other open gaps.

## Sources

| Entry point | Source |
|---|---|
| `@bsv/dpp-credentials/exchange` | [External credential profile](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/external-credential-profile.md) |
| `@bsv/dpp-credentials/epcis-source` | [Source-event exchange](https://github.com/bsv-blockchain/dpp/blob/fc73e35145d19c802c4cd566b4396f5a2b79a75b/spec/epcis-interoperability.md) |
| `@bsv/dpp-credentials`, parked VSC modules | [Parked credential profile](https://github.com/bsv-blockchain/dpp/blob/fc73e35145d19c802c4cd566b4396f5a2b79a75b/spec/vsc-profile.md) |
| `@bsv/dpp-credentials/artifacts/*` | [Retained schemas, contexts and notices](https://github.com/bsv-blockchain/dpp/tree/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/packages/dpp-credentials/artifacts) |

## Next

| To | Go to |
|---|---|
| Verify an external credential and add it to a report | [External credential verification](../interoperability/external-credentials.md) |
| Import EPCIS events | [EPCIS source exchange](../interoperability/epcis.md) |
| Choose between a credential and a native claim | [Passport states and attestations](../learn/passport-and-attestations.md) |
