<script setup lang="ts">
import type { CodexData } from '../../../shared/contracts/dashboard'
defineProps<{ usage: NonNullable<CodexData['usage']>; detail?: boolean }>()
const labels = {
  input: '输入',
  output: '输出',
  reasoning: '推理',
  cached: '缓存',
  requests: '请求',
  failed: '失败',
} as const
</script>
<template>
  <section class="codex-usage" aria-label="Codex 每日用量">
    <h3>用量 · UTC</h3>
    <p v-if="!usage.days.length" class="quiet-note">暂无队列用量</p>
    <article
      v-for="day in detail ? usage.days : usage.days.slice(-1)"
      :key="day.day"
      class="codex-usage-day"
    >
      <div class="section-heading">
        <time :datetime="day.day">{{ day.day }}</time
        ><span>总 Token {{ day.total ?? '—' }}</span>
      </div>
      <dl class="codex-usage-metrics">
        <div v-for="(label, key) in labels" :key="key">
          <dt>{{ label }}</dt>
          <dd>{{ day[key] ?? '—' }}</dd>
        </div>
      </dl>
    </article>
  </section>
</template>
