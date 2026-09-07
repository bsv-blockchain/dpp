# Choose an interoperability profile

| Task | Guide |
|---|---|
| Discover passport services through GS1 | [Discovery](gs1-discovery.md) |
| Verify an external credential | [External credentials](external-credentials.md) |
| Exchange Electronic Product Code Information Services (EPCIS) documents | [Source exchange](epcis.md) |
| Build a view from product-data revisions | [Projections](projections.md) |

The [interoperability profile schema](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-profiles/schemas/interoperability-profile.schema.json) and [exchange source](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/exchange.md) define selection. An import or projection is separate from a passport operation.

The [release selection](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/selections/dpp-release-2026-09-3.json) withholds the proposed United Nations Transparency Protocol (UNTP) exchange claim. Its [profile source](https://github.com/bsv-blockchain/dpp/tree/b8434452892b0c22a191c5bc08a7e0fc54717258/packages/dpp-profiles/manifests/exchange) records the proposal.

European Standard (EN) 18223 serialisation and Union DPP Registry integration remain gaps in the [ledger](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/manifest.json). An operator-supplied registration reference is not evidence that registration occurred.
