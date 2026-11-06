import type { ModuleId } from '../contracts/dashboard.ts'

/** Shared by Dashboard card headings and their admin entries. */
export const MODULE_ICONS: Record<ModuleId, string> = {
  deepseek: 'spark',
  devices: 'devices',
  tailscale: 'network',
  codex: 'code',
  activity: 'clock',
  quotes: 'chart',
  links: 'link',
  services: 'server',
}
