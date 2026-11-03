<script setup lang="ts">
import type { DataSnapshot, LinksData } from '../../../shared/contracts/dashboard'
import { isSafeLink } from '../../../shared/domain/dashboard'
const props = defineProps<{ snapshot: DataSnapshot<LinksData>; title: string }>()
const items = computed(() =>
  (props.snapshot.data?.items ?? [])
    .filter((item) => isSafeLink(item.url))
    .toSorted((a, b) => a.sortOrder - b.sortOrder),
)
const hostname = (url: string) => new URL(url).hostname
</script>
<template>
  <section
    class="links-module"
    data-module="links"
    data-layout-flexible="rows"
    aria-labelledby="heading-links"
  >
    <h2 id="heading-links" class="sr-only">{{ title }}</h2>
    <DashboardDataState :status="snapshot.status" :empty="items.length === 0" />
    <nav class="link-grid" data-layout-rows aria-label="常用外部链接">
      <a
        v-for="item in items"
        :key="item.id"
        :href="item.url"
        target="_blank"
        rel="noopener noreferrer"
        :title="`${item.title} · ${hostname(item.url)}`"
        ><CommonAppIcon :name="item.icon" :size="24" /><span>{{ item.title }}</span></a
      >
    </nav>
  </section>
</template>
