# The application service

The separately maintained [application service](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/packages/dpp-service/package.json) composes the reference packages with application storage, custody and operation handling. It is outside the standard's release set and requires separate repository access. The [independent role guides](../implement/README.md) start from the sources in this repository.

## Why an application service exists

Core signing and verification functions do not manage an application's storage, retries, custody requests or operation journal. The application service coordinates those responsibilities around the reference packages.

For example, a transfer request can involve an application record, a wallet action, an admission response and a later proof. Retaining that operation's state lets a retry continue the intended action instead of accidentally creating another transaction.

## Choose the integration route

The local DPP examples run without this separate service. Start there to evaluate the record and evidence APIs. An application using the packages directly supplies its own wallet, storage, policy and service adapters.

Using the separate service additionally requires its repository and application configuration. There is no command in the DPP checkout that starts it. Its package manifest selects exact dependencies; match that selection when connecting it to a DPP deployment. The [writer](../implement/roles/passport-writer.md), [custody](../learn/custody.md) and [operator](../operate/README.md) guides explain the responsibilities those adapters fulfil.

## Application-specific sources

| Integration concern | Source |
|---|---|
| Passport operations | [PassportService](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/packages/dpp-service/src/passportService.ts) |
| Package dependencies and entry points | [Service manifest](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/packages/dpp-service/package.json) |
| Operation journal and recovery | [Service source directory](https://github.com/bsv-blockchain-demos/dpp-app/tree/43e79676341b3a5c12e6cb43f837e7f901c3020b/packages/dpp-service/src) |
| Delivery and open decisions | [Application status](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md) |

The inspected manifest uses exact DPP package versions. Read that manifest when choosing a compatible application revision; a standard release identifier does not select the whole application.

Application account associations do not establish signing authority. Read [identity](../learn/identity-and-authority.md) and [custody](../learn/custody.md) before supplying the service's adapters.

Object identifier derivation: open; see [D-CR2](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L181).

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).
