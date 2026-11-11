import { describe, expect, it } from 'vitest';
import { verifyTemporal } from '../src/temporal.js';
import type { Credential } from '../src/types.js';

const credential = (validFrom: string, validUntil?: string): Credential => ({
  '@context': ['https://www.w3.org/ns/credentials/v2'], type: ['VerifiableCredential'], id: 'urn:uuid:00000000-0000-4000-8000-000000000001',
  issuer: 'did:web:issuer.example', validFrom, ...(validUntil == null ? {} : { validUntil }), credentialSubject: { id: 'urn:example:subject' },
});

describe('verifyTemporal', () => {
  const at = '2026-09-05T12:00:00Z';

  it('verifies a credential whose interval holds the evaluation time, with or without validUntil', () => {
    expect(verifyTemporal(credential('2026-09-05T12:00:00Z'), at).outcome).toBe('verified');
    expect(verifyTemporal(credential('2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z'), at).outcome).toBe('verified');
  });

  it('refuses a credential not yet valid, expired, with an interval that ends before it starts, or with an unreadable time', () => {
    expect(verifyTemporal(credential('2026-09-05T12:00:01Z'), at).issues[0]?.code).toBe('not_yet_valid');
    expect(verifyTemporal(credential('2026-01-01T00:00:00Z', at), at).issues[0]?.code).toBe('expired');
    expect(verifyTemporal(credential('2026-01-01T00:00:00Z', '2025-01-01T00:00:00Z'), at).issues[0]?.code).toBe('expired');
    expect(verifyTemporal(credential('2026-01-01T00:00:00Z', 'not a time'), at).issues[0]?.code).toBe('expired');
    expect(verifyTemporal(credential('not a time'), at).issues[0]?.code).toBe('invalid_time');
    expect(verifyTemporal(credential('2026-01-01T00:00:00Z'), 'not a time').outcome).toBe('invalid');
  });
});
