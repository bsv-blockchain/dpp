# Identifiers

An identifier tells the reader which product record it is looking for. GS1 Digital Link is one identifier scheme; it is not a prerequisite for every core passport.

A Global Trade Item Number (GTIN) identifies a trade item. Its allocation, its use in a product identifier and discovery of the corresponding passport are separate tasks.

## Use the identifier throughout the request

Keep the scanned or supplied passport identifier as the reader's expectation. Use discovery to locate a service, retrieve the candidate records, then check that the signed subject matches that expectation. A service URL tells the client where to ask; it does not establish which product the response concerns.

A GS1 Digital Link combines an identifier with a web address. A GTIN identifies the trade item; qualifiers such as a serial number can identify an individual instance. A correct check digit tests the number's structure, not whether a party is entitled to use it.

For the first exercise, use the identifier already supplied by the fixture. Keep its original spelling through signing and verification. The [reader example](quick-start.md#reader-and-verifier) handles the fixture identifier automatically. For a live input, [GS1 discovery](interoperability/gs1-discovery.md) explains parsing and service selection before verification.

## Source definitions

| Task | Source or guide |
|---|---|
| Choose a passport identifier | [Record identifier requirements](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/record-model.md#L35-L52) |
| Use GS1 Digital Link or a demonstration identifier | [GS1 allocation and demonstration scope](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/record-model.md#L46-L52) |
| Locate a passport from that identifier | [GS1 discovery](interoperability/gs1-discovery.md) |
| Use the reference parsing and validation helpers | [Profiles package](packages/dpp-profiles.md) |

The [GS1-952-demonstration ledger row](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json#L3037-L3045) is implemented. It records the demonstration fixture change; it does not establish that the live demonstration moved. Frozen historical fixtures remain available.

Host rewriting during discovery does not establish a signed subject binding. Use the [discovery source](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/gs1-discovery.md) and the [reader exercise](implement/roles/passport-reader.md) for those separate checks.
