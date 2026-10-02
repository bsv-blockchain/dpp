# BSV DIDs

A decentralised identifier (DID) names an entity, such as a brand or a repairer, and gives a reader a way to obtain its verification keys. This page says whether your build needs a `did:bsv`, which identifier does what, how the Bitcoin SV (BSV) DID method works and how to resolve one.

## Do you need a `did:bsv`?

No, not for a writer at [Ring 0](identity-and-authority.md#ring-0), which is every build today. Passport states are signed with wallet identity keys, and a lifecycle claim can name its issuer as a `did:key` of the issuer's identity key, which needs no resolver and no transaction ([rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md#3-native-signed-claim) section 3). [Build an application](../packages/build-an-application.md), "Sign and anchor a lifecycle claim", does this with `didKeyFromIdentityKey(identityKey)`.

Read on if you must verify an issuer that names a `did:bsv`, or you are planning for an identity whose keys will change. A credential profile may select another method, such as `did:web` for the external credential profile ([verifiable credentials](verifiable-credentials.md)).

## Which identifier does what

| Identifier | Role in a DPP build |
|---|---|
| `did:key` | One public key written as a DID. It works offline, and changing the key changes the identifier. The native helpers accept compressed secp256k1 keys |
| `did:bsv` | An identity whose document lives in a chain of BSV transactions, so its keys can change while the identifier stays the same |
| `did:web` | An identity document fetched over HTTPS; the external credential profile uses it |
| Passport identifier | The product a claim concerns. It is never an issuer's DID, and no DID is derived from it |

The reason to want a `did:bsv` is key history. A `did:key` encodes one key, so rotating the key produces a new identifier. A `did:bsv` follows a chain of transactions, so later documents can record new keys under the original identifier. A reader still needs evidence of which key was authorised when a claim was signed.

## Connect a DID to a claim

A native lifecycle claim (format `dpp-lifecycle-v1`) names its issuer in `issuer`. The claim is signed with a key derived from the issuer's identity key, which the specification calls the signing root. Two cases:

- `issuer` is a `did:key`: it names the signing root directly. The claim has no `issuerKeyDid`.
- `issuer` is a resolvable DID, such as a `did:bsv`: the claim must also carry `issuerKeyDid`, the `did:key` of the signing root. The verifier checks the signature against that key, then separately resolves the issuer's DID and checks that the issuer authorised that key. A key named inside the claim cannot vouch for its own link to the issuer.

The [native claim source](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md#L46-L55) defines this binding.

Passport states have the same split. A state names the actor's identity key, but the actor's signature is made with a key derived from it, so the two differ. `@bsv/dpp-core` converts between them: `didKeyFromIdentityKey` and `identityKeyFromDidKey` for an identity key, and `signingPublicKeyFor(state)` and `signingDidFor(state)` for the derived key that verifies a state's actor signature ([@bsv/dpp-core](../packages/dpp-core.md), table "Claims and anchors").

A `did:bsv` document does not automatically satisfy a credential profile that selects `did:web`, another curve or a particular proof purpose.

## How `did:bsv` works

The publisher's pages for the method, at `docs.teranode.group`, redirect in a loop at the time of writing, so every link below opens an archived copy: the [method specification](https://web.archive.org/web/20260516084819/https://docs.teranode.group/tng-identity-documentation/did/bsv-did-method-specifications), its [transaction definitions](https://web.archive.org/web/20250916170103/https://docs.teranode.group/tng-identity-documentation/did/bsv-did-method-specifications/specification-overview/utxo-did-method-normative-reference) and the [resolver API](https://web.archive.org/web/20260211224122/https://docs.teranode.group/tng-identity-documentation/did/bsv-did-universal-resolver/resolver-api). The reference application adopts this method for identities whose keys can change.

An unspent transaction output (UTXO) is an output a later transaction has not yet spent. The method links an identity's records through such spends, and its DID document publishes the identity's verification keys, their purposes and any service endpoints.

| Operation | What happens |
|---|---|
| Create | An issuance transaction establishes the identifier. A following transaction publishes the DID document |
| Resolve | A resolver follows the transaction chain and returns the current document and its metadata |
| Update | A later document changes the identity's published information while the DID stays the same |
| Fund | A funding transaction pays fees for continuing the chain without changing the DID's state |
| Revoke | A final transaction ends the chain and deactivates the DID |

These are the method's operations, not a claim that every DPP integration implements them. The [transaction definitions](https://web.archive.org/web/20250916170103/https://docs.teranode.group/tng-identity-documentation/did/bsv-did-method-specifications/specification-overview/utxo-did-method-normative-reference) govern their encoding and signatures. A DID controller's spending rights come from those scripts; an application account or a list of controllers in a document does not create them.

## Resolve a `did:bsv`

This reads the published BSV DID example through the resolver the reference application uses, `https://bsvdid-universal-resolver.nchain.systems`. Run it anywhere with Node.js 22 or later and network access; it needs no checkout, wallet or funds. Set `DID_RESOLVER_URL` to use another resolver with the same interface.

```sh
node --input-type=module <<'JS'
const did = 'did:bsv:b5c8407a46b32c4a59b3fe0693860588b00a0e7464d252cc6ac47089925c1e8c'
const base = process.env.DID_RESOLVER_URL ?? 'https://bsvdid-universal-resolver.nchain.systems'
const response = await fetch(new URL(`/1.0/identifiers/${did}`, base))
const result = await response.json()
console.log(JSON.stringify({
  httpStatus: response.status,
  document: result.didDocument,
  versionId: result.didDocumentMetadata?.versionId,
  deactivated: result.didDocumentMetadata?.deactivated ?? null,
  error: result.didResolutionMetadata?.error ?? null,
}, null, 2))
if (!response.ok || result.didResolutionMetadata?.error || result.didDocumentMetadata?.deactivated) {
  process.exitCode = 1
}
JS
```

Expect `"httpStatus": 200`, a document whose `id` is the requested DID, one `JsonWebKey2020` secp256k1 key under `verificationMethod`, that key listed under `authentication`, `"deactivated": null`, `"error": null`, and exit status 0. Inspect `verificationMethod` for the keys and the verification relationships, such as `authentication`, for what each key may be used for. A missing `deactivated` field prints as `null`; that is not an independent status check.

| Result | Meaning |
|---|---|
| `didDocument` | The identity document, or `null` when unavailable or deactivated |
| `didDocumentMetadata.versionId` | The document transaction the resolver identified |
| `didResolutionMetadata.error` | The resolution failure, if any |
| HTTP 410 | The resolver reports the DID deactivated |
| HTTP 404 | The resolver did not find the DID |
| HTTP 503 | The resolver reports that its service is unavailable |

The [resolver API](https://web.archive.org/web/20260211224122/https://docs.teranode.group/tng-identity-documentation/did/bsv-did-universal-resolver/resolver-api) defines the response. Resolution gives you evidence for checking a key relationship. It does not establish the issuer's business authority, and it does not verify a credential's proof.

## Create a `did:bsv`

You cannot create or update a `did:bsv` from public material today. The reference application has its own script and document builders and its own issuance, completion and update operations, but they are application components, not exports of `@bsv/dpp-core`, and their source is not public. The reference application has also recorded differences between the method's prose and the script encodings it observed on chain; those notes are not public yet, and an independent encoder cannot rely on the prose alone until they are resolved ([known limitations](../operate/limitations.md)).

For planning only, this is what an integration that creates one must do. It needs the subject's and the controller's signing capabilities, the public DID document and funding for the transactions. It creates the issuance, publishes the document in a following transaction, keeps both transaction identifiers and resolves the result to check it. An issuance without its document is completed under that same issuance; minting another identifier does not repair it.

## Limits of resolution

- The resolver's `didDocumentMetadata.method.block` carries a height and a time that match the chain for this example, but its `hash` field holds the transaction identifier, not the block hash, and no merkle path is returned. Its block fields cannot establish inclusion or which key was authorised in the past.
- The resolver API has no request for a past version of a document. Checking which key was authorised when a claim was signed needs transaction evidence you kept or fetched separately; a current document cannot settle it.
- The [core ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) has no assessment of the BSV DID method. Its tested `ID-2-did-key` row covers the native `did:key` helpers only.

Two related questions are tracked as [open decisions](../start/status.md#open-decisions): physical-object DIDs, which stay optional and are never derived from the passport identifier, and whether the historical anchor format admits issuers other than `did:key`.

## Next

| You are | Go to |
|---|---|
| Signing claims with the packages | [Build an application](../packages/build-an-application.md), "Sign and anchor a lifecycle claim", with a `did:key` issuer |
| Implementing a verifier yourself | [Attestation verifier](../implement/roles/attestation-verifier.md) |
| Working with W3C credentials | [Verifiable credentials](verifiable-credentials.md) |
