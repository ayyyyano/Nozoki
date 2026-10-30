<script setup lang="ts">
import type { DataSnapshot, DevicesData } from '../../../shared/contracts/dashboard'
import { formatTimestamp } from '../../../shared/domain/format'
import { presentDevice } from '../../../shared/device-state/presentation'
import type { DeviceDisplayOptions } from '../../../shared/device-state/presentation'

const props = defineProps<{
  snapshot: DataSnapshot<DevicesData>
  title: string
  displayOptions?: DeviceDisplayOptions
}>()
const timezone = useDashboardTimezone()
const devices = computed(() =>
  (props.snapshot.data?.devices ?? []).map((device) => presentDevice(device, props.displayOptions)),
)
</script>
<template>
  <DashboardModuleCard
    id="devices"
    :title="title"
    icon="devices"
    :status="snapshot.status"
    :observed-at="snapshot.observedAt"
  >
    <DashboardDataState
      :status="snapshot.status"
      :empty="!snapshot.data?.devices.length"
      :last-success-at="snapshot.lastSuccessAt"
    />
    <div v-if="snapshot.data?.devices.length" class="device-list">
      <article
        v-for="device in devices"
        :key="device.id"
        class="device-row"
        :data-device-id="device.id"
        :data-battery-level="device.batteryLevel"
      >
        <div
          class="device-meter"
          :class="{ 'device-meter-neutral': device.batteryPercent === null }"
          :role="device.batteryPercent !== null ? 'img' : undefined"
          :aria-label="device.batteryAriaLabel ?? undefined"
          :aria-hidden="device.batteryPercent === null ? true : undefined"
        >
          <VarProgress
            v-if="device.batteryPercent !== null"
            mode="circle"
            :value="device.batteryPercent"
            :label="false"
            :size="52"
            :line-width="3"
            :color="device.batteryLevel === 'low' ? 'var(--color-danger)' : 'var(--color-primary)'"
          />
          <CommonAppIcon name="devices" :size="24" />
        </div>
        <div class="device-copy">
          <h3 :title="device.name">{{ device.name }}</h3>
          <p
            class="device-state"
            tabindex="0"
            :title="device.statusText"
            :aria-label="device.statusText"
          >
            {{ device.statusText }}
          </p>
          <small v-if="device.statusUpdatedAt"
            >状态更新 {{ formatTimestamp(device.statusUpdatedAt, timezone)
            }}<span v-if="snapshot.status === 'stale'"> · 数据过期</span></small
          >
          <small v-else-if="snapshot.status === 'stale'">数据过期</small>
          <div v-if="device.batteryPercent !== null" class="battery-value">
            <strong>{{ device.batteryPercent }}<small>%</small></strong>
            <span v-if="device.charging" aria-label="充电中" title="充电中"
              ><CommonAppIcon name="bolt" :size="20"
            /></span>
          </div>
        </div>
      </article>
    </div>
  </DashboardModuleCard>
</template>
