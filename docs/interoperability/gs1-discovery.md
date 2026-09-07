# GS1 discovery

Start with [identifiers](../identifiers.md). Discovery locates a passport or evidence service; the reader then evaluates what that service supplies.

| Integration input | Source |
|---|---|
| Selected discovery profile | [GS1 discovery source](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/gs1-discovery.md) |
| Identifier and resolution helpers | [Reference helpers](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-profiles/src/gs1-resolution.ts) |
| Hosted resolver interface | [Registry contract](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/contracts/registry.yaml) |
| Positive and refusal cases | [Discovery vectors](https://github.com/bsv-blockchain/dpp/tree/b8434452892b0c22a191c5bc08a7e0fc54717258/fixtures/vectors/dpp/interoperability/gs1) |

Keep resolution and signed-subject verification separate. Rewriting a discovery host does not rename the signed subject. Continue with the [passport reader](../implement/roles/passport-reader.md).
