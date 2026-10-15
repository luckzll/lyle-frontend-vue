<script setup lang="ts">
import AssistantMarkdown from './AssistantMarkdown.vue'
defineProps<{ text: string }>()
</script>

<template>
  <AssistantMarkdown class="project-text" :text="text" />
</template>
