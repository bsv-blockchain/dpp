# Build with the open DPP standard

Application teams and service owners can use this guide to choose a route: build a digital product passport platform, add passport features to an application, or supply services other implementations can use.

A digital product passport connects a product to its history. This standard records changes on the BSV blockchain so readers can check signed records and evidence independently of the application displaying them. Your organisation supplies the product experience, data, permissions and services.

The standard provides shared rules, reference packages and implementation guides. Use the packages or implement the published rules yourself; you do not need every package or service.

## Before you start

Choose your intended outcome from the routes below. Optional demonstration access depends on the mode:

| Mode | Access required | Blockchain writes and cost |
|---|---|---|
| Read the sample passport or verifier | Browser | Reading does not publish a transaction |
| Explore the three open sample brands | Browser | Write nothing to the blockchain |
| Create a brand and publish its sample passports | Signed-in user; demonstration publishing must be open | Real BSV mainnet transactions costing satoshis |

## Start here

| Your goal | Start with | Outcome |
|---|---|---|
| Plan a production platform | [Plan your platform](start/plan-your-platform.md) | A brief covering scope, services, responsibilities and delivery decisions |
| Add passport features | [Build or integrate](start/build-and-integrate.md) | A route to reading, issuing or updating, with prerequisites |
| Run services or use a provider | [Deploy and operate](operate/overview.md) | Service choices, access requirements, deployment and recovery guidance |
| Find precise rules or implement independently | [Technical reference](reference/README.md) | Specifications, contracts, package interfaces and conformance evidence |

Starting from nothing? [Create an application](packages/create-dpp-app.md), which generates a project in one command, or [run your own index](operate/README.md) from the repository's Docker Compose preset. Use [choose packages and services](start/choose-components-and-services.md) to select the pieces. AI agents should also read [the agent guide](start/for-agents.md); returning readers can use [all tasks](start/choose-your-path.md).

## Try the hosted demonstration

Optionally explore [a sample passport](https://dpp.bsvb.net/01/09522156492290/21/792B7797E3D8) and [the verifier](https://dpp.bsvb.net/verify) before planning your application. The demonstration uses mock brands, products and data.

The demonstration is not a service for real products or a conformance reference for a complete application. The conformance ledger assesses the packages. Read [hosted services and their limits](deployment.md) before relying on a service.

## How it works

| Part | What it does |
|---|---|
| Passport | An ordered history. Each state is a transaction that spends the previous state, signed by the party making the change and the publisher. |
| Index | Also called an overlay. Finds states and evidence; readers check that evidence and still depend on the source for freshness. Its response is not proof. |
| Claim | A repairer or recycler can sign a separate statement. Its own blockchain anchor lets readers check the committed claim without changing the passport. |
| Verification report | Checks pass, fail, are unknown when evidence is missing, or are not applicable. |

[The passport model](start/architecture.md) explains how these parts fit together.

## What it does not claim

A valid signature identifies the key that signed the bytes. It does not establish product authenticity, the statement's truth or the signer's authority.

Battery and textile profiles include these field mappings:

| Regulation | Mapping status |
|---|---|
| EU Batteries Regulation (EU) 2023/1542 | Not assessed |
| Ecodesign for Sustainable Products Regulation (EU) 2024/1781 | Not assessed |

The standard claims no conformity with either regulation and does not qualify a product. Your platform needs its own data, authority and readiness decisions.

## Words you will meet

| Word | Meaning |
|---|---|
| Passport identifier | Product web address, commonly `https://<host>/01/<GTIN>/21/<serial>` |
| State | Signed record in a passport's history |
| Index | Service that admits records and answers lookups |
| Publisher key | Countersigns a state; the index policy decides which keys it admits |
| Registry | Validates and stores claims |
| Anchor | Transaction committing to a claim's exact bytes |
| Wallet | Holds keys and funds; signs and broadcasts. The reference writer uses a BRC-100 wallet. |
| Proof | Merkle path used to check a transaction's block inclusion |
| Tip | Latest state, spent by the next change |
| Claim or attestation | Signed statement about a product, separate from the passport |

Consult the [glossary](start/glossary.md) as needed; you need not learn every term before choosing a route.

## Where things stand

| Fact | Status |
|---|---|
| Standard | Working draft before version 1.0 |
| Reference packages | Published under the Apache 2.0 licence |
| Version choice | Pin exact versions from the [selected release](reference/release-sets.md); repository source may contain unpublished or undeployed changes |

Before committing to a production design, read [current status](start/status.md) and your route's limits. [Plan your platform](start/plan-your-platform.md) puts those dependencies in the initial brief.

## Everything else

Task routes and [all tasks](start/choose-your-path.md) lead to [product profiles](profiles/README.md), [connections to other standards](interoperability/README.md) and [how to contribute](contribute/README.md).

The [source repository](https://github.com/bsv-blockchain/dpp) is public. Documentation is built from `main`; implementation and normative source links are pinned to a reviewed commit. The [documentation history](https://github.com/bsv-blockchain/dpp/commits/main/docs) records changes.
