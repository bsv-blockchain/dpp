import { lookup } from 'node:dns/promises';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { Agent } from 'undici';
import { isPrivateHost } from './private-host.js';

// In addition to the private and local ranges checked by isPrivateHost, exclude
// special-purpose IPv4 destinations and restrict IPv6 to ordinary global unicast.
const specialV4 = new BlockList();
for (const [address, prefix] of [
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.31.196.0', 24],
  ['192.52.193.0', 24], ['192.88.99.0', 24], ['192.175.48.0', 24],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
] as const) specialV4.addSubnet(address, prefix, 'ipv4');

const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const specialV6 = new BlockList();
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['2620:4f:8000::', 48], ['3fff::', 20],
] as const) specialV6.addSubnet(address, prefix, 'ipv6');

/** Node connects directly to an IP literal, so apply this check before passing a URL to the transport. */
export function assertPublicDidHost(hostname: string): void {
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  const family = isIP(host);
  if (isPrivateHost(host) || host === 'home.arpa' || host.endsWith('.home.arpa') ||
      (family === 0 && !host.includes('.')) ||
      (family === 4 && specialV4.check(host, 'ipv4')) ||
      (family === 6 && (host.includes('%') || !globalV6.check(host, 'ipv6') || specialV6.check(host, 'ipv6')))) {
    throw new Error('DID destination is not permitted by address policy');
  }
}

/** Supply the checked DNS answers directly to the connecting socket. TLS still authenticates the original hostname. */
export const lookupPublicDidHost: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true }).then(answers => {
    for (const { address, family } of answers) {
      if ((family !== 4 && family !== 6) || isIP(address) !== family) throw new Error('Invalid DID address policy lookup result');
      assertPublicDidHost(address);
    }
    const family = options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : options.family;
    const selected = family ? answers.filter(answer => answer.family === family) : answers;
    if (selected.length === 0) throw new Error('No DID destination satisfies the address policy');
    return selected;
  }).then(selected => {
    if (options.all) callback(null, selected);
    else callback(null, selected[0].address, selected[0].family);
  }, error => callback(error, []));
};

export function createDidWebDispatcher(maxBytes: number, signal: AbortSignal): Agent {
  return new Agent({ maxResponseSize: maxBytes, connect: { lookup: lookupPublicDidHost, signal } });
}
