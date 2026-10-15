import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import LocalProjectText from '@/components/chat/LocalProjectText.vue'
import { renderLocalProjectMarkdown } from '@/domain/local-project-markdown'

describe('local project answer Markdown', () => {
  it('renders semantic headings, paragraphs, nested lists, quotes and scrollable tables', async () => {
    const text = '# 报告\n\n## 结论\n\n第一行\n第二行\n\n### 下一步\n\n1. 检查入口\n   - 查看 `src/main.ts`\n   - 核对配置\n2. 执行验证\n\n> 保留原有内容。\n\n---\n\n| 项目 | 结果 |\n| --- | --- |\n| 构建 | 通过 |\n\n#### 附注\n\n##### 备注\n\n###### 来源'
    const html = await renderToString(createSSRApp(LocalProjectText, { text }))
    for (let level = 1; level <= 6; level++) expect(html).toContain(`<h${level}>`)
    expect(html).toContain('<p>第一行<br>\n第二行</p>')
    expect(html).toMatch(/<ol>[\s\S]*<li>检查入口[\s\S]*<ul>[\s\S]*<code>src\/main.ts<\/code>/)
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<hr>')
    expect(html).toContain('class="markdown-table-wrap" tabindex="0" role="region"')
    expect(html).toContain('<thead>')
    expect(html).toContain('<td>通过</td>')
  })

  it('escapes HTML and refuses active protocols and remote images, while retaining safe links', async () => {
    const text = '<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n![**设计图**](https://example.com/private.png)\n\n[帮助](https://example.com/guide?q=1&step=2)\n\n[邮件](mailto:help@example.com)\n\n[脚本](javascript:alert%281%29)\n\n[数据](data:text/html,hello)\n\n[VB](vbscript:msgbox%281%29)\n\n[本地](file:///etc/passwd)\n\n[编码脚本](jav&#x61;script:alert%281%29)'
    const html = await renderToString(createSSRApp(LocalProjectText, { text }))
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toMatch(/<(?:img|script|iframe)\b/i)
    expect(html).not.toContain('src="https://example.com/private.png"')
    expect(html).toContain('target="_blank" rel="noopener noreferrer"')
    expect(html).toContain('href="https://example.com/guide?q=1&amp;step=2"')
    expect(html).toContain('href="mailto:help@example.com"')
    expect(html).not.toMatch(/href="(?:javascript|data|vbscript|file):/i)
    expect(html).toContain('图片：**设计图**')
  })

  it('keeps code literal and copyable, including an unfinished streamed fence', () => {
    const code = 'const html = "<img src=x>"\n  **literal** & `code`\n'
    const complete = renderLocalProjectMarkdown(`\`\`\`typescript\n${code}\`\`\`\n\n后续正文`)
    expect(complete.codeBlocks).toEqual([code])
    expect(complete.html).toContain('markdown-code-language">typescript</span>')
    expect(complete.html).toContain('data-copy-code="0" aria-label="复制代码"')
    expect(complete.html).toContain('&lt;img src=x&gt;')
    expect(complete.html).toContain('  **literal** &amp; `code`')
    expect(complete.html).toContain('<p>后续正文</p>')
    expect(complete.html).not.toContain('<strong>literal</strong>')
    const streaming = renderLocalProjectMarkdown('```js\nconst pending = "<script>"')
    expect(streaming.codeBlocks).toEqual(['const pending = "<script>"'])
    expect(streaming.html).toContain('const pending = &quot;&lt;script&gt;&quot;')
    expect(streaming.html).toContain('</code></pre></div>')
  })
})
