# Words used here

Every term these pages use, in plain words. Where the docs use two names for one thing, both are listed and the entry says which one the pages prefer.

| Term | Meaning |
|---|---|
| Actor key | The identity key of whoever makes a change; it signs the state. |
| Anchor | A small transaction output that commits to a claim's exact bytes by their digest, signed by an anchoring service. The claim itself stays off chain. |
| Anchoring service | The service that builds and broadcasts anchors. A registry often does this too. |
| Attestation | Another word for a claim. These pages say claim. |
| BEEF | The binary format that carries a transaction together with the earlier transactions and merkle paths needed to check it (BRC-62). Indexes answer lookups with BEEF. |
| BRC | A numbered BSV technical standard, such as BRC-42 (key derivation) or BRC-100 (the wallet interface). |
| BRC-100 wallet | A wallet that holds keys and funds and answers the standard wallet interface: it signs, builds and broadcasts transactions for an application without handing over its keys. Desktop wallet applications and `@bsv/wallet-toolbox` both qualify. |
| Capability document | What a service answers at `GET /capabilities`: the profiles, keys, limits and features it offers. Check it before you depend on a service. |
| Check | One line of a verification report, such as `actorSignatures` or `inclusion`. Each reads `pass`, `fail`, `unknown` or `not-applicable`, with a reason code. |
| Claim | A signed statement about a passport, such as a repair, a test or a recycling. It travels separately from the passport, so the party making it does not need control of the passport. Also called an attestation or a lifecycle claim. |
| Claim code | A one-time code a custodian gives a recipient out of band to accept a hand on, under managed custody. It is not a lifecycle claim. |
| Controller key | The key that currently controls a passport, written in every version 2 state (field 6). It is normally one BRC-42 derivation below the controlling party's identity key. Version 1 called it the owner identity key. |
| Custodian | A service that holds a passport's keys for the people it serves, so a recipient needs no wallet. See managed custody. |
| Demonstration prefix 952 | The GS1 company prefix reserved for examples and demonstrations. A GTIN under 952 identifies no real product, so use it until you have your own prefix. |
| DID | A decentralised identifier, such as `did:key`, `did:web` or `did:bsv`, naming who signed a claim. A writer at Ring 0 needs no `did:bsv`. |
| Digest | A SHA-256 fingerprint of bytes; any change to the bytes changes it. |
| EPCIS | The GS1 standard for supply-chain events. The packages can import EPCIS 2.0.1 events and say exactly what was kept, changed or dropped. |
| Genesis | A passport's first state, the `ISSUE` (`ACTIVATE` in version 1). |
| GS1 Digital Link | A web address that carries a product's GTIN and serial, `https://<host>/01/<GTIN>/21/<serial>`. It is the usual passport identifier. |
| GTIN | A GS1 trade item number, fourteen digits here, allocated under a company prefix. |
| Header source | The service a reader asks for block headers to check merkle paths. The packages use WhatsOnChain; set a key in `WOC_API_KEY`, because anonymous use is limited to a few requests a second. |
| Identity key | A wallet's root public key. It names the wallet's owner and signs as actor and as publisher. |
| Inclusion | Whether a state's transaction is in a block, shown by its merkle path. A state that is not mined yet reads `inclusion` `unknown`, not `fail`. |
| Index | The service that admits passport states and claim anchors and answers lookups. It finds records; it is never the reason to believe them. These pages say index; the BSV software calls it an overlay. |
| Lineage | All the states of one passport, from its genesis to its tip. |
| Lookup | A question to an index, such as "every state of this passport" (`ls_dpp`) or "every anchor about this passport" (`ls_attestation`). |
| Managed custody | The custody profile `managed-custody@1`, the one the current release selects: a custodian holds the keys, and a hand-on to a recipient is accepted by that recipient and committed in the `TRANSFER`. |
| Merkle path | The proof that a transaction is in a block (also called a proof or a BUMP). |
| Outpoint | One output, named by its transaction identifier and output index. |
| Overlay | The BSV software name for an index. These pages say index. |
| Owner tier | The passport's restricted data, every field not marked `public`. It is encrypted off chain; only its hash goes into the state. |
| Profile | The list of product data fields a passport carries for an industry, such as `battery@2` or `general@2`, with a JSON Schema for its public and restricted parts. |
| Publisher key | The key of the service that countersigns each state. An index admits only states countersigned by a key its publisher policy names. |
| Publisher policy | An operator's signed list of the publisher keys it accepts and when each is active. |
| PushDrop | The BSV script template every passport state uses: the state's fields are pushed and dropped, and the output is locked to a key (BRC-48). Spending the tip means unlocking its PushDrop output. |
| Record version | The shape of a state: version 1 (fourteen fields, seven operations) or version 2 (seventeen fields, `ISSUE`, `UPDATE`, `TRANSFER`, `RETIRE`). New passports use version 2; version 1 passports still verify. |
| Registry | The service that validates and stores signed claims and their exact bytes, so a reader can fetch and check them. |
| Release set | One tested combination of package versions, contracts and fixtures, such as `dpp-release-2026-10`. |
| Report | What a reader produces: one line per check, never a single score. |
| Ring 0 | Today's level of identity assurance: the platform that hosts an account vouches for it and its brand name, and nobody checks a brand's legal identity. Higher rings, which would bind a key to a legal entity or certify a role, are not live. |
| State | One signed record in a passport's history: an issue, an update, a transfer or a retirement. Each is one blockchain transaction output. |
| Tip | A passport's latest state, the one the next change must spend. |
| Topic | The admission rules an index applies to one kind of record: `tm_dpp` for passport states, `tm_attestation` for claim anchors. |
| Two rails | The passport's chain of states is one rail; claims and their anchors are the other. Each can be checked without the other. |
| UHRP | A content address derived from the hash of a file. The owner tier's hash in a state is already its UHRP address, so the encrypted file can be stored anywhere that serves it by that address. |
| VSC | Verifiable Supply Chain, a W3C Community Group draft for supply-chain credentials called SEALs. `@bsv/vsc` implements a documented subset; it is not a W3C Standard. |
| W3C Verifiable Credential | A signed credential in the W3C format. The packages verify selected external formats beside the native claim. |
| WhatsOnChain | The public BSV block explorer the packages use as their header source. |
