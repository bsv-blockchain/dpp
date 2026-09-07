# Versions and compatibility

A release combines several independently versioned components. Identify the relevant source before comparing two deployments.

| Comparing | Source |
|---|---|
| Record or claim bytes | [Specification index](../reference/specifications.md) |
| A service request or response | [Contracts](../reference/contracts.md) |
| Product fields or a selected profile | [Industry profiles](../profiles/README.md), [interoperability profiles](../interoperability/README.md) |
| Package entry points and runtimes | [Support table](../packages/support-table.md) |
| A complete release selection | [Release sets](../reference/release-sets.md) |

The [conformance source](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/conformance.md) defines selection and compatibility requirements. A new package version does not by itself select a new record format or industry profile.

Use [migration](../migration.md) for deployment rollout and rollback.
