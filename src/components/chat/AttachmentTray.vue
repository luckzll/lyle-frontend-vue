<script setup lang="ts">
import { computed } from 'vue'
import AttachmentCard from './AttachmentCard.vue'
import FolderAttachmentGroup from './FolderAttachmentGroup.vue'
import type { ChatAttachmentDraft } from '@/domain/chat-attachment'

const props = defineProps<{ attachments: ChatAttachmentDraft[] }>()
defineEmits<{ remove: [localId: string]; retry: [localId: string] }>()

type AttachmentBlock =
  | { kind: 'attachment'; key: string; attachment: ChatAttachmentDraft }
  | { kind: 'folder'; key: string; id: string; name: string; items: ChatAttachmentDraft[] }

const blocks = computed<AttachmentBlock[]>(() => {
  const groups = new Map<string, ChatAttachmentDraft[]>()
  for (const item of props.attachments) {
    if (!item.folderGroupId) continue
    const group = groups.get(item.folderGroupId) || []
    group.push(item)
    groups.set(item.folderGroupId, group)
  }
  const emitted = new Set<string>()
  return props.attachments.flatMap((attachment): AttachmentBlock[] => {
    if (!attachment.folderGroupId) return [{ kind: 'attachment', key: attachment.localId, attachment }]
    if (emitted.has(attachment.folderGroupId)) return []
    emitted.add(attachment.folderGroupId)
    const items = groups.get(attachment.folderGroupId) || []
    return [{ kind: 'folder', key: `folder-${attachment.folderGroupId}`, id: attachment.folderGroupId, name: items[0]?.folderRoot || '文件夹', items }]
  })
})
</script>

<template>
  <div v-if="attachments.length" class="attachment-tray" aria-label="待发送附件">
    <template v-for="block in blocks" :key="block.key">
      <AttachmentCard v-if="block.kind === 'attachment'" :attachment="block.attachment" @remove="$emit('remove', block.attachment.localId)" @retry="$emit('retry', block.attachment.localId)" />
      <FolderAttachmentGroup v-else :name="block.name" :count="block.items.length" open>
        <AttachmentCard v-for="attachment in block.items" :key="attachment.localId" :attachment="attachment" @remove="$emit('remove', attachment.localId)" @retry="$emit('retry', attachment.localId)" />
      </FolderAttachmentGroup>
    </template>
  </div>
</template>

<style scoped>
.attachment-tray { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 8px; padding: 10px 10px 0; }
</style>
