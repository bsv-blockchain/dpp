# Versions and compatibility

A release combines several independently versioned components. Identify the relevant source before comparing two deployments.

## Record the selection before integrating

An application needs more than a package version. Record the on-chain formats it reads and writes, the industry and exchange profiles it selects, the service contract it speaks and the package release it installs.

For example, upgrading the HTTP client does not rewrite stored passport transactions. A reader can need both historical and current record decoders even when all its installed packages come from one release set. Likewise, selecting a draft battery profile does not select a different blockchain format.

Before connecting to a service, obtain its capability document and compare those selections. A reachable server can still lack the history, export or profile operation the client needs. [Contracts](../reference/contracts.md) explains the first capability request; [migration](../migration.md) gives the rollout sequence.

## Find the relevant version

| Comparing | Source |
|---|---|
| Record or claim bytes | [Specification index](../reference/specifications.md) |
| A service request or response | [Contracts](../reference/contracts.md) |
| Product fields or a selected profile | [Industry profiles](../profiles/README.md), [interoperability profiles](../interoperability/README.md) |
| Package entry points and runtimes | [Support table](../packages/support-table.md) |
| A complete release selection | [Release sets](../reference/release-sets.md) |

The [conformance source](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/conformance.md) defines selection and compatibility requirements. A new package version does not by itself select a new record format or industry profile.

Use [migration](../migration.md) for deployment rollout and rollback.
