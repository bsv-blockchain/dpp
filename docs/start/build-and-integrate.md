# Build or integrate

Application teams can use this page to choose a passport feature and run a first integration check. Build with the reference packages or follow the standard in your own implementation, then use the matching guide to complete the feature.

If you are designing a complete platform, start with [your platform brief](plan-your-platform.md) and [component choices](choose-components-and-services.md). Otherwise, use the task that matches your immediate outcome.

## Before you start

| Route | Requirements and source |
|---|---|
| Local exercise | Node.js 22 or later, npm and git; internet access to download and build the [source checkout](../quick-start.md#get-the-code). Keep the exact revision and lockfile. The fixture runs offline after the build |
| Further integration | Use the runtime and exact release identified by your chosen task |
| Optional live writes | Authorised signing, a funded BRC-100 wallet and an index that admits your publisher key and grants submission/proof access. Arrange these through the [application guide](../packages/build-an-application.md) before spending funds |

## Run the first integration check

1. Complete [Get the code](../quick-start.md#get-the-code), including `npm ci` and `npm run build`.
2. From the checkout root, run:

```sh
node examples/verify-passport.mjs --fixture --version=2 --report
```

3. Check the result. It verifies a five-state version 2 passport and its refusal cases, then prints a report. Success has no `FAIL:` or `FAILS:` lines and exits with status 0. The transactions are not on chain, so inclusion is pending or `unknown`.
4. Stop if a check fails. Confirm Node 22 or later and a completed build if the command fails before printing checks. Investigate an unexpected failure before continuing.

This exercise needs no wallet, service token or blockchain transaction. It establishes that you can run the reader and distinguish missing inclusion evidence from failed signature or linkage checks. Keep offline exercises, live reads and live writes distinct; an offline success does not establish production readiness.

## Choose the next feature

| Task | Guide | What completing it establishes |
|---|---|---|
| Create a new application | [Application skeleton](../packages/build-an-application.md#start-with-an-application-skeleton) | An editable app with an offline lifecycle exercise and a guide to its live deployment |
| Check a passport and understand its evidence | [Quick start](../quick-start.md) | You can run the reader and explain the checks; missing evidence remains unknown |
| Add a reader to your application | [Protocol library](../packages/dpp-protocol.md) and [evidence reports](../learn/evidence-and-freshness.md) | Your application can acquire evidence and present verification results |
| Issue or update passports | [Build an application](../packages/build-an-application.md) | A controlled write workflow with its required signing, custody, index access and retained evidence |
| Add a lifecycle claim | [Add a claim](../packages/add-a-claim.md) | A supported signed claim, with validation, storage and anchoring as selected |
| Choose and validate product data | [Product profiles](../profiles/README.md) | Data checked against the selected profile, separately from transaction verification |
| Connect another format or system | [Interoperability](../interoperability/README.md) | The selected exchange or resolution feature, within its documented support |

For another language or implementation, use the [independent implementation route](../implement/README.md). For a working integration moving towards release, continue to [prepare for production](../operate/production-readiness.md).
