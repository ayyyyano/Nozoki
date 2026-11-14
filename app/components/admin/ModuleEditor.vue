<script setup lang="ts">
import type { ConfigWrite, ModuleSettings } from '../../../shared/contracts/config'
import { integrationPreset } from '../../../shared/integration-presets'
import { SOURCE_MODULES } from '../../../shared/integration-presets/bindings'
import { moduleEditors } from './module-editors'

const model = defineModel<ModuleSettings>({ required: true })
const props = defineProps<{ draft: ConfigWrite; resetToken: number; locateToken: number }>()
const editor = computed(() => moduleEditors[model.value.id])
const hasSource = computed(() => Object.values(SOURCE_MODULES).includes(model.value.id))
const sourceNames = computed(() =>
  Object.values(model.value.sources).map(
    (ref) =>
      integrationPreset(props.draft.integrations.find((source) => source.id === ref.sourceId))
        ?.name ?? '旧协议来源',
  ),
)
</script>

<template>
  <div class="admin-module-editor" :data-module-editor="model.id">
    <AdminModuleCommonSettings v-model="model">
      <template v-if="hasSource" #source>
        <p class="admin-note">
          {{
            sourceNames.length
              ? '自动匹配：' + sourceNames.join('、')
              : '添加对应类型的数据源后自动匹配'
          }}
        </p>
      </template>
      <template #presentation>
        <section v-if="editor?.home" class="admin-module-group">
          <h3 v-if="editor.home.title">{{ editor.home.title }}</h3>
          <component :is="editor.home.component" v-model="model" v-bind="editor.home.props ?? {}" />
        </section>
        <section v-if="model.id === 'activity'" class="admin-module-group">
          <h3>日程安排</h3>
          <AdminScheduleEditor v-model="draft.site.schedule" :reset-token="resetToken" />
        </section>
        <AdminQuoteSettingsEditor
          v-if="model.id === 'quotes'"
          v-model="draft.quotes"
          :integrations="draft.integrations"
          :reset-token="resetToken"
          :locate-token="locateToken"
        />
        <AdminLinkSettingsEditor
          v-if="model.id === 'links'"
          v-model="draft.links"
          :reset-token="resetToken"
          :locate-token="locateToken"
        />
      </template>
      <template v-if="editor?.guest" #guest>
        <component :is="editor.guest.component" v-model="model" v-bind="editor.guest.props ?? {}" />
      </template>
    </AdminModuleCommonSettings>
  </div>
</template>
