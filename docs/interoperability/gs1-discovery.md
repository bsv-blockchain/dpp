# GS1 discovery

Start with [identifiers](../identifiers.md). Discovery locates a passport or evidence service; the reader then evaluates what that service supplies.

## Follow a scanned identifier

Parse the Digital Link into its GS1 key and qualifiers, such as a lot or serial number. A resolver's linkset lists available destinations and their relationship types. Select the destination for the requested task, media type and language, then retrieve the evidence it serves.

Keep the original expected product identifier through this process. Equivalent discovery keys on different hosts do not permit rewriting the subject inside signed evidence. Resolving a URL successfully also does not establish allocation authority for the identifier.

## Inspect the fixture identifier

After [setup](../quick-start.md#prepare-the-checkout), run:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
import { parseGs1DigitalLinkUri } from '@bsv/dpp-profiles'
const fixture = JSON.parse(readFileSync('fixtures/battery-lifecycle-v1.json', 'utf8'))
console.log(parseGs1DigitalLinkUri(fixture.identifiers.passportId))
JS
```

The parser reports the key and qualifiers, or a named parsing problem. This example does not make a resolver request. To integrate resolution, supply the resolver records and requested link type to the resolution helpers, then pass returned passport evidence to the reader. Missing destinations and conflicting candidates remain visible outcomes.

## Source definitions

| Integration input | Source |
|---|---|
| Selected discovery profile | [GS1 discovery source](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/gs1-discovery.md) |
| Identifier and resolution helpers | [Reference helpers](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/dpp-profiles/src/gs1-resolution.ts) |
| Hosted resolver interface | [Registry contract](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/registry.yaml) |
| Positive and refusal cases | [Discovery vectors](https://github.com/bsv-blockchain/dpp/tree/8691c12c6e81f54216ec30fe4c688f5d1b82b644/fixtures/vectors/dpp/interoperability/gs1) |

Keep resolution and signed-subject verification separate. Rewriting a discovery host does not rename the signed subject. Continue with the [passport reader](../implement/roles/passport-reader.md).

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).
