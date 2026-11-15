<script setup lang="ts">
import { prepareBackgroundUpload } from '../../utils/background-upload'
import { isHttpsImageUrl, type Appearance } from '../../../shared/contracts/appearance'
import { isUploadedBackgroundUrl } from '../../../shared/contracts/background-image'
const model = defineModel<Appearance['background']>({ required: true })
const upload = defineModel<{ url: string; data: string } | null>('upload', { default: null })
defineProps<{ disabled?: boolean; preview?: boolean }>()
const emit = defineEmits<{ processing: [value: boolean] }>()
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const processing = ref(false),
  error = ref('')
const customUrl = ref(isHttpsImageUrl(model.value.url) ? model.value.url : '')
const uploadedUrl = ref(isUploadedBackgroundUrl(model.value.url) ? model.value.url : '')
function changeSource(source: Appearance['background']['source']) {
  if (model.value.source === 'custom') customUrl.value = model.value.url
  if (model.value.source === 'uploaded') uploadedUrl.value = model.value.url
  model.value = {
    ...model.value,
    source,
    url: source === 'custom' ? customUrl.value : source === 'uploaded' ? uploadedUrl.value : '',
  }
}
const thumbnail = computed(() =>
  model.value.source === 'uploaded'
    ? upload.value?.url === model.value.url
      ? 'data:image/webp;base64,' + upload.value.data
      : model.value.url
    : null,
)
const previewImage = computed(() =>
  model.value.source === 'builtin'
    ? '/media/wallpaper-glass-picnic.webp'
    : model.value.source === 'custom' && isHttpsImageUrl(model.value.url)
      ? model.value.url
      : thumbnail.value,
)
let generation = 0
onBeforeUnmount(() => {
  generation++
})
async function chooseFile(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  input.value = ''
  if (!file) return
  const current = ++generation,
    target = model.value
  processing.value = true
  emit('processing', true)
  error.value = ''
  try {
    const value = await prepareBackgroundUpload(file)
    if (current !== generation || model.value !== target) return
    upload.value = value
    uploadedUrl.value = value.url
    if (model.value.source === 'custom') customUrl.value = model.value.url
    model.value = { ...model.value, source: 'uploaded', url: value.url }
  } catch (e) {
    if (current === generation)
      error.value = e instanceof Error ? e.message : '图片处理失败，请选择有效图片'
  } finally {
    processing.value = false
    emit('processing', false)
  }
}
function resetImage() {
  generation++
  upload.value = null
  uploadedUrl.value = ''
  if (model.value.source === 'custom') customUrl.value = model.value.url
  model.value = { ...model.value, source: 'builtin', url: '' }
  error.value = ''
}
</script>
<template>
  <section class="admin-appearance-group admin-fields">
    <h3>背景图片</h3>
    <VarSelect
      :disabled="disabled || processing"
      class="admin-background-source"
      :model-value="model.source"
      @update:model-value="changeSource"
      placeholder="背景来源"
      aria-label="背景来源"
      variant="outlined"
      ><VarOption label="关闭" value="off" /><VarOption
        label="内置图片"
        value="builtin" /><VarOption
        v-if="uploadedUrl"
        label="已上传图片"
        value="uploaded" /><VarOption label="HTTPS 图片" value="custom"
    /></VarSelect>
    <AdminText v-if="model.source === 'custom'" v-model="model.url" label="背景 HTTPS 地址" />
    <div class="admin-background-upload">
      <input
        ref="fileInput"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="选择站点背景图片"
        hidden
        @change="chooseFile"
      />
      <div class="admin-background-actions">
        <VarButton
          tonal
          type="primary"
          :loading="processing"
          :disabled="disabled || processing"
          @click="fileInput?.click()"
          >上传背景图片</VarButton
        >
        <VarButton
          tonal
          :disabled="disabled || processing || model.source === 'builtin'"
          @click="resetImage"
          >恢复内置背景</VarButton
        >
      </div>
      <p>PNG、JPEG、WebP，最大 10 MB。</p>
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      <img
        v-if="thumbnail"
        :src="thumbnail"
        alt="站点背景预览"
        class="admin-background-thumbnail"
      />
    </div>
    <template v-if="model.source !== 'off'">
      <VarSelect
        v-model="model.layout"
        placeholder="背景布局"
        aria-label="背景布局"
        variant="outlined"
        ><VarOption label="整页背景" value="page" /><VarOption label="顶部横幅" value="banner"
      /></VarSelect>
      <VarSelect v-model="model.fit" placeholder="图片适配" aria-label="图片适配" variant="outlined"
        ><VarOption label="铺满" value="cover" /><VarOption label="完整显示" value="contain"
      /></VarSelect>
      <CommonSettingSlider v-model="model.x" label="水平位置" />
      <CommonSettingSlider v-model="model.y" label="垂直位置" />
      <CommonSettingSlider v-model="model.overlay" label="背景遮罩" />
    </template>
    <div
      v-if="preview"
      class="admin-appearance-preview"
      :data-layout="model.source === 'off' ? 'off' : model.layout"
      role="img"
      aria-label="看板背景与卡片效果预览"
    >
      <div v-if="previewImage" class="admin-appearance-image">
        <img
          :src="previewImage"
          alt=""
          referrerpolicy="no-referrer"
          :style="{ objectFit: model.fit, objectPosition: `${model.x}% ${model.y}%` }"
        />
        <span :style="{ opacity: model.overlay / 100 }" />
      </div>
      <div
        class="admin-appearance-cards"
        aria-hidden="true"
        :style="{
          '--preview-opacity': `${model.cardOpacity}%`,
          '--preview-blur': `blur(${model.cardBlur}px)`,
        }"
      >
        <i v-for="index in 3" :key="index" />
      </div>
    </div>
  </section>
  <section v-if="model.source !== 'off'" class="admin-appearance-group admin-fields">
    <h3>卡片效果</h3>
    <CommonSettingSlider v-model="model.cardOpacity" label="卡片不透明度" />
    <CommonSettingSlider v-model="model.cardBlur" label="卡片背景模糊" :max="20" unit="px" />
  </section>
</template>
