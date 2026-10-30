<script setup lang="ts">
useHead({ title: '登录 · Nozoki' })
</script>
<template>
  <main id="main-content" class="auth-page management-page" tabindex="-1">
    <AuthLoginForm @authenticated="navigateTo('/admin', { external: true })" />
  </main>
</template>
<style src="../assets/styles/management.css"></style>
