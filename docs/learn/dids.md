# BSV DIDs

Application builders and claim verifiers can use this page to choose and resolve a Bitcoin SV decentralised identifier (`did:bsv`). A decentralised identifier (DID) names an entity, such as a brand or repairer, and leads readers to its verification keys.

## Before you start

| Task | Requirements and limits |
|---|---|
| Resolve the published example | Node.js 22 or later and network access, from any directory. No checkout, wallet or funds. The command supplies the example DID and the reference application's resolver, `https://bsvdid-universal-resolver.nchain.systems`; set `DID_RESOLVER_URL` for another resolver with the same interface. |
| Plan creation or an update | Public material does not support this today. For planning only, identify the subject's and controller's signing capabilities, public DID document and transaction funding. |

## Do you need a `did:bsv`?

No. Every writer today uses [Ring 0](identity-and-authority.md#ring-0). Passport states are signed with wallet identity keys; lifecycle claims can name issuers by the identity key's `did:key`, needing no resolver or transaction ([rules](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md#3-native-signed-claim) section 3). [Build an application](../packages/build-an-application.md), "Sign and anchor a lifecycle claim", does this with `didKeyFromIdentityKey(identityKey)`.

Continue to verify a `did:bsv` issuer or plan for changing keys. Credential profiles may select other methods, such as the external profile's `did:web` ([verifiable credentials](verifiable-credentials.md)).

## Which identifier does what

| Identifier | Role in a DPP build |
|---|---|
| `did:key` | One public key written as a DID. It works offline, and changing the key changes the identifier. The native helpers accept compressed secp256k1 keys |
| `did:bsv` | An identity whose document lives in a chain of BSV transactions, so its keys can change while the identifier stays the same |
| `did:web` | An identity document fetched over HTTPS; the external credential profile uses it |
| Passport identifier | The product a claim concerns. It is never an issuer's DID, and no DID is derived from it |

Choose `did:bsv` for key history: later documents record new keys under the original identifier. A reader still needs evidence of which key was authorised when a claim was signed.

## Connect a DID to a claim

A native lifecycle claim (`dpp-lifecycle-v1`) names its issuer in `issuer` and uses a key derived from the issuer's identity key, called the signing root.

| `issuer` | Required binding |
|---|---|
| `did:key` | Names the signing root directly; the claim has no `issuerKeyDid`. |
| A resolvable DID, such as `did:bsv` | Must also carry `issuerKeyDid`, the signing root's `did:key`. Verify the signature against that key, then resolve the issuer's DID and check that it authorised the key. |

A key in the claim cannot vouch for its own link to the issuer.

The [native claim source](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/rules.md#L46-L55) defines this binding.

A state names the actor's identity key, but the actor's signature is made with a key derived from it. `@bsv/dpp-protocol` provides converters: `didKeyFromIdentityKey` and `identityKeyFromDidKey` for an identity key, and `signingPublicKeyFor(state)` and `signingDidFor(state)` for the derived key that verifies a state's actor signature ([@bsv/dpp-protocol](../packages/dpp-protocol.md), table "Claims and anchors").

A `did:bsv` document does not automatically satisfy a credential profile that selects `did:web`, another curve or a particular proof purpose.

## How `did:bsv` works

At the time of writing, the publisher's `docs.teranode.group` pages redirect in a loop. These links therefore use archives: the [method specification](https://web.archive.org/web/20260516084819/https://docs.teranode.group/tng-identity-documentation/did/bsv-did-method-specifications), its [transaction definitions](https://web.archive.org/web/20250916170103/https://docs.teranode.group/tng-identity-documentation/did/bsv-did-method-specifications/specification-overview/utxo-did-method-normative-reference) and the [resolver API](https://web.archive.org/web/20260211224122/https://docs.teranode.group/tng-identity-documentation/did/bsv-did-universal-resolver/resolver-api). The reference application adopts this method for identities whose keys can change.

An unspent transaction output (UTXO) has not yet been spent. Spending outputs links identity records. The DID document publishes verification keys, their purposes and any service endpoints.

| Operation | What happens |
|---|---|
| Create | An issuance transaction establishes the identifier. A following transaction publishes the DID document |
| Resolve | A resolver follows the transaction chain and returns the current document and its metadata |
| Update | A later document changes the identity's published information while the DID stays the same |
| Fund | A funding transaction pays fees for continuing the chain without changing the DID's state |
| Revoke | A final transaction ends the chain and deactivates the DID |

These are method operations, not a claim that every DPP integration implements them. The [transaction definitions](https://web.archive.org/web/20250916170103/https://docs.teranode.group/tng-identity-documentation/did/bsv-did-method-specifications/specification-overview/utxo-did-method-normative-reference) govern their encoding and signatures. Scripts grant spending rights; an application account or document's controller list does not.

## Resolve a `did:bsv`

1. Run the command with the requirements above to read the published BSV DID example.

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

2. Compare the response with this table. Inspect `verificationMethod` for keys and relationships such as `authentication` for their permitted uses. Stop on a resolution error or deactivation; resolution alone does not verify a credential.

| Result | Meaning |
|---|---|
| Example success | `"httpStatus": 200`; `id` matches the requested DID; one `JsonWebKey2020` secp256k1 key under `verificationMethod`, also listed under `authentication`; `"deactivated": null`; `"error": null`; exit status 0. |
| Status limit | A missing `deactivated` field prints as `null`; this is not an independent status check. |
| `didDocument` | The identity document, or `null` when unavailable or deactivated |
| `didDocumentMetadata.versionId` | The document transaction the resolver identified |
| `didResolutionMetadata.error` | The resolution failure, if any |
| HTTP 410 | The resolver reports the DID deactivated |
| HTTP 404 | The resolver did not find the DID |
| HTTP 503 | The resolver reports that its service is unavailable |

The [resolver API](https://web.archive.org/web/20260211224122/https://docs.teranode.group/tng-identity-documentation/did/bsv-did-universal-resolver/resolver-api) defines the response. Resolution gives you evidence for checking a key relationship. It does not establish the issuer's business authority, and it does not verify a credential's proof.

## Create a `did:bsv`

Public material cannot yet support creation or updates. The reference application's script and document builders, issuance, completion and update operations are application components whose source is not public, not `@bsv/dpp-protocol` exports. Its unpublished notes record differences between the method prose and observed on-chain script encodings. Independent encoders cannot rely on the prose alone until these differences are resolved ([known limitations](../operate/limitations.md)).

**Planning checklist, blocked by the missing public implementation and unresolved encoding differences:**

1. Create the issuance.
2. Publish the document in a following transaction.
3. Keep both transaction identifiers and resolve the result to check it.

Complete an issuance missing its document under that same issuance. Minting another identifier does not repair it.

## Limits of resolution

- The example's `didDocumentMetadata.method.block` height and time match the chain, but `hash` contains the transaction identifier, not the block hash. No merkle path is returned. These fields establish neither inclusion nor past key authority.
- The resolver cannot request past document versions. Past key authority needs transaction evidence retained or fetched separately; the current document cannot establish it.
- The [core ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) has no assessment of the BSV DID method. Its tested `ID-2-did-key` row covers the native `did:key` helpers only.

Two related questions are tracked as [open decisions](../start/status.md#open-decisions): physical-object DIDs, which stay optional and are never derived from the passport identifier, and whether the historical anchor format admits issuers other than `did:key`.

## Next

| You are | Go to |
|---|---|
| Signing claims with the packages | [Build an application](../packages/build-an-application.md), "Sign and anchor a lifecycle claim", with a `did:key` issuer |
| Implementing a verifier yourself | [Attestation verifier](../implement/roles/attestation-verifier.md) |
| Working with W3C credentials | [Verifiable credentials](verifiable-credentials.md) |
