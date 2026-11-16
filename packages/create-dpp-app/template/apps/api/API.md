# The application API

JSON under `/api`. Reads are open. Writes need a signed-in member of the brand that holds the passport, or, for a recipient who accepted a hand-on, the claim code they accepted with. Sign-in is Better Auth under `/api/auth/*` (email and password, organisations as brands); without MongoDB the API runs a development session instead and every request is "Developer", a member of brand `dev-brand`.

Errors are `{ error: <code>, description: <sentence> }`. A refused write is HTTP 409 with the writer's own code (`identifier-refused`, `payload-invalid`, `index-refused`, `not-the-controller`, `retired`, `live-publishing-off`, `spend-cap`, and so on); 401 means sign in; 403 means not a member or no claim code; 404 means not in this platform's journal, or an unknown offer or state. A body that is not JSON is 400 `body-not-json`. The body is never echoed or logged.

A product document under a binding that is refused adds what the form needs to the 409: `product-invalid` and `product-not-validated` carry `cause` and `validation`, `public-view-failed` carries `validation` and `publicView`, and `public-payload-too-large` carries `byteLength` and `limit`. A view is `{ view: 'whole'|'public'|'authorised', status: 'pass'|'fail'|'not-checked', cause?, summary, steps: [{ step, status, cause?, messages }], findings: [{ severity, constraint, step, path?, message?, value?, pointer?, property? }], withheld }`. `pointer` is a JSON pointer into the product document, where the finding could be placed. `not-checked` is a check that did not run to a decision, and is never a pass.

A retired profile is refused by name. The earlier sector profiles `battery@2`, `battery@3`, `battery@4` and `textile@1` to `textile@4` are retired: `GET /api/profiles/:id` for one answers 410 `profile-retired`, and every write for a passport under one, an issue, update, offer, retire or claim, answers 409 `profile-retired` with `replacedBy`, before anything is signed. A passport already in the journal under one is still served by the read routes, and its `payloadChecks` read `not-checked` with the cause `profile-retired`.

A passport reference `:ref` is the URL-encoded passport identifier, for example `https%3A%2F%2Flocalhost%3A3000%2F01%2F09521000000011%2F21%2FA1`.

## Open

| Route | Returns |
|---|---|
| `GET /api/health` | `{ ok, network, index, publisherKey, wallet: 'toolbox'\|'test', livePublishing, validationEngine, identifiers: { host, prefix, demonstration }, signIn, devSession? }`. `validationEngine` is false when the JSON-LD and SHACL libraries did not load |
| `GET /api/profiles` | `[{ id, title, description, format }]`: the current manifest profiles (`format: 'manifest'`), which today is `general@2`, and every profile held by a registered binding (`format: 'binding'`). No retired profile is listed |
| `GET /api/profiles/:id` for a binding | `{ id, format: 'binding', title, description, bindingDigest, steps, access?: { policy, public }, contexts: [{ path, uri }], prefixes, engine: { available, problem? }, examples: [{ title, itemReference, serial, passportId, product }], demonstration }`. `access.public` lists the public top-level properties; every other property is restricted. `examples` are complete product documents of invented data, minted for this deployment's host and prefix |
| `GET /api/profiles/:id/codes?class=` | For a binding: `{ <class>: [{ value, label }] }`, the coded values the profile's own vocabulary defines for each class asked for, as documents write them |
| `GET /api/profiles/:id` for a manifest | `{ id, format: 'manifest', title, description, fields: [{ key, label, valueType, unit, accessTier, obligation, cardinality, codeList, constraints, note, group }], publicSchema, restrictedSchema, sample, sampleProblems }`. `sample` is a minimal public payload of placeholders and `sampleProblems` lists anything its own schema still refuses (empty for the current profiles); fields whose `accessTier` is `public` go in `payload`; every other tier goes in `ownerFields`, the restricted tier that is encrypted off chain |
| `GET /api/verify?passportId=` | The reader's result: `{ passportId, lineage: [{ op, txid, timestamp, controllerKey, actorIdentityKey, payloadPublic }], checks: [{ name, label, status, reasonCode }], report, publisherKeys, payloadChecks: [{ txid, stateIndex, profile, publicView }], product? }`. `status` is `pass`, `fail`, `unknown` or `not-applicable`; `unknown` is missing evidence, never a pass. `payloadChecks` has the public view of each state's payload, checked against that state's own passport identifier. `product`, for a payload under a binding, is `{ profile, bindingDigest, notice?, publicProduct, access? }`: the public part only. Nothing in this answer is a statement about restricted data |
| `GET /api/passports/:ref` | The journal view: `{ passportId, brandId, profile, profileRetired?: { replacedBy }, status, demonstration, holder: { party, controllerKey }, createdAt, payload, journal: { states, proven, pending, status }, states: [{ op, txid, timestamp, actor, index, refusal, network, proven, proofPushed, blockHeight }], acceptanceRecords }` |
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
| `POST /api/brands/:brandId/passports` | `{ profile, itemReference, serial, payload, ownerFields }`, or for a profile held by a binding `{ profile, itemReference, serial, product }` | The issued passport's journal view. `itemReference` is the digits after the GS1 prefix (nine for prefix 952), `serial` the item's serial. `product` is the complete product document: the API validates it against the identifier it mints, splits it, signs the public part and seals the rest |
| `POST /api/passports/:ref/update` | `{ payload, ownerFields?, eventData?, claimCode? }`, or under a binding `{ product, eventData?, claimCode? }` | The journal view after the UPDATE. Omit `ownerFields` to carry the current owner tier unchanged; send `{}` to seal an empty one. Under a binding, `product` is the new complete document. For a manifest profile the API never returns the owner tier |
| `POST /api/passports/:ref/authorised-view` | `{ claimCode? }` | For a passport under a binding, the holder's view: `{ passportId, profile, ownerTier: { status, txid, detail }, authorisedView, restrictedProduct?, product?, access? }`. `ownerTier` is the protocol's check of the stored ciphertext against the state's `payload_owner_hash`, made before anything is decrypted, and the only statement about the commitment. `authorisedView` is the two parts rejoined and checked whole; it is `not-checked` when the restricted part could not be opened. 409 `profile-not-bound` for a manifest profile |
| `POST /api/passports/:ref/offer` | `{ terms: { word, note? }, mechanism?, recipientIdentityKey?, claimCode? }` | `{ offer, claimCode }`. The claim code is shown once; give it to the recipient out of band |
| `GET /api/passports/:ref/offers` | | The passport's offers, without claim-code hashes; the brand's view, so it needs brand membership even after a hand-on |
| `POST /api/offers/:requestId/withdraw` | `{ claimCode? }` | The offer, withdrawn |
| `POST /api/passports/:ref/retire` | `{ reason, claimCode? }` | The journal view after the RETIRE |
| `POST /api/passports/:ref/states/:txid/resolve` | `{ outcome: 'sent'\|'abandoned' }` | A write interrupted between announcement and the network's answer (network `pending`, listed as a `resolve-interrupted` duty) is kept as sent, or withdrawn from the index, aborted in the wallet and removed. Only the operator knows which; never rebuild a state that was sent |
| `POST /api/passports/:ref/claims` | `{ eventType: 'Origin'\|'Transfer'\|'Transformation'\|'Disposition', submit?: boolean }` | The signed claim record with `verified`; with `submit`, the registry's answer under `registry` |
| `GET /api/operations` | | `{ duties: [{ passportId, txid, op, duty: 'announce'\|'prove'\|'push-proof'\|'resolve-interrupted', since }], passports: [{ passportId, brandId, status, journal }], profiles: { engine: { available, problem? }, refused: [{ source, code, detail }] } }`. `refused` names each profile folder that was not registered at start, and why |
| `POST /api/operations/run` | | `{ done: [sentence] }`, one pass over the duties |
| `GET /api/wallet` | | `{ kind, network, identityKey, balance, livePublishing }` |
| `POST /api/wallet/funding-address` | | `{ address, derivationPrefix, derivationSuffix, senderIdentityKey }`, a fresh address to pay |
| `POST /api/wallet/internalize` | `{ txid, funding }` | `{ satoshis }` taken in from a payment to that funding address |

`claimCode` on update, authorised-view, offer, withdraw and retire is for a recipient who holds the passport after a hand-on; a brand member omits it.

## EPCIS exchange

Signed in, under `/api/epcis`. Every route calls `@bsv/dpp-credentials/epcis-exchange`, and the records it answers with are that module's own. An import or a pull retains data. It changes no custody, signs nothing, writes nothing on chain and never calls the wallet. An event that is retained is data a source supplied: a `valid` document passed a check of its format, and is not a signed or verified claim.

An identifier in a path, `:importId` or `:conflictId`, is the URL-encoded identifier the API gave, for example `urn%3Absv%3Adpp%3Aepcis%3Aimport%3Asha256%3A...`.

| Route | Body | Returns |
|---|---|---|
| `GET /api/epcis/status` | | `{ storage: 'mongodb'\|'memory', artefacts: { dir, state: 'present'\|'fetched'\|'unavailable', files, remedy? }, recovery: { actions, remaining }, sources, policy }`. `artefacts` is the folder of pinned GS1 files as it is now, and `recovery` is what start-up finished or discarded |
| `GET /api/epcis/sources` | | `[{ sourceId, baseUrl, permittedOrigins, localTest, repeatListParameters, credentialConfigured, credentialScheme?, problem? }]`. It says whether a credential is set and which kind, and never carries one. `localTest` is true when plain `http` and private addresses are permitted for the source. `problem` says why a pull from the source is refused as it is configured |
| `POST /api/epcis/imports?requestId=&sourceId=&filename=` | The document, as the bytes it is, under `Content-Type: application/ld+json` or `application/json` | 201 `{ outcome: 'retained', replayed: false, resumed, record }`, or 200 with `replayed: true` when `requestId` was already used for the same bytes. `record` is the import record: `importId`, `sha256`, `byteLength`, `documentValidity`, `state`, `findings`, and per event its `arrival`, findings, `preservedExtensions` and any `conflict`. `requestId` is required and is yours to choose: sending the same bytes under it again is the same request and keeps one import. `sourceId` is the scope events are filed under, `upload` by default |
| `GET /api/epcis/imports?after=&limit=` | | `{ imports: [{ importId, sourceId, requestId, receivedAt, mediaType, byteLength, sha256, provenance, state, documentValidity, events, findings, conflicts }], next? }`. Pass `next` as `after` for the page after it |
| `GET /api/epcis/imports/:importId` | | The import record, with every finding |
| `GET /api/epcis/imports/:importId/original` | | The retained bytes, exactly as received, under the media type they arrived with. `x-content-sha256` carries their digest. Never JSON this API wrote |
| `POST /api/epcis/sources/:sourceId/pulls` | `{ queryId, query: { matchAnyEPC?, eventTypes?, eventTime?: { from?, until? }, recordTime?: { from? }, eventIds?, perPage? }, window? }` | One bounded run: the module's result, `{ outcome, reason, completion, exhausted, detail, pull, run, pages, events, localTest, leniencies, completenessLimits, ... }`, answered 200 whatever the run found. `exhausted` is true only when the source named no further page, and `completenessLimits` is never empty. Run it again under the same `queryId` to continue from the checkpoint |
| `GET /api/epcis/sources/:sourceId/pulls/:queryId` | | `{ pull, pages }`: the pull's durable state and every page it acknowledged |
| `GET /api/epcis/events?identifier=&granularity=&sourceId=&after=` | | `{ identifier, granularity, nature: 'supplied-data', notice, events: [{ association, source: { importId, sourceId, receivedAt, documentValidity, state, provenance, sha256 }, event, body }], next? }`. `identifier` is matched exactly as events write it, and `granularity` is `instance` for one item or `class` for a class or a lot. `body` is the event as the retained document holds it, extension members included. Only valid documents are indexed |
| `GET /api/epcis/conflicts` | | `{ conflicts: [{ conflictId, sourceId, identity, state: 'open'\|'resolved', bodyDigests, observations, resolutions }], importsRead, truncated }`: every event identifier held with more than one body |
| `GET /api/epcis/conflicts/:conflictId` | | One conflict |
| `POST /api/epcis/conflicts/:conflictId/resolutions` | `{ decision, disposition: 'body-selected'\|'all-retained'\|'none-relied-on', selectedBodyDigest?, decidedAt? }` | 201 `{ outcome: 'recorded', replayed: false, resolution }`, or 200 with `replayed: true` for the same decision sent again. No observation and no source is changed or removed |

A refused import answers `{ error, description, remedy?, outcome: 'refused', kept: false }` and keeps nothing, not the bytes and not a record:

| Status | `error` | When |
|---|---|---|
| 400 | `request-id-required`, `invalid-request` | No `requestId`, or a request the module cannot read |
| 409 | `request-conflict` | `requestId` is already bound to other bytes or another media type. The earlier import stands, and `existingImportId` names it |
| 413 | `oversized`, `record-too-large` | The document is past the size limit, or the record of what it holds is larger than the store keeps as one record |
| 415 | `unsupported-media-type`, `content-encoding-unsupported` | Not an EPCIS media type, or sent under a content encoding |
| 422 | `malformed-json`, `malformed-utf8`, `duplicate-key`, `depth`, `unsafe-number`, `too-many-events`, `not-an-object`, `too-many-contexts`, `contexts-oversized`, `no-canonical-form` | The bytes cannot be read safely as one EPCIS document |
| 503 | `gs1-artefact-unavailable` | The pinned GS1 files are not in the configured folder. `remedy` says how to provide them |

A document that parses safely and fails validation is not refused: it is retained with `documentValidity: 'invalid'` and its findings. A pull that is refused before anything is requested answers `{ error, description, remedy?, outcome: 'refused', requested: false }`: 400 `invalid-request`, 404 `source-unknown`, 409 `pull-conflict` when `queryId` is bound to another definition, 503 `gs1-artefact-unavailable` or `credentials-unavailable`. A run that stops because a page's record is larger than the store keeps answers 413 `record-too-large`, with every earlier page retained.

## The passport page

The API serves the built web app for every path outside `/api`, including a passport's own identifier path `/01/<gtin>/21/<serial>`, so a label's QR code opens the passport page. The page reconstructs the identifier from the current origin and that path, then calls `GET /api/verify` and `GET /api/passports/:ref`. Serving the page at the identifier's path does not yet meet the standard's GS1 discovery profile, which asks that host to resolve `/01/` paths or redirect them to a resolver; the README's next steps say what to change.
