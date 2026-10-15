import type { DocumentLoader, JsonObject } from './types.js';
import { parseStrictJsonBytes } from './validation.js';

/** Resolve did:web using explicit operator-approved origins, with bounded reads and no redirects. */
export function createDidWebResolver({ allowedOrigins, fetcher = globalThis.fetch, timeoutMs = 5000, maxBytes = 262144 }: {
  allowedOrigins: readonly string[]; fetcher?: typeof globalThis.fetch; timeoutMs?: number; maxBytes?: number;
}): DocumentLoader {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 1_048_576) throw new Error('Invalid DID resolution limits');
  return async requested => {
    const [did, fragment, ...extra] = requested.split('#');
    if (!did.startsWith('did:web:') || extra.length) throw new Error('Unsupported DID method or DID URL');
    const segments = did.slice('did:web:'.length).split(':').map(s => decodeURIComponent(s));
    const domain = segments.shift();
    if (!domain || /[/?#@\s]/.test(domain) || segments.some(s => !s || s === '.' || s === '..' || /[\\/]/.test(s))) throw new Error('Invalid did:web identifier');
    const url = new URL(`https://${domain}/${segments.length ? segments.map(encodeURIComponent).join('/') + '/did.json' : '.well-known/did.json'}`);
    if (!allowedOrigins.includes(url.origin)) throw new Error('DID origin is not permitted by resolver policy');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, { signal: controller.signal, redirect: 'error', headers: { accept: 'application/did+ld+json, application/json' } });
      if (!response.ok || !response.body) throw new Error('DID document is unavailable');
      const declared = response.headers.get('content-length');
      if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new Error('DID document exceeds the size limit');
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
      try {
        for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > maxBytes) throw new Error('DID document exceeds the size limit'); chunks.push(value); }
      } finally { await reader.cancel(); }
      const bytes = new Uint8Array(total); let position = 0; for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
      const parsed = parseStrictJsonBytes(bytes);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as JsonObject).id !== did) throw new Error('Resolved DID document does not match the requested identifier');
      const document = parsed as JsonObject;
      if (!fragment) return { document, documentUrl: requested, contextUrl: null };
      const embedded = ['verificationMethod','assertionMethod','authentication','capabilityInvocation','capabilityDelegation','keyAgreement']
        .flatMap(term => Array.isArray(document[term]) ? document[term] as unknown[] : [])
        .find(value => value && typeof value === 'object' && (value as JsonObject).id === requested);
      if (!embedded) throw new Error('Verification method is absent from the DID document');
      return { document: { '@context': document['@context'], ...(embedded as JsonObject) }, documentUrl: requested, contextUrl: null };
    } finally { clearTimeout(timer); }
  };
}
