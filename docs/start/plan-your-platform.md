# Plan your platform

Start here if your organisation wants to offer product passports through its own production platform. You can use this page without installing software. The result is a brief your business and delivery team can use to decide what to build, what to obtain from a provider and what needs resolving first.

The open standard provides rules for passport records, claims and verification. Your platform supplies the product experience, product data, permissions and operating arrangements. The reference packages help implement parts of that platform; they are not a complete hosted platform that you can simply switch on.

## 1. Define what your platform will do

Choose the outcomes you need first. Add others when there is a business reason.

| Outcome | What your platform must arrange |
|---|---|
| Show and verify existing passports | A reader, sources of records and evidence, and clear explanations of verification results |
| Issue and maintain passports | Product data, authorised signing, an identifier under your control, a funded write path, an admitting index and retained write evidence |
| Let other parties add claims | Agreed issuer authority, supported claim formats, validation and storage, and anchoring if claims are published that way |
| Transfer or receive custody | A defined custody model, authorised participants and the required acceptance evidence; unresolved transfer questions need attention before use |
| Offer infrastructure to other organisations | The selected service role, its public contract, admission/access policy, monitoring, support and recovery |

You can combine these outcomes. Reading a passport does not require you to issue one, and issuing a passport does not require every optional claim or interoperability feature.

## 2. Choose the product data and users

Name the products, identifiers and information the platform will support. Identify who supplies each field, how changes are approved and which evidence backs it. Select an existing product profile where it fits, then assess the gaps using [profile and application readiness](../profiles/reviewing-readiness.md).

Separate information that can be public from information that needs controlled access. A blockchain commitment does not automatically provide document storage or permission management. Record who retains referenced files and restricted evidence, for how long, and how an entitled person obtains them.

Define the people and organisations using the platform: readers, manufacturers, maintainers, owners, custodians and operators as needed. Decide what each may do. A platform account, an organisation, a signing key and a digital identifier are different things. Your account model does not have to copy the demonstration's brands and users.

The [identity and authority guide](../learn/identity-and-authority.md) explains what evidence can and cannot establish. A successful signature check is not a check of legal identity, product authenticity or regulatory compliance.

## 3. Decide who supplies each part

Use [choose packages and services](choose-components-and-services.md) to complete this table. One organisation or application can supply several roles.

| Responsibility | Our team, a named provider, or not needed? |
|---|---|
| User experience, accounts and permissions | |
| Product data, profile validation and evidence storage | |
| Passport reader and verification reports | |
| Passport signing, publisher countersigning and custody | |
| Wallet funding, broadcasting and later proof delivery | |
| Index access and admission of our publisher keys | |
| Claims registry and anchoring, if selected | |
| Identifier domain and any selected resolution service | |
| Monitoring, incident response, export and recovery | |

Using an existing service can reduce what you operate, but only after its role and access are agreed. The hosted reference offers public reads; its write paths need operator credentials. There is no general production onboarding entitlement implied by a public URL. See [hosted services and access](../deployment.md).

If you run your own reference index, you still need an application and its write workflow. If you need your own registry, the current public material provides the contract and implementation guide but no released registry package or image.

## 4. Plan production responsibilities

Assign owners before estimating delivery and operating cost:

- **Authority and keys:** who may issue, update, sign claims or accept custody; who protects and rotates each key.
- **Service access:** agreed providers, networks, admitted keys, credentials and support arrangements.
- **Reliable changes:** safe concurrent updates, retries after interruptions, retained operation records and delivery of mined proofs.
- **Data and recovery:** storage, backups, exports, restricted evidence, restoration and retention commitments.
- **User support:** what people see when a service is unavailable, a record is missing, or verification is unknown.
- **Change management:** pinned versions, profile updates, migration and handling changes to a pre-1.0 standard.

Costs depend on these choices. Estimate application development and integration, hosted or self-operated services, storage and recovery, support, transaction funding and any identifier or assessment requirements. Do not treat an example transaction fee as the full cost of operating a platform.

## 5. Check dependencies before committing

Review [current status](status.md) and [known limitations](../operate/limitations.md) for your chosen scope. Some custody, restricted-disclosure and claim-data questions remain unresolved. If your core product depends on one, record it as a decision needed before committing to that behaviour. A local design choice must not be described as a settled standard rule.

Production readiness is specific to your product and operating model. A published package, passing example or working demonstration is useful evidence for a part of the system; it does not establish readiness of the whole platform.

## Your platform brief

Complete these statements with your team:

1. Our platform serves **[users and organisations]** and supports **[product types and volumes]**.
2. Its initial production scope is **[reading, issuing/updating, claims, custody or infrastructure]**.
3. We will use **[profile and version]**, with **[data sources, validation and evidence owners]**.
4. We control **[identifier domain and identifier entitlement]** and authorise actions through **[our policy]**.
5. We will build **[application capabilities]**, operate **[services]** and obtain **[named services with agreed access]**.
6. **[Owner]** is responsible for keys, funding, proof delivery, support and recovery, with the responsibilities divided as recorded above.
7. Our unresolved dependencies are **[specific gaps]**, each with **[owner, decision and deadline]**.
8. We will accept the platform for production when **[agreed functional, evidence, recovery and operating checks]** pass.

Use this brief to sequence discovery and data assessment, implementation, controlled integration, operational validation and production release. A pilot can be one validation stage if useful; the brief describes the full platform you intend to operate.

The next step is [build or integrate](build-and-integrate.md) for the delivery team and [prepare for production](../operate/production-readiness.md) for the people who will own the service.
