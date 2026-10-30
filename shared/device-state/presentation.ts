import { validBattery } from './types.ts'
import type { DeviceState } from './types.ts'

export interface DeviceDisplayOptions {
  status?: boolean
  battery?: boolean
}
/** Text is already authorized by the caller. UI adapters must escape it as ordinary text. */
export function presentDevice(device: DeviceState, options: DeviceDisplayOptions = {}) {
  const text = options.status === false ? null : device.foregroundApp || device.stateText
  const battery =
    options.battery !== false && validBattery(device.batteryPercent) ? device.batteryPercent : null
  return {
    id: device.id,
    name: device.name,
    statusText: text || (device.using === false ? '未在使用' : '状态未知'),
    statusUpdatedAt: device.statusUpdatedAt || device.observedAt,
    batteryPercent: battery,
    batteryLabel: battery === null ? null : `${battery}%`,
    batteryAriaLabel: battery === null ? null : `电量 ${battery}%`,
    batteryLevel:
      battery === null
        ? ('unknown' as const)
        : battery <= 15
          ? ('low' as const)
          : ('normal' as const),
    charging: battery !== null && device.charging === true,
    chargingLabel: battery !== null && device.charging === true ? '充电中' : null,
    // Unknown type remains a generic device; never infer support from the brand or name.
    icon: 'devices' as const,
  }
}
