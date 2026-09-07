# The application service

The separately maintained [application service](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/packages/dpp-service/package.json) composes the reference packages with application storage, custody and operation handling. It is outside the standard's release set and requires separate repository access. The [independent role guides](../implement/README.md) start from the sources in this repository.

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
