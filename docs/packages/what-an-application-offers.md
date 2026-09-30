# What a passport application offers

The standard fixes the records, the checks and the services. An application is what people use. This page lists what a passport application usually offers, who uses each part, and what each part does underneath, so you can plan its screens before you write code. [Build an application](build-an-application.md) shows the calls in order.

## Who uses it

| Who | What they do |
|---|---|
| A brand and its staff | Set up the brand, list products, issue passports and keep them up to date |
| A repairer, refurbisher or recycler | Add signed claims about a product: a repair, a test, a recycling |
| A recipient, such as a buyer or distributor | Accept a passport handed on to them |
| Anyone | Open a passport's page from its identifier and check it |

## Screens and what they do underneath

| Screen | The user | The application | Package calls | Rules |
|---|---|---|---|---|
| Account and brand | Signs in and creates a brand | Gives the brand an identity key in a wallet the brand or the platform holds, and records who may act for it | The wallet's `getPublicKey`, `didKeyFromIdentityKey` | [Identity and authority](../learn/identity-and-authority.md) |
| Catalogue | Lists product models and items | Keeps the product records and gives each item its identifier under the brand's GS1 prefix | `gs1CheckDigit`, `parseGs1DigitalLink` | [Identifiers](../identifiers.md) |
| Create a passport | Chooses the industry profile and fills in the form | Checks the data against the profile, then builds, checks, announces, sends and proves the `ISSUE` | `readPublicPayloadSchema`, `completeState`, `buildLockingScript` | [Industry profiles](../profiles/README.md), [writing lifecycle](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/writing.md) |
| Update | Records a change, such as new data or a repair | Writes an `UPDATE` that spends the tip and carries the control proof | `revealOwnerLinkage`, `completeState`, the PushDrop unlock | [Build an application](build-an-application.md) |
| Hand on | Sends an offer; the recipient redeems a claim code | Records the offer and the acceptance, signs the acceptance record, writes the `TRANSFER` that commits to it, and keeps the record | `signManagedAcceptance`, `acceptanceCommitment`, `bindAcceptanceToState` | [Managed custody](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/managed-custody.md) |
| Retire | Ends the passport, for example at recycling | Writes a `RETIRE`; nothing can follow it | `completeState` | [Record model version 2](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/record-model-v2.md) |
| Claims | A repairer or recycler signs a claim | Signs the claim, has a registry validate and store it, and anchors it | `signLifecycleClaim`, `buildAttestationAnchor` | [Rules](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/rules.md) |
| Passport page | Opens the identifier's address, or scans the label | Looks the passport up on an index, verifies it and shows the report beside the product data | `chainFromBeef`, `verifyPassportEvidence` | [Reading the report](../learn/evidence-and-freshness.md) |
| Operations | Staff see what is still pending | Shows the journal: operations the network has not answered, proofs not yet delivered, incidents | None; this is the application's own journal | [Writing lifecycle](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/writing.md) sections 6 to 8 |

## After a hand on

Under `managed-custody@1` the recipient becomes the passport's holder, and the custodian keeps its keys for them ([managed custody](https://github.com/bsv-blockchain/dpp/blob/a29f713045d501c595fec05ce03e5b5d3798ba62/spec/managed-custody.md) section 2). Everything the holder does next goes through the custodian: to hand the passport on, the holder asks the custodian for a new offer, and the same offer, acceptance and `TRANSFER` follow (section 4). Which requests the application accepts from a holder, and how it knows a request is theirs, is the application's to decide: a sign-in, a claim code or a message all work.

The standard does not yet say whether a custodian may write a state for a holder without the holder's request, or how such a request would be recorded. Until it does, an application that lets its own team update or retire a passport it has handed on makes that decision itself, and should tell the holder.

## Duties that run on their own

Some of a writer's duties come after the screen that caused them: announcing again when an index could not be reached, fetching each state's merkle proof once it is mined, and pushing that proof to every index that admitted the state. Keep them in the journal as pending tasks and run them on a schedule. An application with no scheduler, such as a front end with no background worker, accumulates states that every reader sees as unproven.

## Demonstration and live spaces

Keep a demonstration space apart from live products. A demonstration's identifiers use GS1 prefix 952, which GS1 reserves for examples, so software knows nothing real stands behind them; live products use the brand's own prefix. Every demonstration payload also starts with a `notice`, a sentence saying so to the person reading it, and the passport page shows it before the product data. A live product never carries one. Label only what your application wrote: a passport another publisher wrote, which your reader may also show, carries its own `notice` or none. A state, once written, is permanent, so a test written under a live prefix is a permanent claim about a real product.

## What the standard leaves to you

- How people sign in, and which of them may act for a brand. At Ring 0 the platform vouches for the account and the brand label.
- Who holds each wallet: the brand itself, or the platform on the brand's behalf ([custody](../learn/custody.md)).
- Storage for product records, restricted documents and the owner tier, which is encrypted and held off chain.
- The screens themselves, their languages and their accessibility.
