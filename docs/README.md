# The DPP standard

A digital product passport (DPP) is a product's history that anyone can check. This open standard keeps each passport as a chain of signed records on the BSV blockchain, so a reader can verify who wrote each change without trusting the service that shows it.

These pages are for anyone bringing the standard into a new platform, an existing application or a service they run. [Choose your path](start/choose-your-path.md) routes every journey, from a ten-minute evaluation to an independent implementation, and an AI agent starts [here](start/for-agents.md).

## Start here

| I want to | What I need | Start |
|---|---|---|
| See a real passport | A browser | Open [a live passport](https://dpp.bsvb.net/01/09522156492290/21/792B7797E3D8) |
| Check a passport myself | Node.js 22, npm and git | [Quick start](quick-start.md) |
| Issue passports from my own system | Your own index (Docker and a checkout), a funded BRC-100 wallet and an identifier | [Issue passports](start/choose-your-path.md#issue-passports) |
| Run my own index | Docker and a checkout | [Run an index](start/choose-your-path.md#run-an-index) |
| Write my own implementation of the rules | The specifications and test vectors | [Implement independently](start/choose-your-path.md#implement-independently) |
| Something else | | [Choose your path](start/choose-your-path.md) |

## Try the hosted demonstration

[dpp.bsvb.net](https://dpp.bsvb.net) is a demonstration of the standard, not a service for real products. Anyone can browse it and verify its passports, and anyone who signs up can issue and update passports there for its sample brands. Every passport it writes is a real transaction on the BSV mainnet, but the brands, products and data are mock demonstration data. The demonstration behaves exactly as the standard specifies, so it shows what an integration does.

Open [a sample passport](https://dpp.bsvb.net/01/09522156492290/21/792B7797E3D8), then check it yourself on the [verifier](https://dpp.bsvb.net/verify). A brand with real products issues them from its own deployment, built with the packages or its own implementation.

## How it works

- **A passport is a chain of states.** Each state is a small blockchain transaction that spends the one before it, so the history has one order and cannot be quietly rewritten.
- **Each state is signed twice:** by the party making the change, and by the service that publishes it.
- **An index finds a passport's states for you.** It only finds them: your reader checks everything it returns, from the transaction bytes and public block headers.
- **Claims about a product are separate.** A repair or a recycling is a signed claim with its own small anchor on chain, so it can be checked without touching the passport.
- **A reader's answer is a report.** Each check passes, fails, or says which evidence is missing.

[The passport model](start/architecture.md) shows how the pieces fit together.

## What it does not claim

The battery and textile profiles map their fields to what the EU Batteries Regulation (EU) 2023/1542 and the Ecodesign for Sustainable Products Regulation (EU) 2024/1781 ask a passport to carry. The standard claims no conformity with either regulation, and using it does not qualify a product. A reader's report shows who signed which bytes and whether the evidence checks out; it does not show that a product or a claim is genuine, or that an issuer is authorised.

## Words you will meet

| Word | Meaning |
|---|---|
| Passport identifier | The product's web address, usually `https://<host>/01/<GTIN>/21/<serial>` ([identifiers](identifiers.md)) |
| State | One signed record in a passport's history: an issue, update, transfer or retirement |
| Index, or overlay | The service that admits states and answers lookups |
| Publisher key | The key of the service that countersigns each state; an index admits only the keys its policy names |
| Registry | The service that validates and stores claims |
| Anchor | A small transaction committing to a claim's exact bytes |
| Wallet | Holds your keys and funds, signs and broadcasts; any BRC-100 wallet |
| Proof | The merkle path showing a transaction is in a block |
| Tip | A passport's latest state, the one the next change spends |
| Claim | A signed statement about a product, such as a repair, kept apart from the passport; also called an attestation |

[Words used here](start/glossary.md) defines every other term.

## Where things stand

This is a working draft, before version 1.0. The beta.5 packages, under the Apache 2.0 licence, were published to npm on 2 October 2026 under the `next` tag, and the beta.6 packages, which publish to `latest`, are pending publication. Pin exact versions: installing without a version still gets the older beta.1. [Release status](reference/release-sets.md) and [where things stand](start/status.md) say what is published and what is still open, and [known limitations](operate/limitations.md) lists what does not work yet.

## Everything else

| Task | Guide |
|---|---|
| Use the packages | [Install packages](packages/README.md) |
| Choose which product data a passport carries | [Industry profiles](profiles/README.md) |
| Exchange data and credentials with other systems | [Interoperability](interoperability/README.md) |
| Find the exact rules and interfaces | [Specifications](reference/specifications.md), [contracts](reference/contracts.md) |
| Understand identity, custody and evidence | [Identity and authority](learn/identity-and-authority.md), [custody](learn/custody.md), [evidence and its limits](learn/evidence-and-freshness.md) |
| Propose a change | [Contribute](contribute/README.md) |

The source repository is public at [github.com/bsv-blockchain/dpp](https://github.com/bsv-blockchain/dpp). Links to source files are pinned to a commit, so the text you read is the text that was reviewed. The site is built from the repository's `main` branch; the [history of `docs/`](https://github.com/bsv-blockchain/dpp/commits/main/docs) shows the latest change.
