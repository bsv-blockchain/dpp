import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { Agent, getGlobalDispatcher, MockAgent } from 'undici';
import { expect, it, vi } from 'vitest';
import { createExternalDocumentLoader, externalCredentialVerifierFor, verifyExternalCredential } from '../src/exchange.js';
import type { Credential, DocumentLoader, JsonObject } from '../src/types.js';
import { ISSUER, STATUS_LIST } from './exchange-fixture.js';

interface Vector {
  id: string;
  input: {
    credential: string;
    representation: string;
    documents: Record<string, JsonObject>;
    policy: {
      evaluationTime: string;
      expectedSubject: string;
      authority: { id: string; required: true; trustedIssuers: string[] };
      status: { id: string; maxAgeMs: number };
    };
  };
  expected: { sha256: string; checks: Record<string, string> };
}

const file = new URL('../../../fixtures/vectors/dpp/interoperability/external-credential/v1.json', import.meta.url);
const { vectors }: { vectors: Vector[] } = JSON.parse(readFileSync(file, 'utf8'));
const vector = vectors.find(v => v.id === 'positive');
if (!vector) throw new Error('Missing positive external credential vector');
const { input, expected } = vector;
const bytes = new TextEncoder().encode(input.credential);
const origin = 'https://issuer.example';
const path = '/.well-known/did.json';
const pinnedStatus = new Map([[STATUS_LIST, input.documents[STATUS_LIST]]]);

function policy(documentLoader: DocumentLoader) {
  return {
    documentLoader,
    evaluationTime: input.policy.evaluationTime,
    expectedSubject: input.policy.expectedSubject,
    authorityPolicy: input.policy.authority,
    statusPolicy: {
      ...input.policy.status,
      resolve: async (url: string) => (await documentLoader(url)).document as Credential,
    },
  };
}

async function expectVerified(documentLoader: DocumentLoader) {
  const result = await verifyExternalCredential({ bytes, representation: input.representation, policy: policy(documentLoader) });
  expect(result.issuer).toBe(ISSUER);
  expect(result.digest).toBe(expected.sha256);
  expect(Object.fromEntries(Object.entries(result.checks).map(([name, check]) => [name, check.outcome]))).toEqual(expected.checks);
}

async function withIssuerResponse(body: string | Buffer, headers: Record<string, string>, verify: () => Promise<void>) {
  const mock = new MockAgent();
  mock.disableNetConnect();
  const issuer = mock.get(origin);
  issuer.intercept({ method: 'GET', path })
    .reply(200, body, { headers: { 'content-type': 'application/did+ld+json', ...headers } })
    .persist();
  const fallback = vi.spyOn(getGlobalDispatcher(), 'dispatch').mockImplementation(() => {
    throw new Error('Unexpected request through the global dispatcher');
  });
  const dispatch = vi.spyOn(Agent.prototype, 'dispatch').mockImplementation((options, handler) => {
    if (String(options.origin) !== origin) throw new Error('Unexpected origin');
    return issuer.dispatch(options, handler);
  });
  try {
    await verify();
    expect(dispatch).toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  } finally {
    dispatch.mockRestore();
    fallback.mockRestore();
    await mock.close();
  }
}

it('verifies the signed vector from pinned issuer documents without fetching', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('Unexpected network request'); });
  const documents = new Map(Object.entries(input.documents));
  await expectVerified(createExternalDocumentLoader(documents, { didWeb: { allowedOrigins: [origin], fetcher } }));
  expect(fetcher).not.toHaveBeenCalled();
});

it('verifies the same signed bytes using the default DID transport for the issuer and its assertion key', async () => {
  await withIssuerResponse(JSON.stringify(input.documents[ISSUER]), {}, async () => {
    await expectVerified(createExternalDocumentLoader(pinnedStatus, { didWeb: { allowedOrigins: [origin] } }));
  });
});

it('accepts a gzip issuer document at its decoded size and rejects the same response one byte below that limit', async () => {
  const decoded = Buffer.from(JSON.stringify(input.documents[ISSUER]));
  const encoded = gzipSync(decoded);
  expect(encoded.length).toBeLessThan(decoded.length - 1);
  const headers = { 'content-encoding': 'gzip', 'content-length': String(encoded.length) };
  await withIssuerResponse(encoded, headers, async () => {
    const atLimit = createExternalDocumentLoader(pinnedStatus, { didWeb: { allowedOrigins: [origin], maxBytes: decoded.length } });
    await expectVerified(atLimit);
    const belowLimit = createExternalDocumentLoader(pinnedStatus, { didWeb: { allowedOrigins: [origin], maxBytes: decoded.length - 1 } });
    await expect(belowLimit(ISSUER)).rejects.toThrow('size limit');
  });
});

it('reports unknown proof and availability when the configured issuer endpoint is unavailable', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
  const documentLoader = createExternalDocumentLoader(pinnedStatus, { didWeb: { allowedOrigins: [origin], fetcher } });
  const verify = externalCredentialVerifierFor(policy(documentLoader));
  const report = await verify({
    representation: input.representation, bytes: Array.from(bytes), digest: expected.sha256, checkedAt: input.policy.evaluationTime,
  });
  expect(report).toMatchObject({
    issuer: ISSUER,
    proof: { status: 'unknown' },
    availability: { status: 'unknown' },
    schema: { status: 'pass' },
    time: { status: 'pass' },
    authority: { status: 'pass' },
  });
  expect(fetcher).toHaveBeenCalled();
  expect(fetcher.mock.calls.every(([url]) => String(url) === origin + path)).toBe(true);
});
