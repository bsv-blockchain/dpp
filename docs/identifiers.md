# Identifiers

An identifier tells the reader which product record it is looking for. GS1 Digital Link is one identifier scheme; it is not a prerequisite for every core passport.

A Global Trade Item Number (GTIN) identifies a trade item. Its allocation, its use in a product identifier and discovery of the corresponding passport are separate tasks.

## Get an identifier

A passport identifier is usually a GS1 Digital Link URI: `https://<host>/01/<gtin>/21/<serial>`, where the GTIN names the trade item and the serial names this instance.

1. **Obtain the GTIN; never choose it.** For a real product, use a GTIN allocated under a GS1 Company Prefix licensed to the brand, or allocated to the brand by its GS1 Member Organisation. The national member organisation licenses prefixes and sets their fees. A number under a prefix the brand does not hold identifies someone else's product, and a state published under it cannot be withdrawn.
2. **For a demonstration, example or test, use prefix 952.** GS1 reserves it for demonstrations and never licenses it, so a reader can take it as the statement that nothing real stands behind the record.
3. **Write fourteen digits with a correct check digit.** The helpers in `@bsv/dpp-profiles` compute and check it:

   ```js
   import { gs1CheckDigit, parseGs1DigitalLink } from '@bsv/dpp-profiles'
   const data = '0952123456789'
   const gtin = data + gs1CheckDigit(data)
   console.log(parseGs1DigitalLink(`https://dpp.example.com/01/${gtin}/21/SN0001`))
   ```

   This prints `09521234567899` with `checkDigitValid: true` and `demonstration: true`.
4. **Choose a host that answers.** The host is yours to choose. Mint under a host that answers the identifier's path with the passport page, such as your own application. `id.gs1.org` answers only for GTINs whose licensee has registered link targets with GS1.

The rules are in the [record model](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/record-model.md) section 3. An application account is not a GS1 licensee: who may publish under a GTIN is established outside the account that publishes.

## Use the identifier throughout the request

Keep the scanned or supplied passport identifier as the reader's expectation. Use discovery to locate a service, retrieve the candidate records, then check that the signed subject matches that expectation. A service URL tells the client where to ask; it does not establish which product the response concerns.

A GS1 Digital Link combines an identifier with a web address. A GTIN identifies the trade item; qualifiers such as a serial number can identify an individual instance. A correct check digit tests the number's structure, not whether a party is entitled to use it.

For the first exercise, use the identifier already supplied by the fixture. Keep its original spelling through signing and verification. The [reader example](quick-start.md#check-the-test-passports-offline) handles the fixture identifier automatically. For a live input, [GS1 discovery](interoperability/gs1-discovery.md) explains parsing and service selection before verification.

## Source definitions

| Task | Source or guide |
|---|---|
| Choose a passport identifier | [Record identifier requirements](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/record-model.md#L35-L52) |
| Use GS1 Digital Link or a demonstration identifier | [GS1 allocation and demonstration scope](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/record-model.md#L46-L52) |
| Locate a passport from that identifier | [GS1 discovery](interoperability/gs1-discovery.md) |
| Use the reference parsing and validation helpers | [Profiles package](packages/dpp-profiles.md) |

The [GS1-952-demonstration ledger row](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/conformance/manifest.json#L3037-L3045) is implemented. It records the demonstration fixture change; it does not establish that the live demonstration moved. Frozen historical fixtures remain available.

Host rewriting during discovery does not establish a signed subject binding. Use the [discovery source](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/gs1-discovery.md) and the [reader exercise](implement/roles/passport-reader.md) for those separate checks.
