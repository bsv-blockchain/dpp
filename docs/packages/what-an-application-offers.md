# What a passport application offers

Application planners can turn this inventory of passport screens, users and responsibilities into an implementation brief. The standard fixes records, checks and services; the application provides the experience. [Build an application](build-an-application.md) shows the calls in order.

## Before you start

| Decision | Input and scope |
|---|---|
| Features | Use [your platform brief](../start/plan-your-platform.md). Screens are optional; scope determines claims, custody transfer and service hosting |
| Components | [Choose packages and services](../start/choose-components-and-services.md) identifies what you supply or obtain from a provider |
| Custody and keys | Select the profile and wallet holders before coding. The hand-on workflow uses `managed-custody@2`; the keys table locates each secret |
| Account model | Accounts, brands and wallet placement are reference choices. Accounts, organisations, signing keys, DIDs and passport controllers are separate concepts; organise them as needed while meeting the selected role's rules |

1. Select the users and screens within your scope.
2. Assign each screen's underlying work and keys to your application or provider.
3. Include background duties and release checks in the brief.

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
| Account and brand | Signs in; creates a brand | Assigns its identity key in a wallet held by the brand or platform; records who may act for it | The wallet's `getPublicKey`, `didKeyFromIdentityKey` | [Identity and authority](../learn/identity-and-authority.md) |
| Catalogue | Lists models and items | Stores product records; assigns item identifiers under the brand's GS1 prefix | `buildGs1DigitalLink`, `gs1CheckDigit`, `parseGs1DigitalLink` | [Identifiers](../identifiers.md) |
| Create a passport | Selects a profile; fills in data | Validates data against the industry profile; builds, checks, announces, sends and proves the `ISSUE` | `readPublicPayloadSchema`, `completeState`, `buildLockingScript` | [Industry profiles](../profiles/README.md), [writing lifecycle](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/spec/writing.md) |
| Update | Records new data, a repair or another change | Writes an `UPDATE`, spending the tip with control proof | `revealOwnerLinkage`, `completeState`, and the unlock that spends the tip's PushDrop output (the script template every state uses) | [Build an application](build-an-application.md) |
| Hand on | Offers a passport; the recipient accepts by identity key or one-time claim code, distinct from a lifecycle claim | Records offer and acceptance; signs and retains the acceptance record; writes the `TRANSFER` committing to it | `signManagedAcceptance`, `acceptanceCommitment`, `bindAcceptanceToState` | [Managed custody](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/spec/managed-custody.md) |
| Retire | Ends the passport, for example at recycling | Writes a `RETIRE`; nothing can follow it | `completeState` | [Record model version 2](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/spec/record-model-v2.md) |
| Claims | Repairer or recycler signs a claim | Signs, obtains registry validation and storage, then anchors | `signLifecycleClaim`, `buildAttestationAnchor` | [Rules](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/rules.md) |
| Passport page | Opens the identifier or scans the label | Looks up the passport on an index, verifies it and shows its report beside product data | `chainFromBeef`, `verifyPassportEvidence` | [Reading the report](../learn/evidence-and-freshness.md) |
| Operations | Staff inspect pending work | Shows the journal: unanswered network operations, undelivered proofs and incidents | None; this is the application's own journal | [Writing lifecycle](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/spec/writing.md) sections 6 to 8 |

## After a hand on

Under `managed-custody@2` the recipient becomes the passport's holder, and the custodian keeps its keys for them ([managed custody](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/spec/managed-custody.md) section 2).

- **Holder requests.** All further actions go through the custodian. The holder requests a new offer to repeat the offer, acceptance and `TRANSFER` (section 4). The application chooses which requests to accept and how to confirm they came from the holder: sign-in, claim code or message.
- **How the holder leaves managed custody.** The custodian writes a `TRANSFER` to a `destinationKey`, a key the holder's own wallet derived, and from then on the holder proves control from their own wallet (section 7).
- **Acceptance screen.** Explain how to request changes or another hand on, whether the holder can read the owner tier, and how to move to their own wallet.

- **Authority after a hand on.** While the custodian keeps a holder's keys, an `UPDATE` or `RETIRE` it writes for them depends on custody: the chain shows that the custodian acted, not that the holder asked, and the verification report says so (section 6). Tell holders how they ask for a change and keep your own record of each request; a recovery by a named control authority is visible on the chain.

## Keys and secrets

Use this inventory to assign the platform's keys and secrets to their holders.

| Key or secret | Held by | Used for | Set where |
|---|---|---|---|
| Writer's identity key | Writer's BRC-100 wallet | Signs each state as actor and, when countersigning its own states, publisher | Wallet; public half in the index's publisher policy |
| Controller key | Derived in the same wallet | Controls the passport (field 6 of each version 2 state) | Derived per passport; never stored separately |
| Publisher key, public half | The index | Admitting only states this publisher countersigned | `SERVICE_IDENTITY_KEY`, or a signed publisher policy in `PUBLISHER_POLICY_FILE` |
| Custodian's identity key | Custodian's BRC-100 wallet | Signs managed acceptance records through a derived key; never exported | Wallet; public half in each record's `custodian` property |
| Submit token | The index operator and its writers | `POST /submit` and `POST /retract` on that index | `SUBMIT_TOKEN` on the index |
| Callback token | The index operator and whoever pushes proofs | `POST /arc-ingest` on that index | `ARC_CALLBACK_TOKEN` on the index; one per index, never shared with another |
| Export signing key and export token | The index operator | Signing evidence packages and exports; reading the complete export | `EXPORT_SIGNING_KEY` and `EXPORT_TOKEN` on the index |
| Anchoring service key | The anchoring service's wallet | Signs claim anchors (`anchoredBy`) | The service's wallet; indexes may list it in `ANCHOR_SERVICE_KEYS` |
| Registry write token | The registry operator | Storing claims and registering certifications | The registry's own configuration |
| WhatsOnChain key | Readers and indexes using the reference header source | Header lookups without the anonymous rate limit | `WOC_API_KEY` |

## Duties that run on their own

Journal these pending duties and run them on a schedule:

1. Announce again when an index could not be reached.
2. Fetch each state's merkle proof once it is mined.
3. Push that proof to every index that admitted the state.

Without a scheduler, such as a front end with no background worker, states accumulate that every reader sees as unproven.

## Demonstration and live spaces

Keep demonstration and live products separate:

| Space | Identifier | Reader notice |
|---|---|---|
| Demonstration | GS1 prefix 952, reserved for examples so software knows it represents no real product | Every payload starts with a `notice` sentence saying it is a demonstration; the passport page shows it before product data |
| Live | The brand's own prefix | A live product never carries a demonstration notice |

Label only what your application wrote. Another publisher's passport carries its own `notice` or none. States are permanent: a test under a live prefix permanently makes a claim about a real product.

## What the standard leaves to you

- Sign-in and authority to act for a brand. Today the platform vouches for the account and brand name; nobody checks legal identity (Ring 0).
- Wallet holder: brand or platform on its behalf ([custody](../learn/custody.md)).
- Storage for product records, restricted documents and the owner tier, which is encrypted and held off chain.
- The screens themselves, their languages and their accessibility.

Use [Prepare for production](../operate/production-readiness.md) to turn these responsibilities into release checks for your chosen platform.
