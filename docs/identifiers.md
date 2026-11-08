# Identifiers

Application owners and implementers can use this page to allocate a passport identifier and verify its intended subject. GS1 Digital Link is one scheme, optional for core passports.

A Global Trade Item Number (GTIN) identifies a trade item. Allocation, product identification and passport discovery are separate tasks.

## Before you start

| Input | Where it comes from | Needed for |
|---|---|---|
| Entitlement to a real product's GTIN | Brand's licensed GS1 Company Prefix or GS1 Member Organisation | Real products |
| Demonstration item reference | Your application's catalogue counter or random allocation | Demonstrations, examples and tests |
| Host the brand controls and expects to keep | Your domain and passport application | New passport addresses |
| Item serial | Your catalogue; unique within its GTIN and never reused | Individual product instances |
| Node.js 22 or later | [Execution conventions](start/for-agents.md#facts-to-rely-on) | Running the helper snippets |
| `@bsv/dpp-profiles` and a JavaScript project | [Profiles package](packages/dpp-profiles.md) | Running the helper snippets |

Save each JavaScript snippet as `name.mjs` and run `node name.mjs` ([execution conventions](start/for-agents.md#how-to-run-what-the-pages-show)).

## Get an identifier

A passport identifier is usually a GS1 Digital Link URI:

| Field or constraint | Value |
|---|---|
| URI | `https://<host>/01/<gtin>/21/<serial>` |
| GTIN | Trade item; fourteen digits with a correct check digit |
| Serial | This instance; GS1 application identifier 21 |
| Serial length and characters | 1 to 20 characters from GS1 character set 82: letters, digits and `!"%&'()*+,-./:;<=>?_` |
| Serial uniqueness | Unique within the GTIN, never reused |
| Easy-to-read serials | Upper-case letters and digits |
| URI escaping | Characters such as `/` and `?` are allowed but percent-encoded |

1. **Obtain a real product's GTIN; never choose it.** Use a GTIN allocated under the brand's licensed prefix or by its GS1 Member Organisation. The national organisation licenses prefixes and sets fees. Stop without entitlement: another brand's prefix identifies its product, and a published state cannot be withdrawn.
2. **Use prefix 952 for demonstrations, examples and tests.** GS1 reserves it and never licenses it. Nobody allocates numbers under it. It signals that no real product stands behind the record; your application chooses the item reference.

   | Demonstration input or output | Rule |
   |---|---|
   | Item reference | Nine digits after `952`, one per catalogue product, never reused; choose from a counter or at random |
   | Fourteen-digit GTIN | `0952`, item reference and check digit |
   | First payload property | `notice`, one sentence the person reads first |
   | Example notice | `"notice": "Demonstration record: no real product stands behind this passport."` |
   | Sample payload command | `node examples/sample-payload.mjs general@2 --demonstration` starts the payload with the notice |
   | Real-product payload | Never carries the demonstration notice |

3. **Compute and check the GTIN** with `@bsv/dpp-profiles`:

   ```js
   import { gs1CheckDigit, parseGs1DigitalLink } from '@bsv/dpp-profiles'
   const data = '0952123456789'
   const gtin = data + gs1CheckDigit(data)
   console.log(parseGs1DigitalLink(`https://dpp.example.com/01/${gtin}/21/SN0001`))
   ```

   Expect `09521234567899`, `checkDigitValid: true` and `demonstration: true`.

4. **Choose a host that resolves the identifier**, such as your application. It should be a GS1-Conformant Resolver for GTINs that sends a browser to the passport page, or redirect every `/01/` request to one. Keep the name under a domain the brand controls: it becomes part of the identifier and cannot change after the first state.

   | Host option | Requirement |
   |---|---|
   | Your application | Resolve `/01/` paths as `gs1-digital-link@1` specifies, with the passport page at its own path as the item's `gs1:dpp` default; see [GS1 discovery](interoperability/gs1-discovery.md#do-you-need-a-resolver) |
   | Separate resolver | Your host redirects every `/01/` request with 307 to a resolver that holds the same records, with the passport page as the item's `gs1:dpp` default |
   | `id.gs1.org` | Answers only for GTINs whose licensee registered link targets with GS1 |

5. **Give each item its own serial** using the constraints above. `buildGs1DigitalLink` checks the GTIN and serial before building the identifier:

   ```js
   import { buildGs1DigitalLink, gs1CheckDigit } from '@bsv/dpp-profiles'

   const itemReference = '123456789'
   const data = '0952' + itemReference
   const gtin = data + gs1CheckDigit(data)
   console.log(buildGs1DigitalLink('dpp.example.com', gtin, 'SN0001'))
   ```

   Expect `https://dpp.example.com/01/09521234567899/21/SN0001`. The helper refuses a wrong check digit, serials longer than 20 characters and characters outside the set.

The [record model](https://github.com/bsv-blockchain/dpp/blob/12eb2b313b9cf826475f2b0e8968c4a64a3b8a83/spec/record-model.md) section 3 defines these rules. An application account is not a GS1 licensee; establish GTIN entitlement separately.

## Use the identifier throughout the request

1. Keep the scanned or supplied identifier as the reader's expectation.
2. Discover a service and retrieve candidate records.
3. Check that the signed subject matches the expected identifier. The service URL says where to ask, not which product an answer concerns.

**A path alone is not a passport identifier.** Two hosts can carry passports for the same GTIN and serial. Use GS1-key lookup for a path:

| Input or result | Value and action |
|---|---|
| Path without host | `01/<gtin>/21/<serial>` names a product instance, not a passport |
| GS1-key query | `{"service":"ls_dpp","query":{"gs1Key":"01/<gtin>/21/<serial>"}}` |
| Response | Every passport the index holds for the key, each with its exact identifier |
| Verification | Verify each exact identifier and report its issuing host; never assume only your host exists |
| Complete example | `node examples/verify-passport.mjs 01/<gtin>/21/<serial> <index URL>` |
| Earlier-release index | Does not answer `gs1Key`; returns 400 with `Query must provide passportId or uid` |
| Earlier-release fallback | Ask for the full address, or look up the path under each trusted host |

GS1 Digital Link combines identification and a web address: the GTIN names the trade item, qualifiers such as serials an instance. A check digit tests structure, not entitlement.

For the first exercise, keep the fixture identifier's spelling through signing and verification. The [reader example](quick-start.md#check-the-test-passports-offline) handles it automatically. [GS1 discovery](interoperability/gs1-discovery.md) covers parsing and service selection for live input.

## When a host changes

The host is written into every state. Existing passports keep their original identifier; mint new passports under the new host.

| Action or outcome | Rule |
|---|---|
| Preserve old links | Keep the old host answering for as long as the passports matter |
| Redirect | Send each `/01/<gtin>/21/<serial>` path to the same path on the new host |
| Old host disappears | Links lapse, but passport identifiers and signed subjects do not change; an index still finds each passport by its original identifier |

## Source definitions

| Task | Source or guide |
|---|---|
| Choose a passport identifier | [Record identifier requirements](https://github.com/bsv-blockchain/dpp/blob/12eb2b313b9cf826475f2b0e8968c4a64a3b8a83/spec/record-model.md#L35-L54) |
| Use GS1 Digital Link or a demonstration identifier | [GS1 allocation and demonstration scope](https://github.com/bsv-blockchain/dpp/blob/12eb2b313b9cf826475f2b0e8968c4a64a3b8a83/spec/record-model.md#L46-L54) |
| Locate a passport from that identifier | [GS1 discovery](interoperability/gs1-discovery.md) |
| Use the reference parsing and validation helpers | [Profiles package](packages/dpp-profiles.md) |

The [GS1-952-demonstration ledger row](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/conformance/manifest.json#L3037-L3045) is implemented. It records the demonstration fixture change; it does not establish that the live demonstration moved. Frozen historical fixtures remain available.

Host rewriting during discovery does not establish a signed subject binding. Use the [discovery source](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/gs1-discovery.md) and the [reader exercise](implement/roles/passport-reader.md) for those separate checks.
