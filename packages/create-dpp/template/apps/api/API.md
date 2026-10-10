# The application API

JSON under `/api`. Reads are open. Writes need a signed-in member of the brand that holds the passport, or, for a recipient who accepted a hand-on, the claim code they accepted with. Sign-in is Better Auth under `/api/auth/*` (email and password, organisations as brands); without MongoDB the API runs a development session instead and every request is "Developer", a member of brand `dev-brand`.

Errors are `{ error: <code>, description: <sentence> }`. A refused write is HTTP 409 with the writer's own code (`identifier-refused`, `payload-invalid`, `index-refused`, `not-the-controller`, `retired`, `live-publishing-off`, `spend-cap`, and so on); 401 means sign in; 403 means not a member or no claim code; 404 means not in this platform's journal, or an unknown offer or state.

A passport reference `:ref` is the URL-encoded passport identifier, for example `https%3A%2F%2Flocalhost%3A3000%2F01%2F09521000000011%2F21%2FA1`.

## Open

| Route | Returns |
|---|---|
| `GET /api/health` | `{ ok, network, index, publisherKey, wallet: 'toolbox'\|'test', livePublishing, identifiers: { host, prefix, demonstration }, signIn, devSession? }` |
| `GET /api/profiles` | `[{ id, title, description }]`, the current industry profiles |
| `GET /api/profiles/:id` | `{ id, title, description, fields: [{ key, label, valueType, unit, accessTier, obligation, cardinality, codeList, constraints, note, group }], publicSchema, restrictedSchema, sample, sampleProblems }`. `sample` is a minimal public payload of placeholders and `sampleProblems` lists anything its own schema still refuses (empty for the current profiles); fields whose `accessTier` is `public` go in `payload`; every other tier goes in `ownerFields`, the restricted tier that is encrypted off chain |
| `GET /api/verify?passportId=` | The reader's result: `{ passportId, lineage: [{ op, txid, timestamp, controllerKey, actorIdentityKey, payloadPublic }], checks: [{ name, label, status, reasonCode }], report, publisherKeys }`. `status` is `pass`, `fail`, `unknown` or `not-applicable`; `unknown` is missing evidence, never a pass |
| `GET /api/passports/:ref` | The journal view: `{ passportId, brandId, profile, status, demonstration, holder: { party, controllerKey }, createdAt, payload, journal: { states, proven, pending, status }, states: [{ op, txid, timestamp, actor, index, refusal, network, proven, proofPushed, blockHeight }], acceptanceRecords }` |
| `GET /api/passports/:ref/claims` | `[{ id, passportId, issuer, issuedBy, claim, registry?, createdAt, verified }]` |
| `GET /api/offers/:requestId` | `{ requestId, passportId, terms, expiresAt, status }`, what a recipient sees before deciding |
| `POST /api/offers/:requestId/accept` `{ claimCode }` | `{ offer, record, transferTxid }`: the custodian-signed acceptance record and the TRANSFER it committed to |
| `POST /api/offers/:requestId/decline` `{ claimCode }` | The offer, declined; nothing is written |

## Signed in

| Route | Body | Returns |
|---|---|---|
| `GET /api/me` | | `{ userId, email, name, brandIds, brands: [{ id, name, identityKey, did, createdAt }] }` |
| `GET /api/brands` | | The user's brands |
| `POST /api/brands` | `{ name }` | The new brand; its identity key is derived by the platform |
| `GET /api/brands/:brandId/passports` | | Journal views of the brand's passports |
| `POST /api/brands/:brandId/passports` | `{ profile, itemReference, serial, payload, ownerFields }` | The issued passport's journal view. `itemReference` is the digits after the GS1 prefix (nine for prefix 952), `serial` the item's serial |
| `POST /api/passports/:ref/update` | `{ payload, ownerFields?, eventData?, claimCode? }` | The journal view after the UPDATE. Omit `ownerFields` to carry the current owner tier unchanged; send `{}` to seal an empty one. The API never returns the owner tier |
| `POST /api/passports/:ref/offer` | `{ terms: { word, note? }, mechanism?, recipientIdentityKey?, claimCode? }` | `{ offer, claimCode }`. The claim code is shown once; give it to the recipient out of band |
| `GET /api/passports/:ref/offers` | | The passport's offers, without claim-code hashes; the brand's view, so it needs brand membership even after a hand-on |
| `POST /api/offers/:requestId/withdraw` | `{ claimCode? }` | The offer, withdrawn |
| `POST /api/passports/:ref/retire` | `{ reason, claimCode? }` | The journal view after the RETIRE |
| `POST /api/passports/:ref/states/:txid/resolve` | `{ outcome: 'sent'\|'abandoned' }` | A write interrupted between announcement and the network's answer (network `pending`, listed as a `resolve-interrupted` duty) is kept as sent, or withdrawn from the index, aborted in the wallet and removed. Only the operator knows which; never rebuild a state that was sent |
| `POST /api/passports/:ref/claims` | `{ eventType: 'Origin'\|'Transfer'\|'Transformation'\|'Disposition', submit?: boolean }` | The signed claim record with `verified`; with `submit`, the registry's answer under `registry` |
| `GET /api/operations` | | `{ duties: [{ passportId, txid, op, duty: 'announce'\|'prove'\|'push-proof'\|'resolve-interrupted', since }], passports: [{ passportId, brandId, status, journal }] }` |
| `POST /api/operations/run` | | `{ done: [sentence] }`, one pass over the duties |
| `GET /api/wallet` | | `{ kind, network, identityKey, balance, livePublishing }` |
| `POST /api/wallet/funding-address` | | `{ address, derivationPrefix, derivationSuffix, senderIdentityKey }`, a fresh address to pay |
| `POST /api/wallet/internalize` | `{ txid, funding }` | `{ satoshis }` taken in from a payment to that funding address |

`claimCode` on update, offer, withdraw and retire is for a recipient who holds the passport after a hand-on; a brand member omits it.

## The passport page

The API serves the built web app for every path outside `/api`, including a passport's own identifier path `/01/<gtin>/21/<serial>`, so a label's QR code opens the passport page. The page reconstructs the identifier from the current origin and that path, then calls `GET /api/verify` and `GET /api/passports/:ref`.
