# Plan your platform

Business and delivery teams planning their own production passport platform can use this page to prepare a brief: what to build, what to obtain from a provider and what to resolve first.

The open standard defines passport records, claims and verification. Your platform supplies the product experience, data, permissions and operating arrangements. Reference packages implement parts of that platform; they are not a complete hosted platform you can switch on.

## Before you start

| Input | Source |
|---|---|
| Product goals | Your organisation's business and delivery teams |
| Decision makers | People responsible for scope, data access and services |
| Software | No installation needed |

Work through the five decisions below, then complete the brief with your team.

## 1. Define what your platform will do

Choose initial outcomes. Add others when there is a business reason.

| Outcome | What your platform must arrange |
|---|---|
| Show and verify existing passports | Reader, record and evidence sources, clear explanations of verification results |
| Issue and maintain passports | Product data, authorised signing, controlled identifier, funded write path, admitting index, retained write evidence |
| Let other parties add claims | Agreed issuer authority, supported formats, validation, storage and anchoring if published that way |
| Transfer or receive custody | Custody model, authorised participants, required acceptance evidence; resolve transfer questions before use |
| Offer infrastructure to other organisations | Service role, public contract, admission/access policy, monitoring, support and recovery |

Combine outcomes as needed. Reading does not require issuing; issuing does not require every optional claim or interoperability feature.

## 2. Choose the product data and users

1. Name supported products, identifiers and information. Identify each field's supplier, approval process and supporting evidence. Select a suitable existing profile and assess gaps through [profile and application readiness](../profiles/reviewing-readiness.md).
2. Separate public information from information needing controlled access. A blockchain commitment does not provide document storage or permissions. Record who retains referenced files and restricted evidence, retention periods and how entitled people obtain them.
3. Name the readers, manufacturers, maintainers, owners, custodians and operators you need. Define their permissions. Accounts, organisations, signing keys and digital identifiers are distinct; your account model need not copy the demonstration's brands and users.

Use [identity and authority](../learn/identity-and-authority.md) to assess evidence. A successful signature check does not establish legal identity, product authenticity or regulatory compliance.

## 3. Decide who supplies each part

Complete this table using [choose packages and services](choose-components-and-services.md). One organisation or application can supply several roles.

| Responsibility | Our team, named provider, or not needed? |
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

Count a provider towards reduced operating work only once its role and access are agreed. The hosted reference allows public reads, but writes require operator credentials; a public URL grants no general production onboarding entitlement. See [hosted services and access](../deployment.md).

Running a reference index still requires an application and write workflow. For a registry, public material supplies a contract and implementation guide, but no released package or image.

## 4. Plan production responsibilities

Assign owners and record decisions and evidence before estimating delivery and operating costs.

| Area | Decision to record | Owner | Evidence |
|---|---|---|---|
| Authority and keys | Who may issue, update, sign claims or accept custody; key protection and rotation | | |
| Service access | Providers, networks, admitted keys, credentials and support agreements | | |
| Reliable changes | Safe concurrent updates, interruption retries, retained operation records and mined-proof delivery | | |
| Data and recovery | Storage, backups, exports, restricted evidence, restoration and retention commitments | | |
| User support | What users see for unavailable services, missing records or unknown verification | | |
| Change management | Pinned versions, profile updates, migration and changes to a pre-1.0 standard | | |

Estimate development and integration, hosted or self-operated services, storage and recovery, support, transaction funding, and identifier or assessment requirements. Costs depend on these choices; an example transaction fee is not the full operating cost.

## 5. Check dependencies before committing

Review [current status](status.md) and [known limitations](../operate/limitations.md) for your scope. Some custody, restricted-disclosure and claim-data questions remain unresolved. If your core product depends on one, record it as a decision needed before committing to that behaviour. A local design choice must not be described as a settled standard rule.

Production readiness depends on your product and operating model. A published package, passing example or working demonstration provides evidence for a part, not readiness of the whole platform.

## Your platform brief

Complete these statements with your team:

1. Our platform serves **[users and organisations]** and supports **[product types and volumes]**.
2. Its initial production scope is **[reading, issuing/updating, claims, custody or infrastructure]**.
3. We will use **[profile and version]**, with **[data sources, validation and evidence owners]**.
4. We control **[identifier domain and identifier entitlement]** and authorise actions through **[our policy]**.
5. We will build **[application capabilities]**, operate **[services]** and obtain **[named services with agreed access]**.
6. **[Owner]** is responsible for keys, funding, proof delivery, support and recovery, divided as recorded above.
7. Unresolved dependencies are **[specific gaps]**, each with **[owner, decision and deadline]**.
8. We will accept the platform for production when **[agreed functional, evidence, recovery and operating checks]** pass.

Use the brief to sequence discovery and data assessment, implementation, controlled integration, operational validation and production release. A pilot may be one validation stage; the brief covers the full platform.

Delivery teams can proceed to [build or integrate](build-and-integrate.md); service owners can [prepare for production](../operate/production-readiness.md).
