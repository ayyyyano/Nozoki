<script setup lang="ts">
import type { Appearance } from '../../../shared/contracts/appearance'
import { DEFAULT_APPEARANCE, isHttpsImageUrl } from '../../../shared/contracts/appearance'
import { COLOR_PRESETS, parseSourceColor } from '../../../shared/domain/color-input'
const model = defineModel<Appearance>({ required: true })
const previewSource = defineModel<string | null>('previewSource', { default: null })
defineProps<{ storageFailed: boolean }>()
const show = ref(false)
const panel = useTemplateRef<HTMLElement>('panel')
const urlDraft = ref('')
const urlError = ref('')
const colorDraft = ref('')
const colorError = computed(() =>
  colorDraft.value && !parseSourceColor(colorDraft.value)
    ? '请输入 #RRGGBB 或 rgb(0–255, 0–255, 0–255)'
    : '',
)
const originalColor = ref('')
function previewColor() {
  const color = parseSourceColor(colorDraft.value)
  if (color) previewSource.value = color
}
function saveColor() {
  const color = parseSourceColor(colorDraft.value)
  if (color) {
    model.value.sourceColor = color
    previewSource.value = null
    originalColor.value = color
    colorDraft.value = color
  }
}
function cancelColor() {
  previewSource.value = null
  colorDraft.value = model.value.sourceColor
}
function chooseColor(color: string) {
  model.value.sourceColor = color
  previewSource.value = null
  originalColor.value = color
  colorDraft.value = color
}
watch(show, (value) => {
  if (!value) previewSource.value = null
})
const { restoreFocus } = useModalFocus(show, panel)
function open() {
  colorDraft.value = model.value.sourceColor
  originalColor.value = model.value.sourceColor
  urlDraft.value = model.value.background.url
  urlError.value = ''
  show.value = true
}
function applyUrl() {
  if (!isHttpsImageUrl(urlDraft.value)) {
    urlError.value = '请输入不含用户名或密码的 HTTPS 图片地址'
    return
  }
  model.value.background.url = urlDraft.value
  model.value.background.source = 'custom'
  urlError.value = ''
}
const resetPersonal = inject<() => void>('resetPersonalAppearance')
function reset() {
  previewSource.value = null
  if (resetPersonal) resetPersonal()
  else model.value = structuredClone(DEFAULT_APPEARANCE)
  urlDraft.value = ''
  colorDraft.value = model.value.sourceColor
  originalColor.value = model.value.sourceColor
  urlError.value = ''
}
defineExpose({ open })
</script>
<template>
  <VarPopup
    v-model:show="show"
    position="center"
    :default-style="false"
    :close-on-key-escape="true"
    class="appearance-popup"
    aria-labelledby="appearance-title"
    @closed="restoreFocus"
  >
    <section ref="panel" class="appearance-dialog" tabindex="-1">
      <header>
        <div>
          <h2 id="appearance-title">外观偏好</h2>
          <p>仅保存在当前浏览器</p>
        </div>
        <VarButton text round aria-label="关闭外观偏好" @click="show = false"
          ><CommonAppIcon name="close"
        /></VarButton>
      </header>
      <div class="settings-body">
        <fieldset class="palette-settings">
          <legend>主题源色</legend>
          <div class="palette-presets">
            <VarButton
              v-for="preset in COLOR_PRESETS"
              :key="preset.color"
              text
              round
              :aria-label="preset.name"
              :title="preset.name"
              :aria-pressed="model.sourceColor === preset.color"
              :style="{ '--swatch': preset.color }"
              @click="chooseColor(preset.color)"
            >
              <span class="palette-swatch"
                ><CommonAppIcon v-if="model.sourceColor === preset.color" name="check" :size="20"
              /></span>
            </VarButton>
          </div>
          <VarInput
            v-model="colorDraft"
            aria-label="自定义主题源色"
            placeholder="#RRGGBB / rgb(r, g, b)"
            variant="outlined"
            size="small"
            @keydown.enter.prevent="saveColor"
          />
          <p v-if="colorError" class="field-error" role="alert">{{ colorError }}</p>
          <div class="palette-actions">
            <VarButton
              text
              size="small"
              :disabled="!!colorError || !colorDraft"
              @click="previewColor"
              >预览配色</VarButton
            >
            <VarButton text size="small" :disabled="!!colorError || !colorDraft" @click="saveColor"
              >保存配色</VarButton
            >
            <VarButton text size="small" @click="cancelColor">撤销预览</VarButton>
          </div>
        </fieldset>
        <div class="settings-row">
          <VarSelect
            v-model="model.background.source"
            variant="outlined"
            size="small"
            placeholder="背景来源"
            aria-label="背景来源"
            ><VarOption label="关闭" value="off" /><VarOption
              label="内置图片"
              value="builtin" /><VarOption
              v-if="model.background.source === 'uploaded'"
              label="站点上传图片"
              value="uploaded" /><VarOption label="自定义 HTTPS 图片" value="custom"
          /></VarSelect>
          <VarSelect
            v-model="model.background.layout"
            variant="outlined"
            size="small"
            placeholder="展示方式"
            aria-label="展示方式"
            :disabled="model.background.source === 'off'"
            ><VarOption label="整页背景" value="page" /><VarOption label="顶部横幅" value="banner"
          /></VarSelect>
        </div>
        <template v-if="model.background.source !== 'off'">
          <div v-if="model.background.source === 'custom'" class="url-control">
            <VarInput
              v-model="urlDraft"
              variant="outlined"
              size="small"
              placeholder="HTTPS 图片地址"
              aria-label="HTTPS 图片地址"
              :rules="urlError ? [() => urlError] : []"
              @keydown.enter.prevent="applyUrl"
            />
            <p v-if="urlError" class="field-error" role="alert">{{ urlError }}</p>
            <VarButton type="primary" text size="small" @click="applyUrl">应用图片地址</VarButton>
          </div>
          <VarSelect
            v-model="model.background.fit"
            variant="outlined"
            size="small"
            placeholder="图片适配"
            aria-label="图片适配"
            ><VarOption label="cover · 铺满" value="cover" /><VarOption
              label="contain · 完整显示"
              value="contain"
          /></VarSelect>
          <div class="settings-row">
            <CommonSettingSlider
              v-model="model.background.x"
              label="水平位置"
            /><CommonSettingSlider v-model="model.background.y" label="垂直位置" />
          </div>
          <CommonSettingSlider v-model="model.background.overlay" label="遮罩深浅" />
          <template v-if="model.background.layout === 'page'">
            <div class="settings-row">
              <CommonSettingSlider
                v-model="model.background.cardOpacity"
                label="卡片不透明度"
              /><CommonSettingSlider
                v-model="model.background.cardBlur"
                label="卡片背景模糊"
                :max="20"
                unit="px"
              />
            </div>
            <p v-if="model.background.cardOpacity < 35" class="settings-note" role="status">
              低不透明度可能影响文字对比度，请结合背景调整遮罩。
            </p>
          </template>
        </template>
        <div class="switch-row">
          <label id="motion-label">减少动态效果</label
          ><VarSwitch v-model="model.reduceMotion" aria-labelledby="motion-label" />
        </div>
        <p v-if="storageFailed" class="settings-note" role="status">
          浏览器存储不可用，当前设置仍然生效。
        </p>
      </div>
      <footer>
        <VarButton text @click="reset">恢复默认</VarButton
        ><VarButton type="primary" @click="show = false">完成</VarButton>
      </footer>
    </section>
  </VarPopup>
</template>
