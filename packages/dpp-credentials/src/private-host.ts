function isPrivateV4(a: number, b: number, c: number, d: number): boolean {
  if (a > 255 || b > 255 || c > 255 || d > 255) return true;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

/** The eight groups of an IPv6 literal, with an IPv4 tail folded in. Undefined when it does not parse. */
function ipv6Groups(host: string): number[] | undefined {
  let text = host;
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (tail != null) {
    const octets = tail.slice(1, 5).map(Number);
    if (octets.some((octet) => octet > 255)) return undefined;
    text = `${text.slice(0, tail.index)}${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] === '' ? [] : halves[0]!.split(':');
  const rest = halves.length === 2 ? (halves[1] === '' ? [] : halves[1]!.split(':')) : undefined;
  if (rest != null && head.length + rest.length > 7) return undefined;
  const parts = rest == null ? head : [...head, ...new Array<string>(8 - head.length - rest.length).fill('0'), ...rest];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return undefined;
  return parts.map((part) => parseInt(part, 16));
}

function isPrivateV6(g: number[]): boolean {
  const zeroTo = (n: number): boolean => g.slice(0, n).every((group) => group === 0);
  if (zeroTo(7) && (g[7] === 0 || g[7] === 1)) return true;
  if ((g[0]! & 0xfe00) === 0xfc00 || (g[0]! & 0xffc0) === 0xfe80) return true;
  // An IPv4 address carried inside an IPv6 one is held to the IPv4 rule.
  const mapped = zeroTo(5) && g[5] === 0xffff;
  const compatible = zeroTo(6);
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((group) => group === 0);
  if (mapped || compatible || nat64) return isPrivateV4(g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8, g[7]! & 0xff);
  return false;
}

/** Whether a host is a private, loopback, link-local or otherwise non-public address, by literal or by reserved name. */
export function isPrivateHost(rawHost: string): boolean {
  const host = rawHost.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4 != null) return isPrivateV4(Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4]));
  if (host.includes(':')) { const groups = ipv6Groups(host); return groups == null ? true : isPrivateV6(groups); }
  return false;
}
