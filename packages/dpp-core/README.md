# @bsv/dpp-core

Compatibility entry point for [`@bsv/dpp-protocol`](../dpp-protocol/README.md), the DPP protocol library for passport tokens, native lifecycle claims, anchors and evidence verification.

This candidate's `0.3.0-beta.9` version re-exports the protocol library's runtime API and TypeScript types. It retains `@bsv/dpp-core/schemas/*` with the same normative JSON schema bytes. The wrapper contains no separate protocol implementation.

**Publication pending:** the compatibility wrapper and `@bsv/dpp-protocol` are source candidates. Earlier published versions of `@bsv/dpp-core` remain available under their original name. Use the [candidate installation guide](../../docs/packages/README.md#use-the-renamed-source-candidate) to test this transition before publication.

Existing imports can continue through this wrapper:

```js
import { verifyPassportEvidence } from '@bsv/dpp-core'
```

New code uses the protocol package directly:

```js
import { verifyPassportEvidence } from '@bsv/dpp-protocol'
```

To migrate an application, install the protocol package at the selected release's exact version, change module imports and schema paths from `@bsv/dpp-core` to `@bsv/dpp-protocol`, and retain the resulting lockfile. Remove the old direct dependency once your application no longer imports it. Dependencies that still use the wrapper can coexist with the new name.

The [migration guide](../../docs/migration.md#rename-dpp-core-to-dpp-protocol) explains the release boundary. The rename changes neither the protocol's wire formats nor its verification rules.

## Licence

[Apache License 2.0](LICENSE). Third-party dependencies and artefacts retain their own terms and notices.
