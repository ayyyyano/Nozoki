import type { Component } from 'vue'
import VisibilityRound from '@vicons/material/es/VisibilityRound.js'
import VisibilityOffRound from '@vicons/material/es/VisibilityOffRound.js'
import AutoAwesomeRound from '@vicons/material/es/AutoAwesomeRound.js'
import DevicesRound from '@vicons/material/es/DevicesRound.js'
import CodeRound from '@vicons/material/es/CodeRound.js'
import ScheduleRound from '@vicons/material/es/ScheduleRound.js'
import ShowChartRound from '@vicons/material/es/ShowChartRound.js'
import MenuBookRound from '@vicons/material/es/MenuBookRound.js'
import LinkRound from '@vicons/material/es/LinkRound.js'
import DnsRound from '@vicons/material/es/DnsRound.js'
import HomeRound from '@vicons/material/es/HomeRound.js'
import PersonRound from '@vicons/material/es/PersonRound.js'
import MailRound from '@vicons/material/es/MailRound.js'
import LockRound from '@vicons/material/es/LockRound.js'
import TuneRound from '@vicons/material/es/TuneRound.js'
import CloseRound from '@vicons/material/es/CloseRound.js'
import ArrowForwardRound from '@vicons/material/es/ArrowForwardRound.js'
import BatteryFullRound from '@vicons/material/es/BatteryFullRound.js'
import BoltRound from '@vicons/material/es/BoltRound.js'
import WarningRound from '@vicons/material/es/WarningRound.js'
import DarkModeRound from '@vicons/material/es/DarkModeRound.js'
import LightModeRound from '@vicons/material/es/LightModeRound.js'
import CheckRound from '@vicons/material/es/CheckRound.js'
import MenuRound from '@vicons/material/es/MenuRound.js'
import SaveRound from '@vicons/material/es/SaveRound.js'
import MoreVertRound from '@vicons/material/es/MoreVertRound.js'
import LogOutRound from '@vicons/material/es/LogOutRound.js'
import UndoRound from '@vicons/material/es/UndoRound.js'
import RestoreRound from '@vicons/material/es/RestoreRound.js'
import HubRound from '@vicons/material/es/HubRound.js'
export const coreIcons: Record<
  string,
  { component: Component; name: string; symbol: string; filled?: Component }
> = {
  eye: { component: VisibilityRound, name: 'VisibilityRound', symbol: 'visibility' },
  eyeOff: { component: VisibilityOffRound, name: 'VisibilityOffRound', symbol: 'visibility_off' },
  spark: { component: AutoAwesomeRound, name: 'AutoAwesomeRound', symbol: 'auto_awesome' },
  devices: { component: DevicesRound, name: 'DevicesRound', symbol: 'devices' },
  network: { component: HubRound, name: 'HubRound', symbol: 'hub' },
  code: { component: CodeRound, name: 'CodeRound', symbol: 'code' },
  clock: { component: ScheduleRound, name: 'ScheduleRound', symbol: 'schedule' },
  chart: { component: ShowChartRound, name: 'ShowChartRound', symbol: 'monitoring' },
  book: { component: MenuBookRound, name: 'MenuBookRound', symbol: 'menu_book' },
  link: { component: LinkRound, name: 'LinkRound', symbol: 'link' },
  server: { component: DnsRound, name: 'DnsRound', symbol: 'dns' },
  home: { component: HomeRound, name: 'HomeRound', symbol: 'home' },
  person: { component: PersonRound, name: 'PersonRound', symbol: 'person', filled: PersonRound },
  mail: { component: MailRound, name: 'MailRound', symbol: 'mail' },
  lock: { component: LockRound, name: 'LockRound', symbol: 'lock' },
  tune: { component: TuneRound, name: 'TuneRound', symbol: 'tune' },
  close: { component: CloseRound, name: 'CloseRound', symbol: 'close' },
  arrow: { component: ArrowForwardRound, name: 'ArrowForwardRound', symbol: 'arrow_forward' },
  battery: { component: BatteryFullRound, name: 'BatteryFullRound', symbol: 'battery_full' },
  bolt: { component: BoltRound, name: 'BoltRound', symbol: 'bolt' },
  alert: { component: WarningRound, name: 'WarningRound', symbol: 'warning' },
  moon: { component: DarkModeRound, name: 'DarkModeRound', symbol: 'dark_mode' },
  sun: { component: LightModeRound, name: 'LightModeRound', symbol: 'light_mode' },
  check: { component: CheckRound, name: 'CheckRound', symbol: 'check' },
  menu: { component: MenuRound, name: 'MenuRound', symbol: 'menu' },
  save: { component: SaveRound, name: 'SaveRound', symbol: 'save' },
  more: { component: MoreVertRound, name: 'MoreVertRound', symbol: 'more_vert' },
  logout: { component: LogOutRound, name: 'LogOutRound', symbol: 'logout' },
  undo: { component: UndoRound, name: 'UndoRound', symbol: 'undo' },
  restore: { component: RestoreRound, name: 'RestoreRound', symbol: 'restore' },
}
