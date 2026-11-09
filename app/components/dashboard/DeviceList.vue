<script setup lang="ts">
import type { Device, DataStatus } from '../../../shared/contracts/dashboard'
import { formatTimestamp } from '../../../shared/domain/format'
import { staleTime } from '../../../shared/domain/home-summary'
import { presentDevice, type DeviceDisplayOptions } from '../../../shared/device-state/presentation'
const props = defineProps<{
  devices: Device[]
  status: DataStatus
  detail?: boolean
  displayOptions?: DeviceDisplayOptions
}>()
const timezone = useDashboardTimezone(),
  now = useLocalClock()
const presented = computed(() => props.devices.map((d) => presentDevice(d, props.displayOptions)))
</script>
<template>
  <div class="device-list">
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
        <small v-if="detail && device.statusUpdatedAt"
          >状态更新 {{ formatTimestamp(device.statusUpdatedAt, timezone) }}</small
        >
        <small v-if="detail && staleTime(device.statusUpdatedAt, now, 86400000)">状态较旧</small>
        <div
          v-if="
            device.batteryPercent !== null ||
            (!detail && staleTime(device.statusUpdatedAt, now, 86400000))
          "
          class="battery-value"
        >
          <strong v-if="device.batteryPercent !== null"
            >{{ device.batteryPercent }}<small>%</small></strong
          >
          <span v-if="device.charging" class="device-charging" aria-label="充电中" title="充电中"
            ><CommonAppIcon name="bolt" :size="detail ? 20 : 14"
          /></span>
          <small
            v-if="!detail && staleTime(device.statusUpdatedAt, now, 86400000)"
            class="device-age"
            aria-label="状态较旧"
            title="状态较旧，完整更新时间见详情"
            >较旧</small
          >
        </div>
      </div>
    </article>
  </div>
</template>
