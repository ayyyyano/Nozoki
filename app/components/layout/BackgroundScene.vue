<script setup lang="ts">
import type { Appearance } from '../../../shared/contracts/appearance'
import { isHttpsImageUrl } from '../../../shared/contracts/appearance'
const props = defineProps<{ config: Appearance['background'] }>()
const loaded = ref(false)
const failed = ref(false)
const clientReady = ref(false)
const image = useTemplateRef<HTMLImageElement>('image')
const readiness = useState<'loading' | 'loaded' | 'failed' | 'off'>(
  'nozoki-background-state',
  () => 'loading',
)
const source = computed(() =>
  props.config.source === 'builtin'
    ? '/media/wallpaper-glass-picnic.webp'
    : props.config.source === 'custom' && isHttpsImageUrl(props.config.url)
      ? props.config.url
      : null,
)
watch(source, () => {
  loaded.value = false
  failed.value = false
})
watch(
  [source, loaded, failed],
  () => {
    readiness.value = !source.value
      ? 'off'
      : failed.value
        ? 'failed'
        : loaded.value
          ? 'loaded'
          : 'loading'
  },
  { immediate: true },
)
async function complete(event: Event) {
  const element = event.target as HTMLImageElement
  try {
    await element.decode()
  } catch {
    /* A usable image can outlive a cancelled decode. */
  }
  if (image.value !== element) return
  loaded.value = element.naturalWidth > 0
  failed.value = !loaded.value
}
onMounted(() => {
  if (image.value?.complete) {
    loaded.value = image.value.naturalWidth > 0
    failed.value = image.value.naturalWidth === 0
  }
  clientReady.value = true
})
</script>
<template>
  <div
    v-if="config.source !== 'off'"
    class="background-scene"
    :class="[config.layout, { loaded, failed }]"
    :data-background="failed ? 'failed' : loaded ? 'loaded' : 'loading'"
    :data-client-ready="clientReady"
    aria-hidden="true"
  >
    <img
      v-if="source"
      ref="image"
      :key="source"
      :src="source"
      alt=""
      referrerpolicy="no-referrer"
      :style="{ objectFit: config.fit, objectPosition: `${config.x}% ${config.y}%` }"
      @load="complete"
      @error="failed = true"
    />
    <div class="background-mask" :style="{ opacity: config.overlay / 100 }" />
    <svg
      v-if="config.layout === 'banner'"
      class="banner-wave"
      viewBox="0 0 1440 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        class="wave-back"
        d="M0 35 Q180 -2 360 35 T720 35 T1080 35 T1440 35 T1800 35 T2160 35 T2520 35 T2880 35 V100 H0Z"
      />
      <path
        class="wave-middle"
        d="M0 50 Q180 88 360 50 T720 50 T1080 50 T1440 50 T1800 50 T2160 50 T2520 50 T2880 50 V100 H0Z"
      />
      <path
        class="wave-front"
        d="M0 68 Q180 39 360 68 T720 68 T1080 68 T1440 68 T1800 68 T2160 68 T2520 68 T2880 68 V100 H0Z"
      />
    </svg>
  </div>
</template>
