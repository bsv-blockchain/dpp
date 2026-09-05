import { expect, it, vi } from 'vitest';
import { createDidWebResolver } from '../src/did-web.js';
it('resolves did:web path identifiers and their embedded verification methods', async () => {
  const did = 'did:web:issuer.example:organisation';
  const document = { '@context': 'https://www.w3.org/ns/did/v1', id: did, verificationMethod: [{ id: `${did}#key`, type: 'Ed25519VerificationKey2020', controller: did, publicKeyMultibase: 'z6MkExample' }] };
  const fetcher = vi.fn(async () => new Response(JSON.stringify(document), { headers: { 'content-type': 'application/did+ld+json' } }));
  const resolve = createDidWebResolver({ allowedOrigins: ['https://issuer.example'], fetcher });
  expect((await resolve(`${did}#key`)).document.id).toBe(`${did}#key`);
  expect(String(fetcher.mock.calls[0][0])).toBe('https://issuer.example/organisation/did.json');
  await expect(resolve('did:web:other.example')).rejects.toThrow('not permitted');
});
it('rejects oversized or mismatched DID documents and path traversal', async () => {
  const resolve = createDidWebResolver({ allowedOrigins: ['https://issuer.example'], maxBytes: 20, fetcher: async () => new Response('x'.repeat(21)) });
  await expect(resolve('did:web:issuer.example')).rejects.toThrow('size limit');
  await expect(resolve('did:web:issuer.example:..')).rejects.toThrow('Invalid');
  const mismatch = createDidWebResolver({ allowedOrigins: ['https://issuer.example'], fetcher: async () => new Response(JSON.stringify({ id: 'did:web:other.example' })) });
  await expect(mismatch('did:web:issuer.example')).rejects.toThrow('does not match');
});
