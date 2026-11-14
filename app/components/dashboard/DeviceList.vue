<script setup lang="ts">
import type { Device } from '../../../shared/contracts/dashboard'
import { formatTimestamp } from '../../../shared/domain/format'
import { presentDevice, type DeviceDisplayOptions } from '../../../shared/device-state/presentation'
const props = defineProps<{
  devices: Device[]
  detail?: boolean
  displayOptions?: DeviceDisplayOptions
}>()
const timezone = useDashboardTimezone()
const presented = computed(() =>
  props.devices.map((device) => ({
    ...presentDevice(device, props.displayOptions),
    icon: device.icon ?? 'devices',
    sourceName: device.sourceName,
  })),
)
</script>
<template>
  <div class="device-list" :class="{ 'device-list-detail': detail }">
    <article
      v-for="device in presented"
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
        <CommonAppIcon :name="device.icon" :size="24" />
      </div>
      <div class="device-copy">
        <h3 :title="device.name">{{ device.name }}</h3>
        <small v-if="detail && device.sourceName" class="item-source-name"
          >来源名称 · {{ device.sourceName }}</small
        >
        <p
          class="device-state"
          tabindex="0"
          :title="device.statusText"
          :aria-label="device.statusText"
        >
          {{ device.statusText }}
        </p>
        <small v-if="detail && device.statusUpdatedAt"
          >状态更新 {{ formatTimestamp(device.statusUpdatedAt, timezone) }}</small
        >
        <div v-if="device.batteryPercent !== null" class="battery-value">
          <strong>{{ device.batteryPercent }}<small>%</small></strong>
          <span class="device-battery-dots" aria-hidden="true">
            <i v-for="dot in 4" :key="dot" :data-filled="device.batteryPercent > (dot - 1) * 25" />
          </span>
          <span v-if="device.charging" class="device-charging" aria-label="充电中" title="充电中"
            ><CommonAppIcon name="bolt" :size="detail ? 20 : 14"
          /></span>
        </div>
      </div>
    </article>
  </div>
</template>
