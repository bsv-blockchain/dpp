import { contexts as vcContexts } from '@digitalbazaar/credentials-context';
import { contexts as diContexts } from '@digitalbazaar/data-integrity-context';
import { contexts as multikeyContexts } from '@digitalbazaar/multikey-context';
import { contexts as didContexts } from 'did-context';
import { suiteContext } from '@digitalbazaar/ed25519-signature-2020';
import type { DocumentLoader, JsonObject } from './types.js';

export const PROFILE_ID = 'vsc-draft-compat/0.1.0';
export const UPSTREAM_REVISION = 'c279de3debcd6eab94a77034584d1750f5d65e6a';
// Owned profile identifier. No invented context is served under a W3C URL.
export const CONTEXT_URL = 'urn:bsv:vsc:context:0.1.0';
const ns = 'urn:bsv:vsc:term:';
const terms: Record<string, unknown> = {
  '@version': 1.1, '@protected': true,
  'VSC-SEAL': `${ns}SEAL`, VscEventAuthorisation: `${ns}EventAuthorisation`, VscCorrectionAuthorisation: `${ns}CorrectionAuthorisation`,
  issuanceDate: { '@id': 'https://www.w3.org/2018/credentials#issuanceDate', '@type': 'http://www.w3.org/2001/XMLSchema#dateTime' },
};
for (const term of ['sealVersion','sealTimestamp','eventVector','what','when','where','who','how','scheme','value','schemeAuthority','serialNumber','batchOrLot','expiryDate','quantity','quantityUnit','eventTime','recordedAt','timezone','timePrecision','jurisdiction','actorRole','eventType','eventTypeVocab','businessStep','disposition','action','chainOfCustody','sequenceNumber','topology','topologyNote']) terms[term] = `${ns}${term}`;
for (const term of ['actorDid','assertionMethod','chainId','correctionOf','originalIssuer']) terms[term] = { '@id': `${ns}${term}`, '@type': '@id' };
for (const term of ['productIdentifiers']) terms[term] = { '@id': `${ns}${term}`, '@container': '@set' };
for (const term of ['parentSeals','childSeals','predecessorCredentials']) terms[term] = { '@id': `${ns}${term}`, '@type': '@id', '@container': '@set' };
for (const term of ['extensions','classifications','readPoint','businessLocation','geoCoordinates','actorLicense','permittedEventTypes','permittedProductSchemes','permittedJurisdictions','permittedRecordIds','permittedActions']) terms[term] = { '@id': `${ns}${term}`, '@type': '@json' };
export const PROFILE_CONTEXT: JsonObject = { '@context': terms };
export const SEAL_CONTEXTS = [
  'https://www.w3.org/ns/credentials/v2', CONTEXT_URL,
  'https://w3id.org/security/suites/ed25519-2020/v1',
  'https://w3id.org/security/data-integrity/v2',
];

/** Contexts are pinned package resources. External DID/credential retrieval is an explicit dependency. */
export function createDocumentLoader(documents: ReadonlyMap<string, JsonObject> = new Map(), fallback?: DocumentLoader): DocumentLoader {
  const builtins = new Map<string, JsonObject>([
    ...vcContexts, ...diContexts, ...multikeyContexts, ...didContexts,
    ...suiteContext.contexts, [CONTEXT_URL, PROFILE_CONTEXT],
  ]);
  return async url => {
    const document = builtins.get(url) ?? documents.get(url);
    if (document) return { document: structuredClone(document), documentUrl: url, contextUrl: null };
    // Context substitution is never delegated to network loaders.
    if (url.includes('/contexts/') || url.startsWith('urn:bsv:vsc:')) throw new Error(`Unsupported context: ${url}`);
    if (!fallback) throw new Error(`No document available: ${url}`);
    return fallback(url);
  };
}
