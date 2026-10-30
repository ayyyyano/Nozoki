<script setup lang="ts">
import type { DashboardSnapshots, ModuleConfig } from '../../../shared/contracts/dashboard'
import { createFixture, SCENARIOS, type Scenario } from '../../../tests/fixtures/dashboard'
const data = defineModel<DashboardSnapshots>('data', { required: true })
const modules = defineModel<ModuleConfig[]>('modules', { required: true })
const scenario = ref<Scenario>('unconfigured')
const displayMode = useState<'dashboard' | 'wallpaper'>('nozoki-display-mode')
const preview = useTemplateRef<HTMLDetailsElement>('preview')
watch(displayMode, (value) => {
  if (value === 'wallpaper' && preview.value) preview.value.open = false
})
const dxDevelopment = inject<{
  dx: Ref<{
    play(initialization?: () => Promise<unknown>): Promise<unknown>
    cancel(): void
    resources: { timers: number; frames: number; listeners: number }
    phase: string
  } | null>
  dxMounted: Ref<boolean>
}>('dxDevelopment')
const background = useState<'loading' | 'loaded' | 'failed' | 'off'>('nozoki-background-state')
if (import.meta.client) {
  onMounted(() => {
    let retired: NonNullable<typeof dxDevelopment>['dx']['value']
    // Deliberately absent from production: browser tests can inspect ownership and interruption.
    Object.defineProperty(window, '__NOZOKI_DX_DEV__', {
      configurable: true,
      value: {
        play: (fail = false) =>
          dxDevelopment?.dx.value?.play(
            fail
              ? async () => {
                  throw new Error('development initialization test')
                }
              : undefined,
          ),
        background: (state: 'loading' | 'loaded') => {
          background.value = state
        },
        cancel: () => dxDevelopment?.dx.value?.cancel(),
        mount: (value: boolean) => {
          if (dxDevelopment) {
            if (!value) retired = dxDevelopment.dx.value
            dxDevelopment.dxMounted.value = value
          }
        },
        stats: () => ({
          ...(dxDevelopment?.dx.value ?? retired)?.resources,
          phase: dxDevelopment?.dx.value?.phase ?? 'unmounted',
        }),
      },
    })
  })
  onBeforeUnmount(() => {
    Reflect.deleteProperty(window, '__NOZOKI_DX_DEV__')
  })
}
watch(scenario, (value) => {
  data.value = createFixture(value)
})
</script>
<template>
  <details ref="preview" class="fixture-preview">
    <summary>
      开发预览 · {{ scenario === 'unconfigured' ? '未配置' : '演示数据，非真实状态' }}
    </summary>
    <div class="fixture-controls">
      <label
        >数据场景<VarSelect
          v-model="scenario"
          aria-label="开发数据场景"
          variant="outlined"
          size="small"
        >
          <VarOption
            v-for="value in SCENARIOS"
            :key="value"
            :value="value"
            :label="value"
          /> </VarSelect
      ></label>
      <div class="fixture-toggles">
        <label v-for="module in modules" :key="module.id"
          ><VarSwitch v-model="module.enabled" :aria-label="module.title" />{{
            module.title
          }}</label
        >
      </div>
      <VarButton
        size="small"
        text
        @click="modules = modules.toReversed().map((m, i) => ({ ...m, sortOrder: i }))"
        >反转展示顺序</VarButton
      >
      <p>本面板仅在 pnpm dev 中存在。此处控制布局，不模拟正式登录或权限。</p>
    </div>
  </details>
</template>
