# The DPP standard

A digital product passport (DPP) combines a product's recorded history with evidence about it. This working draft uses the Bitcoin SV (BSV) blockchain for passport records and separate commitments to signed lifecycle claims.

## How a passport works

A product's passport has a history of signed records. Updating it creates a transaction that spends the previous record's output, so a reader can follow the history and check who signed each change. The product data can change while the passport identifier continues to identify the same lineage.

Attestations hold separate claims about the product, such as a repair or a measurement. The issuer signs the claim. A separate blockchain commitment lets a reader detect changes to the secured claim when it is retrieved. A valid signature does not establish that the physical event happened.

[BSV decentralised identifiers (DIDs)](learn/dids.md) connect an issuer's identity to its verification keys and document history. [Verifiable credentials (VCs)](learn/verifiable-credentials.md) carry signed claims in selected exchange formats. The guides explain Teranode Group's DID method, the implemented credential paths and their remaining gaps.

An overlay indexes the blockchain records so they can be found. A registry retains and serves claims and evidence. A reader checks the returned material and reports missing evidence as well as successful checks. [The model](start/architecture.md) connects these components.

## Try it

Start with the [offline quick start](quick-start.md). It installs the reference packages, checks a synthetic passport history and explains the output. No wallet, running service or funds are needed for that first exercise.

Then choose the component to build. Each role guide explains its inputs, first exercise and integration work.

| Task | Guide |
|---|---|
| Assess delivery and remaining gaps | [Where things stand](start/status.md) |
| Use the reference implementation | [Install packages](packages/README.md) |
| Build an independent implementation | [Implementer start](implement/README.md) |
| Run services | [Operate](operate/README.md) |
| Select product data | [Industry profiles](profiles/README.md) |
| Exchange data and credentials | [Interoperability](interoperability/README.md) |
| Find rules and interfaces | [Specifications](reference/specifications.md), [contracts](reference/contracts.md) |
| Propose changes | [Contribute](contribute/README.md) |

The guides explain the working model and implementation routes here. Pinned source links identify the exact rules, schemas and evidence behind them. Running repository examples requires [source access](packages/README.md#source-access); reading this guide does not require opening those links.

Repository publication: open; see [the release candidate](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/release/dpp-release-2026-09-3.json). The [status page](start/status.md) identifies the other open decisions.
