import { expect, it, vi } from 'vitest';
import { createDidWebResolver } from '../src/did-web.js';
it('resolves did:web path identifiers and their embedded verification methods', async () => {
  const did = 'did:web:issuer.example:organisation';
  const document = { '@context': 'https://www.w3.org/ns/did/v1', id: did, verificationMethod: [{ id: `${did}#key`, type: 'Ed25519VerificationKey2020', controller: did, publicKeyMultibase: 'z6MkExample' }] };
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(document), { headers: { 'content-type': 'application/did+ld+json' } }));
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

const origin = 'https://issuer.example';
const issuer = 'did:web:issuer.example';

it('passes a destination-checking dispatcher and refuses redirects at the transport', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: issuer })));
  await createDidWebResolver({ allowedOrigins: [origin], fetcher })(issuer);
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    redirect: 'error', dispatcher: { dispatch: expect.any(Function) },
  });
});

it('refuses a non-public literal before invoking even a configured transport', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const resolve = createDidWebResolver({ allowedOrigins: ['https://127.0.0.1'], fetcher });
  await expect(resolve('did:web:127.0.0.1')).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it('rejects a redirect response and releases its unread body', async () => {
  const cancel = vi.fn();
  const fetcher = async () => new Response(new ReadableStream({ cancel }), { status: 302 });
  const resolve = createDidWebResolver({ allowedOrigins: [origin], fetcher });
  await expect(resolve(issuer)).rejects.toThrow();
  expect(cancel).toHaveBeenCalledOnce();
});

it('releases an oversized declared response before reading it', async () => {
  const cancel = vi.fn();
  const fetcher = async () => new Response(new ReadableStream({ cancel }), { headers: { 'content-length': '65' } });
  const resolve = createDidWebResolver({ allowedOrigins: [origin], maxBytes: 64, fetcher });
  await expect(resolve(issuer)).rejects.toThrow('size limit');
  expect(cancel).toHaveBeenCalledOnce();
});

it('accepts the exact byte limit and rejects one more byte over multiple chunks', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ id: issuer }));
  const fetcher = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 4)); controller.enqueue(bytes.subarray(4)); controller.close();
    },
  }));
  await expect(createDidWebResolver({ allowedOrigins: [origin], maxBytes: bytes.length, fetcher })(issuer))
    .resolves.toMatchObject({ document: { id: issuer } });
  await expect(createDidWebResolver({ allowedOrigins: [origin], maxBytes: bytes.length - 1, fetcher })(issuer))
    .rejects.toThrow('size limit');
});

it.each(['headers', 'body'] as const)('bounds the entire retrieval when %s stall', async stage => {
  vi.useFakeTimers();
  try {
    const cancel = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async () => {
      if (stage === 'headers') return new Promise<Response>(() => {});
      return new Response(new ReadableStream({ cancel }));
    });
    const resolve = createDidWebResolver({ allowedOrigins: [origin], timeoutMs: 10, fetcher });
    // Observe settlement without relying on the test runner's own timeout.
    let outcome = 'pending';
    const result = resolve(issuer).then(() => { outcome = 'resolved'; }, () => { outcome = 'rejected'; });
    await vi.advanceTimersByTimeAsync(10);
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(outcome).toBe('rejected');
    if (stage === 'body') expect(cancel).toHaveBeenCalledOnce();
    await result;
  } finally {
    vi.useRealTimers();
  }
});

it('requires a deadline within the Node timer range', () => {
  expect(() => createDidWebResolver({ allowedOrigins: [origin], timeoutMs: 2_147_483_648 })).toThrow('Invalid DID resolution limits');
});
