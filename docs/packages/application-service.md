# The application service

The reference application has its own service layer, which composes the reference packages with application storage, custody and operation handling. It is outside the standard's release set and its source is not public. Nothing on this site depends on it: the [independent role guides](../implement/README.md) and the packages are enough to build an application.

## Why an application service exists

Core signing and verification functions do not manage an application's storage, retries, custody requests or operation journal. An application service coordinates those responsibilities around the packages.

For example, a transfer request can involve an application record, a wallet action, an admission response and a later proof. Retaining that operation's state lets a retry continue the intended action instead of accidentally creating another transaction.

## What an application supplies itself

The local DPP examples run without any application service. Start there to evaluate the record and evidence APIs. An application using the packages directly supplies its own wallet, storage, publisher policy and service adapters, and keeps its own operation journal so a retry continues an action rather than repeating it. The [writer](../implement/roles/passport-writer.md), [custody](../learn/custody.md) and [operator](../operate/README.md) guides explain the responsibilities those adapters fulfil.

The reference application's service pins exact DPP package versions, as any application should; a standard release identifier alone does not select a whole application.

Application account associations do not establish signing authority. Read [identity](../learn/identity-and-authority.md) and [custody](../learn/custody.md) before building those adapters.

Object identifier derivation: declined for now; a physical-object DID stays optional and is never derived from the passport identifier.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).
