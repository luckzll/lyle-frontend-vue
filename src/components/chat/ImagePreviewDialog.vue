<script setup lang="ts">
import { Download, X } from '@lucide/vue'

defineProps<{ open: boolean; src: string; alt: string }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="preview-backdrop" role="dialog" aria-modal="true" :aria-label="alt" tabindex="-1" @click.self="$emit('close')" @keydown.esc="$emit('close')">
      <div class="preview-toolbar">
        <a :href="src" :download="alt" aria-label="下载原图"><Download :size="20" aria-hidden="true" /></a>
        <button type="button" aria-label="关闭预览" @click="$emit('close')"><X :size="22" aria-hidden="true" /></button>
      </div>
      <img :src="src" :alt="alt" />
    </div>
  </Teleport>
</template>

<style scoped>
.preview-backdrop { position: fixed; z-index: 1000; inset: 0; display: grid; place-items: center; background: rgb(0 0 0 / 82%); padding: 56px 20px 20px; }
.preview-backdrop img { max-width: 96vw; max-height: calc(100vh - 80px); object-fit: contain; }
.preview-toolbar { position: absolute; top: 12px; right: 16px; display: flex; gap: 8px; }
.preview-toolbar a, .preview-toolbar button { display: inline-grid; width: 44px; height: 44px; place-items: center; border: 0; border-radius: 50%; background: rgb(255 255 255 / 14%); color: white; }
</style>
