import type { Component } from 'vue'
import type { ModuleId } from '../../../shared/contracts/dashboard'
import CodexPresentationEditor from './CodexPresentationEditor.vue'
import DeepSeekPermissionsEditor from './DeepSeekPermissionsEditor.vue'
import HomeItemsEditor from './HomeItemsEditor.vue'
import TailscalePermissionsEditor from './TailscalePermissionsEditor.vue'

interface Editor {
  component: Component
  props?: Record<string, string>
  title?: string
}

export const moduleEditors: Partial<Record<ModuleId, { home?: Editor; guest?: Editor }>> = {
  deepseek: { guest: { component: DeepSeekPermissionsEditor } },
  devices: { home: { component: HomeItemsEditor, props: { kind: 'devices' }, title: '首页展示' } },
  tailscale: {
    home: { component: HomeItemsEditor, props: { kind: 'tailscale' }, title: '首页展示' },
    guest: { component: TailscalePermissionsEditor },
  },
  codex: {
    home: { component: CodexPresentationEditor, props: { section: 'home' }, title: '首页展示' },
    guest: { component: CodexPresentationEditor, props: { section: 'guest' } },
  },
  services: {
    home: { component: HomeItemsEditor, props: { kind: 'services' }, title: '首页展示' },
  },
}
