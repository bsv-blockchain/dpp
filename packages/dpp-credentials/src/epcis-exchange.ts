/**
 * `@bsv/dpp-credentials/epcis-exchange`: durable EPCIS source exchange over
 * storage the caller supplies.
 *
 * Loading this module starts nothing. It opens no database, reads no file
 * and reaches no network. Each function is handed the store it works on.
 *
 * - storage.ts        the storage interface, the in-memory adapter and the
 *                     fault injector
 * - file-storage.ts   the durable file-system adapter
 * - records.ts        the durable record types, their versions and keys
 * - exchange.ts       import, export, conflict decisions, the associations
 *                     index and recovery
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
  EPCIS_RECORD_KINDS,
  EPCIS_RECORD_VERSION,
  epcisConflictId,
  epcisEventAssociations,
  epcisIdentifierGranularity,
  epcisImportId,
  epcisRequestDigest,
  type EpcisAssociationGranularity,
  type EpcisAssociationRecord,
  type EpcisAssociationRole,
  type EpcisContextRef,
  type EpcisEventAssociation,
  type EpcisIdentityKind,
  type EpcisImportEvent,
  type EpcisImportRecord,
  type EpcisJournalRecord,
  type EpcisObservationRecord,
  type EpcisProvenance,
  type EpcisResolutionDisposition,
  type EpcisResolutionRecord,
  type EpcisRetentionRecord,
} from './epcis-exchange/records.js';
export * from './epcis-exchange/exchange.js';
export * from './epcis-exchange/adapter-suite.js';
