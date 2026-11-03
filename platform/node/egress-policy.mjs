import { isIP } from 'node:net'

function addressBits(address) {
  const family = isIP(address)
  if (family === 4)
    return {
      family,
      bits: address.split('.').reduce((n, b) => (n << 8n) + BigInt(b), 0n),
      width: 32n,
    }
  if (family !== 6 || address.includes('%')) throw new Error('DESTINATION_BLOCKED')
  let value = address.toLowerCase()
  if (value.includes('.')) {
    const at = value.lastIndexOf(':')
    const v4 = addressBits(value.slice(at + 1)).bits
    value = value.slice(0, at) + ':' + (v4 >> 16n).toString(16) + ':' + (v4 & 65535n).toString(16)
  }
  const sides = value.split('::'),
    left = sides[0] ? sides[0].split(':') : [],
    right = sides[1] ? sides[1].split(':') : []
  const groups =
    sides.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
      : left
  return { family, bits: groups.reduce((n, g) => (n << 16n) + BigInt('0x' + g), 0n), width: 128n }
}
export function inCidr(address, cidr) {
  const [root, length] = cidr.split('/'),
    a = addressBits(address),
    b = addressBits(root),
    prefix = Number(length)
  if (!/^\d+$/.test(length ?? '') || prefix < 0 || prefix > Number(a.width))
    throw new Error('INVALID_PRIVATE_CIDR')
  return (
    a.family === b.family &&
    a.bits >> BigInt(Number(a.width) - prefix) === b.bits >> BigInt(Number(b.width) - prefix)
  )
}
const privateRanges = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7']
const blockedV4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '168.63.129.16/32',
]
const blockedV6 = ['2001::/23', '2001:db8::/32', '2002::/16', '3fff::/20']
export function privateCidrs(value = '') {
  const ranges = value ? value.split(',').map((x) => x.trim()) : []
  if (ranges.length > 32) throw new Error('INVALID_PRIVATE_CIDR')
  for (const cidr of ranges) {
    const [root, prefix] = cidr.split('/'),
      bits = addressBits(root)
    if (
      !privateRanges.some(
        (range) => inCidr(root, range) && Number(prefix) >= Number(range.split('/')[1]),
      ) ||
      !inCidr(root, cidr) ||
      Number(prefix) > Number(bits.width)
    )
      throw new Error('INVALID_PRIVATE_CIDR')
  }
  return ranges
}
export function permittedAddress(address, scope, ranges = []) {
  try {
    const a = addressBits(address)
    if (scope === 'private')
      return privateRanges.some((r) => inCidr(address, r)) && ranges.some((r) => inCidr(address, r))
    if (scope !== 'public') return false
    return a.family === 4
      ? !blockedV4.some((r) => inCidr(address, r))
      : inCidr(address, '2000::/3') && !blockedV6.some((r) => inCidr(address, r))
  } catch {
    return false
  }
}
export async function resolveDestination(hostname, scope, lookup, ranges = []) {
  const host = hostname.replace(/^\[|\]$/g, '')
  const results = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true, verbatim: true })
  if (
    !results.length ||
    results.length > 32 ||
    results.some((r) => !permittedAddress(r.address, scope, ranges) || isIP(r.address) !== r.family)
  )
    throw new Error('DESTINATION_BLOCKED')
  return results[0]
}
