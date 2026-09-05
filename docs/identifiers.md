# The identifier: the GTIN, who may mint it, and how a brand obtains one

**Status: informative, never normative.** [`../spec/record-model.md`](../spec/record-model.md) §3 sets the rule: the trade item number inside a GS1 Digital Link `passport_id` is allocated to the brand the record describes, a record that describes no real object carries a number under GS1 prefix 952, and the host is one that answers for the identifier. This document is the account behind that rule: what the identifier is made of, who allocates each part, what each host answers, the steps and fees for obtaining a prefix, which the normative text does not name, and how an implementation carries the number so that a demonstration number is swapped for a licensed one by changing a setting. Where this document and the normative text disagree, the normative text wins, as [`../GOVERNANCE.md`](../GOVERNANCE.md) says of everything outside `spec/`, `contracts/` and `fixtures/`. Fees and links are those published when this was written (2026-09-05) and will change; the rule does not.

## What the identifier is made of

A passport identifier is a GS1 Digital Link URI of the form `https://<host>/01/<gtin>/21/<serial>`. Three parts, three owners:

| Part | Who decides it | Rule |
|---|---|---|
| `<host>` | The writer | Any domain. `id.gs1.org` is the canonical host and the one GS1 operates; a brand's own domain is equally valid and is what most brands print. The same path names the same item at every host. |
| `01/<gtin>` | GS1, through the brand's licence | The Global Trade Item Number of the product model, always fourteen digits in a Digital Link: a GTIN-13 gains one leading zero. Its first digits are the GS1 Company Prefix licensed to the brand, then the brand's item reference, then a check digit. |
| `21/<serial>` | The brand | The unit's serial number, 1 to 20 characters from GS1's 82-character set (digits, letters of both cases and a few punctuation marks). Assigned by the brand, needing nobody's permission. |

One GTIN identifies one product model; a brand needs one GTIN per model it passports, not one per unit. The serial does the rest, so a brand with three products and a million units holds three GTINs.

## Who may mint which GTIN

A GTIN is not a string a writer may choose. The company prefix inside it is licensed to one company by the GS1 Member Organisation of that company's country, and GS1 keeps the register, which anyone can search at Verified by GS1. A plausible number under a prefix a brand does not hold is either somebody else's product or nobody's, and a passport published under it makes a permanent claim about the wrong object. That is the whole reason the record model says a writer publishes only under a prefix licensed to the brand the record describes.

GS1 reserves a handful of prefixes for its own purposes, and two matter here:

| Prefix | GS1's use | What it means for a passport |
|---|---|---|
| 950 | GS1 Global Office: real allocations for territories without a Member Organisation, and GS1's own sample products | A real number. `09506000134352` is GS1's Dal Giardino risotto, registered with complete product data, and GS1's resolver redirects any path under it to that product's page. It is the number the demonstration used until 2026-09-05, and the reason this document exists. |
| 952 | "Used for demonstrations and examples of the GS1 system" | Never licensed to anyone, so it can never be somebody else's product. The GS1 Digital Link standard's own examples use `09520123456788`. GS1's resolver answers 404 for that number at the model, at the unit and with `linkType=all` (checked 2026-09-05), which is the correct answer for a number nothing real stands behind. |

A record that describes no real object therefore carries a 952 number, unless the writer holds a prefix of its own and chooses to publish test records under it. Anyone who recognises the prefix reads it as a demonstration; anyone who looks it up at GS1 finds nothing, which is true.

**Minting a demonstration number.** A GTIN-13 under prefix 952 is `952`, nine digits of the writer's choosing, and a check digit; the Digital Link form adds a leading zero. The check digit is GS1's: number the twelve body digits from the right, multiply those in odd positions by 3 and those in even positions by 1, sum, and take the difference to the next multiple of ten. Three worked examples, each a distinct demonstration model:

| Body | GTIN-13 | In a Digital Link |
|---|---|---|
| 952000000001 | 9520000000011 | `/01/09520000000011` |
| 952000000002 | 9520000000028 | `/01/09520000000028` |
| 952012345678 | 9520123456788 | `/01/09520123456788`, GS1's own example |

A demonstration that publishes several product models mints one 952 number per model, so its identifiers read like a catalogue rather than one number with many serials.

## What each host answers

`id.gs1.org` is GS1's resolver. It answers for a GTIN only once the licensee has registered link targets for it with GS1, through its Member Organisation's resolver service or the GS1 Registry; then it redirects a scan to the brand's pages, a passport resolver among them. Until then it answers 404, and for a 952 number it always will. A brand's own host answers for whatever the brand publishes there.

Which host the identifier is minted under follows from that. A brand with a licensed GTIN and a registration at GS1 can mint under `id.gs1.org` and have the canonical form resolve. A brand without the registration, and every demonstration, mints under the host that actually answers, because an identifier that is also a dead link fails the one promise a Digital Link makes. Equivalence across hosts is by path: `/01/<gtin>/21/<serial>` names the same item wherever it is served, so a reader who prefers GS1's host rewrites the host and loses nothing, and a reader who follows the identifier as printed lands on a page.

A public check anyone can run: search the GTIN at Verified by GS1 (`https://www.gs1.org/services/verified-by-gs1`) or at a Member Organisation's mirror of it. A licensed number shows the brand and the product; a 952 number shows nothing, which for a demonstration is the correct result.

## Obtaining a GS1 Company Prefix

The steps are the same in every country; the fees and the registry differ by Member Organisation.

1. Find the GS1 Member Organisation for the country the company is incorporated in (`https://www.gs1.org/contact`). A Swiss company deals with GS1 Switzerland, which calls the prefix the GS1 base number.
2. Choose the licence by the number of product models to identify, apply, and receive the company prefix. Some Member Organisations also sell single GTINs, which suit a company with one product.
3. Register each product in the Member Organisation's registry to allocate its GTIN. The registration is what makes Verified by GS1 answer with the brand's name.
4. Publish the Digital Link on the brand's own domain, `https://<brand-host>/01/<gtin>/21/<serial>`, and put that string in the data carrier.
5. Optionally, register link targets with GS1 so that `id.gs1.org` resolves the canonical form to the brand's pages. This is what lets a GS1-aware scanner that knows nothing of the brand's host reach a passport.

GS1 Switzerland (`https://www.gs1.ch/en/barcodes-standards/barcodes`) publishes three routes, as at 2026-09-05:

| Route | Fee | Fits |
|---|---|---|
| Membership | One-time CHF 250 to 12,000 by the size of the number range, then from CHF 275 a year by turnover | Companies needing 100 to 100,000 GTINs |
| Starter Kit 10 | CHF 50 one-time | Companies with worldwide turnover under CHF 500,000 needing up to 10 GTINs |
| Single GTIN | CHF 65 one-time per GTIN, at `https://gtin.gs1.ch` | One product model |

Products are registered in MyRegistry. The membership application is at `https://www.gs1.ch/en/barcodes-standards/membership/application-gs1-membership` and the Starter Kit at `https://www.gs1.ch/en/products-services/starterkit-10/application-starterkit-10`.

## Implementing it: a demonstration number first, a licensed one later

The identifier is built from two settings and one rule, and an implementation that keeps them apart swaps a demonstration number for a licensed one by changing a setting and nothing else.

1. **Keep the GTIN out of code.** The trade item number is data about a product model, held on the brand's record beside the model, never a constant. Validate it on the way in: fourteen digits after zero padding, a correct check digit, and the prefix rule of [`../spec/record-model.md`](../spec/record-model.md) §3, which for a demonstration brand means a 952 number minted by the recipe above, one per model, and for a live brand means a number under its own prefix.
2. **Keep the host beside it.** The host the identifier is minted under is a setting of the brand or the deployment, defaulting to the resolver the deployment runs itself. A brand that has registered link targets with GS1 may set `id.gs1.org` instead. Either way the same path answers at the deployment's own host, so one route serving `/01/<gtin>/21/<serial>` is the only route needed.
3. **Mint from the settings.** A new unit's identifier is the host, the model's GTIN at fourteen digits and a serial the brand assigns. Nothing in the record layout or the verification changes with the number: a verifier treats field 3 as bytes.
4. **Swap the number when the licence arrives.** When a brand obtains its prefix by the steps above, it sets the licensed GTIN on the model, and units passported from that moment mint under it. No code change, no fixture change, no new route. A demonstration marker the payload carries, if the implementation has one, goes at the same moment, because a licensed number under a real brand describes a real product.
5. **Leave the old passports where they are.** `passport_id` is immutable across a chain and a published state is permanent, so a unit passported under a 952 number stays under it for life; the swap applies to units passported afterwards. A brand that wants a real passport for a unit that already has a demonstration one issues a new passport under the licensed number and lets the demonstration chain end where it stands. Nothing links the two, which is correct: one was never a claim about a real object.
6. **Register with GS1 last.** Once the licensed GTIN's link targets are registered, `id.gs1.org` resolves the canonical form to the brand's pages. The brand may then mint under `id.gs1.org` or keep its own host; the two are equivalent by path, and a carrier printed in either era keeps resolving.

For the reference application the two settings are the brand's GTIN on its workspace, validated on creation, and the resolver host; the constant that serves every record today is what the follow-up in [`stack.md`](stack.md) replaces.

## When a licence is the right answer, and when it is not

A licensed GTIN belongs to a real product. Buying one to make a demonstration look real would put a registered company and product behind records whose own payload says nothing real stands behind them, which is a worse misstatement than a 952 number that says so. The demonstration therefore stays on prefix 952, and the first real pilot with a real brand is the moment a prefix is obtained, by that brand, for that product. The EU's Ecodesign for Sustainable Products Regulation, which establishes the digital product passport, asks that the identifiers a passport carries and its data carrier follow internationally recognised standards; a GTIN under a licensed prefix in a GS1 Digital Link is the mainstream way to meet that, and a 952 number is not, which is one more reason a demonstration says what it is.

## What changes and what does not

Fees, links and registry names change, and this document is edited when they do. As at 2026-09-05 the reference demonstration at `dpp.bsvb.net` still publishes under `09506000134352` on `id.gs1.org`, and the decision recorded here moves it to one 952 number; the new demonstration fixture `fixtures/battery-lifecycle-v1.json` already uses `09521000000018` at `dpp.bsvb.net`, while the pinned version-1 record and chain fixtures keep the example number because their bytes change only with a format version, so moving them is a version-2 fixture set per demonstration model, minted under its own host; the conformance fixtures move to a 952 number in a following change, which regenerates every published file. Neither move changes a byte of the rule: a verifier holding the transaction and a header source verifies a record under any GTIN, and whether the GTIN was the writer's to use is GS1's question, answered at allocation.
