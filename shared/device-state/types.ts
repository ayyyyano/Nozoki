/** Portable normalized device state. No framework, storage, auth or provider dependency. */
export interface DeviceState {
  id: string
  name: string
  using: boolean | null
  online: boolean | null
  stateText: string | null
  foregroundApp?: string | null
  batteryPercent: number | null
  charging: boolean | null
  observedAt: string | null
  statusUpdatedAt?: string | null
}
export function validBattery(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
}
/** Entry point for future sources: no inference between independent capabilities. */
export function normalizeDeviceState(input: DeviceState): DeviceState {
  return {
    id: input.id,
    name: input.name,
    using: typeof input.using === 'boolean' ? input.using : null,
    online: typeof input.online === 'boolean' ? input.online : null,
    stateText: input.stateText ?? null,
    foregroundApp: input.foregroundApp ?? null,
    batteryPercent: validBattery(input.batteryPercent) ? input.batteryPercent : null,
    charging: typeof input.charging === 'boolean' ? input.charging : null,
    observedAt: input.observedAt ?? null,
    statusUpdatedAt: input.statusUpdatedAt ?? null,
  }
}
