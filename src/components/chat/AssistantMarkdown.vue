<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { renderAssistantMarkdown } from '@/domain/assistant-markdown'

const props = defineProps<{ text: string; allowImages?: boolean; linkify?: boolean }>()
const rendered = computed(() => renderAssistantMarkdown(props.text, { allowImages: props.allowImages, linkify: props.linkify }))
const copyFeedback = ref('')
const pendingResets = new Set<ReturnType<typeof setTimeout>>()

async function copyCode(event: MouseEvent) {
  const target = event.target
  if (!(target instanceof Element)) return
  const button = target.closest<HTMLButtonElement>('button[data-copy-code]')
  if (!button || !(event.currentTarget instanceof Element) || !event.currentTarget.contains(button) || button.getAttribute('aria-disabled') === 'true') return
  const code = rendered.value.codeBlocks[Number(button.dataset.copyCode)]
  if (code === undefined) return

  // Vue owns the outer content; markdown-it owns this inert HTML subtree.
  // Updating its button keeps keyboard focus in place during copy feedback.
  button.setAttribute('aria-disabled', 'true')
  button.setAttribute('aria-busy', 'true')
  button.textContent = '正在复制…'
  copyFeedback.value = ''
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
    await navigator.clipboard.writeText(code)
    button.textContent = '已复制'
    button.setAttribute('aria-label', '代码已复制，可再次复制')
    button.removeAttribute('data-copy-error')
    copyFeedback.value = '代码已复制。'
  } catch {
    button.textContent = '复制失败'
    button.setAttribute('aria-label', '复制失败，可重试或选中代码后手动复制')
    button.setAttribute('data-copy-error', '')
    copyFeedback.value = '复制失败，请重试或选中代码后手动复制。'
  } finally {
    button.removeAttribute('aria-disabled')
    button.removeAttribute('aria-busy')
    const timer = setTimeout(() => {
      pendingResets.delete(timer)
      if (!button.isConnected) return
      button.textContent = '复制代码'
      button.setAttribute('aria-label', '复制代码')
      button.removeAttribute('data-copy-error')
    }, 3000)
    pendingResets.add(timer)
  }
}

function hideFailedImage(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLImageElement) || !target.classList.contains('generated-image')) return
  const link = target.closest<HTMLAnchorElement>('a.generated-image-link')
  if (link) link.hidden = true
  else target.hidden = true
}

onBeforeUnmount(() => pendingResets.forEach(clearTimeout))
</script>

<template>
  <div class="assistant-markdown">
    <div class="assistant-markdown__content project-text__content" @click="copyCode" @error.capture="hideFailedImage" v-html="rendered.html" />
    <span class="assistant-markdown__copy-feedback" role="status" aria-live="polite" aria-atomic="true">{{ copyFeedback }}</span>
  </div>
</template>

<style scoped>
.assistant-markdown { min-width: 0; color: var(--foreground); font-size: 14px; line-height: 1.85; overflow-wrap: anywhere; }
.assistant-markdown__content { min-width: 0; }
.assistant-markdown__content :deep(> :first-child) { margin-top: 0; }
.assistant-markdown__content :deep(> :last-child) { margin-bottom: 0; }
.assistant-markdown :deep(p) { margin: 0 0 14px; }
.assistant-markdown :deep(h1), .assistant-markdown :deep(h2), .assistant-markdown :deep(h3), .assistant-markdown :deep(h4), .assistant-markdown :deep(h5), .assistant-markdown :deep(h6) { color: var(--foreground); font-weight: 650; line-height: 1.5; letter-spacing: -.025em; scroll-margin-top: 24px; }
.assistant-markdown :deep(h1) { margin: 32px 0 16px; font-size: 1.7em; }
.assistant-markdown :deep(h2) { margin: 28px 0 12px; font-size: 1.38em; }
.assistant-markdown :deep(h3) { margin: 24px 0 10px; font-size: 1.16em; }
.assistant-markdown :deep(h4), .assistant-markdown :deep(h5), .assistant-markdown :deep(h6) { margin: 20px 0 8px; font-size: 1em; }
.assistant-markdown :deep(h5), .assistant-markdown :deep(h6) { color: var(--muted-foreground); }
.assistant-markdown :deep(strong) { color: var(--foreground); font-weight: 650; }
.assistant-markdown :deep(ul), .assistant-markdown :deep(ol) { margin: 0 0 16px; padding-left: 1.65em; }
.assistant-markdown :deep(ul) { list-style: disc; }
.assistant-markdown :deep(ol) { list-style: decimal; }
.assistant-markdown :deep(ul ul) { list-style: circle; }
.assistant-markdown :deep(ul ul ul) { list-style: square; }
.assistant-markdown :deep(li) { margin: 5px 0; padding-left: .2em; }
.assistant-markdown :deep(li::marker) { color: var(--muted-foreground); }
.assistant-markdown :deep(li > ul), .assistant-markdown :deep(li > ol) { margin-top: 5px; margin-bottom: 7px; }
.assistant-markdown :deep(li > p) { margin-bottom: 7px; }
.assistant-markdown :deep(blockquote) { margin: 18px 0; padding: 2px 0 2px 16px; border-left: 3px solid var(--border-strong); color: var(--muted-foreground); }
.assistant-markdown :deep(blockquote > :last-child) { margin-bottom: 0; }
.assistant-markdown :deep(hr) { height: 0; margin: 28px 0; border: 0; border-top: 1px solid var(--border); }
.assistant-markdown :deep(a) { color: var(--accent-foreground); text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--accent-foreground) 35%, transparent); text-underline-offset: 3px; }
.assistant-markdown :deep(a:hover) { text-decoration-color: currentColor; }
.assistant-markdown :deep(a:focus-visible), .assistant-markdown :deep(button:focus-visible), .assistant-markdown :deep(.markdown-table-wrap:focus-visible) { outline: 2px solid var(--focus-ring); outline-offset: 3px; }
.assistant-markdown :deep(code) { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.assistant-markdown :deep(:not(pre) > code) { padding: .12em .38em; border: 1px solid color-mix(in srgb, var(--border) 65%, transparent); border-radius: 5px; background: color-mix(in srgb, var(--surface-muted) 70%, transparent); color: var(--foreground); font-size: .88em; box-decoration-break: clone; }
.assistant-markdown :deep(.markdown-code-block) { min-width: 0; margin: 18px 0; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: color-mix(in srgb, var(--surface-muted) 55%, var(--surface)); }
.assistant-markdown :deep(.markdown-code-toolbar) { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 38px; padding: 5px 14px; border-bottom: 1px solid var(--border); color: var(--muted-foreground); font-size: 11px; line-height: 1.5; }
.assistant-markdown :deep(.markdown-code-language) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.assistant-markdown :deep(.markdown-copy-code) { flex-shrink: 0; min-height: 28px; padding: 3px 7px; border: 0; border-radius: 5px; background: transparent; color: var(--muted-foreground); font: inherit; cursor: pointer; transition: background-color 140ms ease, color 140ms ease; }
.assistant-markdown :deep(.markdown-copy-code:hover) { background: var(--surface); color: var(--foreground); }
.assistant-markdown :deep(.markdown-copy-code[aria-disabled="true"]) { cursor: wait; opacity: .65; }
.assistant-markdown :deep(.markdown-copy-code[data-copy-error]) { color: var(--danger-strong); }
.assistant-markdown :deep(pre) { max-width: 100%; max-height: 460px; margin: 0; padding: 16px; overflow: auto; overscroll-behavior-x: contain; background: transparent; font-size: 12px; line-height: 1.75; white-space: pre; tab-size: 2; }
.assistant-markdown :deep(pre code) { display: block; width: max-content; min-width: 100%; padding: 0; border: 0; background: none; color: inherit; font-size: inherit; overflow-wrap: normal; }
.assistant-markdown :deep(.markdown-table-wrap) { max-width: 100%; margin: 18px 0; overflow-x: auto; overscroll-behavior-x: contain; border: 1px solid var(--border); border-radius: 9px; }
.assistant-markdown :deep(table) { width: 100%; margin: 0; border-collapse: collapse; font-size: .92em; line-height: 1.65; }
.assistant-markdown :deep(th), .assistant-markdown :deep(td) { min-width: 100px; padding: 10px 14px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
.assistant-markdown :deep(th) { background: color-mix(in srgb, var(--surface-muted) 65%, var(--surface)); color: var(--foreground); font-weight: 600; }
.assistant-markdown :deep(th code), .assistant-markdown :deep(td code) { white-space: nowrap; }
.assistant-markdown :deep(tbody tr:last-child td) { border-bottom: 0; }
.assistant-markdown :deep(.generated-image-link) { display: inline-block; max-width: 100%; vertical-align: top; line-height: 0; text-decoration: none; }
.assistant-markdown :deep(.generated-image) { display: block; max-width: 100%; height: auto; max-height: 480px; object-fit: contain; border: 1px solid var(--border); border-radius: 10px; }
.assistant-markdown :deep(.generated-image-link[hidden]), .assistant-markdown :deep(.generated-image[hidden]) { display: none; }
.assistant-markdown :deep(.markdown-image-label) { color: var(--muted-foreground); font-size: .93em; }
.assistant-markdown__copy-feedback { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 600px) {
  .assistant-markdown { font-size: 13px; line-height: 1.8; }
  .assistant-markdown :deep(h1) { font-size: 1.5em; }
  .assistant-markdown :deep(h2) { font-size: 1.28em; }
  .assistant-markdown :deep(pre) { padding: 13px; font-size: 11px; }
  .assistant-markdown :deep(th), .assistant-markdown :deep(td) { min-width: 90px; padding: 9px 11px; }
}
@media (prefers-reduced-motion: reduce) { .assistant-markdown :deep(.markdown-copy-code) { transition: none; } }
</style>
