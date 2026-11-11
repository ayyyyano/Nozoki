<script setup lang="ts">
import type { SourceGuide } from './source-guides'

defineProps<{ guide: SourceGuide }>()
</script>

<template>
  <div class="source-guide">
    <ol>
      <li v-for="step in guide.steps" :key="step">{{ step }}</li>
      <li>点击「测试并确认访问」。新增来源时，测试通过后点击「添加来源」，最后保存配置。</li>
    </ol>
    <a :href="guide.href" target="_blank" rel="noopener noreferrer">{{ guide.link }}</a>
  </div>
</template>
