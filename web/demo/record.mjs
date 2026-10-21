// Records the product demo (screen video with on-screen captions) by driving the real UI against the running server.
//   1. CARECIRCLE_DEMO_TIME=09:00 uv run carecircle        (needs the model key in .env)
//   2. python3 demo/make_audio.py clips                     -> speaks narration.json (macOS)
//   3. node demo/record.mjs                                 -> demo/out/carecircle-silent.webm + timeline.json (each caption waits for its spoken line)
//   4. python3 demo/make_audio.py mix <ffmpeg>              -> demo/out/carecircle-demo.mp4 (video + voiceover)
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'out')
const BASE = process.env.BASE_URL ?? 'http://localhost:8000'
const SAMPLE = path.resolve(HERE, '../../evals/samples/rx_photo.png')
fs.mkdirSync(OUT, { recursive: true })
const NARR = JSON.parse(fs.readFileSync(path.join(HERE, 'narration.json'), 'utf8'))
const DUR = JSON.parse(fs.readFileSync(path.join(OUT, 'narration', 'durations.json'), 'utf8'))

const t0 = Date.now()
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5)
const log = (m) => console.log(`[${stamp()}s] ${m}`)

async function api(pathname, body, token) {
  const r = await fetch(BASE + pathname, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`${pathname} ${r.status}`)
  return r.json()
}
const { token } = await api('/api/auth/login', { username: 'rohan', password: 'Rohan_2026' })
await api('/api/demo/reset', { name: 'decline' }, token)          // start from the story's first scene

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir: OUT, size: { width: 1600, height: 900 } } })
await ctx.addInitScript(() => {
  try { localStorage.setItem('cc.voice', 'off'); localStorage.setItem('cc.theme', 'light'); localStorage.setItem('cc.dev', 'off') } catch { /* ignore */ }
  addEventListener('DOMContentLoaded', () => {
    const el = document.createElement('div'); el.id = 'demo-cap'
    el.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);max-width:1100px;z-index:99999;padding:14px 26px;border-radius:16px;background:rgba(15,23,32,.92);color:#fff;font:600 24px/1.35 Inter,system-ui,sans-serif;text-align:center;box-shadow:0 8px 30px #0006;opacity:0;transition:opacity .35s;pointer-events:none'
    document.body.appendChild(el)
  })
})
let vt0 = Date.now()
const page = await ctx.newPage()
vt0 = Date.now()                                               // the video starts when the page is created

const lines = []; let speechEnds = 0
/** Show a caption and start its spoken line. The previous line is always allowed to finish first, so the voice never overlaps. */
const cap = async (id) => {
  const wait = speechEnds - Date.now(); if (wait > 0) await page.waitForTimeout(wait)
  const text = NARR[id].cap; log(text)
  await page.evaluate((t) => { const e = document.getElementById('demo-cap'); if (e) { e.textContent = t; e.style.opacity = '1' } }, text)
  lines.push({ id, start: (Date.now() - vt0) / 1000 }); speechEnds = Date.now() + (DUR[id] + 0.35) * 1000
}
const clear = () => page.evaluate(() => { const e = document.getElementById('demo-cap'); if (e) e.style.opacity = '0' })
const hold = (s) => page.waitForTimeout(s * 1000)

/** Wait until the assistant has started answering and the feed has stopped changing. */
async function settle(sel, { min = 1, quiet = 3, max = 45 } = {}) {
  const start = Date.now(); let last = '', stable = 0
  while ((Date.now() - start) / 1000 < max) {
    await hold(1)
    const n = await page.locator(sel).count()
    const text = n >= min ? await page.locator(sel).last().innerText() : ''
    stable = text && text === last ? stable + 1 : 0
    last = text
    if (stable >= quiet) return
  }
}
async function say(text) {
  const box = page.getByLabel('Message Alexa')
  await box.click(); await box.pressSequentially(text, { delay: 35 })
  await hold(0.4); await page.getByRole('button', { name: 'Send', exact: true }).click()
}

// 1 ─ the problem and the sign-in
await page.goto(BASE); await page.getByTestId('directory').waitFor()
await cap('intro')
await cap('start'); await hold(1)
await page.getByRole('button', { name: /start the demo/i }).click()
await page.getByTestId('overview').waitFor(); await hold(1)

// 2 ─ Asha talks to Alexa; the MCP tools do the work
await cap('asha')
await say('I took my metformin. I slept badly and my sugar this morning was 58.')
await cap('tools'); await settle('[data-testid="assistant-message"]')
await hold(1)
await page.getByRole('button', { name: /show developer view/i }).click()
await cap('mcp'); await hold(1)
await page.getByRole('button', { name: /hide developer view/i }).click()

// 3 ─ the family sees it, and safety is not left to the model
await cap('family'); await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await hold(1)
await cap('safety'); await hold(1)
await say("I fell in the bathroom and I can't get up.")
await settle('[data-testid="assistant-message"]', { quiet: 3 })
await cap('fall'); await hold(1)

// 4 ─ autonomous care watch
await page.getByTestId('care-watch').scrollIntoViewIfNeeded(); await hold(0.5)
await cap('watch')
await page.getByRole('button', { name: /run care watch/i }).click()
await settle('[data-testid="agent-report"]', { quiet: 4, max: 50 }); await hold(2)

// 5 ─ languages
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await hold(0.8)
await page.getByRole('button', { name: /language and voice/i }).click(); await hold(1)
await cap('langs'); await hold(1)
await page.getByRole('button', { name: /हिन्दी/ }).first().click(); await hold(0.8)
await page.keyboard.press('Escape'); await hold(0.5)
await say('मेरे घुटनों में बहुत दर्द है')
await settle('[data-testid="assistant-message"]'); await hold(2)

// 6 ─ the admin console and prescription scanning
await page.getByRole('button', { name: 'Manage', exact: true }).click()
await page.getByRole('tab', { name: /care plan/i }).click()
await cap('admin'); await hold(1)
await page.getByLabel('Prescription photo or PDF').setInputFiles(SAMPLE)
await cap('scan')
await page.getByTestId('rx-review').waitFor({ timeout: 90000 }); await hold(4)
await cap('checks'); await hold(1)
await page.getByRole('button', { name: /^Add \d+ selected/ }).click()
await page.getByTestId('rx-done').waitFor(); await hold(3)

// 7 ─ governance
await page.getByRole('button', { name: 'Family app', exact: true }).click()
await cap('audit')
await page.getByRole('heading', { name: /activity/i }).first().scrollIntoViewIfNeeded().catch(() => {}); await hold(5)

// 8 ─ close
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
await cap('outro'); await hold(1)
const wait = speechEnds - Date.now(); if (wait > 0) await page.waitForTimeout(wait); await hold(1.5); await clear()

const seconds = (Date.now() - vt0) / 1000
const video = page.video(); await ctx.close(); await browser.close()
const file = await video.path(); const dest = path.join(OUT, 'carecircle-silent.webm'); fs.renameSync(file, dest)
fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify({ video_seconds: seconds, lines }, null, 1))
await api('/api/demo/reset', { name: 'decline' }, token)           // leave the demo data as we found it
log(`saved ${dest}`)
