# BSV DIDs

A decentralised identifier (DID) names an entity and provides a way to obtain its verification keys. The digital product passport (DPP) reference application adopts the Bitcoin SV (BSV) DID method for identities whose keys can change while their identifier stays the same. The method explanation here draws on the [BSV DID specification](https://docs.teranode.group/tng-identity-documentation/did/bsv-did-method-specifications). The publisher's pages redirect in a loop at the time of writing; archived copies of the [specification](https://web.archive.org/web/20260516084819/https://docs.teranode.group/tng-identity-documentation/did/bsv-did-method-specifications), the [transaction definitions](https://web.archive.org/web/20250916170103/https://docs.teranode.group/tng-identity-documentation/did/bsv-did-method-specifications/specification-overview/utxo-did-method-normative-reference) and the [resolver API](https://web.archive.org/web/20260211224122/https://docs.teranode.group/tng-identity-documentation/did/bsv-did-universal-resolver/resolver-api) can be read meanwhile.

The reason is key history. A `did:key` encodes one public key. Changing that key produces a different identifier. A `did:bsv` identifies a blockchain transaction chain, so later documents can record changes under the original identifier. An application still needs evidence of which key was authorised when a claim was signed.

## How the method works

An unspent transaction output (UTXO) is an output available to be spent by a later transaction. The BSV DID method links identity records through these spends. Its DID document publishes verification keys, their purposes and any service endpoints.

| Operation | What happens |
|---|---|
| Create | An issuance transaction establishes the identifier. A following transaction publishes the DID document. |
| Resolve | A resolver follows the transaction chain and returns the current document and metadata. |
| Update | A later document changes the identity's published information while the DID stays the same. |
| Fund | A funding transaction supplies fees for continuing the chain without changing the DID state. |
| Revoke | A terminal transaction ends the chain and invalidates the DID. |

These are method operations, not a claim that every DPP integration implements them. The [BSV DID transaction definitions](https://docs.teranode.group/tng-identity-documentation/did/bsv-did-method-specifications/specification-overview/utxo-did-method-normative-reference) govern their encoding and signatures. A DID controller's spending rights come from those scripts; an application account or a list of controllers does not define them.

## Resolve a DID

This reads the published BSV DID example using the resolver the reference application uses, `https://bsvdid-universal-resolver.nchain.systems`. Run it with Node.js 22 or later. It needs network access, but no repository checkout, wallet or funds. Set `DID_RESOLVER_URL` to use another resolver implementing the same interface.

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

Expect HTTP 200 and a document whose `id` matches the requested DID. Inspect `verificationMethod` for keys and the verification relationships, such as `authentication`, for their permitted purposes. A missing `deactivated` field is printed as `null`; it is not an independent status check.

| Result | Meaning |
|---|---|
| `didDocument` | The identity document, or `null` when unavailable or deactivated. |
| `didDocumentMetadata.versionId` | The document transaction identified by the resolver. |
| `didResolutionMetadata.error` | The resolution failure, if present. |
| HTTP 410 | The resolver reports deactivation. |
| HTTP 404 | The resolver did not find the DID. |
| HTTP 503 | The resolver reports that its service is unavailable. |

The [BSV DID resolver API](https://docs.teranode.group/tng-identity-documentation/did/bsv-did-universal-resolver/resolver-api) defines the response. Resolution supplies evidence for checking a key relationship. It does not establish the issuer's business authority or verify a credential's proof.

The resolver's `didDocumentMetadata.method.block` carries a height and a time that match the chain for this example, but its `hash` field holds the transaction identifier, not the block hash, and no merkle path is returned. Its block fields cannot establish inclusion or historical authority. The documented API also lacks a request for a past document version. Historical verification needs separately retained or retrieved transaction evidence; a current document cannot settle which key was authorised in the past.

## Connect the DID to a claim

For a native claim, `issuer` names the claiming entity. When that is a resolvable DID, `issuerKeyDid` carries the native signing root as a `did:key`. The verifier checks the native signature and separately establishes that the resolved issuer authorised that key. A key supplied by the claim cannot authenticate its own issuer relationship. The [native claim source](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/rules.md#L46-L55) defines this binding.

| Identifier | Role in DPP |
|---|---|
| `did:bsv` | A resolvable identity with a document history under the BSV DID method. |
| `did:key` | An offline representation of a key; native helpers accept compressed secp256k1 keys. |
| `did:web` | An identity document retrieved over HTTPS; used by the selected external credential profile. |
| Passport identifier | The product the claim concerns, independent of the issuer's DID. |

A native passport's actor key and its derived signing key also differ. Use the [core DID helpers](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/packages/dpp-core/src/did.ts) to obtain each. A `did:bsv` document does not automatically meet a credential profile that selects `did:web`, another curve or an assertion purpose. Continue with [verifiable credentials](verifiable-credentials.md) for those choices.

## Create or integrate identities

The reference application has its own script and document builders and its own issuance, completion and update operations. They are application components, not exports of `@bsv/dpp-core`, and their source is not public. A native build at Ring 0 needs no `did:bsv`: passport states are signed with identity keys, and a lifecycle claim can name its issuer as a `did:key` of the issuer's identity key ([rules](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/rules.md) section 3).

An integration supplies the subject and controller signing capabilities, the public document and transaction funding. It creates the issuance, publishes the document, retains both transaction identifiers and resolves the result. An issuance without its document needs completion under that same issuance. Minting another identifier does not repair it.

The reference application has recorded differences between the method prose and the script encodings it observed on chain. Those notes are not public yet, and the differences need resolution before an independent encoder can rely on the prose alone. The [core ledger](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/conformance/manifest.json) has no dedicated BSV DID method assessment; its tested `ID-2-did-key` row covers the native key helpers.

Physical-object DID derivation: declined for now; a physical-object DID stays optional and is never derived from the passport identifier. Historical anchor issuer widening: open; the [historical anchor](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/legacy-uora-anchor-v3.md) admits `did:key` issuers only, while the current `bsv-attestation-anchor-v1` carries any issuer identifier. An issuer DID does not implement physical-object binding.

Live identity assurance is Ring 0. Higher rings are absent. [Identity and authority](identity-and-authority.md) explains the distinction between identifying a signer and accepting its claims.
