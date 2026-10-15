import MarkdownIt from 'markdown-it'

export type AssistantMarkdownOptions = { allowImages?: boolean; linkify?: boolean }
type MarkdownEnvironment = { codeBlocks: string[]; allowImages: boolean }

function httpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function createMarkdown(linkify: boolean) {
  const markdown = new MarkdownIt({ html: false, breaks: true, linkify, typographer: false })
  // Model/file content cannot create active HTML, local-file or app links.
  markdown.validateLink = (url: string) => /^(?:https?:\/\/|mailto:|#)/i.test(url)
  markdown.renderer.rules.image = (tokens, index, options, environment, renderer) => {
    const token = tokens[index]!
    const context = environment as MarkdownEnvironment
    const href = context.allowImages && httpUrl(String(token.attrGet('src') || ''))
    if (!href) {
      const description = token.content.trim()
      return `<span class="markdown-image-label">${markdown.utils.escapeHtml(description ? `图片：${description}` : '图片')}</span>`
    }
    const escapedHref = markdown.utils.escapeHtml(href)
    const alt = markdown.utils.escapeHtml(renderer.renderInlineAsText(token.children || [], options, environment))
    const title = token.attrGet('title')
    const image = `<img class="generated-image" src="${escapedHref}" alt="${alt}"${title ? ` title="${markdown.utils.escapeHtml(String(title))}"` : ''} loading="lazy">`
    // A Markdown image may already be inside an explicit link.
    const linkDepth = tokens.slice(0, index).reduce((depth, item) => depth + (item.type === 'link_open' ? 1 : item.type === 'link_close' ? -1 : 0), 0)
    return linkDepth > 0 ? image : `<a class="generated-image-link" href="${escapedHref}" target="_blank" rel="noopener noreferrer">${image}</a>`
  }
  markdown.renderer.rules.link_open = (tokens, index, options, _environment, renderer) => {
    const token = tokens[index]!
    token.attrJoin('class', 'markdown-link')
    if (/^https?:\/\//i.test(String(token.attrGet('href') || ''))) {
      token.attrSet('target', '_blank')
      token.attrSet('rel', 'noopener noreferrer')
    }
    return renderer.renderToken(tokens, index, options)
  }
  markdown.renderer.rules.table_open = () => '<div class="markdown-table-wrap" tabindex="0" role="region" aria-label="表格，可横向滚动"><table>\n'
  markdown.renderer.rules.table_close = () => '</table></div>\n'

  function codeBlock(content: string, info: string, environment: MarkdownEnvironment) {
    const index = environment.codeBlocks.push(content) - 1
    const language = markdown.utils.escapeHtml(info.trim().split(/\s+/)[0] || '代码')
    return `<div class="markdown-code-block"><div class="markdown-code-toolbar"><span class="markdown-code-language">${language}</span><button type="button" class="markdown-copy-code" data-copy-code="${index}" aria-label="复制代码">复制代码</button></div><pre><code>${markdown.utils.escapeHtml(content)}</code></pre></div>\n`
  }
  markdown.renderer.rules.fence = (tokens, index, _options, environment) => {
    const token = tokens[index]!
    return codeBlock(token.content, token.info, environment as MarkdownEnvironment)
  }
  markdown.renderer.rules.code_block = (tokens, index, _options, environment) =>
    codeBlock(tokens[index]!.content, '', environment as MarkdownEnvironment)

  if (linkify) {
    // Transform parsed text only. Existing links, inline/fenced code and image
    // descriptions stay intact, avoiding the old HTML-string double parsing.
    markdown.core.ruler.after('linkify', 'github_repositories', state => {
      for (const block of state.tokens) {
        if (block.type !== 'inline' || !block.children) continue
        const children: typeof block.children = []
        let linkDepth = 0
        for (const token of block.children) {
          if (token.type === 'link_open') linkDepth++
          if (token.type === 'link_close') linkDepth--
          if (token.type !== 'text' || linkDepth > 0) { children.push(token); continue }
          const pattern = /(^|[\s(])([A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100})(?=$|[\s),.!?:;])/g
          let cursor = 0
          let match: RegExpExecArray | null
          while ((match = pattern.exec(token.content))) {
            const start = match.index + match[1]!.length
            if (start > cursor) {
              const before = new state.Token('text', '', 0)
              before.content = token.content.slice(cursor, start)
              children.push(before)
            }
            const open = new state.Token('link_open', 'a', 1)
            open.attrSet('href', `https://github.com/${match[2]}`)
            open.attrSet('class', 'markdown-link--repo')
            const label = new state.Token('text', '', 0)
            label.content = match[2]!
            children.push(open, label, new state.Token('link_close', 'a', -1))
            cursor = start + match[2]!.length
          }
          if (cursor === 0) children.push(token)
          else if (cursor < token.content.length) {
            const after = new state.Token('text', '', 0)
            after.content = token.content.slice(cursor)
            children.push(after)
          }
        }
        block.children = children
      }
    })
  }
  return markdown
}

const plainMarkdown = createMarkdown(false)
const linkedMarkdown = createMarkdown(true)

/** Handles incomplete fences during streaming without making their code active. */
export function renderAssistantMarkdown(text: string, options: AssistantMarkdownOptions = {}) {
  const environment: MarkdownEnvironment = { codeBlocks: [], allowImages: options.allowImages === true }
  const html = (options.linkify ? linkedMarkdown : plainMarkdown).render(text, environment)
  return { html, codeBlocks: environment.codeBlocks }
}
