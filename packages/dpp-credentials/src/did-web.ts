import { fetch as undiciFetch } from 'undici';
import { assertPublicDidHost, createDidWebDispatcher } from './did-web-transport.js';
import type { DocumentLoader, JsonObject } from './types.js';
import { parseStrictJsonBytes } from './strict-json.js';

async function fetchDidBytes(url: URL, fetcher: typeof globalThis.fetch | undefined, timeoutMs: number, maxBytes: number): Promise<Uint8Array> {
  const controller = new AbortController();
  const { signal } = controller;
  const dispatcher = createDidWebDispatcher(maxBytes, signal);
  const timer = setTimeout(() => controller.abort(new Error('DID document retrieval timed out')), timeoutMs);
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  // A truncated compressed stream can leave the decoder waiting after the HTTP parser stops.
  dispatcher.on('disconnect', (_origin, _targets, error) => {
    if (error.code === 'UND_ERR_RES_EXCEEDED_MAX_SIZE') controller.abort(new Error('DID document exceeds the size limit'));
  });

  async function read(): Promise<Uint8Array> {
    const init = { dispatcher, signal, redirect: 'error' as const, headers: { accept: 'application/did+ld+json, application/json' } };
    const response = fetcher == null ? await undiciFetch(url, init) : await fetcher(url, init);
    if (signal.aborted || !response.ok || response.redirected || !response.body) {
      void response.body?.cancel().catch(() => {});
      signal.throwIfAborted();
      throw new Error('DID document is unavailable');
    }
    const reader = response.body.getReader();
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
        throw new Error('DID document exceeds the size limit');
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        total += value.length;
        if (total > maxBytes) throw new Error('DID document exceeds the size limit');
        chunks.push(value);
      }
      return Buffer.concat(chunks, total);
    } finally {
      signal.removeEventListener('abort', cancel);
      cancel();
      reader.releaseLock();
    }
  }

  try {
    return await Promise.race([read(), aborted]);
  } finally {
    clearTimeout(timer);
    void dispatcher.destroy().catch(() => {});
  }
}

/** Resolve did:web from approved origins. A custom fetcher must honour the supplied dispatcher, signal and redirect policy. */
export function createDidWebResolver({ allowedOrigins, fetcher, timeoutMs = 5000, maxBytes = 262144 }: {
  allowedOrigins: readonly string[]; fetcher?: typeof globalThis.fetch; timeoutMs?: number; maxBytes?: number;
}): DocumentLoader {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647 ||
      !Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 1_048_576) {
    throw new Error('Invalid DID resolution limits');
  }
  return async requested => {
    const [did, fragment, ...extra] = requested.split('#');
    if (!did.startsWith('did:web:') || extra.length) throw new Error('Unsupported DID method or DID URL');
    const segments = did.slice('did:web:'.length).split(':').map(s => decodeURIComponent(s));
    const domain = segments.shift();
    if (!domain || /[\\/?#@\s]/.test(domain) || segments.some(s => !s || s === '.' || s === '..' || /[\\/]/.test(s))) throw new Error('Invalid did:web identifier');
    const url = new URL(`https://${domain}/${segments.length ? segments.map(encodeURIComponent).join('/') + '/did.json' : '.well-known/did.json'}`);
    if (!allowedOrigins.includes(url.origin)) throw new Error('DID origin is not permitted by resolver policy');
    assertPublicDidHost(url.hostname);
    const bytes = await fetchDidBytes(url, fetcher, timeoutMs, maxBytes);
    const parsed = parseStrictJsonBytes(bytes);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as JsonObject).id !== did) throw new Error('Resolved DID document does not match the requested identifier');
    const document = parsed as JsonObject;
    if (!fragment) return { document, documentUrl: requested, contextUrl: null };
    const embedded = ['verificationMethod','assertionMethod','authentication','capabilityInvocation','capabilityDelegation','keyAgreement']
      .flatMap(term => Array.isArray(document[term]) ? document[term] as unknown[] : [])
      .find(value => value && typeof value === 'object' && (value as JsonObject).id === requested);
    if (!embedded) throw new Error('Verification method is absent from the DID document');
    return { document: { '@context': document['@context'], ...(embedded as JsonObject) }, documentUrl: requested, contextUrl: null };
  };
}
