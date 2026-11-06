<script setup lang="ts">
import { prepareBackgroundUpload } from '../../utils/background-upload'
import type { Appearance } from '../../../shared/contracts/appearance'
const model = defineModel<Appearance['background']>({ required: true })
const upload = defineModel<{ url: string; data: string } | null>('upload', { default: null })
defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ processing: [value: boolean] }>()
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const processing = ref(false),
  error = ref('')
const thumbnail = computed(() =>
  model.value.source === 'uploaded'
    ? upload.value?.url === model.value.url
      ? 'data:image/webp;base64,' + upload.value.data
      : model.value.url
    : null,
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
  model.value = { ...model.value, source: 'builtin', url: '' }
  error.value = ''
}
</script>
<template>
  <div class="admin-fields">
    <VarSelect
      :disabled="disabled || processing"
      class="admin-background-source"
      v-model="model.source"
      placeholder="背景来源"
      aria-label="背景来源"
      variant="outlined"
      ><VarOption label="关闭" value="off" /><VarOption
        label="内置图片"
        value="builtin" /><VarOption
        v-if="model.source === 'uploaded'"
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
      <p>共享默认背景对所有访客生效。选择图片后点击“保存配置”；恢复内置背景也需保存。</p>
      <p>支持 PNG、JPEG、WebP，最大 10 MB；自动缩放压缩为不超过 512 KB 的静态图片。</p>
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      <img
        v-if="thumbnail"
        :src="thumbnail"
        alt="站点背景预览"
        class="admin-background-thumbnail"
      />
    </div>
    <VarSelect
      v-model="model.layout"
      placeholder="背景布局"
      aria-label="背景布局"
      variant="outlined"
      ><VarOption label="整页背景" value="page" /><VarOption label="顶部横幅" value="banner"
    /></VarSelect>
    <VarSelect v-model="model.fit" placeholder="图片适配" aria-label="图片适配" variant="outlined"
      ><VarOption label="cover" value="cover" /><VarOption label="contain" value="contain"
    /></VarSelect>
    <CommonSettingSlider v-model="model.x" label="共享水平位置" />
    <CommonSettingSlider v-model="model.y" label="共享垂直位置" />
    <CommonSettingSlider v-model="model.overlay" label="共享遮罩深浅" />
    <CommonSettingSlider v-model="model.cardOpacity" label="共享卡片不透明度" />
    <CommonSettingSlider v-model="model.cardBlur" label="共享卡片背景模糊" :max="20" unit="px" />
  </div>
</template>
