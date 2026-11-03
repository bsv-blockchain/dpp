# The application service

Application builders can use this page to assign storage, signing, custody and retry responsibilities around the DPP packages. The resulting service design retains operation state and assigns responsibility for each outcome.

The reference application's service combines packages with storage, custody and operation handling. Its source is not public; it is outside the standard's release set. Nothing on this site depends on it: the [independent role guides](../implement/README.md) and packages are enough to build an application.

## Inputs to the service design

| Input | Source |
|---|---|
| Exact package versions | Selected release and application lockfile. The reference service also pins exact versions; a standard release identifier alone does not select a whole application. |
| Workflow | Your application's read, write and custody requirements. Local DPP examples run without an application service; start there to evaluate record and evidence APIs. |
| Signing and access arrangements | Your wallet, publisher policy and selected service adapters; account associations do not establish signing authority. |

## Why an application service exists

Protocol signing and verification functions do not manage application storage, retries, custody requests or the operation journal. The service coordinates them.

A transfer may involve an application record, wallet action, admission response and later proof. Retaining its operation state lets a retry continue the intended action without accidentally creating another transaction.

## What an application supplies itself

| Responsibility | Input | State and outcome to retain |
|---|---|---|
| Wallet adapter | Authorised signing access and custody request | Wallet action and transaction outcome; continue the recorded action on retry. |
| Application storage | Workflow records | Custody requests and operation journal, including pending and failed operations. |
| Publisher policy | Accepted publisher settings | The policy used for admission and verification decisions. |
| Service adapters | Submission and evidence requests | Admission response and later proof; keep their outcomes distinct. |
| Retry handling | Retained operation state | Continue the same action rather than repeat it. |

The [writer](../implement/roles/passport-writer.md), [custody](../learn/custody.md) and [operator](../operate/README.md) guides define adapter responsibilities. Read [identity](../learn/identity-and-authority.md) and [custody](../learn/custody.md) before building them. Stop before signing if authority is unresolved.

Object identifier derivation: declined for now; a physical-object DID stays optional and is never derived from the passport identifier.
