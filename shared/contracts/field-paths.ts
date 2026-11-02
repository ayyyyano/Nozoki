import type { ModuleId } from './dashboard.ts'

// Public DTO address space. Internal source/capability metadata is never addressable.
// Arrays with stable IDs support '*' and '@id'; other arrays only support '*'.
export type FieldNode =
  | null
  | { [field: string]: FieldNode }
  | { array: FieldNode; ids: boolean }
  | { record: FieldNode; keys: 'date' }
const leaf = (...keys: string[]): Record<string, FieldNode> =>
  Object.fromEntries(keys.map((k) => [k, null]))
const array = (node: FieldNode, ids = false): FieldNode => ({ array: node, ids })
const dateRecord = (node: FieldNode): FieldNode => ({ record: node, keys: 'date' })
const schedulePeriod: FieldNode = {
  ...leaf('id', 'name', 'category', 'start', 'end', 'startDayOffset', 'endDayOffset'),
  display: leaf('label', 'showProgress'),
}
const scheduleRule: FieldNode = {
  ...leaf('kind', 'templateId'),
  slots: array(schedulePeriod, true),
}
export const FIELD_MODEL: Record<ModuleId, FieldNode> = {
  deepseek: {
    balances: array(leaf('currency', 'total', 'toppedUp', 'granted')),
    spend: array(leaf('day', 'currency', 'amount')),
  },
  devices: {
    devices: array(
      leaf(
        'id',
        'name',
        'using',
        'stateText',
        'foregroundApp',
        'online',
        'batteryPercent',
        'charging',
        'observedAt',
        'heartbeatAt',
        'statusUpdatedAt',
      ),
      true,
    ),
  },
  tailscale: {
    devices: array(
      { ...leaf('id', 'name', 'connectedToControl', 'lastSeen'), addresses: array(null) },
      true,
    ),
  },
  codex: {
    accounts: array(
      {
        ...leaf('id', 'provider', 'state', 'disabled', 'unavailable', 'retryAt', 'observedAt'),
        executionCounts: leaf('success', 'failed', 'scope', 'since'),
      },
      true,
    ),
    usage: {
      ...leaf('scope', 'coverageStart'),
      days: array(
        leaf('day', 'input', 'output', 'reasoning', 'cached', 'total', 'requests', 'failed'),
      ),
    },
    quota: {
      accounts: array(
        {
          id: null,
          windows: array(
            leaf('id', 'label', 'remainingPercent', 'resetAt', 'observedAt', 'basis', 'status'),
            true,
          ),
        },
        true,
      ),
    },
    estimatedCost: leaf('currency', 'amount', 'basis'),
  },
  activity: {
    schedule: {
      ...leaf(
        'timezone',
        'start',
        'end',
        'lunchStart',
        'lunchEnd',
        'restMode',
        'calendarVersion',
        'version',
        'dstDisambiguation',
      ),
      calendar: dateRecord(leaf('workday', 'name')),
      templates: array({ ...leaf('id', 'name'), slots: array(schedulePeriod, true) }, true),
      weekdays: Object.fromEntries(
        ['1', '2', '3', '4', '5', '6', '7'].map((day) => [day, scheduleRule]),
      ),
      exceptions: dateRecord({ name: null, rule: scheduleRule }),
      override: leaf('text', 'startAt', 'endAt'),
    },
    resolved: leaf('phase', 'label', 'caption', 'targetAt', 'progressPercent', 'restDay'),
    presence: null,
    music: null,
    gaming: null,
  },
  quotes: {
    items: array({
      ...leaf(
        'market',
        'symbol',
        'provider',
        'currency',
        'name',
        'price',
        'previousClose',
        'change',
        'changePercent',
        'amplitudePercent',
        'volume',
        'volumeUnit',
        'asOf',
        'delayedMinutes',
      ),
      history: array(leaf('at', 'close')),
    }),
  },
  links: { items: array(leaf('id', 'title', 'url', 'icon', 'sortOrder'), true) },
  services: {
    monitors: array(
      leaf('id', 'name', 'state', 'latencyMs', 'checkedAt', 'statusPageUrl', 'uptimePercent'),
      true,
    ),
  },
}
export const FIELD_GROUPS: Record<ModuleId, readonly string[]> = {
  deepseek: ['balance', 'balanceBreakdown'],
  devices: ['battery', 'usage', 'stateText'],
  tailscale: [],
  codex: [],
  activity: [],
  quotes: ['quote', 'history'],
  links: [],
  services: ['status', 'latency', 'history'],
}
export function fieldPointer(segments: readonly string[]): string {
  return '/' + segments.map((s) => s.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')
}
/** RFC6901 segments preserve literal dots, slash and tilde in IDs. No percent decoding. */
export function parseFieldPath(module: ModuleId, path: string): string[] | null {
  if (!path || path.length > 2048 || /[\u0000-\u001f\u007f]/.test(path)) return null
  let parts: string[]
  if (path.startsWith('/')) {
    if (/~(?![01])/.test(path)) return null
    parts = path
      .slice(1)
      .split('/')
      .map((s) => s.replaceAll('~1', '/').replaceAll('~0', '~'))
  } else {
    // Legacy simple-ID dot paths remain valid. Ambiguous dotted IDs fail closed.
    if (!/^[a-zA-Z][a-zA-Z0-9]*(?:\.(?:[a-zA-Z][a-zA-Z0-9]*|\*|@[a-zA-Z0-9_-]+))*$/.test(path))
      return null
    parts = path.split('.')
    // A suffix after a legacy @selector could also be part of a dotted ID.
    // Require explicit pointer boundaries instead of guessing the old intent.
    if (parts.some((part, i) => part.startsWith('@') && i < parts.length - 1)) return null
  }
  if (parts.length === 1 && FIELD_GROUPS[module].includes(parts[0]!)) return parts
  let node: FieldNode = FIELD_MODEL[module]
  for (const part of parts) {
    if (node === null) return null
    if ('record' in node && node.keys === 'date') {
      if (part !== '*' && !validDateKey(part)) return null
      node = node.record
    } else if ('array' in node && typeof node.ids === 'boolean') {
      if (part !== '*' && !(node.ids && part.startsWith('@') && part.length > 1)) return null
      node = node.array
    } else {
      if (!Object.hasOwn(node, part)) return null
      node = (node as Record<string, FieldNode>)[part]!
    }
  }
  return parts
}
export function pathPrefix(rule: readonly string[], path: readonly string[]): boolean {
  return (
    rule.length <= path.length &&
    rule.every(
      (part, i) =>
        part === path[i] ||
        (part === '*' &&
          (path[i] === '*' || path[i]?.startsWith('@') || validDateKey(path[i] ?? ''))),
    )
  )
}
function validDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export interface FieldChoice {
  path: string[]
  ids: number[]
  dates: number[]
}
export function fieldChoices(module: ModuleId): FieldChoice[] {
  function walk(
    node: FieldNode,
    path: string[] = [],
    ids: number[] = [],
    dates: number[] = [],
  ): FieldChoice[] {
    const result: FieldChoice[] = path.length ? [{ path, ids, dates }] : []
    if (node === null) return result
    if ('record' in node && node.keys === 'date')
      return [...result, ...walk(node.record, [...path, '*'], ids, [...dates, path.length])]
    if ('array' in node && typeof node.ids === 'boolean')
      return [
        ...result,
        ...walk(node.array, [...path, '*'], node.ids ? [...ids, path.length] : ids, dates),
      ]
    return [
      ...result,
      ...Object.entries(node).flatMap(([key, value]) =>
        walk(value as FieldNode, [...path, key], ids, dates),
      ),
    ]
  }
  return [
    ...new Map(
      [
        ...walk(FIELD_MODEL[module]),
        ...FIELD_GROUPS[module].map((group) => ({ path: [group], ids: [], dates: [] })),
      ].map((choice) => [fieldPointer(choice.path), choice]),
    ).values(),
  ]
}
