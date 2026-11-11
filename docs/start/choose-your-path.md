# Choose your path

Application teams, operators and evaluators can use this full task index to choose a path and completion check. Start any path directly. AI agents should also read [for AI agents](for-agents.md).

For fewer starting choices, use [Start here](../README.md), [Build or integrate](build-and-integrate.md), [Deploy and operate](../operate/overview.md) or [Technical reference](../reference/README.md).

## Before you choose

- **Hosted access:** anyone can look up and verify passports on the [hosted reference](../deployment.md#the-hosted-reference) or ask its registry to check a claim. The reference does not offer general write tokens.
- **Demonstration limits:** [dpp.bsvb.net](https://dpp.bsvb.net) sample brands write nothing to the blockchain. A brand you create after signing up writes real mainnet transactions marked as samples. This is not a service for real products.
- **Release limits:** everything is a beta before version 1.0. Pin exact package versions; nothing here is declared production-ready.
- **Build choices:** published packages use Node.js 22 with JavaScript or TypeScript. Alternatively, implement the specifications and test vectors yourself.

## Paths

Obtain each route's prerequisites from the owner or guide named below.

| I want to | You need | Path |
|---|---|---|
| Decide what our production platform would involve | A browser and your product goals; no software installation | [Evaluate](#evaluate) |
| See passports working before building anything | A browser | [Try the demonstration](#try-the-demonstration) |
| Check passports inside my website or application | Node.js 22 and the packages | [Read and verify](#read-and-verify) |
| Issue passports from our product system (PIM, ERP, shop) | Authorised signing, a funded wallet, identifiers from the identifier guide and index access from your operator or a compatible provider; it must admit your publisher key. Read the writer's [limitations](../operate/limitations.md#writing) first | [Issue passports](#issue-passports) |
| Build a new passport platform end to end | A product scope and decisions about which parts you supply | [Build a platform](#build-a-platform) |
| Add a repair, test, certification or recycling claim | Your issuer key; registry and anchoring access for published storage. Hosted storage needs a write token from the [programme](#contact-the-programme) | [Add a claim](#add-a-claim) |
| Hand a passport on, or receive one | A custodian application | [Hand on or receive](#hand-on-or-receive) |
| Run an index | Git, Docker Compose, a source checkout and your publisher public key | [Run an index](#run-an-index) |
| Exchange records with the hosted reference | Your own index | [Exchange with the reference](#exchange-with-the-reference) |
| Run a registry | Your implementation of its contract; no package or image is published. Reference helpers use Node.js 22 | [Run a registry](#run-a-registry) |
| Use GS1 Digital Link, EPCIS or W3C credentials with what we have | Your existing system | [Connect other standards](#connect-other-standards) |
| Choose or author product data fields | Product requirements; for validation, Node.js 22 and a [checkout](../quick-start.md#get-the-code) after `npm ci` and `npm run build`, your profile and payload file | [Product data](#product-data) |
| Implement the rules in another language | The specifications and test vectors | [Implement independently](#implement-independently) |
| Upgrade, or verify a published release | Your lockfile, npm and git | [Releases](#releases) |
| Report a problem or propose a change | A GitHub account | [Contribute](#contribute) |
| Issue passports for real products, but we have no developers | A provider who builds on the standard | [No developers](#no-developers) |

## Evaluate

1. [Plan your platform](plan-your-platform.md): scope production and complete the brief.
2. [Choose packages and services](choose-components-and-services.md) to build, run or obtain.
3. Read [the passport model](architecture.md) for records, claims and verification detail.
4. Check [status](status.md) for dependencies and scope decisions.

**Completion check:** explain your platform, responsibilities, verification limits and undecided dependencies. [Try the demonstration](#try-the-demonstration) for a visual example.

## Try the demonstration

1. Open [a sample passport](https://dpp.bsvb.net/01/09522156492290/21/792B7797E3D8) and its history.
2. Check it yourself on the [verifier](https://dpp.bsvb.net/verify).
3. On [dpp.bsvb.net](https://dpp.bsvb.net), add a passport to a sample brand's demonstration catalogue, or sign up and create a brand that publishes sample passports to mainnet.

**Completion check:** watch a passport's history grow and verify it. [Hosted services](../deployment.md) lists deployed versions.

## Read and verify

1. [Quick start](../quick-start.md): verify an offline fixture, then a live passport from the command line.
2. [Read and verify in your code](../packages/build-an-application.md#1-read-a-passport).
3. [Gather a passport's evidence](../packages/dpp-protocol.md#gather-a-passports-evidence): add its claims and anchors to the report.
4. Interpret [the report's sixteen checks](../learn/evidence-and-freshness.md#the-sixteen-checks).

**Completion check:** your live-passport report passes signature and linkage checks. Finding its publisher's index or registry from the passport alone remains unsettled ([limitations](../operate/limitations.md#finding-records)).

## Issue passports

1. Identify [the application parts](../packages/what-an-application-offers.md) you will build.
2. [Get an identifier](../identifiers.md#get-an-identifier): a GTIN, a host you control, or demonstration prefix 952 until you have both.
3. [Choose a profile](../profiles/README.md): the product data your passports carry.
4. [Arrange an admitting provider](choose-components-and-services.md#what-the-existing-hosted-services-allow) or [run your own index](../operate/README.md). Announce every state to it.
5. [Issue and update with a wallet](../packages/build-an-application.md#3-write-a-passport); [the writer example](../packages/how-the-writer-works.md) explains each step.
6. [Wallet, broadcast and proofs](../operate/wallet-broadcast-proofs.md): send, prove and recover from interruptions.
7. [Export, import and recovery](../operate/export-import-recovery.md): keep what you wrote.

**Completion check:** your index admits `ISSUE`; the quick-start reader verifies it against that index.

## Build a platform

1. [Plan your platform](plan-your-platform.md): define the full production scope, responsibilities and acceptance criteria.
2. Select capabilities from [what an application offers](../packages/what-an-application-offers.md) and [the application service](../packages/application-service.md). That service is outside the published package release.
3. Follow [read and verify](#read-and-verify) and, if your platform publishes passports, [issue passports](#issue-passports).
4. For stored claims, [add a claim](#add-a-claim) and arrange or [implement a registry](#run-a-registry). For peer exchange, follow [federation](../operate/federation.md).
5. [Prepare for production](../operate/production-readiness.md): demonstrate your chosen features, evidence handling, recovery and operating responsibilities.

**Completion check:** agreed functional and operational checks pass, with unresolved dependencies recorded. Include another reader's verification and, when selected, claim retrieval and verification. A working demonstration alone is insufficient.

## Add a claim

1. [Quick start](../quick-start.md#sign-a-claim): sign a claim and have a registry check it.
2. As a [repairer, certifier or recycler](../packages/add-a-claim.md), fill in, sign, store and anchor a claim about a passport you do not control.
3. Read [why claims need no passport control](../learn/passport-and-attestations.md).
4. [Attestation issuer](../implement/roles/attestation-issuer.md): the issuer's exact rules.

**Completion check:** a registry validates your claim and its anchor is found by the passport's subject.

## Hand on or receive

1. [Custody](../learn/custody.md#the-four-keys): who holds which key, and [how a managed transfer works](../learn/custody.md#how-a-managed-transfer-works).
2. [After a hand on](../learn/custody.md#after-a-hand-on-the-holders-side): what a holder can do next, and what the [application offers](../packages/what-an-application-offers.md#after-a-hand-on).
3. [Build an application, step 3](../packages/build-an-application.md#3-write-a-passport): the `TRANSFER` under managed custody.

**Completion check:** `TRANSFER` commits the recipient's acceptance, and the reader checks supplied acceptance evidence. Passing `linkage` alone does not resolve missing evidence or [open custody questions](../operate/limitations.md#open-questions-in-the-standard).

## Run an index

1. [Run an index from source](../operate/README.md): configure the Compose preset, start it with Docker, check its configuration and write an application's connection file. The preset builds the runtime; do not separately install `@bsv/dpp-overlay`.
2. [Wallet, broadcast and proofs](../operate/wallet-broadcast-proofs.md): how proofs reach your index.
3. [Export, import and recovery](../operate/export-import-recovery.md): back up and restore.
4. [Known limitations](../operate/limitations.md#index-host): what the index does not do yet.

**Completion check:** your index answers `GET /capabilities` with your publisher key and a lookup returns a passport you announced.

## Exchange with the reference

1. [Overlays running now](../deployment.md#overlays-running-now): who runs what and which way records flow.
2. [Federation](../operate/federation.md): name a peer, sign a publisher policy, observe the exchange.
3. [Contact the programme](#contact-the-programme) to have the hosted reference name your index and keys.

**Completion check:** each index holds the other's intended records; [transactions, histories and proofs agree](../operate/federation.md#7-confirm-both-hold-the-same-records). BEEF encodings can differ. Synchronisation only pulls, so each static peer names the other ([limitations](../operate/limitations.md#synchronisation)).

## Run a registry

Build against the contract with the reference helpers or your own implementation of the selected role.

1. [Registry](../implement/roles/registry.md): the operations, in the order to build them.
2. [Contracts](../reference/contracts.md): the exact request and response shapes.
3. Compare your answers with the hosted registry at `https://dpp-resolver.bsvb.net`, whose validation is open.

**First milestone:** `POST /validate` gives the expected answer for the quick start's claim, malformed input and missing evidence.

**Completion check:** implement and check [the minimum a registry serves](../implement/roles/registry.md#the-minimum-a-registry-serves), including storage and retrieval; record [requirement evidence](../implement/reporting.md). Validation alone is incomplete. Declare anchoring as a separate role.

## Connect other standards

1. [Choose an interoperability profile](../interoperability/README.md).
2. [GS1 discovery](../interoperability/gs1-discovery.md), [EPCIS source exchange](../interoperability/epcis.md), [external credentials](../interoperability/external-credentials.md) or [passport projections](../interoperability/projections.md).

**Completion check:** the example runs on your data, reporting what was kept, changed or unsupported.

## Product data

1. [Choose a profile](../profiles/README.md): which fields a passport carries.
2. [General](../profiles/general.md), [battery](../profiles/battery.md) or [textile](../profiles/textile.md): the current profiles.
3. [Author a profile](../profiles/authoring.md) or [update applications](../profiles/updating-applications.md) when a profile changes.
4. At the prepared checkout root, substitute your selected profile and payload path in `node examples/sample-payload.mjs --check <profile@version> <file>`:

```sh
node examples/sample-payload.mjs --check <profile@version> <file>
```

**Completion check:** the command accepts your payload. Put `--check` first; a profile first selects sample generation instead of file validation.

## Implement independently

1. [Start an independent implementation](../implement/README.md).
2. [Run the fixtures](../implement/fixture-runner.md).
3. [Choose a role](choose-a-role.md), then follow its guide.
4. [Requirements and evidence reporting](../implement/reporting.md).

**Completion check:** pass your role's fixtures and report each requirement in one sentence.

## Releases

1. [Release sets](../reference/release-sets.md): what the current set contains.
2. [Migration](../migration.md): move a deployment or application to a new set.
3. Use the selected release's receipts: [beta.11](../reference/beta-11-publication.md) records the current publication; [beta.4](../reference/beta-4-publication.md) is the historical reproduction example.

**Completion check:** your lockfile names the current set's exact versions and your tests pass.

## Contribute

1. [How the standard changes](../contribute/README.md).
2. [Report a disagreement](../contribute/disagreements.md) between the rules and an implementation.
3. Report a security problem privately, as the [security policy](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/SECURITY.md) says.

**Completion check:** your report or proposal follows the contribution process, including the private channel for security reports.

## No developers

1. Complete [your platform brief](plan-your-platform.md) for an implementation partner; use the [demonstration](#try-the-demonstration) to illustrate the experience.
2. [Contact the programme](#contact-the-programme) for introductions. Confirm the provider's scope and access before relying on it.

**Completion check:** agree your own or a provider's application and operating arrangements for real products. No turnkey public production service is offered here.

## Contact the programme

Use the [BSV Association contact form](https://bsvassociation.org/contact/) for hosted write tokens, peer registration, trial participation or introductions. State your request; for index requests, include its URL and publisher key.
