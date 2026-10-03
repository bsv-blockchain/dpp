# GS1 discovery

This page is for brands whose products carry GS1 Digital Link codes, and for readers that start from a scanned code. It says whether you need a GS1 resolver (usually not), how a reader gets from a scan to passport evidence, and which published helpers do each step; mint the identifiers first, as [identifiers](../identifiers.md) shows.

A GS1 Digital Link is a web address that carries a GS1 key, such as `https://dpp.bsvb.net/01/09521000000018/21/BATT-0001`: application identifier `01` is the GTIN and `21` the serial. Discovery finds the services that hold a product's passport and evidence; the reader then verifies what those services return.

## Do you need a resolver?

Usually not. The host you mint identifiers under must answer each identifier's path with the passport page, and your own application does that. A GS1-Conformant Resolver is more: for every identifier it serves a linkset, the list of the product's links each labelled with a link type such as `gs1:pip` for product information; it redirects a request to the link that best matches the link type, media type and language asked for; and it publishes a description file at `/.well-known/gs1resolver`. That is the optional `gs1-digital-link@1` profile.

Adopt it when scanners or trading partners expect GS1 resolution: several destinations per product, or links chosen by language or link type. A deployment that adopts it gives the resolver an origin of its own, separate from its API, and has two choices today:

- **Build the resolver** with the published `@bsv/dpp-profiles` helpers: `resolutionRecordProblems` checks a record before it is stored, `matchRecords` and `resolveLinks` answer a request, `linksetDocument` builds the linkset, `describeResolver` builds the description file, and `selectLink` is the client's side.
- **Name an external GS1-Conformant Resolver**, which a discovery client reads through the same contract.

The [GS1 discovery specification](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/gs1-discovery.md) (sections 1 and 4) also names running the reference registry's resolver. That registry is not published: its source is not public, and no package or image of it exists ([registry](../implement/roles/registry.md)). The hosted reference runs no resolver either. The hosted registry at `dpp-resolver.bsvb.net` has no resolver configured despite its name: its capability document reads `"discovery": "not-configured"` and it serves no `/.well-known/gs1resolver`. There is no hosted resolver origin to point at ([hosted reference](../deployment.md#the-hosted-reference)).

## Follow a scanned identifier

1. **Parse the Digital Link** with `parseGs1DigitalLinkUri`. It answers `uncompressed` with the GS1 key and its qualifiers, such as a lot (`10`) or serial (`21`); `compressed`, which `decompressGs1DigitalLink` turns into the uncompressed form; or `invalid` with a named reason, never an exception.
2. **Ask for the linkset.** Request the identifier with the header `Accept: application/linkset+json`, or add `?linkType=linkset`; a resolver never redirects that request. A host without a resolver answers with its passport page instead: `dpp.bsvb.net` returns the page whatever the `Accept` header asks for.
3. **Select the link** with `selectLink`. Ask for the relation you need: `gs1:defaultLink` for the default destination, `gs1:pip` for product information, or `https://dpp.bsvb.net/link/evidencePackage/1` (exported as `DPP_EVIDENCE_PACKAGE_LINK_TYPE`) for the passport's portable evidence package, a relation this standard defines because the GS1 vocabulary has none. The answer is one link with its anchor and scope, an ambiguous set of candidates, or not found with the relations that are available. A link found under the GTIN's anchor is model information the item inherits, not an item fact.
4. **Retrieve the evidence and verify it** with a [passport reader](../implement/roles/passport-reader.md), passing the identifier the scan gave as the expected subject.

Keep the original identifier through all four steps. Equivalent keys on different hosts do not permit rewriting the subject inside signed evidence, and rewriting a discovery host does not rename the signed subject. A lookup by GS1 key, `gs1Key` on `ls_dpp`, keeps to this: it answers every passport for the key under its own exact identifier, whatever host it was issued under, and the reader verifies each against that identifier, never against the key it asked with ([identifiers](../identifiers.md)). A URL that resolves also does not establish who GS1 allocated the number to. The hosted reference's page check does the same: it looks an identifier up exactly as given, tries the same path under the other hosts it knows only for a path without a host, or an identifier under one of its own hosts, that the exact lookup does not find, and checks a passport it finds under that passport's own identifier ([hosted reference](../deployment.md#the-hosted-reference)).

## Run the examples

At the root of a checkout, after [setup](../quick-start.md#get-the-code), parse the battery fixture's identifier:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
import { parseGs1DigitalLinkUri } from '@bsv/dpp-profiles'
const fixture = JSON.parse(readFileSync('fixtures/battery-lifecycle-v1.json', 'utf8'))
console.log(parseGs1DigitalLinkUri(fixture.identifiers.passportId))
JS
```

It prints an object with `kind: 'uncompressed'`, `host: 'dpp.bsvb.net'`, a `primaryKey` of `ai: '01'` and `value: '09521000000018'` with `checkDigitValid: true` and `demonstration: true` (the 952 prefix), and one qualifier, `{ ai: '21', value: 'BATT-0001' }`. It makes no request.

Then run the whole flow, from records to a selected link, with no network:

```sh
node examples/resolve-digital-link.mjs
```

[`examples/resolve-digital-link.mjs`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/examples/resolve-digital-link.mjs) checks three demonstration resolution records (model, lot and item), parses the URI, resolves it for a public audience, builds the linkset, selects links as a client would and builds the description file. It prints thirteen `Holds:` sentences, among them that the evidence package link is found at the item level and that a restricted link never reaches the public, and ends with `Every sentence above holds.` Give it a URI as its argument to try another, including a compressed one.

## Add a passport link to a resolver you already run

If your products already resolve through a GS1-Conformant Resolver, register the passport on the item's own record, at the serial level, so it is an item fact: the passport page under the link type you use for product information, and the evidence package under `https://dpp.bsvb.net/link/evidencePackage/1`. The item record in `examples/resolve-digital-link.mjs` is that shape. A record may also carry the exact signed passport identifier it is bound to, with a reference to the evidence that established the binding; it never derives one from the GS1 key (specification section 2).

## Known gaps

These are open questions in the standard; [known limitations](../operate/limitations.md) lists the reference service's limits.

- No link type names the registry that holds a passport's claims, so a reader learns the registry out of band.
- The record model's text (section 3) still says a host that mints identifiers runs "its own resolver"; this page, [identifiers](../identifiers.md) and the profile itself say a passport page is enough and a resolver is optional.

## Source definitions

| Integration input | Source |
|---|---|
| Selected discovery profile | [GS1 discovery source](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/gs1-discovery.md) |
| Identifier and resolution helpers | [Reference helpers](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/dpp-profiles/src/gs1-resolution.ts) |
| The reference registry's resolver interface | [Registry contract](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/contracts/registry.yaml); its `https://id.example.org` is a placeholder origin |
| Positive and refusal cases | [Discovery vectors](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/vectors/dpp/interoperability/gs1) |

Next: the [passport reader](../implement/roles/passport-reader.md), which verifies what discovery found.
