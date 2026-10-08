# Build or integrate

Choose the feature you want to add. You can implement it with the reference packages or follow the standard in your own implementation.

If you are designing a complete platform, start with [your platform brief](plan-your-platform.md) and [component choices](choose-components-and-services.md). Otherwise, use the task that matches your immediate outcome.

| Task | Guide | What completing it establishes |
|---|---|---|
| Check a passport and understand its evidence | [Quick start](../quick-start.md) | You can run the reader and explain the checks; missing evidence remains unknown |
| Add a reader to your application | [Core package](../packages/dpp-core.md) and [evidence reports](../learn/evidence-and-freshness.md) | Your application can acquire evidence and present verification results |
| Issue or update passports | [Build an application](../packages/build-an-application.md) | A controlled write workflow with its required signing, custody, index access and retained evidence |
| Add a lifecycle claim | [Add a claim](../packages/add-a-claim.md) | A supported signed claim, with validation, storage and anchoring as selected |
| Choose and validate product data | [Product profiles](../profiles/README.md) | Data checked against the selected profile, separately from transaction verification |
| Connect another format or system | [Interoperability](../interoperability/README.md) | The selected exchange or resolution feature, within its documented support |

Use the runtime and exact release identified by the task. Keep offline exercises, live reads and live writes distinct. Live writes require authorised service access and spend funds; an example succeeding offline does not establish production readiness.

For another language or implementation, use the [independent implementation route](../implement/README.md). For a working integration moving towards release, continue to [prepare for production](../operate/production-readiness.md).
