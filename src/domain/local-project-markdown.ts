import { renderAssistantMarkdown } from './assistant-markdown'

/** Compatibility entry point; project/file output never opts into remote media. */
export function renderLocalProjectMarkdown(text: string) {
  return renderAssistantMarkdown(text)
}
