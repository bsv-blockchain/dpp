# GS1 discovery

Brands using GS1 Digital Link codes and readers starting from scans can use this guide to choose whether to run a resolver, find passport evidence and verify the scanned subject. The tables identify the published helpers for each step.

A Digital Link is a web address carrying a GS1 key: in `https://dpp.bsvb.net/01/09521000000018/21/BATT-0001`, application identifier `01` is the GTIN and `21` the serial. Discovery finds services; readers verify their responses.

## Discovery prerequisites

| Task | Input and source |
|---|---|
| Publish identifiers | Mint them first under a host you control, following [identifiers](../identifiers.md). That host must serve each identifier's passport page. |
| Select a resolver | Use scanners' or trading partners' resolution requirements to decide whether the optional profile below is needed. |
| Follow a scan | Preserve the original scanned identifier as the expected subject. |
| Run local examples | Node 22 or later, npm and a checkout with `npm ci` and `npm run build` completed through [setup](../quick-start.md#get-the-code). Run from its root; the exercises make no network requests. |

## Do you need a resolver?

Usually not: your application can serve passport pages under its identifier host. Adopt optional `gs1-digital-link@1` when scanners or partners expect several destinations or selection by language or link type.

| GS1-Conformant Resolver responsibility | Behaviour |
|---|---|
| Linkset | For each identifier, lists product links labelled by type, such as `gs1:pip` for product information. |
| Resolution | Redirects to the best match for requested link type, media type and language. |
| Description | Publishes `/.well-known/gs1resolver`. |
| Deployment | Uses its own origin, separate from its API. |

Build a resolver with published `@bsv/dpp-profiles` helpers, or name an external GS1-Conformant Resolver that discovery clients read through the same contract:

| Helper | Task |
|---|---|
| `resolutionRecordProblems` | Check records before storage |
| `matchRecords`, `resolveLinks` | Answer requests |
| `linksetDocument` | Build linksets |
| `describeResolver` | Build description files |
| `selectLink` | Select links on the client |

The [specification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/gs1-discovery.md), sections 1 and 4, also names the reference registry's resolver. That registry has no public source, package or image ([registry](../implement/roles/registry.md)). The hosted reference runs no resolver. Despite its name, `dpp-resolver.bsvb.net`'s capability document reports `"discovery": "not-configured"` and serves no `/.well-known/gs1resolver`. There is no hosted resolver origin to use ([hosted reference](../deployment.md#the-hosted-reference)).

## Follow a scanned identifier

1. Parse with `parseGs1DigitalLinkUri` and handle the result:

   | Result | Meaning and next step |
   |---|---|
   | `uncompressed` | GS1 key and qualifiers, such as lot (`10`) or serial (`21`). Continue. |
   | `compressed` | Use `decompressGs1DigitalLink` to obtain uncompressed form. |
   | `invalid` | Named reason, never an exception. Stop this discovery attempt. |

2. Request the identifier with `Accept: application/linkset+json` or `?linkType=linkset`. Resolvers never redirect this request. Without a resolver, the host serves its page: `dpp.bsvb.net` does so regardless of `Accept`.
3. Use `selectLink` for the required relation:

   | Relation | Destination |
   |---|---|
   | `gs1:defaultLink` | Default link |
   | `gs1:pip` | Product information |
   | `https://dpp.bsvb.net/link/evidencePackage/1`, exported as `DPP_EVIDENCE_PACKAGE_LINK_TYPE` | Portable evidence package. This standard defines the relation because GS1 has none. |

   The result is one link with anchor and scope, ambiguous candidates, or not found with available relations. Keep ambiguity visible instead of choosing an unsupported match. A GTIN-anchor link is inherited model information, not an item fact.
4. Retrieve evidence and pass the scanned identifier as expected subject to a [passport reader](../implement/roles/passport-reader.md).

Apply these matching rules throughout:

1. Preserve the original identifier. Equivalent keys across hosts do not authorise rewriting signed subjects; changing discovery hosts does not rename them. A resolving URL does not establish the GS1 allocation holder.
2. For GS1-key lookup, `gs1Key` on `ls_dpp` returns every passport under its own exact identifier, regardless of issuance host. Verify each against that identifier, never the lookup key ([identifiers](../identifiers.md)).
3. The hosted page check first looks up the exact identifier. Only after a miss, for a hostless path or an identifier under its own hosts, it tries that path under other known hosts. It verifies any found passport under its own identifier ([hosted reference](../deployment.md#the-hosted-reference)).

## Run the examples

Parse the battery fixture's identifier:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
import { parseGs1DigitalLinkUri } from '@bsv/dpp-profiles'
const fixture = JSON.parse(readFileSync('fixtures/battery-lifecycle-v1.json', 'utf8'))
console.log(parseGs1DigitalLinkUri(fixture.identifiers.passportId))
JS
```

The returned object's relevant fields are:

```text
kind: 'uncompressed'
host: 'dpp.bsvb.net'
primaryKey: { ai: '01', value: '09521000000018', checkDigitValid: true, demonstration: true }
qualifiers: [{ ai: '21', value: 'BATT-0001' }]
```

The qualifier is the serial; `demonstration: true` identifies prefix 952. No request is made. Run the complete offline flow next:

```sh
node examples/resolve-digital-link.mjs
```

The [example](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/examples/resolve-digital-link.mjs) checks three demonstration model/lot/item records, parses the URI, resolves for a public audience, builds a linkset, selects links and builds the description. Expect thirteen `Holds:` sentences, including the evidence-package link at item level and no restricted links reaching the public, then `Every sentence above holds.` Supply a URI argument to try another, including compressed input.

## Add a passport link to a resolver you already run

Register links on the item's serial-level record: the passport page under your product-information link type and evidence under `https://dpp.bsvb.net/link/evidencePackage/1`. This makes them item facts.

`examples/resolve-digital-link.mjs` shows these item-record fields:

| Field | Example shape or value |
|---|---|
| `key` | GTIN: `ai: '01'`, `value: GTIN` |
| `qualifiers` | Serial: `[{ ai: '21', value: 'SER-0001' }]` |
| `configurationRevision` | `'example-1'` |
| `links` | Evidence entry with `rel: DPP_EVIDENCE_PACKAGE_LINK_TYPE`, destination `href`, `title`, `type: 'application/json'` and `disclosure: 'public'` |
| Optional `passportId`, `bindingRef` | Exact signed passport identifier and reference to evidence establishing its binding |

Never derive the bound passport identifier from the GS1 key (specification section 2).

## Known gaps

These are open standard questions; [known limitations](../operate/limitations.md) covers reference-service limits.

| Gap | Consequence |
|---|---|
| No claim-registry link type | Readers learn the registry out of band. |
| Record-model text, section 3 | Still says identifier hosts run "its own resolver". This page, [identifiers](../identifiers.md) and the profile permit a passport page with an optional resolver. |

## Source definitions

| Integration input | Source |
|---|---|
| Selected discovery profile | [GS1 discovery source](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/gs1-discovery.md) |
| Identifier and resolution helpers | [Reference helpers](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/src/gs1-resolution.ts) |
| The reference registry's resolver interface | [Registry contract](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/registry.yaml); its `https://id.example.org` is a placeholder origin |
| Positive and refusal cases | [Discovery vectors](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/vectors/dpp/interoperability/gs1) |

Next: the [passport reader](../implement/roles/passport-reader.md) verifies discovered evidence.
