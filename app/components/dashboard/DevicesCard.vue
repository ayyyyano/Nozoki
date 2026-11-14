<script setup lang="ts">
import type { DataSnapshot, DevicesData } from '../../../shared/contracts/dashboard'
import { deviceSummary, devicesHaveDetails } from '../../../shared/domain/home-summary'
import type { DeviceDisplayOptions } from '../../../shared/device-state/presentation'

const props = defineProps<{
  snapshot: DataSnapshot<DevicesData>
  title: string
  displayOptions?: DeviceDisplayOptions
}>()
const devices = computed(() => props.snapshot.data?.devices ?? [])
const home = computed(() => deviceSummary(devices.value, props.snapshot.homeItems))
</script>
<template>
  <DashboardModuleCard
    id="devices"
    :title="title"
    :status="snapshot.status"
    :has-data="!!devices.length"
    :observed-at="snapshot.observedAt ?? snapshot.collectedAt"
    :last-success-at="snapshot.lastSuccessAt"
    :time-label="snapshot.observedAt ? '观测于' : '采集于'"
    :details="devicesHaveDetails(devices, snapshot.homeItems)"
  >
    <DashboardDataState
      :configured="snapshot.sourceConfigured"
      :error-code="snapshot.errorCode"
      :status="snapshot.status"
      :has-data="!!devices.length"
      :empty="!snapshot.data?.devices.length"
      compact
    />
    <DashboardDeviceList v-if="devices.length" :devices="home" :display-options="displayOptions" />
    <p v-if="devices.length && !home.length" class="quiet-note">未选择首页设备，可在详情中查看。</p>
    <template #details>
      <DashboardDataState :status="snapshot.status" :empty="!devices.length" compact />
      <DashboardDeviceList :devices="devices" :display-options="displayOptions" detail />
    </template>
  </DashboardModuleCard>
</template>
