import { readonly, reactive } from 'vue'
import { getRuntimeFeatures, type RuntimeFeatures } from '@/api/app'

const features = reactive<RuntimeFeatures>({
  authLoginV63Enabled: true,
  chatWorkspaceDropEnabled: true,
  chatFolderAttachmentsEnabled: true
})

let pending: Promise<void> | undefined

export function loadRuntimeFeatures() {
  if (!pending) {
    pending = getRuntimeFeatures()
      .then(({ data }) => {
        Object.assign(features, {
          authLoginV63Enabled: data.authLoginV63Enabled !== false,
          chatWorkspaceDropEnabled: data.chatWorkspaceDropEnabled !== false,
          chatFolderAttachmentsEnabled: data.chatFolderAttachmentsEnabled !== false
        })
      })
      .catch(() => undefined)
  }
  return pending
}

export function useRuntimeFeatures() {
  return readonly(features)
}
