# Custody

Custody determines who can use a signing capability and what happens when it is lost. Account recovery, evidence recovery and recovery of spending authority are separate tasks.

## Choose the signing arrangement

With self-managed signing, the holder operates the wallet or signing adapter. With managed custody, a service operates signing access and retains the acceptance evidence required by the selected profile. These arrangements change recovery and authorisation responsibilities; the record format alone does not choose one for an application.

Before implementing a transfer, identify the current control key, the party requesting the action, the wallet that can spend the output and any required acceptance record. Treat a login session as request context, not as a substitute for those checks.

Managed acceptance is evidence of the custodian's recorded acceptance process. It is not a signature made with a private key controlled by the recipient. The live identity model remains Ring 0, with higher rings absent.

## Rehearse recovery

Write down where transaction history, secured claims, restricted documents and signing access are kept. Recover each separately in a test environment. A restored account can still lack keys; a restored key can still lack evidence; an evidence archive can remain readable after spending access is lost.

Use [export and recovery](../operate/export-import-recovery.md) for the evidence exercise and the [writer guide](../implement/roles/passport-writer.md) for wallet integration.

## Source definitions

| Design question | Source |
|---|---|
| Who holds signing access? | [Custody arrangements](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/custody.md) |
| How does managed acceptance participate? | [Managed-custody profile](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/managed-custody.md) |
| Which control check applies to a record? | [Record model version 2](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/record-model-v2.md) |
| What can a replacement provider restore? | [Export, import and recovery](../operate/export-import-recovery.md) |

An evidence export does not recover a missing private key. A deployment can retain verifiable records while losing the authority needed to update them.

Brand self-custody: open; see [G-28](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L171).

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](identity-and-authority.md).
