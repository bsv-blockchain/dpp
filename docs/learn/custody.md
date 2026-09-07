# Custody

Custody determines who can use a signing capability and what happens when it is lost. Account recovery, evidence recovery and recovery of spending authority are separate tasks.

| Design question | Source |
|---|---|
| Who holds signing access? | [Custody arrangements](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/custody.md) |
| How does managed acceptance participate? | [Managed-custody profile](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/managed-custody.md) |
| Which control check applies to a record? | [Record model version 2](https://github.com/bsv-blockchain/dpp/blob/b8434452892b0c22a191c5bc08a7e0fc54717258/spec/record-model-v2.md) |
| What can a replacement provider restore? | [Export, import and recovery](../operate/export-import-recovery.md) |

An evidence export does not recover a missing private key. A deployment can retain verifiable records while losing the authority needed to update them.

Brand self-custody: open; see [G-28](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L171).

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](identity-and-authority.md).
