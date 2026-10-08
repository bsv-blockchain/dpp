# Choose packages and services

Start with what your application needs to do. Then choose which parts to implement and which services to operate or obtain from a provider.

The standard defines roles and the rules they follow. Packages implement some of those rules. Services run capabilities that applications use. A required capability does not necessarily mean another server to run, and no DPP npm package is mandatory for an independent implementation.

## Choose your outcome

| You want to | You need | You can leave out initially |
|---|---|---|
| Check supplied passport evidence | A reader and the evidence needed for its checks | Wallet funding, live publishing, your own index and a registry |
| Read live passports | A reader, an index that holds the records, referenced evidence and any required header/proof source | Your own index, writer and registry unless your selected features need them |
| Issue or update passports | Authorised issuer and publisher signing, the selected custody behaviour, valid data and identifier, a funded write path, an admitting index and retained evidence | Claims, credential exchange and additional peer indexes unless selected |
| Add native lifecycle claims | Native claim signing/verification; registry and anchoring arrangements for the published storage workflow | VSC unless the chosen credential or exchange format calls for it |
| Operate an index | A compatible index implementation, admission policy, storage, evidence checking and operational controls | A passport user interface and a registry if they are outside your service scope |
| Implement independently | The selected role's specifications, contracts, fixtures and evidence report | The reference libraries |

For live writes, arrange access before configuring the writer. An index being publicly readable does not give you permission to submit records, and an admitted public publisher key does not give you its private signing capability.

## Pick only the packages your task uses

For the TypeScript/JavaScript reference implementation:

| Package | Purpose | Needed when |
|---|---|---|
| `@bsv/dpp-core` | Passport records, verification and native lifecycle claim helpers | Your application uses these reference helpers |
| `@bsv/dpp-profiles` | Product profile manifests, payload schemas and supported profile helpers | You use its product data or interoperability tooling |
| `@bsv/dpp-overlay-topics` | DPP index topics and lookup services | You host or embed the reference index; HTTP clients do not need this package just to call it |
| `@bsv/vsc` | Supported verifiable-credential and exchange features | Your selected feature uses those formats; native lifecycle claims do not require it |

Use the exact versions in [install the selected release](../packages/README.md). Declare `@bsv/sdk` directly if your code imports it. The reference runtime is Node.js 22 or later with ESM. Check the [supported entry points](../packages/support-table.md) before choosing a browser deployment; browser module support is not established merely because a package is JavaScript. Profile JSON/schema assets have their own packaging instructions.

There is no released turnkey application service or registry package. The [application responsibilities](../packages/what-an-application-offers.md) and [registry implementation guide](../implement/roles/registry.md) describe what you must supply if you choose those roles.

## Decide which services to run or use

| Service or capability | When it is needed | Your choices |
|---|---|---|
| Index, also called overlay | The documented live lookup and publication workflow | Use a compatible provider with agreed access, or [run your own](../operate/README.md) |
| Wallet and broadcast | Funding and submitting live transactions | Integrate a suitable wallet or connect to one; the reference writer uses BRC-100. Every reader does not need a funded wallet |
| Header and proof source | Checking blockchain inclusion where applicable | Obtain the required evidence through a compatible source. The reference index currently uses WhatsOnChain |
| Publisher countersigning | Issuing or updating a passport | Supply authorised signing through your application or an agreed service. Running an index does not automatically supply it |
| Claims registry and anchoring | The selected claim storage and publication workflow | Arrange a compatible registry, or implement its contract. Registry storage and transaction anchoring are separate responsibilities |
| GS1 resolution service | The chosen resolution profile needs link selection, linksets or related resolution behaviour | Implement or arrange that service. A GS1-shaped passport identifier alone does not mean every platform must run a resolver |
| DID resolution | The chosen identity method requires it | Follow the method's supported resolution; `did:key` can be resolved locally |
| Additional index peers | Your replication, availability or interoperability goals require them | Agree compatible admission and data flow with other operators; peers are not a prerequisite for every first integration |
| Product and restricted-evidence storage | The data and referenced artefacts your platform promises to retain | Application storage or an appropriate provider, with access and recovery arrangements |

One deployment may supply several capabilities. MongoDB is part of the reference index preset, not a database mandated for every implementation of the standard.

## What the existing hosted services allow

| Address | What it provides | Access to establish before relying on it |
|---|---|---|
| `https://dpp-overlay.bsvb.net` | Reference index with public lookup, history, capabilities and bounded evidence packages | Submission/retraction, proof callbacks and complete exports use distinct operator tokens. General write access is not offered by the documentation |
| `https://dpp-resolver.bsvb.net` | Attestation registry with public validation and reads | Storing claims needs operator permission. This is not a GS1 resolver |
| `https://dpp.bsvb.net` | Demonstration application and verifier | It is for sample data. Its verifier reads the hosted index; it is not a general verifier for your private deployment |
| `https://dpp-proof.bsvb.net` | Optional proof view for claims and their anchors | It does not replace the registry, index or your own evidence handling |

The [hosted reference guide](../deployment.md) records the exact routes, access rules, published trust keys, observations and limitations. Public read access can be useful for evaluation. For production use, arrange the necessary write access and operating commitments or choose your own deployment. Do not assume a hosted URL comes with a production service agreement.

## Record the service decision

For each chosen provider or service you operate, record:

- Its role, base URL, network and supported contracts/profiles.
- Who may read, submit, deliver proofs and export, with the correct credential for each action.
- The independently trusted operator identity and the relevant publisher or anchoring keys. For an index, verify the signed publisher policy and its validity windows.
- Who retains product data, claim bytes, restricted evidence, keys and complete history.
- Who delivers later proofs, handles failed writes, supports incidents and restores the service.

Keep secrets scoped to their intended endpoint. Do not send one service's token to another service or to a discovered peer. A capability document is a statement by a service, not proof of its identity or of a particular record's validity.

## Keep your version choice consistent

Choose either the selected published packages or a specific reviewed source commit. Examples built from a repository checkout can include work beyond the published package, even when the version string has not changed. A hosted deployment can differ from both.

Use [release sets](../reference/release-sets.md), [the hosted reference](../deployment.md) and the relevant [known limitations](../operate/limitations.md) together. Do not mix their capabilities without checking.

Next, [build your selected features](build-and-integrate.md) or [plan the services you will operate](../operate/overview.md). If you are still defining the whole product, complete [your platform brief](plan-your-platform.md).
