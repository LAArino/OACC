// SPDX-License-Identifier: EUPL-1.2
/**
 * Outbound address policy of the harvester (spec §6.2.6): only public unicast
 * addresses. `allowInsecure` (OECP_ALLOW_INSECURE_PARTNER_HTTP, development only)
 * additionally admits loopback, private (RFC 1918), CGNAT and ULA ranges so the
 * OEAPI mock on a Docker network can be harvested; link-local (cloud metadata),
 * multicast, unspecified, documentation and other reserved ranges stay refused.
 */
import { BlockList, isIP } from 'node:net';

export type AddressClass =
  | 'public'
  | 'loopback'
  | 'private'
  | 'cgnat'
  | 'ula'
  | 'link_local'
  | 'multicast'
  | 'unspecified'
  | 'reserved'
  | 'invalid';

const RELAXABLE: ReadonlySet<AddressClass> = new Set(['loopback', 'private', 'cgnat', 'ula']);

function list(entries: readonly [string, number, 'ipv4' | 'ipv6'][]): BlockList {
  const blocks = new BlockList();
  for (const [network, prefix, type] of entries) blocks.addSubnet(network, prefix, type);
  return blocks;
}

const V4: readonly [AddressClass, BlockList][] = [
  ['unspecified', list([['0.0.0.0', 8, 'ipv4']])],
  ['loopback', list([['127.0.0.0', 8, 'ipv4']])],
  [
    'private',
    list([
      ['10.0.0.0', 8, 'ipv4'],
      ['172.16.0.0', 12, 'ipv4'],
      ['192.168.0.0', 16, 'ipv4'],
    ]),
  ],
  ['cgnat', list([['100.64.0.0', 10, 'ipv4']])],
  ['link_local', list([['169.254.0.0', 16, 'ipv4']])],
  ['multicast', list([['224.0.0.0', 4, 'ipv4']])],
  [
    'reserved',
    list([
      ['192.0.0.0', 24, 'ipv4'], // IETF protocol assignments
      ['192.0.2.0', 24, 'ipv4'], // TEST-NET-1
      ['198.18.0.0', 15, 'ipv4'], // benchmarking
      ['198.51.100.0', 24, 'ipv4'], // TEST-NET-2
      ['203.0.113.0', 24, 'ipv4'], // TEST-NET-3
      ['240.0.0.0', 4, 'ipv4'], // reserved, broadcast
    ]),
  ],
];

const V6: readonly [AddressClass, BlockList][] = [
  ['unspecified', list([['::', 128, 'ipv6']])],
  ['loopback', list([['::1', 128, 'ipv6']])],
  ['ula', list([['fc00::', 7, 'ipv6']])],
  [
    'link_local',
    list([
      ['fe80::', 10, 'ipv6'],
      ['fec0::', 10, 'ipv6'], // deprecated site-local
    ]),
  ],
  ['multicast', list([['ff00::', 8, 'ipv6']])],
  [
    'reserved',
    list([
      ['::', 96, 'ipv6'], // IPv4-compatible (deprecated)
      ['100::', 64, 'ipv6'], // discard
      ['2001::', 23, 'ipv6'], // IETF protocol assignments incl. Teredo
      ['2001:db8::', 32, 'ipv6'], // documentation
      ['3fff::', 20, 'ipv6'], // documentation
    ]),
  ],
];

/** IPv4 address embedded in IPv4-mapped, NAT64 or 6to4 IPv6 addresses. */
function embeddedIPv4(address: string): string | undefined {
  const lower = address.toLowerCase();
  const dotted = /^(?:::ffff:|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (dotted?.[1]) return dotted[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex?.[1] && hex[2]) return hexPairToIPv4(hex[1], hex[2]);
  const sixToFour = /^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/.exec(lower);
  if (sixToFour?.[1] && sixToFour[2]) return hexPairToIPv4(sixToFour[1], sixToFour[2]);
  return undefined;
}

function hexPairToIPv4(high: string, low: string): string {
  const h = parseInt(high, 16);
  const l = parseInt(low, 16);
  return [h >> 8, h & 0xff, l >> 8, l & 0xff].join('.');
}

export function classifyAddress(address: string): AddressClass {
  const bare = address.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const family = isIP(bare);
  if (family === 4) {
    for (const [cls, blocks] of V4) if (blocks.check(bare, 'ipv4')) return cls;
    return 'public';
  }
  if (family === 6) {
    const v4 = embeddedIPv4(bare);
    if (v4 !== undefined) return isIP(v4) === 4 ? classifyAddress(v4) : 'invalid';
    for (const [cls, blocks] of V6) if (blocks.check(bare, 'ipv6')) return cls;
    return 'public';
  }
  return 'invalid';
}

export function isAllowedAddress(address: string, allowInsecure: boolean): boolean {
  const cls = classifyAddress(address);
  return cls === 'public' || (allowInsecure && RELAXABLE.has(cls));
}
