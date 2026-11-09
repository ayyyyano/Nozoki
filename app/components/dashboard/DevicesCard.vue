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
</script>
<template>
  <DashboardModuleCard
    id="devices"
    :title="title"
    :status="snapshot.status"
    :has-data="!!devices.length"
    :observed-at="snapshot.observedAt"
    :last-success-at="snapshot.lastSuccessAt"
    :details="devicesHaveDetails(devices)"
  >
    <DashboardDataState
      :configured="snapshot.sourceConfigured"
      :error-code="snapshot.errorCode"
      :status="snapshot.status"
      :has-data="!!devices.length"
      :empty="!snapshot.data?.devices.length"
      compact
    />
    <DashboardDeviceList
      v-if="devices.length"
      :devices="deviceSummary(devices)"
      :status="snapshot.status"
      :display-options="displayOptions"
    />
    <template #details>
      <DashboardDataState :status="snapshot.status" :empty="!devices.length" compact />
      <DashboardDeviceList
        :devices="devices"
        :status="snapshot.status"
        :display-options="displayOptions"
        detail
      />
    </template>
  </DashboardModuleCard>
</template>
