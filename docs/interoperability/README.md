# Choose an interoperability profile

Interoperability connects a passport to existing identifiers, event systems and credential formats. Select it by the information being exchanged: finding a service, importing events, verifying a credential and composing a product view are different operations.

For example, an EPCIS document can provide source events for a product view while the passport remains a native record. A discovered service can return evidence that still needs subject and signature checks. Preserve the original source and the mapping result so another participant can see what survived the exchange.

Start with one route below, run its local exercise, then connect it to the [reader](../implement/roles/passport-reader.md) or [registry](../implement/roles/registry.md). Agree the representation and profile version with the receiving party before exchanging live data.

| Task | Guide |
|---|---|
| Discover passport services through GS1 | [Discovery](gs1-discovery.md) |
| Verify an external credential | [External credentials](external-credentials.md) |
| Exchange Electronic Product Code Information Services (EPCIS) documents | [Source exchange](epcis.md) |
| Build a view from product-data revisions | [Projections](projections.md) |

The [interoperability profile schema](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/dpp-profiles/schemas/interoperability-profile.schema.json) and [exchange source](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/exchange.md) define selection. An import or projection is separate from a passport operation.

The [release selection](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/selections/dpp-release-2026-09-3.json) withholds the proposed United Nations Transparency Protocol (UNTP) exchange claim. Its [profile source](https://github.com/bsv-blockchain/dpp/tree/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/dpp-profiles/manifests/exchange) records the proposal.

European Standard (EN) 18223 serialisation and Union DPP Registry integration remain gaps in the [ledger](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json). An operator-supplied registration reference is not evidence that registration occurred.
