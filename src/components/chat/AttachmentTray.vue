<script setup lang="ts">
import AttachmentCard from './AttachmentCard.vue'
import type { ChatAttachmentDraft } from '@/domain/chat-attachment'

defineProps<{ attachments: ChatAttachmentDraft[] }>()
defineEmits<{ remove: [localId: string]; retry: [localId: string] }>()
</script>

<template>
  <div v-if="attachments.length" class="attachment-tray" aria-label="待发送附件">
    <AttachmentCard
      v-for="attachment in attachments"
      :key="attachment.localId"
      :attachment="attachment"
      @remove="$emit('remove', attachment.localId)"
      @retry="$emit('retry', attachment.localId)"
    />
  </div>
</template>

<style scoped>
.attachment-tray { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 8px; padding: 10px 10px 0; }
</style>
