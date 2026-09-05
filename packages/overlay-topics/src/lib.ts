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
export { DppTopicManager, DPP_TOPIC, type DppAdmissionOptions } from './tmDpp.js'
export * from './attestationAnchor.js'
export * from './attestationStorage.js'
export * from './tmAttestation.js'
export * from './lsAttestation.js'
export { DppLookupService, DPP_SERVICE, MAX_LOOKUP_RESULTS, type DppLookupQuery } from './lsDpp.js'
export {
  InMemoryDppStorage,
  MongoDppStorage,
  selectorFilter,
  type DppRecord,
  type DppRecordInput,
  type DppRecordStore,
  type RecordSelector,
  type SequenceRange,
} from './storage.js'
export { InMemoryOverlayStorage, MongoOverlayStorage, type RetractableStorage } from './engineStorage.js'
export * from './limits.js'
export * from './policyConfig.js'
export * from './history.js'
export * from './capabilities.js'
export * from './evidenceExport.js'
export * from './retraction.js'
export * from './sync.js'
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
  UORA_ANCHOR_PREFIX_V1,
  UORA_ANCHOR_PREFIX_V2,
  UORA_ANCHOR_PROTOCOL,
  type UoraAnchor,
} from './uoraAnchor.js'
