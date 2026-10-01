# Identifiers

An identifier tells the reader which product record it is looking for. GS1 Digital Link is one identifier scheme; it is not a prerequisite for every core passport.

A Global Trade Item Number (GTIN) identifies a trade item. Its allocation, its use in a product identifier and discovery of the corresponding passport are separate tasks.

## Get an identifier

A passport identifier is usually a GS1 Digital Link URI: `https://<host>/01/<gtin>/21/<serial>`, where the GTIN names the trade item and the serial names this instance.

1. **Obtain the GTIN; never choose it.** For a real product, use a GTIN allocated under a GS1 Company Prefix licensed to the brand, or allocated to the brand by its GS1 Member Organisation. The national member organisation licenses prefixes and sets their fees. A number under a prefix the brand does not hold identifies someone else's product, and a state published under it cannot be withdrawn.
2. **For a demonstration, example or test, use prefix 952.** GS1 reserves it for demonstrations and never licenses it, so a reader can take it as the statement that nothing real stands behind the record. Nobody allocates numbers under it, so your application picks the rest itself: a nine-digit item reference after `952`, one per product in your catalogue and never reused, from a counter or at random. The fourteen-digit GTIN is then `0952`, the item reference and the check digit. Start every demonstration payload with a `notice`, one sentence a person reads first, such as `"notice": "Demonstration record: no real product stands behind this passport."`; a record about a real product never carries one.
3. **Write fourteen digits with a correct check digit.** The helpers in `@bsv/dpp-profiles` compute and check it:

   ```js
   import { gs1CheckDigit, parseGs1DigitalLink } from '@bsv/dpp-profiles'
   const data = '0952123456789'
   const gtin = data + gs1CheckDigit(data)
   console.log(parseGs1DigitalLink(`https://dpp.example.com/01/${gtin}/21/SN0001`))
   ```

   This prints `09521234567899` with `checkDigitValid: true` and `demonstration: true`.
4. **Choose a host that answers.** The host is yours to choose. Mint under a host that answers the identifier's path with the passport page, such as your own application. That is all the host must do: it does not have to be a GS1-Conformant Resolver. A resolver, with linksets, negotiated redirects and a description file, is the optional `gs1-digital-link@1` profile on an origin of its own ([GS1 discovery](interoperability/gs1-discovery.md#do-you-need-a-resolver)). `id.gs1.org` answers only for GTINs whose licensee has registered link targets with GS1. Choose one you expect to keep, a name under a domain the brand controls: the host is part of the identifier, and the identifier cannot change after the first state.
5. **Give each item its own serial.** The serial, GS1 application identifier 21, names one physical item: 1 to 20 characters from GS1 character set 82 (letters, digits and `!"%&'()*+,-./:;<=>?_`), unique within its GTIN and never reused. Upper-case letters and digits read and print cleanly; `/`, `?` and the like are allowed but are percent-encoded in the URI. `buildGs1DigitalLink` checks the GTIN and the serial, then builds the identifier:

   ```js
   import { buildGs1DigitalLink, gs1CheckDigit } from '@bsv/dpp-profiles'

   const itemReference = '123456789'
   const data = '0952' + itemReference
   const gtin = data + gs1CheckDigit(data)
   console.log(buildGs1DigitalLink('dpp.example.com', gtin, 'SN0001'))
   ```

   This prints `https://dpp.example.com/01/09521234567899/21/SN0001`. It refuses a wrong check digit, a serial longer than 20 characters and a character outside the set.

The rules are in the [record model](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/record-model.md) section 3. An application account is not a GS1 licensee: who may publish under a GTIN is established outside the account that publishes.

## Use the identifier throughout the request

Keep the scanned or supplied passport identifier as the reader's expectation. Use discovery to locate a service, retrieve the candidate records, then check that the signed subject matches that expectation. A service URL tells the client where to ask; it does not establish which product the response concerns.

A GS1 Digital Link combines an identifier with a web address. A GTIN identifies the trade item; qualifiers such as a serial number can identify an individual instance. A correct check digit tests the number's structure, not whether a party is entitled to use it.

For the first exercise, use the identifier already supplied by the fixture. Keep its original spelling through signing and verification. The [reader example](quick-start.md#check-the-test-passports-offline) handles the fixture identifier automatically. For a live input, [GS1 discovery](interoperability/gs1-discovery.md) explains parsing and service selection before verification.

## When a host changes

The host is written into every state of the passport, so a passport keeps the host it was minted under. A writer that moves to another domain keeps its existing passports under the old host and mints new ones under the new host.

To keep the old links working, keep the old host answering: redirect each `/01/<gtin>/21/<serial>` path to the same path on the new host, for as long as the passports matter. If the old host goes, the links lapse and nothing about the passports changes: the identifier is still the subject every signature binds to, and an index still finds the passport by it.

## Source definitions

| Task | Source or guide |
|---|---|
| Choose a passport identifier | [Record identifier requirements](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/record-model.md#L35-L52) |
| Use GS1 Digital Link or a demonstration identifier | [GS1 allocation and demonstration scope](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/record-model.md#L46-L52) |
| Locate a passport from that identifier | [GS1 discovery](interoperability/gs1-discovery.md) |
| Use the reference parsing and validation helpers | [Profiles package](packages/dpp-profiles.md) |

The [GS1-952-demonstration ledger row](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/conformance/manifest.json#L3037-L3045) is implemented. It records the demonstration fixture change; it does not establish that the live demonstration moved. Frozen historical fixtures remain available.

Host rewriting during discovery does not establish a signed subject binding. Use the [discovery source](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/gs1-discovery.md) and the [reader exercise](implement/roles/passport-reader.md) for those separate checks.
