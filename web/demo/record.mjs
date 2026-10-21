// Records the product demo (screen video with on-screen captions) by driving the real UI against the running server.
//   1. CARECIRCLE_DEMO_TIME=09:00 uv run carecircle        (needs the model key in .env)
//   2. node demo/record.mjs                                 -> demo/out/carecircle-demo.webm
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'out')
const BASE = process.env.BASE_URL ?? 'http://localhost:8000'
const SAMPLE = path.resolve(HERE, '../../evals/samples/rx_photo.png')
fs.mkdirSync(OUT, { recursive: true })

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
const page = await ctx.newPage()

const cap = async (text) => { log(text); await page.evaluate((t) => { const e = document.getElementById('demo-cap'); if (e) { e.textContent = t; e.style.opacity = t ? '1' : '0' } }, text) }
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
await cap('CareCircle: voice-first care for the people we love'); await hold(3.5)
await cap('Six synthetic families, 29 accounts, four roles. Start the demo.'); await hold(2)
await page.getByRole('button', { name: /start the demo/i }).click()
await page.getByTestId('overview').waitFor(); await cap(''); await hold(1.5)

// 2 ─ Asha talks to Alexa; the MCP tools do the work
await cap('Asha, 78, has type 2 diabetes. She just talks to Alexa.'); await hold(2.5)
await say('I took my metformin. I slept badly and my sugar this morning was 58.')
await cap('Alexa picks the tools: log the dose, record the reading, check the trend'); await settle('[data-testid="assistant-message"]')
await hold(1)
await page.getByRole('button', { name: /show developer view/i }).click()
await cap('Every call goes through the MCP server: permission-checked, patient-bound, audited'); await hold(4.5)
await page.getByRole('button', { name: /hide developer view/i }).click()

// 3 ─ the family sees it, and safety is not left to the model
await cap('Her son Rohan sees it instantly in the family app'); await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await hold(4)
await cap('Safety is code, not luck: emergencies are never left to the model'); await hold(2)
await say("I fell in the bathroom and I can't get up.")
await settle('[data-testid="assistant-message"]', { quiet: 3 })
await cap('The server speaks a fixed 112 / 108 message and raises an urgent alert'); await hold(4.5)

// 4 ─ autonomous care watch
await page.getByTestId('care-watch').scrollIntoViewIfNeeded(); await hold(0.5)
await cap('Autonomous care watch: reviews the whole record and decides who needs to know')
await page.getByRole('button', { name: /run care watch/i }).click()
await settle('[data-testid="agent-report"]', { quiet: 4, max: 50 }); await hold(2)

// 5 ─ languages
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await hold(0.8)
await page.getByRole('button', { name: /language and voice/i }).click(); await hold(1)
await cap('Seven languages. Alexa+ in India covers English, Hindi and Hinglish today.'); await hold(2.5)
await page.getByRole('button', { name: /हिन्दी/ }).first().click(); await hold(0.8)
await page.keyboard.press('Escape'); await hold(0.5)
await say('मेरे घुटनों में बहुत दर्द है')
await settle('[data-testid="assistant-message"]'); await hold(2)

// 6 ─ the admin console and prescription scanning
await page.getByRole('button', { name: 'Manage', exact: true }).click()
await page.getByRole('tab', { name: /care plan/i }).click()
await cap('Family admins manage the care plan. New prescription? Just photograph it.'); await hold(2.5)
await page.getByLabel('Prescription photo or PDF').setInputFiles(SAMPLE)
await cap('The model reads it into a draft. Nothing is added until a person confirms.')
await page.getByTestId('rx-review').waitFor({ timeout: 90000 }); await hold(4)
await cap('Allergy conflicts and duplicates are caught by code, not by the model'); await hold(4.5)
await page.getByRole('button', { name: /^Add \d+ selected/ }).click()
await page.getByTestId('rx-done').waitFor(); await hold(3)

// 7 ─ governance
await page.getByRole('button', { name: 'Family app', exact: true }).click()
await cap('Every action is audited. Families only ever see their own people.')
await page.getByRole('heading', { name: /activity/i }).first().scrollIntoViewIfNeeded().catch(() => {}); await hold(5)

// 8 ─ close
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
await cap('CareCircle · built for Alexa+ with an MCP server · MIT · github.com/Shivprasadhule/carecircle'); await hold(5)
await cap('')

const video = page.video(); await ctx.close(); await browser.close()
const file = await video.path(); const dest = path.join(OUT, 'carecircle-demo.webm'); fs.renameSync(file, dest)
await api('/api/demo/reset', { name: 'decline' }, token)           // leave the demo data as we found it
log(`saved ${dest}`)
