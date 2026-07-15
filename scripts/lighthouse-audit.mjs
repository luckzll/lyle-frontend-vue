import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { launch } from 'chrome-launcher'
import lighthouse from 'lighthouse'

const origin = process.env.LIGHTHOUSE_ORIGIN || 'http://127.0.0.1:4173'
const apiOrigin = process.env.LIGHTHOUSE_API_ORIGIN || 'http://127.0.0.1:8080'
const minimumScore = Number(process.env.LIGHTHOUSE_MIN_SCORE || '0.9')
const reportDirectory = resolve('test-results/lighthouse-v42')
const auditedPages = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'knowledge-bases', path: '/knowledge-bases' },
  { name: 'memory', path: '/memory' },
  { name: 'settings', path: '/settings' },
  { name: 'execution-center', path: '/execution-center' }
]

async function waitUntilReady(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // The preview server may still be starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function createAuditUser() {
  const username = `lighthouse_${Date.now()}`
  const response = await fetch(`${apiOrigin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'Lighthouse-4.2!' })
  })
  if (!response.ok) {
    throw new Error(`Unable to create Lighthouse user (${response.status})`)
  }
  return response.json()
}

const preview = spawn(
  process.execPath,
  [resolve('node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '4173'],
  { stdio: ['ignore', 'pipe', 'pipe'] }
)

let chrome
let browser

try {
  await waitUntilReady(`${origin}/login`)
  const auth = await createAuditUser()

  chrome = await launch({
    chromePath: chromium.executablePath(),
    chromeFlags: [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--window-size=1440,1000'
    ],
    logLevel: 'silent'
  })

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${chrome.port}`)
  const context = browser.contexts()[0]
  const page = context.pages()[0] || await context.newPage()
  await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(({ user, token }) => {
    localStorage.setItem('lyle-user', JSON.stringify(user))
    localStorage.setItem('lyle-token', token)
  }, auth)

  await mkdir(reportDirectory, { recursive: true })
  const summary = []

  for (const auditedPage of auditedPages) {
    const url = `${origin}${auditedPage.path}`
    const result = await lighthouse(url, {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['accessibility'],
      disableStorageReset: true,
      maxWaitForLoad: 45_000
    })
    if (!result) throw new Error(`Lighthouse returned no result for ${url}`)

    const score = result.lhr.categories.accessibility.score ?? 0
    const numericScore = Math.round(score * 100)
    summary.push({ page: auditedPage.path, accessibility: numericScore })
    await writeFile(
      resolve(reportDirectory, `${auditedPage.name}.json`),
      JSON.stringify(result.lhr, null, 2),
      'utf8'
    )
    process.stdout.write(`${auditedPage.path}: Accessibility ${numericScore}\n`)
  }

  await writeFile(resolve(reportDirectory, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')
  const failures = summary.filter((item) => item.accessibility < minimumScore * 100)
  if (failures.length > 0) {
    throw new Error(`Lighthouse Accessibility score below ${minimumScore * 100}: ${JSON.stringify(failures)}`)
  }
} finally {
  if (browser) await browser.close().catch(() => undefined)
  if (chrome) {
    try {
      chrome.kill()
    } catch {
      // The connected browser may already have exited after Playwright closed it.
    }
  }
  preview.kill('SIGTERM')
}
