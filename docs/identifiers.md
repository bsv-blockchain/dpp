# Identifiers

An identifier tells the reader which product record it is looking for. GS1 Digital Link is one identifier scheme; it is not a prerequisite for every core passport.

A Global Trade Item Number (GTIN) identifies a trade item. Its allocation, its use in a product identifier and discovery of the corresponding passport are separate tasks.

| Task | Source or guide |
|---|---|
| Choose a passport identifier | [Record identifier requirements](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/record-model.md#L35-L52) |
| Use GS1 Digital Link or a demonstration identifier | [GS1 allocation and demonstration scope](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/record-model.md#L46-L52) |
| Locate a passport from that identifier | [GS1 discovery](interoperability/gs1-discovery.md) |
| Use the reference parsing and validation helpers | [Profiles package](packages/dpp-profiles.md) |

The [GS1-952-demonstration ledger row](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/conformance/manifest.json#L3037-L3045) is implemented. It records the demonstration fixture change; it does not establish that the live demonstration moved. Frozen historical fixtures remain available.

Host rewriting during discovery does not establish a signed subject binding. Use the [discovery source](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/gs1-discovery.md) and the [reader exercise](implement/roles/passport-reader.md) for those separate checks.
