# Build with the open DPP standard

Build your own digital product passport platform, add passport features to an existing application, or provide services other implementations can use. Start by choosing what you want to deliver.

A digital product passport connects a product to information about its history. This standard records changes on the BSV blockchain so a reader can check the signed records and their evidence independently of the application displaying them. Your organisation chooses the product experience, data, permissions and services around those records.

The standard provides shared rules, reference packages and implementation guides. You can use the packages or implement the published rules yourself. You do not need every package or every service.

## Start here

| Your goal | Start with | What you will get |
|---|---|---|
| Plan our own production platform | [Plan your platform](start/plan-your-platform.md) | A platform brief covering scope, services, responsibilities and delivery decisions |
| Add passport features to an application | [Build or integrate](start/build-and-integrate.md) | A path to reading, issuing or updating passports, with clear prerequisites |
| Run services or use a provider | [Deploy and operate](operate/overview.md) | Service choices, access requirements, deployment and recovery guidance |
| Find the precise rules or implement independently | [Technical reference](reference/README.md) | Specifications, contracts, package interfaces and conformance evidence |

Unsure which pieces you need? [Choose packages and services](start/choose-components-and-services.md). An AI agent should also read [the agent guide](start/for-agents.md). Returning readers can use [all tasks](start/choose-your-path.md).

## Try the hosted demonstration

You can explore [a sample passport](https://dpp.bsvb.net/01/09522156492290/21/792B7797E3D8) and [the verifier](https://dpp.bsvb.net/verify) in a browser. This is an optional way to see the experience before planning your own application.

The demonstration uses mock brands, products and data. Its three open sample brands write nothing to the blockchain. A signed-in user can create a brand whose sample passports are real BSV mainnet transactions while demonstration publishing is open. Those writes cost satoshis. The demonstration is not a service for real products or a conformance reference for a complete application; the conformance ledger assesses the packages. See [the hosted services and their limits](deployment.md).

## How it works

- **A passport has an ordered history.** Each state is a transaction that spends the previous state, signed by the party making the change and the publisher.
- **An index finds records.** Also called an overlay, it returns states and evidence. A reader checks the evidence rather than treating the response as proof, and still depends on the source for freshness.
- **Claims are separate.** A repairer or recycler can sign a claim about a product. Its own blockchain anchor lets a reader check the committed claim without changing the passport.
- **Verification produces a report.** Checks can pass, fail, be unknown because evidence is missing, or be not applicable.

[The passport model](start/architecture.md) explains how these parts fit together.

## What it does not claim

A valid signature shows which key signed the bytes. It does not establish that a product is genuine, that a statement is true or that the signer is authorised to make it.

The battery and textile profiles map fields to the EU Batteries Regulation (EU) 2023/1542 and the Ecodesign for Sustainable Products Regulation (EU) 2024/1781. Those mappings have not been assessed. The standard claims no conformity with either regulation and does not qualify a product. Your platform needs its own data, authority and readiness decisions.

## Words you will meet

| Word | Meaning |
|---|---|
| Passport identifier | A product's web address, commonly `https://<host>/01/<GTIN>/21/<serial>` |
| State | One signed record in a passport's history |
| Index or overlay | A service that admits records and answers lookups |
| Publisher key | A key used to countersign a passport state; the index's policy decides which keys it admits |
| Registry | A service that validates and stores claims |
| Anchor | A transaction committing to a claim's exact bytes |
| Wallet | Holds keys and funds and provides signing and broadcasting functions; the reference writer uses a BRC-100 wallet |
| Proof | The merkle path used to check a transaction's inclusion in a block |
| Tip | The latest state, which the next change spends |
| Claim or attestation | A signed statement about a product, separate from the passport |

Use the [glossary](start/glossary.md) when you meet another term. You do not need to learn them all before choosing a route.

## Where things stand

The standard is a working draft before version 1.0. Reference packages are published under the Apache 2.0 licence. Pin the exact versions in the [selected release](reference/release-sets.md); the latest repository source can contain changes that are not yet published or deployed.

Read [current status](start/status.md) and the limits relevant to your route before committing to a production design. [Plan your platform](start/plan-your-platform.md) makes those dependencies part of the initial brief.

## Everything else

Find [product profiles](profiles/README.md), [connections to other standards](interoperability/README.md), and [how to contribute](contribute/README.md) through the task routes or [all tasks](start/choose-your-path.md).

The [source repository](https://github.com/bsv-blockchain/dpp) is public. Documentation is built from `main`; links to implementation and normative source files are pinned to a reviewed commit. The [documentation history](https://github.com/bsv-blockchain/dpp/commits/main/docs) records changes.
