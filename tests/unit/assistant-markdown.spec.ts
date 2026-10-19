import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import AssistantMarkdown from '@/components/chat/AssistantMarkdown.vue'
import LocalProjectText from '@/components/chat/LocalProjectText.vue'
import { renderAssistantMarkdown } from '@/domain/assistant-markdown'
import { renderLocalProjectMarkdown } from '@/domain/local-project-markdown'

describe('shared assistant Markdown', () => {
  it('keeps local project defaults without image requests or automatic links', async () => {
    const text = '![参考](https://example.com/private.png)\n\nhttps://example.com openai/codex'
    const shared = renderAssistantMarkdown(text)
    expect(renderLocalProjectMarkdown(text)).toEqual(shared)
    expect(shared.html).toContain('图片：参考')
    expect(shared.html).not.toContain('<img')
    expect(shared.html).not.toContain('<a ')
    const local = await renderToString(createSSRApp(LocalProjectText, { text }))
    expect(local).toContain('assistant-markdown project-text')
    expect(local).not.toContain('<img')
  })

  it('retains report structure and safe copyable streaming code through the shared component', async () => {
    const text = '## 结果\n\n- 已完成\n  1. 核对入口\n\n| 项目 | 状态 |\n| --- | --- |\n| 编译 | 通过 |\n\n```ts\nconst html = "<script>"'
    const html = await renderToString(createSSRApp(AssistantMarkdown, { text }))
    expect(html).toContain('<h2>结果</h2>')
    expect(html).toMatch(/<ul>[\s\S]*<ol>/)
    expect(html).toContain('class="markdown-table-wrap" tabindex="0"')
    expect(html).toContain('data-copy-code="0" aria-label="复制代码"')
    expect(html).toContain('const html = &quot;&lt;script&gt;&quot;')
    expect(html).toContain('role="status" aria-live="polite"')
  })

  it('opts into http(s) images with escaped alt text, lazy loading and no inline event handlers', async () => {
    const text = '![**图** & " onerror="alert(1)](https://example.com/a.png?q=1&v=2)\n\n![本地](file:///tmp/a.png)\n\n![数据](data:image/svg+xml,hello)\n\n![邮件](mailto:hello@example.com)'
    const html = await renderToString(createSSRApp(AssistantMarkdown, { text, allowImages: true }))
    expect(html).toContain('class="generated-image-link"')
    expect(html).toContain('class="generated-image" src="https://example.com/a.png?q=1&amp;v=2"')
    expect(html).toContain('alt="图 &amp; &quot; onerror=&quot;alert(1)"')
    expect(html).toContain('loading="lazy"')
    expect(html.match(/<img\b/g)).toHaveLength(1)
    expect(html).not.toMatch(/<img[^>]*\sonerror="/)
    expect(html).not.toMatch(/(?:src|href)="(?:file|data|javascript|vbscript):/)
  })

  it('automatically links URLs and repositories only within ordinary text', () => {
    const html = renderAssistantMarkdown('https://example.com/guide?q=1&v=2, openai/codex\n\n`openai/codex https://code.example.com`\n\n[openai/codex](https://example.com/existing)\n\n```txt\nopenai/codex https://fence.example.com\n```', { linkify: true }).html
    expect(html).toContain('href="https://example.com/guide?q=1&amp;v=2"')
    expect(html.match(/href="https:\/\/github.com\/openai\/codex"/g)).toHaveLength(1)
    expect(html).toContain('<code>openai/codex https://code.example.com</code>')
    expect(html).toContain('href="https://example.com/existing"')
    expect(html).toContain('>openai/codex</a>')
    expect(html).not.toMatch(/<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<a\b/)
    expect(html).not.toContain('href="https://code.example.com"')
    expect(html).not.toContain('href="https://fence.example.com"')
  })

  it('opens repository code labels in GitHub tables and standalone URL code labels', () => {
    const text = 'GitHub 热门项目\n\n| 项目 | 说明 |\n| --- | --- |\n| `freeCodeCamp/freeCodeCamp` | 编程学习 |\n| `facebook/react` | 前端框架 |\n\n`https://example.com/guide`\n\n`src/main`'
    const html = renderAssistantMarkdown(text, { linkify: true }).html
    expect(html).toContain('href="https://github.com/freeCodeCamp/freeCodeCamp"')
    expect(html).toContain('href="https://github.com/facebook/react"')
    expect(html).toContain('<code>facebook/react</code></a>')
    expect(html).toContain('href="https://example.com/guide"')
    expect(html).not.toContain('href="https://github.com/src/main"')
  })

  it('avoids nested anchors for linked images and rejects active links in every mode', () => {
    const html = renderAssistantMarkdown('[![参考](https://example.com/a.png)](https://example.com/page)\n\n[脚本](jav&#x61;script:alert%281%29)\n\n<script>alert(1)</script>', { allowImages: true, linkify: true }).html
    expect(html.match(/<a\b/g)).toHaveLength(1)
    expect(html).toContain('class="generated-image"')
    expect(html).toContain('href="https://example.com/page"')
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})
