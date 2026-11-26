import type { LookupAddress, LookupOptions } from 'node:dns';
import { describe, expect, it, vi } from 'vitest';
import { fetch as undiciFetch } from 'undici';
import { assertPublicDidHost, createDidWebDispatcher, lookupPublicDidHost } from '../src/did-web-transport.js';

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup }));

function socketAddresses(options: LookupOptions): Promise<string | LookupAddress[]> {
  return new Promise((resolve, reject) => {
    lookupPublicDidHost('issuer.example', options, (error, address) => {
      if (error) reject(error);
      else resolve(address);
    });
  });
}

describe('DID destination address policy', () => {
  it.each(['issuer.example', '8.8.8.8', '[2606:4700:4700::1111]'])('permits a public destination %s', (host) => {
    expect(() => assertPublicDidHost(host)).not.toThrow();
  });

  it.each([
    'localhost.', 'vault.internal', 'service.local', 'router.home.arpa',
    '127.0.0.1', '10.0.0.1', '100.64.0.1', '169.254.1.1', '192.0.2.1',
    '198.18.0.1', '203.0.113.1', '224.0.0.1', '[::1]', '[fc00::1]',
    '[fe80::1]', '[ff02::1]', '[::ffff:127.0.0.1]', '[64:ff9b::1]',
    '[2001:db8::1]', '[2002::1]', '[3fff::1]',
  ])('refuses the local or special-use destination %s before dispatch', (host) => {
    expect(() => assertPublicDidHost(host)).toThrow('address policy');
  });

  it('passes only the checked DNS answer to the socket', async () => {
    const addresses = [{ address: '2606:4700:4700::1111', family: 6 }, { address: '8.8.8.8', family: 4 }];
    lookup.mockReset().mockResolvedValueOnce(addresses);
    await expect(socketAddresses({ all: true })).resolves.toEqual(addresses);
    expect(lookup.mock.calls).toEqual([['issuer.example', { all: true }]]);
  });

  it('supports a single address and requested address families', async () => {
    const addresses = [{ address: '2606:4700:4700::1111', family: 6 }, { address: '8.8.8.8', family: 4 }];
    lookup.mockReset().mockResolvedValue(addresses);
    await expect(socketAddresses({ family: 4 })).resolves.toBe('8.8.8.8');
    await expect(socketAddresses({ all: true, family: 'IPv6' })).resolves.toEqual([addresses[0]]);
  });

  it('requires every answer to pass the address policy before applying a family selection', async () => {
    lookup.mockReset().mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: 'fd00::1', family: 6 }]);
    await expect(socketAddresses({ family: 4 })).rejects.toThrow('address policy');
  });

  it('uses the checked lookup in the actual HTTPS dispatcher', async () => {
    lookup.mockReset().mockResolvedValueOnce([{ address: '192.0.2.1', family: 4 }]);
    const dispatcher = createDidWebDispatcher(1024, new AbortController().signal);
    try {
      await expect(undiciFetch('https://issuer.invalid/.well-known/did.json', { dispatcher }))
        .rejects.toMatchObject({ cause: { message: 'DID destination is not permitted by address policy' } });
      expect(lookup.mock.calls).toEqual([['issuer.invalid', { all: true }]]);
    } finally {
      await dispatcher.destroy();
    }
  });

  it('aborts the connecting TLS socket while the address lookup is outstanding', async () => {
    let finishLookup!: (addresses: LookupAddress[]) => void;
    const pendingLookup = new Promise<LookupAddress[]>(resolve => { finishLookup = resolve; });
    lookup.mockReset().mockReturnValueOnce(pendingLookup);
    const controller = new AbortController();
    const dispatcher = createDidWebDispatcher(1024, controller.signal);
    // The connection gets the signal independently of fetch.
    let failure: unknown;
    const request = undiciFetch('https://issuer.invalid/', { dispatcher }).catch(error => { failure = error; });
    try {
      await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce());
      controller.abort();
      await vi.waitFor(() => expect(failure).toMatchObject({ cause: { cause: { code: 'ABORT_ERR' } } }));
    } finally {
      finishLookup([]);
      await dispatcher.destroy();
      await request;
    }
  });

  it('refuses empty, malformed and family-inconsistent results', async () => {
    for (const answer of [[], [{ address: 'issuer.example', family: 4 }], [{ address: '8.8.8.8', family: 6 }]]) {
      lookup.mockReset().mockResolvedValueOnce(answer);
      await expect(socketAddresses({})).rejects.toThrow('address policy');
    }
    lookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]);
    await expect(socketAddresses({ family: 6 })).rejects.toThrow('address policy');
  });
});
