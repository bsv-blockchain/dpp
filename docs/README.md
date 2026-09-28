# The DPP standard

A digital product passport (DPP) is a product's history that anyone can check. This open standard keeps each passport as a chain of signed records on the BSV blockchain, so a reader can verify who wrote each change without trusting the service that shows it.

## Start here

| I want to | What I need | Start |
|---|---|---|
| See a real passport | A browser | Open [a live passport](https://dpp.bsvb.net/01/09522156492290/21/792B7797E3D8) |
| Check a passport myself | Node.js 22, npm and git | [Quick start](quick-start.md) |
| Build an application that issues passports | The quick start, a BRC-100 wallet and a little BSV | [Build an application](packages/build-an-application.md) |
| Run my own index | Docker | [Operate](operate/README.md) |
| Write my own implementation of the rules | The specifications and test vectors | [Implementer start](implement/README.md) |

## How it works

- **A passport is a chain of states.** Each state is a small blockchain transaction that spends the one before it, so the history has one order and cannot be quietly rewritten.
- **Each state is signed twice:** by the party making the change, and by the service that publishes it.
- **An index finds a passport's states for you.** It only finds them: your reader checks everything it returns, from the transaction bytes and public block headers.
- **Claims about a product are separate.** A repair or a recycling is a signed claim with its own small anchor on chain, so it can be checked without touching the passport.
- **A reader's answer is a report.** Each check passes, fails, or says which evidence is missing.

[The passport model](start/architecture.md) shows how the pieces fit together.

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

## Where things stand

This is a working draft, before version 1.0. The beta.3 packages were published to npm on 27 September 2026 under the `next` tag; pin exact versions. [Release status](reference/release-sets.md) and [where things stand](start/status.md) say what is published and what is still open.

## Everything else

| Task | Guide |
|---|---|
| Use the packages | [Install packages](packages/README.md) |
| Choose which product data a passport carries | [Industry profiles](profiles/README.md) |
| Exchange data and credentials with other systems | [Interoperability](interoperability/README.md) |
| Find the exact rules and interfaces | [Specifications](reference/specifications.md), [contracts](reference/contracts.md) |
| Understand identity, custody and evidence | [Identity and authority](learn/identity-and-authority.md), [custody](learn/custody.md), [evidence and its limits](learn/evidence-and-freshness.md) |
| Propose a change | [Contribute](contribute/README.md) |

The source repository is public at [github.com/bsv-blockchain/dpp](https://github.com/bsv-blockchain/dpp). Links to source files are pinned to a commit, so the text you read is the text that was reviewed.
