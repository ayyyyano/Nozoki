<script setup lang="ts">
import type { DataSnapshot, LinksData } from '../../../shared/contracts/dashboard'
import { isSafeLink } from '../../../shared/domain/dashboard'
import { HOME_LIMITS } from '../../../shared/domain/home-summary'
const props = defineProps<{ snapshot: DataSnapshot<LinksData>; title: string }>()
const items = computed(() =>
  (props.snapshot.data?.items ?? [])
    .filter((item) => isSafeLink(item.url))
    .toSorted((a, b) => a.sortOrder - b.sortOrder),
)
const hostname = (url: string) => new URL(url).hostname
const open = ref(false)
</script>
<template>
  <section
    class="links-module"
    data-module="links"
    data-layout-role="navigation"
    :data-link-count="Math.min(items.length, HOME_LIMITS.links)"
    :style="{ '--link-count': Math.max(1, Math.min(items.length, HOME_LIMITS.links)) }"
    aria-labelledby="heading-links"
  >
    <h2 id="heading-links" class="sr-only">{{ title }}</h2>
    <VarButton
      v-if="items.length > HOME_LIMITS.links"
      text
      round
      class="module-detail-button"
      aria-haspopup="dialog"
      :aria-label="`查看${title}详情`"
      :title="`查看${title}详情`"
      @click="open = true"
      ><CommonAppIcon name="OpenInFullRound"
    /></VarButton>
    <DashboardDataState :status="snapshot.status" :empty="items.length === 0" />
    <nav class="link-grid" aria-label="常用外部链接">
      <a
        v-for="item in items.slice(0, HOME_LIMITS.links)"
        :key="item.id"
        :href="item.url"
        target="_blank"
        rel="noopener noreferrer"
        :title="`${item.title} · ${hostname(item.url)}`"
        ><CommonAppIcon :name="item.icon" :size="24" /><span>{{ item.title }}</span></a
      >
    </nav>
    <DashboardModuleDetail
      v-if="items.length > HOME_LIMITS.links"
      v-model:show="open"
      :title="title + '详情'"
      ><nav class="link-grid" aria-label="全部常用链接">
        <a
          v-for="item in items"
          :key="item.id"
          :href="item.url"
          target="_blank"
          rel="noopener noreferrer"
          ><CommonAppIcon :name="item.icon" /><span>{{ item.title }}</span></a
        >
      </nav></DashboardModuleDetail
    >
  </section>
</template>
