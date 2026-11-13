<script setup lang="ts">
import type { DataSnapshot, TailscaleData } from '../../../shared/contracts/dashboard'
import { primaryTailnetAddress, tailnetState } from '../../../shared/domain/tailnet-presentation'
import { formatTimestamp } from '../../../shared/domain/format'
const props = defineProps<{
  nodes: TailscaleData['devices']
  snapshot: DataSnapshot<TailscaleData>
  detail?: boolean
}>()
const now = useLocalClock(),
  timezone = useDashboardTimezone()
const labels = { up: '在线', down: '离线', unknown: '状态未知', stale: '状态未知' }
const rows = computed(() =>
  props.nodes.map((node) => ({
    ...node,
    state: tailnetState(node.connectedToControl, props.snapshot, now.value),
    ip:
      node.addressLabel ??
      (props.detail ? node.addresses.join(' · ') : primaryTailnetAddress(node.addresses)),
  })),
)
</script>
<template>
  <div class="tailnet-list" :class="{ 'tailnet-list-detail': detail }">
    <article
      v-for="node in rows"
      :key="node.id"
      class="tailnet-device"
      :data-node-state="node.state"
    >
      <span class="monitor-indicator" :data-state="node.state" aria-hidden="true" />
      <div class="tailnet-copy">
        <h3 :title="!detail ? node.name : undefined">{{ node.name }}</h3>
        <p v-if="node.ip" class="tailnet-address" :title="!detail ? node.ip : undefined">
          {{ node.ip }}
        </p>
        <small v-if="detail && node.lastSeen"
          >最后出现 {{ formatTimestamp(node.lastSeen, timezone) }}</small
        >
      </div>
      <span :class="detail ? 'tailnet-connection' : 'sr-only'" :data-state="node.state">{{
        labels[node.state]
      }}</span>
    </article>
  </div>
</template>
