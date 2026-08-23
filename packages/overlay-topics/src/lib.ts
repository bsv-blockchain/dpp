/**
 * Library surface of the DPP overlay node: the topic managers, lookup services
 * and record stores, importable by other packages (the backend's offline
 * demo mode and tests). The node entry point is index.ts.
 *
 * Two rails, deliberately separate. `tm_dpp`/`ls_dpp` carry the passport
 * itself and depend on `@bsv/dpp-core`. `tm_uora_dpp`/`ls_uora_dpp` carry the
 * attestation anchors that say what a named party claimed about a passport,
 * and depend on nothing of ours: they are written to be dropped into a shared
 * overlay instance that has never heard of this programme's token core.
 */
export { DppTopicManager } from './tmDpp.js'
export { DppLookupService, MAX_LOOKUP_RESULTS, type DppLookupQuery } from './lsDpp.js'
export {
  InMemoryDppStorage,
  MongoDppStorage,
  type DppRecord,
  type DppRecordStore,
} from './storage.js'
export { InMemoryOverlayStorage, MongoOverlayStorage } from './engineStorage.js'
export { UoraAnchorTopicManager } from './tmUoraDpp.js'
export { UoraAnchorLookupService, UORA_SERVICE, UORA_TOPIC } from './lsUoraDpp.js'
export {
  InMemoryUoraAnchorStorage,
  MongoUoraAnchorStorage,
  MAX_ANCHOR_RESULTS,
  type UoraAnchorQuery,
  type UoraAnchorRecord,
  type UoraAnchorStore,
} from './anchorStorage.js'
export {
  didKeyFromIdentityKey,
  expectedLockingKey,
  identityKeyFromDidKey,
  tryParseUoraAnchor,
  uoraAnchorFields,
  uoraAnchorPrefix,
  uoraAnchorSigningPreimage,
  UORA_ANCHOR_BASKET,
  UORA_ANCHOR_FIELD_COUNT,
  UORA_ANCHOR_PREFIX,
  UORA_ANCHOR_PREFIX_V2,
  UORA_ANCHOR_PROTOCOL,
  type UoraAnchor,
} from './uoraAnchor.js'
