<script setup lang="ts">
import type { Appearance } from '../../../shared/contracts/appearance'
const model = defineModel<Appearance['background']>({ required: true })
</script>
<template>
  <div class="admin-fields">
    <VarSelect
      v-model="model.source"
      placeholder="背景来源"
      aria-label="背景来源"
      variant="outlined"
      ><VarOption label="关闭" value="off" /><VarOption
        label="内置图片"
        value="builtin" /><VarOption label="HTTPS 图片" value="custom"
    /></VarSelect>
    <AdminText v-if="model.source === 'custom'" v-model="model.url" label="背景 HTTPS 地址" />
    <VarSelect
      v-model="model.layout"
      placeholder="背景布局"
      aria-label="背景布局"
      variant="outlined"
      ><VarOption label="整页背景" value="page" /><VarOption label="顶部横幅" value="banner"
    /></VarSelect>
    <VarSelect v-model="model.fit" placeholder="图片适配" aria-label="图片适配" variant="outlined"
      ><VarOption label="cover" value="cover" /><VarOption label="contain" value="contain"
    /></VarSelect>
    <CommonSettingSlider v-model="model.x" label="共享水平位置" />
    <CommonSettingSlider v-model="model.y" label="共享垂直位置" />
    <CommonSettingSlider v-model="model.overlay" label="共享遮罩深浅" />
    <CommonSettingSlider v-model="model.cardOpacity" label="共享卡片不透明度" />
    <CommonSettingSlider v-model="model.cardBlur" label="共享卡片背景模糊" :max="20" unit="px" />
  </div>
</template>
