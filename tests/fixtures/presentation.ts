import { source } from './adapters.ts'
import { snapshot } from '../../shared/domain/dashboard.ts'
import type { CodexData, TailscaleData, ServicesData } from '../../shared/contracts/dashboard.ts'
import { DEFAULT_CODEX_GUEST, DEFAULT_CODEX_SLOTS } from '../../shared/domain/codex-rings.ts'

export const fullCodexPresentation = () => ({
  codex: {
    slots: [...DEFAULT_CODEX_SLOTS] as ['fiveHourRemaining', 'weeklyRemaining'],
    guest: {
      ...DEFAULT_CODEX_GUEST,
      fiveHourRemaining: 'full' as const,
      weeklyRemaining: 'full' as const,
      fiveHourResetProgress: 'full' as const,
      weeklyResetProgress: 'full' as const,
    },
  },
})
export const presentationSources = () => [
  {
    ...source('tailscale'),
    id: 'tail-fixture',
    baseUrl: 'https://api.tailscale.com/',
    protocolVersion: 'tailscale-devices-v2',
  },
  { ...source('cliproxy-bridge'), id: 'cpa-fixture', protocolVersion: 'cliproxy-v8-accounts' },
  { ...source('uptimeflare'), id: 'flare-fixture' },
]
export function presentationSnapshots(now = new Date(), baseline = false) {
  const at = now.toISOString(),
    expires = new Date(now.getTime() + 600000).toISOString()
  function make<T>(id: string, data: T) {
    return {
      ...snapshot('ok', data, id),
      observedAt: at,
      collectedAt: at,
      lastSuccessAt: at,
      expiresAt: expires,
    }
  }
  const tailnet: TailscaleData = {
    devices: Array.from({ length: 10 }, (_, i) => ({
      id: `tail-node-${i}`,
      name:
        i === 2 ? 'SYNTHETIC-NODE-WITH-A-LONG-NAME-THAT-NEEDS-DETAILS' : `SYNTHETIC NODE ${i + 1}`,
      connectedToControl: i % 3 === 0 ? true : i % 3 === 1 ? false : null,
      lastSeen: i % 3 === 1 ? new Date(now.getTime() - 100000).toISOString() : null,
      addresses: [`100.64.${i}.1`, `fd7a:115c:a1e0::${i + 1}`],
    })),
  }
  const codex: CodexData = {
    accounts: Array.from({ length: 3 }, (_, i) => ({
      id: `codex-account-${i}`,
      provider: 'codex',
      state: 'ready',
      disabled: false,
      unavailable: false,
      retryAt: null,
      observedAt: at,
      executionCounts: { success: 10 + i, failed: 0, scope: 'source_runtime', since: null },
    })),
    usage: {
      scope: 'cproxy-queue-v8',
      coverageStart: at,
      days: [
        {
          day: at.slice(0, 10),
          input: 100,
          output: 20,
          reasoning: 5,
          cached: 30,
          total: 120,
          requests: 1,
          failed: 0,
        },
      ],
    },
    estimatedCost: null,
    quota: {
      accounts: Array.from({ length: 3 }, (_, i) => ({
        id: `codex-account-${i}`,
        windows: [
          {
            id: 'secondary',
            label: '次窗口',
            remainingPercent: '77',
            resetAt: new Date(now.getTime() + 150 * 60000).toISOString(),
            observedAt: at,
            basis: 'passive_headers',
            status: 'ok',
            ...(baseline ? {} : { windowMinutes: 300 }),
          },
          {
            id: 'primary',
            label: '主窗口',
            remainingPercent: '93',
            resetAt: new Date(now.getTime() + 5040 * 60000).toISOString(),
            observedAt: at,
            basis: 'passive_headers',
            status: 'ok',
            ...(baseline ? {} : { windowMinutes: 10080 }),
          },
        ],
      })),
    },
    capabilities: {
      accounts: { supported: true, verified: true },
      quota: { supported: true, verified: true },
      usage: { supported: true, verified: true },
      estimatedCost: { supported: false, verified: false },
    },
  }
  const services: ServicesData = {
    monitors: Array.from({ length: 8 }, (_, i) => ({
      id: `flare-fixture/service-${i}`,
      name: i === 1 ? '<em>真实名称</em>' : `服务 ${i + 1}`,
      state: i === 2 ? 'down' : i === 3 ? 'maintenance' : i === 4 ? 'unknown' : 'up',
      latencyMs: i === 4 ? null : 30 + 100 * i,
      checkedAt: at,
      statusPageUrl: null,
      uptimePercent: null,
      capabilities: {},
    })),
  }
  return {
    tailscale: make('tail-fixture', tailnet),
    codex: make('cpa-fixture', codex),
    services: make('flare-fixture', services),
  }
}
