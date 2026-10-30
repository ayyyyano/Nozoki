import type { DxPhase, DxResult } from '../domain/dx-transition'
export interface DxBootSnapshot {
  phase: DxPhase
  timers: number
  frames: number
  listeners: number
}
export interface DxBoot {
  readonly done: Promise<DxResult>
  snapshot(): DxBootSnapshot
  subscribe(listener: (snapshot: DxBootSnapshot) => void): () => void
  ready(): void
  cancel(): void
}
export type DxBootWindow = Window & {
  __NOZOKI_DX_BOOT__?: DxBoot
  __NOZOKI_DX_APP_MOUNTED__?: boolean
  __NOZOKI_DX_CURTAIN__?: {
    readonly element: HTMLDivElement
    claim(): HTMLDivElement | null
    cancel(): void
  }
}
