import type { Adapter } from './types.ts'
import { AdapterError } from './types.ts'
import { cap, putView, sourceResult, staleAt } from './common.ts'
import { normalizeTailscaleDevices } from '../../shared/tailscale/index.ts'
import { hashToken } from '../services/auth-crypto.ts'

export const tailscale: Adapter = {
  provider: 'tailscale',
  versions: ['tailscale-devices-v2'],
  expectedCapabilities: ['devices', 'connection', 'addresses'],
  probe(context) {
    return this.read(context)
  },
  async read(context) {
    const response = await context.transport.get('api/v2/tailnet/-/devices')
    let devices
    try {
      devices = normalizeTailscaleDevices(response.value)
    } catch {
      throw new AdapterError('INVALID_RESPONSE')
    }
    for (const device of devices) {
      if (device.lastSeen && Date.parse(device.lastSeen) > context.now.getTime() + 60000)
        throw new AdapterError('INVALID_RESPONSE')
      device.id = await hashToken(JSON.stringify(['tailscale', context.source.id, device.id]))
    }
    const result = sourceResult(context, {
      devices: cap(true, true),
      connection: cap(true, true),
      addresses: cap(true, true),
    })
    // No upstream snapshot timestamp exists. collectedAt remains the local collection time.
    result.status = staleAt(null, context, response.ageSeconds) ? 'stale' : 'ok'
    result.items = devices.length
    putView(result, 'tailscale', { devices })
    return result
  },
}
