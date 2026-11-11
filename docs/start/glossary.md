# Words used here

Readers, application teams and operators can use this glossary to interpret DPP documentation consistently. Find a term below for its meaning; synonym entries identify the wording these pages prefer.

| Term | Meaning |
|---|---|
| Actor key | The identity key of the party making a change; it signs the state. |
| Anchor | A small transaction output signed by an anchoring service, committing to the digest of a claim's exact bytes. The claim stays off chain. |
| Anchoring service | The service that builds and broadcasts anchors. A registry often does this too. |
| Attestation | Another word for a claim. These pages say claim. |
| BEEF | The binary format carrying a transaction, earlier transactions and merkle paths needed to check it (BRC-62). Indexes return BEEF for lookups. |
| BRC | A numbered BSV technical standard, such as BRC-42 (key derivation) or BRC-100 (the wallet interface). |
| BRC-100 wallet | Holds keys and funds; signs, builds and broadcasts through the standard wallet interface without handing keys to the application. Desktop wallets and `@bsv/wallet-toolbox` both qualify. |
| Capability document | A service's `GET /capabilities` response: offered profiles, keys, limits and features. Check it before depending on the service. |
| Check | One line of a verification report, such as `actorSignatures` or `inclusion`. Each reads `pass`, `fail`, `unknown` or `not-applicable`, with a reason code ([the sixteen checks](../learn/evidence-and-freshness.md#the-sixteen-checks)). |
| Claim | A signed statement about a passport, such as a repair, test or recycling. It travels separately and needs no control of the passport. Also called an attestation or lifecycle claim. |
| Claim code | A one-time code a custodian gives a recipient out of band to accept a managed hand on. It is not a lifecycle claim. |
| Controller key | Currently controls the passport; recorded in every version 2 state (field 6). Normally one BRC-42 derivation below the controlling party's identity key. Version 1 called it the owner identity key. |
| Custodian | Holds passport keys for its users, so a recipient needs no wallet. See managed custody. |
| Demonstration prefix 952 | GS1 company prefix reserved for examples and demonstrations. Its GTINs identify no real products; use it until you have your own prefix. |
| DID | A decentralised identifier, such as `did:key`, `did:web` or `did:bsv`, naming who signed a claim. A writer at Ring 0 needs no `did:bsv`. |
| Digest | A SHA-256 fingerprint of bytes; any change to the bytes changes it. |
| EPCIS | GS1 standard for supply-chain events. Packages import EPCIS 2.0.1 events, reporting what was kept, changed or dropped. |
| Genesis | A passport's first state, the `ISSUE` (`ACTIVATE` in version 1). |
| GS1 Digital Link | A web address that carries a product's GTIN and serial, `https://<host>/01/<GTIN>/21/<serial>`. It is the usual passport identifier. |
| GTIN | A GS1 trade item number, fourteen digits here, allocated under a company prefix. |
| Header source | Supplies block headers for checking merkle paths. Packages use WhatsOnChain; set `WOC_API_KEY` because anonymous access allows only a few requests a second. |
| Identity key | A wallet's root public key. It names the wallet's owner and signs as actor and as publisher. |
| Inclusion | Whether a state's transaction is in a block, shown by its merkle path. A state that is not mined yet reads `inclusion` `unknown`, not `fail`. |
| Index | Admits passport states and claim anchors and answers lookups. Finds records but does not establish their truth. Preferred here over the BSV software term overlay. |
| Lineage | All the states of one passport, from its genesis to its tip. |
| Lookup | A question to an index, such as "every state of this passport" (`ls_dpp`) or "every anchor about this passport" (`ls_attestation`). |
| Managed custody | Custody profile `managed-custody@2` (`managed-custody@1` in the published October set). A custodian holds keys, records and signs the recipient's acceptance of a hand-on; the `TRANSFER` commits to that record. |
| Merkle path | The proof that a transaction is in a block (also called a proof or a BUMP). |
| Outpoint | One output, named by its transaction identifier and output index. |
| Overlay | The BSV software name for an index. See Index. |
| Owner tier | The passport's restricted data, every field not marked `public`. It is encrypted off chain; only its hash goes into the state. |
| Profile | Product fields a passport carries for an industry, such as `battery@2` or `general@2`, with a JSON Schema for public and restricted parts. |
| Publisher key | The service key countersigning each state. An index admits only states countersigned by keys in its publisher policy. |
| Publisher policy | An operator's signed list of the publisher keys it accepts and when each is active. |
| PushDrop | BSV script template used by every state: fields are pushed and dropped; the output locks to a key (BRC-48). Spending the tip unlocks its PushDrop output. |
| Record version | The shape of a state: version 1 (fourteen fields, seven operations) or version 2 (seventeen fields, `ISSUE`, `UPDATE`, `TRANSFER`, `RETIRE`). New passports use version 2; version 1 passports still verify. |
| Registry | Validates and stores signed claims and their exact bytes for readers to fetch and check. |
| Release set | One tested combination of package versions, contracts and fixtures, such as `dpp-release-2026-10-6`. |
| Report | What a reader produces: one line per check, never a single score. |
| Ring 0 | Today's identity assurance: the hosting platform vouches for an account and brand name; nobody checks a brand's legal identity. Higher rings to bind keys to legal entities or certify roles are not live ([Ring 0](../learn/identity-and-authority.md#ring-0)). |
| State | One signed record in a passport's history: an issue, an update, a transfer or a retirement. Each is one blockchain transaction output. |
| Tip | A passport's latest state, the one the next change must spend. |
| Topic | The admission rules an index applies to one kind of record: `tm_dpp` for passport states, `tm_attestation` for claim anchors. |
| Two rails | The passport's state chain and, separately, claims with their anchors. Each can be checked without the other. |
| UHRP | A content address derived from a file's hash. The owner tier's hash is already its UHRP address; store its encrypted file anywhere serving that address. |
| VSC | Verifiable Supply Chain, a W3C Community Group draft for supply-chain credentials called SEALs. `vsc-draft-compat/0.1.0` is a documented subset; it is not a W3C Standard. The subset is parked: required by no release, and from `@bsv/dpp-credentials` 0.2.0-beta.6 no longer in the package. |
| W3C Verifiable Credential | A signed credential in the W3C format. The packages verify selected external formats beside the native claim. |
| WhatsOnChain | The public BSV block explorer the packages use as their header source. |
