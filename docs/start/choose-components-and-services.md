# Choose packages and services

Application teams and operators can use this page to select packages and assign service responsibilities for their chosen passport features. Decide what to implement, operate or obtain from a provider.

The standard defines roles and rules; packages implement some rules; services run capabilities applications use. A capability need not require another server. No DPP npm package is mandatory for an independent implementation.

## Before you start

| Input | Where to obtain it |
|---|---|
| Required outcomes | Your product scope or [platform brief](plan-your-platform.md) |
| Package or source version | [Release sets](../reference/release-sets.md): choose published packages or a reviewed source commit |
| Existing index connection | Operator-supplied URL and access settings |
| Live-write access | Operator agreement before writer configuration. Public reads do not permit submissions; an admitted public publisher key does not supply its private signing capability. |

## Choose your outcome

| Outcome | Required capabilities | Leave out initially unless selected |
|---|---|---|
| Check supplied passport evidence | Reader and evidence for its checks | Wallet funding, live publishing, own index and registry |
| Read live passports | Reader, index holding records, referenced evidence, required header/proof source | Own index, writer and registry |
| Issue or update passports | Authorised issuer and publisher signing, selected custody behaviour, valid data and identifier, funded write path, admitting index, retained evidence | Claims, credential exchange, additional peer indexes |
| Add native lifecycle claims | Native signing/verification; registry and anchoring for the published storage workflow | VSC, unless the credential or exchange format requires it |
| Operate an index | Compatible implementation, admission policy, storage, evidence checking, operational controls | Passport user interface and registry outside your service scope |
| Implement independently | Role specifications, contracts, fixtures and evidence report | Reference libraries |

## Pick only the packages your task uses

1. For a new application, use [the application starter](../packages/create-dpp-app.md). `@bsv/create-dpp-app` creates the app and declares selected dependencies. Deployment needs an existing index provider or a separate index project.
2. For a new reference index, use [Create an index](../packages/create-dpp-index.md). `@bsv/create-dpp-index` includes `@bsv/dpp-overlay` as the generated project's runtime dependency. Follow that one setup path; do not install the runtime separately. The guide identifies its current publication prerequisite.
3. To connect to an existing compatible index over HTTP, use its operator-supplied connection settings. Neither index package is needed.

These libraries are code components. Dependencies included by a starter or another package are already supplied.

| Package | Purpose and selection rule |
|---|---|
| `@bsv/dpp-protocol` | Passport records, verification and native lifecycle claim helpers; select when using these reference helpers |
| `@bsv/dpp-profiles` | Profile manifests, payload schemas and supported helpers; select for its product data or interoperability tooling |
| `@bsv/dpp-overlay` | Index runtime, topics and lookups; included by the index starter, installed directly only for a custom or embedded index |
| `@bsv/dpp-credentials` | Supported credential and exchange features; select for those formats. Native lifecycle claims do not require it. |

### Runtime and version choice

| Decision | Requirement |
|---|---|
| Installation | Use exact versions from [install the selected release](../packages/README.md) |
| Published or source | The published set is `dpp-release-2026-10-10`; `dpp-release-2026-11` is an unpublished source candidate. Check [release sets](../reference/release-sets.md). |
| SDK | Declare `@bsv/sdk` directly when your code imports it |
| Runtime | Node.js 22 or later with ESM |
| Browser | Check [supported entry points](../packages/support-table.md); JavaScript alone does not establish browser module support |
| Profile assets | Follow the separate JSON/schema asset-packaging instructions |

There is no released turnkey application service or registry package. [Application responsibilities](../packages/what-an-application-offers.md) and the [registry implementation guide](../implement/roles/registry.md) describe what those roles require you to supply.

## Decide which services to run or use

| Capability | When needed | Arrangement |
|---|---|---|
| Index, also called overlay | Documented live lookup and publication workflow | Compatible provider with agreed access, or [your own index](../packages/create-dpp-index.md) |
| Wallet and broadcast | Funding and submitting live transactions | Integrate or connect a suitable wallet; the reference writer uses BRC-100. A reader does not need a funded wallet. |
| Header and proof source | Blockchain inclusion checks where applicable | Compatible evidence source; the reference index currently uses WhatsOnChain |
| Publisher countersigning | Issuing or updating | Authorised application signing or agreed service; running an index does not supply it automatically |
| Claims registry and anchoring | Selected claim storage and publication workflow | Compatible registry or your implementation of its contract. Storage and transaction anchoring are separate responsibilities. |
| GS1 resolution service | Selected profile needs link selection, linksets or related resolution | Implement or arrange it. A GS1-shaped identifier does not require every platform to run a resolver. |
| DID resolution | Selected identity method requires it | Supported method resolution; `did:key` resolves locally |
| Additional index peers | Replication, availability or interoperability goals require them | Agree admission compatibility and data flow with operators. Not required for every first integration. |
| Product and restricted-evidence storage | Promised retention of data and referenced artefacts | Application storage or provider, with access and recovery arrangements |

One deployment can supply several capabilities. MongoDB belongs to the reference index preset; the standard does not mandate it for every implementation.

## What the existing hosted services allow

| Address | Capability | Access and limits |
|---|---|---|
| `https://dpp-overlay.bsvb.net` | Public lookup, history, capabilities and bounded evidence packages | Distinct operator tokens for submission/retraction, proof callbacks and complete exports. Documentation offers no general write access. |
| `https://dpp-resolver.bsvb.net` | Attestation registry with public validation and reads | Storing claims requires operator permission. Not a GS1 resolver. |
| `https://dpp.bsvb.net` | Sample-data demonstration and verifier | Verifier reads the hosted index; it is not a general verifier for private deployments |
| `https://dpp-proof.bsvb.net` | Optional claim and anchor proof view | Does not replace registry, index or your evidence handling |

The [hosted reference guide](../deployment.md) records routes, access rules, published trust keys, observations and limitations. Public reads support evaluation. Production requires agreed write access and operating commitments, or your own deployment. A hosted URL implies no production service agreement.

## Record the service decision

For each provider or operated service, record:

1. Role, base URL, network and supported contracts/profiles.
2. Read, submit, proof-delivery and export permissions, with the correct credentials.
3. Independently trusted operator identity and publisher or anchoring keys. For an index, verify its signed publisher policy and validity windows.
4. Owners retaining product data, claim bytes, restricted evidence, keys and complete history.
5. Owners delivering later proofs, handling failed writes, supporting incidents and restoring service.

Scope secrets to their endpoint. Never send a service's token to another service or discovered peer. A capability document is a service's statement, not proof of identity or record validity.

## Keep your version choice consistent

Checkout examples may include changes beyond published packages, even with unchanged version strings. Hosted deployments can differ from both. Keep the published-package or reviewed-source choice made above consistent.

Check [release sets](../reference/release-sets.md), [the hosted reference](../deployment.md) and [known limitations](../operate/limitations.md) together before combining capabilities.

Next, [build selected features](build-and-integrate.md) or [plan service operation](../operate/overview.md). If product scope remains open, complete [your platform brief](plan-your-platform.md).
