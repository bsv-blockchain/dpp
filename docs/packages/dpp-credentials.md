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
| Issue or verify SEALs, or map EPCIS events to SEALs | No: the parked VSC compatibility profile and its mappings left the package in 0.2.0-beta.6 ([parked profile](#parked-the-vsc-compatibility-profile)) |

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
| Change | The parked VSC compatibility profile and the EPCIS-to-SEAL mappings leave the package, with the Ed25519 and BBS suites they used ([removed names](#removed-names)). External credential verification is unchanged; the EPCIS source helpers lose only `readEpcisSourceReference` and `EPCIS_MAPPING_PROFILES`, which served the mappings. |
| Other candidate packages | Protocol and profiles beta.10; overlay beta.13. Each package numbers its own prereleases. |
| Runtime | Node only, ECMAScript modules; artefact files are plain data ([support table](support-table.md)). |

A bare `npm install @bsv/dpp-credentials` selects `latest`, the newest beta. Pin the exact version so upgrades are your choice, and keep the lockfile.

## Entry points and their main functions

| Entry point | Main functions | A runnable call |
|---|---|---|
| `@bsv/dpp-credentials/exchange` | `verifyExternalCredential` verifies a VC Data Model 2.0 credential under `ecdsa-rdfc-2019`; `parseExternalCredentialBytes` reads its exact bytes strictly; `verifyBitstringStatus` checks status; `createExternalDocumentLoader` serves pinned contexts and resolves `did:web` within allowed origins; `externalCredentialVerifierFor` adapts it as the `credentialVerifier` of a verification report | [Prepare the verifier inputs](../interoperability/external-credentials.md#verify-the-vector-files-credentials) |
| `@bsv/dpp-credentials/epcis-source` | `parseEpcisSource` reads an EPCIS document's exact bytes under disclosed limits; `validateEpcisDocument` checks it against the pinned EPCIS 2.0.1 schema; `epcisEventBodyDigest` and `classifyEventArrival` tell a repeat from a change | The call below, and [EPCIS source exchange](../interoperability/epcis.md) |
| `@bsv/dpp-credentials` | Re-exports every `/epcis-source` function, `createDidWebResolver`, `parseStrictJsonBytes` and `verifyTemporal`, with the shared credential and check types; it loads no proof suite | `npm run test -w @bsv/dpp-credentials -- test/strict-json.test.ts test/temporal.test.ts` in a checkout |
| `@bsv/dpp-credentials/artifacts/*` | The retained schemas, contexts and notices, as files, including the owned context and schemas the parked VSC manifests pin | |

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

To verify a partner's credential instead, follow [external credential verification](../interoperability/external-credentials.md), which runs the vector file's credentials through `verifyExternalCredential`.

## Parked: the VSC compatibility profile

**Verifiable Supply Chain (VSC)** is the W3C Verifiable Supply Chain Community Group's draft for supply-chain event credentials. `vsc-draft-compat/0.1.0` is a selected subset of it, against revision `c279de3debcd6eab94a77034584d1750f5d65e6a`. It is not a W3C standard.

**A SEAL** is a VSC credential for one signed event: products (`what`), when, where, who acted and how, linked to earlier SEALs in the product's custody chain. This W3C credential uses an `Ed25519Signature2020` or `bbs-2023` proof, a different format from `@bsv/dpp-protocol`'s native lifecycle claim.

The profile and the EPCIS-to-SEAL mappings `epcis-vsc@1` and `epcis-vsc@2` are parked: optional compatibility profiles that no release requires and that the programme does not currently develop. From 0.2.0-beta.6 their code is no longer part of this package: SEAL issuance, parsing and verification, the two proof suites, custody chains and corrections, and `mapEpcisEvent` and `mapEpcisEventWithReport`. The owned context and schemas their manifests pin stay under `artifacts/`, and their vectors stay as published.

| If you | Then |
|---|---|
| Import any of the [removed names](#removed-names) | Stay on the published `0.2.0-beta.5`, which exports the profile and `epcis-vsc@1`, or take the code from the repository history at commit [`8c82c5e`](https://github.com/bsv-blockchain/dpp/tree/8c82c5e6ca31cd991e701d1051047153c7395eae/packages/dpp-credentials), which also carries `epcis-vsc@2` and the tests. |
| Verify credentials other parties issue | Use `@bsv/dpp-credentials/exchange`, which is not parked. |
| Import EPCIS events | Use `@bsv/dpp-credentials/epcis-source`, and record each event's mapping outcome as `not-attempted`. |

The current candidate's selection, `conformance/selections/dpp-release-2026-11.json`, withholds `epcis-source-import-1`, the claim on the source helpers, from 12 November 2026, because it claims no optional profile, and the claims of the profile and both mappings moved to the ledger archive the same day, with `epcis-source-exchange-1`, whose rows included the `epcis-vsc@1` mapping; earlier sets, including the latest published `dpp-release-2026-10-10`, claimed the implemented subset and `epcis-vsc@1`. A credential's own claim that its issuer is trusted is never enough; the [package guide](https://github.com/bsv-blockchain/dpp/blob/bb82d30c988f7432e3157f8d60296855c7c935ba/packages/dpp-credentials/README.md) of an earlier commit shows the SEAL calls with each policy.

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
| `@bsv/dpp-credentials/epcis-source` | [Source-event exchange](https://github.com/bsv-blockchain/dpp/blob/bb82d30c988f7432e3157f8d60296855c7c935ba/spec/epcis-interoperability.md) |
| The parked VSC profile, no longer in the package | [Parked credential profile](https://github.com/bsv-blockchain/dpp/blob/bb82d30c988f7432e3157f8d60296855c7c935ba/spec/vsc-profile.md) |
| `@bsv/dpp-credentials/artifacts/*` | [Retained schemas, contexts and notices](https://github.com/bsv-blockchain/dpp/tree/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/packages/dpp-credentials/artifacts) |

## Next

| To | Go to |
|---|---|
| Verify an external credential and add it to a report | [External credential verification](../interoperability/external-credentials.md) |
| Import EPCIS events | [EPCIS source exchange](../interoperability/epcis.md) |
| Choose between a credential and a native claim | [Passport states and attestations](../learn/passport-and-attestations.md) |
