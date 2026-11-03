import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import {
  permittedAddress,
  privateCidrs,
  resolveDestination,
} from '../../platform/node/egress-policy.mjs'
import { createSourceConnector, pinnedHttpsRead } from '../../platform/node/source-connector.mjs'
import { connectorTransport } from '../../server/adapters/source-connector.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import { source } from '../fixtures/adapters.ts'
import { randomToken, hmacKey, mac, hex } from '../../server/services/auth-crypto.ts'

function managed(provider = 'sleepy', mode = 'public', authentication = 'none') {
  const s = source(provider)
  s.baseUrl = 'https://source.example.com/root/'
  s.access = { mode, authentication, approved: true, approvedTarget: null }
  s.access.approvedTarget = sourceTargetKey(s, s.access)
  return s
}
function requestFixture(body = {}, check = () => {}, status = 200) {
  return (url, options, callback) => {
    check(url, options)
    const req = new EventEmitter()
    req.end = () =>
      queueMicrotask(() => {
        const res = new PassThrough()
        res.headers = { 'content-type': 'application/json' }
        res.statusCode = status
        callback(res)
        res.end(JSON.stringify(body))
      })
    return req
  }
}
test('public address policy blocks IPv4, IPv6 and mapped/private/metadata/special destinations', async () => {
  for (const address of [
    '127.0.0.1',
    '0.0.0.0',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.0.1',
    '169.254.169.254',
    '100.100.100.200',
    '168.63.129.16',
    '198.18.0.1',
    '192.0.2.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::7f00:1',
    'fe80::1',
    'fd00::1',
    '2001:db8::1',
    '2002:7f00:1::',
    '2001::1',
    '3fff::1',
  ])
    assert.equal(permittedAddress(address, 'public'), false, address)
  for (const address of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111'])
    assert.equal(permittedAddress(address, 'public'), true, address)
  await assert.rejects(
    resolveDestination('mix.example.com', 'public', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]),
    /DESTINATION_BLOCKED/,
  )
  const ranges = privateCidrs('10.20.0.0/24,fd12::/64')
  assert.equal(permittedAddress('10.20.0.2', 'private', ranges), true)
  for (const ip of ['10.21.0.2', '127.0.0.1', '169.254.1.2', '93.184.216.34'])
    assert.equal(permittedAddress(ip, 'private', ranges), false)
  for (const cidr of ['0.0.0.0/0', '127.0.0.0/8', '10.0.0.0/0', '169.254.0.0/16', '::/0'])
    assert.throws(() => privateCidrs(cidr))
})
test('DNS result is pinned into the actual HTTPS lookup with original SNI and certificate verification', async () => {
  let dns = 0,
    requests = 0
  const s = managed('sleepy', 'public', 'bearer'),
    message = { source: s, endpoint: 'api/meta', symbols: [], credential: 'source-key' }
  const response = await pinnedHttpsRead(message, new AbortController().signal, {
    lookup: async () => {
      dns++
      return [{ address: dns === 1 ? '93.184.216.34' : '127.0.0.1', family: 4 }]
    },
    request: requestFixture({ ok: true }, (url, options) => {
      requests++
      assert.equal(url.href, 'https://source.example.com/root/api/meta')
      assert.equal(options.agent, false)
      assert.equal(options.rejectUnauthorized, true)
      assert.equal(options.servername, 'source.example.com')
      assert.equal(options.headers.Authorization, 'Bearer source-key')
      assert.equal(options.headers.Cookie, undefined)
      options.lookup('source.example.com', {}, (error, address, family) => {
        assert.equal(error, null)
        assert.equal(address, '93.184.216.34')
        assert.equal(family, 4)
      })
    }),
  })
  assert.equal((await response.json()).ok, true)
  assert.equal(dns, 1)
  assert.equal(requests, 1)
  await assert.rejects(
    pinnedHttpsRead(message, new AbortController().signal, {
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      request: () => {
        throw new Error('MUST_NOT_CONNECT')
      },
    }),
    /DESTINATION_BLOCKED/,
  )
})
test('authenticated connector rejects replay, tampering, endpoint escape, private DNS and oversized response', async () => {
  const token = randomToken(),
    s = managed()
  let calls = 0
  const handler = createSourceConnector(token, {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: requestFixture({ ok: true }, () => calls++),
  })
  let signed
  const env = {
    NOZOKI_CONNECTOR_TOKEN: token,
    NOZOKI_SOURCE_CONNECTOR: {
      fetch: async (request) => {
        signed = {
          url: request.url,
          headers: new Headers(request.headers),
          body: await request.clone().text(),
        }
        return handler(request)
      },
    },
  }
  assert.equal((await connectorTransport(s, 'ignored', env).get('api/meta')).value.ok, true)
  assert.equal(calls, 1)
  assert.equal(
    (
      await handler(
        new Request(signed.url, { method: 'POST', headers: signed.headers, body: signed.body }),
      )
    ).status,
    429,
  )
  const modified = new Request(signed.url, {
    method: 'POST',
    headers: signed.headers,
    body: signed.body.replace('api/meta', 'api/other'),
  })
  assert.equal((await handler(modified)).status, 403)
  assert.equal(calls, 1)
  const make = async (value) => {
    const body = JSON.stringify(value),
      time = String(Date.now()),
      nonce = randomToken()
    return new Request('https://connector.invalid/v1/read', {
      method: 'POST',
      body,
      headers: {
        'X-Nozoki-Time': time,
        'X-Nozoki-Nonce': nonce,
        'X-Nozoki-Signature': hex(
          await mac(await hmacKey(token), ['nozoki-connector-v1', time, nonce, body]),
        ),
      },
    })
  }
  assert.equal(
    (await handler(await make({ source: s, endpoint: '../admin', symbols: [] }))).status,
    502,
  )
  assert.equal(calls, 1)
  const blocked = createSourceConnector(token, {
    lookup: async () => [{ address: '169.254.169.254', family: 4 }],
    request: () => {
      calls++
      throw new Error()
    },
  })
  const denied = await blocked(await make({ source: s, endpoint: 'api/meta', symbols: [] }))
  assert.equal(denied.headers.get('X-Nozoki-Connector-Error'), 'DESTINATION_BLOCKED')
  assert.equal(calls, 1)
  const big = createSourceConnector(token, {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: requestFixture({ large: 'x'.repeat(140000) }),
  })
  assert.equal(
    (await big(await make({ source: s, endpoint: 'api/meta', symbols: [] }))).headers.get(
      'X-Nozoki-Connector-Error',
    ),
    'CONNECTOR_UNAVAILABLE',
  )
  const redirect = createSourceConnector(token, {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: requestFixture({}, () => {}, 302),
  })
  await assert.rejects(
    connectorTransport(s, undefined, {
      NOZOKI_CONNECTOR_TOKEN: token,
      NOZOKI_SOURCE_CONNECTOR: { fetch: (r) => redirect(r) },
    }).get('api/meta'),
    /REDIRECT_REJECTED/,
  )
})

test('connector rejects expired signatures and large bodies before DNS, and cancellation fences late DNS', async () => {
  const token = randomToken(),
    s = managed()
  let dns = 0,
    connections = 0,
    completeDns
  const handler = createSourceConnector(token, {
    lookup: () => {
      dns++
      return new Promise((resolve) => (completeDns = resolve))
    },
    request: () => {
      connections++
      throw new Error('MUST_NOT_CONNECT')
    },
  })
  const make = async (time = String(Date.now()), headers = {}) => {
    const body = JSON.stringify({ source: s, endpoint: 'api/meta', symbols: [] }),
      nonce = randomToken()
    return {
      body,
      method: 'POST',
      headers: {
        'X-Nozoki-Time': time,
        'X-Nozoki-Nonce': nonce,
        'X-Nozoki-Signature': hex(
          await mac(await hmacKey(token), ['nozoki-connector-v1', time, nonce, body]),
        ),
        ...headers,
      },
    }
  }
  const url = 'https://connector.invalid/v1/read'
  assert.equal(
    (await handler(new Request(url, await make(String(Date.now() - 60000))))).status,
    403,
  )
  assert.equal(
    (await handler(new Request(url, await make(undefined, { 'Content-Length': '40000' })))).status,
    413,
  )
  assert.equal(dns, 0)
  const abort = new AbortController(),
    pending = handler(new Request(url, { ...(await make()), signal: abort.signal }))
  while (!completeDns) await new Promise((resolve) => setImmediate(resolve))
  abort.abort()
  assert.equal((await pending).status, 502)
  completeDns([{ address: '93.184.216.34', family: 4 }])
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(connections, 0)
})
