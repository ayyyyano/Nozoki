import names from './material-names.json' with { type: 'json' }
const catalog = new Set<string>(names)
export const MATERIAL_ALIASES: Record<string, string> = {
  eye: 'VisibilityRound',
  eyeOff: 'VisibilityOffRound',
  spark: 'AutoAwesomeRound',
  devices: 'DevicesRound',
  code: 'CodeRound',
  clock: 'ScheduleRound',
  chart: 'ShowChartRound',
  book: 'MenuBookRound',
  link: 'LinkRound',
  server: 'DnsRound',
  home: 'HomeRound',
  person: 'PersonRound',
  tune: 'TuneRound',
  close: 'CloseRound',
  arrow: 'ArrowForwardRound',
  battery: 'BatteryFullRound',
  bolt: 'BoltRound',
  alert: 'WarningRound',
  moon: 'DarkModeRound',
  sun: 'LightModeRound',
  check: 'CheckRound',
  menu: 'MenuRound',
  save: 'SaveRound',
  more: 'MoreVertRound',
  logout: 'LogOutRound',
  undo: 'UndoRound',
}
export function materialIconName(value: string): string | null {
  if (catalog.has(value)) return value
  if (Object.hasOwn(MATERIAL_ALIASES, value)) return MATERIAL_ALIASES[value]!
  const source = value.replace(/^ms:/, '')
  if (!/^[a-z0-9_]{1,90}$/.test(source)) return null
  const candidate =
    source
      .split('_')
      .map((s) => s[0]?.toUpperCase() + s.slice(1))
      .join('') + 'Round'
  return catalog.has(candidate) ? candidate : null
}
export const isMaterialLinkIcon = (value: string) => materialIconName(value) !== null
