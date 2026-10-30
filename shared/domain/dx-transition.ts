export type DxPhase = 'idle' | 'boot' | 'entering' | 'holding' | 'leaving'
export type DxResult = 'complete' | 'skipped' | 'cancelled' | 'failed'
export interface DxEnvironment {
  frame(signal: AbortSignal): Promise<void>
  animate(phase: 'entering' | 'leaving', signal: AbortSignal): Promise<void>
  reduced(): boolean
  hidden(): boolean
  phase(value: DxPhase): void
  setTimer(callback: () => void, delay: number): ReturnType<typeof setTimeout>
  clearTimer(timer: ReturnType<typeof setTimeout>): void
  readinessBudgetMs?: number
  report?(error: unknown): void
}

/** No DOM, scroll locks or shared singleton. A run owns its abort scope and readiness budget. */
export function createDxController(env: DxEnvironment) {
  let active: { abort: AbortController; result: Promise<DxResult>; id: number } | null = null
  let sequence = 0
  const cancelled = () => new DOMException('Transition cancelled', 'AbortError')
  function start(ready: () => Promise<unknown>): Promise<DxResult> {
    if (active) return active.result
    if (env.reduced() || env.hidden()) return Promise.resolve('skipped')
    const abort = new AbortController()
    const id = ++sequence
    const { signal } = abort
    const change = (phase: DxPhase) => {
      if (active?.id === id) env.phase(phase)
    }
    // A microtask makes active available before execution and folds duplicate calls into one run.
    const result = Promise.resolve().then(async (): Promise<DxResult> => {
      let timer: ReturnType<typeof setTimeout> | undefined
      let onAbort: (() => void) | undefined
      try {
        if (signal.aborted) throw cancelled()
        change('boot')
        let settled = false
        const readiness = new Promise<void>((resolve, reject) => {
          onAbort = () => reject(cancelled())
          signal.addEventListener('abort', onAbort, { once: true })
          const finish = () => {
            settled = true
            if (timer !== undefined) env.clearTimer(timer)
            timer = undefined
            resolve()
          }
          timer = env.setTimer(finish, env.readinessBudgetMs ?? 900)
          Promise.resolve()
            .then(ready)
            .then(finish, (error) => {
              env.report?.(error)
              finish()
            })
        })
        // Always attach the rejection handler immediately, including cancellation during entering.
        const readyResult = readiness.then(
          () => true,
          () => false,
        )
        await env.frame(signal)
        if (signal.aborted) throw cancelled()
        // Readiness only controls holding; every visible first load plays the short reveal.
        change('entering')
        await env.animate('entering', signal)
        if (signal.aborted) throw cancelled()
        if (!settled) change('holding')
        if (!(await readyResult) || signal.aborted) throw cancelled()
        change('leaving')
        await env.animate('leaving', signal)
        if (signal.aborted) throw cancelled()
        return 'complete'
      } catch (error) {
        if (signal.aborted) return 'cancelled'
        env.report?.(error)
        return 'failed'
      } finally {
        if (timer !== undefined) env.clearTimer(timer)
        if (onAbort) signal.removeEventListener('abort', onAbort)
        abort.abort()
        if (active?.id === id) {
          env.phase('idle')
          active = null
        }
      }
    })
    active = { abort, result, id }
    return result
  }
  function cancel() {
    const run = active
    if (!run) return
    active = null
    run.abort.abort()
    env.phase('idle')
  }
  return {
    start,
    cancel,
    get running() {
      return active !== null
    },
  }
}
