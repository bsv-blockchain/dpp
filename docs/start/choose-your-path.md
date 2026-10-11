# Choose your path

This is the full task index. For a smaller set of starting choices, use [Start here](../README.md), [Build or integrate](build-and-integrate.md), [Deploy and operate](../operate/overview.md) or [Technical reference](../reference/README.md).

Each path below lists its own prerequisites, steps and completion check. You do not need to finish the earlier paths first. If you are an AI agent, also read [for AI agents](for-agents.md).

## Before you choose

- **Hosted reads and writes have different access.** Anyone can look up and verify passports on the [hosted reference](../deployment.md#the-hosted-reference) and ask its registry to check a claim. Publishing needs an index that admits your publisher key and grants the necessary access. Run your own or arrange a compatible provider; the reference does not offer general write tokens.
- **The demonstration is a demonstration.** [dpp.bsvb.net](https://dpp.bsvb.net) is one: its sample brands write nothing to the blockchain, and a brand you create after signing up writes real mainnet transactions marked as sample records. It is not a service for real products.
- **Everything is a beta before version 1.0.** Pin exact package versions. Nothing here is declared production-ready.
- **Two ways to build.** Use the published packages (Node.js 22, JavaScript or TypeScript), or write your own code from the specifications and test vectors.

## Paths

| I want to | You need | Path |
|---|---|---|
| Decide what our production platform would involve | A browser and your product goals | [Evaluate](#evaluate) |
| See passports working before building anything | A browser | [Try the demonstration](#try-the-demonstration) |
| Check passports inside my website or application | Node.js 22 and the packages | [Read and verify](#read-and-verify) |
| Issue passports from our product system (PIM, ERP, shop) | Authorised signing, a funded wallet, admitting index access and identifiers | [Issue passports](#issue-passports) |
| Build a new passport platform end to end | A product scope and decisions about which parts you supply | [Build a platform](#build-a-platform) |
| Add a repair, test, certification or recycling claim | An issuer key; registry and anchoring access for the published storage workflow | [Add a claim](#add-a-claim) |
| Hand a passport on, or receive one | A custodian application | [Hand on or receive](#hand-on-or-receive) |
| Run an index | Node.js 22, npm, Docker Compose and your publisher public key; check the starter's publication status | [Run an index](#run-an-index) |
| Exchange records with the hosted reference | Your own index | [Exchange with the reference](#exchange-with-the-reference) |
| Run a registry | An implementation of its contract; the reference helpers use Node.js 22 | [Run a registry](#run-a-registry) |
| Use GS1 Digital Link, EPCIS or W3C credentials with what we have | Your existing system | [Connect other standards](#connect-other-standards) |
| Choose or author product data fields | Product requirements; Node.js 22 and a checkout for the validation example | [Product data](#product-data) |
| Implement the rules in another language | The specifications and test vectors | [Implement independently](#implement-independently) |
| Upgrade, or verify a published release | Your lockfile, npm and git | [Releases](#releases) |
| Report a problem or propose a change | A GitHub account | [Contribute](#contribute) |
| Issue passports for real products, but we have no developers | A provider who builds on the standard | [No developers](#no-developers) |

## Evaluate

1. [Plan your platform](plan-your-platform.md): scope your own production solution and complete its brief.
2. [Choose packages and services](choose-components-and-services.md): decide what to build, run or obtain from a provider.
3. [The passport model](architecture.md): understand the records, claims and verification when you need more detail.
4. [Where things stand](status.md): identify dependencies and decisions that affect your scope.

Done when you can explain the platform you intend to operate, its responsibilities, what verification establishes and the dependencies still needing a decision. No software installation is required. [Try the demonstration](#try-the-demonstration) if a visual example would help.

## Try the demonstration

1. Open [a sample passport](https://dpp.bsvb.net/01/09522156492290/21/792B7797E3D8) and its history.
2. Check it yourself on the [verifier](https://dpp.bsvb.net/verify).
3. Open a sample brand on [dpp.bsvb.net](https://dpp.bsvb.net) to add a passport to its demonstration catalogue, or sign up to create a brand of your own, whose passports are published to mainnet as sample records.

Done when you have watched a passport's history grow and verified it. The [hosted reference](../deployment.md) says what each hosted service runs.

## Read and verify

1. [Quick start](../quick-start.md): verify a fixture offline, then read a live passport from the command line.
2. [Build an application, step 1](../packages/build-an-application.md#1-read-a-passport): read and verify a passport in your own code.
3. [Gather a passport's evidence](../packages/dpp-protocol.md#gather-a-passports-evidence): add its claims and anchors to the report.
4. [Evidence and its limits](../learn/evidence-and-freshness.md#the-sixteen-checks): what each of the report's sixteen checks means.

Done when your code prints a report whose signature and linkage checks pass for a live passport. Not settled yet: finding a publisher's index or registry from the passport alone ([limitations](../operate/limitations.md#finding-records)).

## Issue passports

1. [What a passport application offers](../packages/what-an-application-offers.md): the parts you are building.
2. [Get an identifier](../identifiers.md#get-an-identifier): a GTIN, a host you control, or demonstration prefix 952 until you have both.
3. [Choose a profile](../profiles/README.md): the product data your passports carry.
4. [Choose index access](choose-components-and-services.md#what-the-existing-hosted-services-allow): arrange an admitting provider or [create your own index](../packages/create-dpp-index.md). Your writer announces every state to the chosen index.
5. [Build an application, step 3](../packages/build-an-application.md#3-write-a-passport): issue and update passports with a wallet; [how the writer example works](../packages/how-the-writer-works.md) takes it apart step by step.
6. [Wallet, broadcast and proofs](../operate/wallet-broadcast-proofs.md): send, prove and recover from interruptions.
7. [Export, import and recovery](../operate/export-import-recovery.md): keep what you wrote.

Done when your index admits your `ISSUE` and the quick start's reader verifies it against your index. Before you start, read the writer's rows in [limitations](../operate/limitations.md#writing).

## Build a platform

1. [Plan your platform](plan-your-platform.md): define the full production scope, responsibilities and acceptance criteria.
2. [What an application offers](../packages/what-an-application-offers.md) and [the application service](../packages/application-service.md): identify the application capabilities you supply. The application service is not part of the published package release.
3. Follow [read and verify](#read-and-verify) and, if your platform publishes passports, [issue passports](#issue-passports).
4. If your scope includes stored claims, [add a claim](#add-a-claim) and arrange or [implement a registry](#run-a-registry). If your operating model needs peer exchange, follow [federation](../operate/federation.md).
5. [Prepare for production](../operate/production-readiness.md): demonstrate your chosen features, evidence handling, recovery and operating responsibilities.

Done when the agreed platform scope passes its functional and operational acceptance checks, with unresolved dependencies recorded. Include verification from another reader and, when selected, retrieval and verification of your claims. A working demonstration alone does not complete this journey.

## Add a claim

1. [Quick start](../quick-start.md#sign-a-claim): sign a claim and have a registry check it.
2. [Add a claim as a repairer, certifier or recycler](../packages/add-a-claim.md): fill in, sign, store and anchor a claim about a passport you do not control.
3. [Passport states and attestations](../learn/passport-and-attestations.md): why a claim never needs control of the passport.
4. [Attestation issuer](../implement/roles/attestation-issuer.md): the issuer's exact rules.

Done when a registry validates your claim and its anchor is found by the passport's subject. Storing on the hosted registry needs its write token ([contact the programme](#contact-the-programme)).

## Hand on or receive

1. [Custody](../learn/custody.md#the-four-keys): who holds which key, and [how a managed transfer works](../learn/custody.md#how-a-managed-transfer-works).
2. [After a hand on](../learn/custody.md#after-a-hand-on-the-holders-side): what a holder can do next, and what the [application offers](../packages/what-an-application-offers.md#after-a-hand-on).
3. [Build an application, step 3](../packages/build-an-application.md#3-write-a-passport): the `TRANSFER` under managed custody.

Done when the recipient's acceptance is committed in the `TRANSFER` and the reader checks it with the acceptance evidence supplied. A passing `linkage` check alone does not resolve missing evidence or the [open custody questions](../operate/limitations.md#open-questions-in-the-standard).

## Run an index

1. [Create an index](../packages/create-dpp-index.md): generate your project, start it with Docker and check its configuration. The starter includes the runtime; there is no separate `@bsv/dpp-overlay-topics` installation step.
2. [Wallet, broadcast and proofs](../operate/wallet-broadcast-proofs.md): how proofs reach your index.
3. [Export, import and recovery](../operate/export-import-recovery.md): back up and restore.
4. [Known limitations](../operate/limitations.md#index-host): what the index does not do yet.

Done when your index answers `GET /capabilities` with your publisher key and a lookup returns a passport you announced.

## Exchange with the reference

1. [Overlays running now](../deployment.md#overlays-running-now): who runs what and which way records flow.
2. [Federation](../operate/federation.md): name a peer, sign a publisher policy, observe the exchange.
3. [Contact the programme](#contact-the-programme) to have the hosted reference name your index and keys.

Done when each index holds the other's intended records and [the transactions, histories and proofs agree](../operate/federation.md#7-confirm-both-hold-the-same-records). BEEF encodings can differ for the same records. Synchronisation only pulls, so in this static-peer route each side names the other ([limitations](../operate/limitations.md#synchronisation)).

## Run a registry

No registry package or image is published. Build against the contract, using the reference helpers or your own implementation of the selected role.

1. [Registry](../implement/roles/registry.md): the operations, in the order to build them.
2. [Contracts](../reference/contracts.md): the exact request and response shapes.
3. Compare your answers with the hosted registry at `https://dpp-resolver.bsvb.net`, whose validation is open.

First milestone: your `POST /validate` gives the expected answer for the quick start's claim, malformed input and missing evidence. Complete the role by implementing and checking [the minimum a registry serves](../implement/roles/registry.md#the-minimum-a-registry-serves), including storage and retrieval, and recording [requirement evidence](../implement/reporting.md). Validation alone is not a complete registry. Anchoring is a separately declared role.

## Connect other standards

1. [Choose an interoperability profile](../interoperability/README.md).
2. [GS1 discovery](../interoperability/gs1-discovery.md), [EPCIS source exchange](../interoperability/epcis.md), [external credentials](../interoperability/external-credentials.md) or [passport projections](../interoperability/projections.md).

Done when the page's example runs against your own data and reports what was kept, changed or not supported.

## Product data

1. [Choose a profile](../profiles/README.md): which fields a passport carries.
2. [General](../profiles/general.md), [battery](../profiles/battery.md) or [textile](../profiles/textile.md): the current profiles.
3. [Author a profile](../profiles/authoring.md) or [update applications](../profiles/updating-applications.md) when a profile changes.

Done when `node examples/sample-payload.mjs --check <profile@version> <file>` accepts your payload. Put `--check` first; placing the profile first selects sample generation instead of checking the file.

## Implement independently

1. [Start an independent implementation](../implement/README.md).
2. [Run the fixtures](../implement/fixture-runner.md).
3. [Choose a role](choose-a-role.md), then follow its guide.
4. [Requirements and evidence reporting](../implement/reporting.md).

Done when your implementation passes the fixtures for its role and you can report each requirement as one sentence.

## Releases

1. [Release sets](../reference/release-sets.md): what the current set contains.
2. [Migration](../migration.md): move a deployment or application to a new set.
3. Use the publication receipts linked from the selected release. The [beta.9 receipt](../reference/beta-9-publication.md) records the current overlay publication; the [beta.4 receipt](../reference/beta-4-publication.md) remains the historical reproduction example.

Done when your lockfile names the current set's exact versions and your tests pass.

## Contribute

1. [How the standard changes](../contribute/README.md).
2. [Report a disagreement](../contribute/disagreements.md) between the rules and an implementation.
3. Report a security problem privately, as the [security policy](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/SECURITY.md) says.

## No developers

Complete [your platform brief](plan-your-platform.md) to explain your requirements to an implementation partner. The [demonstration](#try-the-demonstration) can help illustrate the experience. Real products need an application and operating arrangements of your own or supplied by a provider; no turnkey public production service is offered here. [Contact the programme](#contact-the-programme) for introductions, and establish the provider's actual scope and access before relying on it.

## Contact the programme

Use the [BSV Association contact form](https://bsvassociation.org/contact/) for tokens to write to the hosted reference, for having it name your index as a peer, for taking part in the trial, and for introductions. Say what you need, and include your index's URL and publisher key when you ask about the index.
