/**
 * `@bsv/dpp-credentials/epcis-exchange`: durable EPCIS source exchange over
 * storage the caller supplies.
 *
 * Loading this module starts nothing. It opens no database, reads no file
 * and reaches no network. Each function is handed the store it works on,
 * and the pull is handed the transport it requests through.
 *
 * - storage.ts        the storage interface, the in-memory adapter and the
 *                     fault injector
 * - file-storage.ts   the durable file-system adapter
 * - records.ts        the durable record types, their versions and keys
 * - exchange.ts       import, export, conflict decisions, the associations
 *                     index and recovery
 * - pull.ts           the query pull: one bounded run against the standard
 *                     events query of a configured source
 * - pull-transport.ts one page of a pull: where a request may go, what it
 *                     carries and how much of the answer is read
 * - recovery.ts       authorised recovery: a snapshot of a store, the
 *                     public form of one, and the restore into another store
 * - adapter-suite.ts  the shared suite every storage adapter must pass
 *
 * How records are keyed inside a store is not part of this entry point: a
 * reader of a store goes through the functions here, and a record says
 * everything about itself without its key.
 */
export {
  EPCIS_STORAGE_KEY,
  EPCIS_STORAGE_KIND,
  EpcisStorageError,
  EpcisStorageFault,
  assertStorageBytes,
  assertStorageDigest,
  assertStorageList,
  assertStorageName,
  checkedWrites,
  createMemoryEpcisState,
  createMemoryEpcisStorage,
  faultInjectingEpcisStorage,
  type EpcisCommitResult,
  type EpcisExchangeStorage,
  type EpcisListOptions,
  type EpcisStorageErrorCode,
  type EpcisStorageFaultPlan,
  type EpcisStorageWrite,
  type EpcisStoredRecord,
  type EpcisWriteExpectation,
  type FaultInjectingEpcisStorage,
  type MemoryEpcisState,
  type MemoryEpcisStorage,
} from './epcis-exchange/storage.js';
export { FILE_EPCIS_STORAGE_FORMAT, openFileEpcisStorage, type FileEpcisStorage, type FileEpcisStorageOptions, type FileEpcisStorageStep } from './epcis-exchange/file-storage.js';
export {
  EPCIS_IMPORT_VERSION,
  EPCIS_PULL_VERSION,
  EPCIS_QUERY_PARAMETERS,
  EPCIS_RECORD_KINDS,
  EPCIS_RECORD_VERSION,
  epcisConflictId,
  epcisEventAssociations,
  epcisIdentifierGranularity,
  epcisImportId,
  epcisPullDefinitionDigest,
  epcisPullId,
  epcisRequestDigest,
  epcisRestoreId,
  type EpcisAssociationGranularity,
  type EpcisAssociationRecord,
  type EpcisAssociationRole,
  type EpcisContextRef,
  type EpcisEventAssociation,
  type EpcisFileProvenance,
  type EpcisIdentityKind,
  type EpcisImportEvent,
  type EpcisImportRecord,
  type EpcisJournalRecord,
  type EpcisObservationRecord,
  type EpcisProvenance,
  type EpcisPullCompletion,
  type EpcisPullCursor,
  type EpcisPullEndpointRemap,
  type EpcisPullEventCounts,
  type EpcisPullLeniency,
  type EpcisPullPageRecord,
  type EpcisPullPass,
  type EpcisPullPending,
  type EpcisPullQuery,
  type EpcisPullReason,
  type EpcisPullRecord,
  type EpcisPullRunSummary,
  type EpcisPullServerVersions,
  type EpcisPullSourceScope,
  type EpcisQueryProvenance,
  type EpcisRelocationRecord,
  type EpcisResolutionDisposition,
  type EpcisResolutionRecord,
  type EpcisRestoreCounts,
  type EpcisRestoreRecord,
  type EpcisRetentionRecord,
  type EpcisSourceOutcome,
} from './epcis-exchange/records.js';
export {
  CBV_WIRE_VERSION,
  EPCIS_MIN_SECRET_LENGTH,
  EPCIS_PULL_MAX_REDIRECTS,
  EPCIS_WIRE_VERSION,
  isPrivateHost,
  parseNextLink,
  type EpcisFetch,
  type EpcisFetchResponse,
  type EpcisNextLink,
  type EpcisPullLogEntry,
  type EpcisSourceCredential,
} from './epcis-exchange/pull-transport.js';
export * from './epcis-exchange/pull.js';
export * from './epcis-exchange/exchange.js';
export * from './epcis-exchange/recovery.js';
export * from './epcis-exchange/adapter-suite.js';
