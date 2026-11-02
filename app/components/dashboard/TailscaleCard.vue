<script setup lang="ts">
import type { DataSnapshot, TailscaleData } from '../../../shared/contracts/dashboard'
import { tailscaleConnectionLabel } from '../../../shared/tailscale'
import { formatTimestamp } from '../../../shared/domain/format'
const props = defineProps<{ snapshot: DataSnapshot<TailscaleData>; title: string }>()
const timezone = useDashboardTimezone()
const now = useLocalClock()
const stale = computed(
  () =>
    props.snapshot.status !== 'ok' ||
    (props.snapshot.expiresAt !== null && Date.parse(props.snapshot.expiresAt) <= now.value),
)
</script>
<template>
  <DashboardModuleCard id="tailscale" :title="title" icon="network" :status="snapshot.status">
    <DashboardDataState
      :status="snapshot.status"
      :empty="!snapshot.data?.devices.length"
      :last-success-at="snapshot.lastSuccessAt"
      compact
    />
    <div class="tailnet-list">
      <article
        v-for="device in snapshot.data?.devices ?? []"
        :key="device.id"
        class="tailnet-device"
      >
        <div class="tailnet-device-heading">
          <h3 :title="device.name">{{ device.name }}</h3>
          <span
            class="tailnet-connection"
            :data-state="
              stale
                ? 'stale'
                : device.connectedToControl === true
                  ? 'up'
                  : device.connectedToControl === false
                    ? 'down'
                    : 'unknown'
            "
          >
            {{ tailscaleConnectionLabel(device.connectedToControl, stale) }}
          </span>
        </div>
        <p class="tailnet-address">
          IP：<span v-if="device.addressesHidden" aria-label="IP 已隐藏">****</span
          ><span v-else>{{
            device.addresses.length ? device.addresses.join(' · ') : '未提供'
          }}</span>
        </p>
        <small v-if="device.connectedToControl !== true && device.lastSeen"
          >最后出现 {{ formatTimestamp(device.lastSeen, timezone) }}</small
        >
      </article>
    </div>
  </DashboardModuleCard>
</template>
