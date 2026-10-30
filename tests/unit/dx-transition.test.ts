import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createDxController,
  type DxEnvironment,
  type DxPhase,
} from '../../shared/domain/dx-transition.ts'
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
function harness(readinessBudgetMs?: number) {
  const phases: DxPhase[] = []
  const timers = new Map<ReturnType<typeof setTimeout>, () => void>()
  const timerDelays: number[] = []
  let serial = 0
  let reduced = false
  let hidden = false
  let listeners = 0
  const pending: { stage: string; finish: () => void }[] = []
  const wait = (stage: string, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const dispose = () => {
        signal.removeEventListener('abort', cancel)
        listeners--
      }
      const cancel = () => {
        dispose()
        reject(signal.reason)
      }
      listeners++
      signal.addEventListener('abort', cancel, { once: true })
      pending.push({
        stage,
        finish: () => {
          if (!signal.aborted) {
            dispose()
            resolve()
          }
        },
      })
    })
  const errors: unknown[] = []
  const env: DxEnvironment = {
    readinessBudgetMs,
    frame: (signal) => wait('frame', signal),
    animate: wait,
    reduced: () => reduced,
    hidden: () => hidden,
    phase: (p) => phases.push(p),
    setTimer: (callback, delay) => {
      timerDelays.push(delay)
      const id = ++serial as unknown as ReturnType<typeof setTimeout>
      timers.set(id, callback)
      return id
    },
    clearTimer: (id) => {
      timers.delete(id)
    },
    report: (error) => errors.push(error),
  }
  const controller = createDxController(env)
  return {
    controller,
    phases,
    timers,
    timerDelays,
    errors,
    pending,
    reduced: () => {
      reduced = true
    },
    hidden: () => {
      hidden = true
    },
    listeners: () => listeners,
    finish: async (stage: string) => {
      const item = pending.find((p) => p.stage === stage)
      assert.ok(item, stage)
      pending.splice(pending.indexOf(item), 1)
      item.finish()
      await flush()
    },
    budget: async () => {
      for (const [id, callback] of [...timers]) {
        timers.delete(id)
        callback()
      }
      await flush()
    },
  }
}
test('early bootstrap can bound client readiness independently of the default budget', async () => {
  for (const [configured, expected] of [
    [undefined, 900],
    [10000, 10000],
  ] as const) {
    const h = harness(configured)
    const run = h.controller.start(() => new Promise(() => {}))
    await flush()
    assert.equal(h.timerDelays[0], expected)
    await h.finish('frame')
    await h.finish('entering')
    assert.equal(h.phases.at(-1), 'holding')
    await h.budget()
    await h.finish('leaving')
    assert.equal(await run, 'complete')
    assert.equal(h.timers.size, 0)
    assert.equal(h.listeners(), 0)
  }
})
test('DX follows all phases and releases resources after explicit completion', async () => {
  const h = harness()
  let ready!: () => void
  const run = h.controller.start(
    () =>
      new Promise<void>((resolve) => {
        ready = resolve
      }),
  )
  await flush()
  await h.finish('frame')
  await h.finish('entering')
  assert.deepEqual(h.phases, ['boot', 'entering', 'holding'])
  ready()
  await flush()
  await h.finish('leaving')
  assert.equal(await run, 'complete')
  assert.deepEqual(h.phases, ['boot', 'entering', 'holding', 'leaving', 'idle'])
  assert.equal(h.timers.size, 0)
  assert.equal(h.listeners(), 0)
})
test('fast readiness still plays entering and leaving without an artificial holding wait', async () => {
  const h = harness()
  const run = h.controller.start(async () => {})
  await flush()
  await h.finish('frame')
  await h.finish('entering')
  await h.finish('leaving')
  assert.equal(await run, 'complete')
  assert.deepEqual(h.phases, ['boot', 'entering', 'leaving', 'idle'])
  assert.equal(h.timers.size, 0)
})
test('reduced motion and a hidden initial document skip overlay creation', async () => {
  for (const mode of ['reduced', 'hidden'] as const) {
    const h = harness()
    h[mode]()
    assert.equal(await h.controller.start(async () => {}), 'skipped')
    assert.deepEqual(h.phases, [])
    assert.equal(h.timers.size, 0)
  }
})
test('duplicate requests share the same promise and do not create additional timers', async () => {
  const h = harness()
  const first = h.controller.start(() => new Promise(() => {}))
  const second = h.controller.start(async () => {})
  assert.equal(first, second)
  await flush()
  assert.equal(h.timers.size, 1)
  h.controller.cancel()
  assert.equal(await first, 'cancelled')
  assert.equal(h.timers.size, 0)
  assert.equal(h.listeners(), 0)
})
test('cancellation during entering releases readiness and animation resources', async () => {
  const h = harness()
  const run = h.controller.start(() => new Promise(() => {}))
  await flush()
  await h.finish('frame')
  h.controller.cancel()
  assert.equal(await run, 'cancelled')
  assert.equal(h.phases.at(-1), 'idle')
  assert.equal(h.listeners(), 0)
  assert.equal(h.timers.size, 0)
})
test('cancelled callbacks cannot overwrite a newly started run', async () => {
  const h = harness()
  const old = h.controller.start(() => new Promise(() => {}))
  await flush()
  h.controller.cancel()
  const next = h.controller.start(() => new Promise(() => {}))
  await flush()
  assert.equal(await old, 'cancelled')
  assert.equal(h.phases.at(-1), 'boot')
  await h.finish('frame')
  assert.equal(h.phases.at(-1), 'boot') // old frame callback is ignored
  await h.finish('frame')
  assert.equal(h.phases.at(-1), 'entering')
  h.controller.cancel()
  await next
  assert.equal(h.timers.size, 0)
})
test('unresolved readiness is bounded and cannot wait on external data indefinitely', async () => {
  const h = harness()
  const run = h.controller.start(() => new Promise(() => {}))
  await flush()
  await h.finish('frame')
  await h.finish('entering')
  await h.budget()
  await h.finish('leaving')
  assert.equal(await run, 'complete')
  assert.equal(h.timers.size, 0)
})
test('readiness rejection falls back to the page and records the error', async () => {
  const h = harness()
  const run = h.controller.start(async () => {
    throw new Error('initialization')
  })
  await flush()
  await h.finish('frame')
  await h.finish('entering')
  await h.finish('leaving')
  assert.equal(await run, 'complete')
  assert.equal(h.errors.length, 1)
  assert.equal(h.phases.at(-1), 'idle')
})
test('frame initialization failure still clears the overlay and budget', async () => {
  let phase: DxPhase = 'idle'
  let cleared = false
  const h = createDxController({
    frame: async () => {
      throw new Error('frame')
    },
    animate: async () => {},
    reduced: () => false,
    hidden: () => false,
    phase: (v) => {
      phase = v
    },
    setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
    clearTimer: () => {
      cleared = true
    },
  })
  assert.equal(await h.start(() => new Promise(() => {})), 'failed')
  assert.equal(phase, 'idle')
  assert.equal(cleared, true)
})
