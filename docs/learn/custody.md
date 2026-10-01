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
| Who holds signing access? | [Custody arrangements](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/custody.md) |
| How does managed acceptance participate? | [Managed-custody profile](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/managed-custody.md) |
| Which control check applies to a record? | [Record model version 2](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/record-model-v2.md) |
| What can a replacement provider restore? | [Export, import and recovery](../operate/export-import-recovery.md) |

An evidence export does not recover a missing private key. A deployment can retain verifiable records while losing the authority needed to update them.

Brand self-custody: open. In the reference application the platform controls each brand's identity, so a brand cannot yet update or move it; nothing in the standard requires this.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](identity-and-authority.md).
