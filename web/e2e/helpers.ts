import { expect, type APIRequestContext, type Page } from '@playwright/test'

export const API = 'http://127.0.0.1:8010'
/** Demo password rule: <FirstName>_2026 (clinicians: <Surname>_2026). */
export const pw = (name: string) => `${name.replace(/^Dr\.?\s+/, '').split(' ')[0]}_2026`

export async function signIn(page: Page, username: string, password: string) {
  await page.goto('/')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}
export async function signInOk(page: Page, username: string, password: string) {
  await signIn(page, username, password)
  await expect(page.getByTestId('session-chips')).toBeVisible()
}
export async function signOut(page: Page) {
  await page.getByRole('button', { name: /sign out/i }).click()
  await expect(page.getByRole('heading', { name: /sign in to carecircle/i })).toBeVisible()
}

export async function tokenFor(request: APIRequestContext, username: string, password: string) {
  const r = await request.post(`${API}/api/auth/login`, { data: { username, password } })
  expect(r.ok(), `login ${username}`).toBeTruthy()
  return (await r.json()).token as string
}
export const authed = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } })

/** Put one family's demo data back to its starting story (people, passwords and the audit log are never touched by a reset). */
export async function resetFamily(request: APIRequestContext, admin: string, adminName: string) {
  const t = await tokenFor(request, admin, pw(adminName))
  const r = await request.post(`${API}/api/demo/reset`, { data: { name: 'decline' }, ...authed(t) })
  expect(r.ok()).toBeTruthy()
}

/** Stand in for the language model: stream a fixed reply from the AI endpoints (no Bedrock). */
export async function stubChat(page: Page, events: object[]) {
  await page.route('**/api/chat/stream*', (r) =>
    r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') }))
}
export const textReply = (text: string) => [{ type: 'session', session_id: 's1' }, { type: 'text', delta: text }, { type: 'done', reply: text }]
