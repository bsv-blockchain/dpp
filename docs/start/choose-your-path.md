# Choose your path

Find the row that matches what you want to do. Each path below lists what you need and the pages to follow in order, and ends with how you know you are done. If you are an AI agent, start with [for AI agents](for-agents.md).

## Before you choose

- **The hosted services are for reading.** Anyone can look up and verify passports on the [hosted reference](../deployment.md#the-hosted-reference) and ask its registry to check a claim. Writing to its index needs its operator's tokens, so to publish your own passports you run your own index.
- **The demonstration is a demonstration.** [dpp.bsvb.net](https://dpp.bsvb.net) writes real mainnet transactions for sample brands with mock data. It is not a service for real products.
- **Everything is a beta before version 1.0.** Pin exact package versions. Nothing here is declared production-ready.
- **Two ways to build.** Use the published packages (Node.js 22, JavaScript or TypeScript), or write your own code from the specifications and test vectors.

## Paths

| I want to | You need | Path |
|---|---|---|
| Decide whether this is for us | A browser and ten minutes | [Evaluate](#evaluate) |
| See passports working before building anything | A browser | [Try the demonstration](#try-the-demonstration) |
| Check passports inside my website or application | Node.js 22 and the packages | [Read and verify](#read-and-verify) |
| Issue passports from our product system (PIM, ERP, shop) | A funded server wallet, your own index, identifiers | [Issue passports](#issue-passports) |
| Build a new passport platform end to end | Everything above, plus a registry | [Build a platform](#build-a-platform) |
| Add a repair, test, certification or recycling claim | An identity key, a registry | [Add a claim](#add-a-claim) |
| Hand a passport on, or receive one | A custodian application | [Hand on or receive](#hand-on-or-receive) |
| Run an index | Docker and a checkout of the repository | [Run an index](#run-an-index) |
| Exchange records with the hosted reference | Your own index | [Exchange with the reference](#exchange-with-the-reference) |
| Run a registry | Node.js 22 and the packages | [Run a registry](#run-a-registry) |
| Use GS1 Digital Link, EPCIS or W3C credentials with what we have | Your existing system | [Connect other standards](#connect-other-standards) |
| Choose or author product data fields | Node.js 22 and a checkout | [Product data](#product-data) |
| Implement the rules in another language | The specifications and test vectors | [Implement independently](#implement-independently) |
| Upgrade, or verify a published release | Your lockfile, npm and git | [Releases](#releases) |
| Report a problem or propose a change | A GitHub account | [Contribute](#contribute) |
| Issue passports for real products, but we have no developers | A provider who builds on the standard | [No developers](#no-developers) |

## Evaluate

1. [The DPP standard](../README.md): what it is and what it claims.
2. [The passport model](architecture.md): how passports, claims and services fit together.
3. [Quick start](../quick-start.md#read-a-live-passport): read and verify a live passport yourself.
4. [Where things stand](status.md): what works today and what is not settled.

Done when you can say what a reader checks, and what it cannot establish.

## Try the demonstration

1. Open [a sample passport](https://dpp.bsvb.net/01/09522156492290/21/792B7797E3D8) and its history.
2. Check it yourself on the [verifier](https://dpp.bsvb.net/verify).
3. Sign up on [dpp.bsvb.net](https://dpp.bsvb.net) to issue and update passports for a sample brand.

Done when you have watched a passport's history grow and verified it. The [hosted reference](../deployment.md) says what each hosted service runs.

## Read and verify

1. [Quick start](../quick-start.md#read-a-live-passport): read a live passport from the command line.
2. [Build an application, step 1](../packages/build-an-application.md#1-read-a-passport): read and verify a passport in your own code.
3. [Gather a passport's evidence](../packages/dpp-core.md#gather-a-passports-evidence): add its claims and anchors to the report.
4. [Evidence and its limits](../learn/evidence-and-freshness.md#the-sixteen-checks): what each of the report's sixteen checks means.

Done when your code prints a report whose signature and linkage checks pass for a live passport. Not settled yet: finding a publisher's index or registry from the passport alone ([limitations](../operate/limitations.md#finding-records)).

## Issue passports

1. [What a passport application offers](../packages/what-an-application-offers.md): the parts you are building.
2. [Get an identifier](../identifiers.md#get-an-identifier): a GTIN, a host you control, or demonstration prefix 952 until you have both.
3. [Choose a profile](../profiles/README.md): the product data your passports carry.
4. [Run your own index](../operate/README.md): your writer announces every state to it.
5. [Build an application, step 3](../packages/build-an-application.md#3-write-a-passport): issue and update passports with a wallet; [how the writer example works](../packages/how-the-writer-works.md) takes it apart step by step.
6. [Wallet, broadcast and proofs](../operate/wallet-broadcast-proofs.md): send, prove and recover from interruptions.
7. [Export, import and recovery](../operate/export-import-recovery.md): keep what you wrote.

Done when your index admits your `ISSUE` and the quick start's reader verifies it against your index. Before you start, read the writer's rows in [limitations](../operate/limitations.md#writing).

## Build a platform

Follow [issue passports](#issue-passports), then:

1. [Run a registry](#run-a-registry) for claims.
2. [The application service](../packages/application-service.md): the account-agnostic service the reference application uses.
3. [Federation](../operate/federation.md): exchange records with other indexes.

Done when a passport and a claim written on your platform verify from a stranger's reader.

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

Done when the recipient's acceptance is committed in the `TRANSFER` and a reader's `linkage` check passes.

## Run an index

1. [Run a service](../operate/README.md): start the index with Docker and inspect it.
2. [Wallet, broadcast and proofs](../operate/wallet-broadcast-proofs.md): how proofs reach your index.
3. [Export, import and recovery](../operate/export-import-recovery.md): back up and restore.
4. [Known limitations](../operate/limitations.md#index-host): what the index does not do yet.

Done when your index answers `GET /capabilities` with your publisher key and a lookup returns a passport you announced.

## Exchange with the reference

1. [Overlays running now](../deployment.md#overlays-running-now): who runs what and which way records flow.
2. [Federation](../operate/federation.md): name a peer, sign a publisher policy, observe the exchange.
3. [Contact the programme](#contact-the-programme) to have the hosted reference name your index and keys.

Done when your index holds a passport the reference wrote, byte for byte, and the reference holds yours. Synchronisation only pulls, so each side has to name the other ([limitations](../operate/limitations.md#synchronisation)).

## Run a registry

No registry package or image is published: you build one against the contract with the packages.

1. [Registry](../implement/roles/registry.md): the operations, in the order to build them.
2. [Contracts](../reference/contracts.md): the exact request and response shapes.
3. Compare your answers with the hosted registry at `https://dpp-resolver.bsvb.net`, whose validation is open.

Done when your `POST /validate` gives the same answer as the hosted registry for the quick start's claim.

## Connect other standards

1. [Choose an interoperability profile](../interoperability/README.md).
2. [GS1 discovery](../interoperability/gs1-discovery.md), [EPCIS source exchange](../interoperability/epcis.md), [external credentials](../interoperability/external-credentials.md) or [passport projections](../interoperability/projections.md).

Done when the page's example runs against your own data and reports what was kept, changed or not supported.

## Product data

1. [Choose a profile](../profiles/README.md): which fields a passport carries.
2. [General](../profiles/general.md), [battery](../profiles/battery.md) or [textile](../profiles/textile.md): the current profiles.
3. [Author a profile](../profiles/authoring.md) or [update applications](../profiles/updating-applications.md) when a profile changes.

Done when `node examples/sample-payload.mjs <profile> --check <your file>` accepts your payload.

## Implement independently

1. [Start an independent implementation](../implement/README.md).
2. [Run the fixtures](../implement/fixture-runner.md).
3. [Choose a role](choose-a-role.md), then follow its guide.
4. [Requirements and evidence reporting](../implement/reporting.md).

Done when your implementation passes the fixtures for its role and you can report each requirement as one sentence.

## Releases

1. [Release sets](../reference/release-sets.md): what the current set contains.
2. [Migration](../migration.md): move a deployment or application to a new set.
3. [Beta.4 publication receipt](../reference/beta-4-publication.md): reproduce and verify the published packages.

Done when your lockfile names the current set's exact versions and your tests pass.

## Contribute

1. [How the standard changes](../contribute/README.md).
2. [Report a disagreement](../contribute/disagreements.md) between the rules and an implementation.
3. Report a security problem privately, as the [security policy](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/SECURITY.md) says.

## No developers

The [demonstration](#try-the-demonstration) shows what a brand gets. Real products need a deployment of your own or one run for you by a provider that builds on the standard. [Contact the programme](#contact-the-programme) to be put in touch.

## Contact the programme

Use the [BSV Association contact form](https://bsvassociation.org/contact/) for tokens to write to the hosted reference, for having it name your index as a peer, for taking part in the trial, and for introductions. Say what you need, and include your index's URL and publisher key when you ask about the index.
